import { useState } from 'react';
import { Bookmark, ExternalLink, Gauge, Loader2, Users, Wand2, type LucideIcon } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import type { CollectionCard } from '@/services/collection/db';
import type { CommanderReadiness } from '@/services/collection/commanderReadiness';
import type { UserCardList } from '@/types';
import { useCommanderArt } from '@/hooks/useCommanderArt';
import { useStore } from '@/store';
import { LogoMark } from '@/components/ui/logo-mark';

/**
 * Navigate to /build/<name> with the "Build from Collection" toggle pre-enabled.
 * Used for both tile and spotlight Build buttons since the click always
 * originates from inside the user's collection context.
 */
function buildFromCollection(navigate: (path: string) => void, commanderName: string) {
  useStore.getState().updateCustomization({ collectionMode: true });
  navigate(`/build/${encodeURIComponent(commanderName)}`);
}

interface CommanderTileProps {
  commander: CollectionCard;
  readiness?: CommanderReadiness;
  /** True while the readiness is still being computed for this commander. */
  loading?: boolean;
  /** First saved deck the player has for this commander, if any. */
  savedDeck?: UserCardList;
  /** Surface this metric as a corner chip — set while the grid is sorted by it. */
  metric?: TileMetric;
  /** False shows the plain card scan instead of the art face. */
  artMode?: boolean;
}

export type TileMetric = 'power' | 'popularity' | 'rank';

function formatDeckCount(count: number): string {
  if (count >= 1000) return `${(count / 1000).toFixed(1).replace(/\.0$/, '')}k`;
  return count.toString();
}

/** Chip icon, label + tooltip for the active sort metric, or null when there's nothing to show. */
function metricChip(
  metric: TileMetric,
  commander: CollectionCard,
  r: CommanderReadiness | undefined,
): { icon: LucideIcon | null; label: string; title: string } | null {
  if (metric === 'rank') {
    // Scryfall's card rank — already on the collection card, so no wait on readiness.
    const rank = commander.edhrecRank;
    if (rank == null) return null;
    return {
      icon: null,
      label: `#${rank.toLocaleString()}`,
      title: `EDHREC rank #${rank.toLocaleString()}: how popular this card is across all Commander decks`,
    };
  }
  if (!r) return null;
  if (metric === 'popularity') {
    if (r.numDecks <= 0) return null;
    return { icon: Users, label: formatDeckCount(r.numDecks), title: `${r.numDecks.toLocaleString()} decks on EDHREC` };
  }
  if (r.avgBracket === undefined) {
    if (r.totalCount === 0) return null;
    return { icon: Gauge, label: 'Bracket ?', title: 'Too few EDHREC decks declare a bracket to estimate power' };
  }
  return {
    icon: Gauge,
    // Spelled out: a bare "B4.6" at chip size reads as "84.6".
    label: `Bracket ${r.avgBracket.toFixed(1)}`,
    title: `Average bracket across ${r.bracketSample.toLocaleString()} EDHREC decks that declared one`,
  };
}

/**
 * Map a readiness percent to a Tailwind gradient class for the bar.
 * Higher % = more saturated lavender (matches synergy palette).
 */
function readinessGradient(percent: number): string {
  if (percent >= 60) return 'from-violet-500 to-fuchsia-400';
  if (percent >= 40) return 'from-violet-500/80 to-violet-400/80';
  if (percent >= 20) return 'from-violet-500/60 to-violet-400/60';
  return 'from-violet-500/40 to-violet-400/40';
}

/** Adaptive tagline for the spotlight based on readiness. */
function readinessTag(percent: number): string {
  if (percent >= 60) return 'Ready to play';
  if (percent >= 40) return 'Almost there';
  return 'Getting started';
}

/**
 * Re-point a Scryfall image URL at another size: `…/small/front/a/b/<id>.jpg` →
 * `…/art_crop/front/a/b/<id>.jpg`. Null when the URL isn't a Scryfall jpg image.
 */
function scryfallImageAs(url: string | null | undefined, size: 'normal' | 'art_crop'): string | null {
  const m = url?.match(/^(https:\/\/cards\.scryfall\.io\/)(?:small|normal|large|art_crop|border_crop)(\/.+\.jpg.*)$/);
  return m ? `${m[1]}${size}${m[2]}` : null;
}

function ColorPips({ colors }: { colors: string[] }) {
  return colors.length > 0 ? (
    <>{colors.map(c => <i key={c} className={`ms ms-${c.toLowerCase()} ms-cost text-[11px]`} />)}</>
  ) : (
    <i className="ms ms-c ms-cost text-[11px]" />
  );
}

