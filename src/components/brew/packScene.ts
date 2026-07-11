import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

/**
 * The real 3D booster packs (lazy-loaded WebGL; the CSS wrapper remains the no-WebGL fallback).
 *
 * Each pack is a procedurally bulged "pillow" — two displaced planes whose edges pinch to flat
 * crimped ends — wearing a canvas-painted wrapper (hue gradient + the headline card's art +
 * crimp ridges) under a clearcoat physical material and a room environment, so the foil catches
 * light like foil. Tilt is spring-simulated in the render loop; the ceremony (unpicked packs
 * fall, the chosen pack flies to center and looms closer, then bursts and tumbles away) runs
 * as tweens inside the same scene — one continuous space, no cuts.
 */

export interface PackSpec {
  color: string;      // HSL triplet, e.g. "152 60% 50%" (the pack's hue)
  artUrl?: string;    // headline card art_crop (CORS-safe from Scryfall); painted onto the wrapper
}

export interface PackZone { cx: number; cy: number; w: number }   // px, relative to the canvas

export interface PackSceneAPI {
  /** Align the 3D packs with the DOM label zones (call on mount + resize). */
  layout(zones: PackZone[]): void;
  /** Pointer tilt: px/py in 0..1 within the pack's zone; idx null = everything springs home. */
  pointer(idx: number | null, px?: number, py?: number): void;
  /** The ceremony: unpicked packs fall away; the chosen one flies to center and looms closer. */
  stage(idx: number): void;
  /** The burst: flash + the emptied wrapper tumbles off the bottom. Resolves when it's gone. */
  burst(idx: number): Promise<void>;
  dispose(): void;
}

const PACK_W = 1.4;
const PACK_H = 2.1;
const BULGE = 0.15;
const TILT_RANGE = 0.34;   // radians of spring tilt at the pack's edges
const SPRING_K = 0.16;
const SPRING_D = 0.78;

// --- Wrapper texture: paint the booster design once per pack onto an offscreen canvas. ---
function paintWrapper(spec: PackSpec, art: HTMLImageElement | null, back: boolean): HTMLCanvasElement {
  const W = 512, H = 768;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d')!;
  const hue = `hsl(${spec.color}`;
  // Foil body: the hue, deeper at the ends.
  const grad = g.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0, `${hue} / 0.95)`);
  grad.addColorStop(0.16, `${hue} / 0.55)`);
  grad.addColorStop(0.8, `${hue} / 0.5)`);
  grad.addColorStop(1, `${hue} / 0.95)`);
  g.fillStyle = '#101014';
  g.fillRect(0, 0, W, H);
  g.fillStyle = grad;
  g.fillRect(0, 0, W, H);
  // The art window (front only), cover-fit with soft fades into the wrapper.
  if (art && !back) {
    const top = H * 0.14, bottom = H * 0.72;
    const winH = bottom - top;
    const scale = Math.max(W / art.width, winH / art.height);
    const dw = art.width * scale, dh = art.height * scale;
    g.save();
    g.beginPath();
    g.rect(0, top, W, winH);
    g.clip();
    g.drawImage(art, (W - dw) / 2, top + (winH - dh) / 2, dw, dh);
    g.restore();
    const fadeT = g.createLinearGradient(0, top, 0, top + 90);
    fadeT.addColorStop(0, `${hue} / 0.9)`);
    fadeT.addColorStop(1, `${hue} / 0)`);
    g.fillStyle = fadeT;
    g.fillRect(0, top, W, 90);
    const fadeB = g.createLinearGradient(0, bottom - 110, 0, bottom);
    fadeB.addColorStop(0, `${hue} / 0)`);
    fadeB.addColorStop(1, `${hue} / 0.85)`);
    g.fillStyle = fadeB;
    g.fillRect(0, bottom - 110, W, 110);
  }
  if (back) {
    // The back is plain foil with a faint emblem ring — packs read differently from behind.
    g.fillStyle = 'rgba(0,0,0,0.35)';
    g.fillRect(0, 0, W, H);
    g.strokeStyle = 'rgba(255,255,255,0.12)';
    g.lineWidth = 10;
    g.beginPath();
    g.arc(W / 2, H / 2, 110, 0, Math.PI * 2);
    g.stroke();
  }
  // Darken toward the label area so DOM text reads over the 3D pack.
  const plate = g.createLinearGradient(0, H * 0.6, 0, H);
  plate.addColorStop(0, 'rgba(0,0,0,0)');
  plate.addColorStop(1, 'rgba(0,0,0,0.55)');
  g.fillStyle = plate;
  g.fillRect(0, H * 0.6, W, H * 0.4);
  // Crimp ridges: fine vertical light/dark stripes across both flattened ends.
  for (const [y0, y1] of [[0, H * 0.055], [H * 0.945, H]] as const) {
    for (let x = 0; x < W; x += 8) {
      g.fillStyle = 'rgba(255,255,255,0.28)';
      g.fillRect(x, y0, 3, y1 - y0);
      g.fillStyle = 'rgba(0,0,0,0.4)';
      g.fillRect(x + 3, y0, 5, y1 - y0);
    }
  }
  return c;
}

// --- Pack geometry: foil stretched over a rigid card stack — a flat plateau across most of the
//     face (the cards inside), falling away at the wrapper's edges and pinching at the crimps,
//     with only a faint breath of dome. Not a balloon. ---
function pillowGeometry(sign: 1 | -1): THREE.PlaneGeometry {
  const geo = new THREE.PlaneGeometry(PACK_W, PACK_H, 28, 40);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const nx = Math.abs(pos.getX(i) / (PACK_W / 2));
    const ny = Math.abs(pos.getY(i) / (PACK_H / 2));
    const plateauX = 1 - THREE.MathUtils.smoothstep(nx, 0.68, 1.0);
    const plateauY = 1 - THREE.MathUtils.smoothstep(ny, 0.55, 0.92);
    const crimp = THREE.MathUtils.smoothstep(ny, 0.78, 0.97);
    const dome = Math.cos((nx * Math.PI) / 2) * Math.cos((ny * Math.PI) / 2);
    const f = (0.85 * plateauX * plateauY + 0.15 * dome) * (1 - crimp * 0.97);
    pos.setZ(i, sign * BULGE * f);
  }
  geo.computeVertexNormals();
  return geo;
}

