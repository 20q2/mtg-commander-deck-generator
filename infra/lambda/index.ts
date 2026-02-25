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
    // Paginate through all results — DynamoDB returns max 1MB per query
    const allRawItems: Record<string, unknown>[] = [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let exclusiveStartKey: Record<string, any> | undefined;
    do {
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
          ExclusiveStartKey: exclusiveStartKey,
        })
      );
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      allRawItems.push(...(result.Items || []).map((item: any) => unmarshall(item)));
      exclusiveStartKey = result.LastEvaluatedKey;
    } while (exclusiveStartKey);

    const items = allRawItems;

    const eventCounts: Record<string, number> = {};
    const commanderCounts: Record<string, number> = {};
    const themeCounts: Record<string, number> = {};
    const dailyCounts: Record<string, number> = {};
    const dailyBreakdown: Record<string, Record<string, number>> = {};
    const dailyUserSets: Record<string, Set<string>> = {};
    const hourlyCounts: Record<string, number> = {};
    const hourlyBreakdown: Record<string, Record<string, number>> = {};
    const hourlyUserSets: Record<string, Set<string>> = {};
    const uniqueUsers = new Set<string>();
    const newUsers = new Set<string>();
    const returningUsers = new Set<string>();
    const fromDay = from.slice(0, 10); // "YYYY-MM-DD" for firstSeen comparison
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
      deckFormat: {},
      comboPreference: {},
      deckBudget: {},
      maxCardPrice: {},
      landCount: {},
    };

    for (const item of items) {
      // Event type counts
      eventCounts[item.event] = (eventCounts[item.event] || 0) + 1;

      // Daily counts
      const day = item.timestamp?.slice(0, 10);
      if (day) {
        dailyCounts[day] = (dailyCounts[day] || 0) + 1;
        if (!dailyBreakdown[day]) dailyBreakdown[day] = {};
        dailyBreakdown[day][item.event] = (dailyBreakdown[day][item.event] || 0) + 1;
      }

      // Hourly counts
      const hour = item.timestamp?.slice(0, 13); // "YYYY-MM-DDTHH"
      if (hour) {
        hourlyCounts[hour] = (hourlyCounts[hour] || 0) + 1;
        if (!hourlyBreakdown[hour]) hourlyBreakdown[hour] = {};
        hourlyBreakdown[hour][item.event] = (hourlyBreakdown[hour][item.event] || 0) + 1;
      }

      const meta = item.metadata as Record<string, unknown> | undefined;

      // Unique users (global + per-day + per-hour + new/returning)
      if (meta?.userId && typeof meta.userId === 'string') {
        uniqueUsers.add(meta.userId);
        if (day) {
          if (!dailyUserSets[day]) dailyUserSets[day] = new Set();
          dailyUserSets[day].add(meta.userId);
        }
        if (hour) {
          if (!hourlyUserSets[hour]) hourlyUserSets[hour] = new Set();
          hourlyUserSets[hour].add(meta.userId);
        }
        // New = first seen within the queried range; returning = before it
        if (typeof meta.firstSeen === 'string' && meta.firstSeen) {
          if (meta.firstSeen >= fromDay) newUsers.add(meta.userId);
          else returningUsers.add(meta.userId);
        }
      }

      // Region
      if (meta?.region && typeof meta.region === 'string') {
        regionCounts[meta.region] = (regionCounts[meta.region] || 0) + 1;
      }

      // Theme distribution and commander counts (deck_generated events only)
      if (item.event === 'deck_generated') {
        // Commander — count only actual deck generations
        if (meta?.commanderName && typeof meta.commanderName === 'string') {
          commanderCounts[meta.commanderName] = (commanderCounts[meta.commanderName] || 0) + 1;
        }
        if (Array.isArray(meta?.themes)) {
          for (const theme of meta.themes as string[]) {
            if (theme) themeCounts[theme] = (themeCounts[theme] || 0) + 1;
          }
        }

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

        // Deck format
        if (meta.deckFormat !== undefined) {
          const fmt = meta.deckFormat === 99 ? 'Commander' : meta.deckFormat === 60 ? 'Brawl' : 'Custom';
          bucket('deckFormat', fmt);
        }

        // Combo preference slider (0=None, 1=A Few, 2=Many)
        if (meta.comboPreference !== undefined) {
          const comboLabels: Record<number, string> = { 0: 'None', 1: 'A Few', 2: 'Many' };
          bucket('comboPreference', comboLabels[meta.comboPreference as number] ?? String(meta.comboPreference));
        }

        // Deck budget (null = none, else dollar value)
        bucket('deckBudget', meta.deckBudget === null || meta.deckBudget === undefined ? 'None' : `$${meta.deckBudget}`);

        // Max card price (null = none, else dollar value)
        bucket('maxCardPrice', meta.maxCardPrice === null || meta.maxCardPrice === undefined ? 'None' : `$${meta.maxCardPrice}`);

        // Land count (bucketed into ranges)
        if (typeof meta.landCount === 'number') {
          const lc = meta.landCount as number;
          const landBucket = lc <= 33 ? '≤33 (Aggro)' : lc <= 36 ? '34-36' : lc === 37 ? '37 (Standard)' : lc <= 40 ? '38-40' : '41+ (Control)';
          bucket('landCount', landBucket);
        }
      }
    }

    const dailyUniqueUsers: Record<string, number> = {};
    for (const [day, set] of Object.entries(dailyUserSets)) {
      dailyUniqueUsers[day] = set.size;
    }

    const hourlyUniqueUsers: Record<string, number> = {};
    for (const [hour, set] of Object.entries(hourlyUserSets)) {
      hourlyUniqueUsers[hour] = set.size;
    }

    return {
      statusCode: 200,
      body: JSON.stringify({
        totalEvents: items.length,
        uniqueUserCount: uniqueUsers.size,
        newUserCount: newUsers.size,
        returningUserCount: returningUsers.size,
        eventCounts,
        commanderCounts,
        themeCounts,
        dailyCounts,
        dailyBreakdown,
        dailyUniqueUsers,
        hourlyCounts,
        hourlyBreakdown,
        hourlyUniqueUsers,
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
