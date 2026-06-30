import { create } from 'zustand';
import type { AppState, Customization, BanList, AppliedList, ScryfallCard, GeneratedDeck, EDHRECTheme, ThemeResult, DeckHistoryEntry, DeckHistoryAction } from '@/types';
import { isEuropean } from '@/lib/region';
import { swapCard, addCard } from '@/services/deckBuilder/cardSwap';
import { serializeBrew, deserializeBrew } from '@/services/brew/persistCodec';
import { nextRoutes, openNode, buildPackNode, applyPick, undoLast, advanceAfterPick, isComplete, discoverFrom, discoverClustersFrom, nextQuestion, applyAnswer, nextEvent, applyEvent, gambleEvent, shouldOfferRelic, offerRelics, applyRelic, relicMult, MIN_MOMENT_GAP, commitImpact, commitSeeds, brewGoal, goalProgress, type BrewContext, type BrewRoute, type BrewOption, type BrewState, type BrewPick, type BrewAnswer, type BrewEvent, type BrewRelic, type BrewCelebration } from '@/services/brew/engine';

/** Deck-fill fraction past which the whole-deck lift-cluster scan starts (a few packs in / foundation set). */
const CLUSTER_PHASE_FILL = 0.4;
/** Re-scan once this many new picks have landed since the last scan, so cluster finds track the deck. */
const CLUSTER_RESCAN_STEP = 5;

/** Picks at which a mid-build personality question may replace the bare fork. */
const SECOND_QUESTION_AT = 8;

/**
 * Decide the next brew screen after any state change (pick / event / relic / undo). At a steering
 * milestone the engine surfaces — in priority order — a relic offer, then an event "moment", then a
 * personality question, else the bare fork. Between milestones it auto-routes to the next card node.
 * Pure: returns the store patch; the caller merges it and fires discovery expansion.
 */
function brewAdvancePatch(ctx: BrewContext, nextState: BrewState): {
  brewState: BrewState; brewRoutes: BrewRoute[]; brewNode: ReturnType<typeof advanceAfterPick>;
  brewQuestion: ReturnType<typeof nextQuestion>; brewEvent: BrewEvent | null; brewRelicOffer: BrewRelic[] | null;
  brewRerollExclusions: string[];
} {
  const node = advanceAfterPick(ctx, nextState);
  const atSteer = node === null;
  const momentGapOk = nextState.picks.length - nextState.lastMomentPick >= MIN_MOMENT_GAP;
  let brewRelicOffer: BrewRelic[] | null = null;
  let brewEvent: BrewEvent | null = null;
  let brewQuestion: ReturnType<typeof nextQuestion> = null;
  if (atSteer && !isComplete(ctx, nextState)) {
    if (momentGapOk && shouldOfferRelic(nextState)) {
      const relics = offerRelics(ctx, nextState);
      if (relics.length > 0) brewRelicOffer = relics;
    }
    if (!brewRelicOffer) brewEvent = nextEvent(ctx, nextState);          // nextEvent enforces its own gap
    if (!brewRelicOffer && !brewEvent && nextState.picks.length >= SECOND_QUESTION_AT) {
      brewQuestion = nextQuestion(ctx, nextState);
    }
  }
  return {
    brewState: nextState,
    brewRoutes: nextRoutes(ctx, nextState),
    brewNode: node,
    brewQuestion,
    brewEvent,
    brewRelicOffer,
    brewRerollExclusions: [],
  };
}

const BANNED_CARDS_KEY = 'mtg-deck-builder-banned-cards';
const MUST_INCLUDE_CARDS_KEY = 'mtg-deck-builder-must-include-cards';
const CURRENCY_KEY = 'mtg-deck-builder-currency';
const BAN_LISTS_KEY = 'mtg-deck-builder-ban-lists';
const APPLIED_EXCLUDE_LISTS_KEY = 'mtg-deck-builder-applied-exclude-lists';
const APPLIED_INCLUDE_LISTS_KEY = 'mtg-deck-builder-applied-include-lists';
const ARENA_ONLY_KEY = 'mtg-deck-builder-arena-only';
const BREW_STATS_OPEN_KEY = 'mtg-deck-builder-brew-stats-open';

// The brew stats rail defaults to shown; the toggle in the health strip persists the choice.
function loadBrewStatsOpen(): boolean {
  try {
    return localStorage.getItem(BREW_STATS_OPEN_KEY) !== 'false';
  } catch {
    return true;
  }
}

// Load banned cards from localStorage
function loadBannedCards(): string[] {
  try {
    const stored = localStorage.getItem(BANNED_CARDS_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      if (Array.isArray(parsed)) {
        return parsed;
      }
    }
  } catch (e) {
    console.warn('Failed to load banned cards from localStorage:', e);
  }
  return [];
}

