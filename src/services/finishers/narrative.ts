/**
 * The model, said out loud.
 *
 * The kill math produces `0.333` and `deaths = ∞`. That is the right output for a lab and the
 * wrong output for a player, who wants to know how their deck wins. BuiltFromBulk gets this part
 * right — "Toxrill wins through attrition, so an extra card each turn keeps answers flowing" —
 * and it's the one thing they do that we didn't.
 *
 * Every sentence here is DERIVED, not generated. The model already holds each input a sentence
 * needs: which shape, which enabler, which combo supplied the fuel. No LLM, no fabrication, and
 * the prose can never drift from the numbers because it's computed from them.
 */

import type { KillEstimate, DeckFuel, DeckFinisherVerdict, DetectedCombo } from '@/types';
import type { FinisherAssumptions } from './tuning';
import { altWinCondition } from './scalingMap';
import { isWinResult } from './combos';

export interface DeckNarrative {
  /** The line a player reads first. */
  headline: string;
  /** What has to be true for the headline to happen. Null when nothing has to be. */
  condition: string | null;
  /** Honest warnings — the places the model knows it can't see. */
  caveats: string[];
}

/**
 * Plain-language line for one finisher. No fractions, no jargon.
 *
 * `plural` is set when the caller has grouped several cards onto one sentence — three aristocrats
 * drains share a line, and "Blood Artist, Zulaport Cutthroat and Bastion of Remembrance drains"
 * is the kind of thing that makes a product surface look unfinished.
 */
/** "kills 2 of 3 opponents" / "kills the whole table", from a table fraction. */
function killsPhrase(e: KillEstimate, a: FinisherAssumptions): string {
  const killed = Math.round((e.tableFraction ?? 0) * a.opponents);
  if (killed >= a.opponents) return 'kills the whole table';
  return `kills ${killed} of ${a.opponents} opponents`;
}

export function describeEstimate(
  e: KillEstimate, fuel: DeckFuel, a: FinisherAssumptions, plural = false,
): string {
  const inf = (n: number | null) => n !== null && !isFinite(n);
  /** Pick the verb form for however many cards share this sentence. */
  const v = (singular: string, pl: string) => (plural ? pl : singular);

  switch (e.shape) {
    case 'combo': {
      // The raw result list is noisy — "Infinite lifegain triggers, Infinite lifeloss, Infinite
      // lifegain" says one useful thing three times. Keep only the results that actually win.
      const wins = e.workings.split(' · ')[0].split(', ').filter(isWinResult);
      return `${v('wins', 'win')} outright — ${(wins.length ? wins : ['infinite combo']).join(', ').toLowerCase()}`;
    }

    case 'drain-static':
      if (e.kind === 'unknown') return `can't be scored — ${e.workings}`;
      if (inf(e.damage)) return `${v('drains', 'drain')} every opponent out once the sacrifice loop is running`;
      return `${e.damage} life from each opponent`;

    case 'drain-x':
      if (inf(e.damage)) return `with unlimited mana, ${v('drains', 'drain')} the whole table for lethal`;
      return `${e.damage} life from each opponent at your turn-${a.turn} mana`;

    case 'burn-x':
      if (inf(e.damage)) return `with unlimited mana, ${v('kills', 'kill')} any one opponent outright`;
      return `${e.damage} damage, but to a single target only`;

    case 'alpha-strike': {
      if (e.kind === 'unknown') return `can't be scored — ${e.workings}`;
      // An unbounded board isn't "lethal on one opponent" — attackers are declared per defender,
      // so the loop kills the table. Saying otherwise undersells the deck's actual plan.
      if (fuel.infiniteTokens) {
        return `unlimited attackers — lethal across the table once the loop runs`;
      }
      const bodies = `${Math.round(fuel.creatureCount * a.boardFraction + fuel.tokenMakers * a.boardFraction * a.tokensPerMaker)}`;
      // Attackers are assigned per defender, so this is "how many players die", not "one player
      // dies and the rest of the damage evaporates".
      const killed = Math.round((e.tableFraction ?? 0) * a.opponents);
      if (killed >= a.opponents) return `${bodies} attackers — lethal on the whole table`;
      if (killed >= 1) {
        // Leftover damage, not a deficit — it's what the swing had spare after paying for its
        // kills, and it wasn't enough to buy another one.
        const spare = e.overkill > 0 && isFinite(e.overkill)
          ? `, ${e.overkill} left over`
          : '';
        return `${bodies} attackers — kills ${killed} of ${a.opponents} opponents${spare}`;
      }
      return `${bodies} attackers — not yet lethal on its own`;
    }

    case 'alt-win': {
      const condition = altWinCondition(e.cardName) ?? 'its condition is met';
      // UNKNOWN here means the setup isn't there (or can't be seen), so the flat "wins the game
      // outright" claim would be exactly the overclaim the tier exists to prevent.
      if (e.tier === 'UNKNOWN') return `only ${v('wins', 'win')} if ${condition} — ${e.workings.includes('—') ? e.workings.split('— ')[1] : 'unconfirmed'}`;
      return `${v('wins', 'win')} the game outright if ${condition}`;
    }

    case 'extra-combat':
      // Now that this carries a real number, say what the second combat actually buys — and the
      // interesting part is that the extra attackers can be sent at a DIFFERENT player.
      return e.tableFraction !== null
        ? `${v('doubles', 'double')} your attack — ${killsPhrase(e, a)} across two combats`
        : `${v('turns', 'turn')} one attack into two`;
  }
}

