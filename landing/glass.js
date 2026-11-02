// Liquid Glass: Licht, das dem Finger folgt, Schieber, die wie ein Tropfen von einer Wahl zur
// nächsten fließen, ein Kopf, der beim Scrollen zu Glas wird, und Abschnitte, die beim
// Hinscrollen auftauchen. Reine Zugabe: ohne dieses Modul ist alles da, nur ruhiger.
//
// glass({ header, reveal, pop })
//   header  Selektor des Kopfs, der beim Scrollen die Klasse is-stuck bekommt
//   reveal  Selektor der Elemente, die beim Hinscrollen auftauchen (Startseite)
//   pop     Selektoren von Zahlen, die bei jeder Änderung kurz hüpfen (App: Zähler)

const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

// Flächen, über die das Licht wandert (siehe ::after in den Stylesheets)
const SHINE = '.btn, .nav-app, .type, .faq details, .ctl-play, .big-play, .controls, .panel, .tips, .dialog, .toast, .erase-restore';

export function glass({ header = '', reveal = '', pop = [] } = {}) {
  document.documentElement.classList.add('lg');
  // iOS setzt :active nur, wenn jemand auf Berührungen hört: nötig für das Eindrücken der Knöpfe
  document.addEventListener('touchstart', () => {}, { passive: true });
  shine();
  for (const el of document.querySelectorAll('.seg')) {
    const t = thumb(el, () => el.querySelector('label:has(input:checked)'));
    el.addEventListener('change', () => t(true));
  }
  for (const el of document.querySelectorAll('.steps')) {
    const t = thumb(el, () => el.querySelector('[aria-current="page"]'));
    new MutationObserver(() => t(true)).observe(el, { subtree: true, attributeFilter: ['aria-current'] });
  }
  if (header) stuck(document.querySelector(header));
  if (reveal) reveals(reveal);
  for (const sel of pop) popper(document.querySelector(sel));
}

// Glanzlicht: die Stelle unter Zeiger oder Finger, als --mx/--my in Pixeln
function shine() {
  let target = null;
  let x = 0;
  let y = 0;
  let queued = false;
  const apply = () => {
    queued = false;
    if (!target) return;
    const r = target.getBoundingClientRect();
    target.style.setProperty('--mx', `${(x - r.left).toFixed(1)}px`);
    target.style.setProperty('--my', `${(y - r.top).toFixed(1)}px`);
  };
  const move = (e) => {
    target = e.target instanceof Element ? e.target.closest(SHINE) : null;
    x = e.clientX;
    y = e.clientY;
    if (target && !queued) { queued = true; requestAnimationFrame(apply); }
  };
  document.addEventListener('pointermove', move, { passive: true });
  document.addEventListener('pointerdown', move, { passive: true });
}

// Ein Glastropfen hinter der aktuellen Wahl. Beim Wechsel zieht er sich über beide Plätze
// und schnurrt am Ziel zusammen, statt nur zu gleiten.
function thumb(track, current) {
  const drop = document.createElement('span');
  drop.className = 'lg-thumb';
  drop.setAttribute('aria-hidden', 'true');
  track.prepend(drop);
  track.classList.add('has-thumb');
  let last = null;

  const place = (animate) => {
    const el = current();
    if (!el || !track.offsetParent) { last = null; drop.style.opacity = '0'; return; }
    const now = { x: el.offsetLeft, y: el.offsetTop, w: el.offsetWidth, h: el.offsetHeight };
    Object.assign(drop.style, { opacity: '1', width: `${now.w}px`, height: `${now.h}px`, transform: `translate(${now.x}px, ${now.y}px)` });
    const from = last;
    last = now;
    if (!animate || !from || reduced || (from.x === now.x && from.w === now.w)) return;
    const left = Math.min(from.x, now.x);
    const span = Math.max(from.x + from.w, now.x + now.w) - left;
    drop.animate([
      { width: `${from.w}px`, transform: `translate(${from.x}px, ${now.y}px)` },
      { width: `${span}px`, transform: `translate(${left}px, ${now.y}px) scaleY(0.84)`, offset: 0.42 },
      { width: `${now.w}px`, transform: `translate(${now.x}px, ${now.y}px) scaleY(1.06)`, offset: 0.78 },
      { width: `${now.w}px`, transform: `translate(${now.x}px, ${now.y}px)` },
    ], { duration: 520, easing: 'cubic-bezier(0.3, 0.7, 0.2, 1)' });
  };

  // Größe ändert sich mit Schriften, Fenster und wenn ein versteckter Schritt sichtbar wird
  new ResizeObserver(() => place(false)).observe(track);
  document.fonts?.ready.then(() => place(false));
  place(false);
  return place;
}

// Kopf: oben offen, beim Scrollen eine Glaskapsel
function stuck(el) {
  if (!el) return;
  let on = null;
  const check = () => {
    const now = scrollY > 8;
    if (now !== on) { on = now; el.classList.toggle('is-stuck', now); }
  };
  addEventListener('scroll', check, { passive: true });
  check();
}

// Auftauchen: weich, leicht von unten und aus der Unschärfe; Geschwister nacheinander
function reveals(selector) {
  if (reduced || !('IntersectionObserver' in window)) return;
  const els = [...document.querySelectorAll(selector)];
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      e.target.classList.add('in');
      io.unobserve(e.target);
    }
  }, { rootMargin: '0px 0px -8% 0px', threshold: 0.08 });
  const seen = new Map();
  for (const el of els) {
    const n = seen.get(el.parentElement) ?? 0;
    seen.set(el.parentElement, n + 1);
    el.style.setProperty('--d', `${Math.min(n, 8) * 80}ms`);
    el.classList.add('lg-reveal');
    io.observe(el);
  }
}

// Zahl hüpft kurz, wenn sie sich ändert
function popper(el) {
  if (!el || reduced) return;
  let prev = el.textContent;
  new MutationObserver(() => {
    if (el.textContent === prev) return;
    prev = el.textContent;
    el.animate([
      { transform: 'translateY(0) scale(1)' },
      { transform: 'translateY(-3px) scale(1.16)', offset: 0.35 },
      { transform: 'translateY(0) scale(1)' },
    ], { duration: 460, easing: 'cubic-bezier(0.34, 1.56, 0.64, 1)' });
  }).observe(el, { childList: true, characterData: true, subtree: true });
}
