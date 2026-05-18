import { useState } from 'react';
import { createPortal } from 'react-dom';
import { Settings, Keyboard, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { usePlaytestSettings, BG_STYLES, CARD_SIZES, type BattlefieldBg, type BattlefieldCardSize } from '@/store/playtestSettingsStore';
import { KEYBINDINGS } from '@/components/playtest/hooks/keybindings';

interface Props {
  open: boolean;
  onClose: () => void;
}

export function PlaytestSettingsModal({ open, onClose }: Props) {
  const bg = usePlaytestSettings(s => s.bg);
  const setBg = usePlaytestSettings(s => s.setBg);
  const cardSize = usePlaytestSettings(s => s.cardSize);
  const setCardSize = usePlaytestSettings(s => s.setCardSize);
  const animations = usePlaytestSettings(s => s.animations);
  const setAnimations = usePlaytestSettings(s => s.setAnimations);
  const dotGrid = usePlaytestSettings(s => s.dotGrid);
  const setDotGrid = usePlaytestSettings(s => s.setDotGrid);

  const [tab, setTab] = useState<'general' | 'keys'>('general');

  if (!open) return null;

  return createPortal(
    <div
      onClick={onClose}
      className="fixed inset-0 z-[150] bg-background/85 backdrop-blur-sm flex items-center justify-center p-6"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-card border border-border rounded-lg shadow-2xl w-full max-w-md flex flex-col"
      >
        <div className="flex items-center justify-between px-5 py-3 border-b border-border/60">
          <h2 className="text-base font-semibold flex items-center gap-2">
            <Settings className="w-4 h-4" /> Playtest Settings
          </h2>
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={onClose}>
            <X className="w-4 h-4" />
          </Button>
        </div>

        {/* Tabs */}
        <div className="flex px-2 pt-2 gap-1 border-b border-border/40">
          <TabButton active={tab === 'general'} onClick={() => setTab('general')} icon={<Settings className="w-3.5 h-3.5" />}>
            General
          </TabButton>
          <TabButton active={tab === 'keys'} onClick={() => setTab('keys')} icon={<Keyboard className="w-3.5 h-3.5" />}>
            Keybindings
          </TabButton>
        </div>

        {tab === 'keys' && <KeybindingsTab />}
        {tab === 'general' && <div className="px-5 py-4 space-y-5 text-sm">
          <div>
            <div className="mb-2 font-medium text-foreground/90">Battlefield background</div>
            <div className="grid grid-cols-2 gap-2">
              {(Object.keys(BG_STYLES) as BattlefieldBg[]).map((key) => {
                const selected = bg === key;
                return (
                  <button
                    key={key}
                    onClick={() => setBg(key)}
                    className={`relative h-16 rounded-md border text-xs font-medium transition-all overflow-hidden ${
                      selected
                        ? 'border-primary ring-2 ring-primary'
                        : 'border-border/60 hover:border-foreground/40'
                    }`}
                  >
                    <span className="absolute inset-0" style={{ background: BG_STYLES[key].background }} />
                    <span className="relative z-10 drop-shadow">{BG_STYLES[key].label}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="border-t border-border/40 pt-4">
            <div className="mb-2 font-medium text-foreground/90">Battlefield card size</div>
            <div className="grid grid-cols-3 gap-2">
              {(Object.keys(CARD_SIZES) as BattlefieldCardSize[]).map((key) => {
                const selected = cardSize === key;
                const { label, width, height } = CARD_SIZES[key];
                return (
                  <button
                    key={key}
                    onClick={() => setCardSize(key)}
                    className={`flex flex-col items-center justify-end gap-1.5 h-20 rounded-md border text-xs font-medium transition-all px-2 py-2 ${
                      selected
                        ? 'border-primary ring-2 ring-primary'
                        : 'border-border/60 hover:border-foreground/40'
                    }`}
                  >
                    <span
                      className="rounded-sm bg-muted-foreground/30 border border-border/60"
                      style={{ width: width * 0.28, height: height * 0.28 }}
                      aria-hidden
                    />
                    <span className="leading-none">{label}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="border-t border-border/40 pt-4">
            <label className="flex items-start gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={animations}
                onChange={(e) => setAnimations(e.target.checked)}
                className="mt-0.5 w-4 h-4 rounded border-border accent-primary cursor-pointer"
              />
              <div>
                <div className="font-medium text-foreground/90">Card arrival animation</div>
                <div className="text-xs text-muted-foreground mt-0.5">
                  Cards grow into the hand and shrink onto the battlefield when they move.
                </div>
              </div>
            </label>
          </div>

          <div className="border-t border-border/40 pt-4">
            <label className="flex items-start gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={dotGrid}
                onChange={(e) => setDotGrid(e.target.checked)}
                className="mt-0.5 w-4 h-4 rounded border-border accent-primary cursor-pointer"
              />
              <div>
                <div className="font-medium text-foreground/90">Dot grid background</div>
                <div className="text-xs text-muted-foreground mt-0.5">
                  Adds a subtle dot pattern to the battlefield for a sense of scale.
                </div>
              </div>
            </label>
          </div>
        </div>}

        <div className="px-5 py-3 border-t border-border/40 flex justify-end">
          <Button onClick={onClose}>Done</Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function TabButton({
  active, onClick, icon, children,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`px-3 py-1.5 -mb-px text-xs font-medium rounded-t-md flex items-center gap-1.5 transition-colors border-b-2 ${
        active
          ? 'border-primary text-foreground'
          : 'border-transparent text-muted-foreground hover:text-foreground'
      }`}
    >
      {icon}
      {children}
    </button>
  );
}

function KeybindingsTab() {
  const grouped = KEYBINDINGS.reduce<Record<string, typeof KEYBINDINGS>>((acc, kb) => {
    (acc[kb.category] ??= []).push(kb);
    return acc;
  }, {});
  const order: Array<keyof typeof grouped> = ['Library', 'Card', 'Selection', 'Turn', 'Other'];

  return (
    <div className="px-5 py-4 space-y-4 text-sm max-h-[60vh] overflow-y-auto">
      {order
        .filter(cat => grouped[cat])
        .map(cat => (
          <section key={cat as string}>
            <div className="text-[10px] uppercase tracking-[0.15em] font-semibold text-muted-foreground/80 mb-1.5">
              {cat as string}
            </div>
            <div className="space-y-1">
              {grouped[cat]!.map((kb, i) => (
                <div
                  key={i}
                  className="flex items-baseline justify-between gap-3 py-1.5 px-2 rounded hover:bg-accent/40 transition-colors"
                >
                  <div className="flex-1 min-w-0">
                    <div className="text-foreground/90">{kb.description}</div>
                    {kb.context && (
                      <div className="text-[10px] text-muted-foreground/70 mt-0.5">while {kb.context}</div>
                    )}
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    {kb.keys.map((k, ki) => (
                      <span key={ki} className="flex items-center gap-1">
                        {ki > 0 && <span className="text-muted-foreground/50 text-xs">+</span>}
                        <kbd className="inline-flex items-center justify-center min-w-[24px] h-6 px-1.5 text-[11px] font-mono font-medium rounded border border-border/70 bg-background/60 shadow-[inset_0_-1px_0_rgba(0,0,0,0.3)]">
                          {k}
                        </kbd>
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </section>
        ))}
      <p className="text-[10px] text-muted-foreground/60 pt-2 border-t border-border/40">
        Hovering means your cursor is over the target card or pile in the playtest view.
      </p>
    </div>
  );
}
