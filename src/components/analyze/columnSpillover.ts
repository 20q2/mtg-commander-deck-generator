import type { ScryfallCard } from '@/types';

export interface GroupData {
  key: string;
  label: string;
  creatures: ScryfallCard[];
  noncreatures: ScryfallCard[];
}

export interface SubColumn {
  /** Unique key for React: `${groupKey}:${subIndex}`. */
  key: string;
  /** Original group key (same across all sub-cols of the same group). */
  groupKey: string;
  /** Original group label. */
  groupLabel: string;
  /** True for the first sub-col of each group — the only one that renders the header. */
  isFirstOfGroup: boolean;
  /** How many sub-cols this group occupies (K_i). Used by the header's gridColumn span. */
  span: number;
  /** Sum of creatures + noncreatures in the original group, for the header count. */
  groupTotalCount: number;
  /** Cards for this sub-col (creatures slice). */
  creatures: ScryfallCard[];
  /** Cards for this sub-col (noncreatures slice). */
  noncreatures: ScryfallCard[];
}

export interface SpilloverResult {
  subColumns: SubColumn[];
  gridTemplate: string;
}

const W = 130;
const GAP = 8;
const SIDE_PAD = 32;

/**
 * Compute the sub-column layout for the analyze deck panel. Spills tall groups
 * across multiple side-by-side sub-columns when the playmat would otherwise
 * scroll. Short groups stay one column wide.
 */
export function computeSpillover(
  groups: GroupData[],
  playmatHeight: number,
  containerWidth: number,
  view: 'spells' | 'lands',
): SpilloverResult {
  if (groups.length === 0) {
    return { subColumns: [], gridTemplate: 'repeat(1, minmax(0, 130px))' };
  }

  const CHROME = 80;
  const availableH = Math.max(W * 1.4, playmatHeight - CHROME);

  let maxPerCol: number;
  if (view === 'spells') {
    maxPerCol = Math.max(2, Math.floor((availableH - 2.4 * W) / (0.2 * W)) + 2);
  } else {
    maxPerCol = Math.max(1, Math.floor((availableH - 1.4 * W) / (0.2 * W)) + 1);
  }

  const counts = groups.map(g => g.creatures.length + g.noncreatures.length);
  const ks = counts.map(n => Math.max(1, Math.ceil(n / maxPerCol)));

  const usableW = Math.max(0, containerWidth - SIDE_PAD);
  const widthCap = Math.max(groups.length, Math.floor((usableW + GAP) / (W + GAP)));

  let sum = ks.reduce((a, b) => a + b, 0);
  while (sum > widthCap) {
    let maxIdx = -1;
    let maxK = 1;
    for (let i = 0; i < ks.length; i++) {
      if (ks[i] > maxK) {
        maxK = ks[i];
        maxIdx = i;
      }
    }
    if (maxIdx < 0) break;
    ks[maxIdx] -= 1;
    sum -= 1;
  }

  const subColumns: SubColumn[] = [];
  for (let i = 0; i < groups.length; i++) {
    const g = groups[i];
    const K = ks[i];
    const total = counts[i];
    const cChunk = Math.ceil(g.creatures.length / K);
    const ncChunk = Math.ceil(g.noncreatures.length / K);
    for (let j = 0; j < K; j++) {
      subColumns.push({
        key: `${g.key}:${j}`,
        groupKey: g.key,
        groupLabel: g.label,
        isFirstOfGroup: j === 0,
        span: K,
        groupTotalCount: total,
        creatures: g.creatures.slice(j * cChunk, (j + 1) * cChunk),
        noncreatures: g.noncreatures.slice(j * ncChunk, (j + 1) * ncChunk),
      });
    }
  }

  return {
    subColumns,
    gridTemplate: `repeat(${subColumns.length}, minmax(0, ${W}px))`,
  };
}
