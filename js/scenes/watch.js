import { watchRoom } from '../net/session.js';

const TEMPLATE = `
  <header class="mast"><span>Retro Photobooth</span><span></span><span data-ref="live">Connecting</span></header>
  <h1 class="booth-title">Watching live.</h1>
  <div class="layout">
    <section>
      <div class="stage" data-ref="stage"><video class="live" data-ref="v" autoplay playsinline muted></video></div>
      <p id="status" data-ref="status">Connecting...</p>
    </section>
    <aside class="strip-wrap">
      <img class="strip-img" data-ref="strip" alt="The finished strip" hidden>
      <p class="strip-cap" data-ref="cap" hidden>Finished strip</p>
    </aside>
  </div>`;

let handle = null;

export const watchScene = {
  mount(root, { params }) {
    root.innerHTML = TEMPLATE;
    const $ = {};
    root.querySelectorAll('[data-ref]').forEach(el => { $[el.dataset.ref] = el; });
    handle = watchRoom(params.code || '', {
      onStream(stream) {
        $.v.srcObject = stream; $.v.play().catch(() => {});
        $.live.textContent = 'Live'; $.status.textContent = 'Watching.';
      },
      onMessage(m) {
        if (m && m.type === 'status') $.status.textContent = m.text;
        if (m && m.type === 'strip') { $.strip.src = m.data; $.strip.hidden = false; $.cap.hidden = false; }
      },
      onClosed() { $.live.textContent = 'Ended'; $.status.textContent = 'The session has ended.'; },
      onError(e) {
        $.live.textContent = 'Offline';
        $.status.textContent = e && e.type === 'peer-unavailable'
          ? 'That session was not found. Ask for a new link.'
          : 'Could not connect. Check your connection and reload.';
      },
    });
  },
  unmount() { if (handle) { handle.close(); handle = null; } },
};
