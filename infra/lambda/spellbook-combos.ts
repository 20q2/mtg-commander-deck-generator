import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { gzipSync, createGunzip } from 'node:zlib';
import { Readable } from 'node:stream';
import { chain } from 'stream-chain';
import { parser } from 'stream-json';
import { pick } from 'stream-json/filters/Pick';
import { streamArray } from 'stream-json/streamers/StreamArray';

const s3 = new S3Client({});
const BUCKET = process.env.BUCKET_NAME!;
const UA = 'MtgDeckBuilder-SpellbookCombos/1.0';

// Commander Spellbook's full variant export (~27 MB gzipped, ~635 MB of JSON).
// 635 MB exceeds Node's max string length, so it MUST be stream-parsed — never
// buffer the whole body.
const BULK_URL = 'https://json.commanderspellbook.com/variants.json.gz';

const KEY_PREFIX = 'spellbook-combos';

// Same identity → slug table the client uses (colorIdentityToSlug in
// src/services/edhrec/client.ts) — keys are WUBRG-ordered letter strings.
const IDENTITY_SLUGS: Record<string, string> = {
  '': 'colorless',
  W: 'mono-white', U: 'mono-blue', B: 'mono-black', R: 'mono-red', G: 'mono-green',
  WU: 'azorius', UB: 'dimir', BR: 'rakdos', RG: 'gruul', WG: 'selesnya',
  WB: 'orzhov', UR: 'izzet', BG: 'golgari', WR: 'boros', UG: 'simic',
  WUG: 'bant', WUB: 'esper', UBR: 'grixis', BRG: 'jund', WRG: 'naya',
  WBR: 'mardu', URG: 'temur', WBG: 'abzan', WUR: 'jeskai', UBG: 'sultai',
  WUBR: 'yore-tiller', UBRG: 'glint-eye', WBRG: 'dune-brood', WURG: 'ink-treader', WUBG: 'witch-maw',
  WUBRG: 'five-color',
};

const ORDER = ['W', 'U', 'B', 'R', 'G'] as const;

function identityToMask(identity: string): number {
  let mask = 0;
  for (const ch of identity.toUpperCase()) {
    const bit = ORDER.indexOf(ch as (typeof ORDER)[number]);
    if (bit >= 0) mask |= 1 << bit; // Spellbook uses "C" for colorless — no bits
  }
  return mask;
}

function maskToKey(mask: number): string {
  return ORDER.filter((_, i) => mask & (1 << i)).join('');
}

// Shape of one variant in the bulk export (only the fields we read).
interface SpellbookVariant {
  id?: string;
  status?: string;
  identity?: string;
  popularity?: number | null;
  bracketTag?: string;
  legalities?: { commander?: boolean };
  uses?: { card?: { name?: string }; mustBeCommander?: boolean }[];
  produces?: { feature?: { name?: string } }[];
}

// One trimmed combo as shipped to the client (compact keys — ~40k of these):
// i = Spellbook variant id (matches EDHREC's comboId), c = card names,
// r = results, d = color identity ("BG", "C"), p = popularity (EDHREC deck
// count, synced by Spellbook), b = Spellbook bracket tag (R/S/P/O/C/E).
interface TrimmedCombo {
  i: string;
  c: string[];
  r: string[];
  d: string;
  p: number;
  b: string;
}

export function trimVariant(v: SpellbookVariant): { combo: TrimmedCombo; mask: number } | null {
  if (v.status !== 'OK' || !v.id) return null;
  if (v.legalities?.commander !== true) return null;
  if (v.bracketTag === 'B') return null; // banned-combo tag — belt to the legality suspenders
  // Combos that only work with a piece in the command zone would false-positive
  // for decks running that card in the 99. The commander-specific EDHREC combo
  // page (still fetched separately) covers those for the actual commander.
  if (v.uses?.some(u => u.mustBeCommander)) return null;

  const cards = (v.uses ?? []).map(u => u.card?.name).filter((n): n is string => !!n);
  if (cards.length < 2) return null;
  const results = (v.produces ?? []).map(p => p.feature?.name).filter((n): n is string => !!n);

  return {
    combo: {
      i: v.id,
      c: cards,
      r: results,
      d: v.identity || 'C',
      p: v.popularity ?? 0,
      b: v.bracketTag ?? '',
    },
    mask: identityToMask(v.identity || ''),
  };
}

