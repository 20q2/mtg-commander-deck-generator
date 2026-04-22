import { useMemo } from 'react';
import type { CollectionCard } from '@/services/collection/db';
import { CardTypeIcon } from '@/components/ui/mtg-icons';

interface CollectionStatsProps {
  cards: CollectionCard[];
}

const COLOR_HEX: Record<string, string> = {
  W: '#C8C3B0',
  U: '#4B8BBE',
  B: '#9B7FBF',
  R: '#C75C5C',
  G: '#5A9A6E',
};

const COLOR_LABELS: Record<string, string> = {
  W: 'White',
  U: 'Blue',
  B: 'Black',
  R: 'Red',
  G: 'Green',
  C: 'Colorless',
  M: 'Multicolor',
};

const RARITY_ORDER = ['mythic', 'rare', 'uncommon', 'common'] as const;
const RARITY_CONFIG: Record<string, { color: string; label: string }> = {
  common: { color: '#6B7280', label: 'Common' },
  uncommon: { color: '#A0A0A0', label: 'Uncommon' },
  rare: { color: '#D4A843', label: 'Rare' },
  mythic: { color: '#D45E2E', label: 'Mythic' },
};

const CARD_TYPES = ['Creature', 'Instant', 'Sorcery', 'Artifact', 'Enchantment', 'Planeswalker', 'Land'] as const;
const COLOR_ORDER = ['W', 'U', 'B', 'R', 'G'] as const;
const PIE_COLORS = [...COLOR_ORDER, 'M' as const, 'C' as const];


