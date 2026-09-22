import { Eye, Shuffle, Sparkles, Trash2, Undo2 } from 'lucide-react';
import { useOpponentStore } from '@/store/opponentStore';
import { usePlaytestStore } from '@/store/playtestStore';
import {
  ContextMenuShell, MenuHeading, MenuItem, MenuSep,
} from '@/components/playtest/ContextMenuShell';

/** The zones a bot has that are worth acting on. Command is public and inert. */
export type OpponentMenuZone = 'hand' | 'library' | 'graveyard' | 'exile';

export interface OpponentZoneMenuTarget {
  opponentId: string;
  zone: OpponentMenuZone;
  x: number;
  y: number;
}

const ZONE_LABEL: Record<OpponentMenuZone, string> = {
  hand: 'Hand',
  library: 'Library',
  graveyard: 'Graveyard',
  exile: 'Exile',
};

/**
 * Right-click menu for one of a bot's zones — the resolution half of every card
 * that says "target opponent discards" or "target player mills".
 *
 * Everything here is done TO the bot — a mill, a random discard, a look at its
 * hand — so there is nothing for it to decide and you push the button. The
 * questions it does have to answer live in `OpponentChoiceMenu`, behind the
 * gavel on the seat header; if you find yourself wanting to add "sacrifices a
 * creature" to this menu, that is where it goes.
 *
 * Everything routes through the store's zone actions, which take an undo
 * checkpoint and write a log line, so a mis-click is one Ctrl+Z away and the
 * game log still reads as an account of what happened.
 */
export function OpponentZoneMenu({
  target, onClose,
}: {
  target: OpponentZoneMenuTarget | null;
  onClose: () => void;
}) {
  const opponent = useOpponentStore(s => s.opponents.find(o => o.id === target?.opponentId));
  const discardRandom = useOpponentStore(s => s.discardRandom);
  const millLibrary = useOpponentStore(s => s.millLibrary);
  const shuffleLibrary = useOpponentStore(s => s.shuffleLibrary);
  const exileGraveyard = useOpponentStore(s => s.exileGraveyard);
  const graveyardToLibrary = useOpponentStore(s => s.graveyardToLibrary);
  const openModal = usePlaytestStore(s => s.openModal);

  if (!target || !opponent) return null;
  const { opponentId, zone } = target;

  const act = (fn: () => void) => { fn(); onClose(); };
  const view = (z: 'hand' | 'library' | 'graveyard' | 'exile') => {
    onClose();
    openModal({ kind: 'opponentZone', opponentId, zone: z });
  };

  const counts = {
    hand: opponent.hand.length,
    library: opponent.library.length,
    graveyard: opponent.graveyard.length,
    exile: opponent.exile.length,
  };
  const count = counts[zone];

  return (
    <ContextMenuShell x={target.x} y={target.y} onClose={onClose} width={256}>
      <MenuHeading>
        {opponent.name} · {ZONE_LABEL[zone]}
        <span className="ml-1 font-normal text-muted-foreground/80 tabular-nums">({count})</span>
      </MenuHeading>
      <MenuSep />

      {zone === 'hand' && (
        <>
          {/* Hidden information you are allowed to look at only because
              something you cast said so — hence a deliberate menu item rather
              than a click on the fan, which would make peeking the default. */}
          <MenuItem icon={<Eye className="w-3.5 h-3.5" />} onClick={() => view('hand')} disabled={count === 0}>
            Look at their hand…
          </MenuItem>
          <CountRow
            icon={<Trash2 className="w-3.5 h-3.5" />}
            label="Discard at random"
            presets={[1, 2, 3]}
            max={count}
            onRun={n => act(() => discardRandom(opponentId, n))}
          />
        </>
      )}

      {zone === 'library' && (
        <>
          {/* Searching a library is the one thing here you do to find a
              particular card rather than to a number of them, so it leads. */}
          <MenuItem icon={<Eye className="w-3.5 h-3.5" />} onClick={() => view('library')} disabled={count === 0}>
            Search their library…
          </MenuItem>
          <MenuItem
            icon={<Shuffle className="w-3.5 h-3.5" />}
            onClick={() => act(() => shuffleLibrary(opponentId))}
            disabled={count < 2}
          >
            Shuffle their library
          </MenuItem>
          <MenuSep />
          <CountRow
            icon={<Trash2 className="w-3.5 h-3.5" />}
            label="Mill"
            presets={[1, 3, 5, 10]}
            max={count}
            onRun={n => act(() => millLibrary(opponentId, n, 'graveyard'))}
          />
          <CountRow
            icon={<Sparkles className="w-3.5 h-3.5" />}
            label="Exile top"
            presets={[1, 3, 5, 10]}
            max={count}
            onRun={n => act(() => millLibrary(opponentId, n, 'exile'))}
          />
        </>
      )}

      {zone === 'graveyard' && (
        <>
          <MenuItem icon={<Eye className="w-3.5 h-3.5" />} onClick={() => view('graveyard')} disabled={count === 0}>
            Look through it…
          </MenuItem>
          <MenuItem
            icon={<Sparkles className="w-3.5 h-3.5" />}
            onClick={() => act(() => exileGraveyard(opponentId))}
            disabled={count === 0}
          >
            Exile their graveyard
          </MenuItem>
          <MenuItem
            icon={<Undo2 className="w-3.5 h-3.5" />}
            onClick={() => act(() => graveyardToLibrary(opponentId))}
            disabled={count === 0}
          >
            Shuffle it into their library
          </MenuItem>
        </>
      )}

      {zone === 'exile' && (
        <MenuItem icon={<Eye className="w-3.5 h-3.5" />} onClick={() => view('exile')} disabled={count === 0}>
          Look through it…
        </MenuItem>
      )}
    </ContextMenuShell>
  );
}

