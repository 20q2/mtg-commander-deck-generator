# Manafoundry (formerly EDH Deck Builder)

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

A Commander deck generation engine that builds full EDH decks using real Scryfall and EDHREC data, with a focus on producing playable, synergistic, and structurally coherent Commander lists.

**Live version (official):**
https://manafoundry.gg

---

## About

Manafoundry is an evolving deck generation system for Magic: The Gathering Commander (EDH).

It combines:
- Scryfall card database and images
- EDHREC archetype and theme statistics
- internal heuristics for curve, synergy, and role distribution

to construct full 100-card Commander decks centered around a selected commander.

Unlike simple random or template-based generators, Manafoundry is actively developed with a focus on improving deck quality, coherence, and gameplay usability over time.

This project is the original implementation and reference system for the underlying deck generation engine.

---

## Features

- **Commander Search** - Search any legendary creature via Scryfall
- **EDHREC Integration** - Uses real archetype and theme data per commander
- **Theme Selection** - Choose from EDHREC archetypes (e.g. +1/+1 Counters, Voltron, Aristocrats)
- **Role-Aware Deck Building** - Balanced assignment of ramp, draw, removal, threats, and synergy pieces
- **Mana Curve Modeling** - Targets archetype-appropriate curve distributions
- **Type Distribution Logic** - Creature / instant / sorcery / artifact / enchantment balancing
- **Dynamic UI Theming** - Commander artwork and color identity influence UI styling
- **Deck Export** - Copy-ready format for Moxfield, Archidekt, and MTGO

---

## How It Works

Manafoundry builds Commander decks using a structured multi-step system:

### 1. Commander Context Analysis
- Parses color identity
- Identifies archetype tendencies from EDHREC data
- Establishes baseline deck constraints

### 2. Archetype & Theme Integration
- Pulls EDHREC themes associated with the commander
- Weights cards based on archetype popularity and synergy signals

### 3. Role-Based Selection
Cards are assigned functional roles such as:
- Ramp
- Card draw
- Interaction (removal / counterspells)
- Win conditions
- Synergy engines

### 4. Structural Balancing
- Mana curve targeting based on archetype averages
- Color pip distribution balancing
- Type breakdown enforcement (creatures, spells, lands)

### 5. Deck Assembly
- Final 100-card list assembled with synergy and curve constraints
- Lands added based on color requirements and curve needs

---

## Getting Started

### Prerequisites

- Node.js 18+
- npm or yarn

### Installation

```bash
git clone https://github.com/20q2/mtg-commander-deck-generator.git
cd mtg-commander-deck-generator
npm install
npm run dev
```

The app will be available at:
http://localhost:5173

### Build for Production

```bash
npm run build
npm run preview
```

### Deployment (GitHub Pages)

```bash
npm run build
```

Then deploy the generated `dist/` folder to your GitHub Pages branch.

---

## How to Use

### Step 1: Choose a Commander
- Search any legendary creature via Scryfall integration
- Or select from popular EDHREC commanders

### Step 2: Select Themes
- Choose up to 2 EDHREC archetypes
- Themes are weighted by popularity and synergy strength

### Step 3: Customize Settings
- Land count (typically 35–38)
- Deck format (Commander default or alternative sizes)

### Step 4: Generate Deck

Manafoundry will:

- Fetch EDHREC recommendations
- Build a role-balanced 100-card list
- Apply curve and synergy constraints
- Assemble a complete playable deck

### Step 5: Export
- Copy deck list
- Import to Moxfield / Archidekt / MTGO

---

## Tech Stack

- React 18 + TypeScript
- Vite
- Tailwind CSS
- shadcn/ui
- Zustand (state management)
- Scryfall API
- EDHREC data integration
- mana-font (symbols and icons)

---

## API Usage

### Scryfall API
- Card search and metadata
- Image retrieval
- Rate-limited (handled automatically)

### EDHREC Data
- Commander archetypes
- Theme breakdowns
- Card inclusion rates and popularity signals

---

## Project Structure

```
src/
├── components/
│   ├── ui/
│   ├── commander/
│   ├── archetype/
│   ├── customization/
│   └── deck/
├── services/
│   ├── scryfall/
│   ├── edhrec/
│   └── deckBuilder/
├── lib/
│   ├── constants/
│   └── commanderTheme.ts
├── store/
├── pages/
└── types/
```

---

## Credits

- [Scryfall](https://scryfall.com) for card data and images
- [EDHREC](https://edhrec.com) for archetype and theme data
- [mana-font](https://github.com/andrewgioia/mana) for mana symbols
- React, Vite, and open-source ecosystem contributors

---

## Contributing

Contributions, issues, and feedback are welcome.

---

## License

This project is licensed under the MIT License.

See the [LICENSE](LICENSE) file for details.
