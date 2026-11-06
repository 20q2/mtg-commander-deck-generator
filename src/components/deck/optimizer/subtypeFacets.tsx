import { Fragment, useState, useMemo, useEffect } from 'react';
import { ListFilter } from 'lucide-react';
import type { RecommendedCard } from '@/services/deckBuilder/deckAnalyzer';
import { hasTag, isTutor, type RoleKey } from '@/services/tagger/client';

// ─── Subtype facets: narrow a role's suggestions by what the card actually does ───
//
// Membership is by tag, not by the single first-match subtype the badges show, so a card
// that tutors AND draws turns up under both chips. `bounce` is left out on purpose: it's a
// direction-agnostic mechanic tag (see ROLE_MEMBER_TAGS in the tagger client), and even gated
// on removal ~42 cards wear it without bouncing anything (Kogla, Orzhov Charm) until
// `otag:removal-bounce` is synced. A filter chip that lets those through reads as broken.

interface SubtypeFacet {
  key: string;
  label: string;
  matches: (name: string) => boolean;
}

const tag = (t: string) => (name: string) => hasTag(name, t);

const ROLE_FACETS: Record<RoleKey, SubtypeFacet[]> = {
  ramp: [
    { key: 'mana-dork', label: 'Mana Dork', matches: tag('mana-dork') },
    { key: 'mana-rock', label: 'Mana Rock', matches: tag('mana-rock') },
    { key: 'cost-reducer', label: 'Cost Reducer', matches: tag('cost-reducer') },
  ],
  removal: [
    { key: 'spot-removal', label: 'Spot Removal', matches: tag('spot-removal') },
  ],
  boardwipe: [
    { key: 'boardwipe', label: 'Board Wipe', matches: tag('boardwipe') },
  ],
  cardDraw: [
    { key: 'draw', label: 'Draw', matches: tag('draw') },
    { key: 'cantrip', label: 'Cantrip', matches: tag('cantrip') },
    { key: 'tutor', label: 'Tutor', matches: isTutor },
    { key: 'wheel', label: 'Wheel', matches: tag('wheel') },
  ],
  protection: [
    { key: 'counterspell', label: 'Counterspell', matches: tag('counterspell') },
    { key: 'protection', label: 'Protection', matches: tag('protection') },
  ],
};

export interface FacetOption {
  key: string;
  label: string;
  count: number;
}

/**
 * Facet chips for a suggestion pool. Only facets that actually narrow the pool are offered
 * (some but not all cards match). `limit` caps the shown counts to what the grid will render,
 * so "Draw 18" means eighteen cards appear when you click it.
 */
export function useSubtypeFacets(cards: RecommendedCard[], roles: readonly string[], limit = Infinity) {
  const rolesKey = roles.join(',');
  const [active, setActive] = useState<string | null>(null);
  useEffect(() => { setActive(null); }, [rolesKey]);

  const facets = useMemo(() => {
    const out: (SubtypeFacet & { count: number })[] = [];
    const seen = new Set<string>();
    for (const role of rolesKey.split(',')) {
      for (const f of ROLE_FACETS[role as RoleKey] ?? []) {
        if (seen.has(f.key)) continue;
        seen.add(f.key);
        const count = cards.reduce((n, c) => n + (f.matches(c.name) ? 1 : 0), 0);
        if (count > 0 && count < cards.length) out.push({ ...f, count });
      }
    }
    return out;
  }, [cards, rolesKey]);

  const current = facets.find(f => f.key === active) ?? null;
  const filtered = useMemo(
    () => current ? cards.filter(c => current.matches(c.name)) : cards,
    [cards, current],
  );

  const options: FacetOption[] = facets.map(f => ({ key: f.key, label: f.label, count: Math.min(f.count, limit) }));
  return { options, active: current?.key ?? null, setActive, filtered };
}

export function SubtypeFacetChips({
  options, active, onChange,
}: {
  options: FacetOption[];
  active: string | null;
  onChange: (key: string | null) => void;
}) {
  if (options.length === 0) return null;
  // Same segmented look as the Relevance / Popularity / CMC sort toggle it sits beside.
  const seg = (isOn: boolean) =>
    `text-[10px] px-2 py-0.5 transition-colors ${isOn
      ? 'bg-accent text-foreground font-medium'
      : 'text-muted-foreground/80 bg-card/40 hover:text-foreground hover:bg-accent/70'}`;
  return (
    <div className="flex items-center gap-1">
      <ListFilter className="w-3 h-3 text-muted-foreground/40" />
      <div className="flex items-center border border-border/50 rounded-md overflow-hidden">
        <button type="button" onClick={() => onChange(null)} className={seg(active === null)} aria-pressed={active === null}>
          All
        </button>
        {options.map(o => (
          <Fragment key={o.key}>
            <div className="w-px h-3 bg-border/50" />
            <button
              type="button"
              onClick={() => onChange(active === o.key ? null : o.key)}
              className={seg(active === o.key)}
              aria-pressed={active === o.key}
            >
              {o.label} <span className="tabular-nums text-muted-foreground/70">{o.count}</span>
            </button>
          </Fragment>
        ))}
      </div>
    </div>
  );
}
