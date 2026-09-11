/**
 * LIVE DIAGNOSTIC: plays every stub deck out over full games and prints what the
 * bots actually do. Skipped unless VITE_LIVE_DIAG=1.
 *
 *   VITE_LIVE_DIAG=1 node node_modules/vitest/vitest.mjs run src/services/playtest/opponents/__tests__/botGames.diag.test.ts
 *
 * It drives the real `takeTurn` against the real decklists, with cards read from
 * `botGames.fixture.json` (a trimmed Scryfall snapshot of every card in the four
 * stubs plus their tokens) rather than the network, so it is deterministic per
 * seed and needs nothing running. The player it plays against is a scripted board
 * that grows on a schedule, which is enough to exercise the attack, block and
 * interaction decisions without a second engine.
 *
 * What to look for in the output: cards that never get cast, a board that stops
 * developing, a hand that stops emptying, and damage that never arrives.
 */
import { describe, it } from 'vitest';
import { takeTurn } from '@/services/playtest/opponents/engine';
import { lookupSelfEffect } from '@/services/playtest/opponents/effects';
import { botPower } from '@/services/playtest/opponents/stats';
import { isLand } from '@/components/playtest/utils';
import type { PlayerBoardRead } from '@/services/playtest/opponents/evaluate';
import type { Opponent } from '@/components/playtest/opponentTypes';
import type { ScryfallCard } from '@/types';
import type { Combatant } from '@/services/playtest/combat';
import stubData from '@/data/opponentStubs.json';
import fixture from './botGames.fixture.json';

const TURNS = 12;
const GAMES = 25;

interface Stub { id: string; name: string; commander: string; cards: string[] }
const STUBS = (stubData as { stubs: Stub[] }).stubs;

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

/** A scripted player board that commits creatures on a schedule. */
function playerAt(turn: number): PlayerBoardRead {
  const n = Math.min(4, Math.floor(turn / 3));
  const cards = Array.from({ length: n }, (_, i) => ({
    instanceId: `you${i}`, name: `Your Creature ${i}`, isCreature: true, isArtifact: false,
    power: 2 + i, toughness: 2 + i, isCommander: i === 0, comboId: null,
  }));
  const untappedCreatures: Combatant[] = cards.map(c => ({
    instanceId: c.instanceId, name: c.name, power: c.power,
    toughness: c.toughness, keywords: new Set<never>(),
  }));
  return { cards, life: 40, handSize: 7, untappedCreatures };
}

