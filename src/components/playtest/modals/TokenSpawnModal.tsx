import { useEffect, useMemo, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { useDraggable } from '@dnd-kit/core';
import { Input } from '@/components/ui/input';
import { usePlaytestStore } from '@/store/playtestStore';
import { resolveDeckTokens, resolveTokens, deriveColorIdentity } from '@/services/playtest/tokens';
import { isEmblem } from '@/services/scryfall/extras';
import { FloatingDialog } from '@/components/playtest/FloatingDialog';
import { HoverPreviewImage } from '@/components/playtest/HoverPreviewImage';
import type { ScryfallCard } from '@/types';

export function TokenSpawnModal() {
  const zones = usePlaytestStore(s => s.zones);
  const battlefield = usePlaytestStore(s => s.battlefield);
  const closeModal = usePlaytestStore(s => s.closeModal);
  const spawnToken = usePlaytestStore(s => s.spawnToken);
  const showToast = usePlaytestStore(s => s.showToast);

  const [tokens, setTokens] = useState<ScryfallCard[]>([]);
  const [source, setSource] = useState<'deck' | 'color'>('deck');
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');

  // Snapshot every card known to the deck so all_parts can be inspected.
  const allDeckCards = useMemo<ScryfallCard[]>(() => {
    const out: ScryfallCard[] = [];
    out.push(...zones.command, ...zones.library, ...zones.hand, ...zones.graveyard, ...zones.exile);
    for (const b of battlefield) out.push(b.card);
    return out;
  }, [zones, battlefield]);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    (async () => {
      const fromDeck = await resolveDeckTokens(allDeckCards);
      if (!alive) return;
      if (fromDeck.length > 0) {
        setTokens(fromDeck);
        setSource('deck');
        setLoading(false);
        return;
      }
      // Fallback: search by color identity if the deck didn't surface any tokens.
      const ci = deriveColorIdentity(zones.command);
      const fromColor = await resolveTokens(ci);
      if (!alive) return;
      setTokens(fromColor);
      setSource('color');
      setLoading(false);
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filtered = tokens.filter(t =>
    !q || t.name.toLowerCase().includes(q.toLowerCase()) || t.type_line.toLowerCase().includes(q.toLowerCase()),
  );

  // The deck's emblem walkers pull emblems in here alongside the tokens, so the
  // dialog only calls itself a token spawner when that's all it is holding.
  const hasEmblems = tokens.some(isEmblem);

  const title = (
    <>
      {hasEmblems ? 'Spawn Token or Emblem' : 'Spawn Token'}
      {!loading && (
        <span className="text-muted-foreground font-normal ml-1.5">
          ({filtered.length}{filtered.length !== tokens.length ? ` of ${tokens.length}` : ''})
        </span>
      )}
    </>
  );

  return (
    <FloatingDialog
      title={title}
      onClose={closeModal}
      storageKey="playtest:dialog-pos:token-spawn"
      sizeStorageKey="playtest:dialog-size:token-spawn"
      resizable
    >
      <div className="px-5 py-3 border-b border-border/40">
        <Input
          autoFocus
          placeholder="Filter tokens…"
          value={q}
          onChange={e => setQ(e.target.value)}
        />
        {!loading && tokens.length > 0 && (
          <p className="mt-1.5 text-[10px] text-muted-foreground">
            {source === 'deck'
              ? `${hasEmblems ? 'Tokens and emblems' : 'Tokens'} this deck can create (from card data).`
              : 'No deck-specific tokens found — showing tokens within color identity.'}
          </p>
        )}
      </div>
      <div className="flex-1 overflow-y-auto px-5 py-4">
        {loading ? (
          <div className="flex items-center justify-center h-48 text-muted-foreground">
            <Loader2 className="w-5 h-5 animate-spin mr-2" />
            Loading tokens…
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-sm text-muted-foreground italic text-center py-10">
            {tokens.length === 0 ? 'No tokens found.' : 'Nothing matches the filter.'}
          </div>
        ) : (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(92px,1fr))] gap-2.5">
            {filtered.map(t => (
              <TokenTile
                key={t.id}
                token={t}
                // The dialog stays up. Making tokens comes in runs — three
                // Soldiers, then a Treasure — and closing after each one meant
                // reopening and re-filtering to do the obvious next thing. The
                // toast is what tells you it landed, since the dialog may well
                // be sitting over the spot the token arrived in.
                onSpawn={() => {
                  spawnToken(t);
                  showToast(isEmblem(t) ? `${t.name} created` : `${t.name} token created`);
                }}
              />
            ))}
          </div>
        )}
      </div>
    </FloatingDialog>
  );
}

function TokenTile({ token, onSpawn }: { token: ScryfallCard; onSpawn: () => void }) {
  const { setNodeRef, attributes, listeners, isDragging } = useDraggable({
    id: `token:${token.id}`,
    data: { tokenCard: token },
  });
  return (
    <button
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      onClick={onSpawn}
      className={`rounded-[6px] hover:ring-2 hover:ring-primary transition-all touch-none ${isDragging ? 'opacity-0' : ''}`}
      title={`Click or drag to ${isEmblem(token) ? 'create' : 'spawn'} ${token.name}`}
    >
      <HoverPreviewImage card={token} size="small" suppressed={isDragging} className="w-full rounded-[6px] shadow touch-none" />
    </button>
  );
}
