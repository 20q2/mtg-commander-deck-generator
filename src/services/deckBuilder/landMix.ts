import type { NonBasicLandMix, ScryfallCard } from '@/types';
import { isMdfcLand, isChannelLand } from '@/services/scryfall/client';
import { isUtilityLand } from '@/services/tagger/client';
import { omnipresenceColor } from './cutRanking';

/**
 * The player-chosen split of a deck's non-basic lands: how many fix colors, how many are MDFCs
 * (spell lands), how many are utility lands, and how many are other non-fixing lands. Built for
 * players generating many decks from one collection, who don't want every deck to swallow their
 * best lands. Fixing is the flexible group: it takes whatever the other three leave, and any slot
 * the generator can't fill with the asked-for kind falls back to fixing, then to a basic.
 */

export type LandKind = 'fixing' | 'mdfc' | 'utility' | 'other';

export interface ResolvedLandMix extends NonBasicLandMix {
  fixing: number;
}

const BASIC_TYPE_COLOR: Record<string, string> = { plains: 'W', island: 'U', swamp: 'B', mountain: 'R', forest: 'G' };
/** "Search your library for a(n) … land / basic-type card" — a fetch, as opposed to Urza's Saga's artifact tutor. */
const FETCH_TEXT = /search your library for[^.]*\b(land|plains|island|swamp|mountain|forest)\b[^.]*card/;

function oracleOf(card: ScryfallCard): string {
  return card.oracle_text ?? card.card_faces?.map(f => f.oracle_text ?? '').join('\n') ?? '';
}

/** A land that searches the library for a land (fetches, Evolving Wilds, Myriad Landscape). */
export function isFetchLand(card: ScryfallCard): boolean {
  return FETCH_TEXT.test(oracleOf(card).toLowerCase());
}

/** Colors (within the deck's identity) a land-tutoring land can find. "Basic land card" finds any. */
export function fetchedColors(card: ScryfallCard, colorIdentity: string[]): number {
  const text = oracleOf(card).toLowerCase();
  if (!text.includes('search your library for')) return 0;
  if (/basic land card/.test(text)) return colorIdentity.length;
  const found = new Set<string>();
  for (const [type, color] of Object.entries(BASIC_TYPE_COLOR)) {
    if (text.includes(type) && colorIdentity.includes(color)) found.add(color);
  }
  return found.size;
}

/**
 * A land that taps for more than one mana, or for an amount that scales: Ancient Tomb, Cabal
 * Coffers, Gaea's Cradle, Nykthos, the Tron lands, Eldrazi Temple. These are utility to the player
 * — the lands a collection builder wants to ration — not plain mana alongside a fetch. Reads every
 * "add" clause, so Urza's Tower's "…add {C}{C}{C} instead" counts.
 */
function makesBigMana(card: ScryfallCard): boolean {
  for (const [, part] of oracleOf(card).toLowerCase().matchAll(/add ([^.]*)/g)) {
    if (/(\{[wubrgc]\}){2,}/.test(part)) return true;
    if (/for each|equal to|\{x\}|amount of/.test(part)) return true;
  }
  return false;
}

/**
 * True when every line of rules text is a mana ability, an enters-tapped clause, or reminder
 * text — i.e. the land does nothing besides make mana.
 */
function onlyMakesMana(card: ScryfallCard): boolean {
  const lines = oracleOf(card).toLowerCase().split('\n').map(l => l.trim()).filter(Boolean);
  return lines.every(line =>
    /^\(.*\)$/.test(line)
    || /:\s*(choose a color\. )?add\b/.test(line)
    || (line.includes('enters') && line.includes('tapped')),
  );
}

/**
 * Which group a land belongs to. Each land is in exactly one, checked in this order:
 * MDFC, fixing, utility, other. Fixing outranks utility on purpose: a triome that also cycles
 * is a fixing land to the player, and the utility count exists to protect the lands that do
 * something *instead of* fixing.
 */
export function landKind(card: ScryfallCard, colorIdentity: string[]): LandKind {
  if (isMdfcLand(card)) return 'mdfc';
  const multicolor = colorIdentity.length >= 2;
  const colors = new Set((card.produced_mana ?? []).filter(c => colorIdentity.includes(c)));
  if (colors.size >= 2) return 'fixing';
  const fetched = fetchedColors(card, colorIdentity);
  if (multicolor && fetched >= 2) return 'fixing';
  const granted = omnipresenceColor(card.name); // Urborg / Yavimaya fix a deck in their color
  if (multicolor && granted && colorIdentity.includes(granted)) return 'fixing';
  // A fetch that finds only one of your colors (Flooded Strand in Dimir, Evolving Wilds in a
  // mono deck) is just a mana land, not a utility land.
  if (fetched > 0 || isFetchLand(card)) return 'other';
  if (isUtilityLand(card.name) || isChannelLand(card) || makesBigMana(card) || !onlyMakesMana(card)) return 'utility';
  return 'other';
}

