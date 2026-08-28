import { useState, useEffect, useMemo, useRef } from 'react';
import { ColorIdentity } from '@/components/ui/mtg-icons';
import { ColorFilterChips } from '@/components/commander/ColorFilterChips';
import { CollectionImporter } from '@/components/collection/CollectionImporter';
import { getCardsByNames, getCardImageUrl } from '@/services/scryfall/client';
import { fetchCardTopCommanders, isPartnerPair } from '@/services/edhrec/client';
import type { CardCommanderStat } from '@/services/edhrec/client';
import { scoreCommanderMatches } from '@/services/commanderMatch/scoreCommanders';
import type { CommanderMatch, SeedResult } from '@/services/commanderMatch/scoreCommanders';
import { Loader2, X } from 'lucide-react';
import type { ScryfallCard } from '@/types';

/** Each seed costs one EDHREC page fetch (rate-limited to 100ms), and coverage gets noisy past this. */
const MAX_SEEDS = 25;
/**
 * Scored candidates we resolve on Scryfall (for identity + art). This slice happens BEFORE the
 * color filter — identity isn't known until Scryfall answers — so it must be much larger than
 * SHOW_RESULTS. At 24 a narrow color pick (say Azorius over a five-color pile) filtered down to a
 * single row, because nearly every top-scoring candidate was a wide commander.
 */
const ENRICH_CANDIDATES = 60;
const SHOW_RESULTS = 10;
const SEEDS_KEY = 'mtg-card-group-seeds';
const COLOR_KEY = 'mtg-card-group-colors';

/** True when `identity` fits entirely inside `allowed`. */
function withinColors(identity: string[], allowed: Set<string>): boolean {
  return identity.every(c => allowed.has(c));
}

export interface CardGroupSearchProps {
  /** Chosen commander + the seed cards that produced it. The host resolves the card and navigates. */
  onSelectCommander: (commanderName: string, seeds: string[]) => void | Promise<void>;
}

