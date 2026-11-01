// Sternenhimmel hinter der Seite, aus zwei festen Canvas-Ebenen. Hinten liegen Milchstraße und
// Sternenstaub: einmal gezeichnet, beim Scrollen bewegt sich die Ebene kaum. Vorn liegen die
// helleren Sterne: Sie funkeln und wandern beim Scrollen etwas schneller, das gibt Tiefe. Dazu
// kommt ab und zu eine Sternschnuppe. Sternbilder aus Buchstaben der Handschrift schreiben sich
// Strich für Strich, sobald sie ins Bild kommen.
// calm: ein ruhiges Bild ohne Bewegung, für die App. Wer weniger Bewegung eingestellt hat,
// bekommt es auch.

const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
const FAR_EXTRA = 160; // so viel ist die hintere Ebene höher, damit sie beim Scrollen wandern kann

// Farben der Sterne: meist Weiß, einige leicht kühl, einige warm
const TINTS = [[255, 255, 255], [238, 240, 246], [222, 227, 240], [255, 243, 226], [255, 228, 198]];
const pickTint = (r) => TINTS[r < 0.5 ? 0 : r < 0.72 ? 1 : r < 0.86 ? 2 : r < 0.95 ? 3 : 4];

// Gleiche Sterne bei jedem Besuch, damit sich der Himmel nach einem Neuladen nicht ändert
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Leuchtpunkt als kleines Bild: einmal zeichnen, danach nur noch kopieren
function sprite([r, g, b]) {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const x = c.getContext('2d');
  const grad = x.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, `rgba(${r},${g},${b},1)`);
  grad.addColorStop(0.1, `rgba(${r},${g},${b},0.9)`);
  grad.addColorStop(0.3, `rgba(${r},${g},${b},0.2)`);
  grad.addColorStop(1, `rgba(${r},${g},${b},0)`);
  x.fillStyle = grad;
  x.fillRect(0, 0, 64, 64);
  return c;
}

function layer(cls) {
  const c = document.createElement('canvas');
  c.className = cls;
  c.setAttribute('aria-hidden', 'true');
  return c;
}

// Strich vereinfachen, bis nur die Knicke übrig sind: dort sitzen die Sterne (Ramer-Douglas-Peucker)
function corners(pts, tol) {
  if (pts.length <= 2) return pts;
  const [ax, ay] = pts[0];
  const [bx, by] = pts[pts.length - 1];
  const len = Math.hypot(bx - ax, by - ay) || 1;
  let far = 0;
  let at = 0;
  for (let i = 1; i < pts.length - 1; i++) {
    const d = Math.abs((bx - ax) * (ay - pts[i][1]) - (ax - pts[i][0]) * (by - ay)) / len;
    if (d > far) { far = d; at = i; }
  }
  if (far < tol) return [pts[0], pts[pts.length - 1]];
  return [...corners(pts.slice(0, at + 1), tol).slice(0, -1), ...corners(pts.slice(at), tol)];
}

// Sternbild aus einer Glyphe (Font-Einheiten, 1000 je em, y nach unten, Grundlinie 0)
function constellation(glyph, rand) {
  const [adv, strokes] = glyph;
  const segs = [];
  const stars = [];
  let total = 0;
  for (const st of strokes) {
    const pts = [];
    for (let k = 0; k < st.length; k += 2) pts.push([st[k], st[k + 1]]);
    const keep = corners(pts, 34);
    keep.forEach(([x, y], i) => {
      if (i > 0) {
        const [px, py] = keep[i - 1];
        const len = Math.hypot(x - px, y - py);
        segs.push({ ax: px, ay: py, bx: x, by: y, at: total, len });
        total += len;
      }
      stars.push({ x, y, at: total, r: 1.1 + rand() * 1.1, tint: pickTint(rand()) });
    });
  }
  return { adv, segs, stars, total, p: 0 };
}

/**
 * Hängt den Himmel an den Anfang von body.
 * letters: Sternbilder, je { ch, x, y }: x als Anteil der Breite (Mitte des Buchstabens),
 * y als Stelle auf der Seite (0 oben, 1 unten): Dort steht das Sternbild im oberen Drittel des
 * Bildschirms. Beim Scrollen zieht es langsamer vorbei als der Text.
 */
