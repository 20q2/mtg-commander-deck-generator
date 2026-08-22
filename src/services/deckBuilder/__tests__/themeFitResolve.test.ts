import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { MtgCatalogs } from '@/services/scryfall/client';

// Fully mocked rather than spread from the originals: `resolveThemeModels` uses exactly one export
// from each of these, and the real modules reach for network config at import time.
vi.mock('@/services/scryfall/client', () => ({ getMtgCatalogs: vi.fn() }));
vi.mock('@/services/edhrec/client', () => ({ fetchAllTags: vi.fn() }));
vi.mock('@/services/spellchroma/tagIndex', () => ({
  loadTagIndex: vi.fn(),
  tagsForOracleId: vi.fn(() => []),
}));

import { getMtgCatalogs } from '@/services/scryfall/client';
import { fetchAllTags } from '@/services/edhrec/client';
import { loadTagIndex } from '@/services/spellchroma/tagIndex';
import { resolveThemeModels } from '../themeFit';

const CATALOGS: MtgCatalogs = {
  mechanics: new Set(['landfall']),
  creatureTypes: new Set(['elf']),
  permanentSubtypes: new Set(),
};

describe('resolveThemeModels', () => {
  beforeEach(() => {
    // Call history persists across tests otherwise, which breaks the not.toHaveBeenCalled() case.
    vi.clearAllMocks();
    vi.mocked(getMtgCatalogs).mockResolvedValue(CATALOGS);
    vi.mocked(loadTagIndex).mockResolvedValue(true);
    vi.mocked(fetchAllTags).mockResolvedValue([
      { name: 'Landfall', slug: 'landfall', numDecks: 19932 },
      { name: 'Elves', slug: 'elves', numDecks: 9000 },
      { name: 'Aristocrats', slug: 'aristocrats', numDecks: 5000 },
    ]);
  });

  it('builds models only for the requested slugs, in the order requested', async () => {
    const models = await resolveThemeModels([
      { slug: 'elves', name: 'Elves' },
      { slug: 'landfall', name: 'Landfall' },
    ]);

    expect(models.map(m => m.slug)).toEqual(['elves', 'landfall']);
    expect(models[1].kind).toEqual({ kind: 'mechanic', match: 'landfall' });
  });

  it('skips a slug the taxonomy does not contain', async () => {
    const models = await resolveThemeModels([
      { slug: 'landfall', name: 'Landfall' },
      { slug: 'not-a-real-tag', name: 'Nope' },
    ]);
    expect(models.map(m => m.slug)).toEqual(['landfall']);
  });

  it('returns [] rather than throwing when a dependency fails', async () => {
    vi.mocked(fetchAllTags).mockRejectedValue(new Error('offline'));

    await expect(resolveThemeModels([{ slug: 'landfall', name: 'Landfall' }]))
      .resolves.toEqual([]);
  });

  it('returns [] for no themes without touching the network', async () => {
    expect(await resolveThemeModels([])).toEqual([]);
    expect(fetchAllTags).not.toHaveBeenCalled();
    expect(getMtgCatalogs).not.toHaveBeenCalled();
  });
});
