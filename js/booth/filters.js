// Classic black-and-white photobooth look: warm tint, contrast, grain, vignette.
export function retroFrame(src) {
  const w = src.width, h = src.height;
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d');
  g.drawImage(src, 0, 0);
  const img = g.getImageData(0, 0, w, h), d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    let l = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    l = (l - 128) * 1.25 + 136 + (Math.random() - 0.5) * 28;
    d[i] = l * 1.04; d[i + 1] = l * 0.97; d[i + 2] = l * 0.86;
  }
  g.putImageData(img, 0, 0);
  const v = g.createRadialGradient(w / 2, h / 2, h * 0.35, w / 2, h / 2, w * 0.62);
  v.addColorStop(0, 'rgba(0,0,0,0)'); v.addColorStop(1, 'rgba(0,0,0,.55)');
  g.fillStyle = v; g.fillRect(0, 0, w, h);
  return c;
}
