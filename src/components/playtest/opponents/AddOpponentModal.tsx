import { useEffect, useMemo, useState } from 'react';
import { Loader2, Plus, Trash2, X } from 'lucide-react';
import { usePlaytestStore } from '@/store/playtestStore';
import { useOpponentStore, MAX_OPPONENTS } from '@/store/opponentStore';
import { OPPONENT_STUBS } from '@/services/playtest/opponents/deckSources';
import { getCardsByNames } from '@/services/scryfall/client';
import { FloatingDialog } from '@/components/playtest/FloatingDialog';
import { BRACKET_LABELS, type Bracket, type OpponentStub } from '@/components/playtest/opponentTypes';
import { deckReadiness, type ReadinessLevel } from '@/services/playtest/opponents/deckReadiness';

/**
 * Deliberately not the bracket palette: a bracket says what kind of game this
 * is, readiness says whether the bot has learned the deck yet. They sit inches
 * apart, so they must not read as the same axis. Unfinished is grey rather than
 * red — it isn't broken, just not taught.
 *
 * Tints are heavier than a normal chip's because these ride on top of card art
 * rather than on the dialog's own surface.
 */
const READINESS_TINT: Record<ReadinessLevel, string> = {
  ready: 'bg-emerald-500/25 text-emerald-200 border-emerald-400/50',
  playable: 'bg-amber-500/25 text-amber-200 border-amber-400/50',
  rough: 'bg-zinc-900/70 text-zinc-300 border-zinc-400/40',
  unmeasured: 'bg-zinc-900/70 text-zinc-300 border-zinc-400/40',
};

/** Cool at the bottom of the range, hot at the top. */
const BRACKET_TINT: Record<Bracket, string> = {
  1: 'bg-sky-500/25 text-sky-200 border-sky-400/50',
  2: 'bg-emerald-500/25 text-emerald-200 border-emerald-400/50',
  3: 'bg-amber-500/25 text-amber-200 border-amber-400/50',
  4: 'bg-orange-500/25 text-orange-200 border-orange-400/50',
  5: 'bg-rose-500/25 text-rose-200 border-rose-400/50',
};

/**
 * Wash painted behind a tile whose art hasn't arrived (or never will). Mixing
 * the deck's own colours means the empty state still says something true about
 * the deck instead of showing a grey box.
 */
const MANA_HEX: Record<string, string> = {
  w: '#d9cfa2', u: '#2a6fae', b: '#3c3244', r: '#b0392f', g: '#2f7a52', c: '#6b6b6b',
};

function colorWash(colors: string[]): string {
  const hexes = (colors.length ? colors : ['c']).map(c => MANA_HEX[c.toLowerCase()] ?? MANA_HEX.c);
  if (hexes.length === 1) return `linear-gradient(135deg, ${hexes[0]}, #0d0d12)`;
  return `linear-gradient(135deg, ${hexes.join(', ')})`;
}

/**
 * Commander art for the whole roster, in one batched (and cached) lookup.
 *
 * Fetching per tile would be a request per deck and a staggered pop-in; the
 * roster is small enough to be a single Scryfall collection call, and after the
 * first open it comes straight back out of the card cache. Art is decoration —
 * a failure leaves the colour wash standing and the picker still works.
 */
function useCommanderArt(stubs: OpponentStub[]): Map<string, string> {
  const [art, setArt] = useState<Map<string, string>>(new Map());

  const names = useMemo(
    () => Array.from(new Set(stubs.map(s => s.commander))),
    [stubs],
  );

  useEffect(() => {
    let cancelled = false;
    getCardsByNames(names)
      .then(cards => {
        if (cancelled) return;
        const next = new Map<string, string>();
        for (const [name, card] of cards) {
          const url = card.image_uris?.art_crop ?? card.card_faces?.[0]?.image_uris?.art_crop;
          if (url) next.set(name, url);
        }
        setArt(next);
      })
      .catch(() => { /* colour wash stands in */ });
    return () => { cancelled = true; };
  }, [names]);

  return art;
}

