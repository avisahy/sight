const video = document.getElementById('video');
const overlay = document.getElementById('overlay');
const ctx = overlay.getContext('2d');
const ocrText = document.getElementById('ocrText');
const startBtn = document.getElementById('startBtn');

let model;
let audioCtx;

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
  if (!audioCtx) return; // Audio not unlocked yet
  const osc = audioCtx.createOscillator();
  const gainNode = audioCtx.createGain();
  osc.type = 'sine';
  osc.frequency.value = 1000;
  osc.connect(gainNode);
  gainNode.connect(audioCtx.destination);
  gainNode.gain.value = 0.1;
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

  if (predictions.length > 0) {
    beep();
  }

  requestAnimationFrame(detectFrame);
}

// OCR function
async function runOCRNow() {
  console.log("OCR started");
  ocrText.textContent = 'Running OCR...';
  const canvas = document.createElement('canvas');
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  const cctx = canvas.getContext('2d');
  cctx.drawImage(video, 0, 0, canvas.width, canvas.height);

  const { data: { text } } = await Tesseract.recognize(canvas, 'eng');
  console.log("OCR result:", text);
  ocrText.textContent = text.trim() || 'No text found';
}

// Tap to trigger OCR
document.body.addEventListener('click', () => {
  runOCRNow();
});

// Start button to unlock audio + start detection
startBtn.addEventListener('click', async () => {
  audioCtx = new AudioContext(); // Unlock audio
  startBtn.style.display = 'none';
  await initCamera();
  await initModel();
  detectFrame();
});
