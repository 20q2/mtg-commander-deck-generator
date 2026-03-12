import { useMemo } from 'react';
import { useStore } from '@/store';
import { useUserLists } from '@/hooks/useUserLists';
import { List, X, Shield } from 'lucide-react';
import { trackEvent } from '@/services/analytics';

interface UserListChipsProps {
  mode: 'exclude' | 'include';
}

export interface PresetBanList {
  id: string;
  name: string;
  scryfallFormat: string;
}

export const PRESET_BAN_LISTS: PresetBanList[] = [
  { id: 'rc-banlist', name: 'Commander Bans', scryfallFormat: 'commander' },
  { id: 'brawl-banlist', name: 'Brawl Bans', scryfallFormat: 'brawl' },
  { id: 'standardbrawl-banlist', name: 'Standard Bans', scryfallFormat: 'standard' },
  { id: 'pedh-banlist', name: 'Pauper EDH Bans', scryfallFormat: 'paupercommander' },
];

const ALWAYS_ACTIVE_ID = 'rc-banlist';

export function UserListChips({ mode }: UserListChipsProps) {
  const { lists: allLists } = useUserLists();
  const lists = useMemo(() => allLists.filter(l => l.type !== 'deck'), [allLists]);
  const { customization, updateCustomization } = useStore();

  const appliedLists = mode === 'exclude'
    ? customization.appliedExcludeLists || []
    : customization.appliedIncludeLists || [];

  const appliedKey = mode === 'exclude' ? 'appliedExcludeLists' : 'appliedIncludeLists';

  const banLists = customization.banLists || [];

  const presetIds = useMemo(() => new Set(PRESET_BAN_LISTS.map(p => p.id)), []);

  // For include mode, don't render if user has no lists
  if (mode === 'include' && lists.length === 0) return null;

  // --- User list handlers ---

  const handleToggle = (listId: string) => {
    const existing = appliedLists.find(r => r.listId === listId);
    const newEnabled = existing ? !existing.enabled : true;
    const list = lists.find(l => l.id === listId);
    if (list) {
      trackEvent('list_toggled', { listName: list.name, cardCount: list.cards.length, mode, enabled: newEnabled });
    }
    if (existing) {
      updateCustomization({
        [appliedKey]: appliedLists.map(r =>
          r.listId === listId ? { ...r, enabled: !r.enabled } : r
        ),
      });
    } else {
      updateCustomization({
        [appliedKey]: [...appliedLists, { listId, enabled: true }],
      });
    }
  };

  // --- Ban list handlers (exclude mode only) ---

  const handleTogglePreset = (preset: PresetBanList) => {
    const updated = banLists.map(l =>
      l.id === preset.id ? { ...l, enabled: !l.enabled } : l
    );
    updateCustomization({ banLists: updated });
  };

  const handleToggleBanList = (listId: string) => {
    const updated = banLists.map(l =>
      l.id === listId ? { ...l, enabled: !l.enabled } : l
    );
    updateCustomization({ banLists: updated });
  };

  const handleRemoveBanList = (listId: string) => {
    const list = banLists.find(l => l.id === listId);
    if (list?.isPreset) {
      const updated = banLists.map(l =>
        l.id === listId ? { ...l, enabled: false } : l
      );
      updateCustomization({ banLists: updated });
    } else {
      updateCustomization({ banLists: banLists.filter(l => l.id !== listId) });
    }
  };

  // --- Active count ---

  const enabledColor = mode === 'exclude'
    ? 'bg-purple-500/10 text-purple-600 dark:text-purple-400 border-purple-500/30'
    : 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/30';

  // Collect only active items
  const activePresets = mode === 'exclude'
    ? PRESET_BAN_LISTS.filter(p => {
        if (p.id === ALWAYS_ACTIVE_ID) return false; // Commander Bans now shown in dropdown only
        const existing = banLists.find(l => l.id === p.id);
        return existing?.enabled ?? false;
      })
    : [];
  const activeCustomBans = mode === 'exclude'
    ? banLists.filter(l => l.enabled && !presetIds.has(l.id))
    : [];
  const activeUserLists = lists.filter(l => {
    const applied = appliedLists.find(r => r.listId === l.id);
    return applied?.enabled ?? false;
  });

  const hasActiveItems = activePresets.length > 0 || activeCustomBans.length > 0 || activeUserLists.length > 0;

  if (!hasActiveItems) return null;

  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap gap-1.5">
        {/* Active preset ban lists (exclude mode only) */}
        {activePresets.map(preset => {
          const existing = banLists.find(l => l.id === preset.id);
          return (
            <div key={preset.id} className="group inline-flex items-center gap-1 px-2 py-1 text-[11px] rounded-md border bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/30 transition-colors">
              <button
                onClick={() => handleTogglePreset(preset)}
                className="inline-flex items-center gap-1 hover:opacity-80 transition-opacity"
                title="Click to disable"
              >
                <Shield className="w-3 h-3" />
                <span>{preset.name}</span>
                {existing && <span className="text-[10px] opacity-60">({existing.cards.length})</span>}
              </button>
              <button
                onClick={() => handleTogglePreset(preset)}
                className="hidden group-hover:inline-flex hover:text-destructive transition-colors ml-0.5"
                title="Disable"
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          );
        })}

        {/* Active custom ban lists */}
        {activeCustomBans.map(list => (
          <div key={list.id} className="group inline-flex items-center gap-1 px-2 py-1 text-[11px] rounded-md border bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/30 transition-colors">
            <button
              onClick={() => handleToggleBanList(list.id)}
              className="inline-flex items-center gap-1 hover:opacity-80 transition-opacity"
              title="Click to disable"
            >
              <List className="w-3 h-3" />
              <span>{list.name}</span>
              <span className="text-[10px] opacity-60">({list.cards.length})</span>
            </button>
            <button
              onClick={() => handleRemoveBanList(list.id)}
              className="hidden group-hover:inline-flex hover:text-destructive transition-colors ml-0.5"
              title="Remove list"
            >
              <X className="w-3 h-3" />
            </button>
          </div>
        ))}

        {/* Active user lists */}
        {activeUserLists.map(list => (
          <div key={list.id} className={`group inline-flex items-center gap-1 px-2 py-1 text-[11px] rounded-md border transition-colors ${enabledColor}`}>
            <button
              onClick={() => handleToggle(list.id)}
              className="inline-flex items-center gap-1 hover:opacity-80 transition-opacity"
              title="Click to disable"
            >
              <List className="w-3 h-3" />
              <span>{list.name}</span>
              <span className="text-[10px] opacity-60">({list.cards.length})</span>
            </button>
            <button
              onClick={() => updateCustomization({
                [appliedKey]: appliedLists.filter(r => r.listId !== list.id),
              })}
              className="hidden group-hover:inline-flex hover:text-destructive transition-colors ml-0.5"
              title="Remove from applied lists"
            >
              <X className="w-3 h-3" />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
