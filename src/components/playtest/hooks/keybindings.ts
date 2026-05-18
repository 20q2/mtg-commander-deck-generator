// Central registry for playtest keybindings — single source of truth so the
// hotkey handler and the Settings → Keybindings tab stay in sync.
export interface Keybinding {
  keys: string[];               // human-readable key labels (e.g. ['D'], ['Ctrl', 'Z'])
  description: string;
  category: 'Library' | 'Card' | 'Selection' | 'Turn' | 'Other';
  context?: string;             // e.g. "hovering a card", "hovering a pile"
}

export const KEYBINDINGS: Keybinding[] = [
  // Library
  { keys: ['D'], description: 'Draw a card',                          category: 'Library' },
  { keys: ['S'], description: 'Shuffle the library',                  category: 'Library' },
  { keys: ['M'], description: 'Mulligan (shuffle hand back, redraw)', category: 'Library' },
  { keys: ['R'], description: 'Shuffle hovered pile',                 category: 'Library', context: 'hovering a pile' },

  // Card
  { keys: ['T'], description: 'Tap / untap the hovered card',         category: 'Card', context: 'hovering a card' },
  { keys: ['Q'], description: 'Rotate hovered card 90° counter-clockwise', category: 'Card', context: 'hovering a card' },
  { keys: ['E'], description: 'Rotate hovered card 90° clockwise',    category: 'Card', context: 'hovering a card' },
  { keys: ['F'], description: 'Flip hovered card face down / up',     category: 'Card', context: 'hovering a card' },
  { keys: ['U'], description: 'Untap all cards on the battlefield',   category: 'Card' },

  // Turn
  { keys: ['1'], description: 'Set phase: Untap',                     category: 'Turn' },
  { keys: ['2'], description: 'Set phase: Upkeep',                    category: 'Turn' },
  { keys: ['3'], description: 'Set phase: Draw',                      category: 'Turn' },
  { keys: ['4'], description: 'Set phase: Main 1',                    category: 'Turn' },
  { keys: ['5'], description: 'Set phase: Combat',                    category: 'Turn' },
  { keys: ['6'], description: 'Set phase: Main 2',                    category: 'Turn' },
  { keys: ['7'], description: 'Set phase: End',                       category: 'Turn' },

  // Selection / Clipboard
  { keys: ['Ctrl', 'C'], description: 'Copy the selection (or hovered card)', category: 'Selection' },
  { keys: ['Ctrl', 'V'], description: 'Paste the clipboard (cascades on repeat)', category: 'Selection' },

  // Other
  { keys: ['Ctrl', 'Z'], description: 'Undo last action',             category: 'Other' },
  { keys: ['Esc'], description: 'Close the open dialog',              category: 'Other' },
];
