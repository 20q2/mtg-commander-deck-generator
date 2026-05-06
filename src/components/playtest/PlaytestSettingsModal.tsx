import { createPortal } from 'react-dom';
import { Settings, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { usePlaytestSettings, BG_STYLES, type BattlefieldBg } from '@/store/playtestSettingsStore';

interface Props {
  open: boolean;
  onClose: () => void;
}

export function PlaytestSettingsModal({ open, onClose }: Props) {
  const bg = usePlaytestSettings(s => s.bg);
  const setBg = usePlaytestSettings(s => s.setBg);
  const animations = usePlaytestSettings(s => s.animations);
  const setAnimations = usePlaytestSettings(s => s.setAnimations);

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

        <div className="px-5 py-4 space-y-5 text-sm">
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
        </div>

        <div className="px-5 py-3 border-t border-border/40 flex justify-end">
          <Button onClick={onClose}>Done</Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
