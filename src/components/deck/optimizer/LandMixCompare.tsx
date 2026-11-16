import { useMemo } from 'react';
import type { AnalyzedCard } from '@/services/deckBuilder/deckAnalyzer';
import { flexKind, landKind, type LandKind } from '@/services/deckBuilder/landMix';
import { recommendedMix } from '@/services/deckBuilder/landMixRecommendation';
import { isBasicLand } from '@/services/scryfall/client';
import { landGroupsFor, type LandGroup, useLandMixRecommendation } from '@/components/customization/NonBasicMixControl';

type Split = Record<LandKind, number>;

/**
 * This deck's non-basics by group, next to what this commander's decks typically run — scaled to
 * the same number of non-basics so the two bars compare like for like. Spell lands count (the
 * analysis files MDFCs with the lands).
 */
export function LandMixCompare({ landCards, commanderName, partnerName, colorIdentity, suggestedNonbasic }: {
  landCards: AnalyzedCard[];
  commanderName?: string;
  partnerName?: string | null;
  colorIdentity: string[];
  suggestedNonbasic: number;
}) {
  const rec = useLandMixRecommendation(commanderName, partnerName, colorIdentity);
  const flex = flexKind(colorIdentity);
  const groups = landGroupsFor(colorIdentity);

  const yours = useMemo(() => {
    const names: Record<LandKind, string[]> = { fixing: [], mdfc: [], utility: [], other: [] };
    for (const { card } of landCards) {
      if (isBasicLand(card)) continue;
      const kind = landKind(card, colorIdentity);
      names[kind === 'fixing' && flex === 'other' ? 'other' : kind].push(card.name);
    }
    return names;
  }, [landCards, colorIdentity, flex]);

  const yourTotal = groups.reduce((s, g) => s + yours[g.kind].length, 0);
  // A deck with no non-basics yet still gets a target to look at: the commander's usual count.
  const scaleTo = yourTotal || suggestedNonbasic;
  const typical: Split | null = rec.data && scaleTo > 0 ? (() => {
    const m = recommendedMix(rec.data, scaleTo);
    return { fixing: scaleTo - m.mdfc - m.utility - m.other, mdfc: m.mdfc, utility: m.utility, other: m.other };
  })() : null;
  if (typical && flex === 'other') { typical.other += typical.fixing; typical.fixing = 0; }

  const yourSplit: Split = {
    fixing: yours.fixing.length, mdfc: yours.mdfc.length, utility: yours.utility.length, other: yours.other.length,
  };

  const firstName = commanderName?.split(',')[0];
  return (
    <div className="space-y-2">
      {/* One pill, two rows: yours over typical, split by a thicker rule so the columns line up by eye. */}
      <div className="flex gap-2">
        <div className="w-12 shrink-0 flex flex-col text-[10px] text-muted-foreground">
          <span className="h-5 flex items-center">Yours</span>
          <span className="h-[3px]" />
          <span className="h-5 flex items-center">Typical</span>
        </div>
        <div className="flex-1 min-w-0 flex flex-col rounded-xl overflow-hidden bg-muted/30">
          <MixRow split={yourSplit} groups={groups} titles={yours} empty="No non-basic lands" />
          <div className="h-[3px] bg-background" />
          {rec.isLoading ? (
            <div className="h-5 bg-muted/40 animate-pulse" />
          ) : typical ? (
            <MixRow split={typical} groups={groups} />
          ) : (
            <MixRow split={null} groups={groups} empty="No EDHREC data for this commander" />
          )}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 pt-0.5">
        {groups.map(g => (
          <span key={g.kind} className="flex items-center gap-1 text-[10px] text-muted-foreground" title={g.hint}>
            <span className={`${g.text} text-[11px] leading-none`}>{g.icon}</span>
            {g.label}
          </span>
        ))}
      </div>
      {typical && rec.data && rec.data.numDecks > 0 && (
        <p className="text-[10px] text-muted-foreground/60 leading-snug">
          Typical from {rec.data.numDecks.toLocaleString()} {partnerName ? 'decks with this pair' : `${firstName} decks`}, at {yourTotal ? `your ${scaleTo}` : scaleTo} non-basics
        </p>
      )}
    </div>
  );
}

/** One row of the shared pill. A zero group keeps a slim slice so both rows show every group. */
function MixRow({ split, groups, titles, empty }: {
  split: Split | null;
  groups: LandGroup[];
  titles?: Record<LandKind, string[]>;
  empty?: string;
}) {
  const total = split ? groups.reduce((s, g) => s + split[g.kind], 0) : 0;
  if (!split || total === 0) {
    return <div className="h-5 flex items-center px-2.5 text-[10px] text-muted-foreground/70">{empty}</div>;
  }
  return (
    <div className="flex h-5 gap-px">
      {groups.map(g => {
        const n = split[g.kind];
        if (n === 0) return <div key={g.kind} className={`${g.fill} opacity-60`} style={{ flex: '0 0 4px' }} title={`${g.label}: 0`} />;
        const names = titles?.[g.kind];
        return (
          <div
            key={g.kind}
            className={`${g.fill} flex items-center justify-center gap-1 min-w-0 text-[10px] font-semibold text-white tabular-nums`}
            style={{ flex: `${n} 0 0`, textShadow: '0 1px 2px rgba(0,0,0,0.6)' }}
            title={names?.length ? [`${g.label} (${n})`, ...names].join('\n') : `${g.label}: ${n}`}
          >
            {n >= 3 && <span className="leading-none">{g.icon}</span>}
            {n}
          </div>
        );
      })}
    </div>
  );
}
