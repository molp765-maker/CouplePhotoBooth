import { startCamera } from '../booth/camera.js';
import { hostRoom, joinRoom } from '../net/session.js';

const TEMPLATE = `
  <h1>Photobooth</h1>
  <p class="sub">Step into the booth together.</p>
  <div class="lobby">
    <div class="stage lobby-cam"><video data-ref="cam" autoplay playsinline muted></video></div>
    <div class="lobby-actions">
      <button class="primary" data-ref="create" disabled>Create a room</button>
      <div class="share" data-ref="share" hidden>
        <label>Room code <input data-ref="codeOut" readonly></label>
        <label>Link to send <input data-ref="link" readonly></label>
        <button data-ref="copy">Copy link</button>
      </div>
      <div class="join">
        <input data-ref="code" maxlength="5" placeholder="Room code" aria-label="Room code" autocapitalize="characters">
        <button data-ref="join" disabled>Join</button>
      </div>
    </div>
  </div>
  <p id="status" data-ref="status">Allow camera access to begin.</p>`;

function explain(e) {
  if (e && e.type === 'peer-unavailable') return 'Room not found. Check the code and try again.';
  return `Connection problem (${(e && e.type) || 'unknown'}). Reload and try again.`;
}

export const lobbyScene = {
  async mount(root, { go, state }) {
    root.innerHTML = TEMPLATE;
    const $ = {};
    root.querySelectorAll('[data-ref]').forEach(el => { $[el.dataset.ref] = el; });

    const finish = s => { state.session = s; go('booth'); };
    const lock = () => { $.create.disabled = true; $.join.disabled = true; };

    function doJoin() {
      if (!$.code.value.trim()) return;
      lock(); $.status.textContent = 'Joining…';
      joinRoom($.code.value, state.localStream, {
        onReady: finish,
        onError: e => { $.status.textContent = explain(e); $.create.disabled = false; $.join.disabled = false; },
      });
    }

    $.create.addEventListener('click', () => {
      lock(); $.status.textContent = 'Creating room…';
      hostRoom(state.localStream, {
        onCode(c) {
          $.codeOut.value = c;
          $.link.value = `${location.origin}${location.pathname}?room=${c}`;
          $.share.hidden = false;
          $.status.textContent = 'Send her the link. The booth opens when she joins.';
        },
        onReady: finish,
        onError: e => { $.status.textContent = explain(e); },
      });
    });
    $.copy.addEventListener('click', async () => {
      try { await navigator.clipboard.writeText($.link.value); $.copy.textContent = 'Copied'; }
      catch (e) { $.link.select(); }
    });
    $.join.addEventListener('click', doJoin);

    try {
      state.localStream = await startCamera($.cam);
    } catch (e) {
      $.status.textContent = e.message === 'unsupported'
        ? 'This browser cannot use the camera here. Open the page over https or localhost.'
        : 'Camera blocked. Allow camera access in your browser settings, then reload.';
      return;
    }
    $.create.disabled = false; $.join.disabled = false;
    $.status.textContent = 'Camera ready. Create a room, or enter a code to join.';
    const room = new URLSearchParams(location.search).get('room');
    if (room) { $.code.value = room; doJoin(); }
  },
  unmount() {},   // the camera stays on for the booth
};
