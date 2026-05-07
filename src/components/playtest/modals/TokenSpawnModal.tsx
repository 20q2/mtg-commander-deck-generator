import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { usePlaytestStore } from '@/store/playtestStore';
import { getCardImageUrl } from '@/services/scryfall/client';
import { resolveTokens, deriveColorIdentity } from '@/services/playtest/tokens';
import { FloatingDialog } from '@/components/playtest/FloatingDialog';
import type { ScryfallCard } from '@/types';

export function TokenSpawnModal() {
  const command = usePlaytestStore(s => s.zones.command);
  const closeModal = usePlaytestStore(s => s.closeModal);
  const spawnToken = usePlaytestStore(s => s.spawnToken);

  const [tokens, setTokens] = useState<ScryfallCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');

  useEffect(() => {
    let alive = true;
    const ci = deriveColorIdentity(command);
    setLoading(true);
    resolveTokens(ci).then(t => {
      if (alive) {
        setTokens(t);
        setLoading(false);
      }
    });
    return () => { alive = false; };
  }, [command]);

  const filtered = tokens.filter(t =>
    !q || t.name.toLowerCase().includes(q.toLowerCase()) || t.type_line.toLowerCase().includes(q.toLowerCase()),
  );

  const title = (
    <>
      Spawn Token
      {!loading && (
        <span className="text-muted-foreground font-normal ml-1.5">
          ({filtered.length}{filtered.length !== tokens.length ? ` of ${tokens.length}` : ''})
        </span>
      )}
    </>
  );

  return (
    <FloatingDialog title={title} onClose={closeModal}>
      <div className="px-5 py-3 border-b border-border/40">
        <Input
          autoFocus
          placeholder="Filter tokens…"
          value={q}
          onChange={e => setQ(e.target.value)}
        />
      </div>
      <div className="flex-1 overflow-y-auto px-5 py-4">
        {loading ? (
          <div className="flex items-center justify-center h-48 text-muted-foreground">
            <Loader2 className="w-5 h-5 animate-spin mr-2" />
            Loading tokens…
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-sm text-muted-foreground italic text-center py-10">
            {tokens.length === 0 ? 'No tokens found for this color identity.' : 'No tokens match the filter.'}
          </div>
        ) : (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(92px,1fr))] gap-2.5">
            {filtered.map(t => (
              <button
                key={t.id}
                onClick={() => { spawnToken(t); closeModal(); }}
                className="rounded-[5px] hover:ring-2 hover:ring-primary transition-all"
                title={`Spawn ${t.name}`}
              >
                <img src={getCardImageUrl(t, 'small')} alt={t.name} className="w-full rounded-[5px] shadow" />
              </button>
            ))}
          </div>
        )}
      </div>
    </FloatingDialog>
  );
}
