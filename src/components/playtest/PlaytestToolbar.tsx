import { useState } from 'react';
import { Hand as HandIcon, Heart, Shuffle, RotateCcw, Search, Eye, Sparkles, Plus, Settings as SettingsIcon, Undo2, RefreshCw, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover';
import { usePlaytestStore } from '@/store/playtestStore';
import { PHASE_LABELS } from '@/components/playtest/types';
import { PlaytestSettingsModal } from '@/components/playtest/PlaytestSettingsModal';

export function PlaytestToolbar({ onExit }: { onExit: () => void }) {
  const sourceName = usePlaytestStore(s => s.source?.name ?? '');
  const turn = usePlaytestStore(s => s.turn);
  const phase = usePlaytestStore(s => s.phase);
  const advancePhase = usePlaytestStore(s => s.advancePhase);
  const draw = usePlaytestStore(s => s.draw);
  const untapAll = usePlaytestStore(s => s.untapAll);
  const shuffle = usePlaytestStore(s => s.shuffle);
  const beginMulligan = usePlaytestStore(s => s.beginMulligan);
  const undo = usePlaytestStore(s => s.undo);
  const reset = usePlaytestStore(s => s.reset);
  const openModal = usePlaytestStore(s => s.openModal);
  const historyLen = usePlaytestStore(s => s.history.length);
  const life = usePlaytestStore(s => s.life);
  const adjustLife = usePlaytestStore(s => s.adjustLife);
  const setLife = usePlaytestStore(s => s.setLife);

  const [scryN, setScryN] = useState(1);
  const [editingLife, setEditingLife] = useState(false);
  const [draftLife, setDraftLife] = useState(String(life));
  const [settingsOpen, setSettingsOpen] = useState(false);

  const tinyBtn = 'px-1.5 py-0.5 rounded bg-accent/40 hover:bg-accent text-[10px] font-medium';

  return (
    <div className="border-b border-border/50 bg-card/50 backdrop-blur px-4 py-2 flex items-center gap-2 text-sm flex-wrap">
      <Button variant="ghost" size="sm" onClick={onExit}><X className="w-4 h-4 mr-1" />Exit</Button>
      <span className="text-muted-foreground/60">|</span>
      <span className="font-semibold">{sourceName}</span>
      <span className="text-muted-foreground/60">·</span>
      <button
        onClick={advancePhase}
        className="px-2 py-0.5 rounded bg-accent/40 hover:bg-accent text-xs font-medium"
        title="Advance phase"
      >
        {PHASE_LABELS[phase]}
      </button>
      <span className="text-xs opacity-60">Turn {turn}</span>

      {/* Life cluster */}
      <div className="flex items-center gap-0.5 ml-2">
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

      <div className="ml-auto flex items-center gap-1.5 flex-wrap justify-end">
        <Button variant="outline" size="sm" onClick={() => draw(1)}><Plus className="w-3.5 h-3.5 mr-1" />Draw</Button>
        <Button variant="outline" size="sm" onClick={untapAll}><RotateCcw className="w-3.5 h-3.5 mr-1" />Untap</Button>
        <Button variant="outline" size="sm" onClick={shuffle}><Shuffle className="w-3.5 h-3.5 mr-1" />Shuffle</Button>
        <Button variant="outline" size="sm" onClick={beginMulligan}><HandIcon className="w-3.5 h-3.5 mr-1" />Mulligan</Button>
        <Button variant="outline" size="sm" onClick={() => openModal({ kind: 'search' })}><Search className="w-3.5 h-3.5 mr-1" />Search</Button>
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="outline" size="sm"><Eye className="w-3.5 h-3.5 mr-1" />Scry/Mill/Surveil</Button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-44 p-2 space-y-1">
            <div className="flex items-center gap-2">
              <span className="text-xs">N:</span>
              <input type="number" min={1} max={20} value={scryN} onChange={e => setScryN(Math.max(1, parseInt(e.target.value, 10) || 1))} className="w-12 bg-transparent border border-border/50 rounded px-1 py-0.5 text-xs" />
            </div>
            <Button variant="ghost" size="sm" className="w-full justify-start" onClick={() => openModal({ kind: 'scry', n: scryN })}>Scry {scryN}</Button>
            <Button variant="ghost" size="sm" className="w-full justify-start" onClick={() => openModal({ kind: 'mill', n: scryN })}>Mill {scryN}</Button>
            <Button variant="ghost" size="sm" className="w-full justify-start" onClick={() => openModal({ kind: 'surveil', n: scryN })}>Surveil {scryN}</Button>
          </PopoverContent>
        </Popover>
        <Button variant="outline" size="sm" onClick={() => openModal({ kind: 'tokens' })}><Sparkles className="w-3.5 h-3.5 mr-1" />Tokens</Button>
        <Button variant="ghost" size="sm" disabled={historyLen === 0} onClick={undo}><Undo2 className="w-3.5 h-3.5 mr-1" />Undo</Button>
        <Button variant="ghost" size="sm" onClick={reset}><RefreshCw className="w-3.5 h-3.5 mr-1" />Reset</Button>
        <Button variant="ghost" size="icon" onClick={() => setSettingsOpen(true)} title="Playtest settings">
          <SettingsIcon className="w-4 h-4" />
        </Button>
      </div>
      <PlaytestSettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </div>
  );
}
