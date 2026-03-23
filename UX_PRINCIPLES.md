# UX Principles

## 1. Value Before Friction

Show the product's full value immediately. No account creation, no login wall, no onboarding wizard. A user should go from landing on the site to seeing a complete generated deck in seconds. Every feature that can work without auth should work without auth.

**Why:** DeckCheck gates its best features behind account creation. Users who try it without signing up see a mediocre experience and bounce — even when the product behind the wall is genuinely good. They don't come back. Zero-auth first experience is a competitive advantage.

## 2. Explain, Don't Just Recommend

When the app makes a decision (card inclusion, role assignment, swap suggestion), surface the *why*. Users trust tools they can understand. A card showing "82% EDHREC inclusion, fills Ramp role, CMC 2 fits curve gap" is more valuable than the same card with no context.

**Why:** The #1 community request for auto-generators is card inclusion rationale. AI tools that give opaque outputs get dismissed as "generic and un-nuanced."

## 3. Deterministic Over Probabilistic

Prefer transparent, countable metrics over black-box AI opinions. Role counts, inclusion percentages, curve targets, and combo detection are reproducible and verifiable. LLM-generated analysis is impressive but hallucinates and erodes trust over time.

**Why:** DeckCheck built their power level feature on Claude and had to replace it with a transparent formula (Performance Index) because the AI output confused users and competed with established systems. Explainable beats magical.

## 4. Progressive Disclosure

Show the essential information by default, let users drill into detail on demand. A card shows its name and type at a glance; hover/click reveals price, inclusion %, role, subtypes. The deck view shows the list; the sidebar reveals stats, curve, combos.

**Why:** MTG players range from casual to hyper-competitive. Dumping every metric on screen overwhelms newcomers. Hiding everything frustrates enfranchised players. Let users choose their depth.

## 5. Respect the Puzzle

Deck building is a creative act. Assist and accelerate — don't replace. Provide strong defaults and smart suggestions, but always let the user override, swap, ban, and customize. The tool should feel like a knowledgeable friend at the LGS, not an autopilot.

**Why:** Community sentiment on AI deck builders is consistently "half the joy is the puzzle." Tools that fully automate get dismissed. Tools that assist get adopted.

## 6. Fast Beats Perfect

A good deck in 3 seconds beats an optimal deck in 30 seconds. Perceived speed matters — show results immediately, refine in the background if needed. Never show a loading spinner when you could show partial results.

## 7. Mobile Is Not an Afterthought

Every feature should work on a phone screen. Toolbars collapse into overflow menus, labels hide behind icons, touch targets are generous. Many users browse deck lists at their LGS between rounds.

## 8. Persist User Intent

Remember preferences across sessions (currency, display toggles, banned cards, must-includes, saved lists). The user shouldn't have to re-configure the app every visit. Use localStorage liberally for settings; IndexedDB for collections.
