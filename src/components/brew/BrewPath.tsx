import { useMemo } from 'react';
import { useStore } from '@/store';
import { Button } from '@/components/ui/button';
import {
  Undo2, RefreshCw, Play,
  Infinity as InfinityIcon, Zap, Dices, Mountain, TrendingUp, Crosshair, Bomb,
  BookOpen, PawPrint, Flame, ScrollText, Cog, Sparkles, UserRound, Swords, Package, Layers,
  type LucideIcon,
} from 'lucide-react';
import { openNode, type BrewRoute } from '@/services/brew/engine';
import type { ScryfallCard } from '@/types';

const TONE_CLASS: Record<string, string> = {
  need: 'border-destructive/40 text-[#fca5a5]',
  theme: 'border-[hsl(var(--success))]/40 text-emerald-300',
  neutral: 'border-violet-400/40 text-violet-200',
};

const TONE_RING: Record<string, string> = {
  need: 'border-destructive/60 text-[#fca5a5] bg-destructive/15',
  theme: 'border-[hsl(var(--success))]/60 text-emerald-300 bg-[hsl(var(--success))]/15',
  neutral: 'border-violet-400/60 text-violet-200 bg-violet-500/15',
};

// Role + card-type keys → symbol. Role and type keys are disjoint, so one map covers both.
const KEY_ICON: Record<string, LucideIcon> = {
  // roles
  ramp: TrendingUp, removal: Crosshair, boardwipe: Bomb, cardDraw: BookOpen,
  // card types
  creature: PawPrint, instant: Flame, sorcery: ScrollText, artifact: Cog,
  enchantment: Sparkles, planeswalker: UserRound, battle: Swords, land: Mountain,
};

/** Pick the at-a-glance symbol for a route (or a past pick), by move type then by what it fills. */
function iconFor(type: string, key: string | null): LucideIcon {
  if (type === 'combo') return InfinityIcon;
  if (type === 'lightning') return Zap;
  if (type === 'gamble') return Dices;
  if (type === 'manabase') return Mountain;
  if (key && KEY_ICON[key]) return KEY_ICON[key];
  return type === 'bundle' ? Package : Layers;
}

/** Scryfall art-crop URL for a card (front face for DFCs). */
function artUrl(card?: ScryfallCard): string | undefined {
  if (!card) return undefined;
  return card.image_uris?.art_crop ?? card.card_faces?.[0]?.image_uris?.art_crop;
}

export function BrewPath({ onFinish }: { onFinish: () => void }) {
  const { brewContext, brewState, brewRoutes, openBrewRoute, undoBrewPick, rerollBrew } = useStore();

  // A representative card per route — exactly the top card that route would present (so the combo
  // route wears its missing piece's art, "Add Creatures" the top creature, etc.). Reuses openNode.
  const repArt = useMemo(() => {
    const map: Record<string, string | undefined> = {};
    if (brewContext && brewState) {
      for (const r of brewRoutes) {
        if (r.type === 'manabase') continue;
        map[r.id] = artUrl(openNode(brewContext, brewState, r).options[0]?.cards[0]?.scryfall);
      }
    }
    return map;
  }, [brewRoutes, brewContext, brewState]);

  if (!brewState) return null;

  const pickNumber = brewState.history.length + 1;
  const canUndo = brewState.history.length > 0;

  return (
    <div className="text-center">
      {/* The path you've walked — a trail of the symbols you picked. */}
      <div className="flex items-center justify-center gap-1 mb-6 flex-wrap">
        {brewState.history.map((h, i) => {
          const key = h.routeId.includes(':') ? h.routeId.split(':')[1] : null;
          const Icon = iconFor(h.routeType, key);
          return (
            <span
              key={i}
              title={h.added.join(', ')}
              className="w-6 h-6 rounded-full border border-border bg-card grid place-items-center text-muted-foreground"
            >
              <Icon className="w-3 h-3" />
            </span>
          );
        })}
        <span className="w-8 h-8 rounded-full border border-violet-400 bg-primary/20 grid place-items-center text-violet-200 shadow-[0_0_18px_hsl(var(--primary)/0.4)]">●</span>
      </div>

      <div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground mb-1">Pick {pickNumber} · choose your route</div>
      <h2 className="text-2xl font-bold mb-6 bg-gradient-to-r from-violet-300 to-fuchsia-300 bg-clip-text text-transparent">Where to next?</h2>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {brewRoutes.map((route: BrewRoute) => {
          const Icon = iconFor(route.type, route.targetRole ?? route.targetType ?? null);
          const art = repArt[route.id];
          return (
            <button
              key={route.id}
              onClick={() => (route.type === 'manabase' ? onFinish() : openBrewRoute(route))}
              className="group relative overflow-hidden rounded-xl border border-border/60 bg-card/60 backdrop-blur-sm text-center transition hover:-translate-y-1 hover:border-violet-400 hover:shadow-[0_0_30px_hsl(var(--primary)/0.22)]"
            >
              {art && (
                <img
                  src={art}
                  alt=""
                  aria-hidden="true"
                  className="absolute inset-0 w-full h-full object-cover opacity-25 transition duration-500 group-hover:opacity-40 group-hover:scale-110"
                />
              )}
              {/* Dark wash keeps the symbol + text readable over the art. */}
              <div className="absolute inset-0 bg-gradient-to-b from-background/70 via-background/85 to-background/95" />

              <div className="relative p-5">
                <div className={`mx-auto mb-3 w-14 h-14 rounded-full grid place-items-center border-2 backdrop-blur-sm transition-transform duration-150 group-hover:scale-110 ${TONE_RING[route.tone] ?? TONE_RING.neutral}`}>
                  <Icon className="w-7 h-7" />
                </div>
                <h3 className="text-base font-semibold mb-1">{route.title}</h3>
                <p className="text-xs text-muted-foreground mb-3 min-h-[2.5rem]">{route.description}</p>
                {route.tag && (
                  <span className={`inline-block text-[10px] font-semibold uppercase tracking-wide px-2.5 py-1 rounded-full border bg-background/40 ${TONE_CLASS[route.tone] ?? TONE_CLASS.neutral}`}>
                    {route.tag}
                  </span>
                )}
              </div>
            </button>
          );
        })}
      </div>

      <div className="flex items-center justify-center gap-1 mt-8">
        <Button variant="ghost" size="sm" disabled={!canUndo} onClick={undoBrewPick}><Undo2 className="w-4 h-4 mr-1" /> Undo</Button>
        <span className="w-px h-4 bg-border" />
        <Button variant="ghost" size="sm" onClick={rerollBrew}><RefreshCw className="w-4 h-4 mr-1" /> Reroll routes</Button>
        <span className="w-px h-4 bg-border" />
        <Button variant="ghost" size="sm" className="text-violet-300" onClick={onFinish}><Play className="w-4 h-4 mr-1" /> Finish for me</Button>
      </div>
    </div>
  );
}
