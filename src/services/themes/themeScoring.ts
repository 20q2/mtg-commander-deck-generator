import type { ScryfallCard } from '@/types';
import { testMembership, type ThemeModel, type MembershipResult } from './membership';
import { cardSearchText } from './themeKind';
import type { ThemeGate } from './gates';
import { DEFAULT_TUNING, popularityPrior, type ThemeTuning } from './tuning';

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
/** Coverage that counts as "explains the whole deck", shared by the score and the confidence. */
const COVERAGE_FULL = 0.4;

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
  /** Format staples to treat as neutral. See ThemeCharTagTable.staples. */
  staples?: ReadonlySet<string>,
  /**
   * The deck's commander, if known. Weighted far above the other 99 cards — see COMMANDER_WEIGHT.
   * Must also appear in `cards`; this only marks which one it is.
   */
  commander?: ScryfallCard | null,
): ThemeScore[] {
  const nonLand = cards.filter(c => !isLand(c));
  const denom = nonLand.length || 1;

  // Format staples carry no STATISTICAL theme information — that is exactly why the build script
  // excludes them when mining definitions — but they were still allowed to be evidence at scoring
  // time. A deck of nothing but staples scored Tron at 61% confidence, Tron's definition
  // (synergy-colorless, refund, untaps-self) being a fair description of every mana rock printed.
  //
  // Suppressed for TAG membership only, not literal. Sol Ring genuinely is an Artifact and Skullclamp
  // genuinely is Equipment; a card-attribute test is true regardless of how many theme pages the card
  // appears on. Excluding staples from literal tests too was measured and cost 2.2 points of
  // deterministic top-1 for no extra precision.
  const isStaple = staples?.size
    ? (c: ScryfallCard) => staples.has(c.name) || staples.has(c.name.split(' // ')[0])
    : () => false;

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

  // Word gates count CARDS, not occurrences — "three cards mention dredge" is the claim, and one
  // card saying it twice isn't three. Counted once per distinct word rather than once per theme.
  const texts = cards.map(cardSearchText);
  const wordCount = new Map<string, number>();
  for (const m of models) {
    if (!m.requiredWord || wordCount.has(m.requiredWord.word)) continue;
    // Whole word, optional plural. Both ends anchored so "opus" can't be satisfied by Octopus and
    // "dredge" can't be satisfied by Canal Dredger; the `s?` still lets "saprolings" match.
    const re = new RegExp(`\\b${m.requiredWord.word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}s?\\b`, 'i');
    wordCount.set(m.requiredWord.word, texts.filter(t => re.test(t)).length);
  }

  const scored: ThemeScore[] = [];
  for (const model of models) {
    const memberCards: ThemeMemberCard[] = [];
    const tagBased = model.kind.kind === 'archetype';
    for (const card of nonLand) {
      if (tagBased && isStaple(card)) continue;
      const r = testMembership(model, card, tagCache.get(card) ?? []);
      if (r.member) memberCards.push({ name: card.name, basis: r.basis, matched: r.matched });
    }
    const members = memberCards.length;

    // THE COMMANDER IS NOT ONE CARD IN NINETY-NINE. It is the one card always available, and in this
    // format the deck is built around it — a Krenko deck is a Goblins deck because of Krenko, not
    // because of the eighteenth goblin. Treating it as an ordinary member is why commander-driven
    // themes could never clear the floor: Experience Counters lives in the command zone and the 99
    // may contain nothing that says "experience" at all.
    //
    // Implemented as extra weight on the ratio rather than as a separate signal, so it reaches the
    // floor, the lift, the coverage term and the score together instead of needing four hooks.
    const commanderMatches = commander != null
      && memberCards.some(m => m.name === commander.name);
    const effective = members + (commanderMatches ? tuning.commanderWeight - 1 : 0);
    const ratio = effective / denom;

    const expected = Math.max(model.baseRate, tuning.expectedRateFloor);
    const observedOverExpected = Math.min(ratio / expected, tuning.maxLift);

    // TRUE concentration, used for the floor decision ONLY — never for ranking.
    //
    // One number was doing two jobs. Ranking needs the clamped value: it keeps themes comparable, and
    // unclamping it let narrow literal themes run away with the board (landfall beat 7 rivals,
    // proliferate 8, constructs 11, and counterType top-1 accuracy collapsed from 67% to 17%). But
    // the floor decision needs the opposite — the clamp flattens Dredge (0.042% of the pool), Storm,
    // Infect and Prowess to the same 4.3x as noise, which is why 55% of mechanic themes could never
    // be declared on their own cards. So: clamped to rank, unclamped to qualify.
    const rarityLift = model.baseRate > 0
      ? Math.min(ratio / model.baseRate, tuning.maxLift)
      : observedOverExpected;

    // Two independent priors, multiplied. The list prior asks "does EDHREC associate this theme with
    // THIS commander"; the popularity prior asks "is this a theme people actually build". A rare tag
    // sitting on the commander's page used to get a free 1.0 from the first while the second didn't
    // exist — which is how Blue Moon (484 decks in the format) beat Spellslinger (87,716).
    const onCommanderList = commanderThemeSlugs.has(model.slug);
    const listPrior = onCommanderList ? tuning.commanderListPrior : tuning.offListPrior;
    const prior = listPrior * popularityPrior(
      model.numDecks, tuning.popularityFloor, tuning.popularityFullAt,
    );

    // Lift alone decided the ranking, which means coverage — how much of the deck a theme actually
    // explains — had no vote. Two themes at identical lift rank identically whether one accounts for
    // 60% of the deck or 15% of it, and "the deck's theme" is exactly a claim about how much it
    // explains. Blended geometrically so a theme needs both; coverageWeight 0 reproduces the old
    // lift-only behaviour exactly.
    const coverageFactor = Math.min(ratio / COVERAGE_FULL, 1);
    const rawMembershipScore = (observedOverExpected / tuning.maxLift) * 100
      * (tuning.coverageWeight > 0
        ? Math.pow(Math.max(coverageFactor, 1e-6), tuning.coverageWeight)
        : 1);
    // Two ways through. The main floor is calibrated for themes that span a deck; the second exists
    // because a real Storm deck runs three Storm cards, since that is all that exist. Restricted to
    // literal evidence — the card itself says "Dredge 3", which tag co-occurrence can't match for
    // reliability, and a handful of tag hits is precisely what noise looks like.
    const hasLiteral = memberCards.some(m => m.basis === 'literal');
    const passedFloor =
      (members >= tuning.minMembers && ratio >= tuning.minRatio)
      || (hasLiteral
          && members >= tuning.rareMinMembers
          && rarityLift >= tuning.rareMinLift);

    // Scored normally either way — only declaration is gated.
    let gateMissing: ThemeGate | undefined;
    if (model.anchor && !present.has(model.anchor.toLowerCase())) {
      gateMissing = { kind: 'card', subject: model.anchor };
    } else if (model.requiredTag && !tagsPresent.has(model.requiredTag)) {
      gateMissing = { kind: 'tag', subject: model.requiredTag };
    } else if (model.requiredWord) {
      const have = wordCount.get(model.requiredWord.word) ?? 0;
      if (have < model.requiredWord.min) {
        gateMissing = { kind: 'text', subject: model.requiredWord.word, need: model.requiredWord.min, have };
      }
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
/** Share of its members a theme can claim on its own vocabulary before it counts as independent. */
const RIDING_OVERLAP = 0.1;
const STANDS_ALONE = 0.25;

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
    // A theme that cannot be DECLARED must not silence one that can. Gated themes were still being
    // allowed to absorb: on a Titania lands deck, Dredge and Deserts each matched ~20 cards through
    // generic lands vocabulary, failed their own gates, and took Lands Matter down with them — the
    // deck reported Tron. Skipped entirely rather than marked, since `gateMissing` already explains
    // them and the Status column shows the gate in preference to the nesting.
    if (s.gateMissing) continue;
    const names = new Set(s.memberCards.map(m => m.name));
    const absorber = survivors.find(prev => {
      const prevNames = new Set(prev.memberCards.map(m => m.name));
      let shared = 0;
      for (const n of names) if (prevNames.has(n)) shared++;
      return shared / names.size >= ratio;
    });
    if (!absorber) { survivors.push(s); continue; }
    // Score alone picks the wrong survivor among near-duplicates. On a Titania lands deck, Land
    // Destruction (62.7), Lands Matter (62.1) and Land Animation (61.6) share six of eight tags;
    // Land Destruction led by 0.6 and absorbed both — yet exactly ONE of its 21 members matched a
    // tag the others lack, while Lands Matter had ten. It was winning purely on shared vocabulary.
    //
    // Framed as a GUARD, not a comparison. "More distinctive evidence wins" overrides far too often:
    // it handed Wheels to Hippos and Equipment to Stoneblade, because a theme with idiosyncratic junk
    // in its definition always has tags the rival lacks. The real signal on Titania was that Land
    // Destruction had almost NO independent evidence — 1 of 21 — while its rival had half. So the
    // override fires only when the absorber is riding the overlap and the challenger clearly is not.
    const absorberOwn = distinctiveMembers(absorber, s) / absorber.members;
    const challengerOwn = distinctiveMembers(s, absorber) / s.members;
    if (absorberOwn <= RIDING_OVERLAP && challengerOwn >= STANDS_ALONE) {
      absorber.suppressedBy = s.model.name;
      survivors[survivors.indexOf(absorber)] = s;
    } else {
      s.suppressedBy = absorber.model.name;
    }
  }
}

/**
 * How many of this theme's members it can claim on evidence the rival doesn't share.
 *
 * A literal match always counts: the card itself says Elf, which no amount of rival tag overlap
 * explains away. Tag matches count only when at least one matched tag is absent from the rival's
 * definition.
 */
function distinctiveMembers(s: ThemeScore, rival: ThemeScore): number {
  const rivalTags = new Set(rival.model.charTags);
  return s.memberCards.filter(
    m => m.basis === 'literal' || m.matched.some(t => !rivalTags.has(t)),
  ).length;
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

const LIFT_FULL = 8;
const TAG_ONLY_CEILING = 0.75;
/**
 * How much of the confidence is governed by having no equally-good rival. 0 disables it.
 *
 * Swept 0 to 1 against a calibration metric — mean confidence when the top answer is RIGHT minus when
 * it is WRONG, measured over ~400 page decks. It discriminates rather than merely deflating: at 0.75
 * the confidently-wrong answers collapse (Sidisi/Mill 88% -> 57%, Atraxa/Phyrexians 100% -> 71%)
 * while an unambiguous correct answer barely moves (Krenko/Goblins 100% -> 92%, Titania/Lands Matter
 * 75% -> 72%). Gap 25.7 -> 27.6.
 *
 * 1.0 widens the gap slightly further but drags mean confidence on correct answers to 63%, which
 * under-sells answers that are right. 0.75 keeps a clear winner reading as a clear winner.
 */
const AMBIGUITY_WEIGHT = 0.75;

export function assignConfidence(scored: ThemeScore[], ambiguityWeight = AMBIGUITY_WEIGHT): void {
  const surviving = scored.filter(s => s.passedFloor && !s.suppressedBy && !s.gateMissing);
  const leader = surviving[0];

  for (const s of scored) {
    if (s.members === 0) { s.confidence = 0; continue; }

    const liftTerm = Math.min(s.observedOverExpected / LIFT_FULL, 1);
    const coverageTerm = Math.min(s.ratio / COVERAGE_FULL, 1);

    const literalCount = s.memberCards.filter(m => m.basis === 'literal').length;
    const evidence = TAG_ONLY_CEILING + (1 - TAG_ONLY_CEILING) * (literalCount / s.members);

    // AMBIGUITY. The evidence terms above ask "is this theme here", and they were the whole answer —
    // so a deck two themes explain equally well reported both of them as certain. Sidisi read Mill at
    // 88% and Atraxa read Phyrexians at 100%, with the right answer sitting just behind at a similar
    // score. Confidently wrong is the worst failure mode a number like this has.
    //
    // Expressed as a SHARE of the explanation, which is symmetric: two tied themes each take about
    // half, and both correctly read as uncertain. This is not the separation term removed earlier —
    // that one floored any non-leader at 0.3 purely for not winning, which inverted the reading and
    // punished the theme with better evidence. Share punishes nobody; it just declines to call a tie a
    // certainty.
    const rival = surviving.find(o => o !== s) ?? (leader !== s ? leader : undefined);
    const rivalScore = rival?.membershipScore ?? 0;
    const total = s.membershipScore + rivalScore;
    const share = total > 0 ? s.membershipScore / total : 1;
    const ambiguity = (1 - ambiguityWeight) + ambiguityWeight * share;

    s.confidence = Math.round(liftTerm * coverageTerm * evidence * ambiguity * 100);
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
