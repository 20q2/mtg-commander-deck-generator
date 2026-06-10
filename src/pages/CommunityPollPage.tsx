// src/pages/CommunityPollPage.tsx
import { useEffect, useState, useCallback } from 'react';
import type { Suggestion } from '@/services/poll/types';
import { PollApiError } from '@/services/poll/types';
import {
  listSuggestions, submitSuggestion, toggleVote,
  setDevNote, markShipped, deleteSuggestion,
} from '@/services/poll/client';
import { getLocalVotes, markVotedLocal, unmarkVotedLocal, setLocalVotes } from '@/services/poll/votes';
import { getAdminSecret } from '@/services/poll/adminSecret';
import { PollHero } from '@/components/poll/PollHero';
import { ComposeRow } from '@/components/poll/ComposeRow';
import { SuggestionList, type Tab } from '@/components/poll/SuggestionList';
import { AdminPasswordPrompt } from '@/components/poll/AdminPasswordPrompt';
import { AdminControls } from '@/components/poll/AdminControls';

interface Props {
  admin?: boolean;
}

export function CommunityPollPage({ admin = false }: Props) {
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [myVotes, setMyVotes] = useState<Set<string>>(() => getLocalVotes());
  const [tab, setTab] = useState<Tab>('top');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [composeError, setComposeError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [voteDisabled, setVoteDisabled] = useState(false);
  const [adminReady, setAdminReady] = useState<boolean>(() => !admin || !!getAdminSecret());

  const refresh = useCallback(async () => {
    try {
      setError(null);
      const res = await listSuggestions();
      setSuggestions(res.suggestions);
      setMyVotes(new Set(res.myVotes));
      setLocalVotes(res.myVotes);
    } catch (e) {
      setError(e instanceof PollApiError ? `Couldn't load suggestions (${e.status})` : "Couldn't load suggestions");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { if (adminReady) refresh(); }, [refresh, adminReady]);

  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(null), 2500);
    return () => clearTimeout(id);
  }, [toast]);

  const onSubmit = async (title: string, description: string) => {
    setComposeError(null);
    try {
      const { suggestion } = await submitSuggestion(title, description);
      setSuggestions(prev => [suggestion, ...prev]);
      setTab('new');
      setToast('Thanks — your suggestion is up.');
    } catch (e) {
      if (e instanceof PollApiError) {
        const payload = e.payload as { error?: string; limit?: number } | null;
        if (payload?.error === 'rate_limited') {
          setComposeError(`You've submitted ${payload.limit} suggestions today — please come back tomorrow.`);
          throw e;
        }
        setComposeError(`Submit failed (${e.status})`);
      } else {
        setComposeError('Submit failed');
      }
      throw e;
    }
  };

  const onToggle = async (id: string) => {
    const currentlyVoted = myVotes.has(id);
    const targetVoted = !currentlyVoted;
    // Optimistic update
    setMyVotes(prev => {
      const next = new Set(prev);
      if (targetVoted) next.add(id); else next.delete(id);
      return next;
    });
    setSuggestions(prev => prev.map(s => s.id === id
      ? { ...s, voteCount: s.voteCount + (targetVoted ? 1 : -1) }
      : s));
    if (targetVoted) markVotedLocal(id); else unmarkVotedLocal(id);
    try {
      const res = await toggleVote(id, targetVoted ? 1 : 0);
      setSuggestions(prev => prev.map(s => s.id === id ? { ...s, voteCount: res.voteCount } : s));
    } catch (e) {
      // Revert
      setMyVotes(prev => {
        const next = new Set(prev);
        if (currentlyVoted) next.add(id); else next.delete(id);
        return next;
      });
      setSuggestions(prev => prev.map(s => s.id === id
        ? { ...s, voteCount: s.voteCount + (targetVoted ? -1 : 1) }
        : s));
      if (currentlyVoted) markVotedLocal(id); else unmarkVotedLocal(id);
      if (e instanceof PollApiError && (e.payload as { error?: string } | null)?.error === 'rate_limited') {
        setVoteDisabled(true);
        setToast('Slow down — too many votes today.');
        setTimeout(() => setVoteDisabled(false), 4000);
      } else {
        setToast('Vote failed.');
      }
    }
  };

  if (admin && !adminReady) {
    return (
      <main className="flex-1 container mx-auto px-4 py-6 relative">
        <div className="aurora-bg" />
        <div className="relative z-10">
          <AdminPasswordPrompt onAuthed={() => setAdminReady(true)} />
        </div>
      </main>
    );
  }

  return (
    <main className="flex-1 container mx-auto px-4 py-6 relative">
      <div className="aurora-bg" />
      <div className="relative z-10 max-w-3xl mx-auto pb-12">
        <PollHero />
        <div className="mb-4">
          <ComposeRow onSubmit={onSubmit} inflightError={composeError} />
        </div>

        {loading ? (
          <div className="glass rounded-2xl p-10 text-center text-muted-foreground">Loading…</div>
        ) : error ? (
          <div className="glass rounded-2xl p-6 text-center">
            <p className="text-sm text-muted-foreground mb-3">{error}</p>
            <button
              onClick={() => { setLoading(true); refresh(); }}
              className="text-sm text-violet-300/90 hover:text-violet-200 underline"
            >Retry</button>
          </div>
        ) : (
          <SuggestionList
            suggestions={suggestions}
            myVotes={myVotes}
            tab={tab}
            onTabChange={setTab}
            onToggleVote={onToggle}
            voteDisabled={voteDisabled}
            renderAdminControls={admin ? (s) => (
              <AdminControls
                suggestion={s}
                onSetDevNote={async (note) => {
                  const res = await setDevNote(s.id, note);
                  setSuggestions(prev => prev.map(x => x.id === s.id ? res.suggestion : x));
                }}
                onMarkShipped={async (v) => {
                  const res = await markShipped(s.id, v);
                  setSuggestions(prev => prev.map(x => x.id === s.id ? res.suggestion : x));
                }}
                onDelete={async () => {
                  await deleteSuggestion(s.id);
                  setSuggestions(prev => prev.filter(x => x.id !== s.id));
                }}
              />
            ) : undefined}
          />
        )}

        {toast && (
          <div className="fixed top-6 right-6 z-50 animate-slide-in-right">
            <div className="glass rounded-xl px-4 py-2.5 text-sm text-foreground shadow-lg">
              {toast}
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
