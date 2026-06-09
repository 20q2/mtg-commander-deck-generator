// src/services/poll/client.ts
import type { Suggestion, ListResponse } from './types';
import { PollApiError } from './types';
import { getOrCreateAnonId } from './anonId';
import { getAdminSecret } from './adminSecret';

const URL = import.meta.env.VITE_ANALYTICS_URL as string | undefined;

function requireUrl(): string {
  if (!URL || !URL.trim()) throw new PollApiError('Poll API not configured', 0, null);
  return URL.trim();
}

async function call(action: string, init: RequestInit & { admin?: boolean } = {}): Promise<unknown> {
  const base = requireUrl();
  const headers: Record<string, string> = { ...(init.headers as Record<string, string> | undefined) };
  if (!headers['X-Anon-Id']) headers['X-Anon-Id'] = getOrCreateAnonId();
  if (init.body && !headers['Content-Type']) headers['Content-Type'] = 'application/json';
  if (init.admin) {
    const s = getAdminSecret();
    if (!s) throw new PollApiError('Admin secret not set', 401, null);
    headers['Authorization'] = `Bearer ${s}`;
  }
  const res = await fetch(`${base}?action=${action}&_t=${Date.now()}`, {
    method: init.method || 'GET',
    headers,
    body: init.body,
    cache: 'no-store',
  });
  const text = await res.text();
  let payload: unknown = null;
  try { payload = text ? JSON.parse(text) : null; } catch { payload = text; }
  if (!res.ok) throw new PollApiError(`Poll API error ${res.status}`, res.status, payload);
  return payload;
}

export async function listSuggestions(): Promise<ListResponse> {
  return (await call('poll-list', { method: 'GET' })) as ListResponse;
}

export async function submitSuggestion(title: string, description: string): Promise<{ suggestion: Suggestion }> {
  return (await call('poll-submit', {
    method: 'POST',
    body: JSON.stringify({ title, description }),
  })) as { suggestion: Suggestion };
}

export async function toggleVote(suggestionId: string, vote: 0 | 1): Promise<{ suggestionId: string; voteCount: number }> {
  return (await call('poll-vote', {
    method: 'POST',
    body: JSON.stringify({ suggestionId, vote }),
  })) as { suggestionId: string; voteCount: number };
}

export async function setDevNote(suggestionId: string, devNote: string): Promise<{ suggestion: Suggestion }> {
  return (await call('poll-devnote', {
    method: 'POST',
    admin: true,
    body: JSON.stringify({ suggestionId, devNote }),
  })) as { suggestion: Suggestion };
}

export async function markShipped(suggestionId: string, shippedVersion: string): Promise<{ suggestion: Suggestion }> {
  return (await call('poll-ship', {
    method: 'POST',
    admin: true,
    body: JSON.stringify({ suggestionId, shippedVersion }),
  })) as { suggestion: Suggestion };
}

export async function deleteSuggestion(suggestionId: string): Promise<{ ok: true }> {
  return (await call('poll-delete', {
    method: 'POST',
    admin: true,
    body: JSON.stringify({ suggestionId }),
  })) as { ok: true };
}
