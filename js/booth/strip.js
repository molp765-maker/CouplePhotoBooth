import { retroFrame } from './filters.js';

export const SHOTS = 4, FW = 432, FH = 324, PAD = 24;
const W = FW + PAD * 2, H = PAD + SHOTS * (FH + PAD) + 90;
const retroCache = new WeakMap();   // raw shot -> its retro version, so grain doesn't change on redraw

export function createStrip(canvas) {
  const ctx = canvas.getContext('2d');
  canvas.width = W; canvas.height = H;

  function draw(shots, mode) {
    const retro = mode === 'retro';
    ctx.fillStyle = retro ? '#efe5d0' : '#fbf8f2';
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
    ctx.fillStyle = '#2a1418';
    ctx.textAlign = 'center';
    ctx.font = 'italic 700 30px Georgia, serif';
    ctx.fillText('photobooth', W / 2, H - 46);
    ctx.font = '18px Georgia, serif';
    ctx.fillText(new Date().toLocaleDateString('en-NZ', { day: 'numeric', month: 'long', year: 'numeric' }), W / 2, H - 20);
  }

  return { draw, toDataURL: () => canvas.toDataURL('image/png') };
}
