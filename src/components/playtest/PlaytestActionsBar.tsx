import { useState } from 'react';
import { Hand as HandIcon, Shuffle, RotateCcw, Search, Eye, Sparkles, Plus, Circle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover';
import { usePlaytestStore } from '@/store/playtestStore';
import { COUNTER_COLORS, type CounterColor } from '@/components/playtest/types';

export function PlaytestActionsBar() {
  const draw = usePlaytestStore(s => s.draw);
  const untapAll = usePlaytestStore(s => s.untapAll);
  const shuffle = usePlaytestStore(s => s.shuffle);
  const beginMulligan = usePlaytestStore(s => s.beginMulligan);
  const openModal = usePlaytestStore(s => s.openModal);
  const addFreeCounter = usePlaytestStore(s => s.addFreeCounter);

  const [scryN, setScryN] = useState(1);
  const [mullOpen, setMullOpen] = useState(false);
  const [counterOpen, setCounterOpen] = useState(false);

  const addCounter = (color: CounterColor) => {
    addFreeCounter(color);
    setCounterOpen(false);
  };

  const btn = 'h-6 px-2 text-[11px]';
  const icon = 'w-3 h-3 mr-1';

  return (
    <div className="flex items-center gap-1 flex-wrap">
      <Button variant="outline" size="sm" className={btn} onClick={() => draw(1)} title="Draw a card (D)"><Plus className={icon} />Draw</Button>
      <Button variant="outline" size="sm" className={btn} onClick={untapAll} title="Untap all (U)"><RotateCcw className={icon} />Untap</Button>
      <Button variant="outline" size="sm" className={btn} onClick={shuffle} title="Shuffle library (S)"><Shuffle className={icon} />Shuffle</Button>
      <Popover open={mullOpen} onOpenChange={setMullOpen}>
        <PopoverTrigger asChild>
          <Button variant="outline" size="sm" className={btn} title="Mulligan (M)"><HandIcon className={icon} />Mulligan</Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-56 p-3 space-y-2">
          <p className="text-xs">Shuffle your hand back and draw a new one?</p>
          <div className="flex justify-end gap-1.5">
            <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => setMullOpen(false)}>Cancel</Button>
            <Button size="sm" className="h-7 px-2 text-xs" onClick={() => { setMullOpen(false); beginMulligan(); }}>Mulligan</Button>
          </div>
        </PopoverContent>
      </Popover>
      <Button variant="outline" size="sm" className={btn} onClick={() => openModal({ kind: 'search' })} title="Search library"><Search className={icon} />Search</Button>
      <Popover>
        <PopoverTrigger asChild>
          <Button variant="outline" size="sm" className={btn} title="Scry, Mill, or Surveil"><Eye className={icon} />Scry/Mill/Surveil</Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-44 p-2 space-y-1">
          <div className="flex items-center gap-2">
            <span className="text-xs">N:</span>
            <input type="number" min={1} max={20} value={scryN} onChange={e => setScryN(Math.max(1, parseInt(e.target.value, 10) || 1))} className="w-12 bg-transparent border border-border/50 rounded px-1 py-0.5 text-xs" />
          </div>
          <Button variant="ghost" size="sm" className="w-full justify-start" onClick={() => openModal({ kind: 'scry', n: scryN })}>Scry {scryN}</Button>
          <Button variant="ghost" size="sm" className="w-full justify-start" onClick={() => openModal({ kind: 'mill', n: scryN })}>Mill {scryN}</Button>
          <Button variant="ghost" size="sm" className="w-full justify-start" onClick={() => openModal({ kind: 'surveil', n: scryN })}>Surveil {scryN}</Button>
        </PopoverContent>
      </Popover>
      <Button variant="outline" size="sm" className={btn} onClick={() => openModal({ kind: 'tokens' })} title="Create token"><Sparkles className={icon} />Tokens</Button>
      <Popover open={counterOpen} onOpenChange={setCounterOpen}>
        <PopoverTrigger asChild>
          <Button variant="outline" size="sm" className={btn} title="Add a free-floating counter"><Circle className={icon} />Counter</Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-44 p-2">
          <p className="text-[10px] uppercase opacity-60 px-1 pb-1">Pick a color</p>
          <div className="grid grid-cols-6 gap-1">
            {COUNTER_COLORS.map(c => (
              <button
                key={c.key}
                onClick={() => addCounter(c.key)}
                title={c.label}
                className={`w-6 h-6 rounded-full ${c.chip} hover:ring-2 hover:ring-foreground/40`}
              />
            ))}
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}
