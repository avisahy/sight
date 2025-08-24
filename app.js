const dropzone = document.getElementById('dropzone');
const fileInput = document.getElementById('fileInput');
const runBtn = document.getElementById('runBtn');
const progressWrap = document.getElementById('progressWrap');
const progressBar = document.getElementById('progressBar');
const progressText = document.getElementById('progressText');
const output = document.getElementById('output');
const copyBtn = document.getElementById('copyBtn');
const clearBtn = document.getElementById('clearBtn');
const speakBtn = document.getElementById('speakBtn');
const dirSelect = document.getElementById('dirSelect');
const previewSection = document.getElementById('previewSection');
const previewImg = document.getElementById('previewImg');

let currentFile = null;
let availableVoices = [];

// Load voices
function loadVoices() {
  availableVoices = speechSynthesis.getVoices();
}
speechSynthesis.onvoiceschanged = loadVoices;
loadVoices();

// Drag & drop
['dragenter', 'dragover'].forEach(evt =>
  dropzone.addEventListener(evt, e => {
    e.preventDefault();
    dropzone.classList.add('dragover');
  })
);
['dragleave', 'drop'].forEach(evt =>
  dropzone.addEventListener(evt, e => {
    e.preventDefault();
    dropzone.classList.remove('dragover');
  })
);
dropzone.addEventListener('drop', e => {
  const file = e.dataTransfer.files?.[0];
  if (file) setFile(file);
});
dropzone.addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', () => {
  const file = fileInput.files?.[0];
  if (file) setFile(file);
});

function setFile(file) {
  if (!file.type.startsWith('image/')) {
    alert('Please select an image file.');
    return;
  }
  currentFile = file;
  previewImg.src = URL.createObjectURL(file);
  previewSection.hidden = false;
}

// Run OCR
runBtn.addEventListener('click', async () => {
  if (!currentFile) return alert('Please select an image first.');

  const langs = Array.from(document.querySelectorAll('input[name="lang"]:checked')).map(cb => cb.value);
  if (!langs.length) return alert('Select at least one language.');

  disableUI(true);
  output.value = '';
  showProgress(true, 0, 'Initializing…');

  try {
    const imgURL = URL.createObjectURL(currentFile);
    const { data } = await Tesseract.recognize(imgURL, langs.join('+'), {
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

// Copy
copyBtn.addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(output.value);
    flash(progressText, 'Copied to clipboard', 1500);
  } catch {
    alert('Copy failed. Select text and copy manually.');
  }
});

// Clear
clearBtn.addEventListener('click', () => {
  output.value = '';
});

// Speak
speakBtn.addEventListener('click', () => {
  const text = output.value.trim();
  if (!text) {
    alert('No text to speak.');
    return;
  }

  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);

  // Pick voice based on detected language
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

// Direction change
dirSelect.addEventListener('change', () => {
  output.setAttribute('dir', dirSelect.value);
});

// Helpers
function showProgress(show, pct = null, text = '') {
  progressWrap.hidden = !show;
  if (pct !== null) progressBar.style.width = `${pct}%`;
  if (text) progressText.textContent = text;
}

function disableUI(disabled) {
  runBtn.disabled = disabled;
  fileInput.disabled = disabled;
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
