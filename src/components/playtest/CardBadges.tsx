import { CARD_ASPECT } from '@/components/playtest/types';
import type { CombatKeyword } from '@/services/playtest/combat';

/**
 * The one way a card's real size is shown on the table.
 *
 * It sits exactly where the printed power/toughness box is, so it reads as an
 * overwrite of the number on the art rather than as an extra label stuck
 * beside it — a creature that is a 3/2 right now should say 3/2 in the place
 * you already look for it.
 *
 * Shared by both sides of the table on purpose. Your own creature grown by a
 * counter and a bot's creature grown by a lord are the same fact about the
 * board, and rendering them two different ways is how a player ends up
 * blocking a 3/2 as if it were the 1/1 printed on the card.
 */
export type PTTone =
  /** A CardEdit — the creature has been rewritten into something else. */
  | 'edited'
  /** Until end of turn: an attack trigger, a pump spell. */
  | 'boosted'
  /** Permanent, and not a rewrite: counters, a sticker, a lord's anthem. */
  | 'counters'
  /** Nothing is modifying it — the printed number, shown because the slot wants one. */
  | 'plain';

/**
 * Under this a card is too small to carry words — a permanent on a seat's board
 * is about 40px wide, and a keyword chip or a type line on it covers the art it
 * is annotating. Numbers still fit, which is why only the wordy badges check
 * it. They come back as soon as the card is big enough to read, which is
 * exactly where the decisions are made: an attacker in the combat strip is
 * drawn at twice the size of one standing on the board behind it. Below the
 * threshold the P/T badge's tooltip still names everything, so nothing is
 * lost, only quiet.
 */
const CHIP_MIN_CARD = 58;

/**
 * Where the modern frame's type bar sits, as fractions of card height —
 * measured off a rendered card rather than guessed, because a badge two
 * percent high reads as a mistake rather than as a rewrite.
 */
const TYPE_BAR_TOP = 0.558;
const TYPE_BAR_HEIGHT = 0.067;

const TONE: Record<PTTone, string> = {
  edited: 'bg-amber-600',
  boosted: 'bg-emerald-600',
  counters: 'bg-fuchsia-600',
  plain: 'bg-black/85',
};

/**
 * The percentages track the P/T box of the modern card frame, so it lands right
 * at every card size. Deliberately NOT counter-rotated, unlike counters and
 * stickers: those are labels you read and stay upright, this one is
 * impersonating printed text and has to turn with the card.
 *
 * Small cards get floors rather than pure percentages. A bot's permanent is a
 * third the size of one of yours, and 8% of its height is a box too short to
 * put a numeral in — legible beats exact at that size.
 */
export function PTBadge({
  value, cardWidth, tone = 'counters', abilitiesLost = false, title,
}: {
  value: string;
  cardWidth: number;
  tone?: PTTone;
  abilitiesLost?: boolean;
  /** What is doing this to the creature, as a tooltip. */
  title?: string;
}) {
  const boxW = Math.max(20, Math.round(cardWidth * 0.25));
  const boxH = Math.max(10, Math.round(cardWidth * CARD_ASPECT * 0.08));
  const fontSize = Math.max(8, Math.round(cardWidth * 0.088));
  return (
    <>
      <div
        // Takes the pointer only when it has something to say. A native tooltip
        // needs hover, and hover needs pointer events — but a badge on a card
        // with nothing to explain should never stand between you and the card.
        className={`absolute z-30 ${title ? 'pointer-events-auto cursor-help' : 'pointer-events-none'}`}
        style={{ right: '4.5%', bottom: '3.4%', width: boxW, height: boxH }}
        title={title}
      >
        <span
          className={`flex items-center justify-center w-full h-full rounded-[3px] text-white font-bold tabular-nums ring-1 ring-black/50 shadow-[0_1px_4px_rgba(0,0,0,0.8)] ${TONE[tone]}`}
          style={{ fontSize }}
        >
          {value}
        </span>
      </div>
      {abilitiesLost && (
        // Sits just left of the P/T box, in the same amber, so "no abilities"
        // reads at a glance without crowding the numbers.
        <div
          className="absolute z-30 pointer-events-none"
          style={{ right: `${4.5 + (boxW / cardWidth) * 100 + 2}%`, bottom: '3.4%', width: boxH, height: boxH }}
          title="Loses all abilities"
        >
          <span
            className="flex items-center justify-center w-full h-full rounded-[3px] bg-amber-600 text-white font-bold ring-1 ring-black/50 shadow-[0_1px_4px_rgba(0,0,0,0.8)]"
            style={{ fontSize }}
          >
            ⊘
          </span>
        </div>
      )}
    </>
  );
}

/**
 * A rewritten type line, sitting on the card's own type bar.
 *
 * The same idea as the badge above and for the same reason: a Lignified
 * creature is a Treefolk, and if the only place that is written down is a
 * dialog you closed, the card on the table is still telling you it is a
 * Goblin. Amber, always — a type line does not change by itself, so the only
 * thing that can put one here is a deliberate rewrite.
 *
 * The whole line, supertypes and all: "Legendary Creature — Treefolk" is what
 * the creature now is, and a bar reading only "Treefolk" is answering a
 * different question than the one the card's own type line asks. It shrinks to
 * fit before it truncates, and the tooltip always has the full text.
 */
