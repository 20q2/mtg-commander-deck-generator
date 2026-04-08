import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';

const s3 = new S3Client({});
const BUCKET = process.env.BUCKET_NAME!;
const SCRYFALL_DELAY_MS = 200; // 5 req/sec — well under Scryfall's 10/sec limit to avoid 429s

// Functional tags that matter for deck building
const TAGS: Record<string, string> = {
  // Ramp subtypes
  ramp: 'otag:ramp',
  'cost-reducer': 'otag:cost-reducer',
  'mana-dork': 'otag:mana-dork',
  'mana-rock': 'otag:mana-rock',
  // Removal subtypes
  removal: 'otag:removal',
  'spot-removal': 'otag:spot-removal',
  counterspell: 'otag:counterspell',
  bounce: 'otag:bounce',
  // Board wipe (single tag — subtypes derived from cross-referencing removal tags)
  boardwipe: 'otag:boardwipe',
  // Card advantage subtypes
  'card-advantage': 'otag:card-advantage',
  draw: 'otag:draw',
  tutor: 'otag:tutor',
  cantrip: 'otag:cantrip',
  wheel: 'otag:wheel',
  // Utility tags
  lifegain: 'otag:lifegain',
  sacrifice: 'otag:sacrifice-outlet',
  'graveyard-hate': 'otag:graveyard-hate',
  protection: 'otag:protects-permanent',
  'mana-fix': 'otag:mana-fix',
  // Land classification
  'utility-land': 'otag:utility-land',
  tapland: 'otag:tapland',
  // Bracket estimation tags
  'mass-land-denial': 'otag:mass-land-denial',
  'extra-turn': 'otag:extra-turn',
};

interface ScryfallListResponse {
  data: { name: string }[];
  has_more: boolean;
  next_page?: string;
  total_cards?: number;
}

async function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

const MAX_RETRIES = 3;
const RATE_LIMIT_BACKOFF_MS = 65_000; // Scryfall demands 60s cooldown on 429

async function fetchWithRetry(url: string): Promise<Response> {
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    await sleep(SCRYFALL_DELAY_MS);

    const res = await fetch(url, {
      headers: {
        'User-Agent': 'MtgDeckBuilder-TaggerSync/1.0',
        'Accept': 'application/json',
      },
    });

    if (res.status === 429) {
      if (attempt < MAX_RETRIES) {
        console.warn(`  Scryfall 429, backing off ${RATE_LIMIT_BACKOFF_MS / 1000}s (attempt ${attempt + 1}/${MAX_RETRIES})`);
        await sleep(RATE_LIMIT_BACKOFF_MS);
        continue;
      }
    } else if (res.status >= 500 && res.status < 600) {
      if (attempt < MAX_RETRIES) {
        const backoff = Math.pow(2, attempt + 1) * 1000;
        console.warn(`  Scryfall ${res.status}, retrying in ${backoff}ms (attempt ${attempt + 1}/${MAX_RETRIES})`);
        await sleep(backoff);
        continue;
      }
    }

    return res;
  }

  throw new Error('Exhausted retries');
}

interface TaggerFile {
  generatedAt: string;
  tags: Record<string, string[]>;
}

async function loadPreviousData(): Promise<TaggerFile | null> {
  try {
    const res = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: 'tagger-tags.json' }));
    const body = await res.Body?.transformToString();
    return body ? JSON.parse(body) : null;
  } catch {
    console.log('No previous tagger data found — full sync');
    return null;
  }
}

async function fetchTagCount(query: string): Promise<number> {
  const url = `https://api.scryfall.com/cards/search?q=${encodeURIComponent(query)}&unique=cards&page=1`;
  const res = await fetchWithRetry(url);

  if (res.status === 404) return 0;
  if (!res.ok) throw new Error(`Scryfall ${res.status}: ${await res.text()}`);

  const data: ScryfallListResponse = await res.json();
  return data.total_cards ?? 0;
}

async function fetchAllCardNames(query: string): Promise<string[]> {
  const names: string[] = [];
  let url: string | null = `https://api.scryfall.com/cards/search?q=${encodeURIComponent(query)}&unique=cards&order=name`;

  while (url) {
    const res = await fetchWithRetry(url);

    if (res.status === 404) break; // No results for this tag
    if (!res.ok) {
      throw new Error(`Scryfall ${res.status}: ${await res.text()}`);
    }

    const data: ScryfallListResponse = await res.json();
    for (const card of data.data) {
      names.push(card.name);
    }

    url = data.has_more && data.next_page ? data.next_page : null;
  }

  return names;
}

export async function handler(): Promise<{ statusCode: number; body: string }> {
  console.log('Starting tagger sync...');

  const previous = await loadPreviousData();
  const result: Record<string, string[]> = {};
  let totalCards = 0;
  let skipped = 0;
  let fetched = 0;

  for (const [tag, query] of Object.entries(TAGS)) {
    try {
      // Check if count matches previous data — if so, skip the full fetch
      const cachedCards = previous?.tags[tag];
      if (cachedCards && cachedCards.length > 0) {
        console.log(`Checking tag: ${tag} (${query})`);
        const currentCount = await fetchTagCount(query);

        if (currentCount === cachedCards.length) {
          console.log(`  ${tag}: unchanged (${currentCount} cards) — skipped`);
          result[tag] = cachedCards;
          totalCards += cachedCards.length;
          skipped++;
          continue;
        }

        console.log(`  ${tag}: count changed (${cachedCards.length} → ${currentCount}) — re-fetching`);
      } else {
        console.log(`Fetching tag: ${tag} (${query})`);
      }

      const names = await fetchAllCardNames(query);
      result[tag] = names;
      totalCards += names.length;
      fetched++;
      console.log(`  ${tag}: ${names.length} cards`);
    } catch (err) {
      console.error(`Failed to fetch tag "${tag}":`, err);
      // Fall back to previous data if available, otherwise empty
      result[tag] = previous?.tags[tag] ?? [];
      totalCards += result[tag].length;
    }
  }

  const payload = JSON.stringify({
    generatedAt: new Date().toISOString(),
    tags: result,
  });

  console.log(`Fetched: ${fetched}, Skipped: ${skipped}, Total: ${totalCards} card-tag entries, ${payload.length} bytes`);

  await s3.send(new PutObjectCommand({
    Bucket: BUCKET,
    Key: 'tagger-tags.json',
    Body: payload,
    ContentType: 'application/json',
    CacheControl: 'public, max-age=604800', // 7 days
  }));

  console.log('Uploaded to S3 successfully');

  return {
    statusCode: 200,
    body: JSON.stringify({ tags: Object.keys(result).length, totalCards, fetched, skipped }),
  };
}