interface RevealTileProps {
  name: string;
  colors: string[];
  /** Art crop shown on the face; null while loading or unavailable. */
  artUrl: string | null;
  /** Full card scan revealed behind the art on hover. */
  cardUrl: string | null;
  /** Non-interactive chips beside the color pips (sort metric, "Not owned"). */
  badges?: React.ReactNode;
  /** Bottom-left status line (staples owned, loading…). */
  status: React.ReactNode;
  /** Readiness bar fill, 0-100. */
  barPercent: number;
  /** Buttons pinned bottom-right. Kept off the art face so they stay visible while
   *  hovering to click them fades it out. */
  actions: React.ReactNode;
  /** False shows the plain card scan instead of the art face. */
  artMode?: boolean;
}

/**
 * Commander grid tile: an art-crop face with name + pips, which fades out on hover
 * as the real card (oracle text and all) grows in behind it.
 */
function RevealTile({ name, colors, artUrl, cardUrl, badges, status, barPercent, actions, artMode = true }: RevealTileProps) {
  const [artFailed, setArtFailed] = useState(false);
  const showArt = artMode && !!artUrl && !artFailed;
  // Without art there's nothing to fade away — the face shows the card itself.
  const canReveal = showArt && !!cardUrl;

  return (
    <div className="group relative aspect-[5/7] rounded-xl overflow-hidden bg-card/40 border border-border/40 hover:border-violet-400/40 transition-colors">
      {/* The real card — sits behind the art face and grows in as the art fades out */}
      {cardUrl ? (
        <img
          src={cardUrl}
          alt={name}
          className={`absolute inset-0 w-full h-full object-cover transition-[opacity,transform] duration-300 ease-out motion-reduce:transition-none ${
            canReveal ? 'opacity-0 scale-90 group-hover:opacity-100 group-hover:scale-100' : ''
          }`}
          loading="lazy"
        />
      ) : (
        <div className="absolute inset-0 bg-accent/50" />
      )}

      {/* Art face — fades out on hover */}
      <div
        className={`absolute inset-0 transition-opacity duration-300 ease-out motion-reduce:transition-none ${
          canReveal ? 'group-hover:opacity-0' : ''
        }`}
      >
        {showArt && (
          <img
            src={artUrl}
            alt=""
            onError={() => setArtFailed(true)}
            className="absolute inset-0 w-full h-full object-cover bg-card"
            loading="lazy"
          />
        )}

        {/* Top overlay — name, pips, badges. Skipped over a bare card scan, whose frame already shows them. */}
        {(showArt || !cardUrl) && (
          <div className="absolute inset-x-0 top-0 bg-gradient-to-b from-black/85 via-black/40 to-transparent px-2 py-2 pb-6">
            <span className="block text-[11px] font-semibold text-white leading-tight line-clamp-2">{name}</span>
            <div className="flex flex-wrap items-center gap-1 mt-1">
              <ColorPips colors={colors} />
              {badges}
            </div>
          </div>
        )}

        {/* Over a bare card scan the badges have no overlay row to sit in — pin them top-right */}
        {!showArt && cardUrl && badges && (
          <div className="absolute top-1.5 right-1.5 flex flex-col items-end gap-1">{badges}</div>
        )}

        {/* Bottom overlay — status + readiness bar; right padding clears the pinned actions */}
        <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/95 via-black/80 to-transparent px-2 py-2 pt-5 space-y-1">
          <div className="h-6 flex items-center pr-14 text-[10px] tabular-nums">{status}</div>
          <div className="h-1 bg-white/10 rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full bg-gradient-to-r ${readinessGradient(barPercent)} transition-all duration-700`}
              style={{ width: `${barPercent}%` }}
            />
          </div>
        </div>
      </div>

      <div className="absolute right-2 bottom-4 flex items-center gap-1">{actions}</div>
    </div>
  );
}

const TILE_BADGE = 'inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-black/60 text-[9px] font-semibold text-violet-200 ring-1 ring-white/10';
const TILE_ACTION = 'inline-flex items-center justify-center w-6 h-6 rounded-md text-white transition-colors shadow';

