import { CommanderSearch } from '@/components/commander/CommanderSearch';

export function HomePage() {
  return (
    <main className="flex-1 container mx-auto px-4 py-8">
      {/* Hero Section */}
      <div className="text-center py-12 mb-8 animate-fade-in">
        <h2 className="text-4xl font-bold mb-4">
          Build Your{' '}
          <span className="gradient-text">Perfect Deck</span>
        </h2>
        <p className="text-lg text-muted-foreground max-w-xl mx-auto mb-8">
          Choose a commander and we'll generate a complete deck
          optimized for your strategy
        </p>
      </div>

      {/* Commander Selection */}
      <section className="mb-8">
        <div className="flex items-center gap-2 mb-4">
          <div className="w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center text-primary font-bold text-sm">
            1
          </div>
          <h2 className="text-lg font-semibold">Choose Your Commander</h2>
        </div>
        <CommanderSearch />
      </section>
    </main>
  );
}
