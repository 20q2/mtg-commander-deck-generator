import type { BrewContext, BrewState, BrewQuestion, BrewAnswer } from './brewTypes';

/** Gentle nudge: just over one pick (AFFINITY_PER_PICK = 10), below the leaning threshold (20). */
export const QUESTION_LEAN = 12;
/** Total personality questions a session will ask (opening + occasional). */
export const MAX_QUESTIONS = 2;
/** Skip themes the player has already committed to — mirrors identity.LEANING_THRESHOLD. */
const LEANING_THRESHOLD = 20;
const ANSWERS_PER_QUESTION = 3;

/** Playstyle phrasing for the common archetypes, so answers read as choices, not theme tags. */
const THEME_PLAYSTYLE: Record<string, { label: string; blurb: string }> = {
  tokens: { label: 'Go wide', blurb: 'Flood the board with creature tokens and overrun the table.' },
  counters: { label: 'Go tall', blurb: 'Pile on +1/+1 counters and grow unstoppable threats.' },
  '+1-1-counters': { label: 'Go tall', blurb: 'Pile on +1/+1 counters and grow unstoppable threats.' },
  sacrifice: { label: 'Death & value', blurb: 'Sacrifice your own creatures to drain and grind opponents out.' },
  aristocrats: { label: 'Death & value', blurb: 'Sacrifice your own creatures to drain and grind opponents out.' },
  spellslinger: { label: 'Sling spells', blurb: 'Chain instants and sorceries for explosive, bursty turns.' },
  spells: { label: 'Sling spells', blurb: 'Chain instants and sorceries for explosive, bursty turns.' },
  lifegain: { label: 'Lifegain', blurb: 'Turn gaining life into a relentless winning engine.' },
  blink: { label: 'Blink', blurb: 'Flicker creatures to reuse their enter-the-battlefield tricks.' },
  voltron: { label: 'Suit up', blurb: 'Load one creature with auras and gear, then swing for the win.' },
  auras: { label: 'Suit up', blurb: 'Load one creature with auras and gear, then swing for the win.' },
  equipment: { label: 'Suit up', blurb: 'Load one creature with auras and gear, then swing for the win.' },
  graveyard: { label: 'Graveyard', blurb: 'Cheat huge things back from the graveyard, again and again.' },
  reanimator: { label: 'Graveyard', blurb: 'Cheat huge things back from the graveyard, again and again.' },
  mill: { label: 'Mill', blurb: 'Grind libraries down to nothing.' },
  control: { label: 'Control', blurb: 'Counter and remove until the game is yours to take.' },
  artifacts: { label: 'Artifacts', blurb: 'Build a machine of artifacts that snowballs out of control.' },
  enchantments: { label: 'Enchantress', blurb: 'Stack enchantments that grind out value turn after turn.' },
};

/** Generic personality framings — chosen deterministically so resumes stay stable. */
const PROMPTS = [
  'What’s your path to victory?',
  'What should this deck lean into?',
  'Pick the fantasy you’re chasing.',
];

function answerFor(slug: string, name: string, index: number): BrewAnswer {
  const play = THEME_PLAYSTYLE[slug];
  return {
    id: `q:${slug}:${index}`,
    label: play?.label ?? name,
    blurb: play?.blurb ?? `Lean hard into ${name}.`,
    themeSlugs: [slug],
  };
}

/**
 * A personality question for the current moment, or null when there's nothing useful to ask:
 * cap reached, or fewer than 2 themes the player hasn't already committed to. Pure.
 */
export function nextQuestion(ctx: BrewContext, state: BrewState): BrewQuestion | null {
  if (state.questionsAsked >= MAX_QUESTIONS) return null;
  const candidates = Object.keys(ctx.themeNames)
    .filter(slug => (state.themeAffinity[slug] ?? 0) < LEANING_THRESHOLD);
  if (candidates.length < 2) return null;
  const answers = candidates
    .slice(0, ANSWERS_PER_QUESTION)
    .map((slug, i) => answerFor(slug, ctx.themeNames[slug], i));
  return {
    id: `question:${state.questionsAsked}`,
    prompt: PROMPTS[state.questionsAsked % PROMPTS.length],
    answers,
  };
}

/** Apply a chosen answer (or a skip, `null`): nudge affinity and count the question. Pure. */
export function applyAnswer(state: BrewState, answer: BrewAnswer | null): BrewState {
  const themeAffinity = { ...state.themeAffinity };
  const lean = answer?.lean ?? QUESTION_LEAN;
  for (const slug of answer?.themeSlugs ?? []) {
    themeAffinity[slug] = (themeAffinity[slug] ?? 0) + lean;
  }
  return { ...state, themeAffinity, questionsAsked: state.questionsAsked + 1 };
}

const MIN_INCLUSION = 5;        // avoid total obscurity
const OPENING_COMMIT_LEAN = 24; // > identity.LEANING_THRESHOLD (20): the pick immediately "leans"
const OPENING_MAX = 8;

/** Signature score: inclusion discounted hard by how many themes the card spans, so a card that's
 * distinctive to ONE theme outranks a cross-theme staple (the "standout for that theme") signal. */
function signatureScore(inclusion: number, themeCount: number): number {
  return inclusion / (themeCount * themeCount);
}

/**
 * The opening question, card-based: one signature card per top theme — the most distinctive card
 * that belongs to that theme and few others — so the player sets a direction by picking what pulls
 * them in. Pure. Returns null if fewer than two themes yield a card (caller falls back to text).
 */
export function openingThemeQuestion(ctx: BrewContext): BrewQuestion | null {
  const byName = new Map(ctx.candidates.filter(c => !c.isLand).map(c => [c.name, c] as const));
  const used = new Set<string>();
  const answers: BrewAnswer[] = [];

  for (const slug of Object.keys(ctx.themeNames)) {
    // Prefer the theme's highest-synergy card we can actually offer — the card that DEFINES the
    // theme (vs. staples merely played in it). Fall back to the membership/inclusion heuristic
    // only when no synergy signatures are available (e.g. a theme page that wouldn't load).
    let chosen: typeof ctx.candidates[number] | undefined;
    for (const name of ctx.themeSignatures[slug] ?? []) {
      const c = byName.get(name);
      if (c && !used.has(name)) { chosen = c; break; }
    }
    if (!chosen) {
      chosen = ctx.candidates
        .filter(c => !c.isLand && c.inclusion >= MIN_INCLUSION && c.themeTags.includes(slug) && !used.has(c.name))
        .map(c => ({ c, score: signatureScore(c.inclusion, c.themeTags.length) }))
        .sort((a, b) => b.score - a.score)[0]?.c;
    }
    if (!chosen) continue;
    used.add(chosen.name);
    answers.push({
      id: `open:${slug}`,
      label: ctx.themeNames[slug],
      blurb: chosen.name,
      themeSlugs: [slug],
      card: chosen.scryfall,
      lean: OPENING_COMMIT_LEAN,
    });
    if (answers.length >= OPENING_MAX) break;
  }
  if (answers.length < 2) return null;
  return { id: 'opening', prompt: 'Which of these speaks to you?', answers };
}
