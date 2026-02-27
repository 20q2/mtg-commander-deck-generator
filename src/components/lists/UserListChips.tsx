import { useState, useMemo } from 'react';
import { useStore } from '@/store';
import { useUserLists } from '@/hooks/useUserLists';
import { getBanList } from '@/services/scryfall/client';
import type { BanList } from '@/types';
import { ChevronRight, List, X, Shield, Loader2 } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { trackEvent } from '@/services/analytics';

interface UserListChipsProps {
  mode: 'exclude' | 'include';
}

const STORAGE_KEY_PREFIX = 'mtg-user-lists-collapsed-';

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
  const [collapsed, setCollapsed] = useState(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY_PREFIX + mode);
      return stored !== null ? stored === 'true' : true;
    } catch {
      return true;
    }
  });

  const toggleCollapsed = () => {
    const next = !collapsed;
    setCollapsed(next);
    try { localStorage.setItem(STORAGE_KEY_PREFIX + mode, String(next)); } catch {}
  };

  const [loadingPresets, setLoadingPresets] = useState<Set<string>>(new Set());

  const { lists } = useUserLists();
  const { customization, updateCustomization } = useStore();
  const navigate = useNavigate();

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

  const handleTogglePreset = async (preset: PresetBanList) => {
    const existing = banLists.find(l => l.id === preset.id);

    if (existing && existing.cards.length > 0) {
      const updated = banLists.map(l =>
        l.id === preset.id ? { ...l, enabled: !l.enabled } : l
      );
      updateCustomization({ banLists: updated });
      return;
    }

    setLoadingPresets(prev => new Set(prev).add(preset.id));
    try {
      const cards = await getBanList(preset.scryfallFormat);
      const newList: BanList = {
        id: preset.id,
        name: preset.name,
        cards,
        isPreset: true,
        enabled: true,
      };
      if (existing) {
        const updated = banLists.map(l => l.id === preset.id ? newList : l);
        updateCustomization({ banLists: updated });
      } else {
        updateCustomization({ banLists: [...banLists, newList] });
      }
    } catch (err) {
      console.error(`Failed to fetch ${preset.name} ban list:`, err);
    } finally {
      setLoadingPresets(prev => {
        const next = new Set(prev);
        next.delete(preset.id);
        return next;
      });
    }
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

  const userListActiveCount = appliedLists.filter(r => r.enabled && lists.some(l => l.id === r.listId)).length;
  const banListActiveCount = mode === 'exclude'
    ? banLists.filter(l => l.enabled && l.id !== ALWAYS_ACTIVE_ID).length
    : 0;
  const activeCount = userListActiveCount + banListActiveCount;

  const enabledColor = mode === 'exclude'
    ? 'bg-purple-500/10 text-purple-600 dark:text-purple-400 border-purple-500/30'
    : 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/30';

  return (
    <div className="space-y-1.5">
      <div className="flex items-center">
        <button
          onClick={toggleCollapsed}
          className="flex items-center gap-1 group cursor-pointer select-none"
        >
          <ChevronRight className={`w-3 h-3 text-muted-foreground/60 transition-transform ${collapsed ? '' : 'rotate-90'}`} />
          <span className="text-[11px] text-muted-foreground font-medium group-hover:text-foreground transition-colors">Saved Lists</span>
          {activeCount > 0 && (
            <span className="text-[10px] text-muted-foreground/60">
              ({activeCount} active)
            </span>
          )}
        </button>
        <button
          onClick={() => navigate('/lists')}
          className="ml-auto text-[10px] text-muted-foreground hover:text-primary transition-colors px-1.5 py-0.5 rounded border border-border/40 hover:border-primary/40"
          title="Manage lists"
        >
          Manage
        </button>
      </div>

      {!collapsed && (
        <div className="flex flex-wrap gap-1.5">
          {/* Ban list chips (exclude mode only) */}
          {mode === 'exclude' && (
            <>
              {/* Preset ban lists */}
              {PRESET_BAN_LISTS.map(preset => {
                const isAlwaysActive = preset.id === ALWAYS_ACTIVE_ID;
                const existing = banLists.find(l => l.id === preset.id);
                const enabled = existing?.enabled ?? false;
                const loading = loadingPresets.has(preset.id);

                if (isAlwaysActive) {
                  return (
                    <span
                      key={preset.id}
                      className="inline-flex items-center gap-1 px-2 py-1 text-[11px] rounded-md border bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/30 cursor-help"
                      title="Always in effect — EDHRec data already excludes commander-banned cards"
                    >
                      <Shield className="w-3 h-3" />
                      <span>{preset.name}</span>
                      <span className="text-[10px] opacity-60">Always active</span>
                    </span>
                  );
                }

                return (
                  <button
                    key={preset.id}
                    onClick={() => handleTogglePreset(preset)}
                    disabled={loading}
                    className={`inline-flex items-center gap-1 px-2 py-1 text-[11px] rounded-md border transition-colors ${
                      enabled
                        ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/30'
                        : 'bg-muted/30 text-muted-foreground border-border/50 hover:border-border'
                    }`}
                  >
                    {loading ? (
                      <Loader2 className="w-3 h-3 animate-spin" />
                    ) : (
                      <Shield className="w-3 h-3" />
                    )}
                    <span>{preset.name}</span>
                    {existing && (
                      <span className="text-[10px] opacity-60">({existing.cards.length})</span>
                    )}
                  </button>
                );
              })}

              {/* Custom ban lists */}
              {banLists.filter(l => !presetIds.has(l.id)).map(list => (
                <div key={list.id} className={`inline-flex items-center gap-1 px-2 py-1 text-[11px] rounded-md border transition-colors ${
                  list.enabled
                    ? 'bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/30'
                    : 'bg-muted/30 text-muted-foreground border-border/50'
                }`}>
                  <button
                    onClick={() => handleToggleBanList(list.id)}
                    className="inline-flex items-center gap-1 hover:opacity-80 transition-opacity"
                    title={list.enabled ? 'Click to disable' : 'Click to enable'}
                  >
                    <List className="w-3 h-3" />
                    <span>{list.name}</span>
                    <span className="text-[10px] opacity-60">({list.cards.length})</span>
                  </button>
                  <button
                    onClick={() => handleRemoveBanList(list.id)}
                    className="hover:text-destructive transition-colors ml-0.5"
                    title="Remove list"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
              ))}
            </>
          )}

          {/* User lists */}
          {lists.map(list => {
            const applied = appliedLists.find(r => r.listId === list.id);
            const enabled = applied?.enabled ?? false;
            return (
              <button
                key={list.id}
                onClick={() => handleToggle(list.id)}
                className={`inline-flex items-center gap-1 px-2 py-1 text-[11px] rounded-md border transition-colors ${
                  enabled ? enabledColor : 'bg-muted/30 text-muted-foreground border-border/50 hover:border-border'
                }`}
                title={enabled ? 'Click to disable' : 'Click to enable'}
              >
                <List className="w-3 h-3" />
                <span>{list.name}</span>
                <span className="text-[10px] opacity-60">({list.cards.length})</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
