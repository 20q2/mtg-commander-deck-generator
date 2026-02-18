import { useState, useCallback, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { useStore } from '@/store';
import { getCardImageUrl, isDoubleFacedCard, getCardBackFaceUrl, getCardPrice } from '@/services/scryfall/client';
import { getDeckFormatConfig } from '@/lib/constants/archetypes';
import type { ScryfallCard } from '@/types';
import {
  Copy,
  Check,
  Download,
  X,
  Grid3X3,
  List,
  ArrowUpDown,
} from 'lucide-react';
import { CardTypeIcon, ManaCost } from '@/components/ui/mtg-icons';

// Stats filter for interactive highlighting
type StatsFilter =
  | { type: 'cmc'; value: number }
  | { type: 'color'; value: string }
  | { type: 'manaProduction'; value: string }
  | null;

// Check if a card matches the current stats filter
function cardMatchesFilter(card: ScryfallCard, filter: StatsFilter): boolean {
  if (!filter) return true;

  switch (filter.type) {
    case 'cmc': {
      if (card.type_line?.toLowerCase().includes('land')) return false;
      const cardCmc = Math.min(Math.floor(card.cmc), 7);
      return cardCmc === filter.value;
    }
    case 'color': {
      const manaCost = card.mana_cost || '';
      const symbols = manaCost.match(/\{[^}]+\}/g) || [];
      for (const symbol of symbols) {
        const clean = symbol.replace(/[{}]/g, '');
        if (clean === filter.value) return true;
        if (clean.includes('/')) {
          const parts = clean.split('/');
          if (parts.includes(filter.value)) return true;
        }
      }
      if (filter.value === 'C') {
        const hasColorPip = symbols.some(s => {
          const c = s.replace(/[{}]/g, '');
          return ['W','U','B','R','G'].includes(c) || (c.includes('/') && c.split('/').some(p => ['W','U','B','R','G'].includes(p)));
        });
        return !hasColorPip && symbols.length > 0;
      }
      return false;
    }
    case 'manaProduction': {
      const typeLine = card.type_line?.toLowerCase() || '';
      if (!typeLine.includes('land')) return false;
      const producedMana = card.produced_mana || [];
      if (producedMana.includes(filter.value)) return true;
      if (producedMana.length === 0) {
        const oracleText = card.oracle_text?.toLowerCase() || '';
        const checks: Record<string, () => boolean> = {
          W: () => typeLine.includes('plains') || oracleText.includes('add {w}'),
          U: () => typeLine.includes('island') || oracleText.includes('add {u}'),
          B: () => typeLine.includes('swamp') || oracleText.includes('add {b}'),
          R: () => typeLine.includes('mountain') || oracleText.includes('add {r}'),
          G: () => typeLine.includes('forest') || oracleText.includes('add {g}'),
          C: () => oracleText.includes('add {c}'),
        };
        return checks[filter.value]?.() ?? false;
      }
      return false;
    }
    default:
      return true;
  }
}

// Card type categories for Moxfield-style grouping
type CardType = 'Commander' | 'Creature' | 'Planeswalker' | 'Instant' | 'Sorcery' | 'Artifact' | 'Enchantment' | 'Land';

const TYPE_ORDER: CardType[] = ['Commander', 'Planeswalker', 'Creature', 'Artifact', 'Enchantment', 'Instant', 'Sorcery', 'Land'];

// Get primary card type from type_line
function getCardType(card: ScryfallCard): CardType {
  const typeLine = card.type_line?.toLowerCase() || '';

  if (typeLine.includes('land')) return 'Land';
  if (typeLine.includes('planeswalker')) return 'Planeswalker';
  if (typeLine.includes('creature')) return 'Creature';
  if (typeLine.includes('instant')) return 'Instant';
  if (typeLine.includes('sorcery')) return 'Sorcery';
  if (typeLine.includes('artifact')) return 'Artifact';
  if (typeLine.includes('enchantment')) return 'Enchantment';

  return 'Artifact'; // Default fallback
}

// Format price
function formatPrice(price: string | null | undefined): string {
  if (!price) return '-';
  const num = parseFloat(price);
  if (isNaN(num)) return '-';
  return `$${num.toFixed(2)}`;
}

// Card row component
interface CardRowProps {
  card: ScryfallCard;
  quantity: number;
  onPreview: (card: ScryfallCard) => void;
  onHover: (card: ScryfallCard | null, e?: React.MouseEvent, showBack?: boolean) => void;
  dimmed?: boolean;
}

