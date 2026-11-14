// Film looks. Each one has a CSS version (the live view) and a pixel version (the saved strip).
// vig = darkened corners in the live view; p = settings for the pixel version.
export const FILTERS = [
  { id: 'normal', label: 'Normal', css: 'none', paper: '#F4EFE6' },
  { id: 'retro', label: 'Retro', css: 'grayscale(1) sepia(.35) contrast(1.25) brightness(1.05)', vig: .5, paper: '#e6dac3',
    p: { gray: 1, tint: [1.04, .97, .86], contrast: 1.25, bright: 8, grain: 14, vignette: .55 } },
  { id: 'warm', label: 'Warm', css: 'sepia(.22) saturate(1.2) hue-rotate(-10deg) brightness(1.05) contrast(1.03)', vig: .2, paper: '#f1e6d2',
    p: { sat: 1.2, tint: [1.07, 1, .88], contrast: 1.03, bright: 6, vignette: .22 } },
  { id: 'noir', label: 'Noir', css: 'grayscale(1) contrast(1.5) brightness(.92)', vig: .45, paper: '#ebe7df',
    p: { gray: 1, contrast: 1.5, bright: -10, grain: 18, vignette: .45 } },
  { id: 'faded', label: 'Faded', css: 'saturate(.65) contrast(.82) brightness(1.12) sepia(.1)', paper: '#efe9dd',
    p: { sat: .65, contrast: .82, bright: 14, lift: 18, tint: [1.02, 1, .96] } },
  { id: 'soft', label: 'Soft light', css: 'brightness(1.08) contrast(.9) saturate(1.08)', paper: '#f6efe6',
    p: { sat: 1.08, contrast: .9, bright: 10, tint: [1.03, 1, .98], glow: .35 } },
  { id: 'handheld', label: 'Handheld', css: 'saturate(.8) contrast(1.12) brightness(1.04) hue-rotate(6deg)', vig: .35, paper: '#e9e6df',
    p: { sat: .8, contrast: 1.12, bright: 4, tint: [.97, 1.02, 1], grain: 20, vignette: .38, stamp: true } },
];
export const getFilter = id => FILTERS.find(f => f.id === id) || FILTERS[0];

// The camcorder date in the corner of the Handheld look.
export const stampText = () =>
  new Date().toLocaleDateString('en-NZ', { day: '2-digit', month: '2-digit', year: 'numeric' }).replace(/\//g, '.');

const make = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };

export function gradeFrame(src, p) {
  const w = src.width, h = src.height;
  const c = make(w, h), g = c.getContext('2d');
  g.drawImage(src, 0, 0);
  const img = g.getImageData(0, 0, w, h), d = img.data;
  const { gray = 0, sat = 1, contrast = 1, bright = 0, lift = 0, tint = [1, 1, 1], grain = 0 } = p;
  const s = (1 - gray) * sat;
  const out = (v, n, t) => Math.min(255, Math.max(0, ((v - 128) * contrast + 128 + bright + lift * (1 - v / 255) + n) * t));
  for (let i = 0; i < d.length; i += 4) {
    const l = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    const n = grain ? (Math.random() - 0.5) * grain * 2 : 0;
    d[i] = out(l + (d[i] - l) * s, n, tint[0]);
    d[i + 1] = out(l + (d[i + 1] - l) * s, n, tint[1]);
    d[i + 2] = out(l + (d[i + 2] - l) * s, n, tint[2]);
  }
  g.putImageData(img, 0, 0);

  if (p.glow) {   // soft light: a blurred copy laid over the photo
    const small = make(Math.max(1, w >> 2), Math.max(1, h >> 2));
    small.getContext('2d').drawImage(c, 0, 0, small.width, small.height);
    g.save(); g.globalCompositeOperation = 'screen'; g.globalAlpha = p.glow;
    g.imageSmoothingQuality = 'high'; g.drawImage(small, 0, 0, w, h); g.restore();
  }
  if (p.vignette) {
    const v = g.createRadialGradient(w / 2, h / 2, h * 0.35, w / 2, h / 2, w * 0.62);
    v.addColorStop(0, 'rgba(0,0,0,0)'); v.addColorStop(1, `rgba(0,0,0,${p.vignette})`);
    g.fillStyle = v; g.fillRect(0, 0, w, h);
  }
  if (p.stamp) {
    g.font = '500 14px "DM Mono", Consolas, monospace'; g.textAlign = 'right';
    g.fillStyle = '#ffb347'; g.shadowColor = 'rgba(255,140,40,.6)'; g.shadowBlur = 6;
    g.fillText(stampText(), w - 12, h - 12);
  }
  return c;
}
