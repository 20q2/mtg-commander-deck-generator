import { useEffect, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import { X, MessageSquare } from 'lucide-react';
import { trackEvent } from '@/services/analytics';

// One-time friendly nudge toward the Community Poll. After a visitor has
// opened the site VISIT_THRESHOLD separate sessions, this slides in just under
// the version-number button it points at and teaches them where the poll
// lives. Dismiss or click → set the `seen` flag so it never shows again.
// Purely client-side via localStorage; no store state.
const VISIT_THRESHOLD = 5;
const COUNT_KEY = 'mf-visit-count';
const SESSION_KEY = 'mf-visit-counted';
const SEEN_KEY = 'mf-poll-nudge-seen';

const CARD_W = 288; // w-72
const ARROW_W = 12;
const MARGIN = 8;

type Pos = { top: number; cardRight: number; arrowRight: number };

// Align the card under the version button (tagged `data-poll-nudge-anchor`),
// clamped to stay fully on screen. `cardRight`/`arrowRight` are distances from
// the viewport's right edge and the card's right edge respectively.
function measure(): Pos {
  const fallback: Pos = { top: 68, cardRight: 16, arrowRight: 24 };
  try {
    const anchor = document.querySelector('[data-poll-nudge-anchor]') as HTMLElement | null;
    if (!anchor) return fallback;
    const r = anchor.getBoundingClientRect();
    const vw = window.innerWidth;
    const cardRight = Math.max(MARGIN, Math.min(vw - r.right, vw - CARD_W - MARGIN));
    const anchorCenterFromRight = vw - (r.left + r.width / 2);
    const arrowRight = Math.max(
      MARGIN,
      Math.min(anchorCenterFromRight - cardRight - ARROW_W / 2, CARD_W - ARROW_W - MARGIN)
    );
    return { top: r.bottom + 8, cardRight, arrowRight };
  } catch {
    return fallback;
  }
}

export function PollNudge({ onVisibilityChange }: { onVisibilityChange?: (active: boolean) => void }) {
  const [visible, setVisible] = useState(false);
  // Drives the enter/exit transition independently of mount, so the card can
  // fade out before unmounting.
  const [entered, setEntered] = useState(false);
  const [pos, setPos] = useState<Pos>({ top: 68, cardRight: 16, arrowRight: 24 });

  useEffect(() => {
    let showTimer: ReturnType<typeof setTimeout> | undefined;
    try {
      if (localStorage.getItem(SEEN_KEY) === 'true') return;

      // Count at most once per browser session.
      if (!sessionStorage.getItem(SESSION_KEY)) {
        const next = (parseInt(localStorage.getItem(COUNT_KEY) || '0', 10) || 0) + 1;
        localStorage.setItem(COUNT_KEY, String(next));
        sessionStorage.setItem(SESSION_KEY, '1');
      }

      const count = parseInt(localStorage.getItem(COUNT_KEY) || '0', 10) || 0;
      if (count >= VISIT_THRESHOLD) {
        // Small delay so it arrives a beat after the page settles, not jarringly on load.
        showTimer = setTimeout(() => {
          setPos(measure());
          setVisible(true);
          requestAnimationFrame(() => setEntered(true));
          onVisibilityChange?.(true);
          trackEvent('poll_nudge_shown', { visitCount: count });
        }, 1200);
      }
    } catch {
      /* localStorage unavailable — silently skip the nudge */
    }
    return () => { if (showTimer) clearTimeout(showTimer); };
  }, [onVisibilityChange]);

  // Keep aligned to the button as the window resizes/scrolls.
  useEffect(() => {
    if (!visible) return;
    const reposition = () => setPos(measure());
    window.addEventListener('resize', reposition);
    window.addEventListener('scroll', reposition, true);
    return () => {
      window.removeEventListener('resize', reposition);
      window.removeEventListener('scroll', reposition, true);
    };
  }, [visible]);

  const dismiss = useCallback((action: 'clicked' | 'dismissed') => {
    try { localStorage.setItem(SEEN_KEY, 'true'); } catch { /* ignore */ }
    trackEvent('poll_nudge_dismissed', { action });
    setEntered(false);
    onVisibilityChange?.(false);
    // Let the fade-out play before unmounting.
    setTimeout(() => setVisible(false), 200);
  }, [onVisibilityChange]);

  if (!visible) return null;

  return createPortal(
    <div
      className={`fixed z-[200] w-72 transition-all duration-200 ${
        entered ? 'opacity-100 translate-y-0' : 'opacity-0 -translate-y-2'
      }`}
      style={{ top: pos.top, right: pos.cardRight }}
      role="dialog"
      aria-label="Community poll suggestion"
    >
      {/* Arrow pointing up toward the version-number button in the header */}
      <div
        className="absolute -top-1.5 w-3 h-3 rotate-45 bg-card border-l border-t border-border"
        style={{ right: pos.arrowRight }}
      />

      <div className="relative rounded-lg bg-card/95 backdrop-blur-sm border border-border shadow-xl p-3.5">
        <button
          onClick={() => dismiss('dismissed')}
          className="absolute top-2 right-2 text-muted-foreground/60 hover:text-foreground transition-colors p-0.5 rounded-md hover:bg-accent"
          aria-label="Dismiss"
        >
          <X className="w-3.5 h-3.5" />
        </button>

        <p className="text-sm text-foreground/90 leading-relaxed pr-4">
          👋 Hope you're enjoying ManaFoundry! Got a feature idea? Click the{' '}
          <span className="font-semibold text-violet-300/90">version number</span> just above to open
          the menu and find the <span className="font-semibold text-violet-300/90">Community Poll</span>.
        </p>

        <Link
          to="/community-poll"
          onClick={() => dismiss('clicked')}
          className="mt-2.5 inline-flex items-center gap-1.5 text-xs font-medium text-violet-300/90 hover:text-violet-200 transition-colors"
        >
          <MessageSquare className="w-3.5 h-3.5" />
          Open the poll now →
        </Link>
      </div>
    </div>,
    document.body
  );
}