/**
 * The CDN serves variants.json.gz with `Content-Encoding: gzip`, which Node's
 * fetch transparently inflates — so the body is usually plain JSON bytes
 * already (still ~27 MB on the wire). Sniff the gzip magic number instead of
 * trusting headers so raw .gz bytes also work if that header ever changes.
 */
async function peekFirstChunk(stream: Readable): Promise<Buffer | null> {
  return new Promise((resolve, reject) => {
    const onReadable = () => {
      const chunk = stream.read() as Buffer | null;
      if (chunk === null) return; // not enough buffered yet — wait for the next 'readable'
      cleanup();
      stream.unshift(chunk); // put it back for the real consumer
      resolve(chunk);
    };
    const onEnd = () => { cleanup(); resolve(null); };
    const onError = (err: Error) => { cleanup(); reject(err); };
    const cleanup = () => {
      stream.off('readable', onReadable);
      stream.off('end', onEnd);
      stream.off('error', onError);
    };
    stream.on('readable', onReadable);
    stream.once('end', onEnd);
    stream.once('error', onError);
  });
}

async function putGzip(key: string, body: string): Promise<number> {
  const gz = gzipSync(Buffer.from(body), { level: 9 });
  await s3.send(new PutObjectCommand({
    Bucket: BUCKET,
    Key: key,
    Body: gz,
    ContentType: 'application/json',
    ContentEncoding: 'gzip', // browsers transparently inflate
    CacheControl: 'public, max-age=604800', // 7 days, matching the other weekly artifacts
  }));
  return gz.length;
}

export async function handler(): Promise<{ statusCode: number; body: string }> {
  console.log(`Downloading ${BULK_URL} (streaming)...`);
  const res = await fetch(BULK_URL, { headers: { 'User-Agent': UA } });
  if (!res.ok || !res.body) throw new Error(`HTTP ${res.status} for ${BULK_URL}`);

  const raw = Readable.fromWeb(res.body as unknown as import('node:stream/web').ReadableStream);
  const magic = await peekFirstChunk(raw);
  const isGzip = !!magic && magic.length >= 2 && magic[0] === 0x1f && magic[1] === 0x8b;
  const pipeline = chain([
    raw,
    ...(isGzip ? [createGunzip()] : []),
    parser(),
    pick({ filter: 'variants' }),
    streamArray(),
  ]);

  const combos: TrimmedCombo[] = [];
  const masks: number[] = [];
  let seen = 0;
  for await (const item of pipeline as AsyncIterable<{ value: SpellbookVariant }>) {
    seen++;
    const trimmed = trimVariant(item.value);
    if (!trimmed) continue;
    combos.push(trimmed.combo);
    masks.push(trimmed.mask);
  }
  console.log(`Parsed ${seen} variants, kept ${combos.length} commander-legal combos`);

  const generatedAt = new Date().toISOString();
  let totalBytes = 0;

  // One closure file per color identity: every combo whose identity is a
  // subset of the file's identity. A BG deck reads golgari.json and gets
  // golgari + mono-black + mono-green + colorless combos in one fetch.
  for (let mask = 0; mask < 32; mask++) {
    const slug = IDENTITY_SLUGS[maskToKey(mask)];
    const subset = combos
      .filter((_, idx) => (masks[idx] & ~mask) === 0)
      .sort((a, b) => b.p - a.p);
    const bytes = await putGzip(
      `${KEY_PREFIX}/${slug}.json`,
      JSON.stringify({ generatedAt, count: subset.length, combos: subset }),
    );
    totalBytes += bytes;
    console.log(`${slug}: ${subset.length} combos, ${(bytes / 1e3).toFixed(0)} KB gz`);
  }

  return {
    statusCode: 200,
    body: JSON.stringify({ variants: seen, kept: combos.length, files: 32, totalBytes, generatedAt }),
  };
}
