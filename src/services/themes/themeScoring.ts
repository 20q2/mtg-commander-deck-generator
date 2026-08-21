import type { ScryfallCard } from '@/types';
import { testMembership, type ThemeModel, type MembershipResult } from './membership';
import { cardSearchText } from './themeKind';
import type { ThemeGate } from './gates';
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
   * A hard requirement the deck doesn't meet, so the theme may not be DECLARED — but it is still
   * scored and still visible, because the data is genuinely informative. An all-creature deck really
   * does satisfy Umori's restriction; it just isn't an Umori deck without Umori. A sacrifice deck
   * really does look like a pod deck; it just isn't one without a pod effect.
   */
  gateMissing?: ThemeGate;
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
  // 400x difference on the hot path. Cached over ALL cards, not just non-lands: membership still
  // only reads the non-land entries, but the tag gate below has to see the whole deck.
  const tagCache = new Map<ScryfallCard, readonly string[]>();
  for (const c of cards) tagCache.set(c, tagsFor(c));

  // Gate evidence, both checked against the FULL list — a requirement can be met by a land, and
  // "is it in the deck" was never a question about the playable subset. Front-face names count too,
  // so a DFC written either way still satisfies a card gate.
  const present = new Set<string>();
  for (const c of cards) {
    present.add(c.name.toLowerCase());
    if (c.name.includes(' // ')) present.add(c.name.split(' // ')[0].toLowerCase());
  }
  const tagsPresent = new Set<string>();
  for (const c of cards) for (const t of tagCache.get(c) ?? []) tagsPresent.add(t);

  // Word gates ask "does ANY card mention this", so one blob for the whole deck answers it. Tested
  // once per distinct word rather than once per theme — only a handful of themes carry a word gate,
  // but the deck text is large enough that repeating the scan 400 times would be silly.
  const deckText = cards.map(cardSearchText).join('\n');
  const wordPresent = new Map<string, boolean>();
  for (const m of models) {
    if (!m.requiredWord || wordPresent.has(m.requiredWord)) continue;
    // Prefix-anchored, unterminated: "saproling" must start a word (so Octopus can't satisfy
    // "opus") but may continue into "saprolings".
    const re = new RegExp(`\\b${m.requiredWord.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'i');
    wordPresent.set(m.requiredWord, re.test(deckText));
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
    let gateMissing: ThemeGate | undefined;
    if (model.anchor && !present.has(model.anchor.toLowerCase())) {
      gateMissing = { kind: 'card', subject: model.anchor };
    } else if (model.requiredTag && !tagsPresent.has(model.requiredTag)) {
      gateMissing = { kind: 'tag', subject: model.requiredTag };
    } else if (model.requiredWord && !wordPresent.get(model.requiredWord)) {
      gateMissing = { kind: 'text', subject: model.requiredWord };
    }

    scored.push({
      model, memberCards, members, ratio, observedOverExpected, prior,
      rawMembershipScore,
      membershipScore: rawMembershipScore * prior,
      confidence: 0, passedFloor, gateMissing, onCommanderList,
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
  // Evidence outranks score when deciding who absorbs whom. A theme testing the cards themselves
  // knows its members; one matching inferred tags is guessing, however high it scored. On an Ezuri
  // deck "Energy" claimed 19 cards through the generic counter vocabulary (counters-matter,
  // counter-fuel, remove-counters — tags that also cover loyalty and charge counters, so +1/+1
  // Counters can't claim them), outscored +1/+1 Counters by one point, and absorbed 19 of its 23
  // literal members. The deck then reported Energy and never mentioned counters at all.
  const order = [...scored].sort((a, b) => {
    const lit = (s: ThemeScore) => (s.memberCards.some(m => m.basis === 'literal') ? 1 : 0);
    return lit(b) - lit(a) || b.membershipScore - a.membershipScore;
  });
  for (const s of order) {
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
 * Confidence that this theme is PRESENT in the deck, 0-100.
 *
 * Present, not winning. The first version multiplied in a separation term — the gap to the top
 * surviving theme — and that made the number answer the wrong question. On an Ezuri counters deck it
 * reported +1/+1 Counters at 21% and X Spells at 75%, even though +1/+1 Counters had 23 members
 * whose own text says "+1/+1 counter" (evidence 1.00) and X Spells had 19 members resting entirely
 * on inferred tags (evidence 0.75). The runner-up was floored at 0.3 for not leading, and that
 * penalty swamped the whole evidence range. A deck 68% composed of counter cards IS a counters deck
 * regardless of what outranks it, so ranking is left to the score, where it belongs.
 *
 * What remains is evidence about this theme alone, and the terms MULTIPLY so a theme can't be
 * confident on one strength while failing another — enormous lift across four cards is still a guess:
 *
 *  - **Lift.** How surprising the concentration is against the theme's base rate.
 *  - **Coverage.** A theme explaining 40% of the deck is a stronger claim than one explaining 12% at
 *    identical lift. Full credit at COVERAGE_FULL.
 *  - **Evidence quality.** A literal card-attribute match ("this card says Elf") is near-certain,
 *    while a tag match is inferred from aggregate co-occurrence and can be wrong. A theme resting
 *    entirely on tags is capped at TAG_ONLY_CEILING.
 *
 * Undeclarable themes still get a real number rather than a suppressed one. A gated theme's evidence
 * is exactly as good as it was; what it lacks is permission, and `gateMissing` already says so.
 * Zeroing the confidence too would hide the informative half of "this looks like a pod deck but has
 * no pod".
 *
 * Deliberately not tunable: this is a reporting figure for a human reader, and a confidence you can
 * dial is not a confidence.
 */
const COVERAGE_FULL = 0.4;
const LIFT_FULL = 8;
const TAG_ONLY_CEILING = 0.75;

export function assignConfidence(scored: ThemeScore[]): void {
  for (const s of scored) {
    if (s.members === 0) { s.confidence = 0; continue; }

    const liftTerm = Math.min(s.observedOverExpected / LIFT_FULL, 1);
    const coverageTerm = Math.min(s.ratio / COVERAGE_FULL, 1);

    const literalCount = s.memberCards.filter(m => m.basis === 'literal').length;
    const evidence = TAG_ONLY_CEILING + (1 - TAG_ONLY_CEILING) * (literalCount / s.members);

    s.confidence = Math.round(liftTerm * coverageTerm * evidence * 100);
  }
}

/**
 * Themes that survived every guard, best first — what detection and the shortlist actually use.
 *
 * Anchor-missing themes are excluded here and only here: they keep their score and stay in the full
 * `scored` list for inspection, they just can't be declared as the deck's theme.
 */
export function survivingThemes(scored: ThemeScore[]): ThemeScore[] {
  return scored.filter(s => s.passedFloor && !s.suppressedBy && !s.gateMissing);
}
