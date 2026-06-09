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

export async function handleList(headers: Record<string, string | undefined> | undefined) {
  const anonId = headers?.['x-anon-id'] || headers?.['X-Anon-Id'];

  // 1. Fetch every suggestion (newest first). Expected list size ≤ 500 even years out — single query is fine.
  const suggestions: SuggestionRecord[] = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let exclusiveStartKey: Record<string, any> | undefined;
  do {
    const res = await client.send(new QueryCommand({
      TableName: TABLE_NAME,
      KeyConditionExpression: 'pk = :pk',
      ExpressionAttributeValues: marshall({ ':pk': PK_SUGGESTION }),
      ScanIndexForward: false,
      ExclusiveStartKey: exclusiveStartKey,
    }));
    for (const raw of res.Items || []) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      suggestions.push(unmarshall(raw as any) as SuggestionRecord);
    }
    exclusiveStartKey = res.LastEvaluatedKey;
  } while (exclusiveStartKey);

  // 2. If anonId provided + valid, look up which suggestions they've voted on.
  let myVotes: string[] = [];
  if (isValidUuid(anonId) && suggestions.length > 0) {
    // BatchGet up to 100 at a time. Simpler than per-row GetItem and avoids N round-trips.
    const { BatchGetItemCommand } = await import('@aws-sdk/client-dynamodb');
    const keys = suggestions.map(s => marshall({ pk: `${PK_VOTE_PREFIX}${s.id}`, sk: anonId }));
    for (let i = 0; i < keys.length; i += 100) {
      const batch = keys.slice(i, i + 100);
      const res = await client.send(new BatchGetItemCommand({
        RequestItems: { [TABLE_NAME]: { Keys: batch, ProjectionExpression: 'pk' } },
      }));
      const items = res.Responses?.[TABLE_NAME] || [];
      for (const raw of items) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const u = unmarshall(raw as any) as { pk: string };
        myVotes.push(u.pk.slice(PK_VOTE_PREFIX.length));
      }
    }
  }

  return jsonResponse(200, {
    suggestions: suggestions.map(toPublic),
    myVotes,
  });
}

export async function handleVote(body: string | undefined, headers: Record<string, string | undefined> | undefined) {
  const anonId = headers?.['x-anon-id'] || headers?.['X-Anon-Id'];
  if (!isValidUuid(anonId)) return jsonResponse(400, { error: 'bad_anon_id' });

  if (!body) return jsonResponse(400, { error: 'missing_body' });
  let parsed: { suggestionId?: unknown; vote?: unknown };
  try { parsed = JSON.parse(body); } catch { return jsonResponse(400, { error: 'bad_json' }); }
  const suggestionId = typeof parsed.suggestionId === 'string' ? parsed.suggestionId : '';
  if (!suggestionId) return jsonResponse(400, { error: 'bad_suggestion_id' });
  if (parsed.vote !== 0 && parsed.vote !== 1) return jsonResponse(400, { error: 'bad_vote' });
  const targetVoted = parsed.vote === 1;

  // Look up suggestion + current vote state in parallel.
  const votePk = `${PK_VOTE_PREFIX}${suggestionId}`;
  const [suggestionRes, voteRes] = await Promise.all([
    // Suggestion lives under (pk=POLL#SUGGESTION, sk=<isoCreatedAt>#<id>). We don't know sk, so query by GSI...
    // ...except we can avoid the lookup entirely: the UpdateItem below uses a ConditionExpression to fail loudly if missing.
    Promise.resolve(null),
    client.send(new GetItemCommand({ TableName: TABLE_NAME, Key: marshall({ pk: votePk, sk: anonId }) })),
  ]);
  void suggestionRes;
  const alreadyVoted = !!voteRes.Item;

  if (alreadyVoted === targetVoted) {
    // No-op — return current count by querying the suggestion.
    const cur = await getSuggestionById(suggestionId);
    if (!cur) return jsonResponse(404, { error: 'not_found' });
    return jsonResponse(200, { suggestionId, voteCount: cur.voteCount });
  }

  // Rate-limit before mutating.
  const allowed = await checkRateLimit(anonId, 'vote');
  if (!allowed) return jsonResponse(429, { error: 'rate_limited', action: 'vote', limit: LIMITS.vote });

  // Find the suggestion's sk so we can UpdateItem on it.
  const suggestion = await getSuggestionById(suggestionId);
  if (!suggestion) return jsonResponse(404, { error: 'not_found' });

  if (targetVoted) {
    await client.send(new PutItemCommand({
      TableName: TABLE_NAME,
      Item: marshall({ pk: votePk, sk: anonId, votedAt: new Date().toISOString() }),
    }));
  } else {
    await client.send(new DeleteItemCommand({
      TableName: TABLE_NAME,
      Key: marshall({ pk: votePk, sk: anonId }),
    }));
  }

  const delta = targetVoted ? 1 : -1;
  const update = await client.send(new UpdateItemCommand({
    TableName: TABLE_NAME,
    Key: marshall({ pk: PK_SUGGESTION, sk: suggestion.sk }),
    UpdateExpression: 'ADD voteCount :d',
    ExpressionAttributeValues: marshall({ ':d': delta }),
    ReturnValues: 'UPDATED_NEW',
  }));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const newCount = Number((unmarshall(update.Attributes as any) as { voteCount: number }).voteCount);
  return jsonResponse(200, { suggestionId, voteCount: newCount });
}

