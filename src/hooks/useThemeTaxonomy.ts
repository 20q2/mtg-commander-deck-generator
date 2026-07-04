import { useEffect, useMemo, useState } from 'react';
import type { EDHRECTag } from '@/types';
import { fetchAllTags } from '@/services/edhrec/client';

/**
 * EDHREC tag taxonomy (~400 themes) for theme pickers. Loads lazily once
 * `enabled` flips true; fetchAllTags is session-cached, so multiple consumers
 * cost one network request total. Fail-open: on fetch failure, tags stay [].
 */
export function useThemeTaxonomy(enabled: boolean) {
  const [tags, setTags] = useState<EDHRECTag[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!enabled || tags.length > 0) return;
    let cancelled = false;
    setLoading(true);
    void fetchAllTags()
      .then(t => { if (!cancelled) setTags(t); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [enabled, tags.length]);

  const filter = useMemo(
    () => (query: string, limit = 30): EDHRECTag[] => {
      const q = query.trim().toLowerCase();
      return (q ? tags.filter(t => t.name.toLowerCase().includes(q)) : tags).slice(0, limit);
    },
    [tags]
  );

  return { tags, loading, filter };
}
