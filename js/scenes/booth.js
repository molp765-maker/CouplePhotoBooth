import { stopCamera } from '../booth/camera.js';
import { FILTERS, getFilter, stampText } from '../booth/filters.js';
import { clipSupported, createClipRecorder } from '../booth/clip.js';
import { shareView } from '../net/session.js';
import { createSoloLiveSession } from '../net/liveRegistry.js';
import { createStrip, SHOTS, FW, FH } from '../booth/strip.js';
import { HalfRenderer, createSegmenter } from '../booth/cutout.js';
import { PRESETS, makeBackground, fileToBackground, backgroundFromDataURL } from '../booth/scenery.js';

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
          <button data-ref="saveImage" hidden>Save image</button>
          <button data-ref="save" hidden>Save strip</button>
          <button data-ref="saveVideo" hidden>Save video</button>
        </div>
        <div class="links"><button class="film" data-ref="film" aria-expanded="false">Film: <span data-ref="filmName">Normal</span> ▾</button></div>
      </div>
      <div class="filmpop" data-ref="filmPop" hidden></div>

      <p class="monitor-notice" data-ref="monitorNotice" role="status" aria-live="polite" hidden></p>
      <p id="status" data-ref="status">You are both in. Either of you can press Start.</p>
    </section>
    <aside class="strip-wrap">
      <div class="strip-frame">
        <canvas id="strip" data-ref="strip" aria-label="Photo strip. Click a photo to select it." role="group" tabindex="0"></canvas>
        <button class="media-toggle" data-ref="mediaToggle" hidden>Video</button>
      </div>
      <p class="strip-cap">Strip no. 01</p>
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
    const previewVideos = Array.from({ length: SHOTS }, () => {
      const video = document.createElement('video');
      video.muted = true; video.playsInline = true; video.preload = 'auto';
      video.hidden = true; video.setAttribute('aria-hidden', 'true');
      $.strip.parentElement.appendChild(video);
      return video;
    });
    const solo = session.role === 'solo';
    const isHost = session.role !== 'guest';
    if (solo) {
      $.monitorNotice.hidden = false;
      $.monitorNotice.textContent = 'Starting live monitoring. This feed is visible on the public Watch Page.';
    }
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

    // ---- live clip and sharing use one combined picture of the booth view ----
    const compW = FW, compH = FH;
    const comp = document.createElement('canvas');
    comp.width = compW; comp.height = compH;
    const compStream = typeof comp.captureStream === 'function' ? comp.captureStream(20) : null;
    const overlay = { count: '', flashAt: 0 };
    let sharing = null, clipRec = null;
    let disposed = false;
    let liveArchiveError = false;
    let liveHandlePromise = Promise.resolve(null);

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
        if (compStream && (sharing || clipRec)) drawComp(now); }
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
    let selectedShot = -1, showingVideo = false, previewUrls = [], previewRaf = 0;
    let playbackGeneration = 0, playbackSession = null, exportingVideo = false;
    let exportRecorder = null, exportStream = null;
    const allVideosReady = () => state.shots.length === SHOTS && state.shots.every(shot => shot.videoBlob);
    const redraw = () => strip.draw(state.shots, state.filter, showingVideo ? { videos: previewVideos } : null);

    function removePlaybackListeners(playback) {
      previewVideos.forEach(video => {
        video.removeEventListener('ended', playback.onEnded);
        video.removeEventListener('error', playback.onError);
      });
    }

    function stopPreview() {
      showingVideo = false;
      playbackGeneration++;
      cancelAnimationFrame(previewRaf);
      previewRaf = 0;
      const playback = playbackSession;
      playbackSession = null;
      if (playback) {
        removePlaybackListeners(playback);
        playback.resolve(false);
      }
      previewVideos.forEach(video => {
        video.pause();
        video.removeAttribute('src');
        video.load();
      });
      previewUrls.forEach(url => URL.revokeObjectURL(url));
      previewUrls = [];
    }

    function selectShot(index) {
      if (exportingVideo) return;
      if (showingVideo || previewUrls.length) stopPreview();
      selectedShot = index;
      const shot = state.shots[index];
      $.mediaToggle.hidden = !allVideosReady();
      $.mediaToggle.textContent = 'Video';
      $.mediaToggle.style.top = `${((strip.cellTop(index) + 8) / $.strip.height) * 100}%`;
      $.saveImage.disabled = !shot;
      $.saveVideo.disabled = !allVideosReady();
      redraw();
    }

    let lastPreviewDraw = 0;
    function drawPlayback(now) {
      if (!showingVideo) return;
      if (now - lastPreviewDraw >= 33) {
        const masterTime = previewVideos[0].currentTime;
        previewVideos.slice(1).forEach(video => {
          if (!video.ended && Math.abs(video.currentTime - masterTime) > 0.1) video.currentTime = masterTime;
        });
        redraw();
        lastPreviewDraw = now;
      }
      previewRaf = requestAnimationFrame(drawPlayback);
    }

    function waitForVideo(video) {
      if (video.readyState >= 2 && video.videoWidth) return Promise.resolve(true);
      return new Promise((resolve, reject) => {
        const source = video.getAttribute('src');
        const cleanup = () => {
          video.removeEventListener('loadeddata', onReady);
          video.removeEventListener('canplay', onReady);
          video.removeEventListener('error', onError);
          video.removeEventListener('abort', onAbort);
          video.removeEventListener('emptied', onEmptied);
        };
        const onReady = () => {
          if (video.readyState >= 2 && video.videoWidth) { cleanup(); resolve(true); }
        };
        const onError = () => { cleanup(); reject(video.error || new Error('A photo video could not be loaded.')); };
        const onAbort = () => {
          if (video.getAttribute('src') !== source) { cleanup(); resolve(false); }
        };
        const onEmptied = () => {
          if (video.getAttribute('src') !== source) { cleanup(); resolve(false); }
        };
        video.addEventListener('loadeddata', onReady);
        video.addEventListener('canplay', onReady);
        video.addEventListener('error', onError);
        video.addEventListener('abort', onAbort);
        video.addEventListener('emptied', onEmptied);
        onReady();
      });
    }

    async function preparePreview() {
      stopPreview();
      if (!allVideosReady()) throw new Error('All four photo videos are needed for strip playback.');
      const generation = playbackGeneration;
      previewVideos.forEach((video, index) => {
        const url = URL.createObjectURL(state.shots[index].videoBlob);
        previewUrls.push(url);
        video.src = url;
        video.load();
      });
      const ready = await Promise.all(previewVideos.map(waitForVideo));
      if (generation !== playbackGeneration || ready.some(result => !result)) return false;
      previewVideos.forEach(video => { video.currentTime = 0; });
      showingVideo = true;
      redraw();
      return true;
    }

    function finishPreview(playback, error = null) {
      if (playbackSession !== playback) return;
      playbackSession = null;
      removePlaybackListeners(playback);
      stopPreview();
      $.mediaToggle.textContent = 'Video';
      redraw();
      if (error) playback.reject(error);
      else playback.resolve(true);
    }

    function playPreparedVideos() {
      return new Promise((resolve, reject) => {
        const playback = {
          resolve,
          reject,
          onEnded: () => {
            if (previewVideos.every(video => video.ended)) finishPreview(playback);
          },
          onError: () => finishPreview(playback, new Error('A photo video could not be played.')),
        };
        playbackSession = playback;
        previewVideos.forEach(video => {
          video.addEventListener('ended', playback.onEnded);
          video.addEventListener('error', playback.onError);
        });
        Promise.all(previewVideos.map(video => video.play())).then(() => {
          if (playbackSession !== playback) return;
          $.mediaToggle.textContent = 'Photo';
          lastPreviewDraw = 0;
          drawPlayback();
        }).catch(error => finishPreview(playback, error));
      });
    }

    async function togglePreview() {
      if (exportingVideo) return;
      if (showingVideo) {
        stopPreview();
        $.mediaToggle.textContent = 'Video';
        redraw();
        return;
      }
      try {
        if (await preparePreview()) await playPreparedVideos();
      } catch (e) {
        stopPreview();
        $.mediaToggle.textContent = 'Video';
        redraw();
        say('Could not play the full photo strip video.');
      }
    }

    $.strip.addEventListener('click', event => {
      const rect = $.strip.getBoundingClientRect();
      const angle = 1.8 * Math.PI / 180;
      const dx = event.clientX - (rect.left + rect.width / 2);
      const dy = event.clientY - (rect.top + rect.height / 2);
      const localY = -dx * Math.sin(angle) + dy * Math.cos(angle) + $.strip.offsetHeight / 2;
      const y = localY * ($.strip.height / $.strip.offsetHeight);
      const index = strip.indexAt(y);
      if (index >= 0 && state.shots[index]) selectShot(index);
    });
    $.strip.addEventListener('keydown', event => {
      if (!state.shots.length || !['ArrowDown', 'ArrowRight', 'ArrowUp', 'ArrowLeft'].includes(event.key)) return;
      event.preventDefault();
      const direction = event.key === 'ArrowDown' || event.key === 'ArrowRight' ? 1 : -1;
      selectShot((selectedShot + direction + state.shots.length) % state.shots.length);
    });
    $.mediaToggle.addEventListener('click', togglePreview);

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
      if (exportingVideo) return;
      const f = getFilter(id);
      state.filter = f.id;
      $.stage.style.setProperty('--film', f.css);
      $.stage.style.setProperty('--vig', f.vig || 0);
      if (f.p && f.p.stamp) $.stage.dataset.stamp = stampText(); else delete $.stage.dataset.stamp;
      $.filmName.textContent = f.label;
      $.filmPop.querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', b.dataset.id === f.id));
      redraw();
    }

    async function countdown(n, onRecorderStart) {
      for (let i = n; i > 0; i--) {
        $.count.textContent = i; overlay.count = i;
        if (i === n) {
          await wait(500);
          onRecorderStart();
          await wait(500);
        } else {
          await wait(1000);
        }
      }
      $.count.textContent = ''; overlay.count = '';
    }

    async function run() {
      if (busy || exportingVideo) return;
      busy = true; remote = []; stopPreview(); state.shots = []; selectedShot = -1; redraw();
      liveArchiveError = false;
      if (solo) {
        const monitor = await liveHandlePromise;
        if (monitor) {
          try { await monitor.resetPhotos(); }
          catch (error) {
            liveArchiveError = true;
            console.error('Could not reset the Solo session photo archive.', error);
          }
        }
      }
      clipRec = null;
      $.mediaToggle.hidden = true; $.mediaToggle.textContent = 'Video';
      $.start.hidden = true; $.retake.hidden = true; $.saveImage.hidden = true; $.save.hidden = true; $.saveVideo.hidden = true;
      $.saveImage.disabled = true; $.saveVideo.disabled = true;
      $.lamp.classList.add('on');
      let videoError = false;
      for (let i = 0; i < SHOTS; i++) {
        say(`Photo ${i + 1} of ${SHOTS}. Get ready.`);
        let shotRecorder = null;
        await countdown(3, () => {
          if (compStream && clipSupported()) {
            try {
              shotRecorder = createClipRecorder(compStream);
              clipRec = shotRecorder;
            } catch (e) {
              videoError = true;
              console.error(`Could not start recording photo ${i + 1}.`, e);
            }
          } else {
            videoError = true;
          }
        });
        $.flash.classList.remove('go'); void $.flash.offsetWidth; $.flash.classList.add('go'); overlay.flashAt = performance.now();
        const mine = document.createElement('canvas');   // your half, with the chosen background
        mine.width = solo ? FW : HW; mine.height = FH;
        mine.getContext('2d').drawImage(localCanvas, 0, 0, mine.width, FH);
        let videoPromise = null;
        if (shotRecorder) {
          videoPromise = (async () => {
            await wait(2500);
            if (clipRec === shotRecorder) clipRec = null;
            try {
              return await shotRecorder.stop();
            } catch (e) {
              videoError = true;
              console.error(`Could not finish recording photo ${i + 1}.`, e);
              return null;
            }
          })();
        }
        let photo = mine;
        if (solo) {
          const data = mine.toDataURL('image/jpeg', 0.85);
          if (sharing) sharing.send({ type: 'photo', i, total: SHOTS, data });
          liveHandlePromise.then(monitor => monitor && monitor.publishPhoto(i, data))
            .catch(error => {
              liveArchiveError = true;
              console.error(`Could not archive Solo photo ${i + 1}.`, error);
              if (!busy && !disposed) say('A photo was captured locally, but its Watch Page copy could not be saved.');
            });
        } else {
          session.send({ type: 'frame', i, data: mine.toDataURL('image/jpeg', 0.9) });
          const theirs = await Promise.race([slot(i).promise, wait(8000).then(() => null)]);
          photo = compose(mine, theirs);
        }

        let video = null;
        if (videoPromise) {
          video = await videoPromise;
        }
        const videoBlob = video && video.blob.size ? video.blob : null;
        if (video && !videoBlob) {
          videoError = true;
          console.error(`Recording photo ${i + 1} produced an empty video.`);
        }
        state.shots.push({ photo, videoBlob, videoExt: videoBlob && video.ext });
        selectShot(state.shots.length - 1);
        redraw();
        await wait(600);
      }
      $.lamp.classList.remove('on');
      const completionMessages = [];
      if (videoError) completionMessages.push('Some videos could not be recorded.');
      if (liveArchiveError) completionMessages.push('Some photos could not be saved to the Watch Page.');
      say(completionMessages.length ? `Done. ${completionMessages.join(' ')}` : 'Done. Save your photos or retake.');
      if (sharing) sharing.send({ type: 'strip', data: strip.toDataURL(state.shots, state.filter) });
      $.retake.hidden = false; $.saveImage.hidden = false; $.save.hidden = false; $.saveVideo.hidden = false;
      $.saveImage.disabled = selectedShot < 0;
      $.saveVideo.disabled = !allVideosReady();
      $.retake.disabled = false; $.save.disabled = false;
      busy = false;
    }

    const begin = () => { if (!busy && !exportingVideo) { session.send({ type: 'start' }); run(); } };

    async function saveStripVideo() {
      if (exportingVideo || !allVideosReady()) return;
      if (typeof $.strip.captureStream !== 'function' || !clipSupported()) {
        say('Video export is not supported in this browser.');
        return;
      }

      exportingVideo = true;
      [$.mediaToggle, $.saveImage, $.save, $.saveVideo, $.retake].forEach(button => { button.disabled = true; });
      say('Preparing the four-frame video strip...');
      try {
        if (!await preparePreview()) throw new Error('The photo videos were interrupted before export.');
        redraw();
        exportStream = $.strip.captureStream(20);
        exportRecorder = createClipRecorder(exportStream);
        const completed = await playPreparedVideos();
        if (!completed) throw new Error('The full-strip video export was interrupted.');
        const result = await exportRecorder.stop();
        exportRecorder = null;
        if (!result.blob.size) throw new Error('The exported photo strip video is empty.');
        const url = URL.createObjectURL(result.blob);
        const a = document.createElement('a');
        a.download = `photobooth-strip-${state.filter}.${result.ext}`;
        a.href = url; a.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        say('The full photo strip video was saved.');
      } catch (e) {
        stopPreview();
        $.mediaToggle.textContent = 'Video';
        redraw();
        say('Could not save the full photo strip video.');
        console.error('Could not export the full photo strip video.', e);
      } finally {
        if (exportRecorder) {
          try { await exportRecorder.stop(); }
          catch (e) { console.error('Could not stop the photo strip video export.', e); }
          exportRecorder = null;
        }
        if (exportStream) {
          exportStream.getTracks().forEach(track => track.stop());
          exportStream = null;
        }
        exportingVideo = false;
        $.mediaToggle.disabled = false;
        $.saveImage.disabled = selectedShot < 0;
        $.save.disabled = false;
        $.saveVideo.disabled = !allVideosReady();
        $.retake.disabled = false;
        redraw();
      }
    }

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
      if (exportingVideo) return;
      const a = document.createElement('a');
      a.download = `photobooth-strip-${state.filter}.png`;
      a.href = strip.toDataURL(state.shots, state.filter);
      a.click();
    });

    $.saveImage.addEventListener('click', () => {
      if (exportingVideo) return;
      const shot = state.shots[selectedShot];
      if (!shot) return;
      const a = document.createElement('a');
      a.download = `photobooth-photo-${selectedShot + 1}-${state.filter}.png`;
      a.href = strip.photoDataURL(shot, state.filter);
      a.click();
    });

    $.saveVideo.addEventListener('click', saveStripVideo);

    function currentStripDataURL() {
      return state.shots.length ? strip.toDataURL(state.shots, state.filter) : null;
    }
    async function startSharing() {
      if (!compStream) throw new Error('This browser cannot share a live booth canvas.');
      const monitor = await createSoloLiveSession();
      if (disposed) {
        await monitor.finish(currentStripDataURL());
        return null;
      }
      try {
        sharing = shareView(compStream, {
          code: monitor.sessionId,
          onCode() {
            $.monitorNotice.textContent = 'Live monitoring is active. This feed is visible on the public Watch Page.';
            monitor.activate().catch(error => {
              $.monitorNotice.hidden = true;
              console.error('Could not activate the Solo live session.', error);
            });
          },
          onError(error) {
            sharing = null;
            $.monitorNotice.hidden = true;
            console.error('The Solo live video connection failed.', error);
            monitor.finish(currentStripDataURL())
              .catch(finishError => console.error('Could not complete the failed Solo live session.', finishError));
          },
        });
      } catch (error) {
        await monitor.finish(currentStripDataURL());
        throw error;
      }
      return monitor;
    }
    if (solo) {
      liveHandlePromise = startSharing().catch(error => {
        console.error('Could not start automatic Solo live monitoring.', error);
        if (!disposed) $.monitorNotice.hidden = true;
        return null;
      });
    }

    setFilter(state.filter);

    cleanup = () => {
      disposed = true;
      cancelAnimationFrame(raf);
      if (sharing) sharing.close();
      const finalStrip = currentStripDataURL();
      liveHandlePromise.then(monitor => monitor && monitor.finish(finalStrip))
        .catch(error => console.error('Could not archive the completed Solo session.', error));
      stopPreview();
      if (exportRecorder) {
        exportRecorder.stop().catch(error => console.error('Could not stop the photo strip video export.', error));
        exportRecorder = null;
      }
      if (exportStream) {
        exportStream.getTracks().forEach(track => track.stop());
        exportStream = null;
      }
      if (clipRec) {
        clipRec.stop().catch(error => console.error('Could not finish the photo video while leaving the booth.', error));
        clipRec = null;
      }
      previewVideos.forEach(video => video.remove());
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