function CardRow({ card, quantity, onPreview, onHover, dimmed }: CardRowProps) {
  const price = formatPrice(getCardPrice(card));
  const isDfc = isDoubleFacedCard(card);

  return (
    <button
      className={`w-full text-left px-2 py-1 rounded text-sm flex items-center gap-2 group transition-all duration-200 ${
        dimmed ? 'opacity-30' : 'hover:bg-accent/50'
      }`}
      onClick={() => onPreview(card)}
      onMouseEnter={(e) => onHover(card, e)}
      onMouseLeave={() => onHover(null)}
    >
      <span className="text-muted-foreground w-4 text-right shrink-0">{quantity}</span>
      <span className="flex-1 truncate group-hover:text-primary transition-colors">
        {card.name.includes(' // ') ? card.name.split(' // ')[0] : card.name}
        {card.isMustInclude && (
          <span className="ml-1 text-[10px] font-bold text-emerald-500/70" title="Must Include">MI</span>
        )}
        {card.isGameChanger && (
          <span className="ml-1 text-[10px] font-bold text-amber-500/70" title="Game Changer (EDHREC)">GC</span>
        )}
        {isDfc && (
          <span
            className="ml-1 inline-flex align-text-bottom text-muted-foreground hover:text-primary transition-colors cursor-help"
            title="Hover to see back face"
            onMouseEnter={(e) => { e.stopPropagation(); onHover(card, e, true); }}
            onMouseLeave={(e) => { e.stopPropagation(); onHover(card, e, false); }}
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5">
              <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
              <path d="M3 3v5h5" />
            </svg>
          </span>
        )}
      </span>
      <ManaCost cost={card.mana_cost} />
      <span className="text-muted-foreground text-xs w-16 text-right shrink-0">
        {price}
      </span>
    </button>
  );
}

// Category column component
interface CategoryColumnProps {
  type: CardType;
  cards: Array<{ card: ScryfallCard; quantity: number }>;
  onPreview: (card: ScryfallCard) => void;
  onHover: (card: ScryfallCard | null, e?: React.MouseEvent, showBack?: boolean) => void;
  matchingCardIds: Set<string> | null;
}

function CategoryColumn({ type, cards, onPreview, onHover, matchingCardIds }: CategoryColumnProps) {
  if (cards.length === 0) return null;

  const totalCards = cards.reduce((sum, c) => sum + c.quantity, 0);
  const totalPrice = cards.reduce((sum, c) => {
    const price = parseFloat(getCardPrice(c.card) || '0');
    return sum + (isNaN(price) ? 0 : price * c.quantity);
  }, 0);

  return (
    <div className="break-inside-avoid-column mb-4">
      {/* Header */}
      <div className="flex items-center justify-between px-2 py-2 border-b border-border/50">
        <div className="flex items-center gap-2">
          <CardTypeIcon type={type} size="md" className="text-muted-foreground" />
          <span className="font-medium text-sm uppercase tracking-wide">
            {type} ({totalCards})
          </span>
        </div>
        {totalPrice > 0 && (
          <span className="text-muted-foreground text-xs">
            ${totalPrice.toFixed(2)}
          </span>
        )}
      </div>

      {/* Cards */}
      <div className="py-1">
        {cards.map(({ card, quantity }) => (
          <CardRow
            key={card.id}
            card={card}
            quantity={quantity}
            onPreview={onPreview}
            onHover={onHover}
            dimmed={matchingCardIds !== null && !matchingCardIds.has(card.id)}
          />
        ))}
      </div>
    </div>
  );
}

// Floating card preview
interface FloatingPreviewProps {
  card: ScryfallCard;
  position: { x: number; y: number };
  showBack?: boolean;
}

function FloatingPreview({ card, position, showBack }: FloatingPreviewProps) {
  const backUrl = showBack ? getCardBackFaceUrl(card, 'normal') : null;
  const imgUrl = backUrl || getCardImageUrl(card, 'normal');

  const style: React.CSSProperties = {
    position: 'fixed',
    left: Math.min(position.x + 20, window.innerWidth - 280),
    top: Math.min(position.y - 100, window.innerHeight - 400),
    zIndex: 100,
  };

  return (
    <div style={style} className="pointer-events-none">
      <div className="card-preview-enter">
        <img
          src={imgUrl}
          alt={card.name}
          className="w-64 rounded-lg shadow-2xl border border-border/50"
        />
      </div>
    </div>
  );
}

// Card preview modal
interface CardPreviewModalProps {
  card: ScryfallCard | null;
  onClose: () => void;
}

