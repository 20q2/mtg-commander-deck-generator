import { useState } from 'react';
import { Heart, X, Undo2, RefreshCw, Settings as SettingsIcon, PanelRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { usePlaytestStore } from '@/store/playtestStore';
import { PlaytestSettingsModal } from '@/components/playtest/PlaytestSettingsModal';
import { NextTurnButton } from '@/components/playtest/PlaytestActionsBar';

interface Props {
  onExit: () => void;
  onToggleSidePanel?: () => void;
}

export function PlaytestToolbar({ onExit, onToggleSidePanel }: Props) {
  const sourceName = usePlaytestStore(s => s.source?.name ?? '');
  const turn = usePlaytestStore(s => s.turn);
  const life = usePlaytestStore(s => s.life);
  const adjustLife = usePlaytestStore(s => s.adjustLife);
  const setLife = usePlaytestStore(s => s.setLife);
  const undo = usePlaytestStore(s => s.undo);
  const reset = usePlaytestStore(s => s.reset);
  const historyLen = usePlaytestStore(s => s.history.length);

  const [editingLife, setEditingLife] = useState(false);
  const [draftLife, setDraftLife] = useState(String(life));
  const [settingsOpen, setSettingsOpen] = useState(false);

  const tinyBtn = 'px-1.5 py-0.5 rounded bg-accent/40 hover:bg-accent text-[10px] font-medium';

  return (
    <div className="border-b border-border/50 bg-card/50 backdrop-blur px-2 sm:px-4 py-2 flex items-center gap-1 sm:gap-2 text-sm flex-wrap">
      <Button variant="ghost" size="sm" onClick={onExit}><X className="w-4 h-4 sm:mr-1" /><span className="hidden sm:inline">Exit</span></Button>
      <span className="text-muted-foreground/60 hidden sm:inline">|</span>
      <span className="font-semibold truncate max-w-[28vw] sm:max-w-none">{sourceName}</span>
      <span className="text-muted-foreground/60 hidden sm:inline">·</span>
      <span className="text-xs text-muted-foreground/80 px-1 hidden sm:inline">Turn {turn}</span>

      {/* Life cluster — right-aligned on mobile (its own row), inline on desktop. */}
      <div className="flex items-center gap-0.5 ml-auto md:ml-2">
        <button onClick={() => adjustLife(-5)} className={tinyBtn} title="-5 life">−5</button>
        <button onClick={() => adjustLife(-1)} className={tinyBtn} title="-1 life">−1</button>
        {editingLife ? (
          <input
            autoFocus
            type="number"
            value={draftLife}
            onChange={e => setDraftLife(e.target.value)}
            onBlur={() => { setEditingLife(false); const n = parseInt(draftLife, 10); if (!isNaN(n)) setLife(n); }}
            onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
            className="w-14 mx-1 bg-emerald-500/15 border border-emerald-400/40 rounded px-1.5 py-0.5 text-emerald-300 font-bold text-center text-sm outline-none"
          />
        ) : (
          <button
            onClick={() => { setDraftLife(String(life)); setEditingLife(true); }}
            className="mx-1 inline-flex items-center gap-1 px-2 py-0.5 rounded bg-emerald-500/15 border border-emerald-400/40 text-emerald-300 font-bold text-sm min-w-[48px] justify-center"
            title="Click to edit life"
          >
            <Heart className="w-3 h-3 fill-emerald-400/40" />
            {life}
          </button>
        )}
        <button onClick={() => adjustLife(1)} className={tinyBtn} title="+1 life">+1</button>
        <button onClick={() => adjustLife(5)} className={tinyBtn} title="+5 life">+5</button>
      </div>

      {/* Force a row break on mobile so Next Turn + icon group land on their own row. */}
      <div className="basis-full h-0 md:hidden" aria-hidden />

      {/* Next Turn — only in the top toolbar on mobile. On desktop it lives
          in the hand toolbar's right column. */}
      <div className="md:hidden">
        <NextTurnButton />
      </div>

      <div className="hidden lg:flex items-center gap-4 mx-auto select-none text-[10px] text-muted-foreground/70">
        <span
          className="inline-flex items-center gap-1"
          title="Hold Ctrl while hovering a card for a larger preview"
        >
          Hold <kbd className="px-1 py-0.5 rounded border border-border/60 bg-accent/30 font-mono text-[9px]">Ctrl</kbd>
          + hover to magnify
        </span>
        <span
          className="inline-flex items-center gap-1"
          title="Right-click any zone (Library, Graveyard, Exile, Command) to open its card viewer"
        >
          <kbd className="px-1 py-0.5 rounded border border-border/60 bg-accent/30 font-mono text-[9px]">Right-click</kbd>
          a zone to search or view
        </span>
      </div>

      <div className="flex items-center gap-0.5 sm:gap-1 justify-end ml-auto">
        <Button variant="ghost" size="sm" disabled={historyLen === 0} onClick={undo} title="Undo last action (Ctrl+Z)">
          <Undo2 className="w-3.5 h-3.5 sm:mr-1" /><span className="hidden sm:inline">Undo</span>
        </Button>
        <Button variant="ghost" size="sm" onClick={reset} title="Reset playtest">
          <RefreshCw className="w-3.5 h-3.5 sm:mr-1" /><span className="hidden sm:inline">Reset</span>
        </Button>
        {onToggleSidePanel && (
          <Button variant="ghost" size="sm" className="md:hidden" onClick={onToggleSidePanel} title="Open log & combos panel">
            <PanelRight className="w-4 h-4 sm:mr-1" /><span className="hidden sm:inline">Log</span>
          </Button>
        )}
        <Button variant="ghost" size="sm" onClick={() => setSettingsOpen(true)} title="Playtest settings">
          <SettingsIcon className="w-4 h-4 sm:mr-1" /><span className="hidden sm:inline">Settings</span>
        </Button>
      </div>
      <PlaytestSettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </div>
  );
}
