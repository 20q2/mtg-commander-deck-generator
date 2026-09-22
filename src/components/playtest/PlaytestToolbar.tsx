import { useEffect, useState } from 'react';
import { Heart, X, Undo2, RefreshCw, Settings as SettingsIcon, PanelRight, FlaskConical } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { usePlaytestStore } from '@/store/playtestStore';
import { useDamageFlash } from '@/store/damageFlashStore';
import { useOpponentStore } from '@/store/opponentStore';
import { PlaytestSettingsModal } from '@/components/playtest/PlaytestSettingsModal';
import { AttackButton, NextTurnButton, CombatButton } from '@/components/playtest/PlaytestActionsBar';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { usePlaytestSettings } from '@/store/playtestSettingsStore';

interface Props {
  onExit: () => void;
  onToggleSidePanel?: () => void;
}

export function PlaytestToolbar({ onExit, onToggleSidePanel }: Props) {
  const isDesktop = useMediaQuery('(min-width: 768px)');
  const cardPreview = usePlaytestSettings(s => s.cardPreview);
  const animations = usePlaytestSettings(s => s.animations);
  const sourceName = usePlaytestStore(s => s.source?.name ?? '');
  const turn = usePlaytestStore(s => s.turn);
  const life = usePlaytestStore(s => s.life);
  const adjustLife = usePlaytestStore(s => s.adjustLife);
  const setLife = usePlaytestStore(s => s.setLife);
  const undo = usePlaytestStore(s => s.undo);
  const reset = usePlaytestStore(s => s.reset);
  const historyLen = usePlaytestStore(s => s.history.length);
  const modal = usePlaytestStore(s => s.modal);
  const openModal = usePlaytestStore(s => s.openModal);
  const closeModal = usePlaytestStore(s => s.closeModal);
  const trialCount = usePlaytestStore(s => s.trialPins.length);
  const trialOpen = modal?.kind === 'newCardTrial';
  const resetOpponents = useOpponentStore(s => s.resetAll);
  // Reset means "start this game over", so seated bots get a fresh board and
  // opening hand too — otherwise you'd redeal into their turn-9 battlefield.
  const handleReset = () => { reset(); resetOpponents(); };

  const [editingLife, setEditingLife] = useState(false);
  const [draftLife, setDraftLife] = useState(String(life));
  const [settingsOpen, setSettingsOpen] = useState(false);

  // Taking damage makes the life counter flinch. The damage-flash store is the
  // signal: every path that costs you life funnels through adjustLife, which
  // fires it, and the store also owns how long a hit lasts — so the pill stays
  // red for exactly as long as the "ouch" bloom at the edges of the table, with
  // no second timer to keep in step. Manually typing a new total isn't damage
  // and doesn't reach here.
  const hitId = useDamageFlash(s => s.flash?.id ?? null);
  const hurt = hitId !== null;
  // Consecutive hits have to re-shake, and re-applying the same animation-name
  // won't restart a running animation — hence alternating class names.
  const [hitSeq, setHitSeq] = useState(0);
  useEffect(() => { if (hitId) setHitSeq(n => n + 1); }, [hitId]);

  const lifeTone = hurt
    ? 'bg-red-500/30 border-red-400/80 text-red-200'
    : life <= 5  ? 'bg-red-500/20 border-red-400/60 text-red-300 animate-pulse-subtle'
    : life <= 10 ? 'bg-amber-500/20 border-amber-400/50 text-amber-300'
    :              'bg-emerald-500/15 border-emerald-400/40 text-emerald-300';
  const lifeShake = hurt && animations
    ? (hitSeq % 2 ? 'animate-life-hit' : 'animate-life-hit-alt')
    : '';

  // 28px tall and wide enough to hit with a thumb below md; md: restores the
  // padding-only box the desktop toolbar has always used.
  const tinyBtn = 'inline-flex items-center justify-center h-7 min-w-[28px] px-1.5 md:h-auto md:min-w-0 md:py-0.5 rounded bg-accent/40 hover:bg-accent text-[10px] font-medium';

  return (
    <div className="border-b border-border/50 bg-card/50 backdrop-blur px-2 sm:px-4 py-2 flex items-center gap-1 sm:gap-2 text-sm flex-wrap">
      <Button variant="ghost" size="sm" onClick={onExit}><X className="w-4 h-4 sm:mr-1" /><span className="hidden sm:inline">Exit</span></Button>
      <span className="text-muted-foreground/60 hidden sm:inline">|</span>
      {/* The deck name gives up a few percent of the viewport below sm so the
          life cluster — now thumb-sized — still shares the first row on a
          320px phone instead of wrapping onto one of its own. */}
      <span className="font-semibold truncate max-w-[24vw] sm:max-w-none">{sourceName}</span>
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
            className="w-14 mx-1 bg-emerald-500/15 border border-emerald-400/40 rounded px-1.5 py-0.5 text-emerald-300 font-bold text-center text-sm outline-none select-text"
          />
        ) : (
          <button
            data-float-id="player-life"
            onClick={() => { setDraftLife(String(life)); setEditingLife(true); }}
            className={`mx-1 inline-flex items-center gap-1 px-2 py-0.5 rounded border font-bold text-sm min-w-[48px] justify-center transition-colors ${lifeTone} ${lifeShake}`}
            title={life <= 10 ? `${life} life — you're in burn range. Click to edit.` : 'Click to edit life'}
          >
            <Heart
              className={`w-3 h-3 transition-colors ${
                hurt ? 'fill-red-400/70'
              : life <= 5 ? 'fill-red-400/40'
              : life <= 10 ? 'fill-amber-400/40'
              :              'fill-emerald-400/40'
              }`}
            />
            {life}
          </button>
        )}
        <button onClick={() => adjustLife(1)} className={tinyBtn} title="+1 life">+1</button>
        <button onClick={() => adjustLife(5)} className={tinyBtn} title="+5 life">+5</button>
      </div>

      {/* Force a row break on mobile so Next Turn + icon group land on their own row. */}
      <div className="basis-full h-0 md:hidden" aria-hidden />

      {/* Combat + Next Turn — only in the top toolbar on mobile. On desktop
          they live in the hand toolbar's right column. Rendered rather than
          CSS-hidden: two mounted copies doubled the DOM and meant a strict
          selector for "the Next Turn button" always matched two. */}
      {!isDesktop && (
        <div className="flex [&>*+*]:-ml-px">
          <AttackButton />
          <CombatButton />
          <NextTurnButton />
        </div>
      )}

      <div className="hidden lg:flex items-center gap-4 mx-auto select-none text-[10px] text-muted-foreground/70">
        {/* The gesture this hint names is a setting, so the hint has to read it
            rather than state the default — a tip for a key you no longer need
            to hold is worse than no tip. */}
        {cardPreview === 'hover' ? (
          <span
            className="inline-flex items-center gap-1"
            title="Point at a card for a larger preview · change under Settings → General"
          >
            <kbd className="px-1 py-0.5 rounded border border-border/60 bg-accent/30 font-mono text-[9px]">Hover</kbd>
            a card to magnify
          </span>
        ) : (
          <span
            className="inline-flex items-center gap-1"
            title="Hold Ctrl while hovering a card for a larger preview · change under Settings → General"
          >
            Hold <kbd className="px-1 py-0.5 rounded border border-border/60 bg-accent/30 font-mono text-[9px]">Ctrl</kbd>
            + hover to magnify
          </span>
        )}
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
        <Button variant="ghost" size="sm" onClick={handleReset} title="Reset playtest">
          <RefreshCw className="w-3.5 h-3.5 sm:mr-1" /><span className="hidden sm:inline">Reset</span>
        </Button>
        <Button
          variant={trialOpen ? 'secondary' : 'ghost'}
          size="sm"
          onClick={() => trialOpen ? closeModal() : openModal({ kind: 'newCardTrial' })}
          title="New Card Trial — force specific cards into your opening hand or the top of your library"
        >
          <FlaskConical className="w-3.5 h-3.5 sm:mr-1" /><span className="hidden sm:inline">Trial</span>
          {trialCount > 0 && (
            <span className="ml-1 px-1 rounded bg-violet-500/20 text-violet-300 tabular-nums text-[10px] font-semibold">
              {trialCount}
            </span>
          )}
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
