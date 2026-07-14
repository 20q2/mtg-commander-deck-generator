import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

/**
 * The real 3D booster packs (lazy-loaded WebGL; the CSS wrapper remains the no-WebGL fallback).
 *
 * Modeled to the Pocket reference: a displaced BOX — real side walls, so rotating a pack never
 * reveals a paper-thin edge. The profile, top to bottom: a semi-large flat crimp tab carrying
 * the ManaFoundry label (~14%), a glowing seam line, then the body — foil that waists in
 * slightly at mid-height and bows back out near the bottom — ending in a small bottom crimp
 * (~1/3 the top's size). Inside the midsection sits the CARD STACK: a hard-edged rectangular
 * plateau inset from the wrapper's sides, whose top edge catches the key light while the face
 * itself stays glare-free (low envMapIntensity + a slight downward resting pitch).
 *
 * Each pack is TWO welded pieces split along the seam — the crimp STRIP and the BODY — with a
 * shared jagged tear edge, invisible while sealed. The crack ceremony (Pocket-style): a spark
 * head sweeps the seam trailing foil dust while the pack shivers → the strip POPS off in a
 * flash and tumbles away → light spills from the open mouth → the emptied body sheds downward
 * under the erupting cards. burst() resolves at mouth-open, the cue for the DOM card eruption.
 *
 * The wrapper art is canvas-painted per pack (crimp ridges, brand label + logo, full-bleed
 * headline art) under a matte-foil physical material. Tilt is spring-simulated in the render
 * loop; ceremony beats run as in-scene tweens. All procedural — no model files, no HDRs.
 */

export interface PackSpec {
  color: string;      // HSL triplet, e.g. "152 60% 50%" (the pack's hue)
  artUrl?: string;    // headline card art_crop; painted full-bleed onto the wrapper
  label?: string;     // the pack's name — printed PROUDLY on the lower front, like the brand
  featName?: string;  // the hallmark card, printed as "feat. «name»" under the label
  count?: number;     // cards inside, printed as the small "N CARDS" line
  tease?: boolean;    // windfall hint — an amber "something glints inside…" above the label
}

export interface PackZone { cx: number; cy: number; w: number }   // px, relative to the canvas

export interface PackSceneAPI {
  layout(zones: PackZone[]): void;
  pointer(idx: number | null, px?: number, py?: number): void;
  stage(idx: number): void;
  /** The crack: tear sweep → strip pop → mouth open. Resolves at mouth-open (erupt cards now);
   *  the strip/body keep tumbling off-screen after resolution. */
  burst(idx: number): Promise<void>;
  dispose(): void;
}

const PACK_W = 1.4;
const PACK_H = 2.66;       // the reference wrapper is ~1:1.9 — tall and narrow
const PACK_T = 0.06;       // the slab's base thickness — the "never paper-thin" guarantee
const BULGE = 0.06;        // TOTAL relief — a pack of cards, not a blister of air
const TOP_CRIMP = 0.12;    // share of height: the branded top tab
const BOT_CRIMP = 0.02;    // the sliver of fold at the bottom
const TILT_RANGE = 0.34;
const SPRING_K = 0.16;
const SPRING_D = 0.78;
// Hover engagement ramps over time (per-second exponential rates). The pointer crossing a
// pack's edge is a step function — entering from the side would otherwise whip the pack to
// full side-tilt in one spring impulse, and leaving would yank it back through center.
const HOVER_IN_RATE = 9;
const HOVER_OUT_RATE = 6;

// The crack choreography. Keep TEAR_MS in step with the tear-noise duration passed to
// playPackCrack, so the pop lands exactly when the strip releases.
const TEAR_MS = 480;   // the spark head's sweep across the seam
const POP_MS = 220;    // strip release + body recoil, then the mouth is open (burst resolves)

const { smoothstep } = THREE.MathUtils;
const bell = (t: number, c: number, w: number) => Math.exp(-(((t - c) / w) ** 2));
const rnd = (a: number, b: number) => a + Math.random() * (b - a);

// --- The displacement profile (front face). u: 0 at the top, 1 at the bottom. Returns 0..1;
//     MUST be 0 at the outer boundary so the displaced faces stay welded to the side walls. ---
function packProfile(nx: number, u: number): number {
  // Body activation: zero across both crimp tabs.
  const body = smoothstep(u, TOP_CRIMP - 0.015, TOP_CRIMP + 0.02)
    * (1 - smoothstep(u, 1 - BOT_CRIMP - 0.02, 1 - BOT_CRIMP + 0.01));
  if (body <= 0) return 0;
  const t = Math.min(1, Math.max(0, (u - TOP_CRIMP) / (1 - TOP_CRIMP - BOT_CRIMP)));
  // The foil BOWS INWARD at mid-height: the cards have a little wiggle room, and the wrapper is
  // held taut only at the crimps — so it sags gently between them.
  const sag = 0.66 - 0.3 * bell(t, 0.5, 0.34);
  const sagX = 1 - smoothstep(nx, 0.72, 1.0);
  // The card stack: a card-proportioned (≈1:1.4) HINT under the foil, not a blister.
  const stackX = 1 - smoothstep(nx, 0.86, 0.94);
  const stackY = smoothstep(u, 0.15, 0.18) * (1 - smoothstep(u, 0.79, 0.82));
  const stack = 0.34 * stackX * stackY;
  // Everything fades to 0 at the true boundary (weld to the sides).
  const edge = (1 - smoothstep(nx, 0.94, 1.0)) * (1 - smoothstep(u, 0.985, 1.0)) * (1 - smoothstep(1 - u, 0.985, 1.0));
  return Math.min(1, sag * sagX + stack) * body * edge;
}

