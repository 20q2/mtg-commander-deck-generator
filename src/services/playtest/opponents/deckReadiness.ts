import coverageData from '@/data/botDeckCoverage.json';

/**
 * How well the bot understands each of its decks.
 *
 * The bet behind the playtest opponents is that we teach the bot these specific
 * decks card by card rather than building a Magic engine. That leaves a real
 * question the player deserves an answer to before they sit down: has this deck
 * been taught yet? A deck with a dozen unauthored cards still shuffles up and
 * plays — it just casts those cards for nothing, which reads as a stupid bot
 * rather than an unfinished one.
 *
 * The numbers come from `npm run bot:coverage`, which classifies every distinct
 * card in a deck against the registries in effects.ts. Re-run it after touching
 * a decklist or a registry; the badge is a measurement, not a hand-set claim,
 * so it cannot quietly go stale in the other direction.
 */
export interface DeckCoverage {
  /** Percent of distinct cards the bot has guidance for, or needs none. */
  understood: number;
  /** Cards with rules text and nothing to act on it. */
  gaps: number;
  /** Distinct cards in the deck. */
  cards: number;
}

const COVERAGE = coverageData as Record<string, DeckCoverage>;

export type ReadinessLevel = 'ready' | 'playable' | 'rough' | 'unmeasured';

export interface DeckReadiness {
  level: ReadinessLevel;
  /** Chip text. Short enough to sit on one line beside the deck name. */
  label: string;
  /** The full story, for the chip's tooltip. */
  detail: string;
  coverage?: DeckCoverage;
}

/**
 * Thresholds are about how often a dead card turns up, not about how many there
 * are — which is why this is a percentage and not a count. A 27-card stub with
 * three gaps and an 89-card precon with ten are the same experience.
 */
function levelFor(understood: number): Exclude<ReadinessLevel, 'unmeasured'> {
  if (understood >= 90) return 'ready';
  if (understood >= 75) return 'playable';
  return 'rough';
}

const LABELS: Record<Exclude<ReadinessLevel, 'unmeasured'>, string> = {
  ready: 'Ready',
  playable: 'Playable',
  rough: 'In progress',
};

export function deckReadiness(stubId: string): DeckReadiness {
  const coverage = COVERAGE[stubId];
  if (!coverage) {
    return {
      level: 'unmeasured',
      label: 'Untested',
      detail: 'This deck has not been measured yet — run npm run bot:coverage.',
    };
  }

  const { understood, gaps, cards } = coverage;
  const level = levelFor(understood);
  const scale = `The bot has guidance for ${understood}% of this deck (${cards - gaps} of ${cards} cards).`;
  const rest =
    gaps === 0
      ? 'It knows what to do with every card it draws.'
      : `It will still cast the other ${gaps === 1 ? 'card' : `${gaps} cards`}, but won't get the most out of ${gaps === 1 ? 'it' : 'them'}.`;

  return { level, label: LABELS[level], detail: `${scale} ${rest}`, coverage };
}