// Helper used by handleVote + admin handlers — looks up a suggestion by its id.
// We don't know the sk (it contains createdAt), so we scan the partition for the matching id.
// Small list (≤500), single partition — this is cheap.
export async function getSuggestionById(id: string): Promise<SuggestionRecord | null> {
  const res = await client.send(new QueryCommand({
    TableName: TABLE_NAME,
    KeyConditionExpression: 'pk = :pk',
    FilterExpression: 'id = :id',
    ExpressionAttributeValues: marshall({ ':pk': PK_SUGGESTION, ':id': id }),
    Limit: 1,
  }));
  if (!res.Items || res.Items.length === 0) return null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return unmarshall(res.Items[0] as any) as SuggestionRecord;
}

export async function handleDevNote(body: string | undefined, headers: Record<string, string | undefined> | undefined) {
  if (!isAdmin(headers)) return jsonResponse(401, { error: 'unauthorized' });
  if (!body) return jsonResponse(400, { error: 'missing_body' });
  let parsed: { suggestionId?: unknown; devNote?: unknown };
  try { parsed = JSON.parse(body); } catch { return jsonResponse(400, { error: 'bad_json' }); }
  const suggestionId = typeof parsed.suggestionId === 'string' ? parsed.suggestionId : '';
  const devNote = typeof parsed.devNote === 'string' ? parsed.devNote.trim() : '';
  if (!suggestionId) return jsonResponse(400, { error: 'bad_suggestion_id' });
  if (devNote.length > MAX_DEVNOTE) return jsonResponse(400, { error: 'bad_devnote', max: MAX_DEVNOTE });

  const suggestion = await getSuggestionById(suggestionId);
  if (!suggestion) return jsonResponse(404, { error: 'not_found' });

  if (devNote.length === 0) {
    await client.send(new UpdateItemCommand({
      TableName: TABLE_NAME,
      Key: marshall({ pk: PK_SUGGESTION, sk: suggestion.sk }),
      UpdateExpression: 'REMOVE devNote',
    }));
    return jsonResponse(200, { suggestion: toPublic({ ...suggestion, devNote: undefined }) });
  }
  await client.send(new UpdateItemCommand({
    TableName: TABLE_NAME,
    Key: marshall({ pk: PK_SUGGESTION, sk: suggestion.sk }),
    UpdateExpression: 'SET devNote = :n',
    ExpressionAttributeValues: marshall({ ':n': devNote }),
  }));
  return jsonResponse(200, { suggestion: toPublic({ ...suggestion, devNote }) });
}