export function CommanderTile({ commander, readiness, loading, savedDeck, metric, artMode }: CommanderTileProps) {
  const navigate = useNavigate();
  const percent = readiness?.percent ?? 0;
  const owned = readiness?.ownedCount ?? 0;
  const total = readiness?.totalCount ?? 0;
  const chip = metric ? metricChip(metric, commander, readiness) : null;
  const ChipIcon = chip?.icon;

  // Derive art + full-size scan from the stored (small) Scryfall image; only fetch
  // by name when the stored URL can't be re-pointed.
  const derivedArt = scryfallImageAs(commander.imageUrl, 'art_crop');
  const fetchedArt = useCommanderArt(derivedArt ? null : commander.name);
  const artUrl = derivedArt ?? fetchedArt;
  const cardUrl =
    scryfallImageAs(commander.imageUrl, 'normal') ?? scryfallImageAs(fetchedArt, 'normal') ?? commander.imageUrl ?? null;

  const handleBuild = (e: React.MouseEvent) => {
    e.stopPropagation();
    buildFromCollection(navigate, commander.name);
  };

  const handleOpenSavedDeck = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (savedDeck) navigate(`/decks/${savedDeck.id}`);
  };

  return (
    <RevealTile
      artMode={artMode}
      name={commander.name}
      colors={commander.colorIdentity ?? []}
      artUrl={artUrl}
      cardUrl={cardUrl}
      badges={chip && (
        <span title={chip.title} className={`${TILE_BADGE} tabular-nums`}>
          {ChipIcon && <ChipIcon className="w-2.5 h-2.5" />}
          {chip.label}
        </span>
      )}
      status={
        loading ? (
          <span className="inline-flex items-center gap-1 text-white/60">
            <Loader2 className="w-2.5 h-2.5 animate-spin" />
            reading…
          </span>
        ) : total > 0 ? (
          <span className="text-violet-200/90">
            <span className="text-white font-semibold">{owned}</span>
            <span className="text-white/50">/{total}</span>
            <span className="text-white/50"> staples</span>
          </span>
        ) : (
          <span className="text-white/40">no data</span>
        )
      }
      barPercent={loading ? 0 : Math.max(2, percent)}
      actions={
        <>
          {savedDeck && (
            <button
              type="button"
              onClick={handleOpenSavedDeck}
              title={`You have a saved deck: ${savedDeck.name}`}
              aria-label={`Open saved ${commander.name} deck`}
              className={`${TILE_ACTION} bg-violet-500/85 hover:bg-violet-400 ring-1 ring-violet-300/40`}
            >
              <Bookmark className="w-3 h-3" fill="currentColor" />
            </button>
          )}
          <button
            type="button"
            onClick={handleBuild}
            title={`Generate a ${commander.name} deck`}
            aria-label={`Generate a ${commander.name} deck`}
            className={`${TILE_ACTION} bg-violet-500/80 hover:bg-violet-400`}
          >
            <Wand2 className="w-3 h-3" />
          </button>
        </>
      }
    />
  );
}

/** Minimal shape the spotlight needs — satisfied by CollectionCard and by
 *  suggested (unowned) commanders, which only carry a name + color identity. */
export interface SpotlightCommander {
  name: string;
  colorIdentity?: string[];
  imageUrl?: string;
}

interface CommanderSpotlightProps {
  commander: SpotlightCommander;
  readiness: CommanderReadiness;
  savedDeck?: UserCardList;
  /** True when this is a commander the player does NOT own yet (a suggestion). */
  discover?: boolean;
}

