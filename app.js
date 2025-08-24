// ==== Object Detection + OCR + Speech ====

// Load models
const video = document.getElementById('video');
const overlay = document.getElementById('overlay');
const ctx = overlay.getContext('2d');

let model;
let gain, osc;
let ocrWorker;

// Start camera
async function initCamera() {
  const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
  video.srcObject = stream;
  await video.play();
  overlay.width = video.videoWidth;
  overlay.height = video.videoHeight;
}

// Init beep sound
function initBeep() {
  const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  osc = audioCtx.createOscillator();
  gain = audioCtx.createGain();
  osc.type = 'sine';
  osc.frequency.value = 440;
  gain.gain.value = 0;
  osc.connect(gain).connect(audioCtx.destination);
  osc.start();
}

// Update beep volume only for relevant objects
function updateBeepVolume(detections) {
  let maxFrac = 0;
  const frameArea = overlay.width * overlay.height;
  for (const d of detections) {
    if (['car', 'bus', 'traffic light'].includes(d.class)) {
      const [x, y, w, h] = d.bbox;
      const frac = (w * h) / frameArea;
      if (frac > maxFrac) maxFrac = frac;
    }
  }
  gain.gain.value = maxFrac === 0 ? 0 : Math.min(maxFrac * 2, 1);
}

// Draw boxes
function drawDetections(detections) {
  ctx.clearRect(0, 0, overlay.width, overlay.height);
  ctx.strokeStyle = 'lime';
  ctx.lineWidth = 2;
  ctx.font = '16px sans-serif';
  ctx.fillStyle = 'lime';
  detections.forEach(d => {
    const [x, y, w, h] = d.bbox;
    ctx.strokeRect(x, y, w, h);
    ctx.fillText(d.class, x, y > 10 ? y - 5 : 10);
  });
}

// OCR throttled
let lastOCR = 0;
async function doOCRThrottled() {
  const now = Date.now();
  if (now - lastOCR < 2000) return; // every 2s
  lastOCR = now;

  const tempCanvas = document.createElement('canvas');
  tempCanvas.width = 320;
  tempCanvas.height = 240;
  const tctx = tempCanvas.getContext('2d');
  tctx.drawImage(video, 0, 0, 320, 240);

  const { data: { text } } = await ocrWorker.recognize(tempCanvas);
  if (text.trim()) {
    const utterance = new SpeechSynthesisUtterance(text);
    speechSynthesis.speak(utterance);
  }
}

// Main loop
async function detectFrame() {
  const predictions = await model.detect(video);
  drawDetections(predictions);
  updateBeepVolume(predictions);
  doOCRThrottled();
  requestAnimationFrame(detectFrame);
}

// Init everything
async function init() {
  await initCamera();
  initBeep();
  model = await cocoSsd.load();
  ocrWorker = Tesseract.createWorker();
  await ocrWorker.load();
  await ocrWorker.loadLanguage('eng');
  await ocrWorker.initialize('eng');
  detectFrame();
}

init();
