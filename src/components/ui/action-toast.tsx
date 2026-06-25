import { useCallback, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { CardTypeIcon } from '@/components/ui/mtg-icons';

export interface ActionToastState {
  message: string;
  kind: 'success' | 'error';
  /** Optional card-type slug (e.g. "creature") → shows the matching type icon. */
  cardType?: string;
  /** Optional undo affordance. */
  onUndo?: () => void;
}

/**
 * Shared bottom-right action toast — the app's standard "card added / removed"
 * confirmation (extracted from the original inline ListDeckView toast). Auto-
 * dismisses after `timeoutMs`. Pair the returned state with <ActionToast/>.
 */
export function useActionToast(timeoutMs = 4000) {
  const [toast, setToast] = useState<ActionToastState | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const show = useCallback((next: ActionToastState) => {
    clearTimeout(timer.current);
    setToast(next);
    timer.current = setTimeout(() => setToast(null), timeoutMs);
  }, [timeoutMs]);

  const success = useCallback(
    (message: string, opts?: { cardType?: string; onUndo?: () => void }) =>
      show({ message, kind: 'success', ...opts }),
    [show],
  );
  const error = useCallback((message: string) => show({ message, kind: 'error' }), [show]);
  const dismiss = useCallback(() => { clearTimeout(timer.current); setToast(null); }, []);

  return { toast, success, error, dismiss };
}

/** Renders the toast (portal'd to <body>). Returns null when there's nothing to show. */
export function ActionToast({ toast, onDismiss }: { toast: ActionToastState | null; onDismiss: () => void }) {
  if (!toast) return null;
  return createPortal(
    <div className={`fixed bottom-6 right-6 z-[999] px-4 py-2 ${toast.kind === 'error' ? 'bg-rose-500/90' : 'bg-emerald-500/90'} text-white text-sm rounded-lg shadow-lg animate-fade-in flex items-center gap-2`}>
      {toast.cardType && <CardTypeIcon type={toast.cardType} size="sm" className="shrink-0" />}
      {toast.message}
      {toast.onUndo && (
        <button
          onClick={() => { toast.onUndo!(); onDismiss(); }}
          className="underline underline-offset-2 hover:text-white/80 transition-colors cursor-pointer px-1 py-0.5"
        >
          Undo
        </button>
      )}
    </div>,
    document.body,
  );
}
