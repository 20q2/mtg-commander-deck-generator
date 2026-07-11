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
 * The wrapper art is canvas-painted per pack (crimp ridges, brand label + logo, full-bleed
 * headline art) under a matte-foil physical material. Tilt is spring-simulated in the render
 * loop; the ceremony (fall away → fly to center → loom → burst → tumble) runs as in-scene
 * tweens. All procedural — no model files, no HDRs.
 */

export interface PackSpec {
  color: string;      // HSL triplet, e.g. "152 60% 50%" (the pack's hue)
  artUrl?: string;    // headline card art_crop; painted full-bleed onto the wrapper
}

export interface PackZone { cx: number; cy: number; w: number }   // px, relative to the canvas

export interface PackSceneAPI {
  layout(zones: PackZone[]): void;
  pointer(idx: number | null, px?: number, py?: number): void;
  stage(idx: number): void;
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

const { smoothstep } = THREE.MathUtils;
const bell = (t: number, c: number, w: number) => Math.exp(-(((t - c) / w) ** 2));

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

// --- Geometry: a subdivided box, its ±z faces displaced by the profile. Side-wall vertices sit
//     on the boundary where the profile is 0, so the skin stays welded — a true solid. ---
const CORNER_R = 0.05;   // rounded wrapper corners — subtle, not pill-shaped

function packGeometry(): THREE.BoxGeometry {
  const geo = new THREE.BoxGeometry(PACK_W, PACK_H, PACK_T, 30, 46, 1);
  const pos = geo.attributes.position;
  const hw = PACK_W / 2, hh = PACK_H / 2;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const nx = Math.abs(x / hw);
    const u = 0.5 - y / PACK_H;
    const f = packProfile(Math.min(1, nx), Math.min(1, Math.max(0, u)));
    // The back bulges too (a real pack is puffy both ways), just less than the card face.
    pos.setZ(i, z + Math.sign(z) * BULGE * f * (z > 0 ? 1 : 0.55));
    // Rounded corners: a welded warp — every vertex outside a corner's arc is pulled onto it.
    // Front, back, and side vertices share XY coordinates, so the skin stays sealed.
    const cx = Math.sign(x) * (hw - CORNER_R), cy = Math.sign(y) * (hh - CORNER_R);
    if (Math.abs(x) > hw - CORNER_R && Math.abs(y) > hh - CORNER_R) {
      const dx = x - cx, dy = y - cy;
      const d = Math.hypot(dx, dy);
      if (d > CORNER_R) {
        pos.setX(i, cx + (dx / d) * CORNER_R);
        pos.setY(i, cy + (dy / d) * CORNER_R);
      }
    }
  }
  geo.computeVertexNormals();
  return geo;
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
    // Legibility gradient at the bottom (the DOM set plate sits there) — art stays full-bleed.
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
    g.shadowColor = 'rgba(0,0,0,0.5)';
    g.shadowBlur = 6;
    g.fillStyle = 'rgba(255,255,255,0.96)';
    g.fillText('MANAFOUNDRY', x, midY);
    g.shadowBlur = 0;
    // The seam line where the crimp meets the body — the tear strip, with a cool glow.
    g.fillStyle = 'rgba(140,235,255,0.5)';
    g.fillRect(0, crimpH - 3, W, 10);
    g.fillStyle = 'rgba(255,255,255,0.95)';
    g.fillRect(0, crimpH, W, 4);
  }
  return c;
}

type Spring = { cur: number; vel: number; target: number };
type Tween = { t0: number; dur: number; ease: (t: number) => number; apply: (k: number) => void; done?: () => void };

const easeOutBack = (t: number) => 1 + 2.2 * Math.pow(t - 1, 3) + 1.2 * Math.pow(t - 1, 2);
const easeInQuad = (t: number) => t * t;
const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);

function loadImage(url: string | undefined, cors: boolean, timeoutMs = 4000): Promise<HTMLImageElement | null> {
  return new Promise(resolve => {
    if (!url) { resolve(null); return; }
    const img = new Image();
    if (cors) img.crossOrigin = 'anonymous';
    const timer = window.setTimeout(() => resolve(null), timeoutMs);
    img.onload = () => { window.clearTimeout(timer); resolve(img); };
    img.onerror = () => { window.clearTimeout(timer); resolve(null); };
    // Cache-busting for CORS loads (same gotcha liftShareCard hit): the on-screen <img> cached
    // these WITHOUT CORS approval, and the browser serves that entry to a crossOrigin request.
    img.src = cors ? url + (url.includes('?') ? '&' : '?') + 'mf3d=1' : url;
  });
}

