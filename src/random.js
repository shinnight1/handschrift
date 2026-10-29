// Reproduzierbarer Zufall: gleicher Startwert, gleiche Handschrift.

function rng(seed) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    range: (lo, hi) => lo + (hi - lo) * next(),
    // ungefähr normalverteilt, Standardabweichung 1, auf ±3 begrenzt
    gauss: () => Math.max(-3, Math.min(3, (next() + next() + next() + next() - 2) * 1.732)),
    pick: (arr) => arr[Math.floor(next() * arr.length)],
  };
}

export { rng };
