import { useState } from 'react';
import { Hand as HandIcon, Shuffle, RotateCcw, Search, Eye, Sparkles, Plus, BookOpen, Trash2, SkipForward, MoreHorizontal } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover';
import { usePlaytestStore } from '@/store/playtestStore';

export function PlaytestActionsBar() {
  const draw = usePlaytestStore(s => s.draw);
  const untapAll = usePlaytestStore(s => s.untapAll);
  const shuffle = usePlaytestStore(s => s.shuffle);
  const beginMulligan = usePlaytestStore(s => s.beginMulligan);
  const openModal = usePlaytestStore(s => s.openModal);
  const closeModal = usePlaytestStore(s => s.closeModal);
  const modal = usePlaytestStore(s => s.modal);
  const searchOpen = modal?.kind === 'zoneViewer' && modal.zone === 'library';

  const [scryN, setScryN] = useState(1);
  const [drawN, setDrawN] = useState(1);
  const [drawOpen, setDrawOpen] = useState(false);
  const [mullOpen, setMullOpen] = useState(false);

  const btn = 'h-6 px-1.5 sm:px-2 text-[11px]';
  const icon = 'w-3 h-3 mr-1';

  const drawBtn = (
    <Popover open={drawOpen} onOpenChange={setDrawOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className={btn} title="Draw cards (D draws 1)"><Plus className={icon} />Draw</Button>
      </PopoverTrigger>
      <PopoverContent side="top" align="start" sideOffset={6} className="w-56 p-2 space-y-2">
        <ScryNPicker value={drawN} onChange={setDrawN} />
        <Button
          variant="ghost"
          size="sm"
          className="w-full justify-start"
          onClick={() => draw(drawN)}
        >
          <Plus className={icon} />Draw {drawN}
        </Button>
      </PopoverContent>
    </Popover>
  );

  const mulliganBtn = (
    <Popover open={mullOpen} onOpenChange={setMullOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className={btn} title="Mulligan (M)"><HandIcon className={icon} />Mulligan</Button>
      </PopoverTrigger>
      <PopoverContent side="top" align="start" sideOffset={6} className="w-56 p-3 space-y-2">
        <p className="text-xs">Shuffle your hand back and draw a new one?</p>
        <div className="flex justify-end gap-1.5">
          <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => setMullOpen(false)}>Cancel</Button>
          <Button size="sm" className="h-7 px-2 text-xs" onClick={() => { setMullOpen(false); beginMulligan(); }}>Mulligan</Button>
        </div>
      </PopoverContent>
    </Popover>
  );

  const scryBtn = (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className={btn} title="Scry, Mill, or Surveil">
          <Eye className={icon} />
          <span className="md:hidden">Scry…</span>
          <span className="hidden md:inline">Scry/Mill/Surveil</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent side="top" align="start" sideOffset={6} className="w-56 p-2 space-y-2">
        <ScryNPicker value={scryN} onChange={setScryN} />
        <div className="space-y-1">
          <Button variant="ghost" size="sm" className="w-full justify-start" onClick={() => openModal({ kind: 'scry', n: scryN })}><Eye className={icon} />Scry {scryN}</Button>
          <Button variant="ghost" size="sm" className="w-full justify-start" onClick={() => openModal({ kind: 'surveil', n: scryN })}><BookOpen className={icon} />Surveil {scryN}</Button>
          <Button variant="ghost" size="sm" className="w-full justify-start" onClick={() => openModal({ kind: 'mill', n: scryN })}><Trash2 className={icon} />Mill {scryN}</Button>
        </div>
      </PopoverContent>
    </Popover>
  );

  const tokensOpen = modal?.kind === 'tokens';
  const createOpen = modal?.kind === 'create';
  const createBtn = (
    <Button
      variant={createOpen ? 'default' : 'outline'}
      size="sm"
      className={btn}
      title="Create a counter or die"
      onClick={() => createOpen ? closeModal() : openModal({ kind: 'create' })}
    >
      <Plus className={icon} />Create
    </Button>
  );

  const Group = ({ children, className = '' }: { children: React.ReactNode; className?: string }) => (
    <div className={`flex items-center gap-1 ${className}`}>{children}</div>
  );
  const Sep = () => <div className="w-px h-5 bg-border/60 mx-1" aria-hidden />;

  const [moreOpen, setMoreOpen] = useState(false);
  const moreBtn = (
    <Popover open={moreOpen} onOpenChange={setMoreOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className={btn} title="More actions"><MoreHorizontal className="w-3 h-3" /></Button>
      </PopoverTrigger>
      <PopoverContent side="top" align="end" sideOffset={6} className="w-44 p-1">
        <Button variant="ghost" size="sm" className="w-full justify-start text-xs" onClick={() => { setMoreOpen(false); shuffle(); }}><Shuffle className="w-3 h-3 mr-2" />Shuffle</Button>
        <Button variant="ghost" size="sm" className="w-full justify-start text-xs" onClick={() => { setMoreOpen(false); setMullOpen(true); }}><HandIcon className="w-3 h-3 mr-2" />Mulligan…</Button>
        <Button variant="ghost" size="sm" className="w-full justify-start text-xs" onClick={() => { setMoreOpen(false); openModal({ kind: 'tokens' }); }}><Sparkles className="w-3 h-3 mr-2" />Tokens…</Button>
        <Button variant="ghost" size="sm" className="w-full justify-start text-xs" onClick={() => { setMoreOpen(false); createOpen ? closeModal() : openModal({ kind: 'create' }); }}><Plus className="w-3 h-3 mr-2" />Create…</Button>
      </PopoverContent>
    </Popover>
  );

  return (
    <div className="flex items-center justify-center gap-0.5 sm:gap-1 flex-wrap">
      {/* Always-visible essentials */}
      <Group>
        <Button variant="outline" size="sm" className={btn} onClick={untapAll} title="Untap all (U)"><RotateCcw className={icon} />Untap</Button>
        {drawBtn}
      </Group>
      <div className="hidden md:block"><Sep /></div>
      <Group className="hidden md:flex">
        <Button variant="outline" size="sm" className={btn} onClick={shuffle} title="Shuffle library (S)"><Shuffle className={icon} />Shuffle</Button>
        {mulliganBtn}
      </Group>
      <div className="hidden md:block"><Sep /></div>
      <Group>
        {scryBtn}
        <Button variant={searchOpen ? 'default' : 'outline'} size="sm" className={btn} onClick={() => openModal({ kind: 'zoneViewer', zone: 'library' })} title="Search library"><Search className={icon} />Search</Button>
      </Group>
      <div className="hidden md:block"><Sep /></div>
      <Group className="hidden md:flex">
        <Button variant={tokensOpen ? 'default' : 'outline'} size="sm" className={btn} onClick={() => tokensOpen ? closeModal() : openModal({ kind: 'tokens' })} title="Create token"><Sparkles className={icon} />Tokens</Button>
        {createBtn}
      </Group>
      {/* Mobile-only overflow with the hidden items */}
      <div className="md:hidden">{moreBtn}</div>
    </div>
  );
}

export function NextTurnButton() {
  const nextTurn = usePlaytestStore(s => s.nextTurn);
  const draw = usePlaytestStore(s => s.draw);
  const turn = usePlaytestStore(s => s.turn);
  const handleNextTurn = () => { nextTurn(); draw(1); };
  return (
    <Button
      size="sm"
      className="h-8 sm:h-6 px-2 text-[11px] bg-primary/15 hover:bg-primary/25 border border-primary/40 text-primary-foreground/90 gap-1"
      onClick={handleNextTurn}
      title="Advance to the next turn and draw a card"
    >
      <SkipForward className="w-3.5 h-3.5 sm:w-3 sm:h-3" />
      <span className="sm:hidden">Turn</span>
      <span className="hidden sm:inline">Next Turn</span>
      <span className="opacity-60 tabular-nums text-[10px]">{turn}</span>
    </Button>
  );
}


const SCRY_PRESETS = [1, 2, 3, 5];

function ScryNPicker({ value, onChange }: { value: number; onChange: (n: number) => void }) {
  const [custom, setCustom] = useState(!SCRY_PRESETS.includes(value));
  return (
    <div className="flex items-center gap-1">
      {SCRY_PRESETS.map(n => (
        <Button
          key={n}
          variant={!custom && value === n ? 'default' : 'outline'}
          size="sm"
          className="h-7 w-8 p-0 text-xs"
          onClick={() => { setCustom(false); onChange(n); }}
        >
          {n}
        </Button>
      ))}
      {custom ? (
        <Input
          type="number"
          min={1}
          max={99}
          value={value}
          autoFocus
          onChange={(e) => {
            const n = Math.max(1, Math.min(99, Number(e.target.value) || 1));
            onChange(n);
          }}
          className="h-7 w-12 px-1 text-xs"
        />
      ) : (
        <Button
          variant="outline"
          size="sm"
          className="h-7 w-8 p-0 text-xs"
          onClick={() => setCustom(true)}
          title="Custom amount"
        >
          X
        </Button>
      )}
    </div>
  );
}