// Save banned cards to localStorage
function saveBannedCards(cards: string[]): void {
  try {
    localStorage.setItem(BANNED_CARDS_KEY, JSON.stringify(cards));
  } catch (e) {
    console.warn('Failed to save banned cards to localStorage:', e);
  }
}

// Load must-include cards from localStorage
function loadMustIncludeCards(): string[] {
  try {
    const stored = localStorage.getItem(MUST_INCLUDE_CARDS_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      if (Array.isArray(parsed)) {
        return parsed;
      }
    }
  } catch (e) {
    console.warn('Failed to load must-include cards from localStorage:', e);
  }
  return [];
}

// Save must-include cards to localStorage
function saveMustIncludeCards(cards: string[]): void {
  try {
    localStorage.setItem(MUST_INCLUDE_CARDS_KEY, JSON.stringify(cards));
  } catch (e) {
    console.warn('Failed to save must-include cards to localStorage:', e);
  }
}

// Load currency from localStorage, falling back to region detection
function loadCurrency(): 'USD' | 'EUR' {
  try {
    const stored = localStorage.getItem(CURRENCY_KEY);
    if (stored === 'USD' || stored === 'EUR') return stored;
  } catch (e) {
    console.warn('Failed to load currency from localStorage:', e);
  }
  return isEuropean() ? 'EUR' : 'USD';
}

// Save currency to localStorage
function saveCurrency(currency: 'USD' | 'EUR'): void {
  try {
    localStorage.setItem(CURRENCY_KEY, currency);
  } catch (e) {
    console.warn('Failed to save currency to localStorage:', e);
  }
}

// Load ban lists from localStorage
function loadBanLists(): BanList[] {
  try {
    const stored = localStorage.getItem(BAN_LISTS_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      if (Array.isArray(parsed)) {
        return parsed;
      }
    }
  } catch (e) {
    console.warn('Failed to load ban lists from localStorage:', e);
  }
  return [];
}

// Save ban lists to localStorage
function saveBanLists(lists: BanList[]): void {
  try {
    localStorage.setItem(BAN_LISTS_KEY, JSON.stringify(lists));
  } catch (e) {
    console.warn('Failed to save ban lists to localStorage:', e);
  }
}

// Load applied exclude lists from localStorage
function loadAppliedExcludeLists(): AppliedList[] {
  try {
    const stored = localStorage.getItem(APPLIED_EXCLUDE_LISTS_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      if (Array.isArray(parsed)) return parsed;
    }
  } catch (e) {
    console.warn('Failed to load applied exclude lists from localStorage:', e);
  }
  return [];
}

// Save applied exclude lists to localStorage
function saveAppliedExcludeLists(lists: AppliedList[]): void {
  try {
    localStorage.setItem(APPLIED_EXCLUDE_LISTS_KEY, JSON.stringify(lists));
  } catch (e) {
    console.warn('Failed to save applied exclude lists to localStorage:', e);
  }
}

// Load applied include lists from localStorage
function loadAppliedIncludeLists(): AppliedList[] {
  try {
    const stored = localStorage.getItem(APPLIED_INCLUDE_LISTS_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      if (Array.isArray(parsed)) return parsed;
    }
  } catch (e) {
    console.warn('Failed to load applied include lists from localStorage:', e);
  }
  return [];
}

// Save applied include lists to localStorage
function saveAppliedIncludeLists(lists: AppliedList[]): void {
  try {
    localStorage.setItem(APPLIED_INCLUDE_LISTS_KEY, JSON.stringify(lists));
  } catch (e) {
    console.warn('Failed to save applied include lists to localStorage:', e);
  }
}

// Load arena-only setting from localStorage
function loadArenaOnly(): boolean {
  try {
    return localStorage.getItem(ARENA_ONLY_KEY) === 'true';
  } catch {
    return false;
  }
}

// Save arena-only setting to localStorage
function saveArenaOnly(value: boolean): void {
  try {
    localStorage.setItem(ARENA_ONLY_KEY, String(value));
  } catch {
    // ignore
  }
}

const defaultCustomization: Customization = {
  deckFormat: 99,
  landCount: 37,
  nonBasicLandCount: 15, // Default to 15 non-basics, rest will be basics
  bannedCards: loadBannedCards(), // Load from localStorage
  banLists: loadBanLists(), // Load from localStorage
  mustIncludeCards: loadMustIncludeCards(), // Load from localStorage
  tempBannedCards: [],
  tempMustIncludeCards: [],
  maxCardPrice: null, // No limit by default
  deckBudget: null, // No total deck budget by default
  budgetOption: 'any' as const, // Default to normal card pool
  gameChangerLimit: 'unlimited' as const,
  bracketLevel: 'all' as const,
  allowedRarities: null,
  tinyLeaders: false,
  ignoreOwnedBudget: false,
  ignoreOwnedRarity: false,
  collectionMode: false,
  collectionStrategy: 'full' as const,
  collectionOwnedPercent: 75,
  arenaOnly: loadArenaOnly(),
  scryfallQuery: '',
  comboCount: 1,
  hyperFocus: false,
  balancedRoles: true,
  currency: loadCurrency(),
  appliedExcludeLists: loadAppliedExcludeLists(),
  appliedIncludeLists: loadAppliedIncludeLists(),
  advancedTargets: { curvePercentages: null, typePercentages: null, roleTargets: null, edhrecBlendWeight: null, edhrecInclusionThreshold: null },
  tempoAutoDetect: true,
  tempoPacing: 'balanced' as const,
};

