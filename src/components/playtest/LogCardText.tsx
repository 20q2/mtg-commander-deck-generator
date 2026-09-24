import { useMemo, useRef, useState } from 'react';
import { usePlaytestStore } from '@/store/playtestStore';
import { useOpponentStore } from '@/store/opponentStore';
import { MagnifiedPreview } from '@/components/playtest/MagnifiedPreview';
import { useMagnifyHover } from '@/components/playtest/hooks/useMagnifyHover';
import type { ScryfallCard } from '@/types';

/**
 * Card names in the game log, lit up and hoverable.
 *
 * The log is written as plain sentences by fifty-odd call sites across two
 * stores — "Drew Sol Ring", "Goblin Aggro casts Krenko, Mob Boss" — and
 * threading a card reference through all of them would be a much larger change
 * than the one this earns. So the names are found in the text instead, against
 * an index of every card actually in this game. That index is the thing that
 * makes matching safe: only names that are really in play can match, so a line
 * about a counter cannot light up because some set once printed a card called
 * Counter.
 *
 * Matching is case-sensitive and boundary-checked for the same reason, and
 * longest name first so "Goblin Chieftain" wins over the "Goblin" token.
 */

export interface CardIndex {
  byName: Map<string, ScryfallCard>;
  /** Alternation of every name in `byName`, longest first. Null when empty. */
  pattern: RegExp | null;
  /**
   * Proper names the log uses for something that is NOT a card — the seated
   * decks and your own. "Goblin Aggro casts Goblin Chieftain" has a card name
   * sitting inside the deck's name, and lighting that first half would offer a
   * preview of the wrong thing entirely.
   *
   * `opponent` is what lets a seat's name be tinted in the line: at a glance
   * you can tell someone else did that, rather than reading the sentence to
   * find out whose turn it was.
   */
  skip: { name: string; opponent: boolean }[];
}

/** Names this short are words before they are cards. */
const MIN_NAME = 3;

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const isWordChar = (c: string | undefined) => !!c && /[A-Za-z0-9]/.test(c);

/**
 * Every card the log could be talking about: your zones and board, plus every
 * seated bot's. Built once in the log panel and passed down, so three hundred
 * log lines don't each subscribe to two stores.
 */
export function useCardIndex(): CardIndex {
  const zones = usePlaytestStore(s => s.zones);
  const battlefield = usePlaytestStore(s => s.battlefield);
  const deckName = usePlaytestStore(s => s.source?.name ?? '');
  const opponents = useOpponentStore(s => s.opponents);

  return useMemo(() => {
    const byName = new Map<string, ScryfallCard>();
    const add = (card: ScryfallCard) => {
      if (card.name.length >= MIN_NAME && !byName.has(card.name)) byName.set(card.name, card);
    };
    for (const zone of Object.values(zones)) zone.forEach(add);
    for (const b of battlefield) add(b.card);
    for (const opp of opponents) {
      for (const zone of [opp.library, opp.hand, opp.graveyard, opp.exile, opp.command, opp.tokens]) {
        zone.forEach(add);
      }
      for (const p of opp.battlefield) add(p.card);
    }

    const names = [...byName.keys()].sort((a, b) => b.length - a.length);
    const pattern = names.length > 0
      ? new RegExp(names.map(escapeRe).join('|'), 'g')
      : null;
    const skip = [
      ...(deckName ? [{ name: deckName, opponent: false }] : []),
      ...opponents.filter(o => o.name).map(o => ({ name: o.name, opponent: true })),
    ];
    return { byName, pattern, skip };
  }, [zones, battlefield, deckName, opponents]);
}

export type Segment = { text: string; card?: ScryfallCard; opponent?: boolean };

/** Split a log line into plain runs, the card names inside it, and the names of
 *  the seats that are not you. Exported for its own test: the matching rules
 *  are the part of this that can be wrong. */
