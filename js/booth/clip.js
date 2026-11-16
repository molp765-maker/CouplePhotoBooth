export const clipSupported = () =>
  typeof MediaRecorder !== 'undefined' && typeof HTMLCanvasElement.prototype.captureStream === 'function';

function pickType() {
  const options = ['video/mp4;codecs=avc3.42E01E', 'video/mp4;codecs=avc1.42E01E', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'];
  return options.find(t => MediaRecorder.isTypeSupported(t)) || '';
}

// Recording starts immediately so the caller can capture the countdown before a photo.
export function createClipRecorder(stream) {
  const type = pickType();
  const rec = new MediaRecorder(stream, type ? { mimeType: type, videoBitsPerSecond: 2500000 } : {});
  const chunks = [];
  const done = new Promise((resolve, reject) => {
    rec.ondataavailable = e => { if (e.data && e.data.size) chunks.push(e.data); };
    rec.onerror = e => reject(e.error || new Error('Video recording failed.'));
    rec.onstop = () => {
      const mime = rec.mimeType || type || 'video/webm';
      resolve({ blob: new Blob(chunks, { type: mime }), ext: mime.includes('mp4') ? 'mp4' : 'webm' });
    };
  });
  done.catch(() => {});
  rec.start();
  return {
    stop() { if (rec.state !== 'inactive') rec.stop(); return done; },
  };
}
