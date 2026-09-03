import { createPortal } from 'react-dom';
import { useFloatingText, type FloatTone } from '@/store/floatingTextStore';
import { usePlaytestSettings } from '@/store/playtestSettingsStore';

const TONE: Record<FloatTone, string> = {
  damage:  'text-rose-300',
  heal:    'text-emerald-300',
  buff:    'text-violet-200',
  debuff:  'text-amber-300',
  neutral: 'text-foreground',
};

/**
 * Renders every in-flight pop of floating text. One fixed layer at the document
 * level rather than a node per card, so text can outlive the card it came from —
 * a creature dying still gets to say so on its way out.
 */
export function FloatingTextLayer() {
  const items = useFloatingText(s => s.items);
  const animations = usePlaytestSettings(s => s.animations);

  if (!animations || items.length === 0) return null;

  return createPortal(
    <div className="fixed inset-0 z-[300] pointer-events-none overflow-hidden" aria-hidden>
      {items.map(item => (
        <span
          key={item.id}
          className={`absolute -translate-x-1/2 whitespace-nowrap font-extrabold text-[15px] tabular-nums animate-float-up ${TONE[item.tone]}`}
          style={{
            left: item.x,
            top: item.y,
            textShadow: '0 1px 3px rgba(0,0,0,0.95), 0 0 10px rgba(0,0,0,0.7)',
          }}
        >
          {item.text}
        </span>
      ))}
    </div>,
    document.body,
  );
}
