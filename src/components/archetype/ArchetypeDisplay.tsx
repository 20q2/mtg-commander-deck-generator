import { useState } from 'react';
import { InfoTooltip } from '@/components/ui/info-tooltip';
import { useStore } from '@/store';
import { ChevronDown, Crosshair, Zap } from 'lucide-react';
import { trackEvent } from '@/services/analytics';

interface ArchetypeDisplayProps {}

function ThemeLoadingSkeleton() {
  return (
    <div className="space-y-2">
      <div className="h-4 w-40 bg-accent/50 rounded animate-pulse" />
      <div className="flex flex-wrap gap-2">
        {[1, 2, 3, 4].map((i) => (
          <div
            key={i}
            className="h-8 w-24 bg-accent/30 rounded-full animate-pulse"
          />
        ))}
      </div>
    </div>
  );
}

interface ThemeChipProps {
  name: string;
  popularityPercent?: number;
  deckCount?: number;
  isSelected: boolean;
  onClick: () => void;
}

function ThemeChip({
  name,
  popularityPercent,
  deckCount,
  isSelected,
  onClick,
}: ThemeChipProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`
        px-3 py-1.5 rounded-full text-sm flex items-center gap-2 transition-all
        border cursor-pointer
        ${
          isSelected
            ? 'bg-primary text-primary-foreground border-primary'
            : 'bg-accent/50 hover:bg-accent border-transparent hover:border-primary/30'
        }
      `}
    >
      <span className="font-medium">{name}</span>
      {popularityPercent !== undefined && (
        <span className={`text-xs ${isSelected ? 'opacity-80' : 'opacity-60'}`}>
          {popularityPercent.toFixed(0)}%
        </span>
      )}
      {deckCount !== undefined && deckCount > 0 && (
        <span className={`text-xs ${isSelected ? 'opacity-70' : 'opacity-50'}`}>
          ({deckCount.toLocaleString()})
        </span>
      )}
    </button>
  );
}