export const useStore = create<AppState>((set, get) => ({
  // Commander
  commander: null,
  partnerCommander: null,
  colorIdentity: [],

  // EDHREC Themes
  edhrecThemes: [],
  selectedThemes: [],
  themesLoading: false,
  themesError: null,
  themeSource: 'local',
  edhrecNumDecks: null,
  pendingStrategySlug: null,
  edhrecLandSuggestion: null,
  edhrecStats: null,
  userEditedLands: false,

  // Customization
  customization: defaultCustomization,

  // Deck
  generatedDeck: null,
  deckHistory: [],

  // Brew session
  brewContext: null,
  brewState: null,
  brewRoutes: [],
  brewNode: null,
  brewQuestion: null,
  brewEvent: null,
  brewRelicOffer: null,
  brewCommitFlash: null,
  brewCelebration: null,
  brewRerollExclusions: [],
  brewStatsOpen: loadBrewStatsOpen(),

  // UI
  isLoading: false,
  loadingMessage: '',
  error: null,
  isModifyMode: false,

  // Actions
  setCommander: (card: ScryfallCard | null) => set((state) => {
    const partnerIdentity = state.partnerCommander?.color_identity || [];
    const commanderIdentity = card?.color_identity || [];
    const combined = [...new Set([...commanderIdentity, ...partnerIdentity])];
    // Only wipe the deck/theme state when the commander actually changes.
    // Re-setting the same commander (e.g. on a page refresh that re-fetches it)
    // would otherwise clobber a deck restored from sessionStorage.
    const sameCommander = state.commander?.name === card?.name;

    return {
      commander: card,
      colorIdentity: combined,
      ...(sameCommander ? {} : { generatedDeck: null }), // Reset deck when commander changes
      // Reset theme state when commander changes
      edhrecThemes: [],
      selectedThemes: [],
      themesLoading: false,
      themesError: null,
      themeSource: 'local',
      edhrecNumDecks: null,
      edhrecLandSuggestion: null,
      edhrecStats: null,
      userEditedLands: false,
      deckHistory: [],
    };
  }),

  setPartnerCommander: (card: ScryfallCard | null) => set((state) => {
    const commanderIdentity = state.commander?.color_identity || [];
    const partnerIdentity = card?.color_identity || [];
    const combined = [...new Set([...commanderIdentity, ...partnerIdentity])];
    // Avoid wiping a deck restored from sessionStorage on refresh (see setCommander).
    const samePartner = (state.partnerCommander?.name ?? null) === (card?.name ?? null);

    return {
      partnerCommander: card,
      colorIdentity: combined,
      ...(samePartner ? {} : { generatedDeck: null }),
      // Reset theme state when partner changes
      edhrecThemes: [],
      selectedThemes: [],
      themesLoading: false,
      themesError: null,
      themeSource: 'local',
      edhrecNumDecks: null,
      edhrecStats: null,
      deckHistory: [],
    };
  }),

  setEdhrecThemes: (themes: EDHRECTheme[]) => set({
    edhrecThemes: themes,
    themeSource: 'edhrec',
    themesError: null,
  }),

  setEdhrecNumDecks: (count) => set({ edhrecNumDecks: count }),

  setEdhrecLandSuggestion: (suggestion) => set({ edhrecLandSuggestion: suggestion }),
  setEdhrecStats: (stats) => set({ edhrecStats: stats }),

  setSelectedThemes: (themes: ThemeResult[]) => set({ selectedThemes: themes }),

  setPendingStrategySlug: (slug: string | null) => set({ pendingStrategySlug: slug }),

  toggleThemeSelection: (themeName: string) => set((state) => {
    const updated = state.selectedThemes.map((t) =>
      t.name === themeName ? { ...t, isSelected: !t.isSelected } : t
    );
    return { selectedThemes: updated };
  }),

  setThemesLoading: (loading: boolean) => set({ themesLoading: loading }),

  setThemesError: (error: string | null) => set((state) => ({
    themesError: error,
    themeSource: error ? 'local' : state.themeSource,
  })),

  updateCustomization: (updates: Partial<Customization>) => set((state) => {
    const newCustomization = { ...state.customization, ...updates };

    // Persist banned cards to localStorage when they change
    if (updates.bannedCards !== undefined) {
      saveBannedCards(newCustomization.bannedCards);
    }

    // Persist must-include cards to localStorage when they change
    if (updates.mustIncludeCards !== undefined) {
      saveMustIncludeCards(newCustomization.mustIncludeCards);
    }

    // Persist ban lists to localStorage when they change
    if (updates.banLists !== undefined) {
      saveBanLists(newCustomization.banLists);
    }

    // Persist currency to localStorage when it changes
    if (updates.currency !== undefined) {
      saveCurrency(newCustomization.currency);
    }

    // Persist applied exclude lists to localStorage when they change
    if (updates.appliedExcludeLists !== undefined) {
      saveAppliedExcludeLists(newCustomization.appliedExcludeLists);
    }

    // Persist applied include lists to localStorage when they change
    if (updates.appliedIncludeLists !== undefined) {
      saveAppliedIncludeLists(newCustomization.appliedIncludeLists);
    }

    // Persist arena-only setting to localStorage when it changes
    if (updates.arenaOnly !== undefined) {
      saveArenaOnly(newCustomization.arenaOnly);
    }

    return { customization: newCustomization };
  }),

  setGeneratedDeck: (deck: GeneratedDeck | null) => set({ generatedDeck: deck }),
  swapDeckCard: (oldCard: ScryfallCard, newCard: ScryfallCard) => {
    const { generatedDeck } = get();
    if (!generatedDeck) return;
    const result = swapCard(generatedDeck, oldCard, newCard);
    if (result.success) {
      set({ generatedDeck: result.deck });
    } else {
      console.warn('[Store] Card swap failed:', result.error);
    }
  },

  addDeckCard: (newCard: ScryfallCard) => {
    const { generatedDeck } = get();
    if (!generatedDeck) return;
    const result = addCard(generatedDeck, newCard);
    if (result.success) {
      set({ generatedDeck: result.deck });
    } else {
      console.warn('[Store] Card add failed:', result.error);
    }
  },

  pushDeckHistory: (entry) => set((state) => {
    const newEntry: DeckHistoryEntry = {
      ...entry,
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      timestamp: Date.now(),
    };
    return { deckHistory: [newEntry, ...state.deckHistory].slice(0, 50) };
  }),

  popLatestHistoryEntries: (action: DeckHistoryAction, cardNames: string[]) => set((state) => {
    const remaining = new Map<string, number>();
    for (const name of cardNames) {
      remaining.set(name, (remaining.get(name) ?? 0) + 1);
    }
    const filtered: DeckHistoryEntry[] = [];
    for (const entry of state.deckHistory) {
      const need = remaining.get(entry.cardName) ?? 0;
      if (entry.action === action && need > 0) {
        remaining.set(entry.cardName, need - 1);
        continue;
      }
      filtered.push(entry);
    }
    return { deckHistory: filtered };
  }),

  clearDeckHistory: () => set({ deckHistory: [] }),

  startBrewSession: (ctx: BrewContext) => {
    const state: BrewState = {
      picks: [], usedNames: [], themeAffinity: {}, rerollsUsed: {}, phase: 'nonland', history: [],
      discovered: [], seededNames: [], questionsAsked: 0,
      relics: [], comboWatch: [], firedEventIds: [], lastMomentPick: 0, moments: [],
      synergyStreak: 0, goalDone: false,
      // Per-run jitter seed: minted once here, persisted with the session, so offers vary run-to-run
      // while a single run stays stable across resume/undo. (1..2^32 so it's always truthy.)
      seed: Math.floor(Math.random() * 0xfffffffe) + 1,
    };
    // No opening theme prompt — drop the player straight onto the first pack and let the deck's
    // identity emerge from what they actually pick.
    set({ brewContext: ctx, brewState: state, brewRoutes: nextRoutes(ctx, state),
      brewNode: buildPackNode(ctx, state), brewQuestion: null,
      brewEvent: null, brewRelicOffer: null, brewCommitFlash: null, brewCelebration: null, brewRerollExclusions: [] });
  },

  openBrewRoute: (route: BrewRoute) => {
    const { brewContext, brewState } = get();
    if (!brewContext || !brewState) return;
    // The Gamble route resolves through the gamble EVENT — a reveal + "take the leap", where the
    // leap locks the pick and seeds fresh discoveries. Reuse that whole beat instead of a plain node.
    if (route.type === 'gamble') {
      const event = gambleEvent(brewContext, brewState);
      if (event) { set({ brewEvent: event, brewNode: null, brewRerollExclusions: [] }); return; }
      // No eligible deep cut left (nextRoutes should suppress the route in this case, but guard here
      // too): openNode has no 'gamble' case and would render a card-less, can't-pass dead-end. Drop the
      // player onto a fresh pack instead so the fork stays playable.
      set({ brewNode: buildPackNode(brewContext, brewState), brewRerollExclusions: [] });
      return;
    }
    const node = openNode(brewContext, brewState, route);
    set({ brewNode: node, brewRerollExclusions: [] });
  },

  answerBrewQuestion: (answer: BrewAnswer | null) => {
    const { brewContext, brewState } = get();
    if (!brewContext || !brewState) return;
    const nextState = applyAnswer(brewState, answer);
    // Answering steers affinity, then drops the player on the fork to choose their next move.
    set({ brewState: nextState, brewRoutes: nextRoutes(brewContext, nextState),
      brewQuestion: null, brewNode: null, brewEvent: null, brewRelicOffer: null, brewRerollExclusions: [] });
  },

  applyBrewOption: (option: BrewOption, passedNames: string[]) => {
    const { brewContext, brewState, brewNode } = get();
    if (!brewContext || !brewState || !brewNode) return;
    const picks: BrewPick[] = option.cards.map((c, i) => ({
      name: c.name, card: c.scryfall, role: c.role, subtype: c.subtype, inclusion: c.inclusion,
      viaRouteId: brewNode.routeId, reasons: option.reasons[i] ?? [],
    }));
    // Affinity tags: the card's EDHREC theme memberships drive deck-identity compounding;
    // subtype is retained so functional packages (counterspells, tutors) still cohere.
    const tags: Record<string, string[]> = {};
    for (const c of option.cards) {
      const t = [...c.themeTags];
      if (c.subtype) t.push(c.subtype);
      tags[c.name] = t;
    }
    // A secret gold card (rare, theme packs only) rides along as a free extra pick — committed in the
    // same (undoable) decision, with its own affinity, plus a story moment for the end-run recap.
    const gold = option.goldCard;
    if (gold) {
      picks.push({ name: gold.name, card: gold.scryfall, role: gold.role, subtype: gold.subtype,
        inclusion: gold.inclusion, viaRouteId: brewNode.routeId, reasons: [] });
      const t = [...gold.themeTags];
      if (gold.subtype) t.push(gold.subtype);
      tags[gold.name] = t;
    }
    // Rotate packs across a 2-round window: on a fresh pack round, shift the just-shown keys into
    // lastPackKeys and the previous round's into prevPackKeys, so the next two rounds hold both back
    // (less "same 3 themes every time"). A draft/combo pick isn't a pack round → leave the window be.
    const wasBundle = brewNode.type === 'bundle';
    const nextLastPackKeys = wasBundle ? brewNode.options.map(o => o.id) : brewState.lastPackKeys;
    const nextPrevPackKeys = wasBundle ? brewState.lastPackKeys : brewState.prevPackKeys;
    let nextState = applyPick(brewState, picks, { routeType: brewNode.type, passed: passedNames, tags });
    nextState = { ...nextState, lastPackKeys: nextLastPackKeys, prevPackKeys: nextPrevPackKeys };
    if (gold) {
      nextState = { ...nextState, moments: [...nextState.moments,
        { atPick: nextState.picks.length, kind: 'goldCard', label: `Struck gold — ${gold.name}`, detail: 'Hidden in the pack' }] };
    }
    // Completing a combo via the Combos route is a story beat too (not just the Combo-Fragment event):
    // log it so the recap reflects the kill you assembled, not only event-sourced moments.
    if (brewNode.type === 'combo') {
      const payoff = option.label ?? 'a combo';
      const added = option.cards.map(c => c.name).join(' + ');
      nextState = { ...nextState, moments: [...nextState.moments,
        { atPick: nextState.picks.length, kind: 'comboFragment', label: `Completed ${payoff}`, detail: added || undefined }] };
    }
    // Earned-beat celebrations (the "juice"): one toast per decision, highest-priority beat wins.
    //  1) the Brewer's Goal just completed (latches via goalDone so it fires once),
    //  2) a combo just came online (the route pick), or
    //  3) a synergy-streak milestone. The toast auto-dismisses; null leaves any prior one to fade.
    let celebration: BrewCelebration | null = null;
    if (!brewState.goalDone && !goalProgress(brewContext, brewState).done && goalProgress(brewContext, nextState).done) {
      nextState = { ...nextState, goalDone: true };
      celebration = { kind: 'goal', title: 'Goal complete!', subtitle: brewGoal(brewContext).label };
    } else if (brewNode.type === 'combo') {
      celebration = { kind: 'combo', title: 'Combo online!', subtitle: option.label };
    } else if ([3, 6, 9, 12].includes(nextState.synergyStreak ?? 0)) {
      celebration = { kind: 'streak', title: 'On a roll!', subtitle: `${nextState.synergyStreak} synergy picks in a row` };
    }

    // You shouldn't have to choose a path after every pick: auto-advance to the next card screen,
    // surfacing the steering fork (and its relic/event/question moments) only at milestones.
    const patch = brewAdvancePatch(brewContext, nextState);
    set(celebration ? { ...patch, brewCelebration: celebration } : patch);
    // At steering milestones (no auto-advance node) and while the deck is still building,
    // expand the pool from the player's recent threads. Fire-and-forget; UI never blocks.
    if (patch.brewNode === null && !isComplete(brewContext, nextState)) {
      void get().expandBrewDiscoveries();
      // Once the deck has a shape, run the heavier whole-deck cluster scan — and re-run it every few
      // picks so the "plays with your deck" finds keep reflecting what you've actually drafted.
      const fill = nextState.picks.length / (brewContext.nonLandTarget || 1);
      const sinceScan = nextState.picks.length - (nextState.clusterScanPicks ?? -CLUSTER_RESCAN_STEP);
      if (fill >= CLUSTER_PHASE_FILL && sinceScan >= CLUSTER_RESCAN_STEP) {
        void get().expandBrewClusters();
      }
    }
  },

  chooseBrewEvent: (choiceId: string) => {
    const { brewContext, brewState, brewEvent } = get();
    if (!brewContext || !brewState || !brewEvent) return;
    const isCommit = brewEvent.kind === 'crossroads' && choiceId.startsWith('commit:');
    // A taken gamble seeds fresh discoveries from the off-meta card — its "opens new paths" payoff.
    const gambleSeed = brewEvent.kind === 'gamble' && choiceId === 'leap' ? brewEvent.card?.name : undefined;
    const nextState = applyEvent(brewContext, brewState, brewEvent, choiceId);
    const patch = brewAdvancePatch(brewContext, nextState);
    set(patch);
    if (gambleSeed) void get().gambleDiscover(gambleSeed);
    if (isCommit) {
      // Show the consequence immediately (suppressed count is synchronous); the injected count
      // fills in once the async theme fetch resolves.
      const slug = choiceId.slice('commit:'.length);
      const { suppressed } = commitImpact(brewContext, nextState, slug);
      set({ brewCommitFlash: { theme: brewContext.themeNames[slug] ?? slug, injected: 0, suppressed } });
      void get().injectCommitTheme(slug);
    }
    // Keep the discovery pool growing after a moment, so the next Strange Signal has fuel.
    if (patch.brewNode === null && !isComplete(brewContext, nextState)) {
      void get().expandBrewDiscoveries();
    }
  },

  injectCommitTheme: async (slug: string) => {
    const { brewContext, brewState } = get();
    if (!brewContext || !brewState) return;
    const seeds = commitSeeds(brewContext, slug).filter(n => !brewState.seededNames.includes(n));
    if (seeds.length === 0) return;
    const found = await discoverFrom(seeds, brewContext, brewState);
    // Re-read; bail if the session changed under us.
    const cur = get();
    if (cur.brewContext !== brewContext || !cur.brewState) return;
    const existing = new Set(cur.brewState.discovered.map(c => c.name));
    // Stamp the committed theme tag so injected cards read as on-theme and dodge the soft-remove penalty.
    const fresh = found
      .filter(c => !existing.has(c.name))
      .map(c => ({ ...c, themeTags: [...new Set([...c.themeTags, slug])] }));
    const merged: BrewState = {
      ...cur.brewState,
      discovered: [...cur.brewState.discovered, ...fresh],
      seededNames: [...cur.brewState.seededNames, ...seeds],
    };
    set({
      brewState: merged,
      brewRoutes: nextRoutes(brewContext, merged),
      brewCommitFlash: cur.brewCommitFlash ? { ...cur.brewCommitFlash, injected: fresh.length } : null,
    });
  },

  setBrewCommitFlash: (flash) => set({ brewCommitFlash: flash }),

  setBrewCelebration: (celebration) => set({ brewCelebration: celebration }),

  pinBrewCard: (name: string) => {
    const { brewContext, brewState } = get();
    if (!brewContext || !brewState) return;
    const cur = brewState.pinnedNames ?? [];
    const pinnedNames = cur.includes(name) ? cur.filter(n => n !== name) : [...cur, name];
    const next: BrewState = { ...brewState, pinnedNames };
    set({ brewState: next });
  },

  gambleDiscover: async (name: string) => {
    const { brewContext, brewState } = get();
    if (!brewContext || !brewState) return;
    const found = await discoverFrom([name], brewContext, brewState);
    // Re-read; bail if the session changed under us.
    const cur = get();
    if (cur.brewContext !== brewContext || !cur.brewState) return;
    const existing = new Set(cur.brewState.discovered.map(c => c.name));
    const fresh = found.filter(c => !existing.has(c.name));
    if (fresh.length === 0) return;
    const merged: BrewState = {
      ...cur.brewState,
      discovered: [...cur.brewState.discovered, ...fresh],
      seededNames: [...cur.brewState.seededNames, name],
    };
    set({ brewState: merged, brewRoutes: nextRoutes(brewContext, merged) });
  },

  chooseBrewRelic: (relic: BrewRelic) => {
    const { brewContext, brewState } = get();
    if (!brewContext || !brewState) return;
    const nextState = applyRelic(brewState, relic);
    set(brewAdvancePatch(brewContext, nextState));
  },

  expandBrewDiscoveries: async () => {
    const { brewContext, brewState } = get();
    if (!brewContext || !brewState) return;
    // Seeds: recent picks not yet seeded, the most-defining (highest inclusion) first. An
    // Archivist's Eye relic (discoveryRate) widens the net so more hidden synergies surface.
    const seedCap = Math.round(3 * relicMult(brewState.relics, 'discoveryRate'));
    const seededSet = new Set(brewState.seededNames);
    const seeds = brewState.picks
      .filter(p => !seededSet.has(p.name))
      .sort((a, b) => b.inclusion - a.inclusion)
      .slice(0, seedCap)
      .map(p => p.name);
    if (seeds.length === 0) return;
    // Optimistically mark seeds so a re-fire doesn't duplicate work.
    set({ brewState: { ...brewState, seededNames: [...brewState.seededNames, ...seeds] } });

    const found = await discoverFrom(seeds, brewContext, brewState);
    if (found.length === 0) return;

    // Re-read; bail if the session changed under us.
    const cur = get();
    if (cur.brewContext !== brewContext || !cur.brewState) return;
    const existing = new Set(cur.brewState.discovered.map(c => c.name));
    const fresh = found.filter(c => !existing.has(c.name));
    if (fresh.length === 0) return;
    const merged: BrewState = { ...cur.brewState, discovered: [...cur.brewState.discovered, ...fresh] };
    set({ brewState: merged, brewRoutes: nextRoutes(brewContext, merged) });
  },

  // The whole-deck lift-cluster scan: treats every card so far as a seed and surfaces cards lifted by
  // MANY of your picks ("N of your cards want this"). Heavier than single-seed discovery (O(picks)
  // cached EDHREC fetches), so it's fire-and-forget and re-runs on a coarse cadence as the deck grows.
  expandBrewClusters: async () => {
    const { brewContext, brewState } = get();
    if (!brewContext || !brewState) return;
    // Stamp the scan pick-count up front so overlapping milestones don't double-scan.
    set({ brewState: { ...brewState, clusterScanPicks: brewState.picks.length } });
    const found = await discoverClustersFrom(brewContext, brewState, () => get().brewContext !== brewContext);
    if (found.length === 0) return;
    const cur = get();
    if (cur.brewContext !== brewContext || !cur.brewState) return;
    const existing = new Set(cur.brewState.discovered.map(c => c.name));
    const fresh = found.filter(c => !existing.has(c.name));
    if (fresh.length === 0) return;
    const merged: BrewState = { ...cur.brewState, discovered: [...cur.brewState.discovered, ...fresh] };
    set({ brewState: merged, brewRoutes: nextRoutes(brewContext, merged) });
  },

  backToBrewFork: () => set({ brewNode: null, brewQuestion: null, brewEvent: null, brewRelicOffer: null, brewRerollExclusions: [] }),

  undoBrewPick: () => {
    const { brewContext, brewState } = get();
    if (!brewContext || !brewState) return;
    // undoLast refuses to revert a committed (event-sourced) pick — the "accept fate" beat.
    const reverted = undoLast(brewState);
    set({ brewState: reverted, brewRoutes: nextRoutes(brewContext, reverted), brewNode: null, brewQuestion: null, brewEvent: null, brewRelicOffer: null, brewRerollExclusions: [] });
  },

  rerollBrew: () => {
    const { brewContext, brewState, brewNode, brewRerollExclusions } = get();
    if (!brewContext || !brewState) return;
    // Cap rerolls per view via rerollsUsed keyed by node/fork id (lightning gets an extra — see rerollLimit).
    const key = brewNode?.routeId ?? 'fork';
    const used = brewState.rerollsUsed[key] ?? 0;
    if (used >= rerollLimit(brewNode?.type)) return;
    // Exclude currently-shown cards by merging them into a transient usedNames for the next draw.
    const shown = brewNode ? brewNode.options.flatMap(o => o.cards.map(c => c.name)) : [];
    const exclusions = [...brewRerollExclusions, ...shown];
    const transient: BrewState = {
      ...brewState,
      usedNames: [...brewState.usedNames, ...exclusions],
      rerollsUsed: { ...brewState.rerollsUsed, [key]: used + 1 },
    };
    if (brewNode) {
      const route = get().brewRoutes.find(r => r.id === brewNode.routeId);
      const node = route ? openNode(brewContext, transient, route) : null;
      set({ brewState: { ...brewState, rerollsUsed: transient.rerollsUsed }, brewNode: node, brewRerollExclusions: exclusions });
    } else {
      set({ brewState: { ...brewState, rerollsUsed: transient.rerollsUsed }, brewRoutes: nextRoutes(brewContext, transient), brewRerollExclusions: exclusions });
    }
  },

  clearBrewSession: () => set({ brewContext: null, brewState: null, brewRoutes: [], brewNode: null, brewQuestion: null, brewEvent: null, brewRelicOffer: null, brewCommitFlash: null, brewCelebration: null, brewRerollExclusions: [] }),

  toggleBrewStats: (open) => set((s) => {
    const next = open ?? !s.brewStatsOpen;
    try { localStorage.setItem(BREW_STATS_OPEN_KEY, String(next)); } catch { /* ignore */ }
    return { brewStatsOpen: next };
  }),

  setLoading: (loading: boolean, message = '') => set({
    isLoading: loading,
    loadingMessage: message,
  }),

  setError: (error: string | null) => set({ error }),

  setModifyMode: (on: boolean) => set({ isModifyMode: on }),

  reset: () => set((state) => ({
    commander: null,
    partnerCommander: null,
    colorIdentity: [],
    edhrecThemes: [],
    selectedThemes: [],
    themesLoading: false,
    themesError: null,
    themeSource: 'local',
    edhrecNumDecks: null,
    pendingStrategySlug: null,
    userEditedLands: false,
    // Preserve all customization settings when switching commanders
    customization: state.customization,
    generatedDeck: null,
    deckHistory: [],
    isLoading: false,
    loadingMessage: '',
    error: null,
  })),
}));

