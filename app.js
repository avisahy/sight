const video = document.getElementById('video');
const overlay = document.getElementById('overlay');
const ctx = overlay.getContext('2d');
const ocrText = document.getElementById('ocrText');

let model;

// Load camera
async function initCamera() {
  const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
  video.srcObject = stream;
  return new Promise(resolve => {
    video.onloadedmetadata = () => {
      overlay.width = video.videoWidth;
      overlay.height = video.videoHeight;
      resolve();
    };
  });
}

// Load model
async function initModel() {
  model = await cocoSsd.load();
}

// Beep sound
function beep() {
  const ctx = new AudioContext();
  const osc = ctx.createOscillator();
  osc.type = 'sine';
  osc.frequency.value = 1000;
  osc.connect(ctx.destination);
  osc.start();
  setTimeout(() => osc.stop(), 100);
}

// Object detection loop
async function detectFrame() {
  const predictions = await model.detect(video);
  ctx.clearRect(0, 0, overlay.width, overlay.height);

  predictions.forEach(pred => {
    ctx.strokeStyle = '#00FF00';
    ctx.lineWidth = 2;
    ctx.strokeRect(...pred.bbox);
    ctx.fillStyle = '#00FF00';
    ctx.fillText(pred.class, pred.bbox[0], pred.bbox[1] > 10 ? pred.bbox[1] - 5 : 10);
  });

  // Always beep if any object detected
  if (predictions.length > 0) {
    beep();
  }

  requestAnimationFrame(detectFrame);
}

// OCR function
async function runOCRNow() {
  ocrText.textContent = 'Running OCR...';
  const canvas = document.createElement('canvas');
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  const cctx = canvas.getContext('2d');
  cctx.drawImage(video, 0, 0, canvas.width, canvas.height);

  const { data: { text } } = await Tesseract.recognize(canvas, 'eng');
  ocrText.textContent = text.trim() || 'No text found';
}

// Tap to trigger OCR
document.body.addEventListener('click', () => {
  runOCRNow();
});

// Init everything
(async () => {
  await initCamera();
  await initModel();
  detectFrame();
})();
