import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { fetchMetrics } from '@/services/analytics';
import { Loader2, BarChart3, Users, Wand2, Calendar, AlertCircle, Globe, Sliders, Zap } from 'lucide-react';


interface FeatureAdoption {
  collectionMode: number;
  hyperFocus: number;
  tinyLeaders: number;
  hasPriceLimit: number;
  hasBudgetLimit: number;
  hasMusts: number;
  hasBans: number;
  deckCount: number;
}

interface MetricsSummary {
  totalEvents: number;
  uniqueUserCount: number;
  eventCounts: Record<string, number>;
  commanderCounts: Record<string, number>;
  archetypeCounts: Record<string, number>;
  dailyCounts: Record<string, number>;
  regionCounts: Record<string, number>;
  featureAdoption: FeatureAdoption;
  settingsCounts: Record<string, Record<string, number>>;
  dateRange: { from: string; to: string };
}

const DAY_OPTIONS = [
  { label: '7d', value: 7 },
  { label: '30d', value: 30 },
  { label: '90d', value: 90 },
];

const EVENT_LABELS: Record<string, string> = {
  commander_searched: 'Commander Searches',
  commander_selected: 'Commander Selections',
  deck_generated: 'Decks Generated',
  deck_generation_failed: 'Generation Failures',
  theme_toggled: 'Theme Toggles',
  collection_imported: 'Collection Imports',
  combos_viewed: 'Combos Viewed',
  page_viewed: 'Page Views',
};

function pct(n: number, total: number) {
  if (!total) return '0%';
  return `${Math.round((n / total) * 100)}%`;
}

function BarRow({ label, count, max }: { label: string; count: number; max: number }) {
  return (
    <div>
      <div className="flex items-center justify-between text-sm mb-1">
        <span className="capitalize">{label}</span>
        <span className="text-muted-foreground tabular-nums">{count}</span>
      </div>
      <div className="h-2 bg-muted rounded-full overflow-hidden">
        <div
          className="h-full bg-primary rounded-full transition-all"
          style={{ width: `${(count / max) * 100}%` }}
        />
      </div>
    </div>
  );
}

