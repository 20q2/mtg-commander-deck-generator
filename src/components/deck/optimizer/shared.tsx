import { useState, useMemo } from 'react';
import { Plus, Minus, Check, AlertTriangle, ChevronDown, ChevronRight, ThumbsUp } from 'lucide-react';
import type { ScryfallCard, UserCardList } from '@/types';
import type { RecommendedCard, AnalyzedCard } from '@/services/deckBuilder/deckAnalyzer';
import { getCardPrice, getFrontFaceTypeLine, getCachedCard } from '@/services/scryfall/client';
import { CardContextMenu, type CardAction } from '@/components/deck/DeckDisplay';
import { ManaCost } from '@/components/ui/mtg-icons';
import {
  scryfallImg, edhrecRankToInclusion,
  RANK_STYLES, ROLE_BADGE_COLORS, ROLE_LABEL_ICONS, SUBTYPE_BADGE_COLORS,
  type CollapsibleGroup,
} from './constants';

export type { CardAction };

/** Shared menuProps shape — all optimizer row components use this. Callers pass Sets; rows do the .has() lookup. */
export interface CardRowMenuProps {
  userLists: UserCardList[];
  mustIncludeNames: Set<string>;
  bannedNames: Set<string>;
  sideboardNames: Set<string>;
  maybeboardNames: Set<string>;
}

// ─── Shared: Analyzed Card Row (compact, for curve/lands/types) ──────
export function AnalyzedCardRow({
  ac, onPreview, warning, showDetails, showProducedMana, onCardAction, menuProps,
}: {
  ac: AnalyzedCard;
  onPreview: (name: string) => void;
  warning?: string;
  showDetails?: boolean;
  showProducedMana?: boolean;
  onCardAction?: (card: ScryfallCard, action: CardAction) => void;
  menuProps?: CardRowMenuProps;
}) {
  const [contextMenuOpen, setContextMenuOpen] = useState(false);
  const price = showDetails ? getCardPrice(ac.card) : null;
  const typeLine = getFrontFaceTypeLine(ac.card).toLowerCase();
  const cardType = typeLine.includes('creature') ? 'creature'
    : typeLine.includes('planeswalker') ? 'planeswalker'
    : typeLine.includes('instant') ? 'instant'
    : typeLine.includes('sorcery') ? 'sorcery'
    : typeLine.includes('artifact') ? 'artifact'
    : typeLine.includes('enchantment') ? 'enchantment'
    : typeLine.includes('land') ? 'land'
    : typeLine.includes('battle') ? 'battle'
    : 'artifact';

  const primaryType = cardType.charAt(0).toUpperCase() + cardType.slice(1);

  const producedColors = showProducedMana ? (() => {
    const WUBRG = ['W', 'U', 'B', 'R', 'G'];
    const produced = ac.card.produced_mana || [];
    const colors = [...new Set(produced.filter(c => WUBRG.includes(c)))];
    if (colors.length > 0) return colors.sort((a, b) => WUBRG.indexOf(a) - WUBRG.indexOf(b));
    const oracle = (ac.card.oracle_text || '').toLowerCase();
    if (oracle.includes('any color') || oracle.includes('any type')) return WUBRG;
    const found: string[] = [];
    if (oracle.includes('add {w}')) found.push('W');
    if (oracle.includes('add {u}')) found.push('U');
    if (oracle.includes('add {b}')) found.push('B');
    if (oracle.includes('add {r}')) found.push('R');
    if (oracle.includes('add {g}')) found.push('G');
    if (found.length === 0 && produced.includes('C')) return ['C'];
    return found;
  })() : null;

  return (
    <div
      className={`flex items-center gap-2 py-1 px-1.5 rounded-lg cursor-pointer hover:bg-accent/40 transition-colors group ${
        warning ? 'border border-amber-500/20' : 'border border-transparent'
      }`}
      onClick={() => onPreview(ac.card.name)}
      onContextMenu={(e) => {
        if (onCardAction && menuProps) {
          e.preventDefault();
          setContextMenuOpen(true);
        }
      }}
    >
      <img
        src={scryfallImg(ac.card.name)}
        alt={ac.card.name}
        className="w-10 h-auto rounded shadow shrink-0"
        loading="lazy"
        onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
      />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 min-w-0">
          <span className="text-sm truncate">{ac.card.name}</span>
          {ac.subtypeLabel && (() => {
            const RIcon = ROLE_LABEL_ICONS[ac.subtypeLabel];
            return (
              <span className={`inline-flex items-center gap-0.5 text-[10px] font-bold px-1 py-px rounded-full shrink-0 ${
                SUBTYPE_BADGE_COLORS[ac.subtypeLabel] || 'bg-muted text-muted-foreground'
              }`}>
                {RIcon && <RIcon className="w-2.5 h-2.5" />}
                {ac.subtypeLabel}
              </span>
            );
          })()}
        </div>
        <span className="text-[10px] text-muted-foreground truncate block">
          {primaryType}
          {producedColors && producedColors.length > 0 && (
            <>
              <span className="mx-0.5 opacity-40">&bull;</span>
              <span className="inline-flex items-center gap-px align-middle">
                <span className="mr-1">Produces</span>
                {producedColors.map(c => (
                  <i key={c} className={`ms ms-${c.toLowerCase()} ms-cost text-[9px] ml-0.5`} />
                ))}
              </span>
            </>
          )}
        </span>
      </div>
      {showDetails && ac.card.mana_cost && (
        <ManaCost cost={ac.card.mana_cost} className="text-[10px] shrink-0" />
      )}
      {ac.inclusion != null && (
        <span
          className="text-xs tabular-nums shrink-0 font-medium"
          style={{ color: `hsl(${Math.min(ac.inclusion / 50, 1) * 120}, 70%, 55%)` }}
        >
          {Math.round(ac.inclusion)}%
        </span>
      )}
      {price && (
        <span className="text-[10px] text-muted-foreground shrink-0">${price}</span>
      )}
      {warning && (
        <span title={warning}>
          <AlertTriangle className="w-3 h-3 text-amber-400/60 shrink-0" />
        </span>
      )}
      {onCardAction && menuProps && (
        <span className={`shrink-0 w-3 transition-opacity ${contextMenuOpen ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`} onClick={(e) => e.stopPropagation()}>
          <CardContextMenu
            card={ac.card}
            onAction={onCardAction}
            hasRemove
            hasSideboard
            hasMaybeboard
            isInSideboard={menuProps.sideboardNames.has(ac.card.name)}
            isInMaybeboard={menuProps.maybeboardNames.has(ac.card.name)}
            userLists={menuProps.userLists}
            isMustInclude={menuProps.mustIncludeNames.has(ac.card.name)}
            isBanned={menuProps.bannedNames.has(ac.card.name)}
            forceOpen={contextMenuOpen}
            onForceClose={() => setContextMenuOpen(false)}
          />
        </span>
      )}
    </div>
  );
}

