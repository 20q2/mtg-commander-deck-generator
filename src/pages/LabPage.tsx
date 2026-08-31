import { useState } from 'react';
import { FlaskConical } from 'lucide-react';
import { usePageTitle } from '@/hooks/usePageTitle';
import { ThemeLabTab } from '@/components/themelab/ThemeLabTab';
import { FinisherLabTab } from '@/components/finisherlab/FinisherLabTab';

type LabTab = 'themes' | 'finishers';

const TABS: { key: LabTab; label: string }[] = [
  { key: 'themes', label: 'Themes' },
  { key: 'finishers', label: 'Finishers' },
];

/**
 * Dev-only instrument shell. Each tab is a self-contained lab over one part of the pipeline;
 * they share nothing but the chrome, so state stays local to each tab.
 */
export function LabPage() {
  usePageTitle('Lab');
  const [tab, setTab] = useState<LabTab>('themes');

  return (
    <div className="container mx-auto px-4 py-6 max-w-7xl space-y-6">
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <FlaskConical className="w-5 h-5 text-amber-400/90" />
          <h1 className="text-xl font-semibold">Lab</h1>
          <span className="text-xs text-muted-foreground">dev only</span>
        </div>
        <div className="flex items-center gap-2 ml-auto">
          {TABS.map(t => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`text-xs px-3 py-1.5 rounded-md border transition-colors ${
                tab === t.key ? 'bg-accent border-primary/50' : 'border-border/50 hover:bg-accent/50'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {tab === 'themes' ? <ThemeLabTab /> : <FinisherLabTab />}
    </div>
  );
}