/**
 * How many times a view may be rerolled before "Show different" is exhausted. A curation nudge,
 * not a slot machine.
 */
export function rerollLimit(_type?: string): number {
  return 2;
}

// ---------------------------------------------------------------------------
// Brew session sessionStorage helpers
// Keyed as "brew:<id>" — mirrors the "deck:<id>" pattern used by BuilderPage.
// Call persistBrewSession from a BrewPage useEffect; call hydrateBrewSession on mount.
// ---------------------------------------------------------------------------

export function persistBrewSession(id: string): void {
  try {
    const { brewContext, brewState } = useStore.getState();
    if (!brewContext || !brewState) return;
    // Sweep stale brew keys (both prefixes), keep only this id's.
    for (let i = sessionStorage.length - 1; i >= 0; i--) {
      const key = sessionStorage.key(i);
      if (key && (key.startsWith('brewctx:') || key.startsWith('brewstate:'))
        && key !== `brewctx:${id}` && key !== `brewstate:${id}`) {
        sessionStorage.removeItem(key);
      }
    }
    // Heavy context: write once (skip if already stored for this id). serializeBrew preserves
    // Set/Map fields — plain JSON.stringify turns them into {} (data loss + resume crash).
    if (!sessionStorage.getItem(`brewctx:${id}`)) {
      sessionStorage.setItem(`brewctx:${id}`, serializeBrew(brewContext));
    }
    // Light state: write every time.
    sessionStorage.setItem(`brewstate:${id}`, serializeBrew(brewState));
  } catch (e) {
    console.warn('Failed to persist brew session:', e);
  }
}

