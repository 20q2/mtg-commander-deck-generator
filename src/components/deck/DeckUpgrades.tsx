import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { Newspaper, Plus, ChevronDown } from 'lucide-react';
import { InspectorIcon } from '@/components/analyze/InspectorIcon';
import { CardContextMenu, type CardAction } from '@/components/deck/DeckDisplay';
import { getCardsByNames, getCardImageUrl } from '@/services/scryfall/client';
import { CardPreviewModal } from '@/components/ui/CardPreviewModal';
import type { ScryfallCard, UserCardList } from '@/types';

/** Context supplied by the host so the per-card right-click menu can render. */
export interface DeckUpgradesMenuProps {
  userLists: UserCardList[];
  mustIncludeNames: Set<string>;
  bannedNames: Set<string>;
  sideboardNames: Set<string>;
  maybeboardNames: Set<string>;
}

interface DeckUpgradesProps {
  newCards: string[];
  /** Still-relevant recommendations already seen — pads the row when newCards is short. */
  fillCards?: string[];
  /** Add a card to the deck (reuses the list-deck add flow). */
  onApply: (cardName: string) => void;
  /** Record cards the user has now seen (used by Add and by Dismiss). */
  onMarkSeen: (names: string[]) => void;
  /** Open SpellChroma / inspector for deeper tuning. */
  onExplore: () => void;
  /** Right-click context-menu action handler. Menu only renders when both this and menuProps are set. */
  onCardAction?: (card: ScryfallCard, action: CardAction) => void;
  /** Sets + user lists backing the context menu's toggles/labels. */
  menuProps?: DeckUpgradesMenuProps;
}

const MAX_VISIBLE = 8;
const COLLAPSED_KEY = 'mtg-deck-builder-new-cards-collapsed';

/** Full card image (frame + text), with DFC front-face handled by getCardImageUrl. */
function cardImage(card: ScryfallCard): string {
  return getCardImageUrl(card, 'normal') ?? '';
}

/**
 * "New cards for this deck" — the return-trigger surface for a saved deck.
 * Surfaces genuinely new cards for the commander (NOT generic inspector-overview
 * synergy, NOT combo completion), art-forward and collapsible. The row is padded
 * with still-relevant already-seen recommendations, but the panel only APPEARS
 * when something is genuinely new (quiet by default; never nags).
 */