// ─── Shared: Collapsible Card Groups ─────────────────────────────────
export function CollapsibleCardGroups({ groups, totalCount }: {
  groups: CollapsibleGroup[];
  totalCount: number;
}) {
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const toggle = (key: string) => setCollapsed(prev => {
    const next = new Set(prev);
    next.has(key) ? next.delete(key) : next.add(key);
    return next;
  });

  return (
    <div>
      <div className="flex items-center gap-1 mb-1.5 px-0.5">
        <Check className="w-3 h-3 text-emerald-400/60" />
        <span className="text-[11px] font-semibold uppercase tracking-wider text-emerald-400/60">In Your Deck ({totalCount})</span>
        {collapsed.size > 0 ? (
          <button onClick={() => setCollapsed(new Set())} className="ml-auto text-[10px] text-muted-foreground/40 hover:text-muted-foreground transition-colors">
            expand all
          </button>
        ) : (
          <button onClick={() => setCollapsed(new Set(groups.map(g => g.key)))} className="ml-auto text-[10px] text-muted-foreground/40 hover:text-muted-foreground transition-colors">
            collapse all
          </button>
        )}
      </div>
      <div className="space-y-2">
        {groups.map(group => {
          const isOpen = !collapsed.has(group.key);
          return (
            <div key={group.key}>
              <button
                onClick={() => toggle(group.key)}
                className="flex items-center gap-1 w-full text-left px-0.5 mb-1 hover:opacity-80 transition-opacity"
              >
                {isOpen
                  ? <ChevronDown className="w-3 h-3 text-muted-foreground" />
                  : <ChevronRight className="w-3 h-3 text-muted-foreground" />}
                <span className="text-[11px] font-semibold uppercase tracking-wider text-foreground/80">{group.label} ({group.count})</span>
              </button>
              {isOpen && group.content}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Overview: Recommendation Row ────────────────────────────────────
export function RecommendationRow({ card, rank, onAdd, onPreview, added, onCardAction, menuProps }: {
  card: RecommendedCard;
  rank: number;
  onAdd: () => void;
  onPreview: () => void;
  added: boolean;
  onCardAction?: (card: ScryfallCard, action: CardAction) => void;
  menuProps?: CardRowMenuProps;
}) {
  const [contextMenuOpen, setContextMenuOpen] = useState(false);
  const rankStyle = rank < 3 ? RANK_STYLES[rank] : null;
  const roleBadges = card.allRoleLabels && card.allRoleLabels.length > 1
    ? card.allRoleLabels
    : card.roleLabel ? [card.roleLabel] : [];
  const pseudoCard = useMemo(() => ({ name: card.name, id: card.name } as ScryfallCard), [card.name]);

  // Resolve type: use EDHREC primary_type, fallback to Scryfall cache
  const resolvedType = useMemo(() => {
    if (card.primaryType && card.primaryType !== 'Unknown') return card.primaryType;
    const cached = getCachedCard(card.name);
    if (!cached) return null;
    const tl = getFrontFaceTypeLine(cached).split('—')[0].replace(/Legendary\s+/i, '').trim();
    return tl || null;
  }, [card.name, card.primaryType]);

  return (
    <div
      className={`group flex items-center gap-2 py-1 px-1.5 rounded-lg border transition-all duration-200 ${
        added
          ? 'opacity-40 border-transparent'
          : rankStyle
            ? `${rankStyle.bg} ${rankStyle.border} hover:brightness-110 cursor-pointer`
            : 'border-transparent hover:bg-accent/40 cursor-pointer'
      }`}
      onClick={added ? undefined : onPreview}
      onContextMenu={(e) => {
        if (onCardAction && menuProps) {
          e.preventDefault();
          setContextMenuOpen(true);
        }
      }}
    >
      <div className="relative shrink-0">
        <img
          src={card.imageUrl || scryfallImg(card.name)}
          alt={card.name}
          className="w-7 h-auto rounded shadow-md"
          loading="lazy"
          onError={(e) => { (e.target as HTMLImageElement).src = scryfallImg(card.name); }}
        />
        {rankStyle && (
          <span className={`absolute -top-1 -left-1 text-[10px] font-bold px-0.5 py-px rounded-full shadow ${rankStyle.badge}`}>
            {rankStyle.label}
          </span>
        )}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1">
          <p className={`text-sm truncate ${rankStyle ? 'font-semibold' : 'font-medium'}`}>{card.name}</p>
          {roleBadges.map(label => {
            const bc = ROLE_BADGE_COLORS[label];
            const RIcon = ROLE_LABEL_ICONS[label];
            if (!bc) return null;
            return (
              <span key={label} className={`inline-flex items-center gap-0.5 text-[10px] font-bold px-1 py-px rounded-full shrink-0 ${bc}`}>
                {RIcon && <RIcon className="w-2.5 h-2.5" />}
                {label}
              </span>
            );
          })}
        </div>
        {resolvedType && (
          <p className="text-xs text-muted-foreground truncate">{resolvedType}</p>
        )}
      </div>
      <div className="flex items-center gap-2 shrink-0 ml-auto">
        {!added ? (
          <button
            onClick={(e) => { e.stopPropagation(); onAdd(); }}
            className="p-1 rounded-md text-muted-foreground hover:text-emerald-400 hover:bg-emerald-500/10 transition-colors"
            title="Add to deck"
          >
            <Plus className="w-4 h-4" />
          </button>
        ) : (
          <span className="p-1 text-emerald-400">
            <Check className="w-4 h-4" />
          </span>
        )}
        <div className="text-right w-12 leading-tight">
          <p className="text-xs font-medium tabular-nums">{card.price ? `$${card.price}` : '—'}</p>
          <p className="text-[11px] text-muted-foreground tabular-nums">{Math.round(card.inclusion)}%</p>
        </div>
      </div>
      {onCardAction && menuProps && (
        <span className={`shrink-0 w-3 transition-opacity ${contextMenuOpen ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`} onClick={(e) => e.stopPropagation()}>
          <CardContextMenu
            card={pseudoCard}
            onAction={onCardAction}
            hasAddToDeck
            hasSideboard
            hasMaybeboard
            isInSideboard={menuProps.sideboardNames.has(card.name)}
            isInMaybeboard={menuProps.maybeboardNames.has(card.name)}
            userLists={menuProps.userLists}
            isMustInclude={menuProps.mustIncludeNames.has(card.name)}
            isBanned={menuProps.bannedNames.has(card.name)}
            forceOpen={contextMenuOpen}
            onForceClose={() => setContextMenuOpen(false)}
          />
        </span>
      )}
    </div>
  );
}

// ─── Overview: Cut Row (mirrors RecommendationRow) ──────────────────
export function CutRow({ ac, onRemove, onSkip, onPreview, onCardAction, menuProps, cardInclusionMap }: {
  ac: AnalyzedCard;
  onRemove: (card: ScryfallCard) => void;
  onSkip: (card: ScryfallCard) => void;
  onPreview: () => void;
  onCardAction?: (card: ScryfallCard, action: CardAction) => void;
  menuProps?: CardRowMenuProps;
  cardInclusionMap?: Record<string, number>;
}) {
  const [contextMenuOpen, setContextMenuOpen] = useState(false);
  const rawInclusion = ac.inclusion ?? cardInclusionMap?.[ac.card.name] ?? edhrecRankToInclusion(ac.card.edhrec_rank);
  const pct = rawInclusion != null ? Math.round(rawInclusion) : null;
  const isEstimate = ac.inclusion == null && cardInclusionMap?.[ac.card.name] == null && pct != null;
  const price = getCardPrice(ac.card);
  const imgUrl = ac.card.image_uris?.normal
    || ac.card.card_faces?.[0]?.image_uris?.normal
    || scryfallImg(ac.card.name);
  const typeLine = getFrontFaceTypeLine(ac.card);
  const primaryType = typeLine.split('—')[0].replace(/Legendary\s+/i, '').trim();
  const roleBadges: string[] = [];
  if (ac.roleLabel) roleBadges.push(ac.roleLabel);

  return (
    <div
      className="group flex items-center gap-2 py-1 px-1.5 rounded-lg border border-transparent hover:bg-accent/40 cursor-pointer transition-all duration-200"
      onClick={onPreview}
      onContextMenu={(e) => {
        if (onCardAction && menuProps) {
          e.preventDefault();
          setContextMenuOpen(true);
        }
      }}
    >
      <div className="shrink-0">
        <img
          src={imgUrl}
          alt={ac.card.name}
          className="w-7 h-auto rounded shadow-md"
          loading="lazy"
          onError={(e) => { (e.target as HTMLImageElement).src = scryfallImg(ac.card.name); }}
        />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1">
          <p className="text-sm font-medium truncate">{ac.card.name}</p>
          {roleBadges.map(label => {
            const bc = ROLE_BADGE_COLORS[label];
            const RIcon = ROLE_LABEL_ICONS[label];
            if (!bc) return null;
            return (
              <span key={label} className={`inline-flex items-center gap-0.5 text-[10px] font-bold px-1 py-px rounded-full shrink-0 ${bc}`}>
                {RIcon && <RIcon className="w-2.5 h-2.5" />}
                {label}
              </span>
            );
          })}
        </div>
        {primaryType && (
          <p className="text-xs text-muted-foreground truncate">{primaryType}</p>
        )}
      </div>
      <div className="flex items-center gap-2 shrink-0 ml-auto">
        <button
          onClick={(e) => { e.stopPropagation(); onSkip(ac.card); }}
          className="p-1 rounded-md text-muted-foreground/40 hover:text-muted-foreground hover:bg-accent/60 transition-colors"
          title="Keep in deck"
        >
          <ThumbsUp className="w-4 h-4" />
        </button>
        <button
          onClick={(e) => { e.stopPropagation(); onRemove(ac.card); }}
          className="p-1 rounded-md text-muted-foreground hover:text-red-400 hover:bg-red-500/10 transition-colors"
          title="Cut from deck"
        >
          <Minus className="w-4 h-4" />
        </button>
        <div className="text-right w-12 leading-tight">
          <p className="text-xs font-medium tabular-nums">{price ? `$${price}` : '—'}</p>
          <p className="text-[11px] text-muted-foreground tabular-nums" title={isEstimate ? 'Estimated from EDHREC rank' : undefined}>
            {pct != null ? `${isEstimate ? '~' : ''}${pct}%` : '—'}
          </p>
        </div>
      </div>
      {onCardAction && menuProps && (
        <span className={`shrink-0 w-3 transition-opacity ${contextMenuOpen ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`} onClick={(e) => e.stopPropagation()}>
          <CardContextMenu
            card={ac.card}
            onAction={onCardAction}
            hasRemove
            hasSideboard
            hasMaybeboard
            isInSideboard={menuProps.sideboardNames.has(ac.card.name)}
            isInMaybeboard={menuProps.maybeboardNames.has(ac.card.name)}
            userLists={menuProps.userLists}
            isMustInclude={menuProps.mustIncludeNames.has(ac.card.name)}
            isBanned={menuProps.bannedNames.has(ac.card.name)}
            forceOpen={contextMenuOpen}
            onForceClose={() => setContextMenuOpen(false)}
          />
        </span>
      )}
    </div>
  );
}
