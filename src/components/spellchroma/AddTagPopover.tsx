import { useMemo, useState, type ReactNode } from 'react';
import { Tag } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Input } from '@/components/ui/input';
import { allTags, type TagDictEntry } from '@/services/spellchroma/tagIndex';
import { isIgnoredTag } from '@/services/spellchroma/ignoredTags';

interface TagEntry { s: string; l: string }
interface Section { label?: string; items: TagEntry[] }

/**
 * Beginner-friendly starter tags shown when no deck is loaded. The raw
 * dictionary order leads with obscure cycle/name trivia, so we surface a
 * curated set of the most useful discovery tags instead. Slugs not present in
 * the loaded dictionary are silently dropped, so this list can be generous.
 */
const STARTER_TAGS = [
  'ramp', 'removal', 'card-advantage', 'counterspell', 'lifegain',
  'sacrifice-outlet', 'tutor', 'treasure', 'tokens', 'boardwipe',
  'mill', 'cantrip', 'protection', 'graveyard-recursion', 'reanimation',
];

interface AddTagPopoverProps {
  selectedTags: string[];
  onAddTag: (slug: string) => void;
  align?: 'start' | 'center' | 'end';
  /** The loaded deck's top tag slugs — surfaced first when the search is empty. */
  topTags?: string[];
  /** The trigger element (rendered via PopoverTrigger asChild). */
  children: ReactNode;
}

/**
 * Tag-picker popover shared by the toolbar "Add tag" button and the empty-state
 * centered CTA. Owns its own open + query state. With an empty query it leads
 * with the loaded deck's top tags (when provided); typing searches the whole
 * dictionary by slug or label. Already-selected tags are excluded.
 */
export function AddTagPopover({ selectedTags, onAddTag, align = 'start', topTags, children }: AddTagPopoverProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');

  const sections = useMemo<Section[]>(() => {
    const dict = allTags();
    const bySlug = new Map(dict.map(e => [e.s, e]));
    const sel = new Set(selectedTags);
    const q = query.trim().toLowerCase();
    // Selected tags and trivia (cycle/name/watermark) tags are never offered.
    const usable = (e: TagDictEntry) => !sel.has(e.s) && !isIgnoredTag(e.s);

    if (q !== '') {
      const items = dict.filter(t => usable(t) && (t.s.includes(q) || t.l.toLowerCase().includes(q))).slice(0, 40);
      return [{ items }];
    }

    // Lead with the deck's top tags when one is loaded; otherwise with curated
    // starter tags. We never fall back to raw dictionary order as the lead —
    // it's full of obscure trivia that makes the empty state look broken.
    const lead: TagEntry[] = topTags?.length
      ? topTags.filter(s => !sel.has(s)).map(s => bySlug.get(s) ?? { s, l: '' })
      : STARTER_TAGS.map(s => bySlug.get(s)).filter((e): e is TagDictEntry => !!e && !sel.has(e.s));
    const leadLabel = topTags?.length ? 'From your deck' : 'Popular tags';

    const leadSet = new Set(lead.map(e => e.s));
    const rest = dict.filter(e => usable(e) && !leadSet.has(e.s)).slice(0, Math.max(0, 40 - lead.length));
    return lead.length
      ? [{ label: leadLabel, items: lead }, { label: 'All tags', items: rest }]
      : [{ items: rest }];
  }, [query, selectedTags, topTags]);

  const pick = (slug: string) => { onAddTag(slug); setQuery(''); setOpen(false); };
  const empty = sections.every(s => s.items.length === 0);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent align={align} className="w-72 p-2">
        <Input autoFocus value={query} onChange={e => setQuery(e.target.value)}
          placeholder="Search tags… (e.g. ramp, sacrifice)" className="mb-2" />
        <div className="max-h-64 overflow-y-auto flex flex-col">
          {empty && <p className="text-xs text-muted-foreground px-2 py-3">No matching tags.</p>}
          {sections.map((sec, i) => (
            sec.items.length === 0 ? null : (
              <div key={sec.label ?? i} className="flex flex-col">
                {sec.label && (
                  <p className="px-2 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-wider text-violet-300/70">{sec.label}</p>
                )}
                {sec.items.map(t => (
                  <button key={t.s} type="button" onClick={() => pick(t.s)}
                    className="flex items-center gap-1.5 text-left px-2 py-1.5 rounded hover:bg-accent transition-colors">
                    <Tag className="w-3 h-3 opacity-50 shrink-0" />
                    <span className="text-sm">{t.s}</span>
                    {t.l && t.l !== t.s && <span className="text-xs text-muted-foreground ml-1 truncate">{t.l}</span>}
                  </button>
                ))}
              </div>
            )
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
