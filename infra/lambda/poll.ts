// infra/lambda/poll.ts
import { DynamoDBClient, GetItemCommand, PutItemCommand, UpdateItemCommand, DeleteItemCommand, QueryCommand } from '@aws-sdk/client-dynamodb';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';
import { randomUUID } from 'crypto';

const client = new DynamoDBClient({});
const TABLE_NAME = process.env.TABLE_NAME!;
const ADMIN_SECRET = process.env.POLL_ADMIN_SECRET || '';

export const PK_SUGGESTION = 'POLL#SUGGESTION';
export const GSI_PK_ALL = 'POLL#ALL';
const PK_VOTE_PREFIX = 'POLL#VOTE#';
const PK_RATELIMIT_PREFIX = 'POLL#RL#';

export const LIMITS = {
  submit: 3,   // suggestions per anonId per UTC day
  vote:   60,  // vote toggles per anonId per UTC day
} as const;

export const MAX_TITLE = 80;
export const MAX_DESCRIPTION = 600;
export const MAX_DEVNOTE = 600;

export type SuggestionStatus = 'open' | 'shipped';

export interface SuggestionRecord {
  pk: string;            // PK_SUGGESTION
  sk: string;            // `${isoCreatedAt}#${id}`
  gsiPk: string;         // GSI_PK_ALL
  id: string;
  title: string;
  description: string;
  status: SuggestionStatus;
  voteCount: number;
  devNote?: string;
  shippedVersion?: string;
  shippedAt?: string;
  anonAuthorId: string;
  createdAt: string;     // ISO
}

export interface PublicSuggestion {
  id: string;
  title: string;
  description: string;
  status: SuggestionStatus;
  voteCount: number;
  devNote?: string;
  shippedVersion?: string;
  shippedAt?: string;
  createdAt: string;
}

export function toPublic(r: SuggestionRecord): PublicSuggestion {
  return {
    id: r.id,
    title: r.title,
    description: r.description,
    status: r.status,
    voteCount: r.voteCount,
    devNote: r.devNote,
    shippedVersion: r.shippedVersion,
    shippedAt: r.shippedAt,
    createdAt: r.createdAt,
  };
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function isValidUuid(v: string | undefined | null): v is string {
  return !!v && UUID_RE.test(v);
}

export function dayBucketUTC(d = new Date()): string {
  return d.toISOString().slice(0, 10); // YYYY-MM-DD
}

export function endOfUtcDayEpoch(d = new Date()): number {
  const end = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1, 0, 0, 0));
  return Math.floor(end.getTime() / 1000);
}

export function jsonResponse(statusCode: number, body: unknown) {
  return { statusCode, body: JSON.stringify(body) };
}

// Constant-time comparison for the admin bearer.
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export function isAdmin(headers: Record<string, string | undefined> | undefined): boolean {
  if (!ADMIN_SECRET) return false;
  const auth = headers?.authorization || headers?.Authorization || '';
  if (!auth.startsWith('Bearer ')) return false;
  return safeEqual(auth.slice(7), ADMIN_SECRET);
}

// Exports referenced by handlers added in later tasks
export { client, TABLE_NAME, PK_VOTE_PREFIX, PK_RATELIMIT_PREFIX, randomUUID, GetItemCommand, PutItemCommand, UpdateItemCommand, DeleteItemCommand, QueryCommand, marshall, unmarshall };
