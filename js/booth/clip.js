// A short "live" clip: only the last second before each photo (plus the flash) is recorded,
// so four photos give a clip of about six to seven seconds.
export const clipSupported = () =>
  typeof MediaRecorder !== 'undefined' && typeof HTMLCanvasElement.prototype.captureStream === 'function';

function pickType() {
  const options = ['video/mp4;codecs=avc1.42E01E', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'];
  return options.find(t => MediaRecorder.isTypeSupported(t)) || '';
}

// Create a clip recorder that records a short clip from the given stream.
export function createClipRecorder(stream) {
  const type = pickType();
  const rec = new MediaRecorder(stream, type ? { mimeType: type, videoBitsPerSecond: 2500000 } : {});
  const chunks = [];
  rec.ondataavailable = e => { if (e.data && e.data.size) chunks.push(e.data); };
  const done = new Promise(resolve => {
    rec.onstop = () => {
      const mime = rec.mimeType || type || 'video/webm';
      resolve({ blob: new Blob(chunks, { type: mime }), ext: mime.includes('mp4') ? 'mp4' : 'webm' });
    };
  });
  rec.start();
  try { rec.pause(); } catch (e) { /* recording continues, the clip is just longer */ }
  return {
    resume() { try { if (rec.state === 'paused') rec.resume(); } catch (e) {} },
    pause() { try { if (rec.state === 'recording') rec.pause(); } catch (e) {} },
    stop() { if (rec.state !== 'inactive') rec.stop(); return done; },
  };
}
