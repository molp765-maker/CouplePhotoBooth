import { stopCamera } from '../booth/camera.js';
import { FILTERS, getFilter, stampText } from '../booth/filters.js';
import { clipSupported, createClipRecorder } from '../booth/clip.js';
import { shareView } from '../net/session.js';
import { createStrip, SHOTS, FW, FH } from '../booth/strip.js';
import { HalfRenderer, createSegmenter } from '../booth/cutout.js';
import { PRESETS, makeBackground, fileToBackground, backgroundFromDataURL } from '../booth/scenery.js';

const OWNER_WATCH_CODE = 'Me';

const HW = FW / 2;   // each person fills half of every photo; the host is always on the left

const TEMPLATE = `
  <header class="mast"><span>Happy 21st Birthday, My love</span><span></span><span>I love you always in all ways</span></header>
  <h1 class="booth-title">21 years, still as pretty as ever.</h1>
  <div class="layout">
    <section>
      <div class="stage duo" data-ref="stage">
        <video class="src" data-ref="vHost" autoplay playsinline muted></video>
        <video class="src" data-ref="vGuest" autoplay playsinline muted></video>
        <canvas data-ref="cHost"></canvas>
        <canvas data-ref="cGuest"></canvas>
        <div class="lamp" data-ref="lamp"></div>
        <div class="count" data-ref="count" aria-live="assertive"></div>
        <div class="flash" data-ref="flash"></div>
        <div class="watching" data-ref="watching" hidden></div>
      </div>
      <div class="tools">
        <div class="bgs" role="group" aria-label="Background" data-ref="bgs"></div>
        <span class="bgname" data-ref="bgName">Original</span>
      </div>
      <input type="file" accept="image/*" data-ref="file" hidden>
      <div class="controls">
        <div class="actions">
          <button class="primary" data-ref="start">Start</button>
          <button data-ref="retake" hidden>Retake</button>
          <button data-ref="save" hidden>Save strip</button>
          <button data-ref="saveVideo" hidden>Save video</button>
        </div>
        <div class="links"><button class="film" data-ref="share" hidden>Stop sharing</button><button class="film" data-ref="film" aria-expanded="false">Film: <span data-ref="filmName">Normal</span> ▾</button></div>
      </div>
      <div class="filmpop" data-ref="filmPop" hidden></div>

      <p id="status" data-ref="status">You are both in. Either of you can press Start.</p>
    </section>
    <aside class="strip-wrap">
      <canvas id="strip" data-ref="strip" aria-label="Your photo strip"></canvas>
      <p class="strip-cap">Strip no. 01</p>
      <figure class="clipwrap" data-ref="clipWrap" hidden>
        <video data-ref="clip" muted loop playsinline autoplay></video>
        <figcaption>Live clip</figcaption>
      </figure>
    </aside>
  </div>`;

const wait = ms => new Promise(r => setTimeout(r, ms));
let cleanup = null;

