const video = document.getElementById('video');
const scanBtn = document.getElementById('scanBtn');
const resultDiv = document.getElementById('result');

async function initCamera() {
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: 'environment' },
    audio: false
  });
  video.srcObject = stream;
}

async function runOCR() {
  // Capture current frame
  const canvas = document.createElement('canvas');
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(video, 0, 0);

  resultDiv.textContent = 'Scanning...';

  try {
    const { data: { text } } = await Tesseract.recognize(canvas, 'eng+heb');
    const cleanText = text.trim();
    resultDiv.textContent = cleanText || 'No text detected';

    // Speak the result
    let utterance = new SpeechSynthesisUtterance(cleanText || 'No text detected');
    utterance.lang = /[\u0590-\u05FF]/.test(cleanText) ? 'he-IL' : 'en-US';
    speechSynthesis.speak(utterance);
  } catch (err) {
    console.error(err);
    resultDiv.textContent = 'Error during OCR';
  }
}

scanBtn.addEventListener('click', runOCR);

initCamera();
