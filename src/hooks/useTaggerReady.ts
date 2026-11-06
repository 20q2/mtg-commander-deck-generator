import { useEffect, useState } from 'react';
import { hasTaggerData, loadTaggerData } from '@/services/tagger/client';

/**
 * Loads tagger data and reports when it's in, so memos that read it (role filters, commander
 * lookups) recompute. Pass `enabled: false` to skip the ~750KB fetch where nothing needs it yet.
 */
export function useTaggerReady(enabled = true): boolean {
  const [ready, setReady] = useState(hasTaggerData);
  useEffect(() => {
    if (!enabled || ready) return;
    let alive = true;
    loadTaggerData().then(data => {
      if (alive && data) setReady(true);
    });
    return () => { alive = false; };
  }, [enabled, ready]);
  return ready;
}