export function CommanderSpotlight({ commander, readiness, savedDeck, discover = false }: CommanderSpotlightProps) {
  const navigate = useNavigate();
  const percent = Math.round(readiness.percent);
  const tag = discover ? 'Discover' : readinessTag(readiness.percent);
  const artCrop = useCommanderArt(commander.name);
  const hasSavedDeck = !discover && !!savedDeck;

  return (
    <div className="relative rounded-2xl overflow-hidden border border-violet-400/30 bg-gradient-to-br from-violet-950/40 via-card/60 to-fuchsia-950/30">
      {/* Backdrop — art crop, blurred and tinted */}
      {artCrop && (
        <div
          className="absolute inset-0 opacity-40 blur-md scale-110"
          style={{ backgroundImage: `url(${artCrop})`, backgroundSize: 'cover', backgroundPosition: 'center' }}
        />
      )}
      {/* Color wash overlay to keep text readable */}
      <div className="absolute inset-0 bg-gradient-to-br from-violet-950/70 via-background/60 to-fuchsia-950/50" />

      <div className="relative grid grid-cols-[auto_1fr] gap-4 p-4 sm:gap-6 sm:p-6 items-center">
        {/* Art-crop hero — wide rectangle, not the card frame */}
        <div className="w-32 sm:w-44 aspect-[4/3] rounded-lg overflow-hidden shadow-2xl shadow-black/60 ring-1 ring-violet-300/20 shrink-0">
          {artCrop ? (
            <img
              src={artCrop}
              alt={commander.name}
              className="w-full h-full object-cover"
              loading="lazy"
            />
          ) : commander.imageUrl ? (
            <img
              src={commander.imageUrl}
              alt={commander.name}
              className="w-full h-full object-cover"
              loading="lazy"
            />
          ) : (
            <div className="w-full h-full bg-accent/50" />
          )}
        </div>

        {/* Info column */}
        <div className="flex flex-col justify-center min-w-0 space-y-1.5">
          <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-[0.18em] text-violet-300/90 font-semibold">
            {tag}
            {discover && (
              <span className="normal-case tracking-normal text-muted-foreground/70 font-medium">
                · not in your collection yet
              </span>
            )}
          </div>

          <h3 className="text-base sm:text-xl font-bold leading-tight">{commander.name}</h3>

          <div className="flex items-center gap-1.5 pt-0.5">
            {(commander.colorIdentity ?? []).length > 0 ? (
              (commander.colorIdentity ?? []).map(c => (
                <i key={c} className={`ms ms-${c.toLowerCase()} ms-cost text-sm`} />
              ))
            ) : (
              <i className="ms ms-c ms-cost text-sm" />
            )}
          </div>

          {/* Plain-language explainer — what the % actually measures */}
          <p className="text-xs text-muted-foreground/90 leading-snug pt-1 max-w-prose">
            You{discover ? ' already own' : ' own'}{' '}
            <span className="text-foreground font-semibold">{readiness.ownedCount}</span>
            {' '}of the top{' '}
            <span className="text-foreground font-semibold">{readiness.totalCount}</span>
            {' '}most-played cards for this commander, per{' '}
            <a
              href={`https://edhrec.com/commanders/${encodeURIComponent(commander.name.toLowerCase().replace(/[^a-z0-9]+/g, '-'))}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-violet-300 hover:underline"
            >
              EDHREC
            </a>
            {discover ? ' — you just don’t have the commander itself yet.' : '.'}
          </p>

          {/* Readiness — % is the hero */}
          <div className="space-y-1 pt-1.5">
            <div className="flex items-end justify-between gap-3">
              <span className="text-xs text-muted-foreground tabular-nums">
                <span className="text-foreground font-semibold">{readiness.ownedCount}</span>
                <span className="text-muted-foreground">/{readiness.totalCount}</span>
              </span>
              <span className="text-3xl sm:text-4xl font-bold text-violet-200 tabular-nums leading-none">
                {percent}<span className="text-lg text-violet-300/70">%</span>
              </span>
            </div>
            <div className="h-2 bg-border/40 rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full bg-gradient-to-r ${readinessGradient(readiness.percent)} transition-all duration-700`}
                style={{ width: `${Math.max(4, readiness.percent)}%` }}
              />
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 mt-2">
            <button
              type="button"
              onClick={() => buildFromCollection(navigate, commander.name)}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium bg-violet-500 hover:bg-violet-400 text-white rounded-md transition-colors shadow-lg shadow-violet-900/40"
            >
              <LogoMark className="w-3.5 h-3.5" />
              {discover ? 'Preview a deck' : hasSavedDeck ? 'Try another theme' : 'Assemble a deck'}
            </button>
            {hasSavedDeck && (
              <button
                type="button"
                onClick={() => navigate(`/decks/${savedDeck!.id}`)}
                className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-violet-200 hover:text-white bg-white/5 hover:bg-white/15 rounded-md transition-colors"
                title={`Open ${savedDeck!.name}`}
              >
                <Bookmark className="w-3 h-3" fill="currentColor" />
                View saved deck
                <ExternalLink className="w-3 h-3 opacity-70" />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

interface SuggestionTileProps {
  /** A commander the player does NOT own, surfaced as a suggestion. */
  commander: SpotlightCommander;
  readiness: CommanderReadiness;
  /** False shows the plain card scan instead of the art face. */
  artMode?: boolean;
}

/**
 * Grid tile for a suggested (unowned) commander. Same reveal tile as CommanderTile, but
 * pulls art by name (no CollectionCard) and frames the CTA as a preview since
 * the player doesn't own the commander itself.
 */
export function SuggestionTile({ commander, readiness, artMode }: SuggestionTileProps) {
  const navigate = useNavigate();
  const art = useCommanderArt(commander.name);
  const owned = readiness.ownedCount;
  const total = readiness.totalCount;

  const handleBuild = (e: React.MouseEvent) => {
    e.stopPropagation();
    buildFromCollection(navigate, commander.name);
  };

  return (
    <RevealTile
      artMode={artMode}
      name={commander.name}
      colors={commander.colorIdentity ?? []}
      artUrl={art}
      cardUrl={scryfallImageAs(art, 'normal')}
      badges={<span className={`${TILE_BADGE} uppercase tracking-wide text-[8px]`}>Not owned</span>}
      status={
        <span className="text-violet-200/90">
          <span className="text-white font-semibold">{owned}</span>
          <span className="text-white/50">/{total}</span>
          <span className="text-white/50"> staples</span>
        </span>
      }
      barPercent={Math.max(2, readiness.percent)}
      actions={
        <button
          type="button"
          onClick={handleBuild}
          title={`Preview a ${commander.name} deck from your cards`}
          aria-label={`Preview a ${commander.name} deck`}
          className={`${TILE_ACTION} bg-violet-500/80 hover:bg-violet-400`}
        >
          <Wand2 className="w-3 h-3" />
        </button>
      }
    />
  );
}