export function TypeBadge({ typeLine, cardWidth }: {
  typeLine: string;
  cardWidth: number;
}) {
  if (cardWidth < CHIP_MIN_CARD) return null;
  const cardHeight = cardWidth * CARD_ASPECT;
  // Measured off the modern frame: the type bar starts just under the art and
  // is about a fifteenth of the card tall.
  const barTop = cardHeight * TYPE_BAR_TOP;
  const barH = cardHeight * TYPE_BAR_HEIGHT;
  // On a small card the real bar is thinner than any legible line of text, so
  // the badge grows past it — centred on it rather than hanging off its top,
  // which is the difference between "painted over the type line" and "floating
  // in the art".
  const boxH = Math.max(10, Math.round(barH));
  /*
   * Fit the whole line, one row if it will go and two if it won't.
   *
   * A type line is as long as it is — "Creature — Wall" against "Legendary
   * Creature — Treefolk Warrior" — so a fixed size either spills the long ones
   * off the end or wastes the bar on the short ones. 0.54 is roughly the
   * average advance width of bold system sans as a fraction of its font size;
   * close enough to choose between one row and two.
   *
   * One row is preferred while it stays legible, because that is what a
   * printed type line looks like. Below that it drops to the largest size that
   * fits two, and the clamp below stops a pathological line from covering the
   * card — the tooltip has the full text either way.
   */
  const boxW = cardWidth * 0.91 - 8;
  const ideal = Math.max(8, Math.round(cardWidth * 0.062));
  const perLine = (rows: number) => Math.floor((rows * boxW) / (typeLine.length * 0.54));
  const fontSize = perLine(1) >= 7
    ? Math.min(ideal, perLine(1))
    : Math.max(6, Math.min(ideal, perLine(2)));

  return (
    <div
      className="absolute z-30 pointer-events-auto cursor-help"
      // Grows downward when a long line needs a second row rather than
      // clipping the subtype off the end — the type bar is where the badge
      // starts, not a box it has to fit inside.
      style={{ left: '4.5%', right: '4.5%', top: barTop - (boxH - barH) / 2, minHeight: boxH }}
      title={`Rewritten as ${typeLine}`}
    >
      <span
        // `line-clamp` wants a -webkit-box, so this cannot be a flex row —
        // which is also why the text is centred by padding rather than by
        // `items-center`.
        className="block w-full px-1 py-[1px] rounded-[2px] bg-amber-600 text-white font-bold leading-[1.15] ring-1 ring-black/50 shadow-[0_1px_4px_rgba(0,0,0,0.8)] line-clamp-2"
        style={{ fontSize, minHeight: boxH }}
      >
        {typeLine}
      </span>
    </div>
  );
}

/** Short enough to fit on a card at combat size, long enough to be a word. */
export const KEYWORD_LABEL: Record<CombatKeyword, string> = {
  firstStrike: '1st strike',
  doubleStrike: '2x strike',
  deathtouch: 'Deathtouch',
  trample: 'Trample',
  flying: 'Flying',
  reach: 'Reach',
  menace: 'Menace',
  vigilance: 'Vigilance',
  indestructible: 'Indestr.',
  hexproof: 'Hexproof',
};

/**
 * Abilities a creature has that its own card does not print — a lord's grant,
 * an attack trigger's until-end-of-turn gift.
 *
 * The other half of the same problem the badge above solves. Legion Loyalist's
 * battalion trigger hands first strike to the whole board, and a player who
 * cannot see that blocks a 1/1 with a 1/3 and watches the 1/3 die for nothing.
 * Stacked bottom-left like stickers, because that is what they are: something
 * stuck onto the card that is not part of it.
 */
export function GrantedKeywords({ keywords, cardWidth }: {
  keywords: CombatKeyword[];
  cardWidth: number;
}) {
  if (keywords.length === 0 || cardWidth < CHIP_MIN_CARD) return null;
  const fontSize = Math.max(7, Math.round(cardWidth * 0.075));
  return (
    <div
      className="absolute left-[4.5%] bottom-[3.4%] z-30 flex flex-col items-start gap-[1px] pointer-events-auto cursor-help"
      style={{ maxWidth: '62%' }}
    >
      {keywords.map(k => (
        <span
          key={k}
          className="px-[3px] rounded-[2px] bg-emerald-600 text-white font-bold leading-[1.4] ring-1 ring-black/50 shadow-[0_1px_3px_rgba(0,0,0,0.8)] whitespace-nowrap"
          style={{ fontSize }}
          title={`Gains ${KEYWORD_LABEL[k]} — not printed on the card`}
        >
          {KEYWORD_LABEL[k]}
        </span>
      ))}
    </div>
  );
}
