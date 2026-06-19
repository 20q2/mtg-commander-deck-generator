import { useEffect } from 'react';
import { GitFork } from 'lucide-react';
import { useStore } from '@/store';

/**
 * A brief, centered banner shown right after a Crossroads commit: it names what changed — how many
 * on-theme cards were pulled in and how many off-theme cards were set aside — so the consequence of
 * committing is felt, not just scored. Auto-dismisses; lives in BrewPage so it survives the event
 * screen unmounting. The injected count fills in when the async theme fetch resolves.
 */
export function BrewCommitFlash() {
  const { brewCommitFlash, setBrewCommitFlash } = useStore();

  useEffect(() => {
    if (!brewCommitFlash) return;
    const t = window.setTimeout(() => setBrewCommitFlash(null), 3200);
    return () => window.clearTimeout(t);
  }, [brewCommitFlash, setBrewCommitFlash]);

  if (!brewCommitFlash) return null;
  const { theme, injected, suppressed } = brewCommitFlash;

  return (
    <div className="pointer-events-none fixed inset-x-0 top-24 z-[90] flex justify-center px-4 animate-brew-view-in">
      <div className="flex items-center gap-3 rounded-2xl border border-amber-400/50 bg-[#1a1206]/90 backdrop-blur-md px-5 py-3 shadow-[0_10px_40px_-8px_rgba(251,191,36,0.4)]">
        <GitFork className="w-5 h-5 text-amber-300" />
        <div className="text-left">
          <div className="font-display text-sm font-semibold text-amber-100">{theme} — locked in</div>
          <div className="text-[11px] text-amber-200/80 tabular-nums">
            {injected > 0 ? `+${injected} on-theme · ` : ''}{suppressed} set aside
          </div>
        </div>
      </div>
    </div>
  );
}