export function CardGroupSearch({ onSelectCommander }: CardGroupSearchProps) {
  const [seeds, setSeeds] = useState<string[]>(() => {
    try {
      const saved = localStorage.getItem(SEEDS_KEY);
      const parsed = saved ? JSON.parse(saved) : [];
      return Array.isArray(parsed) ? parsed.slice(0, MAX_SEEDS) : [];
    } catch { return []; }
  });
  useEffect(() => { localStorage.setItem(SEEDS_KEY, JSON.stringify(seeds)); }, [seeds]);

  // Empty = no ceiling, and every suggested commander must be able to play the whole group.
  // Non-empty = "build me a deck in these colors": the commander's identity must fit inside
  // the picked colors, and cards that fall outside get dropped instead of blocking results.
  const [colorFilter, setColorFilter] = useState<Set<string>>(() => {
    try {
      const saved = localStorage.getItem(COLOR_KEY);
      return saved ? new Set<string>(JSON.parse(saved)) : new Set<string>();
    } catch { return new Set<string>(); }
  });
  useEffect(() => { localStorage.setItem(COLOR_KEY, JSON.stringify([...colorFilter])); }, [colorFilter]);
  const capped = colorFilter.size > 0;

  // The importer calls onImportCards after an await, so its closure holds the render-time prop.
  // A ref keeps the merge reading the current seeds rather than a stale copy.
  const seedsRef = useRef(seeds);
  seedsRef.current = seeds;

  // EDHREC top-commander data per seed. A missing key means "still loading";
  // an empty array means "resolved, but EDHREC has nothing for this card".
  const [seedData, setSeedData] = useState<Record<string, CardCommanderStat[]>>({});
  const [cards, setCards] = useState<Map<string, ScryfallCard>>(new Map());
  const [selecting, setSelecting] = useState(false);
  /** Names dropped because the group was already full — surfaced, never silently truncated. */
  const [overflow, setOverflow] = useState<string[]>([]);

  // Resolve each seed independently, so one dud card can't stall the panel.
  useEffect(() => {
    let cancelled = false;
    for (const name of seeds) {
      if (name in seedData) continue;
      fetchCardTopCommanders(name)
        .then(list => {
          if (!cancelled) setSeedData(prev => (name in prev ? prev : { ...prev, [name]: list }));
        })
        .catch(() => {});
    }
    return () => { cancelled = true; };
  }, [seeds, seedData]);

  /** Bulk import merges into the group — pasting again adds, it never wipes what's there. */
  const handleImportCards = (validatedNames: string[]) => {
    const current = seedsRef.current;
    const seen = new Set(current.map(s => s.toLowerCase()));
    const next = [...current];
    const dropped: string[] = [];
    let added = 0;
    for (const name of validatedNames) {
      if (seen.has(name.toLowerCase())) continue;
      if (next.length >= MAX_SEEDS) { dropped.push(name); continue; }
      seen.add(name.toLowerCase());
      next.push(name);
      added++;
    }
    setSeeds(next);
    setOverflow(dropped);
    return { added, updated: 0 };
  };

  const removeSeed = (name: string) => setSeeds(prev => prev.filter(s => s !== name));
  const clearSeeds = () => { setSeeds([]); setOverflow([]); };

  // Score over RESOLVED seeds only — a still-loading seed shouldn't dilute coverage.
  const resolved: SeedResult[] = useMemo(
    () => seeds.filter(n => n in seedData).map(n => ({ name: n, commanders: seedData[n] })),
    [seeds, seedData]
  );
  const pendingCount = seeds.length - resolved.length;

  const scored = useMemo(
    () => scoreCommanderMatches(resolved).filter(m => !isPartnerPair(m.name)),
    [resolved]
  );
  const topCandidates = useMemo(() => scored.slice(0, ENRICH_CANDIDATES), [scored]);

  // One batched Scryfall call covers both the seeds (for their color identity) and the
  // candidates (identity + art). Keyed on the name list so it only refires on real change.
  const enrichKey = useMemo(
    () => [...seeds, '::', ...topCandidates.map(c => c.name)].join('|'),
    [seeds, topCandidates]
  );
  useEffect(() => {
    const names = [...new Set([...seeds, ...topCandidates.map(c => c.name)])];
    if (names.length === 0) return;
    let cancelled = false;
    getCardsByNames(names)
      .then(map => { if (!cancelled) setCards(map); })
      .catch(() => {});
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enrichKey]);

  // Union of the seed cards' color identities — the constraint when no ceiling is picked.
  const seedIdentity = useMemo(() => {
    const set = new Set<string>();
    for (const n of seeds) {
      for (const c of cards.get(n)?.color_identity ?? []) set.add(c);
    }
    return set;
  }, [seeds, cards]);

  /** Seeds that fall outside the picked colors — shown struck through, dropped on handoff. */
  const offColorSeeds = useMemo(() => {
    if (!capped) return new Set<string>();
    return new Set(seeds.filter(n => {
      const ci = cards.get(n)?.color_identity;
      return ci ? !withinColors(ci, colorFilter) : false;
    }));
  }, [capped, seeds, cards, colorFilter]);

  // Color filter runs AFTER scoring so it never distorts the ranking.
  const { rows, filteredByColor } = useMemo(() => {
    const out: CommanderMatch[] = [];
    let dropped = 0;
    for (const m of topCandidates) {
      const card = cards.get(m.name);
      if (!card) continue;   // identity unknown — can't vouch for legality, so don't offer it
      const ci = card.color_identity;
      // With a ceiling picked the commander must fit inside it, and we no longer insist it can
      // play every card. Without one, it must cover the whole group.
      const ok = capped
        ? withinColors(ci, colorFilter)
        : [...seedIdentity].every(c => ci.includes(c));
      if (!ok) { dropped++; continue; }
      out.push({ ...m, colorIdentity: ci });
      if (out.length >= SHOW_RESULTS) break;
    }
    // `dropped` only matters when out is empty, in which case the loop never broke early.
    return { rows: out, filteredByColor: dropped };
  }, [topCandidates, cards, seedIdentity, capped, colorFilter]);

  /** Cards this commander can legally run — the only ones worth sending to the builder. */
  const playableSeeds = (commanderIdentity: string[]) =>
    seeds.filter(n => {
      const ci = cards.get(n)?.color_identity;
      return ci ? withinColors(ci, new Set(commanderIdentity)) : true;
    });

  const handleSelect = async (match: CommanderMatch) => {
    setSelecting(true);
    try {
      // Off-color cards can't be built with this commander, so they don't travel to the builder.
      await onSelectCommander(match.name, playableSeeds(match.colorIdentity));
    } finally {
      setSelecting(false);
    }
  };

  return (
    <div className="text-left max-w-xl mx-auto">
      <CollectionImporter
        onImportCards={handleImportCards}
        label="Your cards"
        updatedLabel="already in the group"
      />

      {overflow.length > 0 && (
        <p className="mt-2 text-xs text-amber-500">
          Group is full at {MAX_SEEDS} cards — {overflow.length} more {overflow.length === 1 ? 'was' : 'were'} left
          out. Remove a card to make room.
        </p>
      )}

      {/* Colour ceiling */}
      {seeds.length > 0 && (
        <div className="mt-4 flex items-center gap-3">
          <span className="text-sm font-medium shrink-0">Deck colors</span>
          <ColorFilterChips
            value={colorFilter}
            onChange={setColorFilter}
            className="flex gap-1.5 items-center"
          />
        </div>
      )}
      {seeds.length > 0 && (
        <p className="mt-1 text-[11px] text-muted-foreground/70">
          {capped
            ? `Only commanders inside these colors. ${offColorSeeds.size > 0 ? `${offColorSeeds.size} of your cards can't be played in them and won't be carried into the build.` : 'All of your cards fit.'}`
            : 'Any colors — every suggested commander can play your whole group. Pick colors to narrow the deck instead.'}
        </p>
      )}

      {/* The current group */}
      {seeds.length > 0 && (
        <div className="mt-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium">
              Your card group <span className="text-muted-foreground">({seeds.length})</span>
            </span>
            <button
              onClick={clearSeeds}
              className="text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              Clear all
            </button>
          </div>
          <div className="flex flex-wrap gap-2">
            {seeds.map(name => {
              const card = cards.get(name);
              const noData = name in seedData && seedData[name].length === 0;
              const offColor = offColorSeeds.has(name);
              return (
                <span
                  key={name}
                  className={`flex items-center gap-1.5 pl-2.5 pr-1.5 py-1.5 backdrop-blur-sm rounded-full text-sm ${offColor ? 'bg-accent/20' : 'bg-accent/50'}`}
                  title={
                    offColor ? "Outside your chosen colors — won't be built with"
                    : noData ? 'No EDHREC data for this card'
                    : undefined
                  }
                >
                  {card && card.color_identity.length > 0 && (
                    <span className={offColor ? 'opacity-40' : undefined}>
                      <ColorIdentity colors={card.color_identity} size="sm" />
                    </span>
                  )}
                  <span className={offColor ? 'text-muted-foreground/50 line-through' : noData ? 'text-muted-foreground/70' : 'text-foreground/90'}>
                    {name}
                  </span>
                  {offColor && <span className="text-[10px] text-muted-foreground/50">off-color</span>}
                  {!offColor && noData && <span className="text-[10px] text-muted-foreground/60">no data</span>}
                  {!(name in seedData) && <Loader2 className="w-3 h-3 animate-spin text-muted-foreground/60" />}
                  <button
                    onClick={() => removeSeed(name)}
                    className="p-0.5 rounded-full text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
                    aria-label={`Remove ${name}`}
                  >
                    <X className="w-3 h-3" />
                  </button>
                </span>
              );
            })}
          </div>
        </div>
      )}

      {/* Results */}
      <div className="mt-5">
        {seeds.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center">
            Paste the cards you want to build around and we'll find the commanders that play them.
          </p>
        ) : rows.length > 0 ? (
          <>
            <p className="text-sm font-medium mb-2">Commanders for these cards</p>
            <div className="space-y-1.5">
              {rows.map(m => (
                <button
                  key={m.name}
                  onClick={() => handleSelect(m)}
                  disabled={selecting}
                  className="w-full flex items-center gap-3 p-2 rounded-lg text-left hover:bg-accent/50 transition-colors group disabled:opacity-50"
                >
                  {cards.get(m.name) && (
                    <img
                      src={getCardImageUrl(cards.get(m.name)!, 'small')}
                      alt={m.name}
                      className="w-10 h-auto rounded shadow"
                    />
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="font-medium truncate group-hover:text-primary transition-colors">{m.name}</p>
                    <div className="flex items-center gap-2 mt-0.5">
                      <ColorIdentity colors={m.colorIdentity.length > 0 ? m.colorIdentity : ['C']} size="sm" />
                      <span className="text-xs text-muted-foreground">
                        plays {m.matchedSeeds.length} of {resolved.length}
                      </span>
                    </div>
                  </div>
                  <span className="text-xs text-violet-300/80 tabular-nums shrink-0">
                    {(m.score * 100).toFixed(0)}
                  </span>
                </button>
              ))}
            </div>
            <p className="mt-3 text-[11px] text-muted-foreground/70 leading-relaxed">
              Coverage is measured against each card's top 24 commanders on EDHREC, so "plays 3 of 5"
              means it's a top-24 commander for 3 of your cards.
            </p>
          </>
        ) : pendingCount > 0 ? (
          <div className="flex justify-center py-4">
            <Loader2 className="w-5 h-5 animate-spin text-primary" />
          </div>
        ) : capped && filteredByColor > 0 ? (
          <p className="text-sm text-muted-foreground text-center">
            No commanders for these cards fit inside those colors — add a color or clear the filter.
          </p>
        ) : filteredByColor > 0 ? (
          <p className="text-sm text-muted-foreground text-center">
            Your cards span more colors than any suggested commander covers — pick fewer deck colors
            above, or remove a card.
          </p>
        ) : (
          <p className="text-sm text-muted-foreground text-center">
            No commanders found for this group — try removing a card.
          </p>
        )}
      </div>
    </div>
  );
}
