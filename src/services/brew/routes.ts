import type { RoleKey } from '@/services/tagger/client';
import { ROLE_LABELS } from '@/services/deckBuilder/roleTargets';
import type { BrewContext, BrewState, BrewRoute } from './brewTypes';
import { buildHealth, isComplete, typeKey, pool } from './health';
import { seededChance } from './jitter';
import { detectNearMissCombos } from './combos';
import { leaningThemes } from './identity';
import { deckFill, IDENTITY_PHASE_FILL } from './scoring';

const ROLE_KEYS: RoleKey[] = ['ramp', 'removal', 'boardwipe', 'cardDraw', 'protection'];

/** Picks before a Gamble route may appear (mirrors events.GAMBLE_MIN_PICKS; kept local to avoid an import cycle). */
const GAMBLE_FORK_MIN = 8;
/** Seeded chance a fork offers "Seal the Pack" (~one sighting per run at ~6 forks); once taken, never again. */
const SEAL_OFFER_CHANCE = 0.1;

/** Rotate an array left by `by` (stable, wraps). Used to vary which "extra" routes lead each fork. */
function rotate<T>(arr: T[], by: number): T[] {
  if (arr.length <= 1) return arr;
  const n = ((Math.trunc(by) % arr.length) + arr.length) % arr.length;
  return [...arr.slice(n), ...arr.slice(0, n)];
}

export interface Deficit {
  key: string;
  kind: 'role' | 'type';
  label: string;        // route title, e.g. "Add Removal"
  shortLabel: string;   // pack label, e.g. "Removal"
  deficit: number;
  current: number;      // how many of this role/type are already picked
  target: number;       // the role/type target
}

function roleTitle(role: RoleKey): string {
  return role === 'cardDraw' ? 'Add Card Draw'
    : role === 'boardwipe' ? 'Add a Board Wipe'
    : `Add ${ROLE_LABELS[role] ?? role}`;
}

// Why each category matters — flavor that teaches the deckbuilding role, not just "draft a card".
const ROLE_FLAVOR: Record<RoleKey, string> = {
  ramp: 'Ramp accelerates your mana so your threats land a turn ahead of the table.',
  removal: 'Spot removal answers the one card that would otherwise take over the game.',
  boardwipe: "A board wipe is your reset button — sweep the table when you've fallen behind.",
  cardDraw: 'Card draw refills your hand so you never run out of gas.',
  protection: 'Protection keeps your key permanents alive through removal and board wipes.',
};
const TYPE_FLAVOR: Record<string, string> = {
  creature: 'Creatures carry your attack and defense — the bodies that actually win the game.',
  instant: "Instants let you act on your opponents' turns: respond, protect, and set the pace.",
  sorcery: 'Sorceries deliver your biggest, game-swinging main-phase effects.',
  artifact: 'Artifacts add colorless utility and ramp that slot into any plan.',
  enchantment: 'Enchantments stick to the table and grind out value turn after turn.',
  planeswalker: 'Planeswalkers churn out advantage every turn and force answers.',
  battle: 'Battles drag the table into fights on your terms.',
  land: 'Lands fix and grow the mana base everything else runs on.',
};
function deficitFlavor(d: Deficit): string {
  return d.kind === 'role'
    ? ROLE_FLAVOR[d.key as RoleKey]
    : (TYPE_FLAVOR[d.key] ?? 'Shore up this part of your deck.');
}

/** How many candidates of a given role/type remain in the pool (not yet used). */
function poolHas(ctx: BrewContext, state: BrewState, predicate: (c: BrewContext['candidates'][number]) => boolean): number {
  const used = new Set(state.usedNames);
  return pool(ctx, state).filter(c => !used.has(c.name) && predicate(c)).length;
}

/** Plural, Capitalized type label ("sorcery" → "Sorceries"). */
function typeLabel(type: string): string {
  const plural = type.endsWith('y') ? `${type.slice(0, -1)}ies` : `${type}s`;
  return `${plural.charAt(0).toUpperCase()}${plural.slice(1)}`;
}

/**
 * Role + type deficits the pool can actually fill, biggest gap first. Shared by the fork (to flavor
 * the pack route) and the pack builder (to compose the "need" pack).
 */
