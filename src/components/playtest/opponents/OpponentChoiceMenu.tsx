import { useEffect, useState } from 'react';
import { Skull, Trash2, Undo2 } from 'lucide-react';
import { useOpponentStore } from '@/store/opponentStore';
import { ContextMenuShell, MenuHeading, MenuItem, MenuSep } from '@/components/playtest/ContextMenuShell';
import { canGiveUp, CHOICE_LABEL, type BotDecision, type ChoiceType } from '@/services/playtest/opponents/choices';
import type { Opponent } from '@/components/playtest/opponentTypes';

export interface OpponentChoiceMenuTarget {
  opponentId: string;
  x: number;
  y: number;
}

/**
 * The decisions a bot makes because YOU cast something.
 *
 * Sibling to `OpponentZoneMenu`, and the answer to what that menu can't do:
 * milling a bot is a thing you do TO it, but "each player sacrifices a creature"
 * is a thing it has to answer. The picking lives in `choices.ts`; this is where
 * you ask.
 *
 * Scope is a toggle rather than a second copy of every item, because the cards
 * that ask these questions are mostly symmetric — Rise of the Witch-king hits
 * the whole table, and a three-seat pod should not be three trips through a
 * menu. The store takes one undo checkpoint per sweep, so it's one Ctrl+Z back.
 */
export function OpponentChoiceMenu({
  target, onClose,
}: {
  target: OpponentChoiceMenuTarget | null;
  onClose: () => void;
}) {
  const opponents = useOpponentStore(s => s.opponents);
  const botGiveUp = useOpponentStore(s => s.botGiveUp);
  const [everySeat, setEverySeat] = useState(false);

  // Scope goes back to this seat every time the menu opens. A sticky "every
  // seat" is exactly the kind of setting you forget you left on, and the cost
  // of forgetting is a targeted edict quietly sweeping the whole table.
  useEffect(() => { if (target) setEverySeat(false); }, [target]);

  const opponent = opponents.find(o => o.id === target?.opponentId);
  if (!target || !opponent) return null;

  // The seats the store will actually act on. A seat at zero is out of the
  // game and answers nothing, so it is excluded here too — otherwise an item
  // would look available and then quietly do nothing.
  const live = opponents.filter(o => o.life > 0);
  const seats: Opponent[] = everySeat ? live : live.filter(o => o.id === opponent.id);
  const ids = seats.map(o => o.id);

  const ask = (decision: BotDecision) => {
    botGiveUp(decision, ids);
    onClose();
  };

  return (
    <ContextMenuShell x={target.x} y={target.y} onClose={onClose} width={236}>
      <MenuHeading>{opponent.name} · decisions</MenuHeading>

      {/* Only worth a toggle when there is more than one seat to spread it
          across. On a one-bot table the two settings are the same table. */}
      {live.length > 1 && (
        <div className="px-2.5 pb-1.5 flex gap-1">
          <ScopePill active={!everySeat} onClick={() => setEverySeat(false)}>
            This seat
          </ScopePill>
          <ScopePill active={everySeat} onClick={() => setEverySeat(true)}>
            Every seat
          </ScopePill>
        </div>
      )}
      <MenuSep />

      <SectionLabel>Sacrifice</SectionLabel>
      {SAC_TYPES.map(of => (
        <MenuItem
          key={of}
          icon={<Skull className="w-3.5 h-3.5" />}
          disabled={!seats.some(o => canGiveUp(o, of))}
          onClick={() => ask({ kind: 'sacrifice', of })}
        >
          {CHOICE_LABEL[of]}
        </MenuItem>
      ))}

      <MenuSep />
      <SectionLabel>Return to hand</SectionLabel>
      {BOUNCE_TYPES.map(of => (
        <MenuItem
          key={of}
          icon={<Undo2 className="w-3.5 h-3.5" />}
          disabled={!seats.some(o => canGiveUp(o, of))}
          onClick={() => ask({ kind: 'bounce', of })}
        >
          {CHOICE_LABEL[of]}
        </MenuItem>
      ))}

      <MenuSep />
      <SectionLabel>Discard</SectionLabel>
      <MenuItem
        icon={<Trash2 className="w-3.5 h-3.5" />}
        disabled={!seats.some(o => o.hand.length > 0)}
        onClick={() => ask({ kind: 'discard' })}
      >
        a card of their choice
      </MenuItem>
    </ContextMenuShell>
  );
}

/**
 * Ordered by how often a card asks for it, not by how broad it is — "sacrifice
 * a creature" is most of the edicts ever printed, so it is the first thing your
 * eye lands on. Planeswalkers are absent on purpose: no bundled deck runs one,
 * and a menu item that is disabled on every board only ever says no.
 */
const SAC_TYPES: ChoiceType[] = ['creature', 'permanent', 'artifact', 'enchantment', 'land'];

/**
 * Bounce needs far fewer: the printed cards say "a creature you control" or
 * "a permanent you control" and essentially nothing else.
 */
const BOUNCE_TYPES: ChoiceType[] = ['creature', 'permanent'];

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="px-2.5 pb-0.5 text-[9px] font-semibold uppercase tracking-wide text-muted-foreground/70">
      {children}
    </div>
  );
}

function ScopePill({
  active, onClick, children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      aria-pressed={active}
      className={`flex-1 px-1.5 py-1 rounded border text-[10px] font-medium transition-colors ${
        active
          ? 'border-violet-400/60 bg-violet-500/20 text-violet-100'
          : 'border-border/60 text-muted-foreground hover:bg-accent'
      }`}
    >
      {children}
    </button>
  );
}
