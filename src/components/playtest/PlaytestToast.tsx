import { useEffect, useState } from 'react';
import { Check } from 'lucide-react';
import { usePlaytestStore } from '@/store/playtestStore';

// Small floating pill at the top-center of the viewport. Fires whenever the
// store's `toast.tick` increments (e.g. after a copy), then fades out on its
// own after a short delay.
export function PlaytestToast() {
  const toast = usePlaytestStore(s => s.toast);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!toast) return;
    setVisible(true);
    const t = setTimeout(() => setVisible(false), 1500);
    return () => clearTimeout(t);
  }, [toast?.tick]); // re-trigger every time the tick changes

  if (!toast) return null;

  return (
    <div
      className={`pointer-events-none fixed top-16 left-1/2 -translate-x-1/2 z-[300] transition-all duration-200 ${
        visible ? 'opacity-100 translate-y-0' : 'opacity-0 -translate-y-2'
      }`}
    >
      <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-card/95 backdrop-blur-sm border border-border shadow-xl text-xs font-medium">
        <span className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-emerald-500/20 text-emerald-300">
          <Check className="w-3 h-3" strokeWidth={3} />
        </span>
        <span>{toast.text}</span>
      </div>
    </div>
  );
}
