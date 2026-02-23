import { CollectionImporter } from '@/components/collection/CollectionImporter';
import { CollectionManager } from '@/components/collection/CollectionManager';
import { useCollection } from '@/hooks/useCollection';
import { ArrowLeft, Info } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

export function CollectionPage() {
  const navigate = useNavigate();
  const { count } = useCollection();

  return (
    <main className="flex-1 container mx-auto px-4 py-8 max-w-5xl">
      <div className="aurora-bg" />
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

      <div className="space-y-8">
        {/* Import Section + Info */}
        <div className="grid lg:grid-cols-[1fr_auto] gap-6 items-start">
          <section className="p-4 rounded-xl border border-border/50 bg-card/50 backdrop-blur-sm max-w-2xl">
            <CollectionImporter />
          </section>

          <aside className="p-4 rounded-xl border border-border/50 bg-card/50 backdrop-blur-sm max-w-xs space-y-3">
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
        </div>

        {/* Collection List */}
        {count > 0 && (
          <section className="p-4 rounded-xl border border-border/50 bg-card/50 backdrop-blur-sm">
            <CollectionManager />
          </section>
        )}
      </div>
    </main>
  );
}
