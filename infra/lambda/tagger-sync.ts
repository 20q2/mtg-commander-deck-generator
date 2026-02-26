import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';

const s3 = new S3Client({});
const BUCKET = process.env.BUCKET_NAME!;
const SCRYFALL_DELAY_MS = 120; // Scryfall asks for 50-100ms between requests; be generous

// Functional tags that matter for deck building
const TAGS: Record<string, string> = {
  ramp: 'otag:ramp',
  removal: 'otag:removal',
  boardwipe: 'otag:boardwipe',
  'card-advantage': 'otag:card-advantage',
  tutor: 'otag:tutor',
  'mana-dork': 'otag:mana-dork',
  lifegain: 'otag:lifegain',
  sacrifice: 'otag:sacrifice-outlet',
  'graveyard-hate': 'otag:graveyard-hate',
  protection: 'otag:protection',
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

async function fetchAllCardNames(query: string): Promise<string[]> {
  const names: string[] = [];
  let url: string | null = `https://api.scryfall.com/cards/search?q=${encodeURIComponent(query)}&unique=cards&order=name`;

  while (url) {
    await sleep(SCRYFALL_DELAY_MS);

    const res = await fetch(url, {
      headers: { 'User-Agent': 'MtgDeckBuilder-TaggerSync/1.0' },
    });

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
  const result: Record<string, string[]> = {};
  let totalCards = 0;

  for (const [tag, query] of Object.entries(TAGS)) {
    try {
      console.log(`Fetching tag: ${tag} (${query})`);
      const names = await fetchAllCardNames(query);
      result[tag] = names;
      totalCards += names.length;
      console.log(`  ${tag}: ${names.length} cards`);
    } catch (err) {
      console.error(`Failed to fetch tag "${tag}":`, err);
      result[tag] = []; // Don't let one failure break the whole sync
    }
  }

  const payload = JSON.stringify({
    generatedAt: new Date().toISOString(),
    tags: result,
  });

  console.log(`Total: ${totalCards} card-tag entries, ${payload.length} bytes`);

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
    body: JSON.stringify({ tags: Object.keys(result).length, totalCards }),
  };
}