// The tear line: a whisper of zigzag in y as a function of x. BOTH pieces apply the same jag
// to their cut edge, so the sealed pack stays welded. Kept SUB-TEXEL small — any bigger and the
// jag telegraphs through the sealed wrapper as a serrated seam (the Pocket seam is clean; the
// "ripped foil" feel comes from the flash and sparks, not the silhouette).
const tearJag = (x: number) => 0.005 * Math.sin(x * 26) + 0.003 * Math.sin(x * 57 + 1.7);

// The silhouette WAIST: the foil is held taut at full width by the crimps and pulls inward
// between them, so the pack's sides bow gently toward mid-height — a pinch, not an hourglass.
// Applied as an x-scale so front/back/side vertices stay welded; both pieces evaluate it in
// global u, so the strip (all crimp) keeps its full-width bar like the mock.
const WAIST = 0.055;
function waistScale(u: number): number {
  const t = (u - TOP_CRIMP) / (1 - TOP_CRIMP - BOT_CRIMP);
  if (t <= 0 || t >= 1) return 1;
  // sin^0.8: tucks in fairly quickly off each crimp, then curves gently through the middle.
  return 1 - WAIST * Math.pow(Math.sin(Math.PI * t), 0.8);
}

const CORNER_R = 0.05;   // rounded wrapper corners — subtle, not pill-shaped

// --- Geometry for ONE PIECE of the pack (u0..u1 of its height): a subdivided box, its ±z faces
//     displaced by the (global-u) profile so the pieces stay flush with each other and welded to
//     their own side walls. Front/back UVs are remapped to the piece's band of the wrapper
//     texture. Corner rounding only happens at the pack's true top/bottom; the cut edge between
//     the pieces gets the shared tear jag instead. ---
function pieceGeometry(u0: number, u1: number): { geo: THREE.BoxGeometry; offsetY: number } {
  const h = (u1 - u0) * PACK_H;
  const offsetY = PACK_H * (0.5 - (u0 + u1) / 2);   // the piece's center, in pack space
  const hSegs = Math.max(4, Math.round(46 * (u1 - u0)));
  const geo = new THREE.BoxGeometry(PACK_W, h, PACK_T, 30, hSegs, 1);
  const pos = geo.attributes.position;
  const uv = geo.attributes.uv;
  const hw = PACK_W / 2, hh = h / 2;
  // Remap uv.y into the piece's band (only the ±z materials sample the texture; remapping the
  // unused faces' UVs is harmless).
  for (let i = 0; i < uv.count; i++) uv.setY(i, (1 - u1) + uv.getY(i) * (u1 - u0));
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const nx = Math.abs(x / hw);
    const u = Math.min(1, Math.max(0, 0.5 - (y + offsetY) / PACK_H));
    const f = packProfile(Math.min(1, nx), u);
    // The back bulges too (a real pack is puffy both ways), just less than the card face.
    pos.setZ(i, z + Math.sign(z) * BULGE * f * (z > 0 ? 1 : 0.55));
    // Rounded corners at the pack's TRUE ends only: a welded warp — every vertex outside a
    // corner's arc is pulled onto it. Front, back, and side vertices share XY, so it stays sealed.
    const nearTop = u0 <= 0 && y > hh - CORNER_R;
    const nearBot = u1 >= 1 && y < -(hh - CORNER_R);
    if ((nearTop || nearBot) && Math.abs(x) > hw - CORNER_R) {
      const cx = Math.sign(x) * (hw - CORNER_R), cy = Math.sign(y) * (hh - CORNER_R);
      const dx = x - cx, dy = y - cy;
      const d = Math.hypot(dx, dy);
      if (d > CORNER_R) {
        pos.setX(i, cx + (dx / d) * CORNER_R);
        pos.setY(i, cy + (dy / d) * CORNER_R);
      }
    }
    // The cut edge (strip's bottom / body's top): the interlocking tear jag.
    const onCut = (u1 < 1 && pos.getY(i) < -(hh - 1e-4)) || (u0 > 0 && pos.getY(i) > hh - 1e-4);
    if (onCut) pos.setY(i, pos.getY(i) + tearJag(x));
    // The waist, last: corner rounding happens at the crimps where the scale is 1, so order
    // doesn't fight it.
    pos.setX(i, pos.getX(i) * waistScale(u));
  }
  geo.computeVertexNormals();
  return { geo, offsetY };
}

