import { BRACKET_HEX, type Gate } from './bracketViewModel';

/**
 * What a present element requires, said in words.
 *
 * There is no ✓/✗ here on purpose. A Bracket 4 deck is *supposed* to run Game
 * Changers and mass land denial — flagging those amber makes correct choices
 * look like faults. And a deck with no extra turns hasn't earned a tick; it
 * simply doesn't contain any.
 *
 * So an element the deck contains gets a chip naming the bracket it requires,
 * tinted in that bracket's own colour. The deck's floor is just the highest
 * chip on show. Elements that are absent, or that never force a bracket, get
 * nothing at all — their count already reads "none", and silence is the
 * honest rendering of "this doesn't apply".
 */
export function GateBracketChip({ gate }: { gate: Gate }) {
  if (gate.status !== 'present') return null;
  const hex = BRACKET_HEX[gate.forcesBracket];
  return (
    <span
      className="shrink-0 text-[11px] font-semibold px-2 py-0.5 rounded-md whitespace-nowrap"
      style={{ backgroundColor: `${hex}26`, color: hex }}
    >
      Bracket {gate.forcesBracket}
    </span>
  );
}

/** Card chrome for a gate row — tinted with its bracket hue only when present. */
export function gateTint(gate: Gate) {
  if (gate.status !== 'present') return { className: 'border-border/30 bg-background/40', style: undefined };
  const hex = BRACKET_HEX[gate.forcesBracket];
  return { className: '', style: { borderColor: `${hex}55`, backgroundColor: `${hex}0f` } };
}
