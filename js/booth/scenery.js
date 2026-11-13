// Shared backgrounds. One wide picture: the host gets the left half, the guest the right half,
// so the two halves of a photo join up into a single scene.
export const BW = 864, BH = 648;
export const PRESETS = [
  { id: 'sunset', label: 'Sunset' },
  { id: 'night', label: 'Night sky' },
  { id: 'bokeh', label: 'Bokeh' },
  { id: 'curtain', label: 'Curtain' },
];

function rng(seed) {   // small seeded random, so both browsers draw the exact same picture
  return () => {
    seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const newCanvas = () => { const c = document.createElement('canvas'); c.width = BW; c.height = BH; return c; };
function gradient(g, stops) {
  const gr = g.createLinearGradient(0, 0, 0, BH);
  stops.forEach(([o, col]) => gr.addColorStop(o, col));
  g.fillStyle = gr; g.fillRect(0, 0, BW, BH);
}
function glow(g, x, y, r, rgb) {
  const gr = g.createRadialGradient(x, y, 5, x, y, r);
  gr.addColorStop(0, `rgba(${rgb},.9)`); gr.addColorStop(1, `rgba(${rgb},0)`);
  g.fillStyle = gr; g.fillRect(0, 0, BW, BH);
}

const DRAW = {
  sunset(g) {
    gradient(g, [[0, '#2b1055'], [.45, '#c2427a'], [.75, '#ff8c5a'], [1, '#ffd27a']]);
    glow(g, BW / 2, 430, 280, '255,235,180');
    g.fillStyle = '#ffe9a8'; g.beginPath(); g.arc(BW / 2, 430, 95, 0, 7); g.fill();
    g.fillStyle = '#3a1650'; g.beginPath(); g.moveTo(0, BH); g.lineTo(0, 500); g.lineTo(150, 430);
    g.lineTo(300, 510); g.lineTo(450, 470); g.lineTo(620, 530); g.lineTo(760, 450); g.lineTo(BW, 520); g.lineTo(BW, BH); g.fill();
  },
  night(g) {
    gradient(g, [[0, '#050a24'], [1, '#1f2f68']]);
    const r = rng(7);
    for (let i = 0; i < 170; i++) {
      g.fillStyle = `rgba(255,255,255,${.3 + r() * .7})`;
      g.beginPath(); g.arc(r() * BW, r() * BH, .6 + r() * 1.8, 0, 7); g.fill();
    }
    glow(g, BW / 2, 150, 170, '246,241,213');
    g.fillStyle = '#f6f1d5'; g.beginPath(); g.arc(BW / 2, 150, 48, 0, 7); g.fill();
  },
  bokeh(g) {
    gradient(g, [[0, '#ff9ec4'], [1, '#8f6bff']]);
    const r = rng(21);
    for (let i = 0; i < 46; i++) {
      g.fillStyle = `rgba(255,255,255,${.12 + r() * .25})`;
      g.beginPath(); g.arc(r() * BW, r() * BH, 18 + r() * 60, 0, 7); g.fill();
    }
  },
  curtain(g) {
    g.fillStyle = '#7d1c2e'; g.fillRect(0, 0, BW, BH);
    g.fillStyle = '#4d0f1b';
    for (let x = 0; x < BW; x += 44) g.fillRect(x + 38, 0, 6, BH);
    const sh = g.createLinearGradient(0, 0, 0, BH);
    sh.addColorStop(0, 'rgba(0,0,0,.35)'); sh.addColorStop(.5, 'rgba(0,0,0,0)'); sh.addColorStop(1, 'rgba(0,0,0,.3)');
    g.fillStyle = sh; g.fillRect(0, 0, BW, BH);
  },
};

export function makeBackground(id) {
  const c = newCanvas();
  DRAW[id](c.getContext('2d'));
  return c;
}

// A photo you choose: fitted to the wide shape and shrunk so it can be sent to the other person.
export function fileToBackground(file) {
  return new Promise((resolve, reject) => {
    const img = new Image(), url = URL.createObjectURL(file);
    img.onload = () => {
      const c = newCanvas(), s = Math.max(BW / img.width, BH / img.height);
      const w = img.width * s, h = img.height * s;
      c.getContext('2d').drawImage(img, (BW - w) / 2, (BH - h) / 2, w, h);
      URL.revokeObjectURL(url);
      resolve(c.toDataURL('image/jpeg', 0.85));
    };
    img.onerror = reject;
    img.src = url;
  });
}

export function backgroundFromDataURL(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => { const c = newCanvas(); c.getContext('2d').drawImage(img, 0, 0, BW, BH); resolve(c); };
    img.onerror = reject;
    img.src = url;
  });
}
