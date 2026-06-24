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
          <PanelResizeHandle className="group relative z-20 w-px shrink-0 cursor-col-resize bg-border/40 transition-colors hover:bg-violet-400/60 data-[resize-handle-active]:bg-violet-400/60 animate-fade-in">
            {/* Wide invisible grab zone overlapping both panes so the seam itself
                stays a flush 1px line but the handle is still easy to grab. */}
            <span aria-hidden className="absolute inset-y-0 -left-2 -right-2" />
            {/* Persistent dot grip centered on the seam. */}
            <span aria-hidden className="pointer-events-none absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 flex flex-col gap-1 opacity-40 group-hover:opacity-100 transition-opacity">
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
