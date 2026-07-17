import { CollectionCommanders } from '@/components/collection/CollectionCommanders';
import { CollectionImporter } from '@/components/collection/CollectionImporter';
import { CollectionManager } from '@/components/collection/CollectionManager';
import { CollectionStats } from '@/components/collection/CollectionStats';
import { AuroraThemed } from '@/components/ui/AuroraThemed';
import { useCollection } from '@/hooks/useCollection';
import { useBinders } from '@/hooks/useBinders';
import { usePageTitle } from '@/hooks/usePageTitle';
import { getAuroraColors } from '@/lib/commanderTheme';
import { ALL_BINDERS_ID } from '@/services/collection/db';
import { ArrowLeft, BarChart3, Crown, Info, Upload, Folder, FolderPlus, Pencil, Trash2, Check, X, ChevronDown, ChevronUp } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';

type TopTab = 'import' | 'stats' | 'commanders';

const RARITY_TO_PRETTY: Record<string, string> = {
  common: 'common', uncommon: 'uncommon', rare: 'rare', mythic: 'mythic',
};

export function CollectionPage() {
  usePageTitle('Collection');
  const navigate = useNavigate();
  const { binders, isLoading: bindersLoading, createBinder, renameBinder, deleteBinder } = useBinders();
  const [selectedBinderId, setSelectedBinderId] = useState<string>(ALL_BINDERS_ID);
  const {
    count, cards, removeCard, updateQuantity, clearCollection,
    needsEnrichment, isEnriching, enrichProgress, enrichCollection,
  } = useCollection(selectedBinderId);
  const { count: totalCount } = useCollection(ALL_BINDERS_ID);
  const [activeTab, setActiveTab] = useState<TopTab>('commanders');
  const [creatingBinder, setCreatingBinder] = useState(false);
  const [newBinderName, setNewBinderName] = useState('');
  const [editingBinderId, setEditingBinderId] = useState<string | null>(null);
  const [editingBinderName, setEditingBinderName] = useState('');
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [topSectionCollapsed, setTopSectionCollapsed] = useState(() => localStorage.getItem('collection-top-section-collapsed') === '1');
  const toggleTopSectionCollapsed = () => {
    setTopSectionCollapsed(prev => {
      const next = !prev;
      localStorage.setItem('collection-top-section-collapsed', next ? '1' : '0');
      return next;
    });
  };

  // Filter state, lifted from CollectionManager so the Statistics tab can drive it.
  const [selectedColors, setSelectedColors] = useState<Set<string>>(new Set());
  const [selectedTypes, setSelectedTypes] = useState<Set<string>>(new Set());
  const [selectedRarities, setSelectedRarities] = useState<Set<string>>(new Set());

  // Guarantee there's always at least one binder to import into.
  useEffect(() => {
    if (!bindersLoading && binders.length === 0) {
      createBinder('My Collection');
    }
  }, [bindersLoading, binders.length, createBinder]);

  const auroraColors = useMemo(
    () => getAuroraColors([...selectedColors]),
    [selectedColors],
  );

  const hasCollection = totalCount > 0;

  const managerRef = useRef<HTMLDivElement | null>(null);
  const scrollToManager = () => {
    managerRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  // Stats click → filter the collection list below.
  const handleColorClick = (code: 'W' | 'U' | 'B' | 'R' | 'G' | 'C' | 'M') => {
    if (code === 'M') {
      // Multicolor: clear single-color selection and use the "Exact" mode would be ideal,
      // but for simplicity just clear filters and rely on the underlying chips for refinement.
      setSelectedColors(new Set());
    } else {
      const next = new Set<string>([code]);
      setSelectedColors(next);
    }
    scrollToManager();
  };
  const handleTypeClick = (type: string) => {
    setSelectedTypes(prev => {
      const next = new Set(prev);
      if (next.has(type)) next.delete(type);
      else next.add(type);
      return next;
    });
    scrollToManager();
  };
  const handleRarityClick = (rarity: string) => {
    const code = RARITY_TO_PRETTY[rarity] ?? rarity;
    setSelectedRarities(prev => {
      const next = new Set(prev);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return next;
    });
    scrollToManager();
  };

  const handleCreateBinder = async () => {
    const name = newBinderName.trim();
    if (!name) { setCreatingBinder(false); return; }
    const binder = await createBinder(name);
    setSelectedBinderId(binder.id);
    setNewBinderName('');
    setCreatingBinder(false);
  };

  const startRenameBinder = (id: string, currentName: string) => {
    setEditingBinderId(id);
    setEditingBinderName(currentName);
  };

  const commitRenameBinder = async () => {
    const name = editingBinderName.trim();
    if (editingBinderId && name) {
      await renameBinder(editingBinderId, name);
    }
    setEditingBinderId(null);
    setEditingBinderName('');
  };

  const handleDeleteBinder = async (id: string) => {
    await deleteBinder(id);
    if (selectedBinderId === id) setSelectedBinderId(ALL_BINDERS_ID);
    setConfirmDeleteId(null);
  };

  return (
    <>
      <AuroraThemed colors={auroraColors} />
      <main className="flex-1 container mx-auto px-4 py-8 max-w-6xl">
        <button
          onClick={() => navigate(-1)}
          className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors mb-6"
        >
          <ArrowLeft className="w-4 h-4" />
          Back
        </button>

        <div className="space-y-2 mb-8">
          <h2 className="text-2xl font-bold">Collections</h2>
          <p className="text-sm text-muted-foreground">
            Import your MTG card collection, then enable "Build from Collection" when generating decks
            to only use cards you own.
          </p>
        </div>

        <aside className="p-4 rounded-xl border border-border/50 bg-card/50 backdrop-blur-sm w-full max-w-xs space-y-3 mb-6 lg:mb-0 lg:absolute lg:top-24 lg:right-4 lg:z-30">
          <div className="flex items-center gap-2 text-sm font-medium">
            <Info className="w-4 h-4 text-muted-foreground" />
            Good to know
          </div>
          <p className="text-xs text-muted-foreground leading-relaxed">
            Your collection is stored locally in your browser and may be cleared if you clear site data.
            We recommend using a dedicated inventory manager as your source of truth and re-importing here as needed.
          </p>
          <div className="flex flex-wrap gap-2 pt-1">
            <a href="https://www.moxfield.com" target="_blank" rel="noopener noreferrer" className="text-[11px] text-primary hover:underline">Moxfield</a>
            <span className="text-border">·</span>
            <a href="https://www.archidekt.com" target="_blank" rel="noopener noreferrer" className="text-[11px] text-primary hover:underline">Archidekt</a>
            <span className="text-border">·</span>
            <a href="https://deckbox.org" target="_blank" rel="noopener noreferrer" className="text-[11px] text-primary hover:underline">Deckbox</a>
            <span className="text-border">·</span>
            <a href="https://www.manabox.app" target="_blank" rel="noopener noreferrer" className="text-[11px] text-primary hover:underline">Manabox</a>
          </div>
        </aside>

        <div className="lg:flex lg:gap-6 lg:items-start">
          {/* Binder sidebar */}
          {hasCollection && (
            <aside className="mb-4 lg:mb-0 lg:w-48 lg:shrink-0">
              <div className="flex lg:flex-col gap-1 overflow-x-auto lg:overflow-visible pb-2 lg:pb-0 border-b lg:border-b-0 lg:border-r border-border/40 lg:pr-3">
                <button
                  onClick={() => setSelectedBinderId(ALL_BINDERS_ID)}
                  className={`shrink-0 flex items-center gap-2 px-3 py-2 text-sm rounded-md text-left transition-colors ${
                    selectedBinderId === ALL_BINDERS_ID
                      ? 'bg-primary/15 text-foreground font-medium'
                      : 'text-muted-foreground hover:bg-accent/40 hover:text-foreground'
                  }`}
                >
                  <Folder className="w-3.5 h-3.5 shrink-0" />
                  All
                </button>

                {binders.map(binder => (
                  <div key={binder.id} className="group shrink-0 flex items-center gap-1">
                    {editingBinderId === binder.id ? (
                      <div className="flex items-center gap-1 px-2 py-1">
                        <input
                          autoFocus
                          value={editingBinderName}
                          onChange={(e) => setEditingBinderName(e.target.value)}
                          onKeyDown={(e) => { if (e.key === 'Enter') commitRenameBinder(); if (e.key === 'Escape') setEditingBinderId(null); }}
                          className="w-28 px-1.5 py-0.5 text-sm rounded border border-border bg-background focus:outline-none focus:ring-1 focus:ring-primary"
                        />
                        <button onClick={commitRenameBinder} className="p-1 text-muted-foreground hover:text-foreground"><Check className="w-3.5 h-3.5" /></button>
                        <button onClick={() => setEditingBinderId(null)} className="p-1 text-muted-foreground hover:text-foreground"><X className="w-3.5 h-3.5" /></button>
                      </div>
                    ) : (
                      <button
                        onClick={() => setSelectedBinderId(binder.id)}
                        className={`flex-1 flex items-center gap-2 px-3 py-2 text-sm rounded-md text-left transition-colors ${
                          selectedBinderId === binder.id
                            ? 'bg-primary/15 text-foreground font-medium'
                            : 'text-muted-foreground hover:bg-accent/40 hover:text-foreground'
                        }`}
                      >
                        <Folder className="w-3.5 h-3.5 shrink-0" />
                        <span className="truncate">{binder.name}</span>
                      </button>
                    )}
                    {editingBinderId !== binder.id && (
                      <div className="hidden lg:flex items-center opacity-0 group-hover:opacity-100 transition-opacity">
                        <button onClick={() => startRenameBinder(binder.id, binder.name)} className="p-1 text-muted-foreground hover:text-foreground" title="Rename">
                          <Pencil className="w-3 h-3" />
                        </button>
                        <button onClick={() => setConfirmDeleteId(binder.id)} className="p-1 text-muted-foreground hover:text-destructive" title="Delete">
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </div>
                    )}
                  </div>
                ))}

                {creatingBinder ? (
                  <div className="flex items-center gap-1 px-2 py-1">
                    <input
                      autoFocus
                      value={newBinderName}
                      onChange={(e) => setNewBinderName(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') handleCreateBinder(); if (e.key === 'Escape') setCreatingBinder(false); }}
                      placeholder="Collection name"
                      className="w-28 px-1.5 py-0.5 text-sm rounded border border-border bg-background focus:outline-none focus:ring-1 focus:ring-primary"
                    />
                    <button onClick={handleCreateBinder} className="p-1 text-muted-foreground hover:text-foreground"><Check className="w-3.5 h-3.5" /></button>
                    <button onClick={() => setCreatingBinder(false)} className="p-1 text-muted-foreground hover:text-foreground"><X className="w-3.5 h-3.5" /></button>
                  </div>
                ) : (
                  <button
                    onClick={() => setCreatingBinder(true)}
                    className="shrink-0 flex items-center gap-2 px-3 py-2 text-sm rounded-md text-muted-foreground hover:bg-accent/40 hover:text-foreground transition-colors"
                  >
                    <FolderPlus className="w-3.5 h-3.5" />
                    New collection
                  </button>
                )}
              </div>

              {confirmDeleteId && (
                <div className="mt-2 p-3 rounded-lg border border-destructive/50 bg-destructive/10 space-y-2 lg:w-48">
                  <p className="text-xs text-muted-foreground">
                    Delete "{binders.find(b => b.id === confirmDeleteId)?.name}" and all its cards? This cannot be undone.
                  </p>
                  <div className="flex justify-end gap-2">
                    <button onClick={() => setConfirmDeleteId(null)} className="px-2 py-1 text-xs rounded-md hover:bg-accent transition-colors">Cancel</button>
                    <button onClick={() => handleDeleteBinder(confirmDeleteId)} className="px-2 py-1 text-xs bg-destructive text-destructive-foreground rounded-md hover:bg-destructive/90 transition-colors">Delete</button>
                  </div>
                </div>
              )}
            </aside>
          )}

          <div className="flex-1 min-w-0 space-y-8">
            {/* Top section — tabs when there's a collection; just the importer otherwise */}
            {hasCollection ? (
              <section className="rounded-xl border border-border/50 bg-card/50 backdrop-blur-sm overflow-hidden">
                <div className="flex items-center border-b border-border/40 overflow-x-auto overflow-y-hidden">
                  <TabButton
                    active={activeTab === 'import'}
                    onClick={() => setActiveTab('import')}
                    icon={<Upload className="w-3.5 h-3.5" />}
                    label="Import"
                  />
                  <TabButton
                    active={activeTab === 'stats'}
                    onClick={() => setActiveTab('stats')}
                    icon={<BarChart3 className="w-3.5 h-3.5" />}
                    label="Statistics"
                  />
                  <TabButton
                    active={activeTab === 'commanders'}
                    onClick={() => setActiveTab('commanders')}
                    icon={<Crown className="w-3.5 h-3.5" />}
                    label="Commanders"
                  />
                  <button
                    type="button"
                    onClick={toggleTopSectionCollapsed}
                    title={topSectionCollapsed ? 'Expand' : 'Collapse'}
                    aria-label={topSectionCollapsed ? 'Expand section' : 'Collapse section'}
                    className="ml-auto shrink-0 p-2.5 text-muted-foreground hover:text-foreground transition-colors"
                  >
                    {topSectionCollapsed ? <ChevronDown className="w-4 h-4" /> : <ChevronUp className="w-4 h-4" />}
                  </button>
                </div>
                {!topSectionCollapsed && (
                  <div className={activeTab === 'commanders' ? '' : 'p-4'}>
                    {activeTab === 'stats' && (
                      <CollectionStats
                        cards={cards}
                        onColorClick={handleColorClick}
                        onTypeClick={handleTypeClick}
                        onRarityClick={handleRarityClick}
                      />
                    )}
                    {activeTab === 'import' && (
                      <CollectionImporter
                        hideLabel
                        binderId={selectedBinderId !== ALL_BINDERS_ID ? selectedBinderId : binders[0]?.id}
                      />
                    )}
                    {activeTab === 'commanders' && <CollectionCommanders cards={cards} />}
                  </div>
                )}
              </section>
            ) : (
              <section className="p-4 rounded-xl border border-border/50 bg-card/50 backdrop-blur-sm max-w-2xl">
                <CollectionImporter />
              </section>
            )}

            {/* Collection List */}
            {hasCollection && (
              <section
                ref={managerRef}
                className="p-4 rounded-xl border border-border/50 bg-card/50 backdrop-blur-sm scroll-mt-20"
              >
                <CollectionManager
                  cards={cards}
                  count={count}
                  removeCard={removeCard}
                  updateQuantity={updateQuantity}
                  clearCollection={clearCollection}
                  needsEnrichment={needsEnrichment}
                  isEnriching={isEnriching}
                  enrichProgress={enrichProgress}
                  enrichCollection={enrichCollection}
                  readOnly={selectedBinderId === ALL_BINDERS_ID}
                  selectedColors={selectedColors}
                  onSelectedColorsChange={setSelectedColors}
                  selectedTypes={selectedTypes}
                  onSelectedTypesChange={setSelectedTypes}
                  selectedRarities={selectedRarities}
                  onSelectedRaritiesChange={setSelectedRarities}
                />
              </section>
            )}
          </div>
        </div>
      </main>
    </>
  );
}

function TabButton({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium transition-colors border-b-2 -mb-px shrink-0 ${
        active
          ? 'text-foreground border-primary'
          : 'text-muted-foreground border-transparent hover:text-foreground hover:bg-accent/30'
      }`}
    >
      {icon}
      {label}
    </button>
  );
}
