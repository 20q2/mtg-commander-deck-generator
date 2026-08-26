// src/components/poll/ComposeRow.tsx
import { useState, useRef, useEffect } from 'react';
import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

const MAX_TITLE = 80;
const MAX_DESC = 600;
const MAX_EMAIL = 254;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface Props {
  onSubmit: (title: string, description: string, email?: string) => Promise<void>;
  inflightError?: string | null;
}

export function ComposeRow({ onSubmit, inflightError }: Props) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => { if (open) inputRef.current?.focus(); }, [open]);

  const reset = () => { setTitle(''); setDescription(''); setEmail(''); setOpen(false); };

  const emailTrimmed = email.trim();
  const emailValid = emailTrimmed.length === 0 ||
    (emailTrimmed.length <= MAX_EMAIL && EMAIL_RE.test(emailTrimmed));

  const valid =
    title.trim().length > 0 && title.trim().length <= MAX_TITLE &&
    description.trim().length > 0 && description.trim().length <= MAX_DESC &&
    emailValid;

  const handleSubmit = async () => {
    if (!valid || busy) return;
    setBusy(true);
    try {
      await onSubmit(title.trim(), description.trim(), emailTrimmed || undefined);
      reset();
    } finally {
      setBusy(false);
    }
  };

  const handleKey: React.KeyboardEventHandler = (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      handleSubmit();
    } else if (e.key === 'Escape') {
      reset();
    }
  };

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="w-full flex items-center gap-3 bg-card/50 backdrop-blur-md border border-dashed border-border hover:border-primary/40 hover:bg-card/70 hover:text-foreground transition-all rounded-2xl px-[18px] py-3.5 text-muted-foreground text-sm text-left"
      >
        <span className="w-7 h-7 rounded-full bg-primary/20 text-violet-300/90 flex items-center justify-center">
          <Plus className="w-4 h-4" />
        </span>
        Suggest a feature…
      </button>
    );
  }

  return (
    <div className="glass rounded-2xl p-4 space-y-3" onKeyDown={handleKey}>
      <div>
        <div className="flex items-baseline justify-between mb-1.5">
          <label htmlFor="poll-title" className="text-xs font-medium text-muted-foreground">Title</label>
          <span className={`text-[10px] tabular-nums ${title.length > MAX_TITLE ? 'text-destructive' : 'text-muted-foreground/70'}`}>
            {title.length}/{MAX_TITLE}
          </span>
        </div>
        <Input
          id="poll-title"
          ref={inputRef}
          value={title}
          onChange={e => setTitle(e.target.value)}
          placeholder="Short, specific — what should we build?"
          maxLength={MAX_TITLE + 20}
        />
      </div>

      <div>
        <div className="flex items-baseline justify-between mb-1.5">
          <label htmlFor="poll-desc" className="text-xs font-medium text-muted-foreground">Description</label>
          <span className={`text-[10px] tabular-nums ${description.length > MAX_DESC ? 'text-destructive' : 'text-muted-foreground/70'}`}>
            {description.length}/{MAX_DESC}
          </span>
        </div>
        <textarea
          id="poll-desc"
          value={description}
          onChange={e => setDescription(e.target.value)}
          placeholder="Why does it matter? Anything specific about the behavior you'd want?"
          rows={4}
          maxLength={MAX_DESC + 100}
          className="w-full rounded-md bg-input border border-border px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/70 focus:outline-none focus:ring-2 focus:ring-ring focus:border-transparent resize-y min-h-[88px]"
        />
      </div>

      <div>
        <div className="flex items-baseline justify-between mb-1.5">
          <label htmlFor="poll-email" className="text-xs font-medium text-muted-foreground">Email <span className="text-muted-foreground/60">(optional)</span></label>
          {!emailValid && (
            <span className="text-[10px] text-destructive">Doesn't look like an email</span>
          )}
        </div>
        <Input
          id="poll-email"
          type="email"
          value={email}
          onChange={e => setEmail(e.target.value)}
          placeholder="you@example.com"
          maxLength={MAX_EMAIL}
          autoComplete="email"
        />
        <p className="mt-1.5 text-[11px] leading-relaxed text-muted-foreground/70">
          Only the developer can see your email. Correspondence will come from manafoundrysupport@gmail.com.
        </p>
      </div>

      {inflightError && (
        <p className="text-xs text-destructive">{inflightError}</p>
      )}

      <div className="flex items-center justify-end gap-2 pt-1">
        <Button type="button" variant="ghost" size="sm" onClick={reset} disabled={busy}>Cancel</Button>
        <Button
          type="button"
          size="sm"
          onClick={handleSubmit}
          disabled={!valid || busy}
          className="btn-shimmer"
        >
          {busy ? 'Submitting…' : 'Submit'}
        </Button>
      </div>
    </div>
  );
}
