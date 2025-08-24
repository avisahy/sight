// ====== Element references ======
const video = document.getElementById('video');
const overlay = document.getElementById('overlay');
const ctx = overlay.getContext('2d');
const startBtn = document.getElementById('startBtn');
const torchBtn = document.getElementById('torchBtn');
const modeBtn = document.getElementById('modeBtn');
const captureBtn = document.getElementById('captureBtn');
const speakBtn = document.getElementById('speakBtn');
const langSelect = document.getElementById('langSelect');
const objectsDiv = document.getElementById('objects');
const ocrTextDiv = document.getElementById('ocrText');
const logDiv = document.getElementById('log');

// ====== State ======
let stream, track, imageCapture;
let torchOn = false;
let mode = 'object';
let model;
let detecting = false;
let lastText = '';

// ====== Speech voices ======
let voices = [];
const refreshVoices = () => { voices = window.speechSynthesis ? speechSynthesis.getVoices() : []; };
if ('speechSynthesis' in window) {
  refreshVoices();
  window.speechSynthesis.onvoiceschanged = refreshVoices;
}

// ====== OCR worker ======
const worker = Tesseract.createWorker({ logger: m => {} });
let workerReady = false;
(async () => {
  try {
    await worker.load();
    await worker.loadLanguage('eng+heb');
    await worker.initialize('eng+heb');
    workerReady = true;
  } catch (e) { log('Tesseract init failed: ' + e.message); }
})();

// ====== Helpers ======
function log(msg) { console.log(msg); logDiv.textContent = msg; }
function resizeCanvas() {
  const rect = video.getBoundingClientRect();
  overlay.width = video.videoWidth || rect.width;
  overlay.height = video.videoHeight || rect.height;
}

// ====== Permission check ======
async function checkCameraPermission() {
  if (location.protocol !== 'https:' && location.hostname !== 'localhost') {
    log('⚠️ Camera access requires HTTPS on mobile. Please use https://');
    return;
  }
  if (navigator.permissions && navigator.permissions.query) {
    try {
      const status = await navigator.permissions.query({ name: 'camera' });
      if (status.state === 'granted') log('✅ Camera permission is already granted.');
      else if (status.state === 'prompt') log('ℹ️ Camera permission will be requested when you start the camera.');
      else if (status.state === 'denied') log('🚫 Camera permission is blocked. Enable it in your browser/device settings.');
    } catch { log('Permissions API not supported. Try starting the camera to see if it works.'); }
  } else {
    log('Permissions API not supported. Try starting the camera to see if it works.');
  }
}

