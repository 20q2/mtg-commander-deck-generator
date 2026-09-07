import { useEffect, useState } from 'react';
import { Skull, Trophy, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { usePlaytestStore } from '@/store/playtestStore';
import { useOpponentStore } from '@/store/opponentStore';

/**
 * The end of the game, said out loud.
 *
 * A bot crossing zero has always greyed its seat out and logged "is defeated";
 * your own life had no handling at all, so a game could run twelve turns past
 * dead — I played one to −260 — with the clock you were racing having no finish
 * line at all.
 *
 * Deliberately a banner and not a wall. This is a goldfish where you police
 * your own side of the table, so being told you are dead and choosing to play
 * on is a legitimate thing to want: nothing here stops a turn, and dismissing
 * it leaves the game exactly as it was.
 */
export function GameOutcomeBanner() {
  const life = usePlaytestStore(s => s.life);
  const reset = usePlaytestStore(s => s.reset);
  const opponents = useOpponentStore(s => s.opponents);
  const resetOpponents = useOpponentStore(s => s.resetAll);

  const dead = life <= 0;
  // Only a win if somebody was actually sitting there to beat.
  const won = opponents.length > 0 && opponents.every(o => o.life <= 0);
  const outcome = dead ? 'lost' : won ? 'won' : null;

  const [dismissed, setDismissed] = useState<string | null>(null);
  // A new outcome is worth announcing even if the last one was waved away.
  useEffect(() => { if (!outcome) setDismissed(null); }, [outcome]);

  if (!outcome || dismissed === outcome) return null;

  const lost = outcome === 'lost';

  return (
    // Dead centre rather than the top of the table: the seats live up there,
    // and a banner across them hid an opponent's life total behind the news.
    <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 z-50 flex justify-center pointer-events-none px-2">
      <div
        role="status"
        className={`pointer-events-auto flex items-center gap-3 rounded-lg border px-3 py-2 shadow-2xl backdrop-blur-sm ${
          lost
            ? 'border-rose-400/60 bg-rose-950/85'
            : 'border-emerald-400/60 bg-emerald-950/85'
        }`}
      >
        {lost
          ? <Skull className="w-5 h-5 text-rose-300 shrink-0" />
          : <Trophy className="w-5 h-5 text-emerald-300 shrink-0" />}
        <div className="min-w-0">
          <p className={`text-sm font-bold ${lost ? 'text-rose-100' : 'text-emerald-100'}`}>
            {lost ? 'You have been defeated' : 'You win'}
          </p>
          <p className={`text-[11px] ${lost ? 'text-rose-200/80' : 'text-emerald-200/80'}`}>
            {lost
              ? `At ${life} life. Reset for a rematch, or play on.`
              : 'Every opponent is out of the game.'}
          </p>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <Button
            size="sm"
            variant={lost ? 'destructive' : 'default'}
            onClick={() => { reset(); resetOpponents(); }}
          >
            Rematch
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setDismissed(outcome)}
            title="Keep playing"
          >
            <X className="w-4 h-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
