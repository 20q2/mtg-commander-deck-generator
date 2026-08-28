# Deck Share Links — `#d=` Explained

How the Inspector's **Copy link** button turns a whole deck into a URL, and how the receiving
end turns it back into a deck. There is no backend involved at any point: **the link *is* the
storage.**

Read this before touching [`src/services/share/deckLink.ts`](../src/services/share/deckLink.ts)
or any of the shared-load paths: [`AnalyzePage.tsx`](../src/pages/AnalyzePage.tsx),
[`PlaytestLandingPage.tsx`](../src/pages/PlaytestLandingPage.tsx), and
[`SharedDeckPage.tsx`](../src/pages/SharedDeckPage.tsx).

---

## 1. Anatomy of a share link

```
https://manafoundry.gg/analyze/overview#d=1.q1ZKzs8rSc0rUbBVSkosSsxLzUlVyMxLK1FIzs8rTs...
                       └──┬───┘ └──┬───┘  └┬┘└──────────────────┬──────────────────────┘
                          │        │       │                    │
                          │        │       │                    └─ base64url( deflate-raw( body ) )
                          │        │       └─ payload format version
                          │        └─ Inspector tab slug — the link reopens where you shared from
                          └─ route
```

Two independent pieces:

| Piece | Owner | Meaning |
|---|---|---|
| the route | the surface that built the link | Where the link reopens. `/analyze/<tab>` for Inspector links, `/decks/shared` for deck-view links, `/playtest` to drop straight onto the table. |
| `#d=<version>.<payload>` | [`deckLink.ts`](../src/services/share/deckLink.ts) | The entire decklist. |

Inspector tab slugs come from [`constants.ts`](../src/components/deck/optimizer/constants.ts)
`TAB_SLUG_BY_KEY` and follow the user-facing labels rather than the internal keys —
`lands` → `mana`, `curve` → `tempo`, `optimize` → `card-fit`, `lift` → `lift-web`.

### Who reads and writes these links

**A link reopens the surface it was made on.** That's the rule that decides which route a
new producer should emit.

| Route | Reads | Writes | What the recipient gets |
|---|---|---|---|
| `/analyze/<tab>` | `AnalyzePage` | Inspector "Copy link" | The Inspector, on the shared tab. Ephemeral (`source: 'shared'`) with a "Save as deck" action. |
| `/decks/shared` | `SharedDeckPage` | Deck view → **Share** (beside Export) | A read-only deck view of an unsaved deck, with **Save to My Decks** and **Inspect**. The landing place for third-party "Export to ManaFoundry" buttons. |
| `/playtest` | `PlaytestLandingPage` | — | Forwards straight to `/playtest/pasted`; the deck hits the table without being saved. |

`SharedDeckPage` renders the payload through `ListDeckView` by handing it a synthetic
`UserCardList` under the reserved id `__shared`, and passes none of the mutation
callbacks — ListDeckView gates every edit affordance on its verb existing, so the preview
is read-only by construction. Its `unsaved` prop additionally hides Inspect / SpellChroma /
Playtest, which all navigate by a saved list id. Nothing is written to storage until the
recipient presses Save.

The origin + base path come from `import.meta.env.BASE_URL`, so the same code emits
`manafoundry.gg/analyze/…` (AWS deploy, `BASE_PATH=/`) and
`…github.io/mtg-commander-deck-generator/analyze/…` (Pages mirror).

### Version prefix

| Prefix | Meaning |
|---|---|
| `1.` | `deflate-raw` compressed — the normal case. |
| `0.` | Uncompressed fallback, emitted when `CompressionStream` is unavailable so the share button never hard-fails. |
| anything else | `DeckLinkError('unsupported-version')` → the user sees *"This link was made by a newer version of the site."* |

That prefix is the whole forward-compatibility story: an old client refuses a future format
politely instead of rendering garbage. **A new body format means a new version number**, never
a silent change to `1.`

---

## 2. The payload body

Decoded, the body is newline-delimited text — **not JSON**:

```
Atraxa, Praetors' Voice     ← line 1: commander name ("" if none)
                            ← line 2: partner commander name ("" if none)
Atraxa, Praetors' Voice     ← line 3+: every card, one name per line
Sol Ring
Cultivate
Cultivate                   ← quantities are expanded into repeats
...
```

Why lines instead of JSON: it's meaningfully smaller, and card names can't contain newlines, so
there is no escaping to get wrong. A normal 100-card deck encodes to roughly **1200 characters**.

### The commander appears twice, on purpose

Line 1 names the commander *and* the commander is repeated in the card list. This is the single
easiest thing to break, so it's spelled out in the `SharedDeckPayload` doc comment and pinned by
a regression test:

> `hydrateDeckForAnalysis` resolves the commander by looking `commanderName` up in the card map
> it builds **from `cardNames`**. A commander left out of `cardNames` silently hydrates as a deck
> with no commander, which renders as a blank Inspector.

`deckToSharePayload()` prepends the commanders for you — use it rather than assembling a
`SharedDeckPayload` by hand. It takes the minimal `{ cards, commander, partnerCommander }` shape
instead of a `GeneratedDeck` because `DeckOptimizer` holds a flat `currentCards` list, not the
`categories` record.

### Size ceiling

