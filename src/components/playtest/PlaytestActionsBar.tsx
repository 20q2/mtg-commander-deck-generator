import { useState } from 'react';
import { Hand as HandIcon, RotateCcw, Search, Eye, Sparkles, Plus, BookOpen, Trash2, SkipForward, MoreHorizontal, Bot, Layers, Swords } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover';
import { usePlaytestStore } from '@/store/playtestStore';
import { useOpponentStore } from '@/store/opponentStore';
import { usePlaytestSettings } from '@/store/playtestSettingsStore';

// Defined at module scope (not inside the component) so it keeps a stable
// component identity across renders. If this lived in the render body, every
// re-render would create a new function reference, and React would unmount and
// remount everything wrapped in <Group> — silently resetting any uncontrolled
// popover inside to closed whenever the bar re-rendered.
//
// The buttons in a group sit flush: square corners and a -1px pull so adjacent
// borders collapse into a single hairline, making each group read as one
// segmented control rather than a row of chips. Groups are told apart by the
// gap between them, so they need no separator rules.
const Group = ({ children, className = '' }: { children: React.ReactNode; className?: string }) => (
  <div className={`flex items-center [&>*+*]:-ml-px ${className}`}>{children}</div>
);

export function PlaytestActionsBar() {
  const draw = usePlaytestStore(s => s.draw);
  const untapAll = usePlaytestStore(s => s.untapAll);
  const beginMulligan = usePlaytestStore(s => s.beginMulligan);
  const freeMulligan = usePlaytestStore(s => s.freeMulligan);
  const openModal = usePlaytestStore(s => s.openModal);
  const closeModal = usePlaytestStore(s => s.closeModal);
  const modal = usePlaytestStore(s => s.modal);
  const searchOpen = modal?.kind === 'zoneViewer' && modal.zone === 'library';

  // One amount drives every deck action — pick N once, then choose what to do
  // with it. Draw keeps the popover open so you can tap it repeatedly; the
  // scry/surveil/mill actions open a modal, so the popover gets out of the way.
  const [deckN, setDeckN] = useState(1);
  const [deckOpen, setDeckOpen] = useState(false);
  const [mullOpen, setMullOpen] = useState(false);

  // rounded-none + focus-visible:z-10 so the flush borders stay collapsed but a
  // focused / hovered button still paints its own outline on top of its neighbour.
  // border-y-0: the row's own top edge and hairline already bound the buttons, so
  // their horizontal rules would only double up on those lines.
  const btn = 'relative h-6 px-1.5 sm:px-2 text-[11px] rounded-none border-y-0 focus-visible:z-10 hover:z-10';
  const icon = 'w-3 h-3 mr-1';

  const deckActionsBtn = (
    <Popover open={deckOpen} onOpenChange={setDeckOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className={btn} title="Draw, scry, surveil or mill (D draws 1)">
          <Layers className={icon} />
          <span className="md:hidden">Deck</span>
          <span className="hidden md:inline">Deck Actions</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent side="top" align="start" sideOffset={6} className="w-56 p-2 space-y-2">
        <ScryNPicker value={deckN} onChange={setDeckN} />
        <div className="space-y-1">
          <Button variant="ghost" size="sm" className="w-full justify-start" onClick={() => draw(deckN)}><Plus className={icon} />Draw {deckN}</Button>
          <Button variant="ghost" size="sm" className="w-full justify-start" onClick={() => { setDeckOpen(false); openModal({ kind: 'scry', n: deckN }); }}><Eye className={icon} />Scry {deckN}</Button>
          <Button variant="ghost" size="sm" className="w-full justify-start" onClick={() => { setDeckOpen(false); openModal({ kind: 'surveil', n: deckN }); }}><BookOpen className={icon} />Surveil {deckN}</Button>
          <Button variant="ghost" size="sm" className="w-full justify-start" onClick={() => { setDeckOpen(false); openModal({ kind: 'mill', n: deckN }); }}><Trash2 className={icon} />Mill {deckN}</Button>
        </div>
      </PopoverContent>
    </Popover>
  );

  const mulliganBtn = (
    <Popover open={mullOpen} onOpenChange={setMullOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className={`${btn} hidden md:inline-flex`} title="Mulligan (M)"><HandIcon className={icon} />Mulligan</Button>
      </PopoverTrigger>
      <PopoverContent side="top" align="start" sideOffset={6} className="w-72 p-3 space-y-2">
        <p className="text-xs">Shuffle your hand back and draw a new one?</p>
        <div className="flex justify-between items-center gap-1.5">
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-xs text-muted-foreground"
            title="Reshuffle hand and draw 7 fresh cards, no penalty"
            onClick={() => { setMullOpen(false); freeMulligan(); }}
          >
            Free mulligan
          </Button>
          <div className="flex gap-1.5">
            <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => setMullOpen(false)}>Cancel</Button>
            <Button size="sm" className="h-7 px-2 text-xs" onClick={() => { setMullOpen(false); beginMulligan(); }}>Mulligan</Button>
          </div>
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

  const [moreOpen, setMoreOpen] = useState(false);
  const moreBtn = (
    <Popover open={moreOpen} onOpenChange={setMoreOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className={btn} title="More actions"><MoreHorizontal className="w-3 h-3" /></Button>
      </PopoverTrigger>
      <PopoverContent side="top" align="end" sideOffset={6} className="w-44 p-1">
        {/* Shuffle isn't here — it's an icon button on the library pile itself. */}
        <Button variant="ghost" size="sm" className="w-full justify-start text-xs" onClick={() => { setMoreOpen(false); setMullOpen(true); }}><HandIcon className="w-3 h-3 mr-2" />Mulligan…</Button>
        <Button variant="ghost" size="sm" className="w-full justify-start text-xs" onClick={() => { setMoreOpen(false); openModal({ kind: 'tokens' }); }}><Sparkles className="w-3 h-3 mr-2" />Tokens…</Button>
        <Button variant="ghost" size="sm" className="w-full justify-start text-xs" onClick={() => { setMoreOpen(false); createOpen ? closeModal() : openModal({ kind: 'create' }); }}><Plus className="w-3 h-3 mr-2" />Create…</Button>
        {/* The opponent column is desktop-only, so this is mobile's way in. */}
        <Button variant="ghost" size="sm" className="w-full justify-start text-xs" onClick={() => { setMoreOpen(false); openModal({ kind: 'opponents' }); }}><Bot className="w-3 h-3 mr-2" />Play against bots…</Button>
      </PopoverContent>
    </Popover>
  );

  return (
    <div className="flex items-center justify-center gap-1.5 flex-wrap">
      {/* Always-visible essentials */}
      <Group>
        <Button variant="outline" size="sm" className={btn} onClick={untapAll} title="Untap all (U)"><RotateCcw className={icon} />Untap</Button>
        {mulliganBtn}
      </Group>
      <Group>
        <Button variant={searchOpen ? 'default' : 'outline'} size="sm" className={btn} onClick={() => searchOpen ? closeModal() : openModal({ kind: 'zoneViewer', zone: 'library' })} title="Search library"><Search className={icon} />Search</Button>
        {deckActionsBtn}
      </Group>
      <Group className="hidden md:flex">
        <Button variant={tokensOpen ? 'default' : 'outline'} size="sm" className={btn} onClick={() => tokensOpen ? closeModal() : openModal({ kind: 'tokens' })} title="Create token"><Sparkles className={icon} />Tokens</Button>
        {createBtn}
      </Group>
      {/* Mobile-only overflow with the hidden items */}
      <div className="md:hidden">{moreBtn}</div>
    </div>
  );
}

/**
 * Steps into the combat phase, which is what opens the attack zones in front
 * of each opponent. Toggles: pressing it again backs out and untaps anything
 * you'd already declared.
 *
 * Sits beside Next Turn because that's the other button that moves the game
 * forward a beat, and combat is the beat before the turn ends.
 */
export function CombatButton() {
  const opponentCount = useOpponentStore(s => s.opponents.length);
  const combatPhase = useOpponentStore(s => s.combatPhase);
  const enterCombat = useOpponentStore(s => s.enterCombat);
  const exitCombat = useOpponentStore(s => s.exitCombat);
  const combat = useOpponentStore(s => s.combat);
  const playerCombat = useOpponentStore(s => s.playerCombat);
  const botsRunning = useOpponentStore(s => s.running);

  // Nothing to attack, so nothing to offer.
  if (opponentCount === 0) return null;

  // Their combat owns the strips while it's open, and a confirmed attack of
  // yours is already past the point of backing out.
  const blocked = botsRunning || !!combat || !!playerCombat;

  return (
    <Button
      size="sm"
      disabled={blocked}
      className={`h-8 sm:h-6 px-2 text-[11px] rounded-none border border-y-0 gap-1 ${
        combatPhase
          ? 'bg-violet-500/25 border-violet-400/60 text-violet-100'
          : 'bg-primary/15 hover:bg-primary/25 border-primary/40 text-primary-foreground/90'
      }`}
      onClick={() => (combatPhase ? exitCombat() : enterCombat())}
      title={
        blocked      ? 'Finish the combat already in progress'
      : combatPhase  ? 'Leave combat — anything you declared is untapped and forgotten'
      :                'Go to combat: open the attack zone in front of each opponent'
      }
    >
      <Swords className="w-3 h-3" />
      <span className="hidden sm:inline">{combatPhase ? 'End Combat' : 'Combat'}</span>
    </Button>
  );
}

export function NextTurnButton() {
  const nextTurn = usePlaytestStore(s => s.nextTurn);
  const draw = usePlaytestStore(s => s.draw);
  const turn = usePlaytestStore(s => s.turn);
  const runAllTurns = useOpponentStore(s => s.runAllTurns);
  const opponentCount = useOpponentStore(s => s.opponents.length);
  const combat = useOpponentStore(s => s.combat);
  const playerCombat = useOpponentStore(s => s.playerCombat);
  const exitCombat = useOpponentStore(s => s.exitCombat);
  const botsRunning = useOpponentStore(s => s.running);
  const autoTurns = usePlaytestSettings(s => s.opponentAutoTurns);

  // Locked while a bot's turn is in flight. runAllTurns already refuses to start
  // a second pass, so without this the button silently advanced YOUR turn and
  // drew you a card while the bots' turns were dropped on the floor — the game
  // desynced and nothing said so.
  //
  // Also locked on a confirmed attack of your own: blocks are chosen but damage
  // hasn't happened, and advancing past that would strand it the same way.
  const blocked = botsRunning || !!combat || !!playerCombat;

  // One button still drives the whole game: your turn, then every bot's, in order.
  // Unless you've turned that off, in which case the table waits for you.
  const handleNextTurn = () => {
    if (blocked) return;
    // Leave combat on the way out: an unconfirmed declaration never happened,
    // so untap and forget it rather than carrying a half-built attack — or an
    // open combat phase — into the bots' turn.
    exitCombat();
    nextTurn();
    draw(1);
    if (autoTurns) runAllTurns();
  };

  return (
    <Button
      size="sm"
      disabled={blocked}
      className={`h-8 sm:h-6 px-2 text-[11px] rounded-none border border-y-0 gap-1 ${
        combat
          ? 'bg-rose-500/15 border-rose-400/50 text-rose-200'
          : 'bg-primary/15 hover:bg-primary/25 border-primary/40 text-primary-foreground/90'
      }`}
      onClick={handleNextTurn}
      title={
        combat        ? 'Resolve combat before taking your next turn'
      : botsRunning   ? 'Waiting for the opponents to finish their turn'
      : opponentCount > 0 && autoTurns
          ? `Advance the turn, draw a card, then let ${opponentCount} opponent${opponentCount > 1 ? 's' : ''} take their turn`
          : 'Advance to the next turn and draw a card'
      }
    >
      <SkipForward className="w-3.5 h-3.5 sm:w-3 sm:h-3" />
      {combat ? (
        <span>Blocking…</span>
      ) : (
        <>
          <span className="sm:hidden">Turn</span>
          <span className="hidden sm:inline">Next Turn</span>
          <span className="opacity-60 tabular-nums text-[10px]">{turn}</span>
        </>
      )}
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
