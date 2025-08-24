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
  const rect = video.getBoundingClientRect();
  overlay.width = rect.width;
  overlay.height = rect.height;
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
    if (video.readyState >= 2 && video.videoWidth > 0) return resolve();
    video.onloadedmetadata = () => resolve();
  });
  await video.play().catch(() => {});
  resizeCanvasToVideo();
  window.addEventListener('resize', resizeCanvasToVideo);
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

async function detectLoop() {
  try {
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
        beep();
        lastBeep = now;
      }
    }
  } catch (e) {
    console.error('detectLoop error:', e);
  } finally {
    requestAnimationFrame(detectLoop);
  }
}

startBtn.addEventListener('click', async () => {
  try {
    audioCtx = new AudioContextClass();
    await audioCtx.resume();
    beep(880, 100, 0.12); // test beep

    startBtn.style.display = 'none';
    hud.style.display = 'flex';

    await initCamera();
    await initModel();
    detectLoop();
  } catch (e) {
    console.error('Start failed:', e);
    startBtn.disabled = false;
    startBtn.textContent = 'Start camera (retry)';
  }
});
