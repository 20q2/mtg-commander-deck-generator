import type { ComponentType } from 'react';
import { ClipboardPaste, ListChecks } from 'lucide-react';
import { LogoMark } from '@/components/ui/logo-mark';

export type LaneKey = 'paste' | 'lists' | 'generate';

const TABS: { key: LaneKey; label: string; icon: ComponentType<{ className?: string }> }[] = [
  { key: 'paste',    label: 'Paste',     icon: ClipboardPaste },
  { key: 'lists',    label: 'My Decks',  icon: ListChecks },
  { key: 'generate', label: 'Forge',     icon: LogoMark },
];

interface LaneTabsProps {
  active: LaneKey;
  onChange: (k: LaneKey) => void;
}

export function LaneTabs({ active, onChange }: LaneTabsProps) {
  return (
    <div role="tablist" aria-label="Choose how to load a deck" className="flex items-center gap-1.5 justify-center mb-6">
      {TABS.map(tab => {
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
