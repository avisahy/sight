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

let stream, track, imageCapture;
let torchOn = false;
let mode = 'object';
let model;
let detecting = false;
let lastText = '';

let voices = [];
const refreshVoices = () => { voices = window.speechSynthesis ? speechSynthesis.getVoices() : []; };
if ('speechSynthesis' in window) {
  refreshVoices();
  window.speechSynthesis.onvoiceschanged = refreshVoices;
}

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

function log(msg) { console.log(msg); logDiv.textContent = msg; }
function resizeCanvas() {
  const rect = video.getBoundingClientRect();
  overlay.width = video.videoWidth || rect.width;
  overlay.height = video.videoHeight || rect.height;
}

async function startCamera() {
  if (!navigator.mediaDevices?.getUserMedia) { log('Camera not supported.'); return; }
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
      audio: false
    });
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
      const cap = await track.getCapabilities?.();
      const hasTorch = cap && 'torch' in cap && cap.torch;
      torchBtn.disabled = !hasTorch;
    } catch { torchBtn.disabled = true; }

    if (mode === 'object' && !model) {
      log('Loading object model...');
      model = await cocoSsd.load({ base: 'lite_mobilenet_v2' });
      log('Model ready.');
      startDetectLoop();
    }
  } catch (e) { log('Camera error: ' + e.message); }
}

async function toggleTorch() {
  if (!track) return;
  try {
    torchOn = !torchOn;
    await track.applyConstraints({ advanced: [{ torch: torchOn }] });
    torchBtn.textContent = torchOn ? 'Torch On' : 'Toggle Torch';
  } catch (e) { log('Torch not supported: ' + e.message); }
}

function setMode(next) {
  mode = next;
  modeBtn.textContent = 'Mode: ' + (mode === 'object' ? 'Object' : 'Text');
  ctx.clearRect(0, 0, overlay.width, overlay.height);
  objectsDiv.textContent = '';
  if (mode === 'object') { if (model && stream) startDetectLoop(); }
}

function startDetectLoop() {
  if (detecting) return;
  detecting = true;
  const run = async () => {
    if (!model || video.readyState < 2 || mode !== 'object') { detecting = false; return; }
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
    const label = `${p.class} ${(p.score*100).toFixed(0)}%`;
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

function detectLangFromText(s) {
  return /[\u0590-\u05FF]/.test(s) ? 'he' : 'en';
}

function chooseVoice(lang) {
  const targets = lang === 'he' ? ['he-IL', 'he'] : ['en-US', 'en-GB', 'en'];
  const exact = voices.find(v => targets.includes(v.lang));
  if (exact) return exact;
  const pref = voices.find(v => targets.some(t => v.lang.startsWith(t)));
  return pref || voices[0];
}

function speak(text) {
  if (!('speechSynthesis' in window)) {
    log('Speech synthesis not supported.');
    return;
  }
  const sel = langSelect.value;
  const lang = sel === 'auto' ? detectLangFromText(text) : sel;
  const utter = new SpeechSynthesisUtterance(text);
  const v = chooseVoice(lang);
  if (v) {
    utter.voice = v;
    utter.lang = v.lang;
  } else {
    utter.lang = lang === 'he' ? 'he-IL' : 'en-US';
  }
  utter.rate = 1;
  utter.pitch = 1;
  speechSynthesis.cancel();
  speechSynthesis.speak(utter);
}

// Event listeners
startBtn.addEventListener('click', startCamera);
torchBtn.addEventListener('click', toggleTorch);
modeBtn.addEventListener('click', () => setMode(mode === 'object' ? 'text' : 'object'));
captureBtn.addEventListener('click', captureForOCR);
speakBtn.addEventListener('click', () => lastText && speak(lastText));

video.addEventListener('playing', async () => {
  if (mode === 'object' && !model) {
    model = await cocoSsd.load({ base: 'lite_mobilenet_v2' });
    startDetectLoop();
  }
});

// Optional: register service worker for PWA
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  });
}
