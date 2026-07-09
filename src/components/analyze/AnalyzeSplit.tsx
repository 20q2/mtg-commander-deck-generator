// src/components/analyze/AnalyzeSplit.tsx
import type { ReactNode } from 'react';
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels';
import { useMediaQuery } from '@/hooks/useMediaQuery';

interface AnalyzeSplitProps {
  analyzer: ReactNode;
  deck: ReactNode;
}

export function AnalyzeSplit({ analyzer, deck }: AnalyzeSplitProps) {
  // Render the children in ONE layout only. The old CSS-hidden dual layout kept
  // both subtrees mounted, so DeckOptimizer mounted twice — two analyzers
  // double-fetched metrics and the hidden one's auto-detection eventually
  // clobbered the user's chosen theme via the shared onThemeMembershipChange.
  // Remounts once when crossing the lg breakpoint (rare) — far cheaper than
  // two permanent instances fighting over shared state.
  const isDesktop = useMediaQuery('(min-width: 1024px)'); // Tailwind `lg`

  if (!isDesktop) {
    return (
      <div>
        {analyzer}
        {deck}
      </div>
    );
  }

  return (
    <div className="h-[calc(100vh-77px)] sm:px-0 lg:px-0">
      <PanelGroup
        direction="horizontal"
        autoSaveId="analyze-split"
        className="h-full"
      >
        <Panel defaultSize={55} minSize={30} className="overflow-hidden">
          <div className="h-full min-h-0 flex flex-col">
            {analyzer}
          </div>
        </Panel>
        <PanelResizeHandle className="group relative flex items-center justify-center cursor-col-resize">
          <span
            aria-hidden
            className="block h-full w-px bg-border/40 transition-colors group-hover:bg-violet-400/60 group-data-[resize-handle-active]:bg-violet-400/60"
          />
        </PanelResizeHandle>
        <Panel defaultSize={45} minSize={30} className="overflow-hidden">
          <div className="h-full min-h-0 flex flex-col">
            {deck}
          </div>
        </Panel>
      </PanelGroup>
    </div>
  );
}
