import { useState, useEffect, useMemo } from 'react';
import { Input } from '@/components/ui/input';
import { ColorIdentity } from '@/components/ui/mtg-icons';
import { Loader2, ArrowLeft, Search } from 'lucide-react';
import { fetchAllTags, fetchTagCommanders, colorIdentityToSlug } from '@/services/edhrec/client';
import { trackEvent } from '@/services/analytics';
import type { EDHRECTag, EDHRECTopCommander } from '@/types';

// Default number of strategy chips shown before the user searches (avoids a wall of ~400).
const DISPLAY_CAP = 48;

export interface StrategyBrowserProps {
  /** The live color filter shared with CommanderSearch. Empty = no color narrowing. */
  colorFilter: Set<string>;
  /**
   * Invoked when a commander is chosen; CommanderSearch resolves the card and navigates to /build.
   * The strategy slug is passed so the builder can pre-select it as the archetype.
   */
  onSelectCommanderName: (name: string, strategySlug: string) => void | Promise<void>;
}

export function StrategyBrowser({ colorFilter, onSelectCommanderName }: StrategyBrowserProps) {
  const [tags, setTags] = useState<EDHRECTag[]>([]);
  const [tagsLoading, setTagsLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [selectedTag, setSelectedTag] = useState<EDHRECTag | null>(null);
  const [commanders, setCommanders] = useState<EDHRECTopCommander[]>([]);
  const [commandersLoading, setCommandersLoading] = useState(false);

  // Load the tag index once.
  useEffect(() => {
    let cancelled = false;
    setTagsLoading(true);
    fetchAllTags()
      .then(data => { if (!cancelled) setTags(data); })
      .catch(() => { if (!cancelled) setTags([]); })
      .finally(() => { if (!cancelled) setTagsLoading(false); });
    return () => { cancelled = true; };
  }, []);

  // Load commanders for the selected strategy; re-fetch when the color filter changes.
  useEffect(() => {
    if (!selectedTag) return;
    let cancelled = false;
    setCommandersLoading(true);
    const colorSlug = colorFilter.size === 0 ? undefined : colorIdentityToSlug([...colorFilter]);
    fetchTagCommanders(selectedTag.slug, colorSlug)
      .then(data => { if (!cancelled) setCommanders(data); })
      .catch(() => { if (!cancelled) setCommanders([]); })
      .finally(() => { if (!cancelled) setCommandersLoading(false); });
    return () => { cancelled = true; };
  }, [selectedTag, colorFilter]);

  const filteredTags = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return tags;
    return tags.filter(t => t.name.toLowerCase().includes(q));
  }, [tags, search]);

  const isSearching = search.trim().length > 0;
  const shownTags = isSearching ? filteredTags : filteredTags.slice(0, DISPLAY_CAP);
  const hiddenCount = filteredTags.length - shownTags.length;

  const handleSelectTag = (tag: EDHRECTag) => {
    setCommanders([]);
    setSelectedTag(tag);
    trackEvent('strategy_selected', { strategy: tag.slug });
  };

  // Detail mode: commanders for the selected strategy.
  if (selectedTag) {
    return (
      <div className="animate-fade-in">
        <button
          onClick={() => setSelectedTag(null)}
          className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors mb-3"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          back to strategies
        </button>
        <p className="text-muted-foreground mb-3">
          Top <span className="text-foreground/90 font-medium">{selectedTag.name}</span> commanders:
        </p>
        {commandersLoading ? (
          <div className="flex justify-center py-4"><Loader2 className="w-5 h-5 animate-spin text-primary" /></div>
        ) : commanders.length > 0 ? (
          <div className="flex flex-wrap justify-center gap-2">
            {commanders.map((c, i) => (
              <button
                key={c.sanitized || c.name}
                onClick={() => onSelectCommanderName(c.name, selectedTag.slug)}
                className="animate-chip-in flex items-center gap-1.5 px-3 py-1.5 bg-accent/50 backdrop-blur-sm rounded-full text-sm text-muted-foreground hover:bg-primary/20 hover:text-primary transition-colors cursor-pointer"
                style={{ animationDelay: `${i * 40}ms` }}
              >
                <ColorIdentity colors={c.colorIdentity.length > 0 ? c.colorIdentity : ['C']} size="sm" />
                <span>{c.name}</span>
              </button>
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">No commanders found for this color.</p>
        )}
      </div>
    );
  }

  // List mode: searchable, popularity-ordered strategies.
  return (
    <div className="animate-fade-in">
      <div className="relative max-w-xs mx-auto mb-4">
        <div className="absolute left-3 inset-y-0 flex items-center pointer-events-none">
          <Search className="w-4 h-4 text-muted-foreground" />
        </div>
        <Input
          type="text"
          placeholder="Search strategies..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-9 h-10"
        />
      </div>
      {tagsLoading ? (
        <div className="flex justify-center py-4"><Loader2 className="w-5 h-5 animate-spin text-primary" /></div>
      ) : shownTags.length > 0 ? (
        <>
          <div className="flex flex-wrap justify-center gap-2">
            {shownTags.map((tag, i) => (
              <button
                key={tag.slug}
                onClick={() => handleSelectTag(tag)}
                className="animate-chip-in flex items-center gap-1.5 px-3 py-1.5 bg-accent/50 backdrop-blur-sm rounded-full text-sm text-muted-foreground hover:bg-primary/20 hover:text-primary transition-colors cursor-pointer"
                style={{ animationDelay: `${Math.min(i, 20) * 30}ms` }}
              >
                <span>{tag.name}</span>
                <span className="text-[10px] bg-primary/20 text-violet-200 px-1.5 py-0.5 rounded-full">
                  {tag.numDecks.toLocaleString()}
                </span>
              </button>
            ))}
          </div>
          {!isSearching && hiddenCount > 0 && (
            <p className="text-xs text-muted-foreground/70 mt-3">
              +{hiddenCount} more — search to find a specific strategy
            </p>
          )}
        </>
      ) : (
        <p className="text-sm text-muted-foreground">No strategies found.</p>
      )}
    </div>
  );
}