export function hydrateBrewSession(id: string): boolean {
  try {
    const ctxRaw = sessionStorage.getItem(`brewctx:${id}`);
    const stateRaw = sessionStorage.getItem(`brewstate:${id}`);
    if (!ctxRaw || !stateRaw) return false;
    // deserializeBrew rebuilds any Set/Map fields the codec tagged on save. (Pre-codec sessions
    // that stored a Set as {} stay {}, but the use sites guard with `instanceof Set`.)
    const brewContext = deserializeBrew<BrewContext>(ctxRaw);
    const parsedState = deserializeBrew<BrewState>(stateRaw);
    // Default the "fun layer" fields so pre-feature sessions resume cleanly.
    const brewState: BrewState = {
      ...parsedState,
      questionsAsked: parsedState.questionsAsked ?? 0,
      relics: parsedState.relics ?? [],
      comboWatch: parsedState.comboWatch ?? [],
      firedEventIds: parsedState.firedEventIds ?? [],
      lastMomentPick: parsedState.lastMomentPick ?? 0,
      moments: parsedState.moments ?? [],
    };
    const routes = nextRoutes(brewContext, brewState);
    // Fresh resume (nothing picked yet) drops straight onto the first pack, same as a new run.
    const brewNode = brewState.history.length === 0 ? buildPackNode(brewContext, brewState) : null;
    useStore.setState({ brewContext, brewState, brewRoutes: routes, brewNode, brewQuestion: null,
      brewEvent: null, brewRelicOffer: null, brewRerollExclusions: [] });
    return true;
  } catch (e) {
    console.warn('Failed to hydrate brew session:', e);
    return false;
  }
}

/** Remove a persisted brew session (call on finish). */
export function clearPersistedBrew(id: string): void {
  try {
    sessionStorage.removeItem(`brewctx:${id}`);
    sessionStorage.removeItem(`brewstate:${id}`);
  } catch (e) {
    console.warn('Failed to clear persisted brew:', e);
  }
}
