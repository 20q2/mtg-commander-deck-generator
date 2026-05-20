import { useState, useCallback } from 'react';
import { Loader2, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { searchCommanders } from '@/services/scryfall/client';
import { useNavigate } from 'react-router-dom';
import type { ScryfallCard } from '@/types';

export function GenerateLane() {
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<ScryfallCard[]>([]);
  const [searching, setSearching] = useState(false);
  const [picked, setPicked] = useState<ScryfallCard | null>(null);

  const runSearch = useCallback(async (q: string) => {
    setQuery(q);
    setPicked(null);
    if (q.trim().length < 2) { setResults([]); return; }
    setSearching(true);
    try {
      const r = await searchCommanders(q.trim());
      setResults(r.slice(0, 8));
    } finally {
      setSearching(false);
    }
  }, []);

  const handleGenerate = useCallback(() => {
    if (!picked) return;
    navigate(`/build/${encodeURIComponent(picked.name)}`);
  }, [navigate, picked]);

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground text-center">
        Pick a commander — we'll build a deck on the Generate page, then bring you back here to analyze it.
      </p>

      <input
        type="text"
        value={query}
        onChange={(e) => runSearch(e.target.value)}
        placeholder="Search for a commander…"
        className="w-full bg-card/50 border border-border/50 rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:ring-1 focus:ring-primary/50"
      />

      {searching && (
        <p className="text-xs text-muted-foreground flex items-center gap-1.5">
          <Loader2 className="w-3 h-3 animate-spin" />
          Searching…
        </p>
      )}

      {results.length > 0 && !picked && (
        <div className="flex flex-wrap gap-2">
          {results.map(c => (
            <button
              key={c.name}
              onClick={() => { setPicked(c); setResults([]); }}
              className="text-xs px-2.5 py-1.5 rounded-md border border-border/50 hover:bg-accent hover:border-primary/50 transition-colors"
            >
              {c.name}
            </button>
          ))}
        </div>
      )}

      {picked && (
        <div className="rounded-lg border border-primary/40 bg-primary/5 px-3 py-2 text-sm flex items-center justify-between">
          <span>Commander: <span className="font-semibold">{picked.name}</span></span>
          <button
            onClick={() => { setPicked(null); setQuery(''); }}
            className="text-xs text-muted-foreground hover:text-foreground"
          >
            Change
          </button>
        </div>
      )}

      <div className="flex justify-end">
        <Button
          onClick={handleGenerate}
          disabled={!picked}
          className="btn-shimmer"
        >
          <Sparkles className="w-4 h-4 mr-2" />
          Generate & Analyze
        </Button>
      </div>
    </div>
  );
}
