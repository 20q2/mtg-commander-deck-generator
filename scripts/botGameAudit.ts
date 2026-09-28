/**
 * Play a bot deck out headlessly and print a transcript next to the oracle text
 * and registry entry of every card that did something.
 *
 *   node node_modules/vite-node/vite-node.mjs scripts/botGameAudit.ts -- \
 *     --stub=goblin-aggro --games=3 --turns=12 --out=path/to/report.txt
 *
 * Why this exists: auditing a bot deck means reading "Goblin Aggro activates
 * Goblin Trashmaster" against what Goblin Trashmaster actually says, and the
 * judgement in the middle is the whole job. The script's half is the part that
 * can be automated — deal the deck, take the turns, and put the evidence for
 * one card in one place. Deterministic per seed, no network, no dev server, so
 * several of these can run at once without fighting over a browser.
 *
 * Sibling of `botGames.diag.test.ts`, which measures the same games (damage,
 * kill turn, board size) rather than transcribing them.
 */
import { takeTurn } from '@/services/playtest/opponents/engine';
import {
  BOT_ACTIVATED,
  BOT_CYCLING,
  BOT_DEATH_TRIGGERS,
  BOT_DEATH_WATCHERS,
  BOT_DYNAMIC_STATS,
  BOT_EFFECTS,
  BOT_GRAVEYARD_STATICS,
  BOT_LANDFALL_EFFECTS,
  BOT_LANDFALL_SELF,
  BOT_RECURRING_EFFECTS,
  BOT_RECURSION,
  BOT_SELF_EFFECTS,
  BOT_SPELL_TRIGGERS,
  BOT_STATICS,
  BOT_TRIGGERS,
} from '@/services/playtest/opponents/effects';
import { isLand } from '@/components/playtest/utils';
import type { PlayerBoardRead } from '@/services/playtest/opponents/evaluate';
import type { Opponent } from '@/components/playtest/opponentTypes';
import type { ScryfallCard } from '@/types';
import type { Combatant } from '@/services/playtest/combat';
import stubData from '@/data/opponentStubs.json';
import fixture from '@/services/playtest/opponents/__tests__/botGames.fixture.json';
import { writeFileSync } from 'node:fs';

interface Stub { id: string; name: string; commander: string; cards: string[] }
const STUBS = (stubData as { stubs: Stub[] }).stubs;

/** Every registry a card can appear in, so a report can say which one fired. */
const REGISTRIES: [string, Record<string, unknown>][] = [
  ['BOT_EFFECTS', BOT_EFFECTS],
  ['BOT_SELF_EFFECTS', BOT_SELF_EFFECTS],
  ['BOT_ACTIVATED', BOT_ACTIVATED],
  ['BOT_STATICS', BOT_STATICS],
  ['BOT_GRAVEYARD_STATICS', BOT_GRAVEYARD_STATICS],
  ['BOT_DEATH_TRIGGERS', BOT_DEATH_TRIGGERS],
  ['BOT_DEATH_WATCHERS', BOT_DEATH_WATCHERS],
  ['BOT_RECURSION', BOT_RECURSION],
  ['BOT_CYCLING', BOT_CYCLING],
  ['BOT_LANDFALL_EFFECTS', BOT_LANDFALL_EFFECTS],
  ['BOT_LANDFALL_SELF', BOT_LANDFALL_SELF],
  ['BOT_RECURRING_EFFECTS', BOT_RECURRING_EFFECTS],
  ['BOT_DYNAMIC_STATS', BOT_DYNAMIC_STATS],
  ['BOT_TRIGGERS', BOT_TRIGGERS],
  ['BOT_SPELL_TRIGGERS', BOT_SPELL_TRIGGERS],
];

