import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Loader2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { usePlaytestStore } from '@/store/playtestStore';
import { getCardImageUrl } from '@/services/scryfall/client';
import { resolveTokens, deriveColorIdentity } from '@/services/playtest/tokens';
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

  const filtered = tokens.filter(t => !q || t.name.toLowerCase().includes(q.toLowerCase()) || t.type_line.toLowerCase().includes(q.toLowerCase()));

  return createPortal(
    <div className="fixed inset-0 z-[100] bg-background/90 backdrop-blur-sm flex flex-col p-6">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-lg font-semibold">Spawn Token</h2>
        <Button variant="ghost" size="icon" onClick={closeModal}><X className="w-4 h-4" /></Button>
      </div>
      <Input autoFocus placeholder="Filter tokens…" value={q} onChange={e => setQ(e.target.value)} className="mb-4" />
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center h-48 text-muted-foreground"><Loader2 className="w-5 h-5 animate-spin mr-2" />Loading tokens…</div>
        ) : filtered.length === 0 ? (
          <div className="text-muted-foreground">No tokens found.</div>
        ) : (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(120px,1fr))] gap-2">
            {filtered.map(t => (
              <button
                key={t.id}
                onClick={() => { spawnToken(t); closeModal(); }}
                className="rounded hover:ring-2 hover:ring-primary transition-all"
                title={`Spawn ${t.name}`}
              >
                <img src={getCardImageUrl(t, 'small')} alt={t.name} className="w-full rounded shadow" />
              </button>
            ))}
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