export function ArchetypeDisplay({}: ArchetypeDisplayProps) {
  const {
    commander,
    edhrecThemes,
    selectedThemes,
    toggleThemeSelection,
    themesLoading,
    themesError,
    themeSource,
    edhrecNumDecks,
    customization,
    updateCustomization,
  } = useStore();

  const [showOtherDropdown, setShowOtherDropdown] = useState(false);
  const [buildModesOpen, setBuildModesOpen] = useState(() => {
    const saved = localStorage.getItem('accordion-buildmodes');
    return saved === null ? false : saved === 'true';
  });

  if (!commander) return null;

  const hasEdhrecThemes = themeSource === 'edhrec' && edhrecThemes.length > 0;

  // Handle "Other" chip click
  const handleOtherClick = () => {
    setShowOtherDropdown(!showOtherDropdown);
  };

  const handleThemeClick = (themeName: string) => {
    const theme = selectedThemes.find(t => t.name === themeName);
    toggleThemeSelection(themeName);
    trackEvent('theme_toggled', {
      commanderName: commander.name,
      themeName,
      selected: !theme?.isSelected,
    });
  };

  return (
    <div className="gap-4 flex-1 flex flex-col">
      {/* EDHREC Themes Section */}
      {themesLoading && <ThemeLoadingSkeleton />}

      {!themesLoading && hasEdhrecThemes && (
        <div>
          <label className="text-sm font-medium text-muted-foreground mb-2 block">
            Popular Ways to Play
            <span className="text-xs ml-2 opacity-60">
              {edhrecNumDecks
                ? `(${edhrecNumDecks.toLocaleString()} decks on EDHREC)`
                : '(from EDHREC)'}
            </span>
          </label>
          <div className="flex flex-wrap gap-2">
            {selectedThemes.slice(0, 8).map((theme) => (
              <ThemeChip
                key={theme.name}
                name={theme.name}
                popularityPercent={theme.popularityPercent}
                deckCount={theme.deckCount}
                isSelected={theme.isSelected}
                onClick={() => handleThemeClick(theme.name)}
              />
            ))}
            {/* "Other" chip */}
            <button
              type="button"
              onClick={handleOtherClick}
              className={`
                px-3 py-1.5 rounded-full text-sm flex items-center gap-1.5 transition-all
                border cursor-pointer
                ${
                  showOtherDropdown || selectedThemes.slice(8).some(t => t.isSelected)
                    ? 'bg-primary text-primary-foreground border-primary'
                    : 'bg-accent/50 hover:bg-accent border-transparent hover:border-primary/30'
                }
              `}
            >
              <span className="font-medium">Other</span>
              <ChevronDown className={`w-3.5 h-3.5 transition-transform ${showOtherDropdown ? 'rotate-180' : ''}`} />
            </button>
          </div>

          {/* Additional themes dropdown - shown when "Other" is selected */}
          {showOtherDropdown && (
            <div className="mt-3 p-3 bg-accent/30 rounded-lg border border-border/50">
              <label className="text-sm font-medium text-muted-foreground mb-2 block">
                More Themes for {commander.name}
              </label>
              {selectedThemes.length > 8 ? (
                <>
                  <div className="flex flex-wrap gap-2">
                    {selectedThemes.slice(8).map((theme) => (
                      <ThemeChip
                        key={theme.name}
                        name={theme.name}
                        popularityPercent={theme.popularityPercent}
                        deckCount={theme.deckCount}
                        isSelected={theme.isSelected}
                        onClick={() => toggleThemeSelection(theme.name)}
                      />
                    ))}
                  </div>
                  <p className="text-xs text-muted-foreground mt-2">
                    Less common strategies from EDHREC
                  </p>
                </>
              ) : (
                <p className="text-sm text-muted-foreground">
                  No additional themes available for this commander
                </p>
              )}
            </div>
          )}

          {!showOtherDropdown && (
            <p className="text-xs text-muted-foreground mt-2">
              {selectedThemes.some(t => t.isSelected)
                ? `Building with: ${selectedThemes.filter(t => t.isSelected).map(t => t.name).join(', ')} · Unselect all for top cards`
                : 'No themes selected — will use top recommended cards for this commander'}
            </p>
          )}

          {selectedThemes.some(t => t.isSelected) &&
            selectedThemes.filter(t => t.isSelected).reduce((sum, t) => sum + (t.deckCount ?? 0), 0) < 50 && (
            <p className="text-xs text-amber-600 dark:text-amber-400 mt-1 flex items-center gap-1">
              <svg className="w-3.5 h-3.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" />
                <path d="M12 9v4" />
                <path d="M12 17h.01" />
              </svg>
              Low deck count for selected themes — results may be inconsistent
            </p>
          )}

        </div>
      )}

      {/* Fallback Notice — shown when EDHREC data is unavailable */}
      {!themesLoading && themesError && (
        <div className="text-sm text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/30 px-3 py-2 rounded-md">
          {customization.bracketLevel !== 'all' || customization.budgetOption !== 'any' ? (
            <>
              No EDHREC data for the current bracket/budget combination. Try resetting your{' '}
              <button
                onClick={() => updateCustomization({ bracketLevel: 'all', budgetOption: 'any' })}
                className="underline font-semibold hover:text-amber-500 dark:hover:text-amber-300 transition-colors"
              >
                customization settings
              </button>
              {' '}to defaults.
            </>
          ) : (
            <>No EDHREC data available for this commander. This usually means the commander is banned or too new, or there may be a connection issue with EDHREC. Deck quality will be significantly impacted without EDHREC data.</>
          )}
        </div>
      )}

      {/* Build Modes accordion — pinned to bottom of card */}
      <div className={`mt-auto ${buildModesOpen ? 'pt-2 border-t border-border/50' : ''}`}>
        <button
          onClick={() => { const v = !buildModesOpen; setBuildModesOpen(v); localStorage.setItem('accordion-buildmodes', String(v)); }}
          className="flex items-center justify-between w-full text-sm text-muted-foreground hover:text-foreground transition-colors py-1"
        >
          <span className="font-medium flex items-center gap-2">
            <Crosshair className="w-4 h-4" />
            Build Modes
            {!buildModesOpen && (customization.hyperFocus || !customization.balancedRoles) && (
              <span className="flex gap-1">
                {customization.hyperFocus && (
                  <span className="text-[10px] font-normal text-primary bg-primary/20 px-1.5 py-0.5 rounded-full">
                    Hyper Focus
                  </span>
                )}
                {!customization.balancedRoles && (
                  <span className="text-[10px] font-normal text-primary bg-primary/20 px-1.5 py-0.5 rounded-full">
                    Classic Build
                  </span>
                )}
              </span>
            )}
          </span>
          <svg
            className={`w-4 h-4 transition-transform ${buildModesOpen ? 'rotate-180' : ''}`}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </button>

        <div className={`grid transition-[grid-template-rows] duration-300 ease-in-out ${buildModesOpen ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'}`}>
          <div className="overflow-hidden">
            <div className="mt-3 space-y-2">
              {/* Hyper Focus — only relevant when themes are selected */}
              {selectedThemes.some(t => t.isSelected) && (
                <button
                  type="button"
                  onClick={() => updateCustomization({ hyperFocus: !customization.hyperFocus })}
                  className={`
                    w-full flex items-center gap-3 p-3 rounded-lg border transition-all cursor-pointer
                    ${customization.hyperFocus
                      ? 'border-primary/50 bg-primary/10'
                      : 'border-border/50 bg-accent/20 hover:border-primary/30'
                    }
                  `}
                >
                  <div className={`
                    w-8 h-8 rounded-full flex items-center justify-center shrink-0 transition-colors
                    ${customization.hyperFocus ? 'bg-primary/20 text-primary' : 'bg-accent text-muted-foreground'}
                  `}>
                    <Crosshair className="w-4 h-4" />
                  </div>
                  <div className="flex-1 text-left">
                    <div className="flex items-center gap-1.5">
                      <span className={`text-sm font-medium ${customization.hyperFocus ? 'text-primary' : ''}`}>
                        Hyper Focus
                      </span>
                      <InfoTooltip text="Experimental: Prioritizes cards unique to your selected themes and deprioritizes generic staples that appear across many archetypes. Great for discovering hidden gems specific to your strategy." />
                    </div>
                    <p className="text-[11px] text-muted-foreground leading-snug mt-0.5">
                      Discover unique cards, avoid generic staples
                    </p>
                  </div>
                  <div className={`
                    w-9 h-5 rounded-full relative transition-colors shrink-0
                    ${customization.hyperFocus ? 'bg-primary' : 'bg-muted'}
                  `}>
                    <div className={`
                      absolute top-0.5 w-4 h-4 rounded-full bg-white shadow-sm transition-transform
                      ${customization.hyperFocus ? 'translate-x-4' : 'translate-x-0.5'}
                    `} />
                  </div>
                </button>
              )}

              {/* Classic Build — disables role balancing */}
              <button
                type="button"
                onClick={() => updateCustomization({ balancedRoles: !customization.balancedRoles })}
                className={`
                  w-full flex items-center gap-3 p-3 rounded-lg border transition-all cursor-pointer
                  ${!customization.balancedRoles
                    ? 'border-primary/50 bg-primary/10'
                    : 'border-border/50 bg-accent/20 hover:border-primary/30'
                  }
                `}
              >
                <div className={`
                  w-8 h-8 rounded-full flex items-center justify-center shrink-0 transition-colors
                  ${!customization.balancedRoles ? 'bg-primary/20 text-primary' : 'bg-accent text-muted-foreground'}
                `}>
                  <Zap className="w-4 h-4" />
                </div>
                <div className="flex-1 text-left">
                  <div className="flex items-center gap-1.5">
                    <span className={`text-sm font-medium ${!customization.balancedRoles ? 'text-primary' : ''}`}>
                      Classic Build
                    </span>
                    <InfoTooltip text="Legacy algorithm that pulls the top cards based on statistical analysis. Skips role balancing and picks cards purely by synergy and power level." />
                  </div>
                  <p className="text-[11px] text-muted-foreground leading-snug mt-0.5">
                    Skip role balancing — pick cards purely by synergy and power
                  </p>
                </div>
                <div className={`
                  w-9 h-5 rounded-full relative transition-colors shrink-0
                  ${!customization.balancedRoles ? 'bg-primary' : 'bg-muted'}
                `}>
                  <div className={`
                    absolute top-0.5 w-4 h-4 rounded-full bg-white shadow-sm transition-transform
                    ${!customization.balancedRoles ? 'translate-x-4' : 'translate-x-0.5'}
                  `} />
                </div>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
