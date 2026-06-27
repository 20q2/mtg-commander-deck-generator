import { X } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger, PopoverClose } from '@/components/ui/popover';
import { Button } from '@/components/ui/button';
import { ColorToggle } from './ColorToggle';
import type { ColorMatch } from '@/services/spellchroma/explorerSearch';

const COLORS: { c: string; label: string }[] = [
  { c: 'W', label: 'White' },
  { c: 'U', label: 'Blue' },
  { c: 'B', label: 'Black' },
  { c: 'R', label: 'Red' },
  { c: 'G', label: 'Green' },
];

const MODES: { key: ColorMatch; sym: string; label: string }[] = [
  { key: 'subset',  sym: '≤', label: 'At most' },
  { key: 'exact',   sym: '=', label: 'Exactly' },
  { key: 'atleast', sym: '≥', label: 'At least' },
];

interface ColorFilterControlProps {
  colorIdentity: string[];
  onColorsChange: (next: string[]) => void;
  colorMode: ColorMatch;
  onColorModeChange: (m: ColorMatch) => void;
  excludedColors: string[];
  onExcludedChange: (next: string[]) => void;
}

export function ColorFilterControl({
  colorIdentity, onColorsChange, colorMode, onColorModeChange, excludedColors, onExcludedChange,
}: ColorFilterControlProps) {
  // Include and exclude are mutually exclusive per color.
  const setInclude = (next: string[]) => {
    onColorsChange(next);
    if (excludedColors.length) onExcludedChange(excludedColors.filter(c => !next.includes(c)));
  };
  const toggleExclude = (c: string) => {
    if (excludedColors.includes(c)) onExcludedChange(excludedColors.filter(x => x !== c));
    else {
      onExcludedChange([...excludedColors, c]);
      if (colorIdentity.includes(c)) onColorsChange(colorIdentity.filter(x => x !== c));
    }
  };

  const mode = MODES.find(m => m.key === colorMode) ?? MODES[0];
  const summary = colorIdentity.length === 0 && excludedColors.length === 0
    ? 'Any colors'
    : null;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="gap-1.5">
          {summary ?? (
            <span className="flex items-center gap-1">
              {colorIdentity.length > 0 && (
                <>
                  <span className="text-muted-foreground">{mode.sym}</span>
                  {colorIdentity.map(c => <i key={c} className={`ms ms-${c.toLowerCase()} ms-cost text-sm`} aria-hidden />)}
                </>
              )}
              {excludedColors.map(c => (
                <span key={c} className="relative inline-flex">
                  <i className={`ms ms-${c.toLowerCase()} ms-cost text-sm opacity-60`} aria-hidden />
                  <span className="absolute inset-0 flex items-center justify-center text-red-400 font-bold leading-none">/</span>
                </span>
              ))}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-64 p-3 flex flex-col gap-3">
        {/* Include */}
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between">
            <p className="text-xs font-medium text-muted-foreground">Colors</p>
            <div className="flex items-center gap-1.5">
              {colorIdentity.length > 0 && (
                <button type="button" onClick={() => onColorsChange([])}
                  className="text-[11px] text-muted-foreground/70 hover:text-foreground transition-colors">
                  Clear
                </button>
              )}
              {/* Explicit close — lets phone users dismiss without tapping the backdrop. */}
              <PopoverClose aria-label="Close" className="-mr-1 rounded-md p-1 text-muted-foreground/60 hover:bg-accent/50 hover:text-foreground transition-colors">
                <X className="w-3.5 h-3.5" />
              </PopoverClose>
            </div>
          </div>
          <ColorToggle value={colorIdentity} onChange={setInclude} />
        </div>

        {/* Match mode */}
        <div className="flex flex-col gap-1.5">
          <p className="text-xs font-medium text-muted-foreground">Match</p>
          <div className="flex items-center border border-border/50 rounded-md overflow-hidden self-start">
            {MODES.map((m, i) => (
              <div key={m.key} className="contents">
                {i > 0 && <div className="w-px h-5 bg-border/50" />}
                <button type="button" onClick={() => onColorModeChange(m.key)} aria-pressed={colorMode === m.key}
                  title={m.label}
                  className={`text-xs px-2.5 py-1 transition-colors ${colorMode === m.key ? 'bg-accent text-foreground font-medium' : 'text-muted-foreground/70 hover:text-foreground hover:bg-accent/50'}`}>
                  <span className="mr-1">{m.sym}</span>{m.label}
                </button>
              </div>
            ))}
          </div>
        </div>

        {/* Exclude */}
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between">
            <p className="text-xs font-medium text-muted-foreground">Exclude</p>
            {excludedColors.length > 0 && (
              <button type="button" onClick={() => onExcludedChange([])}
                className="text-[11px] text-muted-foreground/70 hover:text-foreground transition-colors">
                Clear
              </button>
            )}
          </div>
          <div className="flex items-center gap-1.5" role="group" aria-label="Exclude colors">
            {COLORS.map(({ c, label }) => {
              const active = excludedColors.includes(c);
              return (
                <button key={c} type="button" onClick={() => toggleExclude(c)} aria-pressed={active} title={`Exclude ${label}`}
                  className={`relative leading-none transition-all duration-150 ${active ? 'opacity-100 scale-110' : 'opacity-40 grayscale hover:opacity-75 hover:grayscale-0'}`}>
                  <i className={`ms ms-${c.toLowerCase()} ms-cost text-lg`} aria-hidden />
                  {active && <span className="absolute inset-0 flex items-center justify-center text-red-400 font-bold text-xl leading-none">/</span>}
                </button>
              );
            })}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
