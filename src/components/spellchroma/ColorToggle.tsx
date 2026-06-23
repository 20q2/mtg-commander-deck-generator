// WUBRG identity filter rendered with Mana Font symbols (ms ms-<c> ms-cost).
// Empty array = no color restriction (searchCards omits id<=).
const COLORS: { c: string; label: string }[] = [
  { c: 'W', label: 'White' },
  { c: 'U', label: 'Blue' },
  { c: 'B', label: 'Black' },
  { c: 'R', label: 'Red' },
  { c: 'G', label: 'Green' },
];

export function ColorToggle({ value, onChange }: { value: string[]; onChange: (next: string[]) => void }) {
  const toggle = (c: string) =>
    onChange(value.includes(c) ? value.filter(x => x !== c) : [...value, c]);

  return (
    <div className="flex items-center gap-1.5" role="group" aria-label="Color identity filter">
      {COLORS.map(({ c, label }) => {
        const active = value.includes(c);
        return (
          <button
            key={c}
            type="button"
            onClick={() => toggle(c)}
            aria-pressed={active}
            title={label}
            className={`leading-none transition-all duration-150 ${
              active
                ? 'opacity-100 scale-110 drop-shadow-[0_0_4px_rgba(255,255,255,0.35)]'
                : 'opacity-40 grayscale hover:opacity-75 hover:grayscale-0'
            }`}
          >
            <i className={`ms ms-${c.toLowerCase()} ms-cost text-lg`} aria-hidden />
          </button>
        );
      })}
    </div>
  );
}
