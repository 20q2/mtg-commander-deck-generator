// src/services/poll/adminSecret.ts
const KEY = 'manafoundry-poll-admin';

export function getAdminSecret(): string | null {
  try { return sessionStorage.getItem(KEY); } catch { return null; }
}

export function setAdminSecret(secret: string): void {
  try { sessionStorage.setItem(KEY, secret); } catch { /* ignore */ }
}

export function clearAdminSecret(): void {
  try { sessionStorage.removeItem(KEY); } catch { /* ignore */ }
}
