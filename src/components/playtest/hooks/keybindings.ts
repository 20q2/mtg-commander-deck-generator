// Central registry for playtest keybindings — single source of truth so the
// hotkey handler and the Settings → Keybindings tab stay in sync.
export interface Keybinding {
  keys: string[];               // human-readable key labels (e.g. ['D'], ['Ctrl', 'Z'])
  description: string;
  category: 'Library' | 'Card' | 'Selection' | 'Other';
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

  // Selection / Clipboard
  { keys: ['Ctrl', 'C'], description: 'Copy the selection (or hovered card)', category: 'Selection' },
  { keys: ['Ctrl', 'V'], description: 'Paste the clipboard (cascades on repeat)', category: 'Selection' },

  // Other
  { keys: ['Enter'], description: 'Next turn (advance the turn and draw a card)', category: 'Other' },
  { keys: ['Backspace'], description: 'Reset the playtest (reshuffle and redraw)', category: 'Other' },
  { keys: ['Ctrl', 'Z'], description: 'Undo last action',             category: 'Other' },
  { keys: ['Esc'], description: 'Close the open dialog',              category: 'Other' },
];