type Spring = { cur: number; vel: number; target: number };
type Tween = { t0: number; dur: number; ease: (t: number) => number; apply: (k: number) => void; done?: () => void };

const easeOutBack = (t: number) => 1 + 2.2 * Math.pow(t - 1, 3) + 1.2 * Math.pow(t - 1, 2);
const easeInQuad = (t: number) => t * t;
const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);

export async function createPackScene(canvas: HTMLCanvasElement, specs: PackSpec[]): Promise<PackSceneAPI> {
  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 50);
  camera.position.set(0, 0, 9);

  // The room environment is what makes clearcoat foil read as foil — cheap, no HDR asset.
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envTex = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environment = envTex;
  const key = new THREE.DirectionalLight(0xffffff, 0.25);
  key.position.set(4, 5, 3);
  scene.add(key);

  // Load the art images with CORS so the texture canvas never taints. The cache-busting param
  // matters (same gotcha liftShareCard hit): the on-screen <img> cached these WITHOUT CORS
  // approval, and the browser serves that entry to a crossOrigin request — which then fails.
  // A distinct URL forces a fresh fetch that carries Origin, so Scryfall's ACAO header arrives.
  const arts = await Promise.all(specs.map(s => new Promise<HTMLImageElement | null>(resolve => {
    if (!s.artUrl) { resolve(null); return; }
    const img = new Image();
    img.crossOrigin = 'anonymous';
    const timer = window.setTimeout(() => resolve(null), 4000);
    img.onload = () => { window.clearTimeout(timer); resolve(img); };
    img.onerror = () => { window.clearTimeout(timer); resolve(null); };
    img.src = s.artUrl + (s.artUrl.includes('?') ? '&' : '?') + 'mf3d=1';
  })));

  const groups: THREE.Group[] = [];
  const springs: { rx: Spring; ry: Spring }[] = [];
  const disposables: { dispose(): void }[] = [pmrem, envTex, renderer];

  specs.forEach((spec, i) => {
    const group = new THREE.Group();
    const mkMat = (back: boolean) => {
      const tex = new THREE.CanvasTexture(paintWrapper(spec, arts[i], back));
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
      // Matte foil, not chrome: the art should read first, the sheen second. envMapIntensity is
      // the key dial — the flat card-stack face reflects the whole room straight back at the
      // camera, so the environment must whisper, not glare.
      const mat = new THREE.MeshPhysicalMaterial({
        map: tex,
        metalness: 0.15,
        roughness: 0.55,
        clearcoat: 0.25,
        clearcoatRoughness: 0.45,
        envMapIntensity: 0.3,
        side: THREE.FrontSide,
      });
      disposables.push(tex, mat);
      return mat;
    };
    const frontGeo = pillowGeometry(1);
    const backGeo = pillowGeometry(-1);
    disposables.push(frontGeo, backGeo);
    const front = new THREE.Mesh(frontGeo, mkMat(false));
    const backMesh = new THREE.Mesh(backGeo, mkMat(true));
    backMesh.material.side = THREE.BackSide;   // its bulge faces away; render its outside
    group.add(front, backMesh);
    scene.add(group);
    groups.push(group);
    springs.push({ rx: { cur: 0, vel: 0, target: 0 }, ry: { cur: 0, vel: 0, target: 0 } });
  });

  // World-units-per-pixel at the packs' depth plane (z = 0), for DOM↔3D alignment.
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
    // Springs: packs chase their tilt targets with mass.
    groups.forEach((g, i) => {
      const s = springs[i];
      for (const key2 of ['rx', 'ry'] as const) {
        const sp = s[key2];
        sp.vel = sp.vel * SPRING_D + (sp.target - sp.cur) * SPRING_K;
        sp.cur += sp.vel;
      }
      // A slight resting pitch (top toward the camera) aims the flat face's reflection at the
      // environment's dark floor instead of its bright ceiling — no more glare in your eyes.
      g.rotation.x = 0.07 + s.rx.cur;
      g.rotation.y = s.ry.cur;
    });
    // Tweens: the ceremony.
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
        // A small hop, then gravity takes it, tumbling away from the chosen pack.
        tween(750, easeInQuad, k => {
          g.position.y = from.y + 0.3 * Math.sin(Math.min(k * 3, 1) * Math.PI) - dropH * k;
          g.position.x = from.x + dir * 0.6 * k;
          g.rotation.z = dir * 0.5 * k;
        });
      });
      const g = groups[idx];
      const from = g.position.clone();
      const fromScale = g.scale.x;
      // Fly to center with a touch of overshoot…
      tween(560, easeOutBack, k => {
        g.position.x = from.x * (1 - k);
        g.position.y = from.y * (1 - k);
        g.position.z = 1.6 * k;
        g.scale.setScalar(fromScale * (1 + 0.12 * k));
      }, () => {
        // …then keep creeping toward the viewer: the anticipation beat.
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
        // The pop: a fast swell as the seam gives…
        tween(140, easeOutCubic, k => {
          g.scale.setScalar(sFrom * (1 + 0.1 * k));
          g.position.z = zFrom + 0.3 * k;
        }, () => {
          // …then the emptied wrapper tumbles off the bottom, out from under the cards.
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