export function MetricsPage() {
  if (window.location.hostname !== 'localhost') return null;

  const [data, setData] = useState<MetricsSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [days, setDays] = useState(30);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);
      try {
        const from = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
        const result = await fetchMetrics({ from }) as unknown as MetricsSummary;
        if (!cancelled) setData(result);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load metrics');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => { cancelled = true; };
  }, [days]);

  const deckCount = data?.eventCounts?.deck_generated ?? 0;
  const uniqueCommanders = data ? Object.keys(data.commanderCounts).length : 0;

  const sortedEvents = data
    ? Object.entries(data.eventCounts).sort(([, a], [, b]) => b - a)
    : [];

  const sortedCommanders = data
    ? Object.entries(data.commanderCounts).sort(([, a], [, b]) => b - a).slice(0, 20)
    : [];

  const sortedArchetypes = data
    ? Object.entries(data.archetypeCounts).sort(([, a], [, b]) => b - a)
    : [];
  const maxArchetypeCount = sortedArchetypes.length > 0 ? sortedArchetypes[0][1] : 1;

  const sortedDays = data
    ? Object.entries(data.dailyCounts).sort(([a], [b]) => a.localeCompare(b))
    : [];
  const maxDailyCount = sortedDays.length > 0 ? Math.max(...sortedDays.map(([, v]) => v)) : 1;

  const sortedRegions = data
    ? Object.entries(data.regionCounts).sort(([, a], [, b]) => b - a)
    : [];
  const maxRegionCount = sortedRegions.length > 0 ? sortedRegions[0][1] : 1;

  const fa = data?.featureAdoption;
  const featureRows = fa && fa.deckCount > 0 ? [
    { label: 'Collection Mode', count: fa.collectionMode },
    { label: 'Hyper Focus', count: fa.hyperFocus },
    { label: 'Per-Card Price Cap', count: fa.hasPriceLimit },
    { label: 'Total Budget Limit', count: fa.hasBudgetLimit },
    { label: 'Must-Include Cards', count: fa.hasMusts },
    { label: 'Banned Cards', count: fa.hasBans },
    { label: 'Tiny Leaders', count: fa.tinyLeaders },
  ] : [];

  const sc = data?.settingsCounts;

  return (
    <main className="flex-1 container mx-auto px-4 py-8">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <BarChart3 className="w-6 h-6 text-primary" />
          <h1 className="text-2xl font-bold">Metrics Dashboard</h1>
          <span className="text-xs text-amber-500 bg-amber-500/10 px-2 py-0.5 rounded-full">
            Dev Only
          </span>
        </div>
        <div className="flex gap-1 bg-accent/50 rounded-lg p-1">
          {DAY_OPTIONS.map(opt => (
            <button
              key={opt.value}
              onClick={() => setDays(opt.value)}
              className={`px-3 py-1 text-xs rounded-md transition-colors ${
                days === opt.value
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {loading && (
        <div className="flex flex-col items-center justify-center py-20">
          <Loader2 className="w-8 h-8 animate-spin text-primary mb-3" />
          <p className="text-muted-foreground text-sm">Loading metrics...</p>
        </div>
      )}

      {error && (
        <div className="flex flex-col items-center justify-center py-20">
          <AlertCircle className="w-8 h-8 text-destructive mb-3" />
          <p className="text-destructive text-sm font-medium">{error}</p>
          <p className="text-muted-foreground text-xs mt-1">
            Make sure VITE_ANALYTICS_URL is set and the Lambda is deployed.
          </p>
        </div>
      )}

      {data && !loading && (
        <div className="space-y-6">
          {/* Summary Cards */}
          <div className="grid grid-cols-4 gap-4">
            <Card className="bg-card/80 backdrop-blur-sm">
              <CardContent className="p-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-primary/20 flex items-center justify-center">
                    <Calendar className="w-5 h-5 text-primary" />
                  </div>
                  <div>
                    <p className="text-2xl font-bold">{data.totalEvents.toLocaleString()}</p>
                    <p className="text-xs text-muted-foreground">Total Events</p>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="bg-card/80 backdrop-blur-sm">
              <CardContent className="p-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-green-500/20 flex items-center justify-center">
                    <Wand2 className="w-5 h-5 text-green-500" />
                  </div>
                  <div>
                    <p className="text-2xl font-bold">{deckCount.toLocaleString()}</p>
                    <p className="text-xs text-muted-foreground">Decks Generated</p>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="bg-card/80 backdrop-blur-sm">
              <CardContent className="p-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-blue-500/20 flex items-center justify-center">
                    <Users className="w-5 h-5 text-blue-500" />
                  </div>
                  <div>
                    <p className="text-2xl font-bold">{(data.uniqueUserCount ?? 0).toLocaleString()}</p>
                    <p className="text-xs text-muted-foreground">Unique Users</p>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="bg-card/80 backdrop-blur-sm">
              <CardContent className="p-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-violet-500/20 flex items-center justify-center">
                    <Zap className="w-5 h-5 text-violet-500" />
                  </div>
                  <div>
                    <p className="text-2xl font-bold">{uniqueCommanders.toLocaleString()}</p>
                    <p className="text-xs text-muted-foreground">Unique Commanders</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          <div className="grid md:grid-cols-2 gap-6">
            {/* Event Counts */}
            <Card className="bg-card/80 backdrop-blur-sm">
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Event Breakdown</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {sortedEvents.map(([event, count]) => (
                    <div key={event} className="flex items-center justify-between text-sm">
                      <span className="text-muted-foreground">
                        {EVENT_LABELS[event] ?? event}
                      </span>
                      <span className="font-medium tabular-nums">{count.toLocaleString()}</span>
                    </div>
                  ))}
                  {sortedEvents.length === 0 && (
                    <p className="text-sm text-muted-foreground">No events recorded</p>
                  )}
                </div>
              </CardContent>
            </Card>

            {/* Popular Commanders */}
            <Card className="bg-card/80 backdrop-blur-sm">
              <CardHeader className="pb-3">
                <CardTitle className="text-base">
                  Popular Commanders
                  <span className="ml-2 text-xs font-normal text-muted-foreground">
                    {uniqueCommanders} unique
                  </span>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-1.5">
                  {sortedCommanders.map(([name, count], i) => (
                    <div key={name} className="flex items-center gap-2 text-sm">
                      <span className="text-xs text-muted-foreground w-5 text-right">{i + 1}.</span>
                      <span className="flex-1 truncate">{name}</span>
                      <span className="font-medium tabular-nums text-muted-foreground">{count}</span>
                    </div>
                  ))}
                  {sortedCommanders.length === 0 && (
                    <p className="text-sm text-muted-foreground">No commander data yet</p>
                  )}
                </div>
              </CardContent>
            </Card>

            {/* Regions */}
            <Card className="bg-card/80 backdrop-blur-sm">
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <Globe className="w-4 h-4" />
                  Regions
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {sortedRegions.map(([region, count]) => (
                    <BarRow key={region} label={region} count={count} max={maxRegionCount} />
                  ))}
                  {sortedRegions.length === 0 && (
                    <p className="text-sm text-muted-foreground">No region data yet</p>
                  )}
                </div>
              </CardContent>
            </Card>

            {/* Feature Adoption */}
            <Card className="bg-card/80 backdrop-blur-sm">
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <Zap className="w-4 h-4" />
                  Feature Adoption
                  {fa && fa.deckCount > 0 && (
                    <span className="text-xs font-normal text-muted-foreground ml-1">
                      of {fa.deckCount} decks
                    </span>
                  )}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {featureRows.map(({ label, count }) => (
                    <div key={label} className="flex items-center justify-between text-sm">
                      <span className="text-muted-foreground">{label}</span>
                      <span className="font-medium tabular-nums">
                        {count} <span className="text-muted-foreground text-xs">({pct(count, fa!.deckCount)})</span>
                      </span>
                    </div>
                  ))}
                  {featureRows.length === 0 && (
                    <p className="text-sm text-muted-foreground">No deck data yet</p>
                  )}
                </div>
              </CardContent>
            </Card>

            {/* Archetype Distribution */}
            <Card className="bg-card/80 backdrop-blur-sm">
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Archetype Distribution</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {sortedArchetypes.map(([archetype, count]) => (
                    <BarRow key={archetype} label={archetype} count={count} max={maxArchetypeCount} />
                  ))}
                  {sortedArchetypes.length === 0 && (
                    <p className="text-sm text-muted-foreground">No archetype data yet</p>
                  )}
                </div>
              </CardContent>
            </Card>

            {/* Daily Activity */}
            <Card className="bg-card/80 backdrop-blur-sm">
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Daily Activity</CardTitle>
              </CardHeader>
              <CardContent>
                {sortedDays.length > 0 ? (
                  <div className="flex items-end gap-[2px] h-32">
                    {sortedDays.map(([day, count]) => (
                      <div
                        key={day}
                        className="flex-1 bg-primary/80 rounded-t-sm hover:bg-primary transition-colors group relative"
                        style={{ height: `${(count / maxDailyCount) * 100}%`, minHeight: 2 }}
                        title={`${day}: ${count} events`}
                      >
                        <div className="absolute -top-6 left-1/2 -translate-x-1/2 text-[9px] text-muted-foreground opacity-0 group-hover:opacity-100 whitespace-nowrap pointer-events-none">
                          {count}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">No daily data yet</p>
                )}
                {sortedDays.length > 0 && (
                  <div className="flex justify-between text-[10px] text-muted-foreground mt-1">
                    <span>{sortedDays[0][0]}</span>
                    <span>{sortedDays[sortedDays.length - 1][0]}</span>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Settings Distribution */}
          {sc && (
            <Card className="bg-card/80 backdrop-blur-sm">
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <Sliders className="w-4 h-4" />
                  Settings Distribution
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
                  {[
                    { key: 'budgetOption', label: 'Budget Option' },
                    { key: 'bracketLevel', label: 'Bracket Level' },
                    { key: 'maxRarity', label: 'Max Rarity' },
                    { key: 'gameChangerLimit', label: 'Game Changer Limit' },
                  ].map(({ key, label }) => {
                    const entries = Object.entries(sc[key] ?? {}).sort(([, a], [, b]) => b - a);
                    const maxVal = entries.length > 0 ? entries[0][1] : 1;
                    return (
                      <div key={key}>
                        <p className="text-xs font-medium text-muted-foreground mb-2">{label}</p>
                        <div className="space-y-1.5">
                          {entries.map(([val, count]) => (
                            <BarRow key={val} label={val} count={count} max={maxVal} />
                          ))}
                          {entries.length === 0 && (
                            <p className="text-xs text-muted-foreground">No data yet</p>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      )}
    </main>
  );
}