export function computeDeficits(ctx: BrewContext, state: BrewState): Deficit[] {
  const health = buildHealth(ctx, state);
  const deficits: Deficit[] = [];
  for (const role of ROLE_KEYS) {
    const target = ctx.roleTargets[role] ?? 0;
    const current = health.roleCounts[role] ?? 0;
    const d = target - current;
    if (d > 0 && poolHas(ctx, state, c => c.role === role) > 0) {
      deficits.push({ key: role, kind: 'role', label: roleTitle(role), shortLabel: ROLE_LABELS[role] ?? role, deficit: d, current, target });
    }
  }
  for (const [type, target] of Object.entries(ctx.typeTargets)) {
    const current = health.typeCounts[type] ?? 0;
    const d = target - current;
    if (d > 0 && poolHas(ctx, state, c => typeKey(c.scryfall.type_line) === type) > 0) {
      deficits.push({ key: type, kind: 'type', label: `Add ${typeLabel(type)}`, shortLabel: typeLabel(type), deficit: d, current, target });
    }
  }
  deficits.sort((a, b) => b.deficit - a.deficit);
  return deficits;
}

export function nextRoutes(ctx: BrewContext, state: BrewState): BrewRoute[] {
  // Phase transition: once nonland targets are essentially met, only offer the mana base.
  const nonLandPicks = state.picks.filter(p => !p.card.type_line.toLowerCase().includes('land')).length;
  if (state.phase !== 'lands' && isComplete(ctx, state)) {
    return [{
      id: 'manabase', type: 'manabase', title: 'Build the Mana Base',
      description: 'Choose a land style; we fill the rest to a clean curve.',
      targetRole: null, targetType: null, tone: 'neutral', fills: ctx.landTarget,
    }];
  }

  const nearMiss = detectNearMissCombos(ctx, state);
  const deficits = computeDeficits(ctx, state);

  const fillRatio = ctx.nonLandTarget > 0 ? nonLandPicks / ctx.nonLandTarget : 0;

  // The fork's CARDS are the special opportunities — opening a pack is the run's normal fare, so it
  // never competes as a peer card; it rides along as the quiet default (rendered as a low-key
  // "or just open a pack" action under the specials).
  const specials: BrewRoute[] = [];
  const leaning = leaningThemes(ctx, state);
  const leanFlavor = leaning.length > 0 ? ` Leaning into ${leaning[0]}.` : '';

  if (nearMiss.length > 0) {
    const count = Math.min(nearMiss.length, 3);
    specials.push({
      id: 'combo',
      type: 'combo',
      title: count === 1 ? 'Complete a Combo' : 'Combos',
      description: count === 1
        ? "Pop off and go infinite — you're one piece away from your engine."
        : `Pop off and go infinite — ${count} combos are within reach.`,
      targetRole: null, targetType: null, tone: 'theme', tag: 'Combo',
      fills: nearMiss[0].missing.length,
    });
  }

  // The default path — open a package: one screen, three directions, pick a whole pack. Early
  // ("identity phase") the directions are all themes; once the deck's shape is set, the lead
  // direction becomes the biggest deficit (fill holes + add staples).
  const usedSet = new Set(state.usedNames);
  const draftableLeft = pool(ctx, state).some(c => !usedSet.has(c.name) && !c.isLand);
  const topNeed = deficits[0];
  const steer = !!topNeed && deckFill(ctx, state) >= IDENTITY_PHASE_FILL;
  const packRoute: BrewRoute | null = draftableLeft
    ? {
        id: 'bundle:pack',
        type: 'bundle',
        title: 'Open a Pack',
        description: steer
          ? `${deficitFlavor(topNeed!)}${leanFlavor}`
          : leaning.length > 0
            ? `Lean into ${leaning[0]} — three directions to explore.`
            : "Three directions — find your deck's identity.",
        targetRole: steer && topNeed!.kind === 'role' ? (topNeed!.key as RoleKey) : null,
        targetType: steer && topNeed!.kind === 'type' ? topNeed!.key : null,
        tone: steer ? 'need' : 'theme',
        tag: steer ? `${topNeed!.shortLabel} ${topNeed!.current}/${topNeed!.target}` : (leaning[0] ?? 'Identity'),
        fills: 3,
      }
    : null;

  // Distinct "ways to acquire" beyond opening a pack — each a different decision (commit hard /
  // trust the synergy graph / take a swing). Surfaced as ROTATING extras so the fork stays a real
  // menu fork-to-fork. slice(0,3) below caps the special cards (+ combo).
  const extras: BrewRoute[] = [];
  // Headliner — four standouts; take as many as you want, the rest are gone. A regular option now
  // (no longer alternating-only), but withheld near completion so it doesn't crowd the late deck.
  if (draftableLeft && fillRatio < 0.9) {
    extras.push({
      id: 'draft:elite', type: 'draft', title: 'Headliner',
      description: `Four standouts — take any of them, leave the rest.${leanFlavor}`,
      targetRole: null, targetType: null, tone: 'theme', tag: 'Pick & choose', fills: 1,
    });
  }
  // Hidden Synergy — draft a card the relationship graph surfaced for YOUR picks. Only when the
  // discovery pool has fed in some lift/co-play finds (grows stronger later in the run).
  const hasSynergyFinds = pool(ctx, state).some(c => !usedSet.has(c.name) && !c.isLand && !!c.discoveredVia);
  if (hasSynergyFinds) {
    extras.push({
      id: 'draft:synergy', type: 'draft', title: 'Hidden Synergy',
      description: 'Cards the graph says click with what you’ve built — take the one that calls to you.',
      targetRole: null, targetType: null, tone: 'neutral', tag: 'Lift', fills: 1,
    });
  }
  // Take a Gamble — a deep-cut, off-meta swing (resolves through the gamble event: a reveal + leap,
  // and the leap seeds fresh discoveries). Only once the deck has a shape to gamble against, AND only
  // when an un-fired deep cut actually exists — mirrors gambleEvent's eligibility so the route never
  // resolves to a card-less dead-end (gambleEvent filters out used + already-fired `gamble:<name>`).
  const firedGamble = new Set(state.firedEventIds);
  const hasGambleCard = [...ctx.candidates, ...state.discovered]
    .some(c => !c.isLand && !usedSet.has(c.name) && !firedGamble.has(`gamble:${c.name}`));
  if (state.picks.length >= GAMBLE_FORK_MIN && hasGambleCard) {
    extras.push({
      id: 'gamble', type: 'gamble', title: 'Take a Gamble',
      description: 'A deep cut almost no one runs in decks like yours — take the leap and see what it pulls in.',
      targetRole: null, targetType: null, tone: 'neutral', tag: 'Wager', fills: 1,
    });
  }
  // Seal the Pack — the tempo-for-treasure wager: give up this round entirely to guarantee the
  // next theme pack hides gold. Rare (seeded per fork), once per run, and only while there are
  // still packs to come; the stake is opportunity, never deck quality.
  if (
    state.picks.length >= GAMBLE_FORK_MIN && draftableLeft && fillRatio < 0.85
    && !state.sealUsed && !state.sealedGold
    && seededChance(state.seed, `seal:${state.history.length}`, SEAL_OFFER_CHANCE)
  ) {
    extras.push({
      id: 'seal', type: 'seal', title: 'Seal the Pack',
      description: 'Skip this round — take nothing now, and the next theme pack is guaranteed to hide gold.',
      targetRole: null, targetType: null, tone: 'neutral', tag: 'Wager', fills: 0,
    });
  }
  specials.push(...rotate(extras, (state.seed ?? 0) + state.history.length));

  // Exhaustion fallback: if nothing meaningful can be drafted (no pack/elite/combo route), surface
  // the mana base / finish route rather than a dead-end fork.
  if (specials.length === 0 && !packRoute) {
    return [{
      id: 'manabase', type: 'manabase', title: 'Build the Mana Base',
      description: 'No more cards to draft — finish the deck and fill the mana base.',
      targetRole: null, targetType: null, tone: 'neutral', fills: ctx.landTarget,
    }];
  }

  // Up to three special cards; the pack route (if any) always tags along LAST — the UI renders it
  // as the quiet default under the specials, never as one of the cards.
  return packRoute ? [...specials.slice(0, 3), packRoute] : specials.slice(0, 3);
}

export function matchesDeficit(c: BrewContext['candidates'][number], d: Deficit): boolean {
  return d.kind === 'role' ? c.role === d.key : typeKey(c.scryfall.type_line) === d.key;
}
