// src/services/poll/votes.ts
const KEY = 'manafoundry-poll-votes';

function read(): Set<string> {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return new Set();
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? new Set(arr) : new Set();
  } catch {
    return new Set();
  }
}

function write(set: Set<string>): void {
  try { localStorage.setItem(KEY, JSON.stringify([...set])); } catch { /* ignore */ }
}

export function getLocalVotes(): Set<string> { return read(); }
export function markVotedLocal(id: string): void { const s = read(); s.add(id); write(s); }
export function unmarkVotedLocal(id: string): void { const s = read(); s.delete(id); write(s); }
export function setLocalVotes(ids: string[]): void { write(new Set(ids)); }
