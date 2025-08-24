const startCameraBtn = document.getElementById('startCameraBtn');
const video = document.getElementById('video');
const canvas = document.getElementById('canvas');
const captureBtn = document.getElementById('captureBtn');
const progressWrap = document.getElementById('progressWrap');
const progressBar = document.getElementById('progressBar');
const progressText = document.getElementById('progressText');
const output = document.getElementById('output');
const copyBtn = document.getElementById('copyBtn');
const clearBtn = document.getElementById('clearBtn');
const speakBtn = document.getElementById('speakBtn');
const dirSelect = document.getElementById('dirSelect');

let availableVoices = [];

// Load voices for speech synthesis
function loadVoices() {
  availableVoices = speechSynthesis.getVoices();
}
speechSynthesis.onvoiceschanged = loadVoices;
loadVoices();

// Start camera on button click (triggers mobile permission prompt)
startCameraBtn.addEventListener('click', () => {
  navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } })
    .then(stream => {
      video.srcObject = stream;
      video.hidden = false;
      captureBtn.hidden = false;
      startCameraBtn.hidden = true;
    })
    .catch(err => {
      console.error('Camera error:', err);
      alert('Unable to access camera. Please check permissions.');
    });
});

// Capture frame from video and run OCR
captureBtn.addEventListener('click', async () => {
  const langs = Array.from(document.querySelectorAll('input[name="lang"]:checked')).map(cb => cb.value);
  if (!langs.length) return alert('Select at least one language.');

  const ctx = canvas.getContext('2d');
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

  disableUI(true);
  output.value = '';
  showProgress(true, 0, 'Initializing…');

  try {
    const dataUrl = canvas.toDataURL('image/png');
    const { data } = await Tesseract.recognize(dataUrl, langs.join('+'), {
      logger: m => {
        if (m.status && typeof m.progress === 'number') {
          const pct = Math.round(m.progress * 100);
          showProgress(true, pct, `${capitalize(m.status)} ${pct}%`);
        }
      }
    });

    output.value = data.text || '';
    applyAutoDirection(output);
    showProgress(false);

  } catch (err) {
    console.error(err);
    alert('OCR failed.');
    showProgress(false);
  } finally {
    disableUI(false);
  }
});

// Copy text
copyBtn.addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(output.value);
    flash(progressText, 'Copied to clipboard', 1500);
  } catch {
    alert('Copy failed.');
  }
});

// Clear text
clearBtn.addEventListener('click', () => {
  output.value = '';
});

// Speak text aloud
speakBtn.addEventListener('click', () => {
  const text = output.value.trim();
  if (!text) return alert('No text to speak.');

  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);

  // Detect Hebrew characters and set language/voice
  if (/[\u0590-\u05FF]/.test(text)) {
    utterance.lang = 'he-IL';
    const hebVoice = availableVoices.find(v => v.lang.startsWith('he'));
    if (hebVoice) utterance.voice = hebVoice;
  } else {
    utterance.lang = 'en-US';
    const enVoice = availableVoices.find(v => v.lang.startsWith('en'));
    if (enVoice) utterance.voice = enVoice;
  }

  utterance.rate = 1;
  utterance.pitch = 1;
  speechSynthesis.speak(utterance);
});

// Change text direction manually
dirSelect.addEventListener('change', () => {
  output.setAttribute('dir', dirSelect.value);
});

// Helper functions
function showProgress(show, pct = null, text = '') {
  progressWrap.hidden = !show;
  if (pct !== null) progressBar.style.width = `${pct}%`;
  if (text) progressText.textContent = text;
}

function disableUI(disabled) {
  captureBtn.disabled = disabled;
}

function capitalize(s) {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

function applyAutoDirection(textarea) {
  if (dirSelect.value !== 'auto') return;
  const heCount = (textarea.value.match(/[\u0590-\u05FF]/g) || []).length;
  const enCount = (textarea.value.match(/[A-Za-z]/g) || []).length;
  const dir = heCount > enCount ? 'rtl' : 'ltr';
  textarea.setAttribute('dir', dir);
}

function flash(el, message, ms) {
  const prev = el.textContent;
  el.textContent = message;
  el.style.color = '#e8f1ff';
  setTimeout(() => {
    el.textContent = prev;
    el.style.color = '';
  }, ms);
}
