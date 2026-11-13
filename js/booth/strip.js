import { retroFrame } from './filters.js';

export const SHOTS = 4, FW = 432, FH = 324, PAD = 24;
const W = FW + PAD * 2, H = PAD + SHOTS * (FH + PAD) + 90;
const retroCache = new WeakMap();   // raw shot -> its retro version, so grain doesn't change on redraw

export function createStrip(canvas) {
  const ctx = canvas.getContext('2d');
  canvas.width = W; canvas.height = H;

  function draw(shots, mode) {
    const retro = mode === 'retro';
    ctx.fillStyle = retro ? '#e6dac3' : '#F4EFE6';
    ctx.fillRect(0, 0, W, H);
    for (let i = 0; i < SHOTS; i++) {
      const y = PAD + i * (FH + PAD);
      const shot = shots[i];
      if (shot) {
        if (retro && !retroCache.has(shot)) retroCache.set(shot, retroFrame(shot));
        ctx.drawImage(retro ? retroCache.get(shot) : shot, PAD, y);
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

  return { draw, toDataURL: () => canvas.toDataURL('image/png') };
}
