import { DynamoDBClient, BatchWriteItemCommand, QueryCommand } from '@aws-sdk/client-dynamodb';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';
import { randomUUID } from 'crypto';

const client = new DynamoDBClient({});
const TABLE_NAME = process.env.TABLE_NAME!;

interface AnalyticsEvent {
  event: string;
  timestamp: string;
  metadata?: Record<string, unknown>;
}

export async function handler(event: {
  requestContext: { http: { method: string } };
  queryStringParameters?: Record<string, string>;
  headers?: Record<string, string>;
  body?: string;
}) {
  const method = event.requestContext.http.method;

  if (method === 'POST') {
    return handlePost(event.body);
  }
  if (method === 'GET') {
    const secret = process.env.METRICS_SECRET;
    if (secret) {
      const auth = event.headers?.authorization || event.headers?.Authorization || '';
      if (auth !== `Bearer ${secret}`) {
        return { statusCode: 401, body: JSON.stringify({ error: 'Unauthorized' }) };
      }
    }
    return handleGet(event.queryStringParameters || {});
  }

  return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
}

async function handlePost(body?: string) {
  if (!body) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Missing body' }) };
  }

  const parsed = JSON.parse(body);
  const events: AnalyticsEvent[] = Array.isArray(parsed.events) ? parsed.events : [parsed];

  const items = events.map((e) => ({
    PutRequest: {
      Item: marshall({
        pk: e.event,
        sk: `${e.timestamp}#${randomUUID().slice(0, 8)}`,
        gsiPk: 'ALL',
        event: e.event,
        timestamp: e.timestamp,
        metadata: e.metadata || {},
        ttl: Math.floor(Date.now() / 1000) + 90 * 24 * 60 * 60, // 90-day TTL
      }),
    },
  }));

  // DynamoDB BatchWriteItem supports max 25 items per batch
  for (let i = 0; i < items.length; i += 25) {
    const batch = items.slice(i, i + 25);
    await client.send(
      new BatchWriteItemCommand({
        RequestItems: { [TABLE_NAME]: batch },
      })
    );
  }

  return { statusCode: 200, body: JSON.stringify({ ingested: events.length }) };
}

async function handleGet(params: Record<string, string>) {
  const action = params.action || 'summary';
  const from = params.from || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const to = params.to || new Date().toISOString();

  if (action === 'summary') {
    const result = await client.send(
      new QueryCommand({
        TableName: TABLE_NAME,
        IndexName: 'gsi-all-by-date',
        KeyConditionExpression: 'gsiPk = :pk AND sk BETWEEN :from AND :to',
        ExpressionAttributeValues: marshall({
          ':pk': 'ALL',
          ':from': from,
          ':to': to + '\uffff',
        }),
      })
    );

    const items = (result.Items || []).map((item) => unmarshall(item));

    const eventCounts: Record<string, number> = {};
    const commanderCounts: Record<string, number> = {};
    const archetypeCounts: Record<string, number> = {};
    const dailyCounts: Record<string, number> = {};
    const uniqueUsers = new Set<string>();
    const regionCounts: Record<string, number> = {};
    const featureAdoption = {
      collectionMode: 0,
      hyperFocus: 0,
      tinyLeaders: 0,
      hasPriceLimit: 0,
      hasBudgetLimit: 0,
      hasMusts: 0,
      hasBans: 0,
      deckCount: 0,
    };
    const settingsCounts: Record<string, Record<string, number>> = {
      budgetOption: {},
      bracketLevel: {},
      maxRarity: {},
      gameChangerLimit: {},
    };

    for (const item of items) {
      // Event type counts
      eventCounts[item.event] = (eventCounts[item.event] || 0) + 1;

      // Daily counts
      const day = item.timestamp?.slice(0, 10);
      if (day) dailyCounts[day] = (dailyCounts[day] || 0) + 1;

      const meta = item.metadata as Record<string, unknown> | undefined;

      // Unique users
      if (meta?.userId && typeof meta.userId === 'string') {
        uniqueUsers.add(meta.userId);
      }

      // Region
      if (meta?.region && typeof meta.region === 'string') {
        regionCounts[meta.region] = (regionCounts[meta.region] || 0) + 1;
      }

      // Commander popularity
      if (meta?.commanderName && typeof meta.commanderName === 'string') {
        commanderCounts[meta.commanderName] = (commanderCounts[meta.commanderName] || 0) + 1;
      }

      // Archetype distribution (from deck_generated events only)
      if (item.event === 'deck_generated' && meta?.archetype && typeof meta.archetype === 'string') {
        archetypeCounts[meta.archetype] = (archetypeCounts[meta.archetype] || 0) + 1;

        // Feature adoption
        featureAdoption.deckCount++;
        if (meta.collectionMode === true) featureAdoption.collectionMode++;
        if (meta.hyperFocus === true) featureAdoption.hyperFocus++;
        if (meta.tinyLeaders === true) featureAdoption.tinyLeaders++;
        if (meta.maxCardPrice !== null && meta.maxCardPrice !== undefined) featureAdoption.hasPriceLimit++;
        if (meta.deckBudget !== null && meta.deckBudget !== undefined) featureAdoption.hasBudgetLimit++;
        if (typeof meta.mustIncludeCount === 'number' && meta.mustIncludeCount > 0) featureAdoption.hasMusts++;
        if (typeof meta.bannedCount === 'number' && meta.bannedCount > 0) featureAdoption.hasBans++;

        // Settings distributions
        const bucket = (key: string, val: unknown) => {
          const s = String(val ?? 'unknown');
          settingsCounts[key][s] = (settingsCounts[key][s] || 0) + 1;
        };
        if (meta.budgetOption !== undefined) bucket('budgetOption', meta.budgetOption);
        if (meta.bracketLevel !== undefined) bucket('bracketLevel', meta.bracketLevel);
        bucket('maxRarity', meta.maxRarity ?? 'none');
        if (meta.gameChangerLimit !== undefined) bucket('gameChangerLimit', meta.gameChangerLimit);
      }
    }

    return {
      statusCode: 200,
      body: JSON.stringify({
        totalEvents: items.length,
        uniqueUserCount: uniqueUsers.size,
        eventCounts,
        commanderCounts,
        archetypeCounts,
        dailyCounts,
        regionCounts,
        featureAdoption,
        settingsCounts,
        dateRange: { from, to },
      }),
    };
  }

  // Fetch raw events for a specific event type
  if (action === 'events' && params.eventType) {
    const result = await client.send(
      new QueryCommand({
        TableName: TABLE_NAME,
        KeyConditionExpression: 'pk = :pk AND sk BETWEEN :from AND :to',
        ExpressionAttributeValues: marshall({
          ':pk': params.eventType,
          ':from': from,
          ':to': to + '\uffff',
        }),
        ScanIndexForward: false,
        Limit: 100,
      })
    );

    const items = (result.Items || []).map((item) => unmarshall(item));
    return {
      statusCode: 200,
      body: JSON.stringify({ events: items }),
    };
  }

  return { statusCode: 400, body: JSON.stringify({ error: 'Unknown action' }) };
}
