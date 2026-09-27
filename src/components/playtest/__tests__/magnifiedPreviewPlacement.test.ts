import { describe, it, expect } from 'vitest';
import { choosePlacement, type AvoidRegion } from '@/components/playtest/MagnifiedPreview';

/**
 * Placement geometry for the hover preview.
 *
 * Two things it has to do at once, and they pull against each other: never
 * cover the card you are pointing at, and — once the playtest marks the bot
 * seats — cover as little of a bot's board as it can, weighted so the seat
 * currently swinging at you wins the argument.
 */

const VIEWPORT = { width: 1500, height: 860 };
const PREVIEW = { width: 340, height: 475 };

/**
 * A card low on your own battlefield. Chosen so there is genuinely room above
 * it — the preview is 475px tall, so anything higher than ~y=490 has none and
 * would go sideways whatever the seats were doing.
 */
const LOW_CARD = { left: 700, top: 600, right: 790, bottom: 726 };
/** A card in your hand, along the bottom of the table. */
const HAND_CARD = { left: 700, top: 700, right: 790, bottom: 826 };

/** A bot seat in the top band, at the given horizontal span. */
const seat = (left: number, right: number, weight: number): AvoidRegion =>
  ({ rect: { left, top: 60, right, bottom: 400 }, weight });

const overlaps = (a: { left: number; top: number }, b: typeof HAND_CARD) =>
  a.left < b.right && a.left + PREVIEW.width > b.left
  && a.top < b.bottom && a.top + PREVIEW.height > b.top;

describe('choosePlacement', () => {
  it('prefers the requested side when nothing is marked', () => {
    const { placement } = choosePlacement({
      anchor: LOW_CARD, viewport: VIEWPORT, preview: PREVIEW, side: 'top', avoid: [],
    });
    expect(placement).toBe('top');
  });

  it('never covers the card it is magnifying', () => {
    for (const anchor of [HAND_CARD, LOW_CARD]) {
      for (const avoid of [[], [seat(400, 1100, 8)], [seat(180, 660, 8), seat(830, 1310, 8)]]) {
        const pos = choosePlacement({ anchor, viewport: VIEWPORT, preview: PREVIEW, side: 'top', avoid });
        expect(overlaps(pos, anchor)).toBe(false);
      }
    }
  });

  it('ignores a marked region that is nowhere near', () => {
    // Off in the far corner, under nothing the preview would reach. The
    // preferred side has to survive the mere existence of a seat.
    const { placement } = choosePlacement({
      anchor: LOW_CARD, viewport: VIEWPORT, preview: PREVIEW, side: 'top',
      avoid: [{ rect: { left: 20, top: 60, right: 200, bottom: 200 }, weight: 8 }],
    });
    expect(placement).toBe('top');
  });

  it('goes another way rather than bury a seat that is swinging at you', () => {
    // Directly above this card, where the preview would otherwise go.
    const avoid = [seat(600, 1100, 8)];
    const plain = choosePlacement({ anchor: LOW_CARD, viewport: VIEWPORT, preview: PREVIEW, side: 'top', avoid: [] });
    const steered = choosePlacement({ anchor: LOW_CARD, viewport: VIEWPORT, preview: PREVIEW, side: 'top', avoid });
    expect(plain.placement).toBe('top');
    expect(steered.placement).not.toBe('top');
  });

  it('buries the idle seat rather than the attacking one', () => {
    const attacking = seat(180, 660, 8);
    const idle = seat(830, 1310, 1);
    const { placement } = choosePlacement({
      anchor: HAND_CARD, viewport: VIEWPORT, preview: PREVIEW, side: 'top', avoid: [attacking, idle],
    });
    // Left is the attacking seat's side; right is the idle one's.
    expect(placement).toBe('right');
  });

  it('flips back when the threat is on the other side', () => {
    const idle = seat(180, 660, 1);
    const attacking = seat(830, 1310, 8);
    const { placement } = choosePlacement({
      anchor: HAND_CARD, viewport: VIEWPORT, preview: PREVIEW, side: 'top', avoid: [idle, attacking],
    });
    expect(placement).toBe('left');
  });

  it('is decided by the weights, not by which seat was listed first', () => {
    const left = seat(180, 660, 8);
    const right = seat(830, 1310, 1);
    const a = choosePlacement({ anchor: HAND_CARD, viewport: VIEWPORT, preview: PREVIEW, side: 'top', avoid: [left, right] });
    const b = choosePlacement({ anchor: HAND_CARD, viewport: VIEWPORT, preview: PREVIEW, side: 'top', avoid: [right, left] });
    expect(a.placement).toBe(b.placement);
  });
});