// --- Wrapper texture (front): crimp ridges + brand label up top, seam line, full-bleed art. ---
function paintWrapper(spec: PackSpec, art: HTMLImageElement | null, logo: HTMLImageElement | null, back: boolean): HTMLCanvasElement {
  const W = 512, H = 973;   // matches the wrapper's 1:1.9
  const crimpH = H * TOP_CRIMP;
  const botCrimpY = H * (1 - BOT_CRIMP);
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d')!;
  const hue = `hsl(${spec.color}`;
  // Base body.
  g.fillStyle = '#101014';
  g.fillRect(0, 0, W, H);
  const grad = g.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0, `${hue} / 0.6)`);
  grad.addColorStop(0.5, `${hue} / 0.45)`);
  grad.addColorStop(1, `${hue} / 0.7)`);
  g.fillStyle = grad;
  g.fillRect(0, 0, W, H);
  // The art panel: full bleed between the crimps (front only).
  if (art && !back) {
    const top = crimpH + 6;
    const winH = botCrimpY - top;
    const scale = Math.max(W / art.width, winH / art.height);
    const dw = art.width * scale, dh = art.height * scale;
    g.save();
    g.beginPath();
    g.rect(0, top, W, winH);
    g.clip();
    g.drawImage(art, (W - dw) / 2, top + (winH - dh) / 2, dw, dh);
    g.restore();
  }
  if (!back) {
    // Legibility gradient at the bottom (the printed set block sits there) — art stays full-bleed.
    const plate = g.createLinearGradient(0, H * 0.68, 0, botCrimpY);
    plate.addColorStop(0, 'rgba(0,0,0,0)');
    plate.addColorStop(1, 'rgba(0,0,0,0.62)');
    g.fillStyle = plate;
    g.fillRect(0, H * 0.68, W, botCrimpY - H * 0.68);
  }
  if (back) {
    g.fillStyle = 'rgba(0,0,0,0.35)';
    g.fillRect(0, 0, W, H);
    g.strokeStyle = 'rgba(255,255,255,0.1)';
    g.lineWidth = 10;
    g.beginPath();
    g.arc(W / 2, H * 0.55, 110, 0, Math.PI * 2);
    g.stroke();
  }
  // The two crimp tabs: hue-saturated bands with fine vertical foil ridges.
  for (const [y0, y1] of [[0, crimpH], [botCrimpY, H]] as const) {
    const band = g.createLinearGradient(0, y0, 0, y1);
    band.addColorStop(0, `${hue} / 0.95)`);
    band.addColorStop(1, `${hue} / 0.75)`);
    g.fillStyle = band;
    g.fillRect(0, y0, W, y1 - y0);
    for (let x = 0; x < W; x += 7) {
      g.fillStyle = 'rgba(255,255,255,0.13)';
      g.fillRect(x, y0, 2, y1 - y0);
      g.fillStyle = 'rgba(0,0,0,0.18)';
      g.fillRect(x + 3, y0, 3, y1 - y0);
    }
  }
  // The reference's BAKED gloss: soft diagonal light bands sweeping the top crimp, and the
  // faintest full-face sheen — the shine is printed on the product shot, not blasted by lights.
  g.save();
  g.beginPath();
  g.rect(0, 0, W, crimpH);
  g.clip();
  g.translate(W / 2, crimpH / 2);
  g.rotate(-0.45);
  for (const [off, w2, a] of [[-150, 46, 0.2], [-64, 20, 0.12], [120, 60, 0.16]] as const) {
    g.fillStyle = `rgba(255,255,255,${a})`;
    g.fillRect(off, -crimpH * 1.5, w2, crimpH * 3);
  }
  g.restore();
  if (!back) {
    g.save();
    g.translate(W / 2, H / 2);
    g.rotate(-0.35);
    const sheen = g.createLinearGradient(-W * 0.5, 0, W * 0.6, 0);
    sheen.addColorStop(0, 'rgba(255,255,255,0)');
    sheen.addColorStop(0.48, 'rgba(255,255,255,0.07)');
    sheen.addColorStop(0.55, 'rgba(255,255,255,0.03)');
    sheen.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = sheen;
    g.fillRect(-W, -H, W * 2, H * 2);
    g.restore();
  }
  // The brand on the top crimp (front only): the logo, then MANAFOUNDRY — no plate, no subtitle,
  // printed straight on the foil like the reference.
  if (!back) {
    g.textAlign = 'left';
    g.textBaseline = 'middle';
    g.font = '800 44px system-ui, sans-serif';
    const wordW = g.measureText('MANAFOUNDRY').width;
    const logoSize = crimpH * 0.52;
    const gap = 14;
    const total = (logo ? logoSize + gap : 0) + wordW;
    let x = (W - total) / 2;
    const midY = crimpH * 0.5;
    if (logo) {
      g.drawImage(logo, x, midY - logoSize / 2, logoSize, logoSize);
      x += logoSize + gap;
    }
    // Contrast-aware wordmark: light hues (yellow/green crimps) get near-black ink, dark hues
    // keep white — the brand must read on every pack color.
    const lightness = parseFloat(spec.color.split(' ')[2] ?? '50');
    const lightBand = lightness >= 48;
    g.shadowColor = lightBand ? 'rgba(255,255,255,0.35)' : 'rgba(0,0,0,0.5)';
    g.shadowBlur = 6;
    g.fillStyle = lightBand ? 'rgba(18,18,28,0.92)' : 'rgba(255,255,255,0.96)';
    g.fillText('MANAFOUNDRY', x, midY);
    g.shadowBlur = 0;
    // The seam line where the crimp meets the body — the tear strip, with a cool glow.
    g.fillStyle = 'rgba(140,235,255,0.5)';
    g.fillRect(0, crimpH - 3, W, 10);
    g.fillStyle = 'rgba(255,255,255,0.95)';
    g.fillRect(0, crimpH, W, 4);
    // The SET BLOCK, printed on the wrapper's lower third — no DOM text ever floats over the
    // pack. A chunky black-weight TITLE with a thick dark outline and a white→hue gradient
    // fill (wrapping to two lines when long), with the small outlined "FEAT. «HALLMARK»"
    // credit line under it.
    g.textAlign = 'center';
    const gg = g as CanvasRenderingContext2D & { letterSpacing?: string };
    const FONT = '"Arial Black", system-ui, sans-serif';
    const fitPx = (text: string, startPx: number, minPx: number, maxW: number) => {
      let px = startPx;
      g.font = `900 ${px}px ${FONT}`;
      while (px > minPx && g.measureText(text).width > maxW) {
        px -= 2;
        g.font = `900 ${px}px ${FONT}`;
      }
      return px;
    };
    // One outlined "sticker" line: soft drop shadow under a thick rounded dark stroke, then the
    // fill. `strokeW` overrides the stroke — small white lines over busy art need a heavier one.
    const sticker = (text: string, y: number, px: number, fill: string | CanvasGradient, strokeW?: number) => {
      g.font = `900 ${px}px ${FONT}`;
      g.lineJoin = 'round';
      g.miterLimit = 2;
      g.shadowColor = 'rgba(0,0,0,0.5)';
      g.shadowBlur = 9;
      g.shadowOffsetY = Math.max(2, px * 0.08);
      g.lineWidth = strokeW ?? Math.max(4, px * 0.24);
      g.strokeStyle = '#0d0d20';
      g.strokeText(text, W / 2, y);
      g.shadowColor = 'transparent';
      g.shadowBlur = 0;
      g.shadowOffsetY = 0;
      g.fillStyle = fill;
      g.fillText(text, W / 2, y);
    };
    // The title fill: white shading into the pack's own hue at the baseline, like the reference.
    const hueTok = spec.color.split(' ');
    const titleGrad = (y: number, px: number) => {
      const gr = g.createLinearGradient(0, y - px * 0.52, 0, y + px * 0.52);
      gr.addColorStop(0, '#ffffff');
      gr.addColorStop(0.5, '#eefaff');
      gr.addColorStop(1, `hsl(${hueTok[0]}, ${hueTok[1] ?? '60%'}, 80%)`);
      return gr;
    };
    if (spec.tease) {
      g.shadowColor = 'rgba(0,0,0,0.65)';
      g.shadowBlur = 8;
      g.font = 'italic 600 25px Georgia, "Times New Roman", serif';
      g.fillStyle = 'rgba(253,230,138,0.95)';
      g.fillText('something glints inside…', W / 2, H * 0.71);
      g.shadowBlur = 0;
    }
    // The feat. line hangs off the title's LAST baseline, so it clears one- and two-line titles.
    let featY = H * 0.845;
    if (spec.label) {
      const label = spec.label.toUpperCase();
      const px = fitPx(label, 64, 44, W - 60);
      if (g.measureText(label).width > W - 60 && label.includes(' ')) {
        // Two lines, split at the space nearest the middle — both at the same size.
        const gaps = [...label.matchAll(/ /g)].map(m => m.index);
        const mid = gaps.reduce((a, b) => (Math.abs(b - label.length / 2) < Math.abs(a - label.length / 2) ? b : a));
        const l1 = label.slice(0, mid), l2 = label.slice(mid + 1);
        const px2 = Math.min(fitPx(l1, 54, 32, W - 60), fitPx(l2, 54, 32, W - 60));
        const y1 = H * 0.762;
        sticker(l1, y1, px2, titleGrad(y1, px2));
        const y2 = y1 + px2 * 1.12;
        sticker(l2, y2, px2, titleGrad(y2, px2));
        featY = y2 + px2 * 0.5 + 24;
      } else {
        const y = H * 0.786;
        sticker(label, y, px, titleGrad(y, px));
        featY = y + px * 0.52 + 26;
      }
    }
    if (spec.featName) {
      const feat = `feat. ${spec.featName}`.toUpperCase();
      const px = fitPx(feat, 23, 15, W - 70);
      sticker(feat, featY, px, 'rgba(255,255,255,0.97)', Math.max(7, px * 0.42));
    }
    if (spec.count) {
      gg.letterSpacing = '5px';
      sticker(`${spec.count} CARDS`, H * 0.903, 23, 'rgba(255,255,255,0.9)');
      gg.letterSpacing = '0px';
    }
  }
  return c;
}