export async function createPackScene(canvas: HTMLCanvasElement, specs: PackSpec[]): Promise<PackSceneAPI> {
  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 50);
  camera.position.set(0, 0, 9);

  const pmrem = new THREE.PMREMGenerator(renderer);
  const envTex = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environment = envTex;
  // A faint key from the TOP LEFT — enough to catch the stack's top edge and the crimp folds,
  // never enough to wash the print. Ambient carries most of the art's brightness (no specular).
  const key = new THREE.DirectionalLight(0xffffff, 0.22);
  key.position.set(-4, 6, 4);
  scene.add(key);
  scene.add(new THREE.AmbientLight(0xffffff, 0.5));

  const [logo, ...arts] = await Promise.all([
    loadImage(`${import.meta.env.BASE_URL}logo.png`, false),
    ...specs.map(s => loadImage(s.artUrl, true)),
  ]);

  const groups: THREE.Group[] = [];
  const springs: { rx: Spring; ry: Spring }[] = [];
  const disposables: { dispose(): void }[] = [pmrem, envTex, renderer];

  specs.forEach((spec, i) => {
    const group = new THREE.Group();
    const mkTexMat = (back: boolean) => {
      const tex = new THREE.CanvasTexture(paintWrapper(spec, arts[i], logo, back));
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
      const mat = new THREE.MeshPhysicalMaterial({
        map: tex,
        metalness: 0.1,
        roughness: 0.55,
        clearcoat: 0.25,
        clearcoatRoughness: 0.45,
        envMapIntensity: 0.22,
      });
      disposables.push(tex, mat);
      return mat;
    };
    // The side walls: plain foil in the pack's hue, a shade darker — the visible thickness.
    const sideMat = new THREE.MeshPhysicalMaterial({
      color: new THREE.Color(`hsl(${spec.color.replace(/ /g, ', ')})`).multiplyScalar(0.5),
      metalness: 0.2,
      roughness: 0.6,
      envMapIntensity: 0.25,
    });
    const geo = packGeometry();
    disposables.push(geo, sideMat);
    // BoxGeometry material order: +x, -x, +y, -y, +z (front), -z (back).
    const mesh = new THREE.Mesh(geo, [sideMat, sideMat, sideMat, sideMat, mkTexMat(false), mkTexMat(true)]);
    group.add(mesh);
    scene.add(group);
    groups.push(group);
    springs.push({ rx: { cur: 0, vel: 0, target: 0 }, ry: { cur: 0, vel: 0, target: 0 } });
  });

  let worldPerPx = 0.01;
  let canvasH = 1;
  const basePos: THREE.Vector3[] = specs.map(() => new THREE.Vector3());
  const baseScale: number[] = specs.map(() => 1);

  function layout(zones: PackZone[]) {
    const w = canvas.clientWidth || 1;
    const h = canvas.clientHeight || 1;
    canvasH = h;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    const visibleH = 2 * camera.position.z * Math.tan((camera.fov * Math.PI) / 360);
    worldPerPx = visibleH / h;
    zones.forEach((z, i) => {
      if (!groups[i]) return;
      basePos[i].set((z.cx - w / 2) * worldPerPx, (h / 2 - z.cy) * worldPerPx, 0);
      baseScale[i] = (z.w * worldPerPx) / PACK_W;
      groups[i].position.copy(basePos[i]);
      groups[i].scale.setScalar(baseScale[i]);
    });
  }

  let tweens: Tween[] = [];
  function tween(dur: number, ease: (t: number) => number, apply: (k: number) => void, done?: () => void) {
    tweens.push({ t0: performance.now(), dur, ease, apply, done });
  }

  let raf = 0;
  let disposed = false;
  function frame() {
    if (disposed) return;
    const now = performance.now();
    groups.forEach((g, i) => {
      const s = springs[i];
      for (const key2 of ['rx', 'ry'] as const) {
        const sp = s[key2];
        sp.vel = sp.vel * SPRING_D + (sp.target - sp.cur) * SPRING_K;
        sp.cur += sp.vel;
      }
      // A slight resting pitch (top toward the camera) aims the face's reflection at the
      // environment's dark floor instead of its bright ceiling — no glare in your eyes.
      g.rotation.x = 0.07 + s.rx.cur;
      g.rotation.y = s.ry.cur;
    });
    tweens = tweens.filter(t => {
      const k = Math.min(1, (now - t.t0) / t.dur);
      t.apply(t.ease(k));
      if (k >= 1) { t.done?.(); return false; }
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
        const active = idx === i;
        // "Press where you touch": pointer at the top tips the top AWAY. Note three's rotation.x
        // sign is the OPPOSITE of CSS rotateX — positive tips the top toward the camera.
        s.rx.target = active ? (py - 0.5) * TILT_RANGE : 0;
        s.ry.target = active ? (px - 0.5) * TILT_RANGE : 0;
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
        g.position.y = from.y * (1 - k);
        g.position.z = 1.6 * k;
        g.scale.setScalar(fromScale * (1 + 0.12 * k));
      }, () => {
        tween(690, easeOutCubic, k => {
          g.position.z = 1.6 + 1.1 * k;
        });
      });
    },
    burst(idx) {
      return new Promise<void>(resolve => {
        const g = groups[idx];
        const zFrom = g.position.z;
        const sFrom = g.scale.x;
        tween(140, easeOutCubic, k => {
          g.scale.setScalar(sFrom * (1 + 0.1 * k));
          g.position.z = zFrom + 0.3 * k;
        }, () => {
          const dropH = (canvasH * worldPerPx) * 1.6;
          const yFrom = g.position.y;
          tween(680, easeInQuad, k => {
            g.position.y = yFrom - dropH * k;
            g.rotation.x = -0.9 * k;
            g.rotation.z = 0.35 * k;
          }, resolve);
        });
      });
    },
    dispose() {
      disposed = true;
      cancelAnimationFrame(raf);
      for (const d of disposables) d.dispose();
    },
  };
}