export function sky({ calm = false, letters = [] } = {}) {
  const still = calm || reduced;
  const far = layer('sky sky-far');
  const near = layer('sky sky-near');
  document.body.prepend(far, near);
  const fx = far.getContext('2d');
  const nx = near.getContext('2d');
  const sprites = TINTS.map(sprite);
  let W = 0;
  let H = 0;
  let dpr = 1;
  let stars = [];
  let signs = [];
  let meteors = [];
  let nextMeteor = performance.now() + 2600; // die erste kommt bald, die ersten Sekunden zählen
  let maxScroll = 0;
  const measure = () => { maxScroll = Math.max(0, document.documentElement.scrollHeight - innerHeight); };
  new ResizeObserver(measure).observe(document.body);

  function build() {
    dpr = Math.min(2, devicePixelRatio || 1);
    W = near.clientWidth;
    H = near.clientHeight;
    for (const [c, h] of [[near, H], [far, H + FAR_EXTRA]]) {
      c.width = Math.round(W * dpr);
      c.height = Math.round(h * dpr);
    }
    const rand = rng(1103);
    const area = W * H;

    // Hinten: Milchstraße schräg von links unten nach rechts oben, darum Staub
    fx.setTransform(dpr, 0, 0, dpr, 0, 0);
    fx.clearRect(0, 0, W, H + FAR_EXTRA);
    fx.globalCompositeOperation = 'lighter';
    const band = (t) => [W * (-0.1 + 1.2 * t), (H + FAR_EXTRA) * (0.98 - 0.9 * t)];
    const diag = Math.hypot(W, H);
    for (let i = 0; i < 46; i++) {
      const t = rand();
      const [bx, by] = band(t);
      const off = (rand() - 0.5) * diag * 0.12;
      const x = bx + off * 0.6;
      const y = by + off * 0.8;
      const r = diag * (0.05 + rand() * 0.11);
      const warm = Math.abs(t - 0.55) < 0.18 && rand() < 0.45;
      const [cr, cg, cb] = warm ? [255, 226, 196] : [210, 212, 222];
      const g = fx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, `rgba(${cr},${cg},${cb},${0.008 + rand() * 0.014})`);
      g.addColorStop(1, `rgba(${cr},${cg},${cb},0)`);
      fx.fillStyle = g;
      fx.fillRect(x - r, y - r, r * 2, r * 2);
    }
    const dust = Math.round(Math.min(2600, area / 650));
    for (let i = 0; i < dust; i++) {
      let x;
      let y;
      if (rand() < 0.55) {
        const [bx, by] = band(rand());
        const g = (rand() + rand() + rand() - 1.5) * diag * 0.09; // ungefähr normalverteilt
        x = bx + g * 0.6;
        y = by + g * 0.8;
      } else {
        x = rand() * W;
        y = rand() * (H + FAR_EXTRA);
      }
      const [r, g, b] = pickTint(rand());
      fx.fillStyle = `rgba(${r},${g},${b},${0.08 + rand() * 0.32})`;
      const s = 0.5 + rand() * 0.6;
      fx.fillRect(x, y, s, s);
    }
    fx.globalCompositeOperation = 'source-over';

    // Vorn: wenige helle, viele kleine
    const n = Math.round(Math.min(900, area / 2300));
    stars = Array.from({ length: n }, () => {
      const m = rand() ** 3;
      return {
        x: rand() * W,
        y: rand() * H,
        r: 0.4 + m * 1.6,
        a: 0.35 + rand() * 0.6,
        tint: pickTint(rand()),
        f: m > 0.3 ? 0.09 : 0.05,
        tw: rand() < 0.5 ? 0.5 + rand() * 2.4 : 0,
        ph: rand() * Math.PI * 2,
      };
    });
  }

  async function loadSigns() {
    if (!letters.length) return;
    const { GLYPHS } = await import('./hand-font.js');
    const rand = rng(77);
    signs = letters.filter((l) => GLYPHS[l.ch]).map((l) => ({ ...l, ...constellation(GLYPHS[l.ch], rand), p: still ? 1 : 0 }));
    if (still) draw(0, 0);
  }

  function drawSign(c, ox, oy, em) {
    const k = em / 1000;
    const upto = c.p * c.total;
    nx.lineWidth = 1;
    nx.strokeStyle = 'rgba(232, 232, 238, 0.18)';
    nx.beginPath();
    for (const s of c.segs) {
      if (s.at >= upto) break;
      const q = Math.min(1, (upto - s.at) / (s.len || 1));
      nx.moveTo(ox + s.ax * k, oy + s.ay * k);
      nx.lineTo(ox + (s.ax + (s.bx - s.ax) * q) * k, oy + (s.ay + (s.by - s.ay) * q) * k);
    }
    nx.stroke();
    for (const s of c.stars) {
      if (s.at > upto + 1) continue;
      const size = s.r * 9;
      nx.globalAlpha = 0.95;
      nx.drawImage(sprites[TINTS.indexOf(s.tint)], ox + s.x * k - size / 2, oy + s.y * k - size / 2, size, size);
    }
    nx.globalAlpha = 1;
  }

  function draw(t, dt) {
    const scroll = still ? 0 : scrollY;
    far.style.transform = `translate3d(0, ${-Math.min(FAR_EXTRA, scroll * 0.02)}px, 0)`;
    nx.setTransform(dpr, 0, 0, dpr, 0, 0);
    nx.clearRect(0, 0, W, H);
    for (const s of stars) {
      const y = (((s.y - scroll * s.f) % H) + H) % H;
      const a = s.tw ? s.a * (0.72 + 0.28 * Math.sin(t * s.tw + s.ph)) : s.a;
      if (s.r < 1) {
        const [r, g, b] = s.tint;
        nx.fillStyle = `rgba(${r},${g},${b},${a})`;
        nx.fillRect(s.x - s.r, y - s.r, s.r * 2, s.r * 2);
      } else {
        const size = s.r * 8;
        nx.globalAlpha = a;
        nx.drawImage(sprites[TINTS.indexOf(s.tint)], s.x - size / 2, y - size / 2, size, size);
        nx.globalAlpha = 1;
      }
    }

    const em = Math.max(130, Math.min(250, Math.min(W, H) * 0.24));
    for (const c of signs) {
      const ox = c.x * W - (c.adv * em) / 2000;
      const oy = H * 0.3 + (c.y * maxScroll - scroll) * 0.25;
      if (oy < -em * 0.4 || oy - em > H) continue;
      if (c.p < 1 && oy < H * 0.85) c.p = Math.min(1, c.p + dt / 2.6); // schreibt sich, sobald es sichtbar ist
      drawSign(c, ox, oy, em);
    }

    for (const m of meteors) {
      m.t += dt;
      const q = m.t / m.life;
      const hx = m.x + m.dx * m.v * m.t;
      const hy = m.y + m.dy * m.v * m.t;
      const tail = m.len * Math.min(1, q * 3);
      const a = Math.sin(Math.PI * Math.min(1, q));
      const g = nx.createLinearGradient(hx, hy, hx - m.dx * tail, hy - m.dy * tail);
      g.addColorStop(0, `rgba(246, 246, 250, ${0.9 * a})`);
      g.addColorStop(1, 'rgba(246, 246, 250, 0)');
      nx.strokeStyle = g;
      nx.lineWidth = 1.4;
      nx.lineCap = 'round';
      nx.beginPath();
      nx.moveTo(hx, hy);
      nx.lineTo(hx - m.dx * tail, hy - m.dy * tail);
      nx.stroke();
      nx.globalAlpha = a;
      nx.drawImage(sprites[1], hx - 7, hy - 7, 14, 14);
      nx.globalAlpha = 1;
    }
    meteors = meteors.filter((m) => m.t < m.life);
  }

  function meteor(now) {
    const rand = Math.random;
    const left = rand() < 0.5;
    const ang = (left ? Math.PI - 0.55 : 0.55) + (rand() - 0.5) * 0.35;
    meteors.push({
      x: W * (0.15 + rand() * 0.7),
      y: H * (0.04 + rand() * 0.4),
      dx: Math.cos(ang),
      dy: Math.sin(ang),
      v: 650 + rand() * 450,
      len: 110 + rand() * 150,
      life: 0.55 + rand() * 0.45,
      t: 0,
    });
    nextMeteor = now + 7000 + rand() * 13000;
  }

  build();
  loadSigns();
  let width = W;
  let height = H;
  let wait = 0;
  addEventListener('resize', () => {
    clearTimeout(wait);
    wait = setTimeout(() => {
      // Auf dem Handy ändert die Adressleiste ständig die Höhe: nur bei echter Änderung neu würfeln
      if (near.clientWidth === width && Math.abs(near.clientHeight - height) < 120) return;
      build();
      width = W;
      height = H;
      if (still) draw(0, 0);
    }, 150);
  });

  if (still) { draw(0, 0); return; }

  let last = performance.now();
  let lastScroll = -1;
  const frame = (now) => {
    requestAnimationFrame(frame);
    // Funkeln braucht nur etwa 30 Bilder pro Sekunde, beim Scrollen jedes Bild
    if (now - last < 32 && scrollY === lastScroll) return;
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    lastScroll = scrollY;
    if (now > nextMeteor) meteor(now);
    draw(now / 1000, dt);
  };
  requestAnimationFrame(frame);
}
