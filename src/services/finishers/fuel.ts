/**
 * Stage 2 — what the deck brings to the table.
 *
 * All of this is computed from card data we already hold, which is what makes the lab a live
 * instrument: none of it needs a deploy to change. Two notes:
 *
 *  - Scryfall has NO token oracle tag. Verified: token, token-maker, creature-token, makes-tokens
 *    and mass-token all return nothing. Since token count is the entire question for alpha-strike,
 *    oracle-text derivation is mandatory rather than a shortcut.
 *  - Devotion is computed exactly from mana costs, which beats anything a tag could give us.
 */

import { getOracleText, isAnyLand, getFrontFaceTypeLine } from '@/services/scryfall/client';
import { cardMatchesRole, hasTag } from '@/services/tagger/client';
import type { ScryfallCard, DeckFuel, DetectedCombo } from '@/types';
import type { TagMembership } from './labTags';
import { comboFuel } from './combos';

const COLORS = ['W', 'U', 'B', 'R', 'G'] as const;

/**
 * Cards that MAKE creature tokens — the fuel for alpha-strike.
 *
 * Two traps here, both found by running real precons rather than a hand-built list. The naive
 * `/creates? .*token/i` reported 31 token makers in an 85-card Bloomburrow deck:
 *
 *  - `.*` spans the entire oracle text, so any card mentioning "create" and "token" anywhere
 *    matched — including payoffs whose text is "whenever you create a token".
 *  - Treasure, Clue, Food, Blood and Map tokens are not attackers. Requiring the literal
 *    "creature token" is what keeps Academy Manufactor and Deadly Dispute out of the body count.
 *
 * The bounded gap handles the first, the "creature token" literal the second. `created` is
 * included because doublers phrase it passively — Chatterfang is "those tokens are created plus
 * that many ... creature tokens", and a doubler genuinely does add bodies.
 *
 * Residual known false positive: a payoff reading "whenever you create a creature token".
 */
const TOKEN_MAKER = /creat(?:e|es|ed) [^.]{0,80}?creature tokens?/i;

/**
 * Cards that empty YOUR library — the evidence Thassa's Oracle and Laboratory Maniac need.
 *
 * The self-targeting check is the whole difficulty: "target opponent mills ten cards" is the
 * opposite of this, and plain /mill/ matches it. Exile-your-library effects (Demonic Consultation,
 * Tainted Pact) count too — they are the standard way the Oracle line actually happens.
 */
const SELF_MILL = /you mill \d+|mill(?:s)? \d+ cards?(?![^.]{0,30}(?:opponent|each player))|put the top [^.]{0,40} of your library into your graveyard|exile(?:s)? [^.]{0,30}your library/i;
const TARGETS_OPPONENT = /target (?:opponent|player)|each opponent/i;

/** Treasure production — Revel in Riches' evidence. */
const TREASURE_MAKER = /creat(?:e|es) [^.]{0,40}Treasure token/i;

/** How much evidence each enabler needs before an alternate win reads as a real plan. */
const SELF_MILL_CARDS = 3;
const LIFEGAIN_CARDS = 8;
const TREASURE_CARDS = 5;
const GATE_LANDS = 8;

/** Permanent types that contribute to devotion. */
function isPermanent(typeLine: string): boolean {
  return /Creature|Artifact|Enchantment|Planeswalker|Battle/i.test(typeLine);
}

export function measureFuel(
  cards: ScryfallCard[],
  tags: TagMembership,
  /** Complete combos in the deck. Their results become unbounded fuel — see combos.ts. */
  combos: DetectedCombo[] = [],
): DeckFuel {
  const devotion: Record<string, number> = { W: 0, U: 0, B: 0, R: 0, G: 0 };
  let landCount = 0, creatureCount = 0, tokenMakers = 0, swampCount = 0;
  let rampCount = 0, hasteGranters = 0, trampleGranters = 0, anthems = 0, evasionGranters = 0;
  let powerSum = 0, powerCount = 0;
  let selfMillCards = 0, lifegainCards = 0, treasureMakers = 0, gateCount = 0;
  const identity = new Set<string>();

  for (const card of cards) {
    const typeLine = getFrontFaceTypeLine(card);
    const text = getOracleText(card);
    const name = card.name;

    for (const c of card.color_identity ?? []) identity.add(c);

    if (isAnyLand(card)) {
      landCount++;
      if (/Swamp/i.test(typeLine)) swampCount++;
      if (/Gate/i.test(typeLine)) gateCount++;
      continue;
    }

    if (SELF_MILL.test(text) && !TARGETS_OPPONENT.test(text)) selfMillCards++;
    if (TREASURE_MAKER.test(text)) treasureMakers++;
    // `lifegain` is a raw tagger tag, not one of the five RoleKeys — hasTag, not cardMatchesRole.
    if (hasTag(name, 'lifegain')) lifegainCards++;

    if (/Creature/i.test(typeLine)) {
      creatureCount++;
      const p = parseInt(card.power ?? '', 10);
      if (!isNaN(p)) { powerSum += p; powerCount++; }
    }

    // No Scryfall tag for this — oracle text is the only source.
    if (TOKEN_MAKER.test(text)) tokenMakers++;

    if (isPermanent(typeLine)) {
      for (const m of (card.mana_cost ?? '').matchAll(/\{([^}]+)\}/g)) {
        const sym = m[1].toUpperCase();
        for (const c of COLORS) if (sym.includes(c)) devotion[c]++;
      }
    }

    // Ramp comes from the tagger artifact we already ship, NOT from a live Scryfall sweep.
    // `otag:ramp` alone is 2403 cards and was the single reliable source of 429s; the S3 file
    // already carries ramp / cost-reducer / mana-dork / mana-rock, and cardMatchesRole subsumes
    // all four. One cached fetch instead of twenty paginated ones.
    if (cardMatchesRole(name, 'ramp')) rampCount++;
    if (tags.has('gives-haste', name)) hasteGranters++;
    if (tags.has('gives-trample', name)) trampleGranters++;
    if (tags.has('anthem', name)) anthems++;
    if (tags.has('unblockable', name)) evasionGranters++;
  }

  return {
    totalCards: cards.length,
    nonLandCount: cards.length - landCount,
    landCount,
    creatureCount,
    avgPower: powerCount > 0 ? powerSum / powerCount : 0,
    tokenMakers,
    devotion,
    swampCount,
    rampCount,
    // Off by default — see FUEL_TAGS. `null` keeps "not measured" distinct from "none found".
    hasteGranters: tags.loaded('gives-haste') ? hasteGranters : null,
    trampleGranters: tags.loaded('gives-trample') ? trampleGranters : null,
    anthems: tags.loaded('anthem') ? anthems : null,
    evasionGranters: tags.loaded('unblockable') ? evasionGranters : null,
    enablers: {
      'self-mill': selfMillCards >= SELF_MILL_CARDS,
      'big-lifegain': lifegainCards >= LIFEGAIN_CARDS,
      treasures: treasureMakers >= TREASURE_CARDS,
      'five-colors': identity.size === 5,
      gates: gateCount >= GATE_LANDS,
      // Never satisfiable by construction — the cards that need it can't be checked at all.
      unverifiable: false,
    },
    ...comboFuel(combos),
  };
}