export function segmentLogText(text: string, index: CardIndex): Segment[] {
  type Span = { from: number; to: number; card?: ScryfallCard; opponent?: boolean };

  /** Spans of the line that belong to a deck's name rather than to a card. */
  const spans: Span[] = [];
  for (const { name, opponent } of index.skip) {
    for (let at = text.indexOf(name); at >= 0; at = text.indexOf(name, at + 1)) {
      spans.push({ from: at, to: at + name.length, opponent });
    }
  }
  const reserved = spans.map(s => [s.from, s.to] as const);

  const re = index.pattern;
  if (re) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      const end = m.index + m[0].length;
      // Mid-word is a coincidence, not a card.
      if (isWordChar(text[m.index - 1]) || isWordChar(text[end])) {
        re.lastIndex = m.index + 1;
        continue;
      }
      if (reserved.some(([from, to]) => m!.index < to && end > from)) {
        re.lastIndex = m.index + 1;
        continue;
      }
      spans.push({ from: m.index, to: end, card: index.byName.get(m[0]) });
    }
  }

  if (spans.length === 0) return [{ text }];

  // Longest first at a tie, so a name that contains another wins it.
  spans.sort((a, b) => a.from - b.from || b.to - a.to);

  const out: Segment[] = [];
  let cursor = 0;
  for (const span of spans) {
    if (span.from < cursor) continue;
    if (span.from > cursor) out.push({ text: text.slice(cursor, span.from) });
    out.push({ text: text.slice(span.from, span.to), card: span.card, opponent: span.opponent });
    cursor = span.to;
  }
  if (cursor < text.length) out.push({ text: text.slice(cursor) });
  return out;
}

interface Props {
  text: string;
  index: CardIndex;
  /** Bot lines preview under the opponent setting; yours are always yours. */
  scope: 'own' | 'opponent';
  /** An undone line is struck through — its names ride along rather than
   *  staying bright and looking like the only live thing on it. */
  dim?: boolean;
}

export function LogCardText({ text, index, scope, dim }: Props) {
  const segments = useMemo(() => segmentLogText(text, index), [text, index]);
  if (segments.length === 1 && !segments[0].card && !segments[0].opponent) return <>{text}</>;
  return (
    <>
      {segments.map((seg, i) => {
        if (seg.card) return <CardRef key={i} card={seg.card} scope={scope} dim={dim} />;
        // A seat that isn't you, tinted so the line reads as someone else's
        // doing before you have read the verb. An undone line keeps the strike
        // and drops the tint rather than staying the brightest thing on it.
        if (seg.opponent && !dim) {
          return <span key={i} className="font-medium text-rose-300/90">{seg.text}</span>;
        }
        return <span key={i}>{seg.text}</span>;
      })}
    </>
  );
}

function CardRef({ card, scope, dim }: { card: ScryfallCard; scope: 'own' | 'opponent'; dim?: boolean }) {
  const ref = useRef<HTMLSpanElement | null>(null);
  const [hovered, setHovered] = useState(false);
  /**
   * The same gate as every other preview on the table.
   *
   * This used to be plain hover on the argument that the log is text you point
   * at deliberately — but a name in the log IS a card here, and somebody who
   * asked for Ctrl asked for it because previews jumping out unbidden is the
   * thing they wanted to stop. It reads the log line's own side, so a bot's
   * card obeys the bots' setting and yours obeys yours.
   */
  const allowed = useMagnifyHover(hovered, scope);

  return (
    <>
      <span
        ref={ref}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        title={card.name}
        className={`font-medium underline decoration-dotted underline-offset-2 transition-colors ${
          dim
            ? 'decoration-transparent'
            : 'text-foreground decoration-foreground/25 hover:text-primary hover:decoration-primary/60 cursor-help'
        }`}
      >
        {card.name}
      </span>
      {/* Anchored to the name in a strip pinned to the right edge, so 'right'
          has no room and the shared placement chain puts it on the left. */}
      {allowed && <MagnifiedPreview card={card} anchorRef={ref} side="right" />}
    </>
  );
}
