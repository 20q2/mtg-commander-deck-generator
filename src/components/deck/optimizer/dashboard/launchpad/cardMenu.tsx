// src/components/deck/optimizer/dashboard/launchpad/cardMenu.tsx
//
// Right-click on any card the launch pad shows opens the same card menu as the rest of the app. One
// host per launch pad; every card surface reaches it through useCardHover, so a new card thumb gets the
// menu without wiring of its own.
import { createContext, useContext, useState, type ReactNode } from 'react';
import { CardContextMenu, type CardAction } from '@/components/deck/DeckDisplay';
import type { CardRowMenuProps } from '../../shared';
import type { ScryfallCard } from '@/types';

export interface CardMenuWiring {
  onAction: (card: ScryfallCard, action: CardAction) => void;
  menuProps: CardRowMenuProps;
}

type OpenMenu = (name: string, card: ScryfallCard | undefined, x: number, y: number) => void;

const CardMenuContext = createContext<OpenMenu | null>(null);

export const useOpenCardMenu = () => useContext(CardMenuContext);

/** The menu's width (CardContextMenu's w-48) and its hidden trigger's size: the trigger sits so the
 *  menu opens down and to the right of the pointer, like a native one. */
const MENU_W = 192;
const TRIGGER = 18;

export function CardMenuHost({ wiring, deckNames, commanderNames, children }: {
  wiring?: CardMenuWiring;
  /** Cards in the deck, so the menu offers Remove for those and Add for suggestions. */
  deckNames: Set<string>;
  commanderNames: Set<string>;
  children: ReactNode;
}) {
  const [at, setAt] = useState<{ name: string; card?: ScryfallCard; x: number; y: number; n: number } | null>(null);
  const open: OpenMenu = (name, card, x, y) => setAt(prev => ({ name, card, x, y, n: (prev?.n ?? 0) + 1 }));

  if (!wiring) return <>{children}</>;
  const { onAction, menuProps } = wiring;
  const inDeck = at ? deckNames.has(at.name) : false;

  return (
    <CardMenuContext.Provider value={open}>
      {children}
      {at && (
        <span
          key={at.n}
          aria-hidden="true"
          className="pointer-events-none fixed z-50 flex justify-end opacity-0"
          style={{ left: at.x, top: at.y - TRIGGER, width: MENU_W, height: TRIGGER }}
        >
          <CardContextMenu
            card={at.card ?? ({ name: at.name } as ScryfallCard)}
            onAction={onAction}
            hasRemove={inDeck}
            hasAddToDeck={!inDeck}
            hasSideboard
            hasMaybeboard
            addToBoard={!inDeck}
            isInSideboard={menuProps.sideboardNames.has(at.name)}
            isInMaybeboard={menuProps.maybeboardNames.has(at.name)}
            isMustInclude={menuProps.mustIncludeNames.has(at.name)}
            isBanned={menuProps.bannedNames.has(at.name)}
            isCommander={commanderNames.has(at.name)}
            userLists={menuProps.userLists}
            forceOpen
            onForceClose={() => setAt(null)}
          />
        </span>
      )}
    </CardMenuContext.Provider>
  );
}
