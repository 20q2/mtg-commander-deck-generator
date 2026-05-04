export function PlaytestToolbar({ onExit }: { onExit: () => void }) {
  return <div className="border-b border-border/50 px-4 py-2 text-sm flex items-center gap-3">
    <button onClick={onExit} className="underline">← Exit</button>
    <span>Playtest</span>
  </div>;
}
