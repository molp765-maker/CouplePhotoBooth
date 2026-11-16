import { firebaseAppCheckSiteKey, firebaseConfig } from './firebase-config.js';

const FIREBASE_VERSION = '11.10.0';
const RETENTION_MS = 24 * 60 * 60 * 1000;
const HEARTBEAT_MS = 15 * 1000;
let servicesPromise = null;

function isConfigured() {
  return ['apiKey', 'authDomain', 'databaseURL', 'projectId', 'storageBucket', 'appId']
    .every(key => typeof firebaseConfig[key] === 'string' && firebaseConfig[key].trim());
}

function sdkUrl(name) {
  return `https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}/firebase-${name}.js`;
}

async function getServices() {
  if (!isConfigured()) throw new Error('Firebase is not configured. Fill in js/net/firebase-config.js.');
  if (!servicesPromise) {
    servicesPromise = (async () => {
      const [appSdk, authSdk, databaseSdk, storageSdk] = await Promise.all([
        import(sdkUrl('app')),
        import(sdkUrl('auth')),
        import(sdkUrl('database')),
        import(sdkUrl('storage')),
      ]);
      const appName = 'photobooth-live-monitor';
      const app = appSdk.getApps().find(existing => existing.name === appName)
        || appSdk.initializeApp(firebaseConfig, appName);

      if (firebaseAppCheckSiteKey) {
        const appCheckSdk = await import(sdkUrl('app-check'));
        appCheckSdk.initializeAppCheck(app, {
          provider: new appCheckSdk.ReCaptchaV3Provider(firebaseAppCheckSiteKey),
          isTokenAutoRefreshEnabled: true,
        });
      }

      const auth = authSdk.getAuth(app);
      const restoredUser = await new Promise(resolve => {
        let unsubscribe = () => {};
        unsubscribe = authSdk.onAuthStateChanged(auth, user => {
          unsubscribe();
          resolve(user);
        });
      });
      if (!restoredUser) await authSdk.signInAnonymously(auth);
      return {
        auth,
        database: databaseSdk.getDatabase(app),
        databaseSdk,
        storage: storageSdk.getStorage(app),
        storageSdk,
      };
    })().catch(error => {
      servicesPromise = null;
      throw error;
    });
  }
  return servicesPromise;
}

function newSessionId() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
}

function dataUrlToBlob(dataUrl) {
  const [header, encoded] = dataUrl.split(',');
  if (!header || !encoded) throw new Error('Invalid image data.');
  const match = header.match(/^data:(.*?);base64$/);
  if (!match) throw new Error('Unsupported image data format.');
  const bytes = atob(encoded);
  const data = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) data[i] = bytes.charCodeAt(i);
  return new Blob([data], { type: match[1] });
}

async function uploadImage(services, path, dataUrl, ownerUid) {
  const blob = dataUrlToBlob(dataUrl);
  const fileRef = services.storageSdk.ref(services.storage, path);
  await services.storageSdk.uploadBytes(fileRef, blob, {
    contentType: blob.type,
    customMetadata: { ownerUid },
  });
  return path;
}