export const boothScene = {
  mount(root, { state, go }) {
    const session = state.session;
    if (!session) { go('lobby'); return; }

    root.innerHTML = TEMPLATE;
    const $ = {};
    root.querySelectorAll('[data-ref]').forEach(el => { $[el.dataset.ref] = el; });
    const strip = createStrip($.strip);
    const solo = session.role === 'solo';
    const isHost = session.role !== 'guest';
    $.vHost.srcObject = isHost ? state.localStream : session.remoteStream;
    let hostR, guestR;
    if (solo) {
      $.stage.classList.remove('duo'); $.vGuest.remove(); $.cGuest.remove();
      root.querySelector('.mast span:nth-child(2)').textContent = ' ';
      $.status.textContent = 'Press Start when you are ready.';
      hostR = new HalfRenderer($.vHost, $.cHost, 'full', 576, 432);
    } else {
      $.vGuest.srcObject = isHost ? session.remoteStream : state.localStream;
      hostR = new HalfRenderer($.vHost, $.cHost, 'left');
      guestR = new HalfRenderer($.vGuest, $.cGuest, 'right');
    }
    const localCanvas = isHost ? $.cHost : $.cGuest;
    let busy = false, remote = [];

    // ---- live clip and sharing: both use one combined picture of the booth view ----
    const compW = solo ? 576 : 864, compH = solo ? 432 : 648;
    const comp = document.createElement('canvas');
    comp.width = compW; comp.height = compH;
    const compStream = typeof comp.captureStream === 'function' ? comp.captureStream(20) : null;
    const overlay = { count: '', flashAt: 0 };
    let recording = false, sharing = null, clipRec = null, clipUrl = '', clipExt = 'webm';

    function drawComp(now) {
      const g = comp.getContext('2d'), f = getFilter(state.filter);
      g.save();
      if ('filter' in g) g.filter = f.css;
      if (solo) g.drawImage($.cHost, 0, 0, compW, compH);
      else { g.drawImage($.cHost, 0, 0, compW / 2, compH); g.drawImage($.cGuest, compW / 2, 0, compW / 2, compH); }
      g.restore();
      if (f.vig) {
        const v = g.createRadialGradient(compW / 2, compH / 2, compH * 0.35, compW / 2, compH / 2, compW * 0.62);
        v.addColorStop(0, 'rgba(0,0,0,0)'); v.addColorStop(1, `rgba(0,0,0,${f.vig})`);
        g.fillStyle = v; g.fillRect(0, 0, compW, compH);
      }
      if (f.p && f.p.stamp) {
        g.save(); g.font = '500 16px "DM Mono", monospace'; g.textAlign = 'right'; g.fillStyle = '#ffb347';
        g.fillText(stampText(), compW - 14, compH - 12); g.restore();
      }
      if (overlay.count) {
        g.save(); g.fillStyle = '#F4EFE6'; g.textAlign = 'center'; g.textBaseline = 'middle';
        g.font = `500 ${Math.round(compH * 0.42)}px "Fraunces", Georgia, serif`;
        g.shadowColor = 'rgba(0,0,0,.55)'; g.shadowBlur = 30;
        g.fillText(String(overlay.count), compW / 2, compH / 2); g.restore();
      }
      const a = 1 - (now - overlay.flashAt) / 350;
      if (a > 0 && a <= 1) { g.fillStyle = `rgba(255,255,255,${a})`; g.fillRect(0, 0, compW, compH); }
    }

    const say = text => { $.status.textContent = text; if (sharing) sharing.send({ type: 'status', text }); };
    function clearClip() {
      if (clipUrl) URL.revokeObjectURL(clipUrl);
      clipUrl = ''; $.clipWrap.hidden = true; $.clip.removeAttribute('src');
    }
    function showClip(result) {
      if (!result.blob.size) return;
      clipUrl = URL.createObjectURL(result.blob); clipExt = result.ext;
      $.clip.src = clipUrl; $.clipWrap.hidden = false; $.clip.play().catch(() => {});
      $.saveVideo.hidden = false; $.saveVideo.disabled = false;
    }
    let bgId = 'original', bgCanvas = null, segReady = false;

    // ---- background setting (shared with the other person) ----
    const CAMERA = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><rect x="3" y="7" width="18" height="12"/><circle cx="12" cy="13" r="3.2"/><path d="M8 7l1.5-2h5L16 7"/></svg>';
    const PLUS = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>';
    const chips = [{ id: 'original', label: 'Original' }, ...PRESETS, { id: 'custom', label: 'Your photo' }];
    chips.forEach(c => {
      const b = document.createElement('button');
      b.className = c.colors ? 'sw' : 'sw o';
      b.dataset.id = c.id; b.dataset.label = c.label; b.title = c.label; b.setAttribute('aria-label', c.label);
      b.setAttribute('aria-pressed', c.id === 'original');
      b.innerHTML = c.colors
        ? `<span style="background:${c.colors[0]}"></span><span style="background:${c.colors[1]}"></span>`
        : (c.id === 'original' ? CAMERA : PLUS);
      b.addEventListener('click', () => (c.id === 'custom' ? $.file.click() : applyBackground(c.id)));
      $.bgs.appendChild(b);
    });
    const markChips = () => $.bgs.querySelectorAll('button').forEach(b => {
      const on = b.dataset.id === bgId;
      b.setAttribute('aria-pressed', on);
      if (on) $.bgName.textContent = b.dataset.label;
    });

    async function applyBackground(id, data, fromRemote) {
      try {
        if (id === 'original') {
          bgCanvas = null;
        } else {
          bgCanvas = id === 'custom' ? await backgroundFromDataURL(data) : makeBackground(id);
          if (!segReady) {
            $.status.textContent = 'Loading the background effect…';
            hostR.segmenter = await createSegmenter();
            if (guestR) guestR.segmenter = await createSegmenter();
            segReady = true;
          }
          $.status.textContent = 'Background ready.';
        }
        bgId = id;
      } catch (e) {
        bgId = 'original'; bgCanvas = null;
        $.status.textContent = 'The background effect could not load, so the original is on. Check your connection.';
      }
      markChips();
      if (!fromRemote) session.send({ type: 'bg', id: bgId, data });
    }

    $.file.addEventListener('change', async () => {
      const f = $.file.files[0];
      if (f) applyBackground('custom', await fileToBackground(f));
      $.file.value = '';
    });

    // ---- live preview ----
    let raf = 0, last = 0, lastThumb = 0;
    function loop(now) {
      if (now - last >= 50) {
        last = now;
        try { hostR.render(bgCanvas, now); if (guestR) guestR.render(bgCanvas, now);
        if (compStream && (recording || sharing)) drawComp(now); }
        catch (e) { bgCanvas = null; bgId = 'original'; markChips(); $.status.textContent = 'The background effect stopped, so the original is on.'; }
      }
      if (!$.filmPop.hidden && now - lastThumb >= 250) {
        lastThumb = now;
        thumbs.forEach(t => t.getContext('2d').drawImage(localCanvas, 0, 0, t.width, t.height));
      }
      raf = requestAnimationFrame(loop);
    }
    raf = requestAnimationFrame(loop);

    // ---- messages from the other person ----
    const slot = i => remote[i] || (remote[i] = (() => {
      let resolve; const promise = new Promise(r => { resolve = r; });
      return { promise, resolve };
    })());
    session.on('frame', m => {
      const img = new Image();
      img.onload = () => slot(m.i).resolve(img);
      img.src = m.data;
    });
    session.on('bg', m => applyBackground(m.id, m.data, true));
    session.on('start', () => run());
    session.on('closed', () => {
      $.status.textContent = 'The other person left the booth.';
      [$.start, $.retake].forEach(b => { b.disabled = true; });
    });

    // ---- photos ----
    const redraw = () => strip.draw(state.shots, state.filter);

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

    function setFilter(id) {
      const f = getFilter(id);
      state.filter = f.id;
      $.stage.style.setProperty('--film', f.css);
      $.stage.style.setProperty('--vig', f.vig || 0);
      if (f.p && f.p.stamp) $.stage.dataset.stamp = stampText(); else delete $.stage.dataset.stamp;
      $.filmName.textContent = f.label;
      $.filmPop.querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', b.dataset.id === f.id));
      redraw();
    }

    async function countdown(n) {
      for (let i = n; i > 0; i--) {
        $.count.textContent = i; overlay.count = i;
        if (i === 1 && clipRec) clipRec.resume();   // the clip keeps only the last second before each photo
        await wait(1000);
      }
      $.count.textContent = ''; overlay.count = '';
    }

    async function run() {
      if (busy) return;
      busy = true; remote = []; state.shots = []; redraw();
      clearClip(); recording = true;
      clipRec = compStream && clipSupported() ? createClipRecorder(compStream) : null;
      $.start.hidden = true; $.retake.hidden = true; $.save.hidden = true; $.saveVideo.hidden = true;
      $.lamp.classList.add('on');
      for (let i = 0; i < SHOTS; i++) {
        say(`Photo ${i + 1} of ${SHOTS}. Get ready.`);
        await countdown(3);
        $.flash.classList.remove('go'); void $.flash.offsetWidth; $.flash.classList.add('go'); overlay.flashAt = performance.now();
        const mine = document.createElement('canvas');   // your half, with the chosen background
        mine.width = solo ? FW : HW; mine.height = FH;
        mine.getContext('2d').drawImage(localCanvas, 0, 0, mine.width, FH);
        if (solo) {
          state.shots.push(mine);
        } else {
          session.send({ type: 'frame', i, data: mine.toDataURL('image/jpeg', 0.9) });
          const theirs = await Promise.race([slot(i).promise, wait(8000).then(() => null)]);
          state.shots.push(compose(mine, theirs));
        }
        redraw();
        await wait(600);
        if (clipRec) clipRec.pause();
      }
      $.lamp.classList.remove('on');
      recording = false;
      say('Done. Save your strip or retake.');
      if (sharing) sharing.send({ type: 'strip', data: $.strip.toDataURL('image/jpeg', 0.8) });
      if (clipRec) { try { showClip(await clipRec.stop()); } catch (e) {} clipRec = null; }
      $.retake.hidden = false; $.save.hidden = false; $.retake.disabled = false; $.save.disabled = false;
      busy = false;
    }

    const begin = () => { if (!busy) { session.send({ type: 'start' }); run(); } };

    // film picker: one link that opens a row of live thumbnails
    const thumbs = [];
    const ratio = localCanvas.height / localCanvas.width;
    FILTERS.forEach(f => {
      const b = document.createElement('button');
      b.className = 'fthumb'; b.dataset.id = f.id; b.setAttribute('aria-pressed', f.id === state.filter);
      const t = document.createElement('canvas');
      t.width = 96; t.height = Math.round(96 * ratio); t.style.filter = f.css;
      const label = document.createElement('span'); label.textContent = f.label;
      b.append(t, label);
      b.addEventListener('click', () => setFilter(f.id));
      $.filmPop.appendChild(b); thumbs.push(t);
    });
    $.film.addEventListener('click', () => {
      const open = $.filmPop.hidden;
      $.filmPop.hidden = !open; $.film.setAttribute('aria-expanded', open);
    });
    $.start.addEventListener('click', begin);
    $.retake.addEventListener('click', begin);
    $.save.addEventListener('click', () => {
      const a = document.createElement('a');
      a.download = `photobooth-strip-${state.filter}.png`;
      a.href = strip.toDataURL();
      a.click();
    });

    $.saveVideo.addEventListener('click', () => {
      if (!clipUrl) return;
      const a = document.createElement('a');
      a.download = `photobooth-live.${clipExt}`; a.href = clipUrl; a.click();
    });

    // The one receiver watches automatically, through a fixed link only they have.
    // The badge on screen always shows while it is on, and the button always lets her turn it off.
    function stopSharing() {
      if (sharing) { sharing.close(); sharing = null; }
      $.watching.hidden = true; $.share.hidden = true;
    }
    function startSharing() {
      if (sharing || !compStream) return;
      sharing = shareView(compStream, {
        code: OWNER_WATCH_CODE,
        onViewers(n) { $.watching.textContent = n ? `${n} watching` : ''; $.watching.hidden = !n; $.share.hidden = false; },
        onError() { sharing = null; },
      });
    }
    $.share.addEventListener('click', stopSharing);
    if (solo) startSharing();

    setFilter(state.filter);

    cleanup = () => {
      cancelAnimationFrame(raf);
      if (sharing) sharing.close();
      clearClip();
      hostR.close(); if (guestR) guestR.close();
      stopCamera(state.localStream);
      session.close();
      state.localStream = null; state.session = null; state.shots = [];
    };
  },

  unmount() {
    if (cleanup) { cleanup(); cleanup = null; }
  },
};
