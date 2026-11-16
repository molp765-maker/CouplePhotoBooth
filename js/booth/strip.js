import { getFilter, gradeFrame } from './filters.js';

export const SHOTS = 4, FW = 432, FH = 324, PAD = 24;
const W = FW + PAD * 2, H = PAD + SHOTS * (FH + PAD) + 90;
const cache = new WeakMap();   // raw shot -> its graded versions, so grain doesn't change on redraw
function graded(shot, f) {
  if (!f.p) return shot;
  let m = cache.get(shot);
  if (!m) { m = {}; cache.set(shot, m); }
  return m[f.id] || (m[f.id] = gradeFrame(shot, f.p));
}

export function createStrip(canvas) {
  const ctx = canvas.getContext('2d');
  canvas.width = W; canvas.height = H;

  function draw(shots, filterId, preview = null) {
    const f = getFilter(filterId);
    ctx.fillStyle = f.paper;
    ctx.fillRect(0, 0, W, H);
    for (let i = 0; i < SHOTS; i++) {
      const y = cellTop(i);
      const shot = shots[i];
      if (shot) {
        const photo = shot.photo || shot;
        const video = preview && preview.videos[i] && preview.videos[i].readyState >= 2 && preview.videos[i].videoWidth
          ? preview.videos[i] : null;
        ctx.drawImage(video || graded(photo, f), PAD, y, FW, FH);
      } else {
        ctx.fillStyle = '#d9d2cc';
        ctx.fillRect(PAD, y, FW, FH);
      }
    }
    ctx.fillStyle = '#191919';
    ctx.textAlign = 'center';
    ctx.font = '500 28px "Bodoni Moda", Didot, Georgia, serif';
    ctx.fillText("Lorin's 21st Birthday", W / 2, H - 46);
    ctx.font = '400 14px "DM Mono", Consolas, monospace';
    ctx.fillText(new Date().toLocaleDateString('en-NZ', { day: '2-digit', month: '2-digit', year: 'numeric' }).replace(/\//g, '.'), W / 2, H - 20);
  }

  function cellTop(index) {
    return PAD + index * (FH + PAD);
  }

  function indexAt(y) {
    for (let i = 0; i < SHOTS; i++) {
      const top = cellTop(i);
      if (y >= top && y < top + FH) return i;
    }
    return -1;
  }

  function photoDataURL(shot, filterId) {
    const f = getFilter(filterId);
    return graded(shot.photo || shot, f).toDataURL('image/png');
  }

  function toDataURL(shots, filterId) {
    draw(shots, filterId);
    return canvas.toDataURL('image/png');
  }

  return { draw, toDataURL, photoDataURL, cellTop, indexAt };
}
