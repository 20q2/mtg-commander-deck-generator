import type { ComponentType } from 'react';
import { ClipboardPaste, ListChecks } from 'lucide-react';
import { LogoMark } from '@/components/ui/logo-mark';

export interface LaneTab<K extends string> {
  key: K;
  label: string;
  icon: ComponentType<{ className?: string }>;
}

/** Inspector's hub: paste a list, pick a saved deck, or go generate one. */
export type AnalyzeLaneKey = 'paste' | 'lists' | 'generate';
export const ANALYZE_LANES: LaneTab<AnalyzeLaneKey>[] = [
  { key: 'paste',    label: 'Paste',    icon: ClipboardPaste },
  { key: 'lists',    label: 'My Decks', icon: ListChecks },
  { key: 'generate', label: 'Assemble', icon: LogoMark },
];

/**
 * Playtest's hub. No "Assemble" lane — generating a deck to goldfish it is the
 * Foundry's job, and the generated-deck callout above the tabs covers that handoff.
 */
export type PlaytestLaneKey = 'paste' | 'lists';
export const PLAYTEST_LANES: LaneTab<PlaytestLaneKey>[] = [
  { key: 'paste', label: 'Paste',    icon: ClipboardPaste },
  { key: 'lists', label: 'My Decks', icon: ListChecks },
];

interface LaneTabsProps<K extends string> {
  tabs: LaneTab<K>[];
  active: K;
  onChange: (k: K) => void;
}

export function LaneTabs<K extends string>({ tabs, active, onChange }: LaneTabsProps<K>) {
  return (
    <div role="tablist" aria-label="Choose how to load a deck" className="flex items-center gap-1.5 justify-center mb-6">
      {tabs.map(tab => {
        const isActive = active === tab.key;
        return (
          <button
            key={tab.key}
            role="tab"
            aria-selected={isActive}
            aria-controls={`lane-panel-${tab.key}`}
            id={`lane-tab-${tab.key}`}
            onClick={() => onChange(tab.key)}
            className={`flex items-center gap-1.5 px-4 py-2 text-sm font-medium rounded-full transition-all duration-200 border ${
              isActive
                ? 'bg-primary/20 text-violet-200 border-primary/50'
                : 'bg-card/40 border-border/40 text-muted-foreground hover:text-foreground hover:bg-accent/40'
            }`}
          >
            <tab.icon className="w-4 h-4" />
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}
