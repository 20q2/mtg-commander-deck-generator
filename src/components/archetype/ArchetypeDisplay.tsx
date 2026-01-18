import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Select } from '@/components/ui/select';
import { useStore } from '@/store';
import { ARCHETYPE_LABELS } from '@/lib/constants/archetypes';
import { Archetype } from '@/types';
import { ChevronDown } from 'lucide-react';

const confidenceColors = {
  high: 'bg-green-100 text-green-800 border-green-300',
  medium: 'bg-yellow-100 text-yellow-800 border-yellow-300',
  low: 'bg-gray-100 text-gray-800 border-gray-300',
};

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

export function ArchetypeDisplay() {
  const {
    detectedArchetypes,
    selectedArchetype,
    setSelectedArchetype,
    commander,
    edhrecThemes,
    selectedThemes,
    toggleThemeSelection,
    themesLoading,
    themesError,
    themeSource,
  } = useStore();

  const [showOtherDropdown, setShowOtherDropdown] = useState(false);

  if (!commander) return null;

  const primaryArchetype = detectedArchetypes[0];
  const secondaryArchetypes = detectedArchetypes.slice(1, 4);

  const archetypeOptions = Object.entries(ARCHETYPE_LABELS).map(
    ([value, label]) => ({ value, label })
  );

  const hasEdhrecThemes = themeSource === 'edhrec' && edhrecThemes.length > 0;

  // Handle "Other" chip click
  const handleOtherClick = () => {
    setShowOtherDropdown(!showOtherDropdown);
  };

  // Handle clicking back on an EDHREC theme (deselects "Other")
  const handleThemeClick = (themeName: string) => {
    toggleThemeSelection(themeName);
    // If selecting a theme, close the Other dropdown
    const theme = selectedThemes.find((t) => t.name === themeName);
    if (theme && !theme.isSelected) {
      setShowOtherDropdown(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* EDHREC Themes Section */}
      {themesLoading && <ThemeLoadingSkeleton />}

      {!themesLoading && hasEdhrecThemes && (
        <div>
          <label className="text-sm font-medium text-muted-foreground mb-2 block">
            Popular Ways to Play
            <span className="text-xs ml-2 opacity-60">(from EDHREC)</span>
          </label>
          <div className="flex flex-wrap gap-2">
            {selectedThemes.slice(0, 8).map((theme) => (
              <ThemeChip
                key={theme.name}
                name={theme.name}
                popularityPercent={theme.popularityPercent}
                deckCount={theme.deckCount}
                isSelected={theme.isSelected && !showOtherDropdown}
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
                  showOtherDropdown
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
              ) : (
                <p className="text-sm text-muted-foreground">
                  No additional themes available for this commander
                </p>
              )}
              <p className="text-xs text-muted-foreground mt-2">
                Less common strategies from EDHREC
              </p>
            </div>
          )}

          {!showOtherDropdown && (
            <p className="text-xs text-muted-foreground mt-2">
              {selectedThemes.some(t => t.isSelected)
                ? `Building with: ${selectedThemes.filter(t => t.isSelected).map(t => t.name).join(', ')} · Unselect all for top cards`
                : 'No themes selected — will use top recommended cards for this commander'}
            </p>
          )}
        </div>
      )}

      {/* Fallback Notice */}
      {!themesLoading && themesError && (
        <div className="text-sm text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/30 px-3 py-2 rounded-md">
          Using local archetype detection (EDHREC unavailable)
        </div>
      )}

      {/* Local Archetype Detection (shown when EDHREC unavailable or as fallback) */}
      {(!hasEdhrecThemes || themesError) && !themesLoading && (
        <div>
          <label className="text-sm font-medium text-muted-foreground mb-2 block">
            Detected Archetype
          </label>

          {primaryArchetype && (
            <div className="flex items-center gap-2 mb-2">
              <Badge
                variant="default"
                className={`text-base px-3 py-1 ${confidenceColors[primaryArchetype.confidence]}`}
              >
                {ARCHETYPE_LABELS[primaryArchetype.archetype]}
              </Badge>
              <span className="text-xs text-muted-foreground">
                ({primaryArchetype.confidence} confidence)
              </span>
            </div>
          )}

          {secondaryArchetypes.length > 0 && (
            <div className="flex flex-wrap gap-1">
              <span className="text-xs text-muted-foreground mr-1">Also:</span>
              {secondaryArchetypes.map((arch) => (
                <Badge
                  key={arch.archetype}
                  variant="outline"
                  className="text-xs"
                >
                  {ARCHETYPE_LABELS[arch.archetype]}
                </Badge>
              ))}
            </div>
          )}

          {/* Always show dropdown when no EDHREC themes */}
          <div className="mt-3">
            <label className="text-sm font-medium text-muted-foreground mb-2 block">
              Override Archetype
            </label>
            <Select
              value={selectedArchetype}
              onChange={(e) => setSelectedArchetype(e.target.value as Archetype)}
              options={archetypeOptions}
              className="w-full"
            />
            <p className="text-xs text-muted-foreground mt-1">
              Change this to adjust how the deck is built
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
