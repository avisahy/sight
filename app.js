/* Smart Scanner: objects (bus/car/traffic light + color), OCR (English/Hebrew),
   continuous proximity beep, and speech output.
*/

(() => {
  // DOM elements
  const video = document.getElementById('video');
  const overlay = document.getElementById('overlay');
  const octx = overlay.getContext('2d');
  const startBtn = document.getElementById('startBtn');
  const stopBtn = document.getElementById('stopBtn');
  const camStatus = document.getElementById('camStatus');
  const mlStatus = document.getElementById('mlStatus');
  const ocrStatus = document.getElementById('ocrStatus');
  const spokenStatus = document.getElementById('spokenStatus');

  // State
  let stream = null;
  let running = false;
  let model = null;
  let ocrWorker = null;
  let rafId = null;
  let lastDetections = [];
  let lastOCRTime = 0;
  let speechCooldown = new Map(); // label -> last time spoken
  const SPEAK_COOLDOWN_MS = 3000;
  const OCR_INTERVAL_MS = 1800;
  const DETECT_INTERVAL_MS = 90; // ~11 FPS cap

  // Offscreen processing canvas
  const proc = document.createElement('canvas');
  const pctx = proc.getContext('2d', { willReadFrequently: true });

  // Audio: continuous beep with variable gain
  let audioCtx = null;
  let osc = null;
  let gain = null;

  // Util: timestamp in ms
  const now = () => performance.now();

  function setStatus(el, text, ok = false, warn = false) {
    el.textContent = text;
    el.style.color = ok ? 'var(--ok)' : warn ? 'var(--warn)' : 'var(--muted)';
  }

  async function loadModelsOnce() {
    if (!model) {
      setStatus(mlStatus, 'Loading object model...');
      model = await cocoSsd.load({ base: 'lite_mobilenet_v2' });
      setStatus(mlStatus, 'Object model ready', true);
    }
    if (!ocrWorker) {
      setStatus(ocrStatus, 'Loading OCR (eng+heb)...');
      ocrWorker = Tesseract.createWorker({
        logger: m => console.log('[OCR]', m),
      });
      await ocrWorker.load();
      await ocrWorker.loadLanguage('eng+heb');
      await ocrWorker.initialize('eng+heb');
      // Speed: only detect words (not layout)
      await ocrWorker.setParameters({
        tessedit_pageseg_mode: Tesseract.PSM.SINGLE_BLOCK,
      });
      setStatus(ocrStatus, 'OCR ready', true);
    }
  }

  function setupAudio() {
    if (audioCtx) return;
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    osc = audioCtx.createOscillator();
    gain = audioCtx.createGain();
    osc.type = 'sine';
    osc.frequency.value = 880; // pleasant attention tone
    gain.gain.value = 0.0001; // effectively silent until scanning
    osc.connect(gain).connect(audioCtx.destination);
    osc.start();
  }

  async function startCamera() {
    camStatus.textContent = 'Requesting...';
    const constraints = {
      audio: false,
      video: {
        facingMode: { ideal: 'environment' },
        width: { ideal: 1280 },
        height: { ideal: 720 }
      }
    };
    stream = await navigator.mediaDevices.getUserMedia(constraints);
    video.srcObject = stream;
    await video.play();
    // Sync canvases
    overlay.width = video.videoWidth || overlay.clientWidth;
    overlay.height = video.videoHeight || overlay.clientHeight;
    proc.width = overlay.width;
    proc.height = overlay.height;
    setStatus(camStatus, 'Camera ready', true);
  }

  function stopCamera() {
    if (stream) {
      stream.getTracks().forEach(t => t.stop());
      stream = null;
    }
    video.pause();
    video.srcObject = null;
    setStatus(camStatus, 'Stopped', false);
  }

  function clearOverlay() {
    octx.clearRect(0, 0, overlay.width, overlay.height);
  }

  function drawBox(x, y, w, h, label, cls = '') {
    // Box
    octx.save();
    let color = 'rgba(76,194,255,0.9)';
    if (cls === 'car') color = 'rgba(255,214,102,0.95)';
    if (cls === 'bus') color = 'rgba(255,114,114,0.95)';
    if (cls === 'traffic') color = 'rgba(140,130,255,0.95)';
    octx.strokeStyle = color;
    octx.lineWidth = 3;
    octx.beginPath();
    octx.roundRect(x, y, w, h, 10);
    octx.stroke();

    // Label background
    const padX = 6, padY = 3;
    octx.font = '600 14px system-ui, -apple-system, Segoe UI, Roboto';
    const text = label;
    const textW = octx.measureText(text).width;
    const boxW = textW + padX * 2;
    const boxH = 22;
    const bx = Math.max(0, Math.min(overlay.width - boxW - 2, x + 4));
    const by = Math.max(0, y - boxH - 4);
    octx.fillStyle = 'rgba(0,0,0,0.55)';
    octx.fillRect(bx, by, boxW, boxH);
    octx.fillStyle = '#fff';
    octx.fillText(text, bx + padX, by + 15);
    octx.restore();
  }

  function classifyTrafficLightColor(x, y, w, h) {
    // Sample a small ROI for speed
    const sx = Math.max(0, Math.floor(x));
    const sy = Math.max(0, Math.floor(y));
    const sw = Math.max(1, Math.floor(w));
    const sh = Math.max(1, Math.floor(h));
    const sampleW = Math.max(8, Math.floor(sw * 0.25));
    const sampleH = Math.max(8, Math.floor(sh * 0.25));

    // Draw ROI scaled down
    const tmpW = sampleW, tmpH = sampleH;
    pctx.drawImage(video, sx, sy, sw, sh, 0, 0, tmpW, tmpH);
    const { data } = pctx.getImageData(0, 0, tmpW, tmpH);

    let redCount = 0, greenCount = 0;
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i], g = data[i+1], b = data[i+2];
      const total = r + g + b + 1;
      const rNorm = r / total, gNorm = g / total;
      if (r > g + 30 && r > b + 30 && rNorm > 0.4) redCount++;
      if (g > r + 30 && g > b + 30 && gNorm > 0.4) greenCount++;
    }
    if (redCount > greenCount * 1.2) return 'red';
    if (greenCount > redCount * 1.2) return 'green';
    return 'unknown';
  }

  function speak(text, lang = 'en-US') {
    if (!('speechSynthesis' in window)) return;
    const key = `${lang}:${text}`;
    const t = now();
    const last = speechCooldown.get(key) || 0;
    if (t - last < SPEAK_COOLDOWN_MS) return;
    speechCooldown.set(key, t);

    const utter = new SpeechSynthesisUtterance(text);
    utter.lang = lang;
    utter.rate = 1;
    utter.pitch = 1;
    speechSynthesis.speak(utter);
    spokenStatus.textContent = text;
  }

  function updateBeepVolume(detections) {
    if (!gain || !audioCtx) return;
    // Approximate closeness by largest area fraction of the frame among all objects
    let maxFrac = 0;
    const frameArea = overlay.width * overlay.height;
    for (const d of detections) {
      const [x, y, w, h] = d.bbox;
      const frac = (w * h) / frameArea;
      if (frac > maxFrac) maxFrac = frac;
    }
    // Map area fraction to volume [0.02 .. 0.3]
    const vol = Math.max(0.02, Math.min(0.3, maxFrac * 2.5 + 0.02));
    try {
      gain.gain.cancelScheduledValues(audioCtx.currentTime);
      gain.gain.linearRampToValueAtTime(vol, audioCtx.currentTime + 0.08);
    } catch {}
  }

  async function doOCRThrottled() {
    const t = now();
    if (!ocrWorker || t - lastOCRTime < OCR_INTERVAL_MS) return;
    lastOCRTime = t;

    // Downscale frame for speed
    const w = Math.floor(proc.width * 0.6);
    const h = Math.floor(proc.height * 0.6);
    pctx.drawImage(video, 0, 0, proc.width, proc.height, 0, 0, w, h);

    setStatus(ocrStatus, 'Reading...', false, true);
    try {
      const { data } = await ocrWorker.recognize(pctx.getImageData(0, 0, w, h));
      const text = (data.text || '').trim().replace(/\s+/g, ' ');
      if (text) {
        // Language heuristic
        const hasHeb = /[\u0590-\u05FF]/.test(text);
        const lang = hasHeb ? 'he-IL' : 'en-US';
        const say = hasHeb ? `מילים: ${text}` : `Words: ${text}`;
        speak(say, lang);
      }
    } catch (e) {
      console.warn('OCR error', e);
    } finally {
      setStatus(ocrStatus, 'Ready', true);
    }
  }

  async function detectLoop() {
    let lastDetectTs = 0;
    const tick = async () => {
      if (!running) return;

      const t = now();
      if (t - lastDetectTs >= DETECT_INTERVAL_MS) {
        lastDetectTs = t;

        // Draw current frame on overlay and run detection
        octx.clearRect(0, 0, overlay.width, overlay.height);

        let predictions = [];
        try {
          predictions = await model.detect(video);
        } catch (e) {
          console.warn('Detect error', e);
        }

        lastDetections = predictions;

        // Filter and draw targeted classes
        const targets = [];
        for (const p of predictions) {
          const cls = p.class; // e.g., 'car', 'bus', 'traffic light'
          const [x, y, w, h] = p.bbox;

          if (cls === 'car' || cls === 'bus') {
            drawBox(x, y, w, h, `${cls} ${(p.score*100).toFixed(0)}%`, cls);
            targets.push({ ...p, label: cls });
          } else if (cls === 'traffic light') {
            const color = classifyTrafficLightColor(x, y, w, h);
            const label = color === 'unknown' ? 'traffic light' : `traffic light: ${color}`;
            drawBox(x, y, w, h, label, 'traffic');
            targets.push({ ...p, label });
          }
        }

        // Beep based on overall proximity of any object
        updateBeepVolume(predictions);

        // Speak discoveries briefly
        for (const t of targets) {
          if (t.label.startsWith('traffic light')) {
            const color = t.label.includes('red') ? 'red' : t.label.includes('green') ? 'green' : '';
            if (color === 'red') speak('Traffic light red', 'en-US');
            else if (color === 'green') speak('Traffic light green', 'en-US');
            else speak('Traffic light', 'en-US');
          } else if (t.label === 'car') {
            speak('Car', 'en-US');
          } else if (t.label === 'bus') {
            speak('Bus', 'en-US');
          }
        }

        // OCR occasionally
        doOCRThrottled();
      }

      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
  }

  function stopAll() {
    running = false;
    if (rafId) cancelAnimationFrame(rafId);
    rafId = null;
    clearOverlay();
    stopCamera();
    if (audioCtx) {
      try { audioCtx.suspend(); } catch {}
    }
    setStatus(mlStatus, model ? 'Object model ready' : 'Idle', !!model);
    setStatus(ocrStatus, ocrWorker ? 'Ready' : 'Idle', !!ocrWorker);
    startBtn.disabled = false;
    stopBtn.disabled = true;
  }

  startBtn.addEventListener('click', async () => {
    // User gesture: initialize audio for autoplay policies
    setupAudio();
    if (audioCtx && audioCtx.state === 'suspended') {
      try { await audioCtx.resume(); } catch {}
    }

    startBtn.disabled = true;
    setStatus(camStatus, 'Starting...', false, true);
    setStatus(mlStatus, 'Preparing...', false, true);
    setStatus(ocrStatus, 'Preparing...', false, true);

    try {
      await loadModelsOnce();
      await startCamera();
      running = true;
      stopBtn.disabled = false;
      detectLoop();
    } catch (e) {
      console.error(e);
      alert('Unable to start camera or models. Please ensure you granted camera access and are on HTTPS.');
      stopAll();
    }
  });

  stopBtn.addEventListener('click', () => {
    stopAll();
  });

  // Clean up on page hide
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && running) {
      stopAll();
    }
  });
})();
