// src/components/poll/PollHero.tsx
export function PollHero() {
  return (
    <div className="text-center py-8 mb-6 animate-fade-in">
      <h1 className="text-4xl font-bold mb-3">
        Community <span className="gradient-text">Poll</span>
      </h1>
      <p className="text-base text-muted-foreground max-w-xl mx-auto leading-relaxed">
        Suggest a feature, or upvote ones you like. Votes are tied to your browser for now
        (accounts later — please don't abuse it 🙏).
      </p>
    </div>
  );
}