function arg(name: string, fallback: string): string {
  const hit = process.argv.find(a => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
}

/** Deterministic PRNG so a run is reproducible from its seed. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function shuffle<T>(a: T[], rand: () => number): T[] {
  const out = [...a];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

function expand(entries: string[]): string[] {
  const out: string[] = [];
  for (const e of entries) {
    const m = e.match(/^\s*(\d+)\s+(.*)$/);
    const qty = m ? parseInt(m[1], 10) : 1;
    const name = (m ? m[2] : e).trim();
    for (let i = 0; i < qty; i++) out.push(name);
  }
  return out;
}

/**
 * A scripted player board that commits creatures on a schedule — enough to
 * exercise the attack, block and interaction decisions without a second engine.
 */
function playerAt(turn: number): PlayerBoardRead {
  const n = Math.min(4, Math.floor(turn / 3));
  const cards = Array.from({ length: n }, (_, i) => ({
    instanceId: `you${i}`,
    name: `Your Creature ${i}`,
    isCreature: true,
    isArtifact: false,
    isLand: false,
    isEnchantment: false,
    isPlaneswalker: false,
    power: 2 + i,
    toughness: 2 + i,
    isCommander: i === 0,
    comboId: null,
  }));
  const untappedCreatures: Combatant[] = cards.map(c => ({
    instanceId: c.instanceId,
    name: c.name,
    power: c.power,
    toughness: c.toughness,
    keywords: new Set<never>(),
  }));
  return { cards, life: 40, handSize: 7, untappedCreatures } as PlayerBoardRead;
}

const fx = fixture as unknown as {
  cards: Record<string, ScryfallCard>;
  tokens: Record<string, ScryfallCard>;
};

function run() {
  const stubId = arg('stub', '');
  const games = parseInt(arg('games', '3'), 10);
  const turns = parseInt(arg('turns', '12'), 10);
  const out = arg('out', '');
  const stub = STUBS.find(s => s.id === stubId);
  if (!stub) throw new Error(`unknown stub "${stubId}". Have: ${STUBS.map(s => s.id).join(', ')}`);

  const deckNames = expand(stub.cards).filter(n => n !== stub.commander);
  const missing = [...new Set([...deckNames, stub.commander])].filter(n => !fx.cards[n]);
  if (missing.length) throw new Error(`fixture missing: ${missing.join(', ')}`);

  // Only the tokens this deck can actually make, same as deckSources does.
  const tokenIds = new Set<string>();
  for (const n of [...deckNames, stub.commander]) {
    for (const p of fx.cards[n].all_parts ?? []) {
      if (p.component === 'token') tokenIds.add(p.id);
    }
  }
  const tokens = Object.values(fx.tokens).filter(t => tokenIds.has(t.id));

  const lines: string[] = [];
  /** Every card named by a log line, so the oracle dump covers what happened. */
  const seen = new Set<string>();
  const noteNames = (text: string) => {
    for (const name of Object.keys(fx.cards)) {
      if (text.includes(name)) seen.add(name);
    }
  };

  lines.push(`BOT DECK AUDIT — ${stub.name} (${stub.id}), commander ${stub.commander}`);
  lines.push(`${games} games x ${turns} turns, deterministic per seed.`);
  lines.push('');

  for (let game = 0; game < games; game++) {
    const rand = rng(game * 7919 + 13);
    const pool = shuffle(deckNames.map(n => fx.cards[n]), rand);
    let opp: Opponent = {
      id: `sim${game}`, name: stub.name, stubId: stub.id, blurb: '', colors: [],
      life: 40, library: pool.slice(7), hand: pool.slice(0, 7),
      graveyard: [], exile: [], command: [fx.cards[stub.commander]],
      commanderName: stub.commander, commanderCasts: 0, tokens,
      battlefield: [], decked: false, resistance: true, aggression: 0.5, turnsTaken: 0,
    };

    lines.push('='.repeat(70));
    lines.push(`GAME ${game + 1}`);
    lines.push(`opening hand: ${opp.hand.map(c => c.name).join(', ')}`);

    for (let turn = 1; turn <= turns; turn++) {
      const { final, frames } = takeTurn(opp, playerAt(turn));
      opp = final;
      const turnLines: string[] = [];
      for (const f of frames) {
        for (const l of f.logs) {
          turnLines.push(`    ${l}`);
          noteNames(l);
        }
        // What the beat does to YOU, which never shows up in a log line.
        for (const e of f.effects) {
          const bits: string[] = [];
          if (e.destroy.length) bits.push(`destroy x${e.destroy.length}${e.destination === 'exile' ? ' (exile)' : ''}`);
          if (e.lifeLoss) bits.push(`you lose ${e.lifeLoss}`);
          if (e.lifeGain) bits.push(`bot gains ${e.lifeGain}`);
          if (e.discard) bits.push(`you discard ${e.discard}`);
          if (e.lethal) bits.push('LETHAL');
          if (bits.length) turnLines.push(`      -> effect on you: ${bits.join(', ')}`);
        }
        if (f.selfDamage) turnLines.push(`      -> trigger damage to you: ${f.selfDamage}`);
        if (f.selfLifeGain) turnLines.push(`      -> bot life gain: ${f.selfLifeGain}`);
        if (f.attackers.length) {
          const who = f.attackers
            .map(id => f.opponent.battlefield.find(b => b.instanceId === id)?.card.name ?? '?')
            .join(', ');
          turnLines.push(`      -> attacks with: ${who}`);
        }
      }
      lines.push(`  T${turn}  life ${opp.life}  hand ${opp.hand.length}  board ${opp.battlefield.length}`
        + ` (${opp.battlefield.filter(p => isLand(p.card)).length} lands)  yard ${opp.graveyard.length}`
        + `  xp ${opp.experience ?? 0}`);
      lines.push(...turnLines);
    }
    lines.push(`  END board: ${opp.battlefield.map(p => p.card.name).join(', ') || '(empty)'}`);
    lines.push(`  END yard:  ${opp.graveyard.map(c => c.name).join(', ') || '(empty)'}`);
    lines.push(`  END hand:  ${opp.hand.map(c => c.name).join(', ') || '(empty)'}`);
    lines.push('');
  }

  lines.push('='.repeat(70));
  lines.push('ORACLE TEXT AND REGISTRY ENTRIES FOR EVERY CARD THAT APPEARED');
  lines.push('Compare each log line above against the card text below.');
  lines.push('');
  for (const name of [...seen].sort()) {
    const card = fx.cards[name];
    if (!card) continue;
    const pt = card.power ? ` ${card.power}/${card.toughness}` : '';
    lines.push(`--- ${name} | ${card.type_line} | ${card.mana_cost ?? ''}${pt}`);
    lines.push(`    ORACLE: ${(card.oracle_text ?? '').replace(/\n/g, ' | ')}`);
    const hits = REGISTRIES.filter(([, map]) => map[name] !== undefined);
    if (hits.length === 0) {
      lines.push('    REGISTRY: (none — this card is a body only)');
    } else {
      for (const [label, map] of hits) {
        lines.push(`    ${label}: ${JSON.stringify(map[name])}`);
      }
    }
    lines.push('');
  }

  const text = lines.join('\n');
  if (out) {
    writeFileSync(out, text, 'utf8');
    console.log(`wrote ${out} (${text.length} chars, ${seen.size} cards seen)`);
  } else {
    console.log(text);
  }
}

run();
