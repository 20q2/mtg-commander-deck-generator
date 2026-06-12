import { CollectionCommanders } from '@/components/collection/CollectionCommanders';
import { CollectionImporter } from '@/components/collection/CollectionImporter';
import { CollectionManager } from '@/components/collection/CollectionManager';
import { CollectionStats } from '@/components/collection/CollectionStats';
import { AuroraThemed } from '@/components/ui/AuroraThemed';
import { useCollection } from '@/hooks/useCollection';
import { getAuroraColors } from '@/lib/commanderTheme';
import { ArrowLeft, BarChart3, Crown, Info, Upload } from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';

type TopTab = 'import' | 'stats' | 'commanders';

const RARITY_TO_PRETTY: Record<string, string> = {
  common: 'common', uncommon: 'uncommon', rare: 'rare', mythic: 'mythic',
};

export function CollectionPage() {
  const navigate = useNavigate();
  const { count, cards } = useCollection();
  const [activeTab, setActiveTab] = useState<TopTab>('commanders');

  // Filter state, lifted from CollectionManager so the Statistics tab can drive it.
  const [selectedColors, setSelectedColors] = useState<Set<string>>(new Set());
  const [selectedType, setSelectedType] = useState<string>('');
  const [selectedRarity, setSelectedRarity] = useState<string>('');

  const auroraColors = useMemo(
    () => getAuroraColors([...selectedColors]),
    [selectedColors],
  );

  const hasCollection = count > 0;
  const totalQuantity = useMemo(
    () => cards.reduce((sum, c) => sum + c.quantity, 0),
    [cards],
  );

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
    setSelectedType(prev => (prev === type ? '' : type));
    scrollToManager();
  };
  const handleRarityClick = (rarity: string) => {
    setSelectedRarity(prev => (prev === rarity ? '' : RARITY_TO_PRETTY[rarity] ?? rarity));
    scrollToManager();
  };

  return (
    <>
      <AuroraThemed colors={auroraColors} />
      <main className="flex-1 container mx-auto px-4 py-8 max-w-5xl">
        <button
          onClick={() => navigate(-1)}
          className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors mb-6"
        >
          <ArrowLeft className="w-4 h-4" />
          Back
        </button>

        <div className="space-y-2 mb-8">
          <h2 className="text-2xl font-bold">My Collection</h2>
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

        <div className="space-y-8">
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
              </div>
              <div className={activeTab === 'commanders' ? '' : 'p-4'}>
                {activeTab === 'stats' && (
                  <CollectionStats
                    cards={cards}
                    onColorClick={handleColorClick}
                    onTypeClick={handleTypeClick}
                    onRarityClick={handleRarityClick}
                  />
                )}
                {activeTab === 'import' && <CollectionImporter hideLabel />}
                {activeTab === 'commanders' && <CollectionCommanders cards={cards} />}
              </div>
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
                selectedColors={selectedColors}
                onSelectedColorsChange={setSelectedColors}
                selectedType={selectedType}
                onSelectedTypeChange={setSelectedType}
                selectedRarity={selectedRarity}
                onSelectedRarityChange={setSelectedRarity}
              />
            </section>
          )}
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