export async function createSoloLiveSession() {
  const services = await getServices();
  const { databaseSdk, database, storageSdk, auth } = services;
  const sessionId = newSessionId();
  const sessionRef = databaseSdk.ref(database, `sessions/${sessionId}`);
  const disconnect = databaseSdk.onDisconnect(sessionRef);
  const ownerUid = auth.currentUser.uid;
  const serverTimestamp = databaseSdk.serverTimestamp;
  const update = databaseSdk.update;
  let closed = false;
  let finished = false;
  let finishPromise = null;
  const pendingWrites = new Set();
  await databaseSdk.set(sessionRef, {
    sessionId,
    peerCode: sessionId,
    ownerUid,
    state: 'entering',
    createdAt: serverTimestamp(),
    lastSeenAt: serverTimestamp(),
    expiresAt: Date.now() + RETENTION_MS,
    photos: {},
    stripPath: null,
  });
  try {
    await disconnect.update({
      state: 'completed',
      completedAt: serverTimestamp(),
      lastSeenAt: serverTimestamp(),
    });
  } catch (error) {
    await databaseSdk.remove(sessionRef).catch(cleanupError => {
      console.error('Could not remove the incomplete Solo session record.', cleanupError);
    });
    throw error;
  }
  const heartbeat = setInterval(() => {
    if (closed || finished) return;
    update(sessionRef, {
      lastSeenAt: serverTimestamp(),
      expiresAt: Date.now() + RETENTION_MS,
    }).catch(error => console.error('Could not refresh the Solo session presence.', error));
  }, HEARTBEAT_MS);

  async function finish(stripDataUrl) {
    if (finishPromise) return finishPromise;
    finished = true;
    clearInterval(heartbeat);
    finishPromise = (async () => {
      let stripPath = null;
      let uploadError = null;
      const photoWrites = await Promise.allSettled([...pendingWrites]);
      const failedPhotoWrite = photoWrites.find(result => result.status === 'rejected');
      if (failedPhotoWrite) uploadError = failedPhotoWrite.reason;
      if (stripDataUrl) {
        stripPath = `sessions/${sessionId}/strip.png`;
        try {
          await uploadImage(services, stripPath, stripDataUrl, ownerUid);
        } catch (error) {
          if (!uploadError) uploadError = error;
          console.error('Could not save the completed Solo photo strip.', error);
          stripPath = null;
        }
      }
      await update(sessionRef, {
        state: 'completed',
        completedAt: serverTimestamp(),
        lastSeenAt: serverTimestamp(),
        expiresAt: Date.now() + RETENTION_MS,
        stripPath,
      });
      await disconnect.cancel();
      if (uploadError) throw uploadError;
    })();
    return finishPromise;
  }

  return {
    sessionId,
    async activate() {
      if (closed || finished) return;
      await update(sessionRef, {
        state: 'active',
        lastSeenAt: serverTimestamp(),
        expiresAt: Date.now() + RETENTION_MS,
      });
    },
    async resetPhotos() {
      if (closed || finished) return;
      await Promise.allSettled([...pendingWrites]);
      await update(sessionRef, { photos: null, stripPath: null });
    },
    async publishPhoto(index, dataUrl) {
      if (closed || finished) return;
      const path = `sessions/${sessionId}/photos/${index}.jpg`;
      const operation = (async () => {
        await uploadImage(services, path, dataUrl, ownerUid);
        await update(sessionRef, {
          [`photos/${index}`]: path,
          lastSeenAt: serverTimestamp(),
          expiresAt: Date.now() + RETENTION_MS,
        });
      })();
      pendingWrites.add(operation);
      operation.then(() => pendingWrites.delete(operation), () => pendingWrites.delete(operation));
      await operation;
    },
    finish,
    close() {
      if (closed) return;
      closed = true;
      clearInterval(heartbeat);
      if (!finished) {
        finish(null).catch(error => console.error('Could not complete the Solo session.', error));
      }
    },
  };
}

export async function subscribeSoloSessions(onChange, onError) {
  const { database, databaseSdk } = await getServices();
  const sessionsRef = databaseSdk.ref(database, 'sessions');
  const listener = snapshot => {
    const records = snapshot.val() || {};
    onChange(Object.entries(records).map(([id, record]) => ({ ...record, sessionId: id })));
  };
  const unsubscribe = databaseSdk.onValue(sessionsRef, listener, onError);
  return () => unsubscribe();
}

export async function getStoredImageUrl(path) {
  if (!path) return null;
  const { storage, storageSdk } = await getServices();
  return storageSdk.getDownloadURL(storageSdk.ref(storage, path));
}

export const LIVE_SESSION_RETENTION_MS = RETENTION_MS;