describe.skipIf(import.meta.env.VITE_LIVE_DIAG !== '1')('bot full-game diagnostic', () => {
  it('plays every stub deck out and reports what happened', () => {
    const fx = fixture as unknown as {
      cards: Record<string, ScryfallCard>;
      tokens: Record<string, ScryfallCard>;
    };
    const tokenList = Object.values(fx.tokens);

    for (const stub of STUBS) {
      const deckNames = expand(stub.cards).filter(n => n !== stub.commander);
      const missing = [...new Set([...deckNames, stub.commander])].filter(n => !fx.cards[n]);
      if (missing.length) throw new Error(`fixture missing: ${missing.join(', ')}`);

      // Only the tokens this deck can actually make, same as deckSources does.
      const ids = new Set<string>();
      for (const n of [...deckNames, stub.commander]) {
        for (const p of fx.cards[n].all_parts ?? []) {
          if (p.component === 'token') ids.add(p.id);
        }
      }
      const tokens = tokenList.filter(t => ids.has(t.id));

      const neverCast = new Map<string, number>();
      const drawnEver = new Map<string, number>();
      let totalDamage = 0, totalTurnsAttacked = 0, commanderCastGames = 0;
      /**
       * The turn each game's cumulative damage first reaches 40 — the bot's
       * kill turn against a goldfish that never blocks.
       *
       * This is the number a bracket actually means since the October 2025
       * revision: B1 is around turn 9+, B2 8+, B3 6+, B4 4+. A seat's bracket
       * label is a claim, and this is how the claim gets checked.
       */
      const killTurns: number[] = [];
      const comboTurns: number[] = [];
      const boardAt: number[] = Array(TURNS + 1).fill(0);
      const handAt: number[] = Array(TURNS + 1).fill(0);
      const landsAt: number[] = Array(TURNS + 1).fill(0);
      const tokensAt: number[] = Array(TURNS + 1).fill(0);
      let stuckHandTotal = 0;

      for (let game = 0; game < GAMES; game++) {
        let cumulative = 0;
        let comboTurn: number | null = null;
        let killTurn: number | null = null;
        const rand = rng(game * 7919 + 13);
        const pool = shuffle(deckNames.map(n => fx.cards[n]), rand);
        let opp: Opponent = {
          id: `sim${game}`, name: stub.name, stubId: stub.id, blurb: '', colors: [],
          life: 40, library: pool.slice(7), hand: pool.slice(0, 7),
          graveyard: [], exile: [], command: [fx.cards[stub.commander]],
          commanderName: stub.commander, commanderCasts: 0, tokens,
          battlefield: [], decked: false, resistance: true, aggression: 0.5, turnsTaken: 0,
        };

        for (let turn = 1; turn <= TURNS; turn++) {
          const before = new Set(opp.hand.map(c => c.name));
          const { final, frames } = takeTurn(opp, playerAt(turn));
          opp = final;
          for (const n of before) drawnEver.set(n, (drawnEver.get(n) ?? 0) + 1);

          // Damage that would land if nothing blocked, plus trigger damage.
          let thisTurn = 0;
          const atkFrame = frames.find(f => f.attackers.length > 0);
          if (atkFrame) {
            totalTurnsAttacked++;
            thisTurn += atkFrame.attackers.reduce((n, id) => {
              const p = atkFrame.opponent.battlefield.find(b => b.instanceId === id);
              return n + (p ? botPower(p, atkFrame.opponent.battlefield, atkFrame.opponent.graveyard) : 0);
            }, 0);
          }
          thisTurn += frames.reduce((n, f) => n + (f.selfDamage ?? 0), 0);
          // A combo that says "you lose" is a kill regardless of the number.
          const lethal = frames.some(f => f.effects.some(e => e.lethal));
          // Tracked separately from the kill turn, because a combo deck spends
          // its mana interacting with a goldfish whose board regrows every turn
          // — so its cumulative-damage kill turn understates it badly, and the
          // bracket line derived from that reads a turn-four deck as a slow one.
          if (comboTurn === null && frames.some(f => f.logs.some(l => / goes off: /.test(l)))) {
            comboTurn = turn;
          }
          thisTurn += frames.reduce((n, f) => n + f.effects.reduce((m, e) => m + e.lifeLoss, 0), 0);
          totalDamage += thisTurn;
          cumulative += thisTurn;
          if (killTurn === null && (lethal || cumulative >= 40)) killTurn = turn;

          boardAt[turn] += opp.battlefield.length;
          handAt[turn] += opp.hand.length;
          landsAt[turn] += opp.battlefield.filter(p => isLand(p.card)).length;
          tokensAt[turn] += opp.battlefield.filter(p =>
            p.card.type_line.toLowerCase().includes('token')).length;
        }

        if (killTurn !== null) killTurns.push(killTurn);
        if (comboTurn !== null) comboTurns.push(comboTurn);
        if (opp.commanderCasts > 0) commanderCastGames++;
        // Anything still in hand at the end was never castable.
        for (const c of opp.hand) neverCast.set(c.name, (neverCast.get(c.name) ?? 0) + 1);
        stuckHandTotal += opp.hand.length;
      }

      const avg = (a: number[], t: number) => (a[t] / GAMES).toFixed(1);
      console.log(`\n${'='.repeat(72)}\n${stub.name}  (${stub.commander})  — ${GAMES} games, ${TURNS} turns`);
      console.log(`commander cast in ${commanderCastGames}/${GAMES} games`);
      console.log(`avg unblocked damage per game: ${(totalDamage / GAMES).toFixed(1)}`
        + `   attacked on ${(totalTurnsAttacked / GAMES).toFixed(1)}/${TURNS} turns`);

      // Median rather than mean: one flooded game that never gets there should
      // not drag the figure past the turn limit.
      const sorted = [...killTurns].sort((a, b) => a - b);
      const median = sorted.length ? sorted[Math.floor(sorted.length / 2)] : null;
      const bracketFor = (t: number | null) =>
        t === null ? '1 (never got there)'
        : t <= 4 ? '4+'
        : t <= 6 ? '3'
        : t <= 8 ? '2'
        : '1';
      console.log(
        `kill turn (40 damage): median ${median ?? '—'}`
        + `   fastest ${sorted[0] ?? '—'}   killed in ${killTurns.length}/${GAMES} games`
        + `   → reads as bracket ${bracketFor(median)}`,
      );

      if (comboTurns.length > 0) {
        const cs = [...comboTurns].sort((a, b) => a - b);
        console.log(
          `combo goes off:  median ${cs[Math.floor(cs.length / 2)]}   fastest ${cs[0]}`
          + `   in ${cs.length}/${GAMES} games`,
        );
      }      console.log('turn :  ' + [3, 6, 9, 12].map(t => `T${t}`.padStart(6)).join(''));
      console.log('lands:  ' + [3, 6, 9, 12].map(t => avg(landsAt, t).padStart(6)).join(''));
      console.log('board:  ' + [3, 6, 9, 12].map(t => avg(boardAt, t).padStart(6)).join(''));
      console.log('tokens: ' + [3, 6, 9, 12].map(t => avg(tokensAt, t).padStart(6)).join(''));
      console.log('hand :  ' + [3, 6, 9, 12].map(t => avg(handAt, t).padStart(6)).join(''));
      console.log(`avg cards stuck in hand at turn ${TURNS}: ${(stuckHandTotal / GAMES).toFixed(1)}`);

      const stuck = [...neverCast.entries()]
        .filter(([name]) => !isLand(fx.cards[name] ?? ({} as ScryfallCard)))
        .map(([name, games]) => ({
          name, games,
          seen: drawnEver.get(name) ?? 0,
          known: !!lookupSelfEffect(name),
        }))
        .filter(s => s.games >= Math.ceil(GAMES * 0.4))
        .sort((a, b) => b.games - a.games);
      if (stuck.length) {
        console.log('cards left in hand in 40%+ of games:');
        for (const s of stuck) console.log(`   ${String(s.games).padStart(3)}/${GAMES}  ${s.name}`);
      }
    }
  }, 120_000);
});