export function DeckUpgrades({ newCards, fillCards = [], onApply, onMarkSeen, onExplore, onCardAction, menuProps }: DeckUpgradesProps) {
  // New cards lead; padding keeps the row visually full without re-triggering.
  const visibleNames = useMemo(
    () => [...newCards, ...fillCards].slice(0, MAX_VISIBLE),
    [newCards, fillCards],
  );
  const [cards, setCards] = useState<Map<string, ScryfallCard>>(new Map());
  const [preview, setPreview] = useState<ScryfallCard | null>(null);
  const [hover, setHover] = useState<{ name: string; top: number; left: number; placement: 'right' | 'left' } | null>(null);
  // Which card's right-click menu is force-open (one at a time).
  const [menuOpenName, setMenuOpenName] = useState<string | null>(null);
  const menuEnabled = !!onCardAction && !!menuProps;
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem(COLLAPSED_KEY) === 'true');
  const toggleCollapsed = () => {
    const next = !collapsed;
    setCollapsed(next);
    localStorage.setItem(COLLAPSED_KEY, String(next));
  };

  const namesKey = visibleNames.join('|');
  useEffect(() => {
    // No image fetches while collapsed — they kick off on expand.
    if (visibleNames.length === 0 || collapsed) return;
    let cancelled = false;
    getCardsByNames(visibleNames).then(map => { if (!cancelled) setCards(map); });
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [namesKey, collapsed]);

  // Visibility is driven by genuinely NEW cards only — padding never nags.
  if (newCards.length === 0 || visibleNames.length === 0) return null;

  const hoverCard = hover ? cards.get(hover.name) : undefined;

  return (
    <div className="relative mt-6 rounded-xl border border-border/50 bg-card/50 backdrop-blur-sm p-4">
      <div
        role="button"
        onClick={toggleCollapsed}
        title={collapsed ? 'Expand' : 'Collapse'}
        className={`relative flex items-center justify-between cursor-pointer ${collapsed ? '' : 'mb-3.5'}`}
      >
        <div className="flex items-center gap-2 text-left">
          <Newspaper className="w-4 h-4 text-primary shrink-0" />
          <div className="leading-tight">
            <p className="text-sm font-semibold text-foreground">New cards for this deck</p>
            {!collapsed && <p className="text-[11px] text-muted-foreground">New printings, ranked by fit with your deck</p>}
          </div>
        </div>
        <div className="flex items-center gap-1">
          {!collapsed && (
            <button
              type="button"
              className="flex items-center gap-1 px-2 py-1 text-[10px] rounded-md border border-border bg-transparent text-muted-foreground hover:text-foreground hover:bg-accent transition-colors shrink-0"
              title="Explore more in the Inspector"
              onClick={(e) => { e.stopPropagation(); onExplore(); }}
            >
              <InspectorIcon className="w-3 h-3" />
              <span>See more</span>
            </button>
          )}
          <ChevronDown className={`w-4 h-4 text-muted-foreground transition-transform ${collapsed ? '' : 'rotate-180'}`} />
        </div>
      </div>

      {/* Grid-rows 0fr→1fr animates the panel height smoothly regardless of content size. */}
      <div className={`grid transition-[grid-template-rows,opacity] duration-300 ease-in-out ${collapsed ? 'grid-rows-[0fr] opacity-0' : 'grid-rows-[1fr] opacity-100'}`}>
        <div className="overflow-hidden min-h-0">
      {/* Columns track the visible count so a full row spans the panel edge to edge,
          floored at MAX_VISIBLE so a short row doesn't balloon to fill the width. */}
      <div
        className="relative grid grid-cols-4 gap-2 sm:grid-cols-[repeat(var(--nc-cols),minmax(0,1fr))]"
        style={{ '--nc-cols': Math.max(visibleNames.length, MAX_VISIBLE) } as CSSProperties}
      >
        {visibleNames.map((name, i) => {
          const card = cards.get(name);
          return (
            <div
              key={name}
              className="group relative animate-sc-card-in"
              style={{ animationDelay: `${Math.min(i, 12) * 45}ms` }}
              onContextMenu={(e) => {
                if (!menuEnabled) return;
                e.preventDefault();
                setMenuOpenName(name);
              }}
            >
              <button
                type="button"
                onClick={() => card && setPreview(card)}
                onMouseEnter={(e) => {
                  const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                  // Show preview on the right if there's room, else left of the card.
                  const placement: 'right' | 'left' = (window.innerWidth - rect.right > 240) ? 'right' : 'left';
                  setHover({
                    name,
                    top: rect.top + rect.height / 2,
                    left: placement === 'right' ? rect.right + 8 : rect.left - 8,
                    placement,
                  });
                }}
                onMouseLeave={() => setHover(null)}
                title={name}
                className="relative block w-full aspect-[5/7] rounded-lg overflow-hidden bg-accent/30 border border-border/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-400/70"
              >
                {card ? (
                  <img
                    src={cardImage(card)}
                    alt={name}
                    loading="lazy"
                    className="absolute inset-0 w-full h-full object-cover"
                  />
                ) : (
                  <div className="absolute inset-0 animate-pulse bg-accent/30" />
                )}
              </button>

              <span
                onClick={() => { onApply(name); onMarkSeen([name]); }}
                className="absolute top-0 left-0 rounded-tl-lg rounded-br-lg bg-black/75 hover:bg-black/90 text-white border border-white/15 p-2 transition-colors opacity-0 group-hover:opacity-100 cursor-pointer"
                title={`Add ${name} to deck`}
              >
                <Plus className="w-5 h-5" />
              </span>

              {menuEnabled && (
                <span
                  className={`absolute top-1 right-1 z-10 transition-opacity ${menuOpenName === name ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}
                  onClick={(e) => e.stopPropagation()}
                >
                  <CardContextMenu
                    card={card ?? ({ name, id: name } as ScryfallCard)}
                    onAction={(c, a) => {
                      onCardAction!(c, a);
                      // Resolving actions retire the card from the "new" row.
                      if (a.type === 'addToDeck' || a.type === 'sideboard' || a.type === 'maybeboard' || a.type === 'exclude') {
                        onMarkSeen([name]);
                      }
                    }}
                    hasAddToDeck
                    hasSideboard
                    hasMaybeboard
                    // New-card tiles are never in the deck, so Create combo is only
                    // valid when the card already sits in the sideboard/maybeboard.
                    hasCreateCombo={menuProps!.sideboardNames.has(name) || menuProps!.maybeboardNames.has(name)}
                    addToBoard
                    isInSideboard={menuProps!.sideboardNames.has(name)}
                    isInMaybeboard={menuProps!.maybeboardNames.has(name)}
                    isMustInclude={menuProps!.mustIncludeNames.has(name)}
                    isBanned={menuProps!.bannedNames.has(name)}
                    userLists={menuProps!.userLists}
                    forceOpen={menuOpenName === name}
                    onForceClose={() => setMenuOpenName(null)}
                  />
                </span>
              )}
            </div>
          );
        })}
      </div>
        </div>
      </div>

      {!collapsed && hover && hoverCard && createPortal(
        <div
          className="pointer-events-none fixed z-[110] animate-fade-in"
          style={{
            top: hover.top,
            left: hover.left,
            transform: hover.placement === 'right' ? 'translate(0, -50%)' : 'translate(-100%, -50%)',
          }}
        >
          <img
            src={cardImage(hoverCard)}
            alt={hover.name}
            className="w-56 rounded-lg shadow-2xl border border-white/10"
          />
        </div>,
        document.body
      )}

      <CardPreviewModal card={preview} onClose={() => setPreview(null)} />
    </div>
  );
}
