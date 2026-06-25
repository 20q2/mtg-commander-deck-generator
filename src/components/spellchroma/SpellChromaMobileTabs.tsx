import { Layers, Tag, X, Plus } from 'lucide-react';
import { SpellChromaIcon } from './SpellChromaIcon';
import { AddTagPopover } from './AddTagPopover';
import { Button } from '@/components/ui/button';

export type MobileTab = 'deck' | 'explore';

interface SpellChromaMobileTabsProps {
  active: MobileTab;
  onChange: (tab: MobileTab) => void;
  /** Cards in the loaded deck/list — shown as a count on the first tab. */
  deckCount: number;
  /** Whether the loaded thing is a deck or a list — labels the first tab. */
  noun?: 'deck' | 'list';
  /** Slugs of the tags currently driving the explorer search. */
  selectedTags: string[];
  /** Number of cards the current search matches — shown on the Explore tab. */
  exploreCount: number;
  onRemoveTag: (slug: string) => void;
  /** Add a tag to the search — powers the inline "Add tag" button. */
  onAddTag: (slug: string) => void;
  /** Deck's top tag slugs — surfaced first in the Add-tag picker. */
  topTags?: string[];
}

/**
 * Mobile-only header for the SpellChroma workbench. The desktop layout shows the
 * deck and explorer side by side; on a phone there's no room, so we swap between
 * them with a segmented control instead of stacking both. A compact tag strip
 * sits beneath the tabs so the active search context stays visible on *either*
 * tab — you can be looking at your deck and still see (and clear) what you're
 * exploring. Sticky to the viewport top; the toolbars below it scroll freely.
 */
export function SpellChromaMobileTabs({
  active, onChange, deckCount, noun = 'deck', selectedTags, exploreCount, onRemoveTag, onAddTag, topTags,
}: SpellChromaMobileTabsProps) {
  const tagCount = selectedTags.length;
  const deckLabel = noun === 'list' ? 'List' : 'Deck';

  const tabClass = (isActive: boolean) =>
    `flex items-center justify-center gap-2 rounded-lg py-2 text-sm font-semibold transition-all ${
      isActive
        ? 'bg-gradient-to-b from-violet-500 to-violet-600 text-white shadow-[0_1px_10px_-2px_rgba(139,92,246,0.55)]'
        : 'text-muted-foreground hover:text-foreground hover:bg-accent/40'
    }`;

  return (
    <div className="lg:hidden sticky top-0 sm:top-[77px] z-40 border-b border-border/50 bg-background/85 backdrop-blur-md">
      <div className="px-3 pt-2.5 pb-2">
        {/* Segmented Deck / Explore switch */}
        <div role="tablist" aria-label="SpellChroma view" className="grid grid-cols-2 gap-1 rounded-xl border border-border/60 bg-card/40 p-1">
          <button
            type="button"
            role="tab"
            aria-selected={active === 'deck'}
            onClick={() => onChange('deck')}
            className={tabClass(active === 'deck')}
          >
            <Layers className="w-4 h-4" />
            {deckLabel}
            <span className={`text-xs font-normal tabular-nums ${active === 'deck' ? 'text-white/70' : 'text-muted-foreground/60'}`}>
              {deckCount}
            </span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={active === 'explore'}
            onClick={() => onChange('explore')}
            className={tabClass(active === 'explore')}
          >
            <SpellChromaIcon className="w-4 h-4" />
            Explore
            {tagCount > 0 && exploreCount > 0 && (
              <span className={`text-xs font-normal tabular-nums ${active === 'explore' ? 'text-white/70' : 'text-muted-foreground/60'}`}>
                {exploreCount}
              </span>
            )}
          </button>
        </div>

        {/* Tag controls — the single place to manage the search on mobile: an
            Add-tag button plus the active-tag chips. Tap a chip to drop it. */}
        <div className="mt-2 flex min-h-[24px] flex-wrap items-center gap-1.5">
          <Tag className="w-3.5 h-3.5 shrink-0 text-violet-300/70" />
          <AddTagPopover selectedTags={selectedTags} topTags={topTags} onAddTag={onAddTag} align="start">
            <Button
              variant="outline"
              size="sm"
              className={`shrink-0 h-auto gap-1 px-2.5 py-0.5 text-[11px] rounded-full font-semibold border-violet-500/60 text-violet-300 hover:bg-violet-500/10 hover:text-violet-200 transition-colors ${
                tagCount === 0 ? 'animate-pulse-subtle' : ''
              }`}
            >
              <Plus className="w-3 h-3" /> Add tag
            </Button>
          </AddTagPopover>
          {selectedTags.map(slug => (
            <button
              key={slug}
              type="button"
              onClick={() => onRemoveTag(slug)}
              aria-label={`Remove ${slug}`}
              title={`Remove ${slug}`}
              className="group rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <span className="inline-flex items-center gap-1 whitespace-nowrap rounded-full border border-violet-400/50 bg-violet-600 py-0.5 pl-2 pr-1.5 text-[11px] font-medium text-white transition-colors group-hover:border-destructive/60 group-hover:bg-destructive">
                {slug}
                <X className="w-3 h-3 opacity-80" />
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