export function AddOpponentModal() {
  const closeModal = usePlaytestStore(s => s.closeModal);
  const opponents = useOpponentStore(s => s.opponents);
  const loadingStubIds = useOpponentStore(s => s.loadingStubIds);
  const error = useOpponentStore(s => s.error);
  const addFromStub = useOpponentStore(s => s.addFromStub);
  const remove = useOpponentStore(s => s.remove);
  const clearError = useOpponentStore(s => s.clearError);

  // A failure belongs to the visit that caused it. Closing the picker and
  // opening it again should not show you last time's error.
  useEffect(() => clearError, [clearError]);

  const art = useCommanderArt(OPPONENT_STUBS);
  const full = opponents.length >= MAX_OPPONENTS;

  /**
   * Grouped by bracket, ascending.
   *
   * A flat list was fine at four decks and stops being fine well before ten.
   * Bracket is also the single most useful thing to sort by: it is the one
   * number that says what kind of game you are signing up for.
   */
  const byBracket = useMemo(() => {
    const groups = new Map<Bracket, OpponentStub[]>();
    for (const stub of OPPONENT_STUBS) {
      const list = groups.get(stub.bracket) ?? [];
      list.push(stub);
      groups.set(stub.bracket, list);
    }
    return [...groups.entries()]
      .sort(([a], [b]) => a - b)
      .map(([bracket, stubs]) => ({ bracket, stubs }));
  }, []);

  return (
    <FloatingDialog
      title="Play against bots"
      onClose={closeModal}
      width={780}
      height={620}
      minWidth={380}
      minHeight={360}
      resizable
      storageKey="playtest-opponents-pos"
      sizeStorageKey="playtest-opponents-size"
      headerExtra={
        <span
          className={`shrink-0 ml-1 px-2 py-0.5 rounded-full border text-[10px] font-medium tabular-nums ${
            full
              ? 'border-violet-400/50 bg-violet-500/15 text-violet-200'
              : 'border-border/60 bg-muted/40 text-muted-foreground'
          }`}
        >
          {opponents.length} / {MAX_OPPONENTS} seated
        </span>
      }
    >
      {/* Three bands, so a roster taller than the dialog scrolls on its own
          rather than pushing Done off the bottom: blurb, scrolling grid, footer.
          `min-h-0` is what lets the middle one shrink inside the flex column —
          without it the grid's content height wins and nothing scrolls. */}
      <div className="px-4 pt-3 pb-1 shrink-0 space-y-2">
        <p className="text-xs text-muted-foreground">
          Pick a deck to sit across from you. Bots play lands, cast what they can afford, block,
          and attack whoever looks softest.
        </p>

        {error && (
          <div className="px-2.5 py-2 rounded-lg border border-red-500/30 bg-red-500/5 text-xs text-red-400 flex items-start gap-2">
            <span className="flex-1 min-w-0">{error}</span>
            <button
              onClick={clearError}
              title="Dismiss"
              className="shrink-0 text-red-400/70 hover:text-red-300 transition-colors"
            >
              <X className="w-3 h-3" />
            </button>
          </div>
        )}
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto px-4 py-2">
        <div className="space-y-5">
          {byBracket.map(({ bracket, stubs }) => {
            const { name, hint } = BRACKET_LABELS[bracket];
            return (
              <div key={bracket} className="space-y-2">
                <div className="flex items-baseline gap-2" title={hint}>
                  <span
                    className={`shrink-0 self-center inline-flex items-center justify-center w-4 h-4 rounded border text-[10px] font-bold ${BRACKET_TINT[bracket]}`}
                  >
                    {bracket}
                  </span>
                  <span className="text-xs font-semibold shrink-0">{name}</span>
                  <span className="text-[10px] text-muted-foreground/70 truncate">{hint}</span>
                </div>

                {/* auto-fill rather than a fixed column count: the dialog is
                    resizable, so tiles per row has to follow the dialog's own
                    width, which no viewport breakpoint knows about. */}
                <div
                  className="grid gap-3"
                  style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(228px, 1fr))' }}
                >
                  {stubs.map(stub => (
                    <DeckTile
                      key={stub.id}
                      stub={stub}
                      artUrl={art.get(stub.commander)}
                      loading={loadingStubIds.includes(stub.id)}
                      seatedIds={opponents.filter(o => o.stubId === stub.id).map(o => o.id)}
                      full={full}
                      onSeat={() => addFromStub(stub.id)}
                      onUnseat={remove}
                    />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="flex items-center justify-between gap-3 px-4 py-2.5 border-t border-border/40 shrink-0">
        <span className="text-[10px] text-muted-foreground/70 truncate">
          {full ? 'Table is full — remove a seat to swap decks.' : 'Click a deck to seat it.'}
        </span>
        <button
          onClick={closeModal}
          className="shrink-0 h-7 px-4 rounded-md bg-violet-600 hover:bg-violet-500 text-white text-xs font-medium transition-colors"
        >
          Done
        </button>
      </div>
    </FloatingDialog>
  );
}

interface TileProps {
  stub: OpponentStub;
  artUrl?: string;
  loading: boolean;
  seatedIds: string[];
  full: boolean;
  onSeat: () => void;
  onUnseat: (id: string) => void;
}

/**
 * One deck, sold on its commander's art.
 *
 * The whole tile is the seat control — a poster you click, not a row with a
 * button bolted to the end — so the click target is the thing you were already
 * looking at. The seated chips are the exception: real buttons that stop the
 * click from bubbling, because "remove this seat" has to live inside the tile
 * it belongs to without becoming the tile's own action.
 */
function DeckTile({ stub, artUrl, loading, seatedIds, full, onSeat, onUnseat }: TileProps) {
  const readiness = deckReadiness(stub.id);
  const seated = seatedIds.length > 0;
  const blocked = (full && !seated) || loading;

  const activate = () => { if (!blocked) onSeat(); };

  return (
    <div
      role="button"
      tabIndex={blocked ? -1 : 0}
      aria-disabled={blocked}
      onClick={activate}
      onKeyDown={e => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); activate(); }
      }}
      title={
        full && !seated
          ? `Table is full (${MAX_OPPONENTS} opponents)`
          : `Seat ${stub.name} — ${stub.commander}`
      }
      className={`group relative flex flex-col rounded-xl overflow-hidden border text-left outline-none transition-all
        focus-visible:ring-2 focus-visible:ring-violet-400/70
        ${seated
          ? 'border-violet-400/60 ring-1 ring-violet-400/30'
          : 'border-border/50 hover:border-violet-400/50'}
        ${blocked
          ? 'opacity-55 cursor-not-allowed'
          : 'cursor-pointer hover:shadow-lg hover:shadow-black/40'}`}
    >
      {/* Art band. Fixed aspect, so slow or missing art never reflows the grid. */}
      <div className="relative aspect-[16/7] overflow-hidden" style={{ background: colorWash(stub.colors) }}>
        {artUrl && (
          <img
            src={artUrl}
            alt=""
            loading="lazy"
            className="absolute inset-0 w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
            style={{ objectPosition: '50% 32%' }}
          />
        )}
        {/* Dark at both ends: the bottom stop carries the title, the fainter top
            one keeps the corner chips legible over pale art. */}
        <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/25 to-black/45" />

        <span
          className={`absolute top-1.5 left-1.5 inline-flex items-center justify-center w-4 h-4 rounded border text-[10px] font-bold backdrop-blur-sm ${BRACKET_TINT[stub.bracket]}`}
          title={BRACKET_LABELS[stub.bracket].hint}
        >
          {stub.bracket}
        </span>

        {/* Whether the bot has been taught this deck — the one thing worth
            knowing before you sit down, so it rides on the art rather than
            waiting at the bottom as a footnote. */}
        <span
          title={readiness.detail}
          className={`absolute top-1.5 right-1.5 inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full border text-[9px] font-medium backdrop-blur-sm ${READINESS_TINT[readiness.level]}`}
        >
          <span className="w-1 h-1 rounded-full bg-current" aria-hidden />
          {readiness.label}
        </span>

        <div className="absolute inset-x-0 bottom-0 p-2 flex items-end gap-2">
          <div className="min-w-0 flex-1">
            <div className="text-[13px] font-semibold text-white leading-tight truncate drop-shadow">
              {stub.name}
            </div>
            <div className="text-[10px] text-white/70 leading-tight truncate">{stub.commander}</div>
          </div>
          <span className="flex items-center gap-0.5 shrink-0 pb-0.5">
            {stub.colors.map(c => (
              <i key={c} className={`ms ms-${c.toLowerCase()} ms-cost text-[11px]`} aria-hidden />
            ))}
          </span>
        </div>
      </div>

      {/* Info band. */}
      <div className="flex-1 flex flex-col gap-1.5 p-2.5 bg-card/60">
        <p className="text-[11px] text-muted-foreground leading-snug line-clamp-2">{stub.blurb}</p>

        <div className="mt-auto flex items-center gap-2">
          <span className="text-[10px] text-muted-foreground/60 truncate flex-1 min-w-0">
            {stub.source ?? 'Hand-built'}
          </span>

          {seatedIds.map((id, i) => (
            <button
              key={id}
              onClick={e => { e.stopPropagation(); onUnseat(id); }}
              title={`Remove ${stub.name} from the table`}
              className="shrink-0 inline-flex items-center gap-1 px-1.5 py-0.5 rounded border border-violet-400/40 bg-violet-500/15 text-[10px] text-violet-200 hover:bg-red-500/15 hover:border-red-400/50 hover:text-red-200 transition-colors"
            >
              <Trash2 className="w-2.5 h-2.5" />
              Remove{seatedIds.length > 1 ? ` #${i + 1}` : ''}
            </button>
          ))}

          {/* Reads as a button and answers "what happens if I click?", but it
              isn't one — the tile around it already is. Hidden once the table is
              full and this deck is already on it: "Seat" next to "Remove" on a
              table with no room read as two live choices, and only one was. */}
          {(!seated || !full) && (
            <span
              className={`shrink-0 inline-flex items-center gap-1 px-2 py-0.5 rounded-md border text-[10px] font-medium transition-colors ${
                blocked
                  ? 'border-border/50 text-muted-foreground/60'
                  : 'border-violet-400/40 bg-violet-500/10 text-violet-200 group-hover:bg-violet-500/25 group-hover:border-violet-400/70'
              }`}
            >
              {loading
                ? <><Loader2 className="w-2.5 h-2.5 animate-spin" />Dealing…</>
                : <><Plus className="w-2.5 h-2.5" />{seated ? 'Seat another' : 'Seat'}</>}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