/**
 * An action and the sizes you might want of it — "Mill: 1 3 5 10 All".
 *
 * It replaced a −/+ stepper, which was correct and unusable: milling seven
 * meant six clicks on a plus button before the click that did anything. The
 * counts people actually reach for are few enough to just put on the row.
 */
function CountRow({
  icon, label, presets, max, onRun,
}: {
  icon: React.ReactNode;
  label: string;
  /** Offered in order. Any that the zone can't cover are dropped. */
  presets: number[];
  /** How many are actually there — also what "All" means. */
  max: number;
  onRun: (n: number) => void;
}) {
  const empty = max === 0;
  // Nothing past the end of the zone: "Mill 10" against six cards is the same
  // button as "All", and two buttons that do the same thing is a question.
  const shown = presets.filter(n => n < max);

  return (
    <div className="flex items-center gap-2 px-2.5 py-1">
      <span className="w-4 flex items-center justify-center opacity-70 shrink-0">{icon}</span>
      <span className={`flex-1 min-w-0 truncate ${empty ? 'opacity-40' : ''}`}>{label}</span>
      <span className="flex items-center gap-0.5 shrink-0">
        {shown.map(n => (
          <button
            key={n}
            role="menuitem"
            onClick={() => onRun(n)}
            title={`${label} ${n}`}
            className="min-w-[18px] h-5 px-1 rounded bg-accent/40 hover:bg-violet-500/40 text-[10px] font-medium tabular-nums transition-colors"
          >
            {n}
          </button>
        ))}
        <button
          role="menuitem"
          onClick={() => onRun(max)}
          disabled={empty}
          title={`${label} ${max}`}
          className="h-5 px-1.5 rounded bg-accent/40 hover:bg-violet-500/40 text-[10px] font-medium transition-colors disabled:opacity-30 disabled:hover:bg-accent/40"
        >
          {max > 1 ? 'All' : '1'}
        </button>
      </span>
    </div>
  );
}