`MAX_ENCODED_LENGTH = 7500` on the *encoded* value, as a proxy for keeping the whole URL under
8000 characters (origin + path contribute well under 500). Over it, `encodeDeckPayload` throws
`DeckLinkError('too-large')` and the button reports *"This deck is too large to share as a link."*

---

## 3. Why the fragment and not `?d=`

This is the non-obvious constraint, and the thing a newcomer will try to "clean up."

The GitHub Pages mirror serves deep links through the SPA redirect in
[`public/404.html`](../public/404.html), which **rewrites `&` to `~and~` inside the query string**
before `index.html` reassembles it. That mangles a base64url payload. Both hops append
`l.hash` **verbatim**, so a fragment passes through untouched.

Second reason, independent of hosting: a fragment is never sent to the server, which keeps
decklists out of request logs and analytics referrers.

---

## 4. The load path

```
readDeckHash(window.location.hash)   → pull the "d" value (URLSearchParams over the fragment)
decodeDeckPayload(raw)               → split version → base64url → inflate → parse lines
hydrateDeckForAnalysis(payload)      → Scryfall getCardsByNames → combos → enrichDeckCards
useStore.setState({ commander, partnerCommander, colorIdentity, generatedDeck })
setSource({ kind: 'shared' })
```

[`hydrateDeckForAnalysis`](../src/components/analyze/analyzeHydration.ts) is the *same* function
the paste lane and the list lane call — a share link is simply a fourth way to feed it card
names, and it reports progress through `fetching-cards → detecting-combos → analyzing-roles` for
the loading screen.

Because the payload carries **names only**, printings and art are not preserved; Scryfall
resolves the canonical card for each name.

---

## 5. Four subtleties in `AnalyzePage`

Each of these exists because of a real failure; don't "simplify" them without re-checking the
behaviour they protect.

1. **The hash is read during the first render, not in an effect.**
   `initialDeckHash` is a `useState` initializer, and `loading` / `loadStage` are seeded from it.
   Defer that to an effect and the recipient sees the paste/lists/generate hub flash before the
   loader — which reads as the link having failed.

2. **The shared-load effect deliberately has no cancel-on-cleanup flag.**
   StrictMode double-mounts it; a `ref` keyed on the payload means only the *first* run does the
   work. A cleanup that cancelled would kill the only real attempt and leave the page stuck
   loading forever. React 18 tolerates the late `setState`.

3. **Two unrelated effects guard on the live hash.**
   The hub-reset effect would otherwise discard a deck hydrated from a hand-trimmed
   `/analyze#d=…` with no tab segment; the bridge-from-Generate effect would label a shared deck
   `source: 'generated'`, because the Zustand write lands before `setSource`. Both read
   `window.location.hash` live rather than `initialDeckHash` — `handleChangeDeck`'s
   `navigate('/analyze')` drops the fragment, and *that* is what releases the gates.

4. **`pendingShareLoad` gates the whole render.**
   Same reasoning as #1, applied after mount: while a share hash is present and no deck has
   loaded, the page renders the staged "Loading shared deck…" screen instead of the hub.

---

## 6. Error surface

`DeckLinkError.reason` is the whole vocabulary, mapped to copy in `shareLinkErrorMessage`:

| reason | Thrown when | User sees |
|---|---|---|
| `malformed` | bad base64, missing version dot, < 3 body lines, no card names, inflate failure | "This share link is damaged or incomplete." |
| `unsupported-version` | version prefix isn't `0` or `1` | "This link was made by a newer version of the site." |
| `too-large` | encoded length > 7500 | "This deck is too large to share as a link." (encode side) |
| `unsupported-browser` | no `CompressionStream` / `DecompressionStream` | "Your browser can't open share links…" (decode side only — encoding falls back to version `0`) |

---

## 7. Tests are the spec

[`src/services/share/__tests__/deckLink.test.ts`](../src/services/share/__tests__/deckLink.test.ts)
covers round-trip, quantity repeats, the version-`0` fallback, truncated payloads, unknown
versions, and the commander-in-`cardNames` regression. Run it with:

```bash
node node_modules/vitest/vitest.mjs run src/services/share
```

---

## 8. Extending this

- **New field in the payload** → bump to version `2`, keep `1` decodable. `decodeDeckPayload`
  already branches on the version prefix; add a case (and a `toBody`/`fromBody` pair for it)
  rather than changing what the existing lines mean.
- **Sharing something other than a deck** → don't reuse `d`. `readDeckHash` owns exactly that
  key (`HASH_KEY`); a second feature should claim its own so both can coexist in one fragment.
- **Another producer** → call `deckToSharePayload` + `buildShareUrl('<route>', payload)`.
  Don't hand-build the fragment; the commander-inclusion contract lives in that helper.
  `buildShareUrl` takes the app-relative route without a leading slash (`analyze/mana`,
  `decks/shared`), so pick the route whose page reopens the surface you're sharing from.
- **Another consumer** → copy the load shape from `SharedDeckPage`: read the hash in a
  `useState` initializer (never an effect — the recipient must not see the empty state
  flash first), decode in a ref-guarded effect with no cleanup-cancel (StrictMode
  double-mounts, and cancelling kills the only real attempt), and render
  `shareLinkErrorMessage` copy on failure. Then add a row to the table in §1.