/**
 * Fit a stored mix to the current non-basic count. The count moves under the mix (EDHREC
 * suggestions, format changes, the slider), so the split scales with it from the count it was
 * tuned at. The three capped groups round down — a scaled limit never grows past the player's
 * proportion — and fixing takes the rest. Scaling from the tuned count (rather than the last
 * resolved one) means sliding away and back restores the exact split.
 */
export function resolveLandMix(mix: NonBasicLandMix, total: number): ResolvedLandMix {
  const t = Math.max(0, total);
  const scale = mix.total && mix.total > 0 && mix.total !== t ? t / mix.total : 1;
  const out = {
    mdfc: Math.max(0, Math.floor(mix.mdfc * scale)),
    utility: Math.max(0, Math.floor(mix.utility * scale)),
    other: Math.max(0, Math.floor(mix.other * scale)),
  };
  let over = out.mdfc + out.utility + out.other - t;
  for (const k of ['other', 'mdfc', 'utility'] as const) {
    if (over <= 0) break;
    const cut = Math.min(out[k], over);
    out[k] -= cut;
    over -= cut;
  }
  return { ...out, fixing: t - out.mdfc - out.utility - out.other };
}

/** A starting split when the player first opens the control. Mono-color decks can't use
 *  fixing lands, so their spare slots start in "other" instead. */
export function defaultLandMix(total: number, colorCount: number): NonBasicLandMix {
  const utility = Math.min(3, total);
  const mdfc = Math.min(2, Math.max(0, total - utility));
  const other = colorCount >= 2 ? Math.min(1, Math.max(0, total - utility - mdfc)) : Math.max(0, total - utility - mdfc);
  return { mdfc, utility, other, total };
}

/**
 * The group that takes whatever the capped groups leave. Fixing in a multicolor deck; in a mono
 * deck nothing fixes, so fetch & plain lands take that role and the split hides Fixing.
 */
export function flexKind(colorIdentity: string[]): LandKind {
  return colorIdentity.length >= 2 ? 'fixing' : 'other';
}

/**
 * The generator's running tally for one mana base. `want` is what the fill aims for in the slots
 * it is filling (the player's mix minus must-include lands already counted against it). The
 * groups other than `flex` are ceilings for the whole fill; `flex` is not capped.
 */
export class LandMixPlan {
  readonly want: Record<LandKind, number>;
  readonly flex: LandKind;
  private taken: Record<LandKind, number> = { fixing: 0, mdfc: 0, utility: 0, other: 0 };

  constructor(mix: NonBasicLandMix, nonBasicTotal: number, slots: number, committed: ScryfallCard[], private colorIdentity: string[]) {
    this.flex = flexKind(colorIdentity);
    const resolved = resolveLandMix(mix, nonBasicTotal);
    const committedBy: Record<LandKind, number> = { fixing: 0, mdfc: 0, utility: 0, other: 0 };
    for (const card of committed) committedBy[this.kindOf(card)]++;
    const fit = resolveLandMix({
      mdfc: Math.max(0, resolved.mdfc - committedBy.mdfc),
      utility: Math.max(0, resolved.utility - committedBy.utility),
      other: Math.max(0, resolved.other - committedBy.other),
    }, slots);
    this.want = { fixing: fit.fixing, mdfc: fit.mdfc, utility: fit.utility, other: fit.other };
    if (this.flex === 'other') {
      // Mono: the slots a multicolor split would give fixing go to fetch & plain lands instead.
      this.want.other += this.want.fixing;
      this.want.fixing = 0;
    }
  }

  kindOf(card: ScryfallCard): LandKind {
    return landKind(card, this.colorIdentity);
  }

  unmet(kind: LandKind): number {
    return Math.max(0, this.want[kind] - this.taken[kind]);
  }

  record(cards: ScryfallCard[]): void {
    for (const card of cards) this.taken[this.kindOf(card)]++;
  }

  /** Count the card if the mix has room for it. Use as the last check before keeping a land. */
  tryTake(card: ScryfallCard): boolean {
    const kind = this.kindOf(card);
    if (kind !== this.flex && this.taken[kind] >= this.want[kind]) return false;
    this.taken[kind]++;
    return true;
  }
}
