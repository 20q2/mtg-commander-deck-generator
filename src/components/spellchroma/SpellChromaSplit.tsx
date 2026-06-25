import type { ReactNode } from 'react';
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels';

/**
 * SpellChroma workbench split: the deck playmat on the left, the explorer on
 * the right, with a draggable divider (ratio persisted via autoSaveId).
 * Default ~40/60 (explorer-focused). Stacks vertically below lg.
 */
export function SpellChromaSplit({ deck, explorer }: { deck: ReactNode; explorer: ReactNode }) {
  return (
    <>
      <div className="lg:hidden flex flex-col gap-4">
        <div className="animate-sc-pane-left">{deck}</div>
        <div className="animate-sc-pane-right">{explorer}</div>
      </div>

      <div className="hidden lg:block h-[calc(100vh-77px)]">
        <PanelGroup direction="horizontal" autoSaveId="spellchroma-split" className="h-full">
          <Panel defaultSize={40} minSize={25} className="overflow-hidden">
            <div className="h-full min-h-0 flex flex-col animate-sc-pane-left">{deck}</div>
          </Panel>
          {/* A real 10px-wide hit area (so the whole cursor-col-resize zone is
              grabbable), biased entirely into the explorer pane (-mr-2.5, no left
              overlap) so it never sits on top of the deck column's scrollbar, which
              lives at the seam. Raised above the sticky toolbar (z-30). The visible
              seam line sits at the handle's left edge (the true pane boundary). */}
          <PanelResizeHandle className="group relative z-40 w-2.5 -mr-2.5 shrink-0 cursor-col-resize flex items-center justify-center animate-fade-in">
            <span aria-hidden className="absolute inset-y-0 left-0 w-px bg-border/40 transition-colors group-hover:bg-violet-400/60 group-data-[resize-handle-active]:bg-violet-400/60" />
            {/* Persistent dot grip near the seam. */}
            <span aria-hidden className="pointer-events-none relative flex flex-col gap-1 opacity-40 group-hover:opacity-100 transition-opacity">
              <span className="w-1 h-1 rounded-full bg-muted-foreground" />
              <span className="w-1 h-1 rounded-full bg-muted-foreground" />
              <span className="w-1 h-1 rounded-full bg-muted-foreground" />
            </span>
          </PanelResizeHandle>
          <Panel defaultSize={60} minSize={30} className="overflow-hidden">
            <div className="h-full min-h-0 flex flex-col overflow-y-auto animate-sc-pane-right">{explorer}</div>
          </Panel>
        </PanelGroup>
      </div>
    </>
  );
}
