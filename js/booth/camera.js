// Grab a frame from the camera and return it as a canvas.
// The canvas is mirrored like a real mirror.
export async function startCamera(video) {
  if (!navigator.mediaDevices?.getUserMedia) throw new Error('unsupported');
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } },
    audio: false,
  });
  video.srcObject = stream;
  await video.play();
  return stream;
}

export function stopCamera(stream) {
  if (stream) stream.getTracks().forEach(t => t.stop());
}

// One frame from the video, centre-cropped to w:h and mirrored like a real mirror.
export function grabFrame(video, w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const vw = video.videoWidth, vh = video.videoHeight, target = w / h;
  let sw = vw, sh = vw / target;
  if (sh > vh) { sh = vh; sw = vh * target; }
  const g = c.getContext('2d');
  g.translate(w, 0); g.scale(-1, 1);
  g.drawImage(video, (vw - sw) / 2, (vh - sh) / 2, sw, sh, 0, 0, w, h);
  return c;
}