export async function handleShip(body: string | undefined, headers: Record<string, string | undefined> | undefined) {
  if (!isAdmin(headers)) return jsonResponse(401, { error: 'unauthorized' });
  if (!body) return jsonResponse(400, { error: 'missing_body' });
  let parsed: { suggestionId?: unknown; shippedVersion?: unknown };
  try { parsed = JSON.parse(body); } catch { return jsonResponse(400, { error: 'bad_json' }); }
  const suggestionId = typeof parsed.suggestionId === 'string' ? parsed.suggestionId : '';
  const shippedVersion = typeof parsed.shippedVersion === 'string' ? parsed.shippedVersion.trim() : '';
  if (!suggestionId) return jsonResponse(400, { error: 'bad_suggestion_id' });
  if (!shippedVersion) return jsonResponse(400, { error: 'bad_shipped_version' });

  const suggestion = await getSuggestionById(suggestionId);
  if (!suggestion) return jsonResponse(404, { error: 'not_found' });
  const shippedAt = new Date().toISOString();

  await client.send(new UpdateItemCommand({
    TableName: TABLE_NAME,
    Key: marshall({ pk: PK_SUGGESTION, sk: suggestion.sk }),
    UpdateExpression: 'SET #s = :s, shippedVersion = :v, shippedAt = :a',
    ExpressionAttributeNames: { '#s': 'status' },
    ExpressionAttributeValues: marshall({ ':s': 'shipped', ':v': shippedVersion, ':a': shippedAt }),
  }));
  return jsonResponse(200, { suggestion: toPublic({ ...suggestion, status: 'shipped', shippedVersion, shippedAt }) });
}

export async function handleDelete(body: string | undefined, headers: Record<string, string | undefined> | undefined) {
  if (!isAdmin(headers)) return jsonResponse(401, { error: 'unauthorized' });
  if (!body) return jsonResponse(400, { error: 'missing_body' });
  let parsed: { suggestionId?: unknown };
  try { parsed = JSON.parse(body); } catch { return jsonResponse(400, { error: 'bad_json' }); }
  const suggestionId = typeof parsed.suggestionId === 'string' ? parsed.suggestionId : '';
  if (!suggestionId) return jsonResponse(400, { error: 'bad_suggestion_id' });

  const suggestion = await getSuggestionById(suggestionId);
  if (!suggestion) return jsonResponse(200, { ok: true }); // already gone

  // Delete the suggestion itself.
  await client.send(new DeleteItemCommand({
    TableName: TABLE_NAME,
    Key: marshall({ pk: PK_SUGGESTION, sk: suggestion.sk }),
  }));

  // Delete all vote rows for that suggestion (query + batched delete).
  const votePk = `${PK_VOTE_PREFIX}${suggestionId}`;
  const { BatchWriteItemCommand } = await import('@aws-sdk/client-dynamodb');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let startKey: Record<string, any> | undefined;
  do {
    const res = await client.send(new QueryCommand({
      TableName: TABLE_NAME,
      KeyConditionExpression: 'pk = :pk',
      ExpressionAttributeValues: marshall({ ':pk': votePk }),
      ProjectionExpression: 'sk',
      ExclusiveStartKey: startKey,
    }));
    const items = res.Items || [];
    for (let i = 0; i < items.length; i += 25) {
      const batch = items.slice(i, i + 25).map(raw => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { sk } = unmarshall(raw as any) as { sk: string };
        return { DeleteRequest: { Key: marshall({ pk: votePk, sk }) } };
      });
      if (batch.length > 0) {
        await client.send(new BatchWriteItemCommand({ RequestItems: { [TABLE_NAME]: batch } }));
      }
    }
    startKey = res.LastEvaluatedKey;
  } while (startKey);

  return jsonResponse(200, { ok: true });
}
