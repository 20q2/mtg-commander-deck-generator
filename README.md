# EDH Deck Builder

A React application that generates complete 99-card Commander/EDH decks with one click. Select your commander, adjust preferences, and get a fully built deck ready to import into Moxfield or other deck building sites.

## Features

- **Commander Search** - Search any legendary creature using Scryfall's database
- **Auto Archetype Detection** - Automatically detects deck archetypes from your commander's abilities (Tokens, Voltron, Spellslinger, Aristocrats, etc.)
- **Customizable Generation** - Adjust land count, creature/spell balance, mana curve, and archetype focus
- **Smart Card Selection** - Uses EDHREC popularity rankings and format staples to select optimal cards
- **Deck Statistics** - View mana curve, color distribution, and card type breakdown
- **Easy Export** - Copy your deck list to clipboard for import into Moxfield, Archidekt, or MTGO

## Getting Started

### Prerequisites

- Node.js 18+
- npm or yarn

### Installation

```bash
# Clone or navigate to the project
cd A:\Coding\MtgMakeDeckForMe

# Install dependencies
npm install

# Start the development server
npm run dev
```

The app will be available at `http://localhost:5173`

### Build for Production

```bash
npm run build
npm run preview
```

## How to Use

### Step 1: Choose Your Commander

1. Type your commander's name in the search box
2. Select from the autocomplete results
3. The app will display your commander's image, colors, and mana cost

**Try these popular commanders:**
- Atraxa, Praetors' Voice (Superfriends/Counters)
- Korvold, Fae-Cursed King (Aristocrats)
- Yuriko, the Tiger's Shadow (Ninjas)
- Ghave, Guru of Spores (Tokens/Aristocrats)
- Urza, Lord High Artificer (Artifacts)

### Step 2: Review Detected Archetype

The app analyzes your commander's text and keywords to suggest an archetype:

| Archetype | Description |
|-----------|-------------|
| Aggro | Fast, creature-heavy, low mana curve |
| Control | Removal-heavy, card draw, higher curve |
| Combo | Synergy pieces, tutors, enablers |
| Voltron | Equipment and auras to buff commander |
| Spellslinger | Instants/sorceries matter |
| Tokens | Token generation and anthems |
| Aristocrats | Sacrifice synergies |
| Tribal | Creature type synergies |
| Landfall | Land-based triggers |
| Artifacts | Artifact synergies |
| Enchantress | Enchantment synergies |

You can override the detected archetype using the dropdown if you want a different build style.

### Step 3: Customize Your Deck

Adjust the sliders to fine-tune your deck:

**Land Count (32-42)**
- 32-34: Aggressive decks with low curves
- 36-38: Standard/balanced builds
- 40-42: Control or landfall decks

**Creature vs Spell Balance (0-100%)**
- 0-30%: Spellslinger/control builds
- 40-60%: Balanced midrange
- 70-100%: Creature-heavy aggro/tribal

**Mana Curve**
- Aggressive: Average CMC ~2.5
- Balanced: Average CMC ~3.2
- Late Game: Average CMC ~3.8

**Archetype Focus (0-100%)**
- 0-30%: "Goodstuff" - best cards regardless of synergy
- 50-70%: Balanced synergy and power
- 80-100%: All-in on archetype theme

### Step 4: Generate Your Deck

Click **Generate Deck** and wait for the magic to happen. The app will:

1. Fetch ramp cards (Sol Ring, signets, land ramp)
2. Add card draw appropriate to your colors
3. Include removal and board wipes
4. Fill creature slots based on your archetype
5. Add synergy cards that work with your commander
6. Build a mana base with duals, utility lands, and basics

### Step 5: Export Your Deck

Once generated, you can:

- **Export** - Copies the deck list to your clipboard
- **Moxfield** - Opens Moxfield to paste your deck

The export format is compatible with most deck building sites:
```
1 Sol Ring
1 Arcane Signet
1 Command Tower
...
```

## Deck Composition

The generator uses the **8x8 Theory** as a baseline, adjusted by archetype:

| Category | Base Count | Purpose |
|----------|------------|---------|
| Lands | 37 | Mana base |
| Ramp | 10 | Mana acceleration |
| Card Draw | 10 | Card advantage |
| Removal | 8 | Single-target answers |
| Board Wipes | 3 | Mass removal |
| Creatures | 20 | Threats and utility |
| Synergy | 8 | Archetype-specific cards |
| Utility | 3 | Flexible slots |

## Tech Stack

- **React 18** + TypeScript
- **Vite** for fast development
- **Tailwind CSS** for styling
- **shadcn/ui** components
- **Zustand** for state management
- **Scryfall API** for card data

## API Usage

This app uses the [Scryfall API](https://scryfall.com/docs/api) for all card data. The API is:
- Free to use
- Rate limited to 10 requests/second (handled automatically)
- No authentication required

Card popularity is determined by Scryfall's `edhrec_rank` field, which reflects EDHREC inclusion rates.

## Project Structure

```
src/
├── components/
│   ├── ui/              # Base UI components (Button, Card, Slider, etc.)
│   ├── commander/       # Commander search and display
│   ├── archetype/       # Archetype detection display
│   ├── customization/   # Deck customization sliders
│   └── deck/            # Deck display and export
├── services/
│   ├── scryfall/        # API client with rate limiting
│   └── deckBuilder/     # Deck generation algorithms
├── lib/
│   └── constants/       # Archetype keywords, format staples
├── store/               # Zustand state management
└── types/               # TypeScript type definitions
```

## Contributing

Feel free to open issues or submit pull requests for:
- New archetype support
- Improved card selection algorithms
- UI/UX improvements
- Bug fixes

## Credits

- Card data provided by [Scryfall](https://scryfall.com)
- Deck building strategies inspired by [EDHREC](https://edhrec.com)
- Built with [React](https://react.dev), [Vite](https://vitejs.dev), and [shadcn/ui](https://ui.shadcn.com)

## License

MIT
