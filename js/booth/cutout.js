// Cuts a person out of a video (MediaPipe selfie segmentation) and puts them on a background.
const VISION = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14';
const MODEL = 'https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/latest/selfie_segmenter.tflite';
export const OW = 432, OH = 648;   // size of each person's half of the stage (2:3)

let visionPromise = null;
function loadVision() {
  if (!visionPromise) {
    visionPromise = (async () => {
      const m = await import(`${VISION}/vision_bundle.mjs`);
      const fileset = await m.FilesetResolver.forVisionTasks(`${VISION}/wasm`);
      return { m, fileset };
    })().catch(e => { visionPromise = null; throw e; });
  }
  return visionPromise;
}

export async function createSegmenter() {
  const { m, fileset } = await loadVision();
  return m.ImageSegmenter.createFromOptions(fileset, {
    baseOptions: { modelAssetPath: MODEL, delegate: 'CPU' },
    runningMode: 'VIDEO',
    outputCategoryMask: false,
    outputConfidenceMasks: true,
  });
}

const make = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };

export class HalfRenderer {
  constructor(video, canvas, side, ow = OW, oh = OH) {
    this.ow = ow; this.oh = oh;
    this.video = video; this.out = canvas; this.side = side;   // side: 'left' | 'right' half of the background
    canvas.width = this.ow; canvas.height = this.oh;
    this.person = make(this.ow, this.oh);
    this.maskCanvas = make(1, 1); this.maskImg = null;
    this.segmenter = null;
    this.flip = false; this.locked = false; this.cal = [];   // guards against an inverted mask
  }

  // Works out whether the mask marks the person (middle of frame) or the background (sides).
  calibrate(arr, w, h) {
    if (this.locked) return;
    let c = 0, cn = 0, e = 0, en = 0;
    for (let y = 0; y < h; y += 8) for (let x = 0; x < w; x += 8) {
      const v = arr[y * w + x];
      if (x > w * .35 && x < w * .65 && y > h * .3 && y < h * .7) { c += v; cn++; }
      else if (x < w * .15 || x > w * .85) { e += v; en++; }
    }
    if (cn && en) this.cal.push(c / cn - e / en);
    if (this.cal.length >= 20) {
      this.flip = this.cal.reduce((a, b) => a + b, 0) / this.cal.length < -0.2;
      this.locked = true;
    }
  }

  // Draws one frame. bg is a wide background canvas, or null to keep the real background.
  render(bg, now) {
    const v = this.video;
    if (!v.videoWidth) return;
    const target = this.ow / this.oh;
    let sw = v.videoWidth, sh = sw / target;
    if (sh > v.videoHeight) { sh = v.videoHeight; sw = sh * target; }
    const sx = (v.videoWidth - sw) / 2, sy = (v.videoHeight - sh) / 2;
    const g = this.out.getContext('2d');

    if (!bg || !this.segmenter) {
      g.save(); g.translate(this.ow, 0); g.scale(-1, 1);
      g.drawImage(v, sx, sy, sw, sh, 0, 0, this.ow, this.oh);
      g.restore();
      return;
    }

    const res = this.segmenter.segmentForVideo(v, now);
    const masks = res.confidenceMasks;
    const mask = masks[masks.length - 1];
    const arr = mask.getAsFloat32Array(), mw = mask.width, mh = mask.height;
    this.calibrate(arr, mw, mh);

    const step = Math.max(1, Math.floor(mw / 360));
    const tw = Math.floor(mw / step), th = Math.floor(mh / step);
    if (this.maskCanvas.width !== tw || this.maskCanvas.height !== th) {
      this.maskCanvas.width = tw; this.maskCanvas.height = th;
      this.maskImg = this.maskCanvas.getContext('2d').createImageData(tw, th);
      this.maskImg.data.fill(255);
    }
    const d = this.maskImg.data;
    for (let y = 0; y < th; y++) for (let x = 0; x < tw; x++) {
      let p = arr[y * step * mw + x * step];
      if (this.flip) p = 1 - p;
      d[(y * tw + x) * 4 + 3] = Math.min(1, Math.max(0, (p - 0.35) * 3.3)) * 255;
    }
    this.maskCanvas.getContext('2d').putImageData(this.maskImg, 0, 0);
    if (res.close) res.close();

    const p = this.person.getContext('2d');
    p.clearRect(0, 0, this.ow, this.oh);
    p.save();
    p.translate(this.ow, 0); p.scale(-1, 1);
    p.drawImage(v, sx, sy, sw, sh, 0, 0, this.ow, this.oh);
    p.globalCompositeOperation = 'destination-in';
    p.drawImage(this.maskCanvas, sx * tw / v.videoWidth, sy * th / v.videoHeight, sw * tw / v.videoWidth, sh * th / v.videoHeight, 0, 0, this.ow, this.oh);
    p.restore();

    const full = this.side === 'full';
    g.drawImage(bg, this.side === 'right' ? bg.width / 2 : 0, 0, full ? bg.width : bg.width / 2, bg.height, 0, 0, this.ow, this.oh);
    g.drawImage(this.person, 0, 0);
  }

  close() { if (this.segmenter) { this.segmenter.close(); this.segmenter = null; } }
}
