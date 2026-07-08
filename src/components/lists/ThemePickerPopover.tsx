import { useState, useCallback } from 'react';
import { Tags, X, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import type { ScryfallCard, EDHRECCommanderData } from '@/types';
import { fetchCommanderThemes, fetchCommanderThemeData, fetchPartnerThemeData } from '@/services/edhrec/client';
import { detectThemes, type ThemeMatchResult } from '@/services/deckBuilder/themeDetector';
import { getFrontFaceTypeLine } from '@/services/scryfall/client';
import { ThemeSearchList } from '@/components/theme/ThemeSearchList';

export interface SelectedTheme { name: string; slug: string }

interface ThemePickerPopoverProps {
  themes: SelectedTheme[];
  onChange: (themes: SelectedTheme[]) => void;
  commanderName?: string;
  partnerCommanderName?: string;
  /** Current mainboard cards — powers the archetype-data theme detection. */
  deckCards: ScryfallCard[];
}

const MAX_THEMES = 2;            // matches the generator's theme limit
const DETECTION_CANDIDATES = 5;  // commander taglinks evaluated against the deck

interface Detection {
  /** Confident best guess (1-2 themes) per the Inspector's thresholds, or null. */
  guess: ThemeMatchResult[] | null;
  /** All evaluated candidates, score-ordered. */
  evaluated: ThemeMatchResult[];
  deckNonBasicCount: number;
}

export function ThemePickerPopover({ themes, onChange, commanderName, partnerCommanderName, deckCards }: ThemePickerPopoverProps) {
  const [open, setOpen] = useState(false);
  const [detectionStarted, setDetectionStarted] = useState(false);
  const [detection, setDetection] = useState<Detection | null>(null);
  const [loading, setLoading] = useState(false);

  // Lazy: detection runs on first open, fail-open. (Taxonomy loads inside ThemeSearchList.)
  const handleOpenChange = useCallback((next: boolean) => {
    setOpen(next);
    if (!next || detectionStarted) return;
    setDetectionStarted(true);
    setLoading(true);
    void (async () => {
      try {
        if (!commanderName) { setDetection(null); return; }

        // Same interpretation the Inspector uses: score the commander's top themes
        // against the actual deck list (card overlap + weighted inclusion + keywords),
        // with confidence thresholds deciding whether we call it a "guess".
        const commanderThemes = await fetchCommanderThemes(commanderName).catch(() => []);
        const candidates = commanderThemes.slice(0, DETECTION_CANDIDATES);
        const themeDataMap = new Map<string, EDHRECCommanderData>();
        for (const theme of candidates) {
          try {
            const data = partnerCommanderName
              ? await fetchPartnerThemeData(commanderName, partnerCommanderName, theme.slug)
              : await fetchCommanderThemeData(commanderName, theme.slug);
            themeDataMap.set(theme.slug, data);
          } catch { /* one theme page failing shouldn't kill detection */ }
        }
        if (themeDataMap.size === 0) { setDetection(null); return; }

        const result = detectThemes(candidates, themeDataMap, deckCards, [], commanderName);
        const nonBasic = deckCards.filter(c => {
          const tl = getFrontFaceTypeLine(c).toLowerCase();
          return !(tl.includes('basic') && tl.includes('land'));
        }).length;
        setDetection({
          guess: result.isConfident && result.matchedThemes.length > 0 ? result.matchedThemes : null,
          evaluated: result.evaluatedThemes.filter(t => t.cardOverlap > 0),
          deckNonBasicCount: nonBasic,
        });
      } finally {
        setLoading(false);
      }
    })();
  }, [detectionStarted, commanderName, partnerCommanderName, deckCards]);

  const addTheme = (t: SelectedTheme) => {
    if (themes.length >= MAX_THEMES || themes.some(s => s.slug === t.slug)) return;
    onChange([...themes, t]);
  };
  const removeTheme = (slug: string) => onChange(themes.filter(t => t.slug !== slug));

  const applyGuess = (guess: ThemeMatchResult[]) => {
    onChange(guess.slice(0, MAX_THEMES).map(m => ({ name: m.theme.name, slug: m.theme.slug })));
  };

  const selectedSlugs = new Set(themes.map(t => t.slug));
  const guessSlugs = new Set((detection?.guess ?? []).map(m => m.theme.slug));
  const guessApplied = detection?.guess != null && detection.guess.every(m => selectedSlugs.has(m.theme.slug));

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="gap-1.5 h-7 px-2 text-muted-foreground hover:text-foreground hover:bg-accent/40 border border-transparent hover:border-border/40"
        >
          <Tags className="w-3.5 h-3.5 text-violet-300/70" />
          {themes.length > 0
            ? <span className="text-xs text-violet-200/90">{themes.map(t => t.name).join(' + ')}</span>
            : <span className="text-xs hidden sm:inline">Theme</span>}
        </Button>
      </PopoverTrigger>
      <PopoverContent side="bottom" align="start" className="w-80 p-3 space-y-3">
        <div className="text-xs font-medium text-foreground/90">Deck theme (max {MAX_THEMES})</div>

        {themes.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {themes.map(t => (
              <span
                key={t.slug}
                className="inline-flex items-center gap-1 rounded-full bg-violet-500/25 border border-violet-400/60 pl-2.5 pr-1.5 py-0.5 text-xs font-medium text-violet-100"
              >
                {t.name}
                <button onClick={() => removeTheme(t.slug)} aria-label={`Remove ${t.name}`} className="text-violet-200/70 hover:text-white">
                  <X className="w-3 h-3" />
                </button>
              </span>
            ))}
            {themes.length >= MAX_THEMES && (
              <span className="text-[11px] text-muted-foreground/70 self-center">Max {MAX_THEMES} — remove one to swap</span>
            )}
          </div>
        )}

        {loading && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="w-3.5 h-3.5 animate-spin" /> Interpreting your deck's EDHREC data…
          </div>
        )}

        {!loading && detection?.guess && !guessApplied && (
          <button
            onClick={() => applyGuess(detection.guess!)}
            className="w-full text-left rounded-lg border border-violet-400/30 bg-violet-500/10 px-2.5 py-2 hover:bg-violet-500/20 transition-colors"
          >
            <div className="flex items-center gap-1.5 text-xs font-medium text-violet-300/90">
              <Tags className="w-3.5 h-3.5" />
              This looks like {detection.guess.map(m => m.theme.name).join(' + ')}
            </div>
            <div className="text-[11px] text-muted-foreground mt-0.5">
              {detection.guess[0].cardOverlap} of your {detection.deckNonBasicCount} cards fit the archetype
              {' '}· match score {Math.round(detection.guess[0].score)} — tap to apply
            </div>
          </button>
        )}

        <ThemeSearchList
          enabled={open}
          onPick={addTheme}
          disabledSlugs={selectedSlugs}
          disableAll={themes.length >= MAX_THEMES}
          suggestions={detection?.evaluated.slice(0, 4).map(m => ({
            name: m.theme.name,
            slug: m.theme.slug,
            score: m.score,
            isBestGuess: guessSlugs.has(m.theme.slug),
          }))}
        />
      </PopoverContent>
    </Popover>
  );
}
