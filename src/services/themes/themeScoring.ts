import type { ScryfallCard } from '@/types';
import { getFrontFaceTypeLine } from '@/services/scryfall/client';
import { testMembership, type ThemeModel, type MembershipResult } from './membership';
import { DEFAULT_TUNING, type ThemeTuning } from './tuning';

/** One card's membership in one theme, kept so the debug page can show the evidence. */
export interface ThemeMemberCard {
  name: string;
  basis: MembershipResult['basis'];
  matched: string[];
}

/** Everything Phase A knows about one theme, with each term kept separate for inspection. */
export interface ThemeScore {
  model: ThemeModel;
  /** Cards in the deck belonging to this theme. */
  memberCards: ThemeMemberCard[];
  members: number;
  /** members / non-land card count. */
  ratio: number;
  /** ratio ÷ base rate, floored and capped — "how surprising is this concentration". */
  observedOverExpected: number;
  /** Prior applied for being on (or off) the commander's own EDHREC theme list. */
  prior: number;
  /** 0-100, before the prior. */
  rawMembershipScore: number;
  /** 0-100, after the prior. This is what Phase A ranks on. */
  membershipScore: number;
  passedFloor: boolean;
  /** Set when nesting suppression dropped this theme, naming the theme that absorbed it. */
  suppressedBy?: string;
  onCommanderList: boolean;
}

function isLand(card: ScryfallCard): boolean {
  return getFrontFaceTypeLine(card).toLowerCase().includes('land');
}

/**
 * Score every theme against a deck, using only local data — no network. This is Phase A: it runs
 * over the whole ~400-tag taxonomy because the membership test needs no EDHREC page, which is
 * exactly what lets a deck's real theme be found even when the commander's page never lists it.
 *
 * Cheap enough to re-run on every keystroke in `/theme-lab`'s tuning panel, which is the point.
 *
 * @param tagsFor oracle tag slugs for a card. Returns empty when SpellChroma's index isn't loaded;
 *                archetype themes then find no members and deterministic ones are unaffected.
 * @param commanderThemeSlugs slugs EDHREC lists on the commander's own page — the prior.
 */
export function scoreThemesForDeck(
  cards: ScryfallCard[],
  models: ThemeModel[],
  tagsFor: (card: ScryfallCard) => readonly string[],
  commanderThemeSlugs: ReadonlySet<string>,
  tuning: ThemeTuning = DEFAULT_TUNING,
): ThemeScore[] {
  const nonLand = cards.filter(c => !isLand(c));
  const denom = nonLand.length || 1;

  // Tags resolved once per card rather than once per (card, theme) — 400 themes makes that a
  // 400x difference on the hot path.
  const tagCache = new Map<ScryfallCard, readonly string[]>();
  for (const c of nonLand) tagCache.set(c, tagsFor(c));

  const scored: ThemeScore[] = [];
  for (const model of models) {
    const memberCards: ThemeMemberCard[] = [];
    for (const card of nonLand) {
      const r = testMembership(model, card, tagCache.get(card) ?? []);
      if (r.member) memberCards.push({ name: card.name, basis: r.basis, matched: r.matched });
    }
    const members = memberCards.length;
    const ratio = members / denom;

    const expected = Math.max(model.baseRate, tuning.expectedRateFloor);
    const observedOverExpected = Math.min(ratio / expected, tuning.maxLift);

    const onCommanderList = commanderThemeSlugs.has(model.slug);
    const prior = onCommanderList ? tuning.commanderListPrior : tuning.offListPrior;

    const rawMembershipScore = (observedOverExpected / tuning.maxLift) * 100;
    const passedFloor = members >= tuning.minMembers && ratio >= tuning.minRatio;

    scored.push({
      model, memberCards, members, ratio, observedOverExpected, prior,
      rawMembershipScore,
      membershipScore: rawMembershipScore * prior,
      passedFloor, onCommanderList,
    });
  }

  scored.sort((a, b) => b.membershipScore - a.membershipScore);
  suppressNested(scored, tuning.nestSuppressRatio);
  return scored;
}

/**
 * Drop a theme whose members are mostly already claimed by a stronger one. Without this, an Elf
 * Druid deck reports both "Elves" and "Druids", and "Humans" rides along on nearly every creature
 * deck in the format because Human is Magic's most-printed creature type.
 *
 * Mutates in place, setting `suppressedBy`. Only themes that cleared the floor can absorb others —
 * a theme too thin to be reported shouldn't be able to silence a rival.
 */
function suppressNested(scored: ThemeScore[], ratio: number): void {
  const survivors: ThemeScore[] = [];
  for (const s of scored) {
    if (!s.passedFloor || s.members === 0) continue;
    const names = new Set(s.memberCards.map(m => m.name));
    const absorber = survivors.find(prev => {
      const prevNames = new Set(prev.memberCards.map(m => m.name));
      let shared = 0;
      for (const n of names) if (prevNames.has(n)) shared++;
      return shared / names.size >= ratio;
    });
    if (absorber) s.suppressedBy = absorber.model.name;
    else survivors.push(s);
  }
}

/** Themes that survived every guard, best first — what detection and the shortlist actually use. */
export function survivingThemes(scored: ThemeScore[]): ThemeScore[] {
  return scored.filter(s => s.passedFloor && !s.suppressedBy);
}
