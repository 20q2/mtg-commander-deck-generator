import { useMemo } from 'react';
import { GripHorizontal, Heart, Loader2 } from 'lucide-react';
import { usePlaytestSettings } from '@/store/playtestSettingsStore';
import { backgroundUrlForIdentity } from '@/services/spellchroma/colorBackground';
import type { OpponentStub } from '@/components/playtest/opponentTypes';

/**
 * The seat a deck gets the instant you pick it, before its cards exist.
 *
 * Seating a bot is a Scryfall round trip for a hundred names, and until this
 * existed the whole trip happened behind a spinner on a tile in a dialog you
 * were probably about to close — you clicked a deck, the table did nothing,
 * and some time later a fully-formed opponent blinked into being. So the
 * playmat arrives on the click and the deck fills it in afterwards.
 *
 * Deliberately the same chrome as a real seat — same width, same border, same
 * colour-identity art — because it is not a spinner standing in for a seat, it
 * IS the seat, waiting for its cards. When the opponent lands it takes this
 * one's place in the row and the swap reads as the deck arriving rather than
 * as one panel replacing another.
 */
export function DealingSeat({ stub, width }: { stub: OpponentStub; width: number }) {
  const animations = usePlaytestSettings(s => s.animations);
  const art = useMemo(() => backgroundUrlForIdentity(stub.colors), [stub.colors]);
  /** The zone piles' width, matching OpponentSeat's own 10%-of-seat rule. */
  const zoneWidth = Math.round(Math.max(14, width * 0.1));

  return (
    <div
      data-seat-dealing
      aria-live="polite"
      aria-label={`Seating ${stub.name}`}
      className={`relative flex flex-col rounded-lg border border-violet-400/40 bg-background/80 backdrop-blur-sm p-1.5 shadow-lg ${
        animations ? 'animate-seat-deal-in' : ''
      }`}
      style={{ width }}
    >
      {/* Their colours, at the same weight a seated opponent wears them. */}
      <div aria-hidden className="absolute inset-0 z-0 rounded-lg overflow-hidden pointer-events-none">
        <div
          className="absolute inset-0"
          style={{
            backgroundImage: `url("${art}")`,
            backgroundSize: 'cover',
            backgroundPosition: 'center',
            opacity: 0.16,
          }}
        />
      </div>

      {/* Header, in the shape the real one will take: grip, name, life. */}
      <div className="relative z-10 flex items-center gap-1 shrink-0">
        <GripHorizontal aria-hidden className="w-3 h-3 shrink-0 opacity-30" />
        <span className="text-[11px] font-semibold truncate flex-1 min-w-0">{stub.name}</span>
        <span className="shrink-0 inline-flex items-center gap-0.5 px-1 rounded border border-rose-400/30 bg-rose-500/10 text-rose-300/60 text-[11px] leading-4 font-bold">
          <Heart className="w-2.5 h-2.5 fill-rose-400/20" />
          <span className="animate-seat-dealing">40</span>
        </span>
      </div>

      {/* The board, as the empty slot it is about to become. */}
      <div className="relative z-10 mt-1">
        <div className="h-[38px] rounded-md border border-dashed border-violet-400/30 flex items-center justify-center gap-1.5 text-[10px] text-violet-200/80">
          <Loader2 className="w-3 h-3 animate-spin" />
          {/* One line, and it says the only thing worth saying: whose deck, and
              that it is on its way. The commander is the part you chose. */}
          <span className="truncate">Shuffling up {stub.commander}…</span>
        </div>
      </div>

      {/* Lands on the left, zone piles on the right — the real seat's bottom
          row, drawn as empty slots that breathe while they wait. */}
      <div className="relative z-10 mt-1 flex items-end gap-1 shrink-0 animate-seat-dealing">
        <div className="flex items-end gap-1 min-w-0">
          {[0, 1, 2].map(i => (
            <div
              key={i}
              className="rounded-sm bg-muted/80 border border-border/70 shadow-inner"
              style={{ width: Math.round(width * 0.1), height: Math.round(width * 0.1 * 1.4) }}
            />
          ))}
        </div>
        <div className="ml-auto flex items-end gap-1 shrink-0">
          {[0, 1, 2, 3].map(i => (
            <div
              key={i}
              className="rounded-sm bg-muted/80 border border-border/70 shadow-inner"
              style={{ width: zoneWidth, height: Math.round(zoneWidth * 1.4) }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
