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

// Append to infra/lambda/poll.ts
// Atomically increment the per-day counter; returns true if allowed, false if rate-limited.
export async function checkRateLimit(anonId: string, action: 'submit' | 'vote'): Promise<boolean> {
  const pk = `${PK_RATELIMIT_PREFIX}${anonId}#${action}`;
  const sk = dayBucketUTC();
  const limit = LIMITS[action];
  try {
    await client.send(new UpdateItemCommand({
      TableName: TABLE_NAME,
      Key: marshall({ pk, sk }),
      UpdateExpression: 'ADD #c :one SET #ttl = if_not_exists(#ttl, :ttl)',
      ConditionExpression: 'attribute_not_exists(#c) OR #c < :limit',
      ExpressionAttributeNames: { '#c': 'count', '#ttl': 'ttl' },
      ExpressionAttributeValues: marshall({
        ':one': 1,
        ':limit': limit,
        ':ttl': endOfUtcDayEpoch(),
      }),
    }));
    return true;
  } catch (e: unknown) {
    if (e && typeof e === 'object' && 'name' in e && (e as { name: string }).name === 'ConditionalCheckFailedException') {
      return false;
    }
    throw e;
  }
}

export async function handleSubmit(body: string | undefined, headers: Record<string, string | undefined> | undefined) {
  const anonId = headers?.['x-anon-id'] || headers?.['X-Anon-Id'];
  if (!isValidUuid(anonId)) return jsonResponse(400, { error: 'bad_anon_id' });

  if (!body) return jsonResponse(400, { error: 'missing_body' });
  let parsed: { title?: unknown; description?: unknown };
  try { parsed = JSON.parse(body); } catch { return jsonResponse(400, { error: 'bad_json' }); }

  const title = typeof parsed.title === 'string' ? parsed.title.trim() : '';
  const description = typeof parsed.description === 'string' ? parsed.description.trim() : '';
  if (title.length < 1 || title.length > MAX_TITLE) return jsonResponse(400, { error: 'bad_title', max: MAX_TITLE });
  if (description.length < 1 || description.length > MAX_DESCRIPTION) return jsonResponse(400, { error: 'bad_description', max: MAX_DESCRIPTION });

  const allowed = await checkRateLimit(anonId, 'submit');
  if (!allowed) return jsonResponse(429, { error: 'rate_limited', action: 'submit', limit: LIMITS.submit });

  const id = randomUUID();
  const createdAt = new Date().toISOString();
  const record: SuggestionRecord = {
    pk: PK_SUGGESTION,
    sk: `${createdAt}#${id}`,
    gsiPk: GSI_PK_ALL,
    id, title, description,
    status: 'open',
    voteCount: 0,
    anonAuthorId: anonId,
    createdAt,
  };
  await client.send(new PutItemCommand({ TableName: TABLE_NAME, Item: marshall(record) }));
  return jsonResponse(200, { suggestion: toPublic(record) });
}
