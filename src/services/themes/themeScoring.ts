import type { ScryfallCard } from '@/types';
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
  /** 0-100 for a human reader: lift x coverage x separation x evidence quality. */
  confidence: number;
  passedFloor: boolean;
  /** Set when nesting suppression dropped this theme, naming the theme that absorbed it. */
  suppressedBy?: string;
  /**
   * The theme requires a specific card the deck doesn't have, so it may not be DECLARED — but it is
   * still scored and still visible, because the data is genuinely informative. An all-creature deck
   * really does satisfy Umori's restriction; it just isn't an Umori deck without Umori.
   */
  anchorMissing?: string;
  onCommanderList: boolean;
}

/**
 * Front-face card types only — the words before the em-dash, first face. Deliberately not importing
 * scryfall/client's helper: that module is browser-coupled (import.meta.env), and keeping this file
 * dependency-free is what lets the same scoring run under Node in the build script and in tests.
 */
function isLand(card: ScryfallCard): boolean {
  const line = card.card_faces?.[0]?.type_line ?? card.type_line ?? '';
  return line.split('—')[0].toLowerCase().includes('land');
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

  // Anchor presence is checked against the FULL list, not just non-lands — and against front-face
  // names too, so a DFC written either way still counts.
  const present = new Set<string>();
  for (const c of cards) {
    present.add(c.name.toLowerCase());
    if (c.name.includes(' // ')) present.add(c.name.split(' // ')[0].toLowerCase());
  }

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

    // Scored normally either way — only declaration is gated.
    const anchorMissing = model.anchor && !present.has(model.anchor.toLowerCase())
      ? model.anchor
      : undefined;

    scored.push({
      model, memberCards, members, ratio, observedOverExpected, prior,
      rawMembershipScore,
      membershipScore: rawMembershipScore * prior,
      confidence: 0, passedFloor, anchorMissing, onCommanderList,
    });
  }

  scored.sort((a, b) => b.membershipScore - a.membershipScore);
  suppressNested(scored, tuning.nestSuppressRatio);
  assignConfidence(scored);
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

/**
 * Confidence that a theme is genuinely THE deck's theme, 0-100.
 *
 * Deliberately not a restatement of the score. The score answers "how concentrated is this theme
 * relative to chance". Confidence answers "how sure should a reader be", which needs two things the
 * score alone can't see:
 *
 *  - **Coverage.** A theme explaining 40% of the deck is a stronger claim than one explaining 12%,
 *    at identical lift. Full credit at COVERAGE_FULL.
 *  - **Separation.** A winner three points clear of the runner-up is a coin flip; forty points clear
 *    is not. Measured against the next SURVIVING theme, since a suppressed sibling isn't a real
 *    rival — it's the same cards under another name.
 *
 * Evidence quality also matters: a literal card-attribute match ("this card says Elf") is
 * near-certain, while a tag match is inferred from aggregate co-occurrence and can be wrong. So a
 * theme resting entirely on tags is capped below one backed by literal matches.
 *
 * The terms MULTIPLY rather than average, so a theme can't be confident on one strength while
 * failing another — enormous lift across four cards is still a guess.
 *
 * Assigned after sorting and suppression so it can see the ranking. Deliberately not tunable: this
 * is a reporting figure for a human reader, and a confidence you can dial is not a confidence.
 */
const COVERAGE_FULL = 0.4;
const SEPARATION_FULL = 25;
const TAG_ONLY_CEILING = 0.75;

export function assignConfidence(scored: ThemeScore[]): void {
  const surviving = scored.filter(s => s.passedFloor && !s.suppressedBy && !s.anchorMissing);
  const leader = surviving[0];
  for (const s of scored) {
    if (s.members === 0) { s.confidence = 0; continue; }

    const liftTerm = Math.min(s.observedOverExpected / 8, 1);
    const coverageTerm = Math.min(s.ratio / COVERAGE_FULL, 1);

    const isSurvivor = s.passedFloor && !s.suppressedBy && !s.anchorMissing;
    let separationTerm: number;
    if (isSurvivor) {
      const rival = surviving.find(o => o !== s);
      const gap = s.membershipScore - (rival?.membershipScore ?? 0);
      // Floor of 0.3 so a clear winner with a close second isn't reported as near-zero.
      separationTerm = Math.min(Math.max(gap, 0) / SEPARATION_FULL, 1) * 0.7 + 0.3;
    } else {
      // Can't be declared at all, so whatever its numbers say, a reader shouldn't act on it.
      separationTerm = leader && leader !== s ? 0.25 : 0.3;
    }

    const literalCount = s.memberCards.filter(m => m.basis === 'literal').length;
    const evidence = TAG_ONLY_CEILING + (1 - TAG_ONLY_CEILING) * (literalCount / s.members);

    s.confidence = Math.round(liftTerm * coverageTerm * separationTerm * evidence * 100);
  }
}

/**
 * Themes that survived every guard, best first — what detection and the shortlist actually use.
 *
 * Anchor-missing themes are excluded here and only here: they keep their score and stay in the full
 * `scored` list for inspection, they just can't be declared as the deck's theme.
 */
export function survivingThemes(scored: ThemeScore[]): ThemeScore[] {
  return scored.filter(s => s.passedFloor && !s.suppressedBy && !s.anchorMissing);
}
