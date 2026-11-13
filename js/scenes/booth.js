import { grabFrame, stopCamera } from '../booth/camera.js';
import { createStrip, SHOTS, FW, FH } from '../booth/strip.js';

const HW = FW / 2;   // each person fills half of every photo; the host is always on the left

const TEMPLATE = `
  <h1>Photobooth</h1>
  <p class="sub">Four photos, taken together.</p>
  <div class="layout">
    <section>
      <div class="stage duo" data-ref="stage">
        <video data-ref="vHost" autoplay playsinline muted></video>
        <video data-ref="vGuest" autoplay playsinline muted></video>
        <div class="lamp" data-ref="lamp"></div>
        <div class="count" data-ref="count" aria-live="assertive"></div>
        <div class="flash" data-ref="flash"></div>
      </div>
      <div class="modes" role="group" aria-label="Photo style">
        <button data-ref="mNormal" aria-pressed="true">Normal</button>
        <button data-ref="mRetro" aria-pressed="false">Retro</button>
      </div>
      <div class="controls">
        <button class="primary" data-ref="start">Start</button>
        <button data-ref="retake" disabled>Retake</button>
        <button data-ref="save" disabled>Save strip</button>
      </div>
      <p id="status" data-ref="status">You are both in. Either of you can press Start.</p>
    </section>
    <aside class="strip-wrap">
      <canvas id="strip" data-ref="strip" aria-label="Your photo strip"></canvas>
    </aside>
  </div>`;

const wait = ms => new Promise(r => setTimeout(r, ms));
let activeState = null;

export const boothScene = {
  mount(root, { state, go }) {
    const session = state.session;
    if (!session) { go('lobby'); return; }
    activeState = state;

    root.innerHTML = TEMPLATE;
    const $ = {};
    root.querySelectorAll('[data-ref]').forEach(el => { $[el.dataset.ref] = el; });
    const strip = createStrip($.strip);
    const isHost = session.role === 'host';
    $.vHost.srcObject = isHost ? state.localStream : session.remoteStream;
    $.vGuest.srcObject = isHost ? session.remoteStream : state.localStream;
    const localVideo = isHost ? $.vHost : $.vGuest;
    let busy = false;
    let remote = [];   // the other person's halves, by photo number

    const slot = i => remote[i] || (remote[i] = (() => {
      let resolve; const promise = new Promise(r => { resolve = r; });
      return { promise, resolve };
    })());

    session.on('frame', m => {
      const img = new Image();
      img.onload = () => slot(m.i).resolve(img);
      img.src = m.data;
    });
    session.on('start', () => run());
    session.on('closed', () => {
      $.status.textContent = 'The other person left the booth.';
      [$.start, $.retake].forEach(b => { b.disabled = true; });
    });

    const redraw = () => strip.draw(state.shots, state.mode);

    function compose(mine, theirs) {
      const c = document.createElement('canvas');
      c.width = FW; c.height = FH;
      const g = c.getContext('2d');
      g.fillStyle = '#d9d2cc'; g.fillRect(0, 0, FW, FH);
      const [left, right] = isHost ? [mine, theirs] : [theirs, mine];
      if (left) g.drawImage(left, 0, 0, HW, FH);
      if (right) g.drawImage(right, HW, 0, HW, FH);
      return c;
    }

    function setMode(m) {
      state.mode = m;
      $.stage.classList.toggle('retro', m === 'retro');
      $.mNormal.setAttribute('aria-pressed', m === 'normal');
      $.mRetro.setAttribute('aria-pressed', m === 'retro');
      redraw();
    }

    async function countdown(n) {
      for (let i = n; i > 0; i--) { $.count.textContent = i; await wait(1000); }
      $.count.textContent = '';
    }

    async function run() {
      if (busy) return;
      busy = true; remote = []; state.shots = []; redraw();
      [$.start, $.retake, $.save].forEach(b => { b.disabled = true; });
      $.lamp.classList.add('on');
      for (let i = 0; i < SHOTS; i++) {
        $.status.textContent = `Photo ${i + 1} of ${SHOTS}. Get ready.`;
        await countdown(3);
        $.flash.classList.remove('go'); void $.flash.offsetWidth; $.flash.classList.add('go');
        const mine = grabFrame(localVideo, HW, FH);
        session.send({ type: 'frame', i, data: mine.toDataURL('image/jpeg', 0.9) });
        const theirs = await Promise.race([slot(i).promise, wait(8000).then(() => null)]);
        state.shots.push(compose(mine, theirs));
        redraw();
        await wait(600);
      }
      $.lamp.classList.remove('on');
      $.status.textContent = 'Done. Save your strip or retake.';
      $.retake.disabled = false; $.save.disabled = false;
      busy = false;
    }

    const begin = () => { if (!busy) { session.send({ type: 'start' }); run(); } };

    $.mNormal.addEventListener('click', () => setMode('normal'));
    $.mRetro.addEventListener('click', () => setMode('retro'));
    $.start.addEventListener('click', begin);
    $.retake.addEventListener('click', begin);
    $.save.addEventListener('click', () => {
      const a = document.createElement('a');
      a.download = `photobooth-strip-${state.mode}.png`;
      a.href = strip.toDataURL();
      a.click();
    });

    redraw();
  },

  unmount() {
    if (!activeState) return;
    stopCamera(activeState.localStream);
    if (activeState.session) activeState.session.close();
    activeState.localStream = null; activeState.session = null; activeState.shots = [];
    activeState = null;
  },
};
