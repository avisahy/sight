const video = document.getElementById('video');
const overlay = document.getElementById('overlay');
const ctx = overlay.getContext('2d');
const startBtn = document.getElementById('startBtn');
const stopBtn = document.getElementById('stopBtn');
const ocrBtn = document.getElementById('ocrBtn');
const hud = document.getElementById('hud');
const beepFlash = document.getElementById('beepFlash');

let model;
let audioCtx;
let lastBeep = 0;
const BEEP_INTERVAL_MS = 600;
let running = false;

const AudioContextClass = window.AudioContext || window.webkitAudioContext;

function resizeCanvasToVideo() {
  overlay.width = video.videoWidth;
  overlay.height = video.videoHeight;
  ctx.font = '16px system-ui, sans-serif';
  ctx.textBaseline = 'top';
}

async function initCamera() {
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: { ideal: 'environment' } },
    audio: false
  });
  video.srcObject = stream;
  await new Promise(resolve => {
    video.onloadedmetadata = () => resolve();
  });
  await video.play();
  resizeCanvasToVideo();
}

async function initModel() {
  model = await cocoSsd.load();
}

function beep(freq = 1000, durationMs = 120, volume = 0.12) {
  if (!audioCtx) return;
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.type = 'sine';
  osc.frequency.value = freq;
  gain.gain.value = volume;
  osc.connect(gain);
  gain.connect(audioCtx.destination);

  const now = audioCtx.currentTime;
  gain.gain.setValueAtTime(0, now);
  gain.gain.linearRampToValueAtTime(volume, now + 0.01);
  gain.gain.linearRampToValueAtTime(0, now + durationMs / 1000);

  osc.start(now);
  osc.stop(now + durationMs / 1000);

  beepFlash.classList.add('active');
  setTimeout(() => beepFlash.classList.remove('active'), 150);
}

function estimateVolumeFromDistance(predictions) {
  if (predictions.length === 0) return 0;
  let maxArea = 0;
  predictions.forEach(p => {
    const area = p.bbox[2] * p.bbox[3];
    if (area > maxArea) maxArea = area;
  });
  const maxPossibleArea = video.videoWidth * video.videoHeight;
  let ratio = maxArea / maxPossibleArea;
  ratio = Math.min(Math.max(ratio, 0.05), 1.0);
  return 0.05 + (0.25 * ratio);
}

async function detectLoop() {
  if (!running) return;

  const predictions = await model.detect(video);
  ctx.clearRect(0, 0, overlay.width, overlay.height);

  predictions.forEach(p => {
    const [x, y, w, h] = p.bbox;
    const scaleX = overlay.width / video.videoWidth;
    const scaleY = overlay.height / video.videoHeight;
    const sx = x * scaleX, sy = y * scaleY, sw = w * scaleX, sh = h * scaleY;

    ctx.strokeStyle = '#00ff7f';
    ctx.lineWidth = 2;
    ctx.shadowColor = '#00ff7f';
    ctx.shadowBlur = 4;
    ctx.beginPath();
    ctx.roundRect(sx, sy, sw, sh, 6);
    ctx.stroke();
    ctx.shadowBlur = 0;

    ctx.fillStyle = '#00ff7f';
    ctx.fillText(`${p.class} ${(p.score * 100).toFixed(0)}%`, sx + 4, Math.max(2, sy - 18));
  });

  if (predictions.length > 0) {
    const now = performance.now();
    if (now - lastBeep > BEEP_INTERVAL_MS) {
      const volume = estimateVolumeFromDistance(predictions);
      beep(1000, 120, volume);
      lastBeep = now;
    }
  }

  requestAnimationFrame(detectLoop);
}

function stopDetection() {
  running = false;
  hud.style.display = 'none';
  stopBtn.style.display = 'none';
  ocrBtn.style.display = 'none';
  startBtn.style.display = 'block';
  startBtn.textContent = 'Start camera';
  if (video.srcObject) {
    video.srcObject.getTracks().forEach(track => track.stop());
    video.srcObject = null;
  }
  ctx.clearRect(0, 0, overlay.width, overlay.height);
  console.log("Detection stopped");
}

async function runOCR() {
  console.log("Running OCR...");
  const tempCanvas = document.createElement('canvas');
  tempCanvas.width = video.videoWidth;
  tempCanvas.height = video.videoHeight;
  const tctx = tempCanvas.getContext('2d');
  tctx.drawImage(video, 0, 0, tempCanvas.width, tempCanvas.height);

  const { data: { text } } = await Tesseract.recognize(tempCanvas, 'eng+heb');
  const cleanText = text.trim();
  console.log("OCR result
