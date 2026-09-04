import type { ScryfallCard } from '@/types';

/**
 * Combat maths for both directions of the table. Pure on purpose: the bot's
 * attack step and the player's both need identical rules, and the only way to
 * be sure of that is to have one implementation neither store owns.
 *
 * Scope is the seven keywords that decide who dies. Everything else about a
 * card — triggers, activated abilities, protection — is still ignored. This is
 * a goldfish with teeth, not a rules engine.
 */

export type CombatKeyword =
  | 'flying' | 'reach' | 'menace'
  | 'firstStrike' | 'doubleStrike'
  | 'deathtouch' | 'trample' | 'vigilance';

/**
 * Scryfall's keyword strings, lowercased, mapped to our narrowed set. Reading
 * `card.keywords` rather than scraping oracle text means reminder text on an
 * unrelated card can't produce a false positive.
 */
const KEYWORD_MAP: Record<string, CombatKeyword> = {
  'flying': 'flying',
  'reach': 'reach',
  'menace': 'menace',
  'first strike': 'firstStrike',
  'double strike': 'doubleStrike',
  'deathtouch': 'deathtouch',
  'trample': 'trample',
  'vigilance': 'vigilance',
};

export function keywordsOf(card: ScryfallCard): Set<CombatKeyword> {
  const out = new Set<CombatKeyword>();
  for (const raw of card.keywords ?? []) {
    const mapped = KEYWORD_MAP[raw.toLowerCase()];
    if (mapped) out.add(mapped);
  }
  return out;
}

/** One creature in combat, flattened to what the maths needs. */
export interface Combatant {
  instanceId: string;
  name: string;
  power: number;
  toughness: number;
  keywords: Set<CombatKeyword>;
}

export interface CombatOutcome {
  /** Damage that got through to the defending player. */
  damageToDefender: number;
  deadAttackers: string[];
  deadBlockers: string[];
}

/** Evasion: a flyer can only be blocked by flying or reach. */
export function canBlock(attacker: Combatant, blocker: Combatant): boolean {
  if (!attacker.keywords.has('flying')) return true;
  return blocker.keywords.has('flying') || blocker.keywords.has('reach');
}

/**
 * Whether a proposed set of blockers is a legal block. Zero blockers is legal —
 * that's "unblocked", not an illegal block.
 */
export function blocksLegal(attacker: Combatant, blockers: Combatant[]): boolean {
  if (blockers.length === 0) return true;
  if (!blockers.every(b => canBlock(attacker, b))) return false;
  if (attacker.keywords.has('menace') && blockers.length < 2) return false;
  return true;
}

/** Does this creature deal its damage in the given strike pass? */
function strikesIn(c: Combatant, pass: 'first' | 'normal'): boolean {
  const first = c.keywords.has('firstStrike');
  const double = c.keywords.has('doubleStrike');
  if (pass === 'first') return first || double;
  return double || !first;
}

/**
 * Work out a combat. Two passes so first strike is real: everything with first
 * or double strike deals damage, the dead are removed, then the survivors and
 * the double strikers deal again.
 *
 * `blocks` is keyed by attacker instanceId. An attacker with an entry is
 * blocked even if every blocker in it has already died — that's why the
 * unblocked check looks at the original list, not the surviving one.
 */
export function resolveDamage(
  attackers: Combatant[],
  blocks: Record<string, Combatant[]>,
): CombatOutcome {
  const dead = new Set<string>();
  let damageToDefender = 0;

  for (const pass of ['first', 'normal'] as const) {
    // Damage inside a pass is simultaneous, so deaths are collected and applied
    // at the end of the pass rather than as we go.
    const lethal = new Set<string>();

    for (const attacker of attackers) {
      if (dead.has(attacker.instanceId)) continue;

      const assigned = blocks[attacker.instanceId] ?? [];
      const liveBlockers = assigned.filter(b => !dead.has(b.instanceId));

      // ── The attacker deals its damage ──
      if (strikesIn(attacker, pass)) {
        if (assigned.length === 0) {
          damageToDefender += attacker.power;
        } else {
          let remaining = attacker.power;
          // Deathtouch only needs to assign 1 damage to be lethal, which frees
          // the rest of the power to trample through.
          const deadly = attacker.keywords.has('deathtouch');
          for (const blocker of liveBlockers) {
            if (remaining <= 0) break;
            const needed = deadly ? 1 : blocker.toughness;
            const give = Math.min(remaining, needed);
            if (give >= needed && blocker.toughness > 0) lethal.add(blocker.instanceId);
            remaining -= give;
          }
          if (attacker.keywords.has('trample') && remaining > 0) {
            damageToDefender += remaining;
          }
        }
      }

      // ── The blockers hit back ──
      const striking = liveBlockers.filter(b => strikesIn(b, pass));
      const back = striking.reduce((sum, b) => sum + b.power, 0);
      const deadlyBlocker = striking.some(b => b.keywords.has('deathtouch') && b.power > 0);
      if (attacker.toughness > 0 && (deadlyBlocker || back >= attacker.toughness)) {
        lethal.add(attacker.instanceId);
      }
    }

    lethal.forEach(id => dead.add(id));
  }

  const attackerIds = new Set(attackers.map(a => a.instanceId));
  return {
    damageToDefender,
    deadAttackers: [...dead].filter(id => attackerIds.has(id)),
    deadBlockers: [...dead].filter(id => !attackerIds.has(id)),
  };
}
