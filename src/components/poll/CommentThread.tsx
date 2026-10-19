// src/components/poll/CommentThread.tsx
import { useState, useCallback } from 'react';
import { MessageCircle, ChevronDown, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { PollComment, Suggestion } from '@/services/poll/types';
import { PollApiError } from '@/services/poll/types';
import { listComments, postComment, deleteComment } from '@/services/poll/client';
import { relativeTime } from './relativeTime';

const MAX_COMMENT = 600;

interface Props {
  suggestion: Suggestion;
  /** Viewing from /admin — posts carry the Dev badge and each reply gets a delete button. */
  admin?: boolean;
  /** Fired with the authoritative count after a post or delete. */
  onCountChange: (count: number) => void;
}

function Badge({ children, tone }: { children: string; tone: 'dev' | 'op' | 'you' }) {
  const toneClass = {
    dev: 'bg-primary/20 text-violet-300/90',
    op: 'bg-[hsl(var(--success)/0.15)] text-[hsl(142_71%_65%)]',
    you: 'bg-white/[0.08] text-foreground/70',
  }[tone];
  return (
    <span className={`px-1.5 py-[1px] rounded-full text-[10px] font-semibold uppercase tracking-wide ${toneClass}`}>
      {children}
    </span>
  );
}

export function CommentThread({ suggestion, admin, onCountChange }: Props) {
  const [open, setOpen] = useState(false);
  const [comments, setComments] = useState<PollComment[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [postError, setPostError] = useState<string | null>(null);

  const count = suggestion.commentCount ?? 0;

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await listComments(suggestion.id);
      setComments(res.comments);
      onCountChange(res.comments.length);
    } catch {
      setLoadError("Couldn't load replies.");
    } finally {
      setLoading(false);
    }
  }, [suggestion.id, onCountChange]);

  const toggle = () => {
    const next = !open;
    setOpen(next);
    if (next && comments === null && !loading) load();
  };

  const text = draft.trim();
  const canPost = text.length > 0 && text.length <= MAX_COMMENT && !busy;

  const submit = async () => {
    if (!canPost) return;
    setBusy(true);
    setPostError(null);
    try {
      const res = await postComment(suggestion.id, text, { admin });
      setComments(prev => [...(prev || []), res.comment]);
      onCountChange(res.commentCount);
      setDraft('');
    } catch (e) {
      if (e instanceof PollApiError) {
        const payload = e.payload as { error?: string; limit?: number } | null;
        if (payload?.error === 'rate_limited') {
          setPostError(`You've posted ${payload.limit} replies today — please come back tomorrow.`);
        } else if (payload?.error === 'not_found') {
          setPostError('That suggestion is gone.');
        } else {
          setPostError(`Reply failed (${e.status})`);
        }
      } else {
        setPostError('Reply failed.');
      }
    } finally {
      setBusy(false);
    }
  };

  const remove = async (commentId: string) => {
    if (!window.confirm('Delete this reply?')) return;
    setBusy(true);
    try {
      const res = await deleteComment(suggestion.id, commentId);
      setComments(prev => (prev || []).filter(c => c.id !== commentId));
      onCountChange(res.commentCount);
    } catch {
      setPostError('Delete failed.');
    } finally {
      setBusy(false);
    }
  };

  const handleKey: React.KeyboardEventHandler = (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      submit();
    }
  };

  return (
    <div className="mt-2.5">
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        className="inline-flex items-center gap-1.5 text-[12px] text-muted-foreground hover:text-foreground transition-colors rounded-md px-1.5 py-1 -ml-1.5 hover:bg-accent/40"
      >
        <MessageCircle className="w-3.5 h-3.5" />
        {count === 0 ? 'Reply' : count === 1 ? '1 reply' : `${count} replies`}
        <ChevronDown className={`w-3 h-3 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="mt-2.5 pl-3 border-l-2 border-border/50 space-y-2.5">
          {loading && (
            <p className="text-[12px] text-muted-foreground">Loading replies…</p>
          )}

          {loadError && (
            <p className="text-[12px] text-destructive">
              {loadError}{' '}
              <button type="button" onClick={load} className="underline hover:text-foreground">Retry</button>
            </p>
          )}

          {comments?.map(c => (
            <div key={c.id} className="group">
              <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground/80 mb-0.5">
                {c.isDev && <Badge tone="dev">Dev</Badge>}
                {c.isAuthor && <Badge tone="op">OP</Badge>}
                {c.isMine && !c.isDev && <Badge tone="you">You</Badge>}
                {!c.isDev && !c.isAuthor && !c.isMine && <span>Anonymous</span>}
                <span className="opacity-40">·</span>
                <span>{relativeTime(c.createdAt)}</span>
                {admin && (
                  <button
                    type="button"
                    onClick={() => remove(c.id)}
                    disabled={busy}
                    aria-label="Delete reply"
                    className="ml-1 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity text-destructive hover:text-destructive/80 disabled:opacity-40"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                )}
              </div>
              <p
                className={[
                  'text-[12.5px] leading-relaxed whitespace-pre-wrap',
                  c.isDev ? 'text-foreground/90' : 'text-muted-foreground',
                ].join(' ')}
              >
                {c.body}
              </p>
            </div>
          ))}

          {comments !== null && comments.length === 0 && !loading && (
            <p className="text-[12px] text-muted-foreground/70">
              No replies yet. {admin ? 'Say something.' : 'Add context, or ask the dev a question.'}
            </p>
          )}

          <div className="pt-0.5">
            <textarea
              value={draft}
              onChange={e => setDraft(e.target.value)}
              onKeyDown={handleKey}
              rows={2}
              maxLength={MAX_COMMENT + 100}
              placeholder={admin ? 'Reply as the dev…' : 'Reply…'}
              className="w-full rounded-md bg-input border border-border px-2.5 py-1.5 text-[12.5px] text-foreground placeholder:text-muted-foreground/70 focus:outline-none focus:ring-2 focus:ring-ring focus:border-transparent resize-y min-h-[52px]"
            />
            <div className="flex items-center justify-between gap-2 mt-1.5">
              <span className="text-[11px] text-muted-foreground/70">
                {postError ? (
                  <span className="text-destructive">{postError}</span>
                ) : draft.length > MAX_COMMENT * 0.8 ? (
                  <span className={draft.length > MAX_COMMENT ? 'text-destructive tabular-nums' : 'tabular-nums'}>
                    {draft.length}/{MAX_COMMENT}
                  </span>
                ) : (
                  'Replies are anonymous.'
                )}
              </span>
              <Button type="button" size="sm" onClick={submit} disabled={!canPost}>
                {busy ? 'Posting…' : 'Post reply'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
