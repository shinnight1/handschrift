// Horizon Grid: ein Bodenraster, das zum Horizont hin flieht und langsam auf den Betrachter zuläuft.
// Ohne Abhängigkeiten; zeichnet in ein <canvas>, das per CSS die Fläche des Hintergrunds füllt.

export function horizonGrid(canvas, {
  color = '214, 218, 224', // Silber als RGB, damit sich die Deckkraft pro Linie setzen lässt
  horizon = 0.58,          // Höhe des Horizonts als Anteil der Fläche, oder eine Funktion, die ihn liefert
  columns = 14,            // Längslinien je Seite
  rows = 36,               // Querlinien bis zum Horizont
  speed = 0.35,            // Rasterzellen pro Sekunde
  glow = 0.07,             // Helligkeit des Scheins am Horizont
} = {}) {
  const ctx = canvas.getContext('2d');
  const still = matchMedia('(prefers-reduced-motion: reduce)');
  let w = 0, h = 0, hy = 0, phase = 0, last = 0, raf = 0, visible = true;

  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    w = canvas.clientWidth;
    h = canvas.clientHeight;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    hy = h * (typeof horizon === 'function' ? horizon() : horizon);
    draw();
  }

  function draw() {
    ctx.clearRect(0, 0, w, h);
    const depth = h - hy;
    const cx = w / 2;
    const cell = Math.max(w, 720) / 7; // Zellbreite an der Unterkante

    // Schein hinter dem Horizont
    const shine = ctx.createRadialGradient(cx, hy, 0, cx, hy, Math.max(w, h) * 0.55);
    shine.addColorStop(0, `rgba(${color}, ${glow})`);
    shine.addColorStop(0.35, `rgba(${color}, ${glow / 4})`);
    shine.addColorStop(1, `rgba(${color}, 0)`);
    ctx.fillStyle = shine;
    ctx.fillRect(0, 0, w, h);

    ctx.lineWidth = 1;

    // Längslinien laufen im Fluchtpunkt zusammen und blenden zum Horizont hin aus
    const fade = ctx.createLinearGradient(0, hy, 0, h);
    fade.addColorStop(0, `rgba(${color}, 0)`);
    fade.addColorStop(1, `rgba(${color}, 0.22)`);
    ctx.strokeStyle = fade;
    ctx.beginPath();
    for (let i = -columns; i <= columns; i++) {
      ctx.moveTo(cx, hy);
      ctx.lineTo(cx + i * cell, h);
    }
    ctx.stroke();

    // Querlinien: Abstand z vor der Kamera, y = Horizont + Tiefe / z
    for (let k = 0; k <= rows; k++) {
      const z = k + 1 - phase;
      if (z < 1) continue;
      const y = hy + depth / z;
      const near = (y - hy) / depth;
      ctx.strokeStyle = `rgba(${color}, ${(0.26 * near * near).toFixed(3)})`;
      ctx.beginPath();
      ctx.moveTo(0, Math.round(y) + 0.5);
      ctx.lineTo(w, Math.round(y) + 0.5);
      ctx.stroke();
    }

    // Horizontlinie
    const line = ctx.createLinearGradient(0, 0, w, 0);
    line.addColorStop(0, `rgba(${color}, 0)`);
    line.addColorStop(0.5, `rgba(${color}, 0.45)`);
    line.addColorStop(1, `rgba(${color}, 0)`);
    ctx.strokeStyle = line;
    ctx.beginPath();
    ctx.moveTo(0, Math.round(hy) + 0.5);
    ctx.lineTo(w, Math.round(hy) + 0.5);
    ctx.stroke();
  }

  function frame(now) {
    phase = (phase + Math.min(now - last, 100) / 1000 * speed) % 1;
    last = now;
    draw();
    raf = requestAnimationFrame(frame);
  }

  function update() {
    cancelAnimationFrame(raf);
    raf = 0;
    if (visible && !still.matches && !document.hidden) {
      last = performance.now();
      raf = requestAnimationFrame(frame);
    }
  }

  new ResizeObserver(resize).observe(canvas);
  new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; update(); }).observe(canvas);
  document.addEventListener('visibilitychange', update);
  still.addEventListener('change', update);
  return { refresh: resize };
}
