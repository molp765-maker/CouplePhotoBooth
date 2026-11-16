import { getStoredImageUrl, subscribeSoloSessions } from '../net/liveRegistry.js';
import { watchRoom } from '../net/session.js';

const STALE_AFTER_MS = 45 * 1000;
const TEMPLATE = `
  <header class="mast"><span>Retro Photobooth</span><span></span><span data-ref="live">Connecting</span></header>
  <h1 class="booth-title watch-title">Solo Mode live monitor.</h1>
  <p class="watch-status" data-ref="status">Finding active Solo sessions...</p>
  <section class="watch-section">
    <h2>Live now <span data-ref="activeCount">0</span></h2>
    <div class="watch-grid" data-ref="activeGrid"></div>
    <p class="watch-empty" data-ref="activeEmpty">No one is in Solo Mode right now.</p>
  </section>
  <section class="watch-section">
    <h2>Completed sessions <span data-ref="completedCount">0</span></h2>
    <div class="completed-grid" data-ref="completedGrid"></div>
    <p class="watch-empty" data-ref="completedEmpty">Completed photo strips will appear here.</p>
  </section>`;

let disposeScene = null;

export const watchScene = {
  mount(root) {
    root.innerHTML = TEMPLATE;
    const $ = {};
    root.querySelectorAll('[data-ref]').forEach(el => { $[el.dataset.ref] = el; });
    const active = new Map();
    const completed = new Map();
    let unsubscribe = null;
    let disposed = false;
    let expirationTimer = null;

    const updateCounts = () => {
      $.activeCount.textContent = String(active.size);
      $.completedCount.textContent = String(completed.size);
      $.activeEmpty.hidden = active.size > 0;
      $.completedEmpty.hidden = completed.size > 0;
      $.live.textContent = active.size ? `${active.size} live` : 'Waiting';
    };

    function updateFullscreenLabel(item) {
      const activeFullscreen = document.fullscreenElement === item.frame;
      const fallbackFullscreen = item.frame.dataset.fullscreenFallback === 'true';
      item.fullscreen.textContent = activeFullscreen || fallbackFullscreen ? 'Exit fullscreen' : 'Fullscreen';
      item.fullscreen.setAttribute('aria-pressed', String(activeFullscreen || fallbackFullscreen));
    }

    function exitFallbackFullscreen() {
      document.querySelectorAll('.watch-video-frame[data-fullscreen-fallback="true"]').forEach(frame => {
        delete frame.dataset.fullscreenFallback;
      });
      active.forEach(updateFullscreenLabel);
    }

    async function toggleFullscreen(item) {
      if (item.frame.dataset.fullscreenFallback === 'true') {
        delete item.frame.dataset.fullscreenFallback;
        updateFullscreenLabel(item);
        return;
      }
      if (document.fullscreenElement === item.frame) {
        await document.exitFullscreen();
        return;
      }
      try {
        if (typeof item.frame.requestFullscreen !== 'function') throw new Error('Fullscreen is not supported.');
        if (document.fullscreenElement) await document.exitFullscreen();
        await item.frame.requestFullscreen();
      } catch (error) {
        item.frame.dataset.fullscreenFallback = 'true';
        console.warn('Using the Watch Page fullscreen fallback.', error);
      }
      updateFullscreenLabel(item);
    }

    function addActivePhoto(item, index, data) {
      let image = item.photoSlots.get(index);
      if (!image) {
        image = new Image();
        image.className = 'watch-shot';
        image.alt = `Photo ${index + 1}`;
        item.photoSlots.set(index, image);
        item.photos.appendChild(image);
      }
      image.src = data;
    }

    function createActiveItem(record) {
      const card = document.createElement('article');
      card.className = 'watch-card';
      const heading = document.createElement('h3');
      heading.textContent = `Solo session ${record.sessionId.slice(0, 6).toUpperCase()}`;
      const frame = document.createElement('div');
      frame.className = 'watch-video-frame';
      const video = document.createElement('video');
      video.className = 'watch-video';
      video.autoplay = true;
      video.playsInline = true;
      video.muted = true;
      const fullscreen = document.createElement('button');
      fullscreen.className = 'watch-fullscreen';
      fullscreen.type = 'button';
      fullscreen.textContent = 'Fullscreen';
      fullscreen.setAttribute('aria-label', `Fullscreen for session ${record.sessionId.slice(0, 6)}`);
      const playFallback = document.createElement('button');
      playFallback.className = 'watch-play-fallback';
      playFallback.type = 'button';
      playFallback.textContent = 'Tap to play live video';
      playFallback.hidden = true;
      const connectionStatus = document.createElement('p');
      connectionStatus.className = 'watch-connection-status';
      connectionStatus.textContent = 'Connecting to the booth...';
      const photos = document.createElement('div');
      photos.className = 'watch-shots';
      const stripPreview = document.createElement('img');
      stripPreview.className = 'watch-preview-strip';
      stripPreview.alt = `Current photo strip from Solo session ${record.sessionId.slice(0, 6)}`;
      stripPreview.hidden = true;
      frame.append(video, fullscreen, playFallback);
      card.append(heading, frame, connectionStatus, photos, stripPreview);
      $.activeGrid.appendChild(card);

      const item = {
        card, frame, video, fullscreen, playFallback, connectionStatus, photos, stripPreview,
        photoSlots: new Map(), handle: null, retryTimer: null, retryDelay: 2500, stopped: false, record,
      };
      fullscreen.addEventListener('click', () => {
        toggleFullscreen(item).catch(error => console.error('Could not change fullscreen mode.', error));
      });
      playFallback.addEventListener('click', () => {
        video.play().then(() => { playFallback.hidden = true; })
          .catch(error => {
            connectionStatus.textContent = 'Playback is blocked by this browser.';
            console.error('Could not start live playback after viewer interaction.', error);
          });
      });

      function retryConnection() {
        if (item.stopped || disposed || item.retryTimer) return;
        if (item.handle) {
          item.handle.close();
          item.handle = null;
        }
        if (video.srcObject) video.srcObject.getTracks().forEach(track => track.stop());
        video.srcObject = null;
        item.connectionStatus.textContent = 'Reconnecting to the booth...';
        const delay = item.retryDelay;
        item.retryDelay = Math.min(item.retryDelay * 2, 20 * 1000);
        item.retryTimer = setTimeout(() => {
          item.retryTimer = null;
          connect();
        }, delay);
      }

      function connect() {
        if (item.stopped || disposed) return;
        item.connectionStatus.textContent = 'Connecting to the booth...';
        try {
          item.handle = watchRoom(record.sessionId, {
            onStream(stream) {
              if (item.stopped) {
                stream.getTracks().forEach(track => track.stop());
                return;
              }
              item.retryDelay = 2500;
              video.srcObject = stream;
              video.play().then(() => {
                playFallback.hidden = true;
                connectionStatus.textContent = 'Live';
              }).catch(error => {
                if (error && error.name === 'NotAllowedError') {
                  playFallback.hidden = false;
                  connectionStatus.textContent = 'Tap to enable live playback.';
                } else {
                  connectionStatus.textContent = 'Live video could not start.';
                  console.error('Could not autoplay a live Solo feed.', error);
                }
              });
            },
            onMessage(message) {
              if (!message) return;
              if (message.type === 'status' && typeof message.text === 'string') {
                connectionStatus.textContent = message.text;
                if (message.text.startsWith('Photo 1 of')) {
                  item.photoSlots.clear();
                  photos.replaceChildren();
                  stripPreview.hidden = true;
                  item.stripData = null;
                }
              }
              if (message.type === 'photo' && Number.isInteger(message.i) && typeof message.data === 'string') {
                addActivePhoto(item, message.i, message.data);
              }
              if (message.type === 'strip' && typeof message.data === 'string') {
                item.stripData = message.data;
                stripPreview.src = message.data;
                stripPreview.hidden = false;
              }
            },
            onClosed() {
              if (!item.stopped) retryConnection();
            },
            onError(error) {
              if (item.stopped) return;
              connectionStatus.textContent = error && error.type === 'peer-unavailable'
                ? 'Waiting for the camera to become available...'
                : 'Connection interrupted; retrying...';
              retryConnection();
            },
          });
        } catch (error) {
          connectionStatus.textContent = 'Could not connect to this live feed.';
          console.error('Could not create a Watch Page connection.', error);
          retryConnection();
        }
      }

      item.stop = () => {
        item.stopped = true;
        clearTimeout(item.retryTimer);
        if (document.fullscreenElement && item.card.contains(document.fullscreenElement)) {
          document.exitFullscreen().catch(error => console.error('Could not exit fullscreen for a completed session.', error));
        }
        delete item.frame.dataset.fullscreenFallback;
        if (item.handle) item.handle.close();
        if (video.srcObject) video.srcObject.getTracks().forEach(track => track.stop());
        video.srcObject = null;
        card.remove();
      };
      connect();
      return item;
    }

    function createCompletedItem(record, previousItem) {
      const card = document.createElement('article');
      card.className = 'completed-card';
      const heading = document.createElement('h3');
      heading.textContent = `Solo session ${record.sessionId.slice(0, 6).toUpperCase()}`;
      const caption = document.createElement('p');
      caption.className = 'completed-status';
      caption.textContent = 'Session completed';
      const imageArea = document.createElement('div');
      imageArea.className = 'completed-images';
      const strip = document.createElement('img');
      strip.className = 'completed-strip';
      strip.alt = `Completed photo strip from Solo session ${record.sessionId.slice(0, 6)}`;
      strip.hidden = true;
      const photoArea = document.createElement('div');
      photoArea.className = 'completed-photos';
      const error = document.createElement('p');
      error.className = 'completed-error';
      error.hidden = true;
      imageArea.append(strip, photoArea);
      card.append(heading, caption, imageArea, error);
      $.completedGrid.prepend(card);

      const signature = `${record.state}:${record.stripPath || ''}:${JSON.stringify(record.photos || {})}:${record.expiresAt || ''}`;
      const item = { card, record, signature };
      const showFallbackPhotos = paths => {
        const entries = Object.entries(paths || {}).sort(([a], [b]) => Number(a) - Number(b));
        if (!entries.length) {
          error.textContent = 'No photos were captured in this session.';
          error.hidden = false;
          return;
        }
        entries.forEach(([index, path]) => {
          const imageReady = path.startsWith('data:') ? Promise.resolve(path) : getStoredImageUrl(path);
          imageReady.then(url => {
            if (!card.isConnected) return;
            const image = new Image();
            image.className = 'completed-photo';
            image.alt = `Photo ${Number(index) + 1} from completed Solo session`;
            image.src = url;
            photoArea.appendChild(image);
          }).catch(loadError => {
            error.textContent = 'Some completed photos could not be loaded.';
            error.hidden = false;
            console.error(`Could not load archived photo ${index} for session ${record.sessionId}.`, loadError);
          });
        });
      };

      if (record.stripPath) {
        getStoredImageUrl(record.stripPath).then(url => {
          if (!card.isConnected) return;
          strip.src = url;
          strip.hidden = false;
        }).catch(loadError => {
          error.textContent = 'The finished strip could not be loaded; showing individual photos instead.';
          error.hidden = false;
          console.error(`Could not load the completed strip for session ${record.sessionId}.`, loadError);
          showFallbackPhotos(record.photos);
        });
      } else if (previousItem && previousItem.stripData) {
        strip.src = previousItem.stripData;
        strip.hidden = false;
      } else {
        showFallbackPhotos(record.photos || (previousItem && previousItem.photoPaths));
      }
      return item;
    }

    function removeActive(sessionId) {
      const item = active.get(sessionId);
      if (!item) return null;
      active.delete(sessionId);
      const previous = {
        stripData: item.stripData || null,
        photoPaths: Object.fromEntries([...item.photoSlots].map(([index, image]) => [index, image.src])),
      };
      item.stop();
      return previous;
    }

    function syncSessions(records) {
      const now = Date.now();
      const present = new Set();
      records.forEach(record => {
        if (!record || !record.sessionId) return;
        const expiry = Number(record.expiresAt) || 0;
        if (expiry && expiry <= now) return;
        present.add(record.sessionId);
        const lastSeen = Number(record.lastSeenAt) || Number(record.createdAt) || now;
        const stale = record.state !== 'completed' && now - lastSeen > STALE_AFTER_MS;
        if (record.state === 'completed' || stale) {
          if (active.has(record.sessionId)) {
            const previous = removeActive(record.sessionId);
            completed.set(record.sessionId, createCompletedItem(record, previous));
          } else {
            const existing = completed.get(record.sessionId);
            const signature = `${record.state}:${record.stripPath || ''}:${JSON.stringify(record.photos || {})}:${record.expiresAt || ''}`;
            if (!existing) completed.set(record.sessionId, createCompletedItem(record, null));
            else if (existing.signature !== signature) {
              existing.card.remove();
              completed.set(record.sessionId, createCompletedItem(record, null));
            }
          }
          return;
        }
        if (!active.has(record.sessionId)) {
          const item = createActiveItem(record);
          active.set(record.sessionId, item);
        } else {
          active.get(record.sessionId).record = record;
        }
        const oldCompleted = completed.get(record.sessionId);
        if (oldCompleted) {
          oldCompleted.card.remove();
          completed.delete(record.sessionId);
        }
      });

      for (const [sessionId, item] of active) {
        const expiry = Number(item.record.expiresAt) || 0;
        if (!present.has(sessionId) && expiry && expiry <= now) {
          item.stop();
          active.delete(sessionId);
        }
      }
      for (const [sessionId, item] of completed) {
        const expiry = Number(item.record.expiresAt) || 0;
        if (!present.has(sessionId) && expiry && expiry <= now) {
          item.card.remove();
          completed.delete(sessionId);
        }
      }
      updateCounts();
    }

    function onKeydown(event) {
      if (event.key === 'Escape') exitFallbackFullscreen();
    }
    function onFullscreenChange() {
      active.forEach(updateFullscreenLabel);
    }
    document.addEventListener('fullscreenchange', onFullscreenChange);
    document.addEventListener('keydown', onKeydown);

    expirationTimer = setInterval(() => {
      syncSessions([...active.values(), ...completed.values()].map(item => item.record));
    }, 60 * 1000);
    subscribeSoloSessions(records => {
      if (disposed) return;
      syncSessions(records);
      $.status.textContent = active.size
        ? `Watching ${active.size} active Solo ${active.size === 1 ? 'session' : 'sessions'}.`
        : 'No active Solo sessions. Completed photo strips remain available for 24 hours.';
    }, error => {
      if (disposed) return;
      $.live.textContent = 'Offline';
      $.status.textContent = 'The live-session registry could not be reached. Check the Firebase setup and connection.';
      console.error('Could not subscribe to Solo live sessions.', error);
    }).then(unsubscribeFn => {
      if (disposed) unsubscribeFn();
      else unsubscribe = unsubscribeFn;
    }).catch(error => {
      if (disposed) return;
      $.live.textContent = 'Offline';
      $.status.textContent = error.message && error.message.includes('not configured')
        ? 'Live monitoring is not configured. Add the Firebase web-app settings to js/net/firebase-config.js.'
        : 'The Watch Page could not connect to Firebase. Check the service setup and connection.';
      console.error('Could not start the Watch Page session registry.', error);
    });

    disposeScene = () => {
      disposed = true;
      if (unsubscribe) unsubscribe();
      clearInterval(expirationTimer);
      active.forEach(item => item.stop());
      active.clear();
      completed.forEach(item => item.card.remove());
      completed.clear();
      document.removeEventListener('fullscreenchange', onFullscreenChange);
      document.removeEventListener('keydown', onKeydown);
    };
  },
  unmount() {
    if (disposeScene) {
      disposeScene();
      disposeScene = null;
    }
  },
};