/** The single most important finisher, or null when nothing scores. */
function best(estimates: KillEstimate[]): KillEstimate | null {
  const scored = estimates.filter(e => e.tableFraction !== null && isFinite(e.tableFraction));
  if (scored.length === 0) return null;
  return scored.reduce((m, e) => ((e.tableFraction ?? 0) > (m.tableFraction ?? 0) ? e : m));
}

/** What has to be true for a given finisher to actually do its job. */
function conditionFor(e: KillEstimate, fuel: DeckFuel, a: FinisherAssumptions): string | null {
  switch (e.shape) {
    case 'combo': return 'once every piece is assembled';
    case 'drain-static':
      return fuel.infiniteDeaths ? 'once the sacrifice loop is running' : null;
    case 'drain-x':
    case 'burn-x':
      return fuel.infiniteMana ? 'once the mana combo is online' : `once you reach your mana ceiling around turn ${a.turn}`;
    case 'alpha-strike':
      return fuel.infiniteTokens ? 'once the token loop is running' : `with a full board by about turn ${a.turn}`;
    case 'alt-win': {
      const condition = altWinCondition(e.cardName);
      return condition ? `but only ${condition}` : null;
    }
    default: return null;
  }
}

export function describeDeck(
  estimates: KillEstimate[],
  fuel: DeckFuel,
  verdict: DeckFinisherVerdict,
  combos: DetectedCombo[],
  a: FinisherAssumptions,
): DeckNarrative {
  const caveats: string[] = [];

  const unscored = estimates.filter(e => e.kind === 'unknown').length;
  if (unscored > 0) {
    caveats.push(`${unscored} card${unscored > 1 ? "s don't" : " doesn't"} have a modelled scaling variable, so ${unscored > 1 ? 'they were' : 'it was'} left out of the read.`);
  }
  // Setup IS checked now where a decklist can show it. Only flag the ones where it genuinely
  // can't — a blanket "nothing is checked" warning next to a checked result trains you to ignore it.
  const unverifiable = estimates.filter(
    e => e.shape === 'alt-win' && e.workings.includes("can't be checked"),
  ).length;
  if (unverifiable > 0) {
    caveats.push(`${unverifiable} alternate win condition${unverifiable > 1 ? 's need' : ' needs'} setup a decklist can't show, so ${unverifiable > 1 ? 'they were' : 'it was'} left unscored.`);
  }
  // Blockers ARE modelled now, so the honest caveat is about the assumed size of the crews rather
  // than about their absence — and about the things combat math still can't see.
  if (estimates.some(e => e.shape === 'alpha-strike' || e.shape === 'extra-combat')) {
    caveats.push(`Attack math assumes each opponent blocks with ${a.blockersPerOpponent} creatures of ${a.blockerToughness} toughness. Removal, fogs and combat tricks aren't modelled.`);
  }

  const top = best(estimates);
  if (!top) {
    return {
      headline: 'This deck has no way to actually close a game.',
      condition: 'Nothing in it converts a good board into a win.',
      caveats,
    };
  }

  const winningCombo = combos.find(c => c.isComplete)
    && estimates.find(e => e.shape === 'combo');

  // A combo that wins on its own is the deck's plan whether or not it's the "best" row, because
  // it doesn't care about board state — so it leads.
  if (winningCombo && winningCombo.shape === 'combo') {
    return {
      headline: `Wins on the spot with ${winningCombo.cardName}.`,
      condition: 'once every piece is assembled',
      caveats,
    };
  }

  const line = describeEstimate(top, fuel, a);
  const condition = conditionFor(top, fuel, a);

  if (verdict.bestSingle >= 1) {
    return { headline: `Wins with ${top.cardName} — ${line}.`, condition, caveats };
  }
  if (verdict.bestSingle >= 0.6) {
    return { headline: `Closes with ${top.cardName} — ${line}.`, condition, caveats };
  }
  if (verdict.bestSingle >= a.liveThreshold) {
    // "Takes out one opponent" is only true of the single-target shapes. Said about Gray Merchant
    // it inverts the fact that matters most about a drain: it hits the WHOLE table, just not for
    // lethal yet — which is the exact distinction the table-fraction unit exists to preserve.
    const hitsEveryone = top.shape === 'drain-x' || top.shape === 'drain-static';
    return {
      headline: hitsEveryone
        ? `Grinds the table down. ${top.cardName} hits every opponent, but not for lethal.`
        : `Grinds the table down. ${top.cardName} takes out one opponent, not the table.`,
      condition,
      caveats,
    };
  }
  if (verdict.combined >= 0.6) {
    return {
      headline: 'Wins by attrition — no single card ends it, but the damage adds up.',
      condition: 'given enough turns',
      caveats,
    };
  }
  return {
    headline: 'This deck struggles to close.',
    condition: `Its best finisher, ${top.cardName}, doesn't get there on its own.`,
    caveats,
  };
}