export function CollectionStats({ cards }: CollectionStatsProps) {
  const stats = useMemo(() => {
    if (cards.length === 0) return null;

    // Color identity distribution
    const colorCounts: Record<string, number> = { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0, M: 0 };
    for (const card of cards) {
      const ci = card.colorIdentity;
      if (!ci || ci.length === 0) {
        colorCounts.C++;
      } else if (ci.length > 1) {
        colorCounts.M++;
      } else {
        colorCounts[ci[0]] = (colorCounts[ci[0]] || 0) + 1;
      }
    }

    // Type breakdown with per-type color segments
    const typeCounts: Record<string, number> = {};
    const typeColorCounts: Record<string, Record<string, number>> = {};
    for (const t of CARD_TYPES) {
      typeCounts[t] = 0;
      typeColorCounts[t] = { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 };
    }
    for (const card of cards) {
      if (!card.typeLine) continue;
      const tl = card.typeLine.split('—')[0].split('//')[0];
      for (const type of CARD_TYPES) {
        if (tl.toLowerCase().includes(type.toLowerCase())) {
          typeCounts[type]++;
          const ci = card.colorIdentity;
          if (!ci || ci.length === 0) {
            typeColorCounts[type].C++;
          } else {
            for (const c of ci) {
              typeColorCounts[type][c] = (typeColorCounts[type][c] || 0) + 1;
            }
          }
        }
      }
    }

    // Rarity breakdown
    const rarityCounts: Record<string, number> = { common: 0, uncommon: 0, rare: 0, mythic: 0 };
    for (const card of cards) {
      if (card.rarity && rarityCounts[card.rarity] !== undefined) {
        rarityCounts[card.rarity]++;
      }
    }

    return { colorCounts, typeCounts, typeColorCounts, rarityCounts };
  }, [cards]);

  if (!stats) return null;

  const maxTypeCount = Math.max(...CARD_TYPES.map(t => stats.typeCounts[t]));
  const totalRarityCards = Object.values(stats.rarityCounts).reduce((s, v) => s + v, 0);
  const maxRarityCount = Math.max(...Object.values(stats.rarityCounts));

  return (
    <div className="grid sm:grid-cols-3 gap-3">
      {/* Colors — horizontal bars */}
      <div className="rounded-xl border border-border/50 bg-card/50 backdrop-blur-sm p-3 space-y-2">
        <h3 className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Colors</h3>
        <div className="space-y-1.5">
          {PIE_COLORS.map(c => {
            const count = stats.colorCounts[c] || 0;
            if (count === 0) return null;
            const bg = c === 'C' ? '#6B7280' : c === 'M' ? '#D4A843' : COLOR_HEX[c];
            const maxColorCount = Math.max(...PIE_COLORS.map(k => stats.colorCounts[k] || 0));
            const fillPct = maxColorCount > 0 ? (count / maxColorCount) * 100 : 0;
            const pctOfTotal = ((count / cards.length) * 100).toFixed(0);
            return (
              <div key={c} className="space-y-0.5">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5">
                    {c === 'M' ? (
                      <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: bg }} />
                    ) : (
                      <i className={`ms ms-${c.toLowerCase()} ms-cost text-xs`} style={{ opacity: 0.85 }} />
                    )}
                    <span className="text-[11px] text-muted-foreground">{COLOR_LABELS[c]}</span>
                  </div>
                  <span className="text-[11px] tabular-nums">
                    <span className="text-foreground font-medium">{count}</span>
                    <span className="text-muted-foreground/60 ml-1">({pctOfTotal}%)</span>
                  </span>
                </div>
                <div className="h-1.5 bg-border/30 rounded-full overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all"
                    style={{ width: `${fillPct}%`, backgroundColor: bg }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Types — horizontal bars */}
      <div className="rounded-xl border border-border/50 bg-card/50 backdrop-blur-sm p-3 space-y-2">
        <h3 className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Types</h3>
        <div className="space-y-1">
          {CARD_TYPES.map(t => {
            const count = stats.typeCounts[t];
            if (count === 0) return null;
            const fillPct = maxTypeCount > 0 ? (count / maxTypeCount) * 100 : 0;
            const cc = stats.typeColorCounts[t];
            const totalPips = [...COLOR_ORDER, 'C' as const].reduce((s, c) => s + (cc[c] || 0), 0);
            return (
              <div key={t} className="flex items-center gap-1.5 text-[11px]">
                <span title={t} className="shrink-0 w-4 text-center">
                  <CardTypeIcon type={t} size="sm" className="opacity-60" />
                </span>
                <div className="flex-1 h-2 bg-border/30 rounded-full overflow-hidden flex">
                  {totalPips > 0 && [...COLOR_ORDER, 'C' as const].map(c => {
                    const segPct = (cc[c] || 0) / totalPips * fillPct;
                    if (segPct === 0) return null;
                    const bg = c === 'C' ? '#6B7280' : COLOR_HEX[c];
                    return <div key={c} className="h-full" style={{ width: `${segPct}%`, backgroundColor: bg }} />;
                  })}
                </div>
                <span className="text-muted-foreground tabular-nums w-5 text-right shrink-0">{count}</span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Rarity breakdown */}
      <div className="rounded-xl border border-border/50 bg-card/50 backdrop-blur-sm p-3 space-y-2">
        <h3 className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Rarity</h3>
        {totalRarityCards > 0 && (
          <div className="space-y-1.5">
            {RARITY_ORDER.map(r => {
              const count = stats.rarityCounts[r];
              if (count === 0) return null;
              const cfg = RARITY_CONFIG[r];
              const fillPct = maxRarityCount > 0 ? (count / maxRarityCount) * 100 : 0;
              const pctOfTotal = ((count / totalRarityCards) * 100).toFixed(0);
              return (
                <div key={r} className="space-y-0.5">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5">
                      <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: cfg.color }} />
                      <span className="text-[11px] text-muted-foreground">{cfg.label}</span>
                    </div>
                    <span className="text-[11px] tabular-nums">
                      <span className="text-foreground font-medium">{count}</span>
                      <span className="text-muted-foreground/60 ml-1">({pctOfTotal}%)</span>
                    </span>
                  </div>
                  <div className="h-1.5 bg-border/30 rounded-full overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all"
                      style={{ width: `${fillPct}%`, backgroundColor: cfg.color }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