function CardPreviewModal({ card, onClose }: CardPreviewModalProps) {
  const [showBack, setShowBack] = useState(false);

  // Reset flip state when card changes
  const cardId = card?.id;
  const [prevCardId, setPrevCardId] = useState(cardId);
  if (cardId !== prevCardId) {
    setPrevCardId(cardId);
    setShowBack(false);
  }

  if (!card) return null;

  const isDfc = isDoubleFacedCard(card);
  const backUrl = isDfc ? getCardBackFaceUrl(card, 'large') : null;
  const imgUrl = showBack && backUrl ? backUrl : getCardImageUrl(card, 'large');
  const faceName = showBack && card.card_faces?.[1]
    ? card.card_faces[1].name
    : card.card_faces?.[0]?.name ?? card.name;
  const faceType = showBack && card.card_faces?.[1]
    ? card.card_faces[1].type_line
    : card.type_line;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm animate-fade-in"
      onClick={onClose}
    >
      <div className="relative animate-scale-in" onClick={(e) => e.stopPropagation()}>
        <button
          onClick={onClose}
          className="absolute -top-10 right-0 text-white/70 hover:text-white transition-colors"
        >
          <X className="w-6 h-6" />
        </button>
        <div className="relative">
          <img
            src={imgUrl}
            alt={faceName}
            className="max-h-[80vh] rounded-xl shadow-2xl transition-all duration-200"
          />
          {isDfc && (
            <button
              onClick={() => setShowBack(!showBack)}
              className="absolute bottom-4 right-4 bg-white/90 hover:bg-white text-black rounded-full px-4 py-2 flex items-center gap-2 text-sm font-semibold shadow-lg transition-colors"
              title={showBack ? 'Show front face' : 'Show back face'}
            >
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
                <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
                <path d="M3 3v5h5" />
              </svg>
              Flip
            </button>
          )}
        </div>
        <div className="mt-4 text-center">
          <h3 className="text-white font-bold text-lg">{faceName}</h3>
          <p className="text-white/70 text-sm">{faceType}</p>
          {getCardPrice(card) && (
            <p className="text-white/50 text-xs mt-1">${getCardPrice(card)}</p>
          )}
          <div className="flex items-center justify-center gap-3 mt-3">
            <a
              href={`https://scryfall.com/search?q=!%22${encodeURIComponent(card.name)}%22`}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => console.log('[CardPreview]', card.name, card)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white/10 hover:bg-white/20 text-white/80 hover:text-white text-xs font-medium transition-colors"
            >
              <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="11" cy="11" r="8" />
                <path d="m21 21-4.3-4.3" />
              </svg>
              Scryfall
            </a>
            <a
              href={`https://edhrec.com/cards/${card.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')}`}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => console.log('[CardPreview]', card.name, card)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white/10 hover:bg-white/20 text-white/80 hover:text-white text-xs font-medium transition-colors"
            >
              <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                <polyline points="15 3 21 3 21 9" />
                <line x1="10" y1="14" x2="21" y2="3" />
              </svg>
              EDHREC
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}

// Export modal
interface ExportModalProps {
  isOpen: boolean;
  onClose: () => void;
  generateDeckList: (excludeMustIncludes: boolean) => string;
  hasMustIncludes: boolean;
}

function ExportModal({ isOpen, onClose, generateDeckList, hasMustIncludes }: ExportModalProps) {
  const [copied, setCopied] = useState(false);
  const [excludeMustIncludes, setExcludeMustIncludes] = useState(false);

  const deckList = useMemo(() => generateDeckList(excludeMustIncludes), [generateDeckList, excludeMustIncludes]);

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(deckList);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [deckList]);

  const handleDownload = useCallback(() => {
    const blob = new Blob([deckList], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'deck.txt';
    a.click();
    URL.revokeObjectURL(url);
  }, [deckList]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm animate-fade-in"
      onClick={onClose}
    >
      <div
        className="bg-card rounded-xl shadow-2xl w-full max-w-2xl mx-4 animate-scale-in"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-4 border-b border-border">
          <h2 className="text-lg font-bold">Export Deck</h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-4 space-y-4">
          <div className="grid grid-cols-2 gap-2">
            <Button onClick={handleCopy} variant="outline" className="flex-col h-auto py-3">
              {copied ? <Check className="w-5 h-5 mb-1 text-green-500" /> : <Copy className="w-5 h-5 mb-1" />}
              <span className="text-xs">{copied ? 'Copied!' : 'Copy'}</span>
            </Button>
            <Button onClick={handleDownload} variant="outline" className="flex-col h-auto py-3">
              <Download className="w-5 h-5 mb-1" />
              <span className="text-xs">Download</span>
            </Button>
          </div>

          {hasMustIncludes && (
            <label className="flex items-center gap-2 text-sm text-muted-foreground cursor-pointer select-none">
              <input
                type="checkbox"
                checked={excludeMustIncludes}
                onChange={(e) => setExcludeMustIncludes(e.target.checked)}
                className="rounded border-border accent-purple-500"
              />
              Exclude must-include cards
            </label>
          )}

          <textarea
            readOnly
            value={deckList}
            onClick={(e) => (e.target as HTMLTextAreaElement).select()}
            className="w-full h-64 bg-background border border-border rounded-lg p-3 font-mono text-sm resize-none focus:outline-none focus:ring-2 focus:ring-primary"
          />
        </div>
      </div>
    </div>
  );
}

