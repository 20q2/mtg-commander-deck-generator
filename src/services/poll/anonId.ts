// src/services/poll/anonId.ts
const KEY = 'manafoundry-anon-id';

export function getOrCreateAnonId(): string {
  try {
    let id = localStorage.getItem(KEY);
    if (!id) {
      id = crypto.randomUUID();
      localStorage.setItem(KEY, id);
    }
    return id;
  } catch {
    // localStorage unavailable — generate a per-session id so the page still works.
    return crypto.randomUUID();
  }
}
