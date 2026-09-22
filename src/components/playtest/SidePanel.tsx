import { useState } from 'react';
import { ChevronLeft } from 'lucide-react';
import { useOpponentStore } from '@/store/opponentStore';
import { GameLog } from '@/components/playtest/GameLog';
import { StackPanel } from '@/components/playtest/StackPanel';

/**
 * The right strip: the log on top, and — once there are bots — the stack
 * underneath.
 *
 * Nothing but a bot can put anything on your stack, so a solo goldfish game
 * has no use for the half at all: it was a header, a Hold/Auto toggle and a
 * line of italic text explaining what would happen if you had opponents. It
 * only exists once a seat does.
 *
 * With bots at the table it is still only HALF when it has something in it.
 * An always-50% panel sitting empty for most of a game is a lot of table
 * given up for a placeholder, so it collapses to its header and grows when a
 * bot points something at you — which is also the movement that tells you to
 * look.
 *
 * Collapse lives here rather than in either half: you fold the strip away, not
 * one of the two things inside it.
 */
export function SidePanel() {
  const [open, setOpen] = useState(true);
  const busy = useOpponentStore(s => s.stack.length > 0);
  const seated = useOpponentStore(s => s.opponents.length > 0);

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className={`w-6 border-l flex items-center justify-center transition-colors ${
          busy
            ? 'border-rose-400/50 bg-rose-900/40 hover:bg-rose-900/60 text-rose-200 animate-pulse'
            : 'border-border/50 bg-card/30 hover:bg-card/60'
        }`}
        title={busy ? 'Something is waiting on the stack' : 'Open side panel'}
      >
        <ChevronLeft className="w-3.5 h-3.5" />
      </button>
    );
  }

  return (
    <aside className="w-56 border-l border-border/50 bg-card md:bg-card/30 flex flex-col min-h-0">
      <GameLog onCollapse={() => setOpen(false)} />
      {/* `busy` as well as `seated`: a seat can leave with its spell still
          waiting, and hiding the panel then would strand the item with no
          Resolve or Counter to answer it. */}
      {(seated || busy) && <StackPanel />}
    </aside>
  );
}