// ====== Start camera ======
async function startCamera() {
  if (location.protocol !== 'https:' && location.hostname !== 'localhost') {
    log('⚠️ Camera access requires HTTPS on mobile. Please use https://');
    return;
  }
  if (navigator.permissions && navigator.permissions.query) {
    try {
      const status = await navigator.permissions.query({ name: 'camera' });
      if (status.state === 'denied') {
        log('🚫 Camera permission is blocked. Enable it in your browser/device settings.');
        return;
      }
    } catch {}
  }
  if (stream) { stream.getTracks().forEach(t => t.stop()); stream = null; }

  const tryConstraints = async (constraints) => {
    try { return await navigator.mediaDevices.getUserMedia(constraints); }
    catch (err) { console.warn('getUserMedia failed for', constraints, err); return null; }
  };

  const constraintsRear = { video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false };
  const constraintsFront = { video: { facingMode: { ideal: 'user' }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false };

  log('📷 Requesting camera…');
  let s = await tryConstraints(constraintsRear);
  if (!s) { log('Rear camera not available, trying front camera…'); s = await tryConstraints(constraintsFront); }
  if (!s) { log('❌ Unable to access any camera. Check permissions in browser settings.'); return; }

  stream = s;
  video.srcObject = stream;
  await video.play();
  resizeCanvas();
  window.addEventListener('resize', resizeCanvas);

  track = stream.getVideoTracks()[0];
  captureBtn.disabled = false;
  speakBtn.disabled = false;
  startBtn.textContent = 'Camera On';
  startBtn.disabled = true;

  try {
    imageCapture = new ImageCapture(track);
    const cap = track.getCapabilities?.();
    const hasTorch = cap && 'torch' in cap && cap.torch;
    torchBtn.disabled = !hasTorch;
  } catch {
    torchBtn.disabled = true;
  }

  if (mode === 'object' && !model) {
    log('Loading object model…');
    model = await cocoSsd.load({ base: 'lite_mobilenet_v2' });
    log('Model ready.');
    startDetectLoop();
  }
}

// ====== Mode switching ======
function setMode(next) {
  mode = next;
  modeBtn.textContent = 'Mode: ' + (mode === 'object' ? 'Object' : 'Text');
  ctx.clearRect(0, 0, overlay.width, overlay.height);
  objectsDiv.textContent = '';
  if (mode === 'object') {
    if (model && stream) startDetectLoop();
  }
}

// ====== Object detection loop ======
function startDetectLoop() {
  if (detecting) return;
  detecting = true;
  const run = async () => {
    if (!model || video.readyState < 2 || mode !== 'object') {
      detecting = false;
      return;
    }
    setTimeout(async () => {
      try {
        const preds = await model.detect(video);
        drawDetections(preds);
        listObjects(preds);
      } catch {}
      requestAnimationFrame(run);
    }, 200);
  };
  requestAnimationFrame(run);
}

function drawDetections(preds) {
  resizeCanvas();
  ctx.clearRect(0, 0, overlay.width, overlay.height);
  ctx.lineWidth = 3;
  preds.forEach(p => {
    const [x, y, w, h] = p.bbox;
    ctx.strokeStyle = 'rgba(0, 200, 255, 0.9)';
    ctx.strokeRect(x, y, w, h);
    ctx.fillStyle = 'rgba(0, 200, 255, 0.9)';
    ctx.font = '16px system-ui';
    const label = `${p.class} ${(p.score * 100).toFixed(0)}%`;
    const textW = ctx.measureText(label).width + 8;
    ctx.fillRect(x, y - 20, textW, 20);
    ctx.fillStyle = '#000';
    ctx.fillText(label, x + 4, y - 6);
  });
}

function listObjects(preds) {
  const out = preds
    .filter(p => p.score > 0.5)
    .map(p => `• ${p.class} (${(p.score * 100).toFixed(0)}%)`)
    .join('\n');
  objectsDiv.textContent = out || '(none)';
}

// ====== OCR capture ======
async function captureForOCR() {
  if (!workerReady) {
    log('OCR engine loading—try again in a moment.');
    return;
  }
  if (!video.videoWidth) {
    log('Camera not ready.');
    return;
  }
  const c = document.createElement('canvas');
  const maxW = 1280;
  const scale = Math.min(1, maxW / video.videoWidth);
  c.width = Math.floor(video.videoWidth * scale);
  c.height = Math.floor(video.videoHeight * scale);
  const cctx = c.getContext('2d');
  cctx.drawImage(video, 0, 0, c.width, c.height);

  log('Recognizing text...');
  try {
    const { data } = await worker.recognize(c);
    const text = (data.text || '').trim();
    lastText = text;
    ocrTextDiv.textContent = text || '(no text found)';
    log('OCR complete.');
    if (text) speak(text);
  } catch (e) {
    log('OCR error: ' + e.message);
  }
}

// ====== Speech synthesis ======
function detectLangFromText(s) {
  return /[\u0590-\u05FF]/.test(s) ? 'he' : 'en';
}

function chooseVoice(lang) {
  const targets = lang === 'he' ? ['he-IL', 'he'] : ['en-US', 'en-GB', 'en'];
  const exact = voices.find(v => targets.includes(v.lang));
  if (exact) return exact;
  const pref = voices.find(v => targets.some(t => v.lang.startsWith(t)));