// Mana color configuration
const MANA_COLORS: Record<string, { name: string; color: string; bgColor: string }> = {
  W: { name: 'White', color: '#F9FAF4', bgColor: 'bg-amber-100' },
  U: { name: 'Blue', color: '#0E68AB', bgColor: 'bg-blue-500' },
  B: { name: 'Black', color: '#9B8E99', bgColor: 'bg-purple-300' }, // Lighter purple-gray for visibility
  R: { name: 'Red', color: '#D3202A', bgColor: 'bg-red-500' },
  G: { name: 'Green', color: '#00733E', bgColor: 'bg-green-600' },
  C: { name: 'Colorless', color: '#CBC2BF', bgColor: 'bg-gray-400' },
};

// SVG Pie Chart Component
function PieChart({ data, size = 120, activeColorKey, onSegmentClick }: {
  data: Array<{ color: string; value: number; label: string; colorKey: string }>;
  size?: number;
  activeColorKey?: string | null;
  onSegmentClick?: (colorKey: string) => void;
}) {
  const total = data.reduce((sum, d) => sum + d.value, 0);
  if (total === 0) return null;

  const radius = size / 2;
  const innerRadius = radius * 0.6; // Donut style
  let currentAngle = -90; // Start from top

  const segments = data.filter(d => d.value > 0).map((d) => {
    const angle = (d.value / total) * 360;
    const startAngle = currentAngle;
    const endAngle = currentAngle + angle;
    currentAngle = endAngle;

    const startRad = (startAngle * Math.PI) / 180;
    const endRad = (endAngle * Math.PI) / 180;

    const x1 = radius + radius * Math.cos(startRad);
    const y1 = radius + radius * Math.sin(startRad);
    const x2 = radius + radius * Math.cos(endRad);
    const y2 = radius + radius * Math.sin(endRad);

    const ix1 = radius + innerRadius * Math.cos(startRad);
    const iy1 = radius + innerRadius * Math.sin(startRad);
    const ix2 = radius + innerRadius * Math.cos(endRad);
    const iy2 = radius + innerRadius * Math.sin(endRad);

    const largeArc = angle > 180 ? 1 : 0;

    const path = `
      M ${x1} ${y1}
      A ${radius} ${radius} 0 ${largeArc} 1 ${x2} ${y2}
      L ${ix2} ${iy2}
      A ${innerRadius} ${innerRadius} 0 ${largeArc} 0 ${ix1} ${iy1}
      Z
    `;

    return { ...d, path };
  });

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="cursor-pointer">
      {segments.map((seg, i) => (
        <path
          key={i}
          d={seg.path}
          fill={seg.color}
          className={`transition-opacity ${
            activeColorKey && seg.colorKey !== activeColorKey ? 'opacity-30' : 'hover:opacity-80'
          }`}
          onClick={() => onSegmentClick?.(seg.colorKey)}
        />
      ))}
    </svg>
  );
}

// Calculate mana pip distribution from cards
function calculateManaPips(cards: ScryfallCard[]): Record<string, number> {
  const pips: Record<string, number> = { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 };

  for (const card of cards) {
    const manaCost = card.mana_cost || '';
    const symbols = manaCost.match(/\{[^}]+\}/g) || [];

    for (const symbol of symbols) {
      const clean = symbol.replace(/[{}]/g, '');
      if (clean === 'W') pips.W++;
      else if (clean === 'U') pips.U++;
      else if (clean === 'B') pips.B++;
      else if (clean === 'R') pips.R++;
      else if (clean === 'G') pips.G++;
      else if (clean === 'C') pips.C++;
      // Hybrid mana counts as both
      else if (clean.includes('/')) {
        const parts = clean.split('/');
        for (const part of parts) {
          if (part === 'W') pips.W += 0.5;
          else if (part === 'U') pips.U += 0.5;
          else if (part === 'B') pips.B += 0.5;
          else if (part === 'R') pips.R += 0.5;
          else if (part === 'G') pips.G += 0.5;
        }
      }
    }
  }

  return pips;
}

