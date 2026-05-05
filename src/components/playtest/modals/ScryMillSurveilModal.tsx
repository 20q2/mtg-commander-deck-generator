import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { usePlaytestStore } from '@/store/playtestStore';
import { getCardImageUrl } from '@/services/scryfall/client';
import type { ScryfallCard } from '@/types';

export function ScryMillSurveilModal() {
  const modal = usePlaytestStore(s => s.modal);
  const library = usePlaytestStore(s => s.zones.library);
  const closeModal = usePlaytestStore(s => s.closeModal);
  const scryConfirm = usePlaytestStore(s => s.scryConfirm);
  const surveilConfirm = usePlaytestStore(s => s.surveilConfirm);
  const millConfirm = usePlaytestStore(s => s.millConfirm);

  if (!modal || (modal.kind !== 'scry' && modal.kind !== 'mill' && modal.kind !== 'surveil')) return null;

  const n = Math.min(modal.n, library.length);
  const top = library.slice(0, n);

  if (modal.kind === 'mill') {
    return (
      <ModalShell title={`Mill ${n}`} onClose={closeModal}>
        <p className="text-sm text-muted-foreground mb-3">These {n} cards will be moved from library to graveyard:</p>
        <div className="grid grid-cols-7 gap-2 mb-5">
          {top.map((c, i) => <img key={`${c.id}-${i}`} src={getCardImageUrl(c, 'normal')} alt={c.name} className="w-full rounded-[4px] shadow" />)}
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={closeModal}>Cancel</Button>
          <Button onClick={() => millConfirm(n)}>Mill {n}</Button>
        </div>
      </ModalShell>
    );
  }

  if (modal.kind === 'scry') return <ScryUI top={top} onConfirm={scryConfirm} onClose={closeModal} title={`Scry ${n}`} />;
  return <SurveilUI top={top} onConfirm={surveilConfirm} onClose={closeModal} title={`Surveil ${n}`} />;
}

function ModalShell({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return createPortal(
    <div className="fixed inset-0 z-[100] bg-background/85 backdrop-blur-sm flex items-center justify-center p-6">
      <div className="bg-card border border-border rounded-lg shadow-2xl max-w-4xl w-full p-6">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-semibold">{title}</h2>
          <Button variant="ghost" size="icon" onClick={onClose}><X className="w-4 h-4" /></Button>
        </div>
        {children}
      </div>
    </div>,
    document.body,
  );
}

function ScryUI({ top, onConfirm, onClose, title }: { top: ScryfallCard[]; onConfirm: (decisions: ('top' | 'bottom')[]) => void; onClose: () => void; title: string }) {
  const [decisions, setDecisions] = useState<('top' | 'bottom')[]>(() => top.map(() => 'top'));
  useEffect(() => { setDecisions(top.map(() => 'top')); }, [top.length]);
  return (
    <ModalShell title={title} onClose={onClose}>
      <p className="text-sm text-muted-foreground mb-3">Click a card to toggle Top ↔ Bottom of library.</p>
      <div className="grid grid-cols-7 gap-2 mb-5">
        {top.map((c, i) => (
          <button key={`${c.id}-${i}`} onClick={() => setDecisions(d => d.map((x, j) => j === i ? (x === 'top' ? 'bottom' : 'top') : x))}
            className={`relative rounded-[4px] ${decisions[i] === 'bottom' ? 'opacity-60 ring-2 ring-amber-400' : 'ring-2 ring-emerald-400'}`}>
            <img src={getCardImageUrl(c, 'normal')} alt={c.name} className="w-full rounded-[4px] shadow" />
            <span className={`absolute top-1 right-1 text-[10px] font-bold px-1.5 py-0.5 rounded ${decisions[i] === 'bottom' ? 'bg-amber-500 text-black' : 'bg-emerald-500 text-black'}`}>{decisions[i]}</span>
          </button>
        ))}
      </div>
      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={onClose}>Cancel</Button>
        <Button onClick={() => onConfirm(decisions)}>Confirm</Button>
      </div>
    </ModalShell>
  );
}

function SurveilUI({ top, onConfirm, onClose, title }: { top: ScryfallCard[]; onConfirm: (decisions: ('top' | 'graveyard')[]) => void; onClose: () => void; title: string }) {
  const [decisions, setDecisions] = useState<('top' | 'graveyard')[]>(() => top.map(() => 'top'));
  useEffect(() => { setDecisions(top.map(() => 'top')); }, [top.length]);
  return (
    <ModalShell title={title} onClose={onClose}>
      <p className="text-sm text-muted-foreground mb-3">Click a card to toggle Top ↔ Graveyard.</p>
      <div className="grid grid-cols-7 gap-2 mb-5">
        {top.map((c, i) => (
          <button key={`${c.id}-${i}`} onClick={() => setDecisions(d => d.map((x, j) => j === i ? (x === 'top' ? 'graveyard' : 'top') : x))}
            className={`relative rounded-[4px] ${decisions[i] === 'graveyard' ? 'opacity-60 ring-2 ring-zinc-400' : 'ring-2 ring-emerald-400'}`}>
            <img src={getCardImageUrl(c, 'normal')} alt={c.name} className="w-full rounded-[4px] shadow" />
            <span className={`absolute top-1 right-1 text-[10px] font-bold px-1.5 py-0.5 rounded ${decisions[i] === 'graveyard' ? 'bg-zinc-500 text-white' : 'bg-emerald-500 text-black'}`}>{decisions[i] === 'graveyard' ? 'GY' : 'top'}</span>
          </button>
        ))}
      </div>
      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={onClose}>Cancel</Button>
        <Button onClick={() => onConfirm(decisions)}>Confirm</Button>
      </div>
    </ModalShell>
  );
}
