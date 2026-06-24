import { useMemo, useState, type ReactNode } from 'react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Input } from '@/components/ui/input';
import { allTags } from '@/services/spellchroma/tagIndex';

interface AddTagPopoverProps {
  selectedTags: string[];
  onAddTag: (slug: string) => void;
  align?: 'start' | 'center' | 'end';
  /** The trigger element (rendered via PopoverTrigger asChild). */
  children: ReactNode;
}

/**
 * Tag-picker popover shared by the toolbar "Add tag" button and the empty-state
 * centered CTA. Owns its own open + query state; filters the dictionary by slug
 * or label and excludes already-selected tags.
 */
export function AddTagPopover({ selectedTags, onAddTag, align = 'start', children }: AddTagPopoverProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    const sel = new Set(selectedTags);
    return allTags()
      .filter(t => !sel.has(t.s) && (q === '' || t.s.includes(q) || t.l.toLowerCase().includes(q)))
      .slice(0, 40);
  }, [query, selectedTags]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent align={align} className="w-72 p-2">
        <Input autoFocus value={query} onChange={e => setQuery(e.target.value)}
          placeholder="Search tags… (e.g. ramp, sacrifice)" className="mb-2" />
        <div className="max-h-64 overflow-y-auto flex flex-col">
          {matches.length === 0 && <p className="text-xs text-muted-foreground px-2 py-3">No matching tags.</p>}
          {matches.map(t => (
            <button key={t.s} type="button"
              onClick={() => { onAddTag(t.s); setQuery(''); setOpen(false); }}
              className="text-left px-2 py-1.5 rounded hover:bg-accent transition-colors">
              <span className="text-sm">{t.s}</span>
              {t.l && t.l !== t.s && <span className="text-xs text-muted-foreground ml-2">{t.l}</span>}
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
