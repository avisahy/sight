const video = document.getElementById('video');
const overlay = document.getElementById('overlay');
const ctx = overlay.getContext('2d');
const startBtn = document.getElementById('startBtn');
const hud = document.getElementById('hud');
const beepFlash = document.getElementById('beepFlash');

let model;
let audioCtx;
let lastBeep = 0;
const BEEP_INTERVAL_MS = 600;
const AudioContextClass = window.AudioContext || window.webkitAudioContext;

function resizeCanvasToVideo() {
  overlay.width = video.videoWidth;
  overlay.height = video.videoHeight;
  ctx.font = '16px system-ui, sans-serif';
  ctx.textBaseline = 'top';
}

async function initCamera() {
  console.log("Requesting camera...");
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: { ideal: 'environment' } },
    audio: false
  });
  console.log("Camera stream received");
  video.srcObject = stream;
  await new Promise(resolve => {
    video.onloadedmetadata = () => {
      console.log("Video metadata loaded");
      resolve();
    };
  });
  await video.play();
  console.log("Video playing");
  resizeCanvasToVideo();
}

async function initModel() {
  console.log("Loading model...");
  model = await cocoSsd.load();
  console.log("Model loaded");
}

function beep() {
  if (!audioCtx) return;
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.type = 'sine';
  osc.frequency.value = 1000;
  gain.gain.value = 0.12;
  osc.connect(gain);
  gain.connect(audioCtx.destination);
  const now = audioCtx.currentTime;
  gain.gain.setValueAtTime(0, now);
  gain.gain.linearRampToValueAtTime(0.12, now + 0.01);
  gain.gain.linearRampToValueAtTime(0, now + 0.12);
  osc.start(now);
  osc.stop(now + 0.12);
  beepFlash.classList.add('active');
  setTimeout(() => beepFlash.classList.remove('active'), 150);
}

async function detectLoop() {
  const predictions = await model.detect(video);
  ctx.clearRect(0, 0, overlay.width, overlay.height);
  predictions.forEach(p => {
    const [x, y, w, h] = p.bbox;
    ctx.strokeStyle = '#00ff7f';
    ctx.lineWidth = 2;
    ctx.strokeRect(x, y, w, h);
    ctx.fillStyle = '#00ff7f';
    ctx.fillText(`${p.class} ${(p.score * 100).toFixed(0)}%`, x + 4, y - 4);
  });
  if (predictions.length > 0) {
    const now = performance.now();
    if (now - lastBeep > BEEP_INTERVAL_MS) {
      beep();
      lastBeep = now;
    }
  }
  requestAnimationFrame(detectLoop);
}

startBtn.addEventListener('click', async () => {
  try {
    console.log("Start button clicked");
    audioCtx = new AudioContextClass();
    await audioCtx.resume();
    beep();
    startBtn.style.display = 'none';
    hud.style.display = 'flex';
    await initCamera();
    await initModel();
    detectLoop();
  } catch (err) {
    console.error("Error starting app:", err);
  }
});