// Calculate mana production from lands
function calculateManaProduction(cards: ScryfallCard[]): Record<string, number> {
  const production: Record<string, number> = { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 };

  for (const card of cards) {
    const typeLine = card.type_line?.toLowerCase() || '';
    if (!typeLine.includes('land')) continue;

    const producedMana = card.produced_mana || [];
    const oracleText = card.oracle_text?.toLowerCase() || '';

    // Check produced_mana field first
    for (const mana of producedMana) {
      if (mana === 'W') production.W++;
      else if (mana === 'U') production.U++;
      else if (mana === 'B') production.B++;
      else if (mana === 'R') production.R++;
      else if (mana === 'G') production.G++;
      else if (mana === 'C') production.C++;
    }

    // Fallback to basic land types
    if (producedMana.length === 0) {
      if (typeLine.includes('plains') || oracleText.includes('add {w}')) production.W++;
      if (typeLine.includes('island') || oracleText.includes('add {u}')) production.U++;
      if (typeLine.includes('swamp') || oracleText.includes('add {b}')) production.B++;
      if (typeLine.includes('mountain') || oracleText.includes('add {r}')) production.R++;
      if (typeLine.includes('forest') || oracleText.includes('add {g}')) production.G++;
      if (oracleText.includes('add {c}')) production.C++;
    }
  }

  return production;
}

// Stats sidebar
interface DeckStatsProps {
  activeFilter: StatsFilter;
  onFilterChange: (filter: StatsFilter) => void;
}

