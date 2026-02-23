# EDH Deck Builder

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

A React application that generates complete Commander/EDH decks using real EDHREC data. Select your commander, choose themes, and get a deck built from the most popular cards for that commander.

**[Try it live](https://20q2.github.io/mtg-commander-deck-generator/)**

## Features

- **Commander Search** - Search any legendary creature using Scryfall's database
- **EDHREC Integration** - Pulls real theme data and card recommendations directly from EDHREC
- **Theme Selection** - Choose from EDHREC themes specific to your commander (e.g., "+1/+1 Counters", "Voltron", "Aristocrats")
- **Smart Card Selection** - Uses EDHREC's type distribution, mana curve, and card popularity data
- **Dynamic Backgrounds** - Commander artwork displayed as atmospheric background
- **Deck Statistics** - View mana curve, color distribution, and card type breakdown
- **Easy Export** - Copy your deck list to clipboard for import into Moxfield, Archidekt, or MTGO

## How It Works

Unlike generic deck builders, this app fetches actual EDHREC data for your commander:

1. **Real Statistics** - Uses EDHREC's average type distribution (creature count, instant count, etc.)
2. **Theme-Specific Cards** - Fetches cards from your selected EDHREC themes
3. **Popularity Ranking** - Cards are sorted by EDHREC inclusion rate
4. **Mana Curve Matching** - Targets the average mana curve from EDHREC data

## Getting Started

### Prerequisites

- Node.js 18+
- npm or yarn

### Installation

```bash
# Clone the repository
git clone https://github.com/20q2/mtg-commander-deck-generator.git
cd mtg-commander-deck-generator

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

### Deploy to GitHub Pages

```bash
npm run build
# Then push the dist folder to gh-pages branch
```

## How to Use

### Step 1: Choose Your Commander

1. Type your commander's name in the search box
2. Select from the autocomplete results
3. Or click one of the top EDHREC commanders shown below the search

### Step 2: Select Themes

The app fetches available themes from EDHREC for your commander. Select up to 2 themes to influence card selection:

- Themes are sorted by popularity (deck count)
- Each theme shows its popularity percentage
- Click "Other" to see additional themes for that commander

### Step 3: Customize Your Deck

Adjust preferences:

- **Land Count** - Typically 35-38 for most decks
- **Deck Format** - 99-card Commander (default), or 60/40 for other formats

### Step 4: Generate Your Deck

Click **Generate Deck** and the app will:

1. Fetch card recommendations from EDHREC for your selected themes
2. Select creatures matching EDHREC's average creature count
3. Pick instants, sorceries, artifacts, enchantments based on EDHREC type distribution
4. Build a land base with utility lands and appropriate basics
5. Categorize cards by function (ramp, removal, card draw, etc.)

### Step 5: Export Your Deck

Once generated, you can:

- **Copy to Clipboard** - Standard deck list format
- **Export to Moxfield** - Opens Moxfield with your deck

The export format is compatible with most deck building sites:
```
1 Sol Ring
1 Arcane Signet
1 Command Tower
...
```

## Tech Stack

- **React 18** + TypeScript
- **Vite** for fast development and building
- **Tailwind CSS** for styling
- **shadcn/ui** components
- **Zustand** for state management
- **Scryfall API** for card data and images
- **EDHREC** for theme data and card recommendations
- **mana-font** for mana symbols and card type icons

## API Usage

### Scryfall API
- Used for card search, card details, and images
- Rate limited to 10 requests/second (handled automatically)
- No authentication required

### EDHREC Data
- Commander themes and statistics
- Card recommendations by type
- Popularity and inclusion rates

## Project Structure

```
src/
├── components/
│   ├── ui/              # Base UI components (Button, Card, Slider, etc.)
│   ├── commander/       # Commander search and display
│   ├── archetype/       # Theme selection display
│   ├── customization/   # Deck customization options
│   └── deck/            # Deck display and export
├── services/
│   ├── scryfall/        # Scryfall API client
│   ├── edhrec/          # EDHREC data fetching
│   └── deckBuilder/     # Deck generation algorithms
├── lib/
│   ├── constants/       # Archetype keywords, configuration
│   └── commanderTheme.ts # Dynamic theming based on commander colors
├── store/               # Zustand state management
├── pages/               # Page components (Home, Builder)
└── types/               # TypeScript type definitions
```

## Credits

- Card data and images from [Scryfall](https://scryfall.com)
- Theme data and recommendations from [EDHREC](https://edhrec.com)
- Mana symbols from [mana-font](https://github.com/andrewgioia/mana)
- Built with [React](https://react.dev), [Vite](https://vitejs.dev), and [shadcn/ui](https://ui.shadcn.com)

## Contributing

Contributions are welcome! Feel free to open an issue or submit a pull request.

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.
