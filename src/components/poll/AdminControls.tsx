// src/components/poll/AdminControls.tsx
import { useState } from 'react';
import { Trash2, MessageSquarePlus, PackageCheck, Mail } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { Suggestion } from '@/services/poll/types';

interface Props {
  suggestion: Suggestion;
  onSetDevNote: (devNote: string) => Promise<void>;
  onMarkShipped: (version: string) => Promise<void>;
  onDelete: () => Promise<void>;
}

export function AdminControls({ suggestion, onSetDevNote, onMarkShipped, onDelete }: Props) {
  const [noteOpen, setNoteOpen] = useState(false);
  const [note, setNote] = useState(suggestion.devNote || '');
  const [busy, setBusy] = useState(false);

  const handleNote = async () => { setBusy(true); try { await onSetDevNote(note.trim()); setNoteOpen(false); } finally { setBusy(false); } };
  const handleShip = async () => {
    const v = window.prompt('Shipped version (e.g. ' + __APP_VERSION__ + ')', __APP_VERSION__);
    if (!v) return;
    setBusy(true); try { await onMarkShipped(v); } finally { setBusy(false); }
  };
  const handleDelete = async () => {
    if (!window.confirm(`Delete "${suggestion.title}"? This also removes all votes.`)) return;
    setBusy(true); try { await onDelete(); } finally { setBusy(false); }
  };

  return (
    <div className="mt-3 pt-3 border-t border-border/40">
      {suggestion.authorEmail && (
        <div className="mb-2.5 flex items-center gap-1.5 text-[12px] text-muted-foreground">
          <Mail className="w-3.5 h-3.5" />
          <a href={`mailto:${suggestion.authorEmail}`} className="text-violet-300/90 hover:text-violet-200 underline">
            {suggestion.authorEmail}
          </a>
        </div>
      )}
      {noteOpen ? (
        <div className="flex gap-2">
          <Input
            value={note}
            onChange={e => setNote(e.target.value)}
            placeholder="Dev note (leave blank to remove)"
            autoFocus
            onKeyDown={e => { if (e.key === 'Enter') handleNote(); if (e.key === 'Escape') setNoteOpen(false); }}
          />
          <Button size="sm" onClick={handleNote} disabled={busy}>Save</Button>
          <Button size="sm" variant="ghost" onClick={() => setNoteOpen(false)} disabled={busy}>Cancel</Button>
        </div>
      ) : (
        <div className="flex gap-2 flex-wrap">
          <Button size="sm" variant="outline" onClick={() => setNoteOpen(true)} disabled={busy}>
            <MessageSquarePlus className="w-3.5 h-3.5 mr-1.5" />
            {suggestion.devNote ? 'Edit dev note' : 'Add dev note'}
          </Button>
          {suggestion.status !== 'shipped' && (
            <Button size="sm" variant="outline" onClick={handleShip} disabled={busy}>
              <PackageCheck className="w-3.5 h-3.5 mr-1.5" />
              Mark shipped
            </Button>
          )}
          <Button size="sm" variant="destructive" onClick={handleDelete} disabled={busy}>
            <Trash2 className="w-3.5 h-3.5 mr-1.5" />
            Delete
          </Button>
        </div>
      )}
    </div>
  );
}
