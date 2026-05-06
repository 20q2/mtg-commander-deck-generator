import React, { useEffect, useRef } from 'react';
import { useDroppable } from '@dnd-kit/core';
import { usePlaytestStore } from '@/store/playtestStore';
import { usePlaytestSettings, BG_STYLES } from '@/store/playtestSettingsStore';
import { BattlefieldCard } from '@/components/playtest/BattlefieldCard';

export function Battlefield() {
  const cards = usePlaytestStore(s => s.battlefield);
  const setRect = usePlaytestStore(s => s.setBattlefieldRect);
  const bg = usePlaytestSettings(s => s.bg);
  const containerRef = useRef<HTMLDivElement>(null);

  // Track size for arrival snap
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const update = () => {
      const r = el.getBoundingClientRect();
      setRect(r.width, r.height);
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [setRect]);

  const { setNodeRef, isOver } = useDroppable({ id: 'battlefield', data: { kind: 'battlefield' } });
  const composedRef = (node: HTMLDivElement | null) => {
    (containerRef as React.MutableRefObject<HTMLDivElement | null>).current = node;
    setNodeRef(node);
  };

  // Render parents first, attached children after parents (z-order)
  const sorted = [...cards].sort((a, b) => {
    if (!a.attachedTo && b.attachedTo) return -1;
    if (a.attachedTo && !b.attachedTo) return 1;
    return 0;
  });

  return (
    <div
      ref={composedRef}
      className={`flex-1 relative border-b border-border/50 overflow-hidden ${isOver ? 'ring-2 ring-primary/40 ring-inset' : ''}`}
      style={{ background: BG_STYLES[bg].background }}
    >
      {sorted.map(b => <BattlefieldCard key={b.instanceId} card={b} />)}
    </div>
  );
}
