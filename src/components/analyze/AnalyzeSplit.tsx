// src/components/analyze/AnalyzeSplit.tsx
import type { ReactNode } from 'react';
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels';

interface AnalyzeSplitProps {
  analyzer: ReactNode;
  deck: ReactNode;
}

export function AnalyzeSplit({ analyzer, deck }: AnalyzeSplitProps) {
  return (
    <>
      <div className="lg:hidden">
        {analyzer}
        {deck}
      </div>

      <div className="hidden lg:block h-[calc(100vh-77px)] sm:px-0 lg:px-0">
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
    </>
  );
}