type Spring = { cur: number; vel: number; target: number };
type Tween = { t0: number; dur: number; ease: (t: number) => number; apply: (k: number) => void; done?: () => void };

const easeOutBack = (t: number) => 1 + 2.2 * Math.pow(t - 1, 3) + 1.2 * Math.pow(t - 1, 2);
const easeInQuad = (t: number) => t * t;
const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);
const easeInOutCubic = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const linear = (t: number) => t;

function loadImage(url: string | undefined, cors: boolean, timeoutMs = 4000): Promise<HTMLImageElement | null> {
  return new Promise(resolve => {
    if (!url) { resolve(null); return; }
    const img = new Image();
    // data:/blob: URLs (the generated special-pack art) are same-origin by nature and never touch
    // the HTTP cache — and appending a query param to a data: URL corrupts it (ERR_INVALID_URL).
    const inline = url.startsWith('data:') || url.startsWith('blob:');
    if (cors && !inline) img.crossOrigin = 'anonymous';
    const timer = window.setTimeout(() => resolve(null), timeoutMs);
    img.onload = () => { window.clearTimeout(timer); resolve(img); };
    img.onerror = () => { window.clearTimeout(timer); resolve(null); };
    // Cache-busting for CORS loads (same gotcha liftShareCard hit): the on-screen <img> cached
    // these WITHOUT CORS approval, and the browser serves that entry to a crossOrigin request.
    img.src = cors && !inline ? url + (url.includes('?') ? '&' : '?') + 'mf3d=1' : url;
  });
}