function DeckStats({ activeFilter, onFilterChange }: DeckStatsProps) {
  const { generatedDeck, colorIdentity } = useStore();
  if (!generatedDeck) return null;

  const { stats, categories, partnerCommander } = generatedDeck;
  const commanderCount = 1 + (partnerCommander ? 1 : 0);
  const totalCardsWithCommander = stats.totalCards + commanderCount;
  const maxCurveCount = Math.max(...Object.values(stats.manaCurve), 1);

  // Get all cards for mana calculations
  const allCards = Object.values(categories).flat();
  const nonLandCards = allCards.filter(c => !c.type_line?.toLowerCase().includes('land'));

  // Calculate mana pips and production
  const manaPips = calculateManaPips(nonLandCards);
  const manaProduction = calculateManaProduction(allCards);

  const totalPips = Object.values(manaPips).reduce((a, b) => a + b, 0);
  const totalProduction = Object.values(manaProduction).reduce((a, b) => a + b, 0);

  // Prepare pie chart data
  const pieData = Object.entries(manaPips)
    .filter(([, value]) => value > 0)
    .map(([color, value]) => ({
      color: MANA_COLORS[color].color,
      value,
      label: MANA_COLORS[color].name,
      colorKey: color,
    }));

  return (
    <div className="bg-card/50 rounded-lg border border-border/50 p-4 space-y-5">
      <div className="flex items-center justify-between">
        <h3 className="font-medium text-sm uppercase tracking-wide text-muted-foreground">Statistics</h3>
        {activeFilter && (
          <button
            onClick={() => onFilterChange(activeFilter)}
            className="flex items-center gap-1.5 text-xs text-primary bg-primary/10 rounded-full px-2.5 py-0.5 hover:bg-primary/20 transition-colors"
          >
            <X className="w-3 h-3" />
            <span>
              {activeFilter.type === 'cmc' && `CMC ${activeFilter.value === 7 ? '7+' : activeFilter.value}`}
              {activeFilter.type === 'color' && `${MANA_COLORS[activeFilter.value]?.name} pips`}
              {activeFilter.type === 'manaProduction' && `${MANA_COLORS[activeFilter.value]?.name} sources`}
            </span>
          </button>
        )}
      </div>

      {/* Basic Stats */}
      <div className="grid grid-cols-2 gap-3">
        <div className="bg-accent/30 rounded-lg p-3 text-center">
          <div className="text-2xl font-bold text-primary">{totalCardsWithCommander}</div>
          <div className="text-xs text-muted-foreground">Cards</div>
        </div>
        <div className="bg-accent/30 rounded-lg p-3 text-center">
          <div className="text-2xl font-bold text-primary">{stats.averageCmc}</div>
          <div className="text-xs text-muted-foreground">Avg CMC</div>
        </div>
      </div>

      {/* Mana Curve */}
      <div>
        <div className="text-xs text-muted-foreground mb-2">Mana Curve</div>
        <div className="flex items-end gap-1 h-16">
          {[0, 1, 2, 3, 4, 5, 6, 7].map((cmc) => {
            const count = stats.manaCurve[cmc] || 0;
            const height = (count / maxCurveCount) * 100;
            const isActive = activeFilter?.type === 'cmc' && activeFilter?.value === cmc;
            return (
              <button
                key={cmc}
                className={`flex-1 flex flex-col items-center ${
                  count === 0 ? 'pointer-events-none' : 'cursor-pointer group'
                }`}
                onClick={() => count > 0 && onFilterChange({ type: 'cmc', value: cmc })}
                title={`${cmc === 7 ? '7+' : cmc} CMC: ${count} cards`}
              >
                <div className="w-full flex flex-col items-center justify-end h-12">
                  <div
                    className={`w-full rounded-t transition-colors ${
                      isActive ? 'bg-primary ring-1 ring-primary/50' : 'bg-primary/70 group-hover:bg-primary/90'
                    }`}
                    style={{ height: `${height}%`, minHeight: count > 0 ? '4px' : '0' }}
                  />
                </div>
                <span className={`text-[10px] mt-1 ${
                  isActive ? 'text-primary font-bold' : 'text-muted-foreground'
                }`}>
                  {cmc === 7 ? '7+' : cmc}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Mana Distribution - Pie Chart */}
      {totalPips > 0 && (
        <div>
          <div className="text-xs text-muted-foreground mb-3">Color Distribution</div>
          <div className="flex items-center gap-4">
            <PieChart
              data={pieData}
              size={80}
              activeColorKey={activeFilter?.type === 'color' ? activeFilter.value : null}
              onSegmentClick={(colorKey) => onFilterChange({ type: 'color', value: colorKey })}
            />
            <div className="flex-1 space-y-0.5">
              {Object.entries(manaPips)
                .filter(([, value]) => value > 0)
                .sort(([, a], [, b]) => b - a)
                .map(([color, value]) => {
                  const percent = ((value / totalPips) * 100).toFixed(0);
                  const isActive = activeFilter?.type === 'color' && activeFilter?.value === color;
                  return (
                    <button
                      key={color}
                      className={`flex items-center gap-2 w-full rounded px-1 py-0.5 transition-colors cursor-pointer ${
                        isActive ? 'bg-accent/50' : 'hover:bg-accent/30'
                      }`}
                      onClick={() => onFilterChange({ type: 'color', value: color })}
                    >
                      <div className={`w-3 h-3 rounded-full ${MANA_COLORS[color].bgColor} ${
                        isActive ? 'ring-2 ring-primary' : ''
                      }`} />
                      <span className="text-xs flex-1 text-left">{MANA_COLORS[color].name}</span>
                      <span className={`text-xs font-medium ${isActive ? 'text-primary' : ''}`}>{percent}%</span>
                    </button>
                  );
                })}
            </div>
          </div>
        </div>
      )}

      {/* Mana Production */}
      {totalProduction > 0 && (
        <div>
          <div className="text-xs text-muted-foreground mb-2">Mana Production</div>
          <div className="space-y-1">
            {Object.entries(manaProduction)
              .filter(([color, value]) => value > 0 && (color === 'C' || colorIdentity.includes(color)))
              .sort(([, a], [, b]) => b - a)
              .map(([color, value]) => {
                const percent = (value / totalProduction) * 100;
                const isActive = activeFilter?.type === 'manaProduction' && activeFilter?.value === color;
                return (
                  <button
                    key={color}
                    className={`w-full text-left rounded px-1 py-1 transition-colors cursor-pointer ${
                      isActive ? 'bg-accent/50' : 'hover:bg-accent/30'
                    }`}
                    onClick={() => onFilterChange({ type: 'manaProduction', value: color })}
                  >
                    <div className="flex items-center justify-between text-xs mb-1">
                      <div className="flex items-center gap-2">
                        <div className={`w-2.5 h-2.5 rounded-full ${MANA_COLORS[color].bgColor} ${
                          isActive ? 'ring-2 ring-primary' : ''
                        }`} />
                        <span>{MANA_COLORS[color].name}</span>
                      </div>
                      <span className="text-muted-foreground">{value} sources ({percent.toFixed(0)}%)</span>
                    </div>
                    <div className="h-1.5 bg-accent/50 rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full ${MANA_COLORS[color].bgColor} ${isActive ? 'opacity-100' : 'opacity-80'}`}
                        style={{ width: `${percent}%` }}
                      />
                    </div>
                  </button>
                );
              })}
          </div>
        </div>
      )}

      {/* Type Distribution */}
      <div>
        <div className="text-xs text-muted-foreground mb-2">Types</div>
        <div className="space-y-1">
          {Object.entries(stats.typeDistribution)
            .sort(([, a], [, b]) => b - a)
            .slice(0, 5)
            .map(([type, count]) => (
              <div key={type} className="flex justify-between text-xs">
                <span>{type}</span>
                <span className="text-muted-foreground">{count}</span>
              </div>
            ))}
        </div>
      </div>
    </div>
  );
}

type GroupedCards = Record<CardType, Array<{ card: ScryfallCard; quantity: number }>>;

// Main component
export function DeckDisplay() {
  const { generatedDeck, commander, customization } = useStore();
  const formatConfig = getDeckFormatConfig(customization.deckFormat);
  const [previewCard, setPreviewCard] = useState<ScryfallCard | null>(null);
  const [hoverCard, setHoverCard] = useState<{ card: ScryfallCard; position: { x: number; y: number }; showBack?: boolean } | null>(null);
  const [showExportModal, setShowExportModal] = useState(false);
  const [viewMode, setViewMode] = useState<'list' | 'grid'>('list');
  const [sortBy, setSortBy] = useState<'name' | 'cmc' | 'price'>('name');
  const [statsFilter, setStatsFilter] = useState<StatsFilter>(null);

  const handleStatsFilterChange = useCallback((newFilter: StatsFilter) => {
    setStatsFilter(prev => {
      if (prev && newFilter &&
          prev.type === newFilter.type &&
          prev.value === newFilter.value) {
        return null;
      }
      return newFilter;
    });
  }, []);

  // Group cards by type and count duplicates
  const groupedCards = useMemo((): GroupedCards => {
    const emptyGroups: GroupedCards = {
      Commander: [],
      Creature: [],
      Planeswalker: [],
      Instant: [],
      Sorcery: [],
      Artifact: [],
      Enchantment: [],
      Land: [],
    };

    if (!generatedDeck) return emptyGroups;

    const allCards = Object.values(generatedDeck.categories).flat();
    const groups: Record<CardType, Map<string, { card: ScryfallCard; quantity: number }>> = {
      Commander: new Map(),
      Creature: new Map(),
      Planeswalker: new Map(),
      Instant: new Map(),
      Sorcery: new Map(),
      Artifact: new Map(),
      Enchantment: new Map(),
      Land: new Map(),
    };

    // Add commander(s) only for formats that have a commander
    if (formatConfig.hasCommander) {
      if (commander) {
        groups.Commander.set(commander.name, { card: commander, quantity: 1 });
      }
      if (generatedDeck.partnerCommander) {
        groups.Commander.set(generatedDeck.partnerCommander.name, { card: generatedDeck.partnerCommander, quantity: 1 });
      }
    }

    // Group other cards
    allCards.forEach((card) => {
      const type = getCardType(card);
      const existing = groups[type].get(card.name);
      if (existing) {
        existing.quantity++;
      } else {
        groups[type].set(card.name, { card, quantity: 1 });
      }
    });

    // Convert to sorted arrays
    const result: GroupedCards = { ...emptyGroups };

    TYPE_ORDER.forEach((type) => {
      const cards = Array.from(groups[type].values());

      // Sort
      cards.sort((a, b) => {
        if (sortBy === 'name') return a.card.name.localeCompare(b.card.name);
        if (sortBy === 'cmc') return a.card.cmc - b.card.cmc;
        if (sortBy === 'price') {
          const priceA = parseFloat(getCardPrice(a.card) || '0');
          const priceB = parseFloat(getCardPrice(b.card) || '0');
          return priceB - priceA;
        }
        return 0;
      });

      result[type] = cards;
    });

    return result;
  }, [generatedDeck, commander, sortBy, formatConfig.hasCommander]);

  // Build set of card IDs matching the active stats filter
  const matchingCardIds = useMemo(() => {
    if (!statsFilter) return null;
    const allGrouped = Object.values(groupedCards).flat();
    const ids = new Set<string>();
    for (const { card } of allGrouped) {
      if (cardMatchesFilter(card, statsFilter)) {
        ids.add(card.id);
      }
    }
    return ids;
  }, [statsFilter, groupedCards]);

  const handleHover = (card: ScryfallCard | null, e?: React.MouseEvent, showBack?: boolean) => {
    if (card && e) {
      setHoverCard({ card, position: { x: e.clientX, y: e.clientY }, showBack });
    } else {
      setHoverCard(null);
    }
  };

  const generateDeckList = useCallback((excludeMustIncludes: boolean = false) => {
    const lines: string[] = [];

    TYPE_ORDER.forEach((type) => {
      const cards = groupedCards[type];
      if (cards && cards.length > 0) {
        cards.forEach(({ card, quantity }) => {
          if (excludeMustIncludes && card.isMustInclude) return;
          lines.push(`${quantity} ${card.name}`);
        });
      }
    });

    return lines.join('\n');
  }, [groupedCards]);

  if (!generatedDeck) return null;

  const { usedThemes } = generatedDeck;
  const allGroupedCards = Object.values(groupedCards).flat();
  const totalCards = allGroupedCards.reduce((sum, c) => sum + c.quantity, 0);
  const totalPrice = allGroupedCards.reduce((sum, c) => {
    const price = parseFloat(getCardPrice(c.card) || '0');
    return sum + (isNaN(price) ? 0 : price * c.quantity);
  }, 0);

  return (
    <>
      <div className="animate-slide-up">
        {/* Header */}
        <div className="flex items-center justify-between mb-4 flex-wrap gap-4">
          <div className="flex items-center gap-4">
            {/* Sort */}
            <div className="flex items-center gap-2 bg-card/50 rounded-lg px-3 py-1.5 border border-border/50">
              <ArrowUpDown className="w-4 h-4 text-muted-foreground" />
              <span className="text-xs text-muted-foreground">SORT:</span>
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as 'name' | 'cmc' | 'price')}
                className="bg-transparent text-xs text-primary font-medium focus:outline-none cursor-pointer"
              >
                <option value="name">NAME</option>
                <option value="cmc">CMC</option>
                <option value="price">PRICE</option>
              </select>
            </div>

            {/* View Toggle */}
            <div className="flex bg-card/50 rounded-lg p-1 border border-border/50">
              <button
                onClick={() => setViewMode('grid')}
                className={`p-1.5 rounded ${viewMode === 'grid' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'}`}
              >
                <Grid3X3 className="w-4 h-4" />
              </button>
              <button
                onClick={() => setViewMode('list')}
                className={`p-1.5 rounded ${viewMode === 'list' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'}`}
              >
                <List className="w-4 h-4" />
              </button>
            </div>
          </div>

          <div className="flex items-center gap-4">
            <div className="text-sm text-muted-foreground">
              {totalCards} cards · ${totalPrice.toFixed(2)}
              {(customization.budgetOption !== 'any' || customization.maxCardPrice !== null) && (
                <span className="ml-1 text-xs">
                  ({[
                    customization.budgetOption === 'budget' ? 'Budget' : customization.budgetOption === 'expensive' ? 'Expensive' : null,
                    customization.maxCardPrice !== null ? `<$${customization.maxCardPrice}` : null,
                  ].filter(Boolean).join(' · ')})
                </span>
              )}
              {usedThemes && usedThemes.length > 0 && (
                <span className="ml-2">
                  · Built with: <span className="text-primary font-medium">{usedThemes.join(', ')}</span>
                </span>
              )}
            </div>
            <Button onClick={() => setShowExportModal(true)} className="glow">
              <Copy className="w-4 h-4 mr-2" />
              Export
            </Button>
          </div>
        </div>

        {/* Stats - Mobile/Tablet (above deck list) */}
        <div className="xl:hidden mb-6">
          <DeckStats activeFilter={statsFilter} onFilterChange={handleStatsFilterChange} />
        </div>

        {/* Main Content */}
        <div className="flex gap-6">
          {/* Deck List */}
          <div className="flex-1 bg-card/30 rounded-lg border border-border/50 overflow-hidden">
            {viewMode === 'list' ? (
              <div className="p-4" style={{ columnWidth: '280px', columnGap: '2rem' }}>
                {TYPE_ORDER.map((type) => (
                  <CategoryColumn
                    key={type}
                    type={type}
                    cards={groupedCards[type] || []}
                    onPreview={setPreviewCard}
                    onHover={handleHover}
                    matchingCardIds={matchingCardIds}
                  />
                ))}
              </div>
            ) : (
              <div className="p-4 grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8 gap-2">
                {TYPE_ORDER.flatMap((type) =>
                  (groupedCards[type] || []).map(({ card, quantity }) => {
                    const dimmed = matchingCardIds !== null && !matchingCardIds.has(card.id);
                    return (
                      <button
                        key={card.id}
                        onClick={() => setPreviewCard(card)}
                        className={`relative group transition-opacity duration-200 ${
                          dimmed ? 'opacity-30' : ''
                        }`}
                      >
                        <img
                          src={getCardImageUrl(card, 'small')}
                          alt={card.name}
                          className={`w-full rounded transition-transform ${dimmed ? '' : 'group-hover:scale-105'}`}
                          loading="lazy"
                        />
                        {quantity > 1 && (
                          <span className="absolute top-1 right-1 bg-black/80 text-white text-xs px-1.5 rounded">
                            {quantity}x
                          </span>
                        )}
                        {isDoubleFacedCard(card) && (
                          <span className="absolute bottom-1 right-1 bg-black/70 text-white rounded-full w-5 h-5 flex items-center justify-center" title="Double-faced card">
                            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="w-3 h-3">
                              <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
                              <path d="M3 3v5h5" />
                            </svg>
                          </span>
                        )}
                      </button>
                    );
                  })
                )}
              </div>
            )}
          </div>

          {/* Stats Sidebar - Desktop only */}
          <div className="hidden xl:block w-64 shrink-0">
            <DeckStats activeFilter={statsFilter} onFilterChange={handleStatsFilterChange} />
          </div>
        </div>
      </div>

      {/* Floating Preview */}
      {hoverCard && viewMode === 'list' && (
        <FloatingPreview card={hoverCard.card} position={hoverCard.position} showBack={hoverCard.showBack} />
      )}

      {/* Modals */}
      <CardPreviewModal card={previewCard} onClose={() => setPreviewCard(null)} />
      <ExportModal isOpen={showExportModal} onClose={() => setShowExportModal(false)} generateDeckList={generateDeckList} hasMustIncludes={customization.mustIncludeCards.length > 0} />
    </>
  );
}
