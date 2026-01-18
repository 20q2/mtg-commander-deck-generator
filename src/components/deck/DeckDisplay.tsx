import { useState, useCallback, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { useStore } from '@/store';
import { getCardImageUrl } from '@/services/scryfall/client';
import { DECK_FORMAT_CONFIGS } from '@/lib/constants/archetypes';
import type { ScryfallCard } from '@/types';
import {
  Copy,
  Check,
  ExternalLink,
  Download,
  X,
  Grid3X3,
  List,
  ArrowUpDown,
} from 'lucide-react';
import { CardTypeIcon, ManaCost } from '@/components/ui/mtg-icons';

// Card type categories for Moxfield-style grouping
type CardType = 'Commander' | 'Creature' | 'Planeswalker' | 'Instant' | 'Sorcery' | 'Artifact' | 'Enchantment' | 'Land';

const TYPE_ORDER: CardType[] = ['Commander', 'Planeswalker', 'Creature', 'Artifact', 'Enchantment', 'Instant', 'Sorcery', 'Land'];

// Get primary card type from type_line
function getCardType(card: ScryfallCard): CardType {
  const typeLine = card.type_line?.toLowerCase() || '';

  if (typeLine.includes('planeswalker')) return 'Planeswalker';
  if (typeLine.includes('creature')) return 'Creature';
  if (typeLine.includes('instant')) return 'Instant';
  if (typeLine.includes('sorcery')) return 'Sorcery';
  if (typeLine.includes('artifact')) return 'Artifact';
  if (typeLine.includes('enchantment')) return 'Enchantment';
  if (typeLine.includes('land')) return 'Land';

  return 'Artifact'; // Default fallback
}

// Format price
function formatPrice(price: string | undefined): string {
  if (!price) return '';
  const num = parseFloat(price);
  if (isNaN(num)) return '';
  return `$${num.toFixed(2)}`;
}

// Card row component
interface CardRowProps {
  card: ScryfallCard;
  quantity: number;
  onPreview: (card: ScryfallCard) => void;
  onHover: (card: ScryfallCard | null, e?: React.MouseEvent) => void;
}

function CardRow({ card, quantity, onPreview, onHover }: CardRowProps) {
  const price = formatPrice(card.prices?.usd);

  return (
    <button
      className="w-full text-left px-2 py-1 hover:bg-accent/50 rounded text-sm flex items-center gap-2 group transition-colors"
      onClick={() => onPreview(card)}
      onMouseEnter={(e) => onHover(card, e)}
      onMouseLeave={() => onHover(null)}
    >
      <span className="text-muted-foreground w-4 text-right shrink-0">{quantity}</span>
      <span className="flex-1 truncate group-hover:text-primary transition-colors">
        {card.name}
      </span>
      <ManaCost cost={card.mana_cost} />
      {price && (
        <span className="text-muted-foreground text-xs w-16 text-right shrink-0">
          {price}
        </span>
      )}
    </button>
  );
}

// Category column component
interface CategoryColumnProps {
  type: CardType;
  cards: Array<{ card: ScryfallCard; quantity: number }>;
  onPreview: (card: ScryfallCard) => void;
  onHover: (card: ScryfallCard | null, e?: React.MouseEvent) => void;
}

function CategoryColumn({ type, cards, onPreview, onHover }: CategoryColumnProps) {
  if (cards.length === 0) return null;

  const totalCards = cards.reduce((sum, c) => sum + c.quantity, 0);
  const totalPrice = cards.reduce((sum, c) => {
    const price = parseFloat(c.card.prices?.usd || '0');
    return sum + (isNaN(price) ? 0 : price * c.quantity);
  }, 0);

  return (
    <div className="break-inside-avoid mb-4">
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
}

function FloatingPreview({ card, position }: FloatingPreviewProps) {
  const style: React.CSSProperties = {
    position: 'fixed',
    left: Math.min(position.x + 20, window.innerWidth - 280),
    top: Math.min(position.y - 100, window.innerHeight - 400),
    zIndex: 100,
  };

  return (
    <div style={style} className="pointer-events-none card-preview-enter">
      <img
        src={getCardImageUrl(card, 'normal')}
        alt={card.name}
        className="w-64 rounded-lg shadow-2xl border border-border/50"
      />
    </div>
  );
}

// Card preview modal
interface CardPreviewModalProps {
  card: ScryfallCard | null;
  onClose: () => void;
}

function CardPreviewModal({ card, onClose }: CardPreviewModalProps) {
  if (!card) return null;

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
        <img
          src={getCardImageUrl(card, 'large')}
          alt={card.name}
          className="max-h-[80vh] rounded-xl shadow-2xl"
        />
        <div className="mt-4 text-center">
          <h3 className="text-white font-bold text-lg">{card.name}</h3>
          <p className="text-white/70 text-sm">{card.type_line}</p>
          {card.prices?.usd && (
            <p className="text-white/50 text-xs mt-1">${card.prices.usd}</p>
          )}
        </div>
      </div>
    </div>
  );
}

// Export modal
interface ExportModalProps {
  isOpen: boolean;
  onClose: () => void;
  deckList: string;
}

function ExportModal({ isOpen, onClose, deckList }: ExportModalProps) {
  const [copied, setCopied] = useState(false);

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
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <Button onClick={handleCopy} variant="outline" className="flex-col h-auto py-3">
              {copied ? <Check className="w-5 h-5 mb-1 text-green-500" /> : <Copy className="w-5 h-5 mb-1" />}
              <span className="text-xs">{copied ? 'Copied!' : 'Copy'}</span>
            </Button>
            <Button onClick={handleDownload} variant="outline" className="flex-col h-auto py-3">
              <Download className="w-5 h-5 mb-1" />
              <span className="text-xs">Download</span>
            </Button>
            <a
              href="https://www.moxfield.com/decks/new"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex flex-col items-center justify-center rounded-md text-sm font-medium h-auto py-3 border border-input bg-background hover:bg-accent transition-colors"
            >
              <ExternalLink className="w-5 h-5 mb-1" />
              <span className="text-xs">Moxfield</span>
            </a>
            <a
              href="https://archidekt.com/decks"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex flex-col items-center justify-center rounded-md text-sm font-medium h-auto py-3 border border-input bg-background hover:bg-accent transition-colors"
            >
              <ExternalLink className="w-5 h-5 mb-1" />
              <span className="text-xs">Archidekt</span>
            </a>
          </div>

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
function PieChart({ data, size = 120 }: { data: Array<{ color: string; value: number; label: string }>; size?: number }) {
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
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      {segments.map((seg, i) => (
        <path key={i} d={seg.path} fill={seg.color} className="transition-opacity hover:opacity-80" />
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
function DeckStats() {
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
    }));

  return (
    <div className="bg-card/50 rounded-lg border border-border/50 p-4 space-y-5">
      <h3 className="font-medium text-sm uppercase tracking-wide text-muted-foreground">Statistics</h3>

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
            return (
              <div key={cmc} className="flex-1 flex flex-col items-center">
                <div className="w-full flex flex-col items-center justify-end h-12">
                  <div
                    className="w-full bg-primary/70 rounded-t"
                    style={{ height: `${height}%`, minHeight: count > 0 ? '4px' : '0' }}
                  />
                </div>
                <span className="text-[10px] text-muted-foreground mt-1">
                  {cmc === 7 ? '7+' : cmc}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Mana Distribution - Pie Chart */}
      {totalPips > 0 && (
        <div>
          <div className="text-xs text-muted-foreground mb-3">Color Distribution</div>
          <div className="flex items-center gap-4">
            <PieChart data={pieData} size={80} />
            <div className="flex-1 space-y-1.5">
              {Object.entries(manaPips)
                .filter(([, value]) => value > 0)
                .sort(([, a], [, b]) => b - a)
                .map(([color, value]) => {
                  const percent = ((value / totalPips) * 100).toFixed(0);
                  return (
                    <div key={color} className="flex items-center gap-2">
                      <div className={`w-3 h-3 rounded-full ${MANA_COLORS[color].bgColor}`} />
                      <span className="text-xs flex-1">{MANA_COLORS[color].name}</span>
                      <span className="text-xs font-medium">{percent}%</span>
                    </div>
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
          <div className="space-y-2">
            {Object.entries(manaProduction)
              .filter(([color, value]) => value > 0 && (color === 'C' || colorIdentity.includes(color)))
              .sort(([, a], [, b]) => b - a)
              .map(([color, value]) => {
                const percent = (value / totalProduction) * 100;
                return (
                  <div key={color} className="space-y-1">
                    <div className="flex items-center justify-between text-xs">
                      <div className="flex items-center gap-2">
                        <div className={`w-2.5 h-2.5 rounded-full ${MANA_COLORS[color].bgColor}`} />
                        <span>{MANA_COLORS[color].name}</span>
                      </div>
                      <span className="text-muted-foreground">{value} sources</span>
                    </div>
                    <div className="h-1.5 bg-accent/50 rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full ${MANA_COLORS[color].bgColor} opacity-80`}
                        style={{ width: `${percent}%` }}
                      />
                    </div>
                  </div>
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
  const formatConfig = DECK_FORMAT_CONFIGS[customization.deckFormat];
  const [previewCard, setPreviewCard] = useState<ScryfallCard | null>(null);
  const [hoverCard, setHoverCard] = useState<{ card: ScryfallCard; position: { x: number; y: number } } | null>(null);
  const [showExportModal, setShowExportModal] = useState(false);
  const [viewMode, setViewMode] = useState<'list' | 'grid'>('list');
  const [sortBy, setSortBy] = useState<'name' | 'cmc' | 'price'>('name');

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
          const priceA = parseFloat(a.card.prices?.usd || '0');
          const priceB = parseFloat(b.card.prices?.usd || '0');
          return priceB - priceA;
        }
        return 0;
      });

      result[type] = cards;
    });

    return result;
  }, [generatedDeck, commander, sortBy, formatConfig.hasCommander]);

  const handleHover = (card: ScryfallCard | null, e?: React.MouseEvent) => {
    if (card && e) {
      setHoverCard({ card, position: { x: e.clientX, y: e.clientY } });
    } else {
      setHoverCard(null);
    }
  };

  const generateDeckList = () => {
    const lines: string[] = [];

    TYPE_ORDER.forEach((type) => {
      const cards = groupedCards[type];
      if (cards && cards.length > 0) {
        cards.forEach(({ card, quantity }) => {
          lines.push(`${quantity} ${card.name}`);
        });
      }
    });

    return lines.join('\n');
  };

  if (!generatedDeck) return null;

  const { usedThemes } = generatedDeck;
  const allGroupedCards = Object.values(groupedCards).flat();
  const totalCards = allGroupedCards.reduce((sum, c) => sum + c.quantity, 0);
  const totalPrice = allGroupedCards.reduce((sum, c) => {
    const price = parseFloat(c.card.prices?.usd || '0');
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

        {/* Main Content */}
        <div className="flex gap-6">
          {/* Deck List */}
          <div className="flex-1 bg-card/30 rounded-lg border border-border/50 overflow-hidden">
            {viewMode === 'list' ? (
              <div className="columns-3 xl:columns-4 p-2 gap-6">
                {TYPE_ORDER.map((type) => (
                  <CategoryColumn
                    key={type}
                    type={type}
                    cards={groupedCards[type] || []}
                    onPreview={setPreviewCard}
                    onHover={handleHover}
                  />
                ))}
              </div>
            ) : (
              <div className="p-4 grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8 gap-2">
                {TYPE_ORDER.flatMap((type) =>
                  (groupedCards[type] || []).map(({ card, quantity }) => (
                    <button
                      key={card.id}
                      onClick={() => setPreviewCard(card)}
                      className="relative group"
                    >
                      <img
                        src={getCardImageUrl(card, 'small')}
                        alt={card.name}
                        className="w-full rounded transition-transform group-hover:scale-105"
                        loading="lazy"
                      />
                      {quantity > 1 && (
                        <span className="absolute top-1 right-1 bg-black/80 text-white text-xs px-1.5 rounded">
                          {quantity}x
                        </span>
                      )}
                    </button>
                  ))
                )}
              </div>
            )}
          </div>

          {/* Stats Sidebar */}
          <div className="hidden xl:block w-64 shrink-0">
            <DeckStats />
          </div>
        </div>
      </div>

      {/* Floating Preview */}
      {hoverCard && viewMode === 'list' && (
        <FloatingPreview card={hoverCard.card} position={hoverCard.position} />
      )}

      {/* Modals */}
      <CardPreviewModal card={previewCard} onClose={() => setPreviewCard(null)} />
      <ExportModal isOpen={showExportModal} onClose={() => setShowExportModal(false)} deckList={generateDeckList()} />
    </>
  );
}