export async function createPackScene(canvas: HTMLCanvasElement, specs: PackSpec[]): Promise<PackSceneAPI> {
  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  // Neutral keeps the print's saturation honest — ACES desaturates exactly the vivid hues the
  // wrappers live on (the Pokémon product-shot look is bright, punchy, uncompressed color).
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.toneMappingExposure = 1.0;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 50);
  camera.position.set(0, 0, 9);

  const pmrem = new THREE.PMREMGenerator(renderer);
  const envTex = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environment = envTex;
  // The resting look IS the pointer-at-the-bottom look (pack pitched toward the camera): that
  // pose aimed the face's reflection at the room's dark floor instead of its bright ceiling —
  // rich print, no milky wash. Instead of pitching the PACKS, rotate the LIGHT RIG the other
  // way: the env map by ~2× that tilt (mirror rule — a face tilt of θ swings the reflection
  // by 2θ) and the key by ~1× (diffuse moves 1:1).
  const RIG_ROT = 0.34;
  scene.environmentRotation.x = -RIG_ROT;
  // A faint key from the TOP LEFT — enough to catch the stack's top edge and the crimp folds,
  // never enough to wash the print. Ambient carries most of the art's brightness (no specular).
  // High and far to the LEFT, like the reference's studio light: highlights rake the top-left
  // edges and the crimp folds, and the stack's upper-left edge catches its line.
  const key = new THREE.DirectionalLight(0xffffff, 0.3);
  key.position.set(-8, 11, 4);
  key.position.applyEuler(new THREE.Euler(-RIG_ROT / 2, 0, 0));
  scene.add(key);
  scene.add(new THREE.AmbientLight(0xffffff, 0.35));

  const [logo, ...arts] = await Promise.all([
    loadImage(`${import.meta.env.BASE_URL}logo.png`, false),
    ...specs.map(s => loadImage(s.artUrl, true)),
  ]);

  const groups: THREE.Group[] = [];
  const inners: THREE.Group[] = [];        // hover-bob container inside each group
  const pieces: { strip: THREE.Group; body: THREE.Group; stripY: number; bodyY: number }[] = [];
  const hues: THREE.Color[] = [];          // the pack hue, for tinted burst sparks
  const springs: { rx: Spring; ry: Spring; amt: number; hovered: boolean }[] = [];
  const disposables: { dispose(): void }[] = [pmrem, envTex, renderer];

  // One shared soft round glow (sprite) texture: tear head, flash, mouth spill, and spark points.
  const gtex = (() => {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d')!;
    const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(0.35, 'rgba(255,255,255,0.55)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 64, 64);
    const tex = new THREE.CanvasTexture(c);
    disposables.push(tex);
    return tex;
  })();

  function glowQuad(w: number, h: number, color: number): THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial> {
    const geo = new THREE.PlaneGeometry(w, h);
    const mat = new THREE.MeshBasicMaterial({
      map: gtex, color, transparent: true,
      blending: THREE.AdditiveBlending, depthWrite: false,
    });
    disposables.push(geo, mat);
    const m = new THREE.Mesh(geo, mat);
    m.renderOrder = 5;
    return m;
  }

  // --- Foil sparks: tiny additive points with per-particle birth time, velocity, gravity, and a
  //     fade-to-black (additive ⇒ invisible). Integrated in the frame loop; self-disposing. ---
  type SparkSys = {
    pts: THREE.Points; geo: THREE.BufferGeometry; mat: THREE.PointsMaterial;
    parent: THREE.Object3D; t0: number;
    vel: Float32Array; born: Float32Array; life: Float32Array; base: Float32Array;
  };
  let sparks: SparkSys[] = [];

  function spawnSparks(
    parent: THREE.Object3D,
    n: number,
    size: number,
    init: (i: number) => { p: [number, number, number]; v: [number, number, number]; born: number; life: number; c: [number, number, number] },
  ): void {
    const posA = new Float32Array(n * 3), colA = new Float32Array(n * 3);
    const vel = new Float32Array(n * 3), born = new Float32Array(n), life = new Float32Array(n), base = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const d = init(i);
      posA.set(d.p, i * 3);
      vel.set(d.v, i * 3);
      base.set(d.c, i * 3);
      born[i] = d.born;
      life[i] = d.life;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(posA, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(colA, 3));   // black until born
    const mat = new THREE.PointsMaterial({
      map: gtex, size, transparent: true, vertexColors: true,
      blending: THREE.AdditiveBlending, depthWrite: false,
    });
    const pts = new THREE.Points(geo, mat);
    pts.frustumCulled = false;
    pts.renderOrder = 6;
    parent.add(pts);
    sparks.push({ pts, geo, mat, parent, t0: performance.now(), vel, born, life, base });
  }

  const sparkTint = (): [number, number, number] =>
    Math.random() < 0.55 ? [1, 1, 1] : [0.63, 0.91, 1];   // white / seam-cyan

  specs.forEach((spec, i) => {
    const group = new THREE.Group();
    const mkTexMat = (back: boolean) => {
      const tex = new THREE.CanvasTexture(paintWrapper(spec, arts[i], logo, back));
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
      // Product-shot lighting: the print carries HALF its own brightness (emissive map), so the
      // art stays vivid regardless of scene light — the lights only add shading and edge life.
      const mat = new THREE.MeshPhysicalMaterial({
        map: tex,
        emissive: 0xffffff,
        emissiveMap: tex,
        emissiveIntensity: 0.5,
        metalness: 0.1,
        roughness: 0.6,
        clearcoat: 0.16,
        clearcoatRoughness: 0.5,
        envMapIntensity: 0.15,
      });
      disposables.push(tex, mat);
      return mat;
    };
    // The side walls: plain foil in the pack's hue, a shade darker — the visible thickness.
    const hue = new THREE.Color(`hsl(${spec.color.replace(/ /g, ', ')})`);
    hues.push(hue);
    const sideMat = new THREE.MeshPhysicalMaterial({
      color: hue.clone().multiplyScalar(0.5),
      metalness: 0.2,
      roughness: 0.65,
      envMapIntensity: 0.17,
    });
    // The torn faces (strip underside / body mouth): near-black wrapper interior. The "cards
    // glowing inside" is the additive mouth-spill quad, not a lit face.
    const interiorMat = new THREE.MeshBasicMaterial({ color: 0x0a0a10 });
    disposables.push(sideMat, interiorMat);
    const frontMat = mkTexMat(false), backMat = mkTexMat(true);
    // Two pieces, split at the seam, sharing the wrapper materials (UVs are band-remapped).
    // BoxGeometry material order: +x, -x, +y, -y, +z (front), -z (back).
    const stripGeo = pieceGeometry(0, TOP_CRIMP);
    const bodyGeo = pieceGeometry(TOP_CRIMP, 1);
    disposables.push(stripGeo.geo, bodyGeo.geo);
    const stripMesh = new THREE.Mesh(stripGeo.geo, [sideMat, sideMat, sideMat, interiorMat, frontMat, backMat]);
    const bodyMesh = new THREE.Mesh(bodyGeo.geo, [sideMat, sideMat, interiorMat, sideMat, frontMat, backMat]);
    // Each piece in its own pivot group (centered on the piece) so the ceremony can tumble them
    // independently; `inner` carries the idle hover so it never fights tilt springs or tweens.
    const strip = new THREE.Group();
    strip.position.y = stripGeo.offsetY;
    strip.add(stripMesh);
    const body = new THREE.Group();
    body.position.y = bodyGeo.offsetY;
    body.add(bodyMesh);
    const inner = new THREE.Group();
    inner.add(strip, body);
    group.add(inner);
    scene.add(group);
    groups.push(group);
    inners.push(inner);
    pieces.push({ strip, body, stripY: stripGeo.offsetY, bodyY: bodyGeo.offsetY });
    springs.push({ rx: { cur: 0, vel: 0, target: 0 }, ry: { cur: 0, vel: 0, target: 0 }, amt: 0, hovered: false });
  });

  let worldPerPx = 0.01;
  let canvasH = 1;
  // The world y of the VISUAL focus — 220px below the CONTAINER top, which is HEADROOM_PX below
  // the canvas top (the canvas overshoots above so the looming pack's crimp and the popped strip
  // have room, and far below so falling packs exit the screen instead of clipping at an edge).
  // Keep these in step with the canvas classes in BrewPackCrack.
  let focusY = 0;
  const HEADROOM_PX = 160;
  const FOCUS_PX = HEADROOM_PX + 220;
  const basePos: THREE.Vector3[] = specs.map(() => new THREE.Vector3());
  const baseScale: number[] = specs.map(() => 1);

  // The deal-in: on the FIRST layout, each pack starts a touch below its shelf spot and rises
  // into place left→right — riding on top of the wrapper's CSS slide-up, so the three don't all
  // get pushed in as one rigid unit. Ceremony-safe: stage()'s tweens apply after this one in the
  // frame loop, and it reads the (resize-fresh) basePos every frame, so a mid-deal resize holds.
  let dealtIn = false;
  const DEAL_DROP_PX = 70;
  const DEAL_STEP_MS = 90;
  const DEAL_RISE_MS = 420;

  function layout(zones: PackZone[]) {
    const w = canvas.clientWidth || 1;
    const h = canvas.clientHeight || 1;
    canvasH = h;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    const visibleH = 2 * camera.position.z * Math.tan((camera.fov * Math.PI) / 360);
    worldPerPx = visibleH / h;
    focusY = (h / 2 - FOCUS_PX) * worldPerPx;
    zones.forEach((z, i) => {
      if (!groups[i]) return;
      basePos[i].set((z.cx - w / 2) * worldPerPx, (h / 2 - z.cy) * worldPerPx, 0);
      baseScale[i] = (z.w * worldPerPx) / PACK_W;
      groups[i].position.copy(basePos[i]);
      groups[i].scale.setScalar(baseScale[i]);
    });
    if (!dealtIn) {
      dealtIn = true;
      groups.forEach((g, i) => {
        const total = i * DEAL_STEP_MS + DEAL_RISE_MS;
        g.position.y = basePos[i].y - DEAL_DROP_PX * worldPerPx;
        tween(total, t => t, k => {
          // Per-pack delay lives inside one linear tween: hold below until this pack's turn.
          const p = Math.min(1, Math.max(0, (k * total - i * DEAL_STEP_MS) / DEAL_RISE_MS));
          g.position.y = basePos[i].y - DEAL_DROP_PX * worldPerPx * (1 - easeOutCubic(p));
        });
      });
    }
  }

  let tweens: Tween[] = [];
  function tween(dur: number, ease: (t: number) => number, apply: (k: number) => void, done?: () => void) {
    tweens.push({ t0: performance.now(), dur, ease, apply, done });
  }

  let raf = 0;
  let disposed = false;
  let lastT = performance.now();
  function frame() {
    if (disposed) return;
    const now = performance.now();
    const dt = Math.min(0.05, (now - lastT) / 1000);
    lastT = now;
    groups.forEach((g, i) => {
      const s = springs[i];
      for (const key2 of ['rx', 'ry'] as const) {
        const sp = s[key2];
        sp.vel = sp.vel * SPRING_D + (sp.target - sp.cur) * SPRING_K;
        sp.cur += sp.vel;
      }
      // Engagement scales the tilt so hover on/off fades instead of stepping.
      s.amt += ((s.hovered ? 1 : 0) - s.amt) * Math.min(1, dt * (s.hovered ? HOVER_IN_RATE : HOVER_OUT_RATE));
      // A slight resting pitch (top toward the camera) aims the face's reflection at the
      // environment's dark floor instead of its bright ceiling — no glare in your eyes.
      g.rotation.x = 0.07 + s.rx.cur * s.amt;
      g.rotation.y = s.ry.cur * s.amt;
      // The idle hover: a very subtle, slow bob (staggered per pack). Lives on the INNER group,
      // so it never fights the tilt springs or the ceremony tweens.
      inners[i].position.y = 0.018 * Math.sin(now * 0.0014 + i * 2.1);
    });
    // Advance the tweens PUSH-SAFELY: done() callbacks chain new tweens mid-iteration (the
    // whole ceremony is built that way), so anything appended while we walk the snapshot must
    // survive into the next frame — a naive `tweens.filter(...)` reassignment would drop them.
    const snapshot = tweens;
    const lenBefore = snapshot.length;
    const keep: Tween[] = [];
    for (let i = 0; i < lenBefore; i++) {
      const t = snapshot[i];
      const k = Math.min(1, (now - t.t0) / t.dur);
      t.apply(t.ease(k));
      if (k >= 1) t.done?.();
      else keep.push(t);
    }
    for (let i = lenBefore; i < snapshot.length; i++) keep.push(snapshot[i]);
    tweens = keep;
    // Integrate the spark systems: gravity + fade; a system disposes itself once fully dark.
    sparks = sparks.filter(sys => {
      const t = now - sys.t0;
      const pos = sys.geo.getAttribute('position') as THREE.BufferAttribute;
      const col = sys.geo.getAttribute('color') as THREE.BufferAttribute;
      let alive = false;
      for (let i = 0; i < sys.born.length; i++) {
        const age = t - sys.born[i];
        if (age < 0) { alive = true; continue; }
        const k = age / sys.life[i];
        const j = i * 3;
        if (k >= 1) { col.setXYZ(i, 0, 0, 0); continue; }
        alive = true;
        sys.vel[j + 1] -= 7 * dt;   // gravity, local units/s²
        pos.setXYZ(i, pos.getX(i) + sys.vel[j] * dt, pos.getY(i) + sys.vel[j + 1] * dt, pos.getZ(i) + sys.vel[j + 2] * dt);
        const fade = 1 - k;
        col.setXYZ(i, sys.base[j] * fade, sys.base[j + 1] * fade, sys.base[j + 2] * fade);
      }
      pos.needsUpdate = true;
      col.needsUpdate = true;
      if (!alive) {
        sys.parent.remove(sys.pts);
        sys.geo.dispose();
        sys.mat.dispose();
        return false;
      }
      return true;
    });
    renderer.render(scene, camera);
    raf = requestAnimationFrame(frame);
  }
  raf = requestAnimationFrame(frame);

  return {
    layout,
    pointer(idx, px = 0.5, py = 0.5) {
      springs.forEach((s, i) => {
        s.hovered = idx === i;
        if (s.hovered) {
          // "Press where you touch": pointer at the top tips the top AWAY. Note three's rotation.x
          // sign is the OPPOSITE of CSS rotateX — positive tips the top toward the camera.
          s.rx.target = (py - 0.5) * TILT_RANGE;
          s.ry.target = (px - 0.5) * TILT_RANGE;
        }
        // Not hovered: KEEP the last targets. The engagement fade settles the pack back along
        // its current lean — re-targeting center would spring it back at full stiffness (snap).
      });
    },
    stage(idx) {
      const dropH = (canvasH * worldPerPx) * 1.4;
      groups.forEach((g, i) => {
        if (i === idx) return;
        const dir = i < idx || (idx === 0 && i > 0) ? -1 : 1;
        const from = g.position.clone();
        tween(750, easeInQuad, k => {
          g.position.y = from.y + 0.3 * Math.sin(Math.min(k * 3, 1) * Math.PI) - dropH * k;
          g.position.x = from.x + dir * 0.6 * k;
          g.rotation.z = dir * 0.5 * k;
        });
      });
      const g = groups[idx];
      const from = g.position.clone();
      const fromScale = g.scale.x;
      tween(560, easeOutBack, k => {
        g.position.x = from.x * (1 - k);
        g.position.y = from.y + (focusY - from.y) * k;
        g.position.z = 1.6 * k;
        g.scale.setScalar(fromScale * (1 + 0.12 * k));
      }, () => {
        tween(690, easeOutCubic, k => {
          g.position.z = 1.6 + 1.1 * k;
        });
      });
    },
    // The crack, Pocket-style, in three beats:
    //   1. TEAR — a white-hot spark head sweeps the seam left→right, spraying foil dust; the
    //      pack shivers under it and the strip works itself loose.
    //   2. POP — the strip releases in a flash, hops, and tumbles off toward the camera; light
    //      spills from the open mouth; the body recoils from the release.
    //   3. SHED — the promise resolves (the DOM cards erupt now) and the emptied wrapper slides
    //      down and tumbles away underneath them.
    burst(idx) {
      return new Promise<void>(resolve => {
        const g = groups[idx];
        const inner = inners[idx];
        const { strip, body, stripY, bodyY } = pieces[idx];
        const sc = g.scale.x || 1;
        const seamY = PACK_H * (0.5 - TOP_CRIMP);   // the seam, in pack-local y
        const front = PACK_T / 2 + BULGE + 0.1;     // just proud of the wrapper's face
        const dropLocal = (canvasH * worldPerPx * 1.6) / sc;

        // Beat 1: the tear. A hot white core inside a wider cool halo, so the head reads even
        // over a bright wrapper. Trail sparks are pre-seeded along the head's (eased) path.
        const head = glowQuad(0.85, 0.6, 0x9fe8ff);
        const core = glowQuad(0.34, 0.26, 0xffffff);
        head.add(core);
        head.position.set(-PACK_W / 2, seamY, front);
        inner.add(head);
        spawnSparks(inner, 40, 0.07, i => {
          const born = (i / 40) * TEAR_MS;
          const x = -PACK_W / 2 + PACK_W * easeInOutCubic(born / TEAR_MS);
          return {
            p: [x, seamY + rnd(-0.02, 0.02), front + rnd(0, 0.05)],
            v: [rnd(-0.4, 0.4), rnd(0.3, 1.2), rnd(0.1, 0.7)],
            born, life: rnd(280, 560), c: sparkTint(),
          };
        });
        tween(TEAR_MS, easeInOutCubic, k => {
          head.position.x = -PACK_W / 2 + PACK_W * k;
          head.material.opacity = Math.min(1, 6 * (1 - k));
          core.material.opacity = head.material.opacity;
          g.rotation.z = 0.016 * Math.sin(k * 40) * (0.3 + 0.7 * k);
          strip.position.y = stripY + 0.025 * k;
          strip.rotation.z = 0.03 * Math.sin(k * 23) * k;
        }, () => {
          inner.remove(head);
          g.rotation.z = 0;

          // Beat 2: the pop.
          const flash = glowQuad(1.7, 1.1, 0xcdf2ff);
          flash.position.set(0, seamY, front);
          inner.add(flash);
          tween(260, easeOutCubic, k => {
            flash.scale.setScalar(0.4 + 1.8 * k);
            flash.material.opacity = 0.95 * (1 - k);
          }, () => inner.remove(flash));

          const mouth = glowQuad(PACK_W * 0.94, 0.5, 0xbfe9ff);
          mouth.position.set(0, seamY - 0.06, PACK_T / 2 + 0.06);
          mouth.material.opacity = 0;
          inner.add(mouth);
          tween(150, easeOutCubic, k => { mouth.material.opacity = 0.9 * k; });

          const hue = hues[idx];
          spawnSparks(inner, 70, 0.09, () => {
            const t = Math.random();
            return {
              p: [rnd(-0.5, 0.5), seamY + rnd(-0.04, 0.02), rnd(0, PACK_T)],
              v: [rnd(-1.6, 1.6), rnd(1.2, 4.2), rnd(0.2, 1.4)],
              born: rnd(0, 90), life: rnd(420, 820),
              c: t < 0.75 ? sparkTint() : [hue.r, hue.g, hue.b],
            };
          });

          // The strip: a hop, then gravity wins — tumbling toward the camera and off frame.
          // Ballistic in k (linear time): y' = 0 early for a short apex, then a long fall.
          const stripY0 = stripY + 0.025;
          const hop = 3.4;
          tween(1150, linear, k => {
            strip.position.x = 1.5 * k;
            strip.position.y = stripY0 + hop * k - (dropLocal + hop) * k * k;
            strip.position.z = 0.9 * k;
            strip.rotation.x = -2.4 * k;
            strip.rotation.z = 0.9 * k;
          });

          // The body recoils from the release…
          tween(POP_MS, easeOutCubic, k => {
            body.position.y = bodyY - 0.07 * Math.sin(k * Math.PI);
          }, () => {
            // Beat 3: mouth open — cards erupt (caller's cue) and the wrapper sheds.
            resolve();
            const glow0 = mouth.material.opacity;
            tween(780, easeInQuad, k => {
              body.position.y = bodyY - dropLocal * k;
              body.rotation.x = -1.05 * k;
              body.rotation.z = 0.28 * k;
              mouth.material.opacity = glow0 * Math.max(0, 1 - k * 2.4);
            }, () => inner.remove(mouth));
          });
        });
      });
    },
    dispose() {
      disposed = true;
      cancelAnimationFrame(raf);
      for (const sys of sparks) {
        sys.geo.dispose();
        sys.mat.dispose();
      }
      sparks = [];
      for (const d of disposables) d.dispose();
    },
  };
}
