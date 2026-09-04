import { useEffect, useState } from 'react';
import { Bot, Play, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { usePlaytestStore } from '@/store/playtestStore';
import { usePlaytestSettings } from '@/store/playtestSettingsStore';
import { useOpponentStore, MAX_OPPONENTS } from '@/store/opponentStore';
import { OpponentSeat } from '@/components/playtest/opponents/OpponentSeat';

/** Never let one seated opponent sprawl across the whole table. */
const MAX_SEAT_WIDTH = 460;
const MIN_SEAT_WIDTH = 190;
/** Leave room for the log panel and the ＋ / Turn controls on the right. */
const USABLE_FRACTION = 0.62;

/**
 * The opponents, seated across the top of the table rather than stacked in a
 * column beside it. Absolutely positioned so the canvas never reflows —
 * battlefield cards are stored at absolute x/y and a shrinking canvas would
 * clip the ones near the top.
 */
export function OpponentSeats() {
  const opponents = useOpponentStore(s => s.opponents);
  const runAllTurns = useOpponentStore(s => s.runAllTurns);
  const openModal = usePlaytestStore(s => s.openModal);
  const autoTurns = usePlaytestSettings(s => s.opponentAutoTurns);
  const viewportWidth = useViewportWidth();

  // Empty table: one chip. This is the discovery moment the old collapsed rail
  // carried, and it has to survive the move.
  if (opponents.length === 0) {
    return (
      <div className="hidden md:flex absolute top-2 inset-x-0 z-30 justify-center pointer-events-none">
        <Button
          size="sm"
          variant="ghost"
          onClick={() => openModal({ kind: 'opponents' })}
          className="pointer-events-auto h-7 px-3 rounded-full border border-dashed border-border/60 bg-background/70 backdrop-blur-sm text-[11px] text-muted-foreground/80 hover:text-foreground"
        >
          <Bot className="w-3.5 h-3.5 mr-1.5 text-violet-300/80" />
          Play against bots
        </Button>
      </div>
    );
  }

  const width = Math.max(
    MIN_SEAT_WIDTH,
    Math.min(MAX_SEAT_WIDTH, Math.round((viewportWidth * USABLE_FRACTION) / opponents.length)),
  );

  return (
    <div className="hidden md:flex absolute top-1.5 inset-x-1.5 z-30 justify-center items-start gap-2 pointer-events-none">
      {opponents.map(o => (
        <div key={o.id} className="pointer-events-auto">
          <OpponentSeat opponent={o} width={width} />
        </div>
      ))}
      <div className="pointer-events-auto flex flex-col gap-1 pt-1">
        {/* With auto-turns off, Next Turn no longer moves the table, so this is
            the only way for the bots to act. */}
        {!autoTurns && (
          <Button
            size="sm" variant="ghost"
            className="h-6 px-1.5 text-[10px] bg-background/70 backdrop-blur-sm"
            onClick={() => runAllTurns()}
            title="Run every bot's turn now (auto-turns are off in Settings → Bots)"
          >
            <Play className="w-3 h-3 mr-1" />Turn
          </Button>
        )}
        {opponents.length < MAX_OPPONENTS && (
          <Button
            size="sm" variant="ghost"
            className="h-6 w-6 p-0 bg-background/70 backdrop-blur-sm"
            onClick={() => openModal({ kind: 'opponents' })}
            title="Seat another opponent"
          >
            <Plus className="w-3.5 h-3.5" />
          </Button>
        )}
      </div>
    </div>
  );
}

/** Seat width tracks the window, so a resize has to re-render the row. */
function useViewportWidth(): number {
  const [width, setWidth] = useState(() => window.innerWidth);
  useEffect(() => {
    const onResize = () => setWidth(window.innerWidth);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  return width;
}
