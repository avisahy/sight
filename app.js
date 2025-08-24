// Elements
const video = document.getElementById('video');
const overlay = document.getElementById('overlay');
const ctx = overlay.getContext('2d');
const startBtn = document.getElementById('startBtn');

let model;
let audioCtx;
let lastBeep = 0;
const BEEP_INTERVAL_MS = 600;

// iOS support
const AudioContextClass = window.AudioContext || window.webkitAudioContext;

// Resize canvas to match video
function resizeCanvasToVideo() {
  const rect = video.getBoundingClientRect();
  overlay.width = rect.width;
  overlay.height = rect.height;
  ctx.font = '16px system-ui, -apple-system, Segoe UI, Roboto, sans-serif';
  ctx.textBaseline = 'top';
}

// Camera
async function initCamera() {
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: { ideal: 'environment' } },
    audio: false
  });
  video.srcObject = stream;

  // Wait for video to have dimensions
  await new Promise(resolve => {
    if (video.readyState >= 2 && video.videoWidth > 0) return resolve();
    video.onloadedmetadata = () => resolve();
  });

  // Ensure playback started
  await video.play().catch(() => {});
  resizeCanvasToVideo();
  window.addEventListener('resize', resizeCanvasToVideo);
}

// Model
async function initModel() {
  model = await cocoSsd.load();
}

// Safe beep (unlocked after user tap)
function beep(freq = 1000, durationMs = 120, volume = 0.12) {
  if (!audioCtx) return;
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.type = 'sine';
  osc.frequency.value = freq;
  gain.gain.value = volume;
  osc.connect(gain);
  gain.connect(audioCtx.destination);

  // Quick envelope to avoid clicks
  const now = audioCtx.currentTime;
  gain.gain.setValueAtTime(0, now);
  gain.gain.linearRampToValueAtTime(volume, now + 0.01);
  gain.gain.linearRampToValueAtTime(0, now + durationMs / 1000);

  osc.start(now);
  osc.stop(now + durationMs / 1000);
}

// Detection loop
async function detectLoop() {
  try {
    const predictions = await model.detect(video);
    // Clear
    ctx.clearRect(0, 0, overlay.width, overlay.height);

    // Draw boxes and labels (helps confirm it’s working)
    predictions.forEach(p => {
      const [x, y, w, h] = p.bbox;
      // Scale bbox from video’s intrinsic size to canvas size
      const scaleX = overlay.width / video.videoWidth;
      const scaleY = overlay.height / video.videoHeight;
      const sx = x * scaleX, sy = y * scaleY, sw = w * scaleX, sh = h * scaleY;

      ctx.strokeStyle = '#00ff7f';
      ctx.lineWidth = 2;
      ctx.strokeRect(sx, sy, sw, sh);
      ctx.fillStyle = '#00ff7f';
      const label = `${p.class} ${(p.score * 100).toFixed(0)}%`;
      ctx.fillText(label, sx + 4, Math.max(2, sy - 18));
    });

    // Rate-limited beep if any object detected
    if (predictions.length > 0) {
      const now = performance.now();
      if (now - lastBeep > BEEP_INTERVAL_MS) {
        beep(920, 110, 0.10);
        lastBeep = now;
      }
    }
  } catch (e) {
    console.error('detectLoop error:', e);
  } finally {
    requestAnimationFrame(detectLoop);
  }
}

// Start handler (unlocks audio and starts everything)
startBtn.addEventListener('click', async () => {
  try {
    startBtn.disabled = true;
    startBtn.textContent = 'Starting...';

    audioCtx = new AudioContextClass();
    await audioCtx.resume();

    // Test beep to confirm audio unlocked
    beep(880, 100, 0.12);

    await initCamera();
    await initModel();

    startBtn.style.display = 'none';
    detectLoop();
  } catch (e) {
    console.error('Start failed:', e);
    startBtn.disabled = false;
    startBtn.textContent = 'Start camera (retry)';
  }
});
