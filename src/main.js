/**
 * Journal Speed Reader — Main Application
 *
 * Orchestrates the upload screen, extraction pipeline, and RSVP reader.
 */
import './styles/index.css';
import { extractTextFromPDF, parseTextInput } from './extraction/pdfjs.js';
import { buildRSVPTokens } from './processing/tokenizer.js';
import { sanitizeTokens } from './processing/sanitizer.js';
import { RSVPEngine } from './reader/engine.js';
import { RSVPDisplay } from './reader/display.js';

// ── DOM Helpers ───────────────────────────────────────────────
const $ = (id) => document.getElementById(id);

// Screens
const uploadScreen = $('upload-screen');
const readerScreen = $('reader-screen');

// Upload UI
const tabPdf = $('tab-pdf');
const tabPaste = $('tab-paste');
const tabContentPdf = $('tab-content-pdf');
const tabContentPaste = $('tab-content-paste');
const dropZone = $('drop-zone');
const fileInput = $('file-input');
const pasteArea = $('paste-area');
const startPasteBtn = $('start-paste-btn');
const processingOverlay = $('processing-overlay');
const processingStatus = $('processing-status');

// Reader controls
const btnPlay = $('btn-play');
const btnBack = $('btn-back');
const btnForward = $('btn-forward');
const btnReset = $('btn-reset');
const btnNew = $('btn-new');
const wpmSlider = $('wpm-slider');
const wpmLabel = $('wpm-label');
const wordCount = $('word-count');
const progressBar = $('progress-bar');
const progressContainer = $('progress-container');
const iconPlay = btnPlay.querySelector('.icon-play');
const iconPause = btnPlay.querySelector('.icon-pause');

// ── State ─────────────────────────────────────────────────────
let engine = null;
let display = null;

// ── Tab Switching ─────────────────────────────────────────────
tabPdf.addEventListener('click', () => switchTab('pdf'));
tabPaste.addEventListener('click', () => switchTab('paste'));

function switchTab(tab) {
  tabPdf.classList.toggle('active', tab === 'pdf');
  tabPaste.classList.toggle('active', tab === 'paste');
  tabContentPdf.classList.toggle('hidden', tab !== 'pdf');
  tabContentPaste.classList.toggle('hidden', tab !== 'paste');
}

// ── Drag & Drop ───────────────────────────────────────────────
dropZone.addEventListener('click', (e) => {
  // Prevent double dialog: the <label for="file-input"> and dev-btn already handle their own clicks
  if (e.target.closest('label[for="file-input"]') || e.target.closest('.dev-btn') || e.target === fileInput) return;
  fileInput.click();
});

dropZone.addEventListener('dragover', (e) => {
  e.preventDefault();
  dropZone.classList.add('dragover');
});

dropZone.addEventListener('dragleave', () => {
  dropZone.classList.remove('dragover');
});

dropZone.addEventListener('drop', (e) => {
  e.preventDefault();
  dropZone.classList.remove('dragover');
  const file = e.dataTransfer.files[0];
  if (file && file.type === 'application/pdf') {
    handlePDFFile(file);
  }
});

fileInput.addEventListener('change', () => {
  const file = fileInput.files[0];
  if (file) handlePDFFile(file);
});

// ── Paste Input ───────────────────────────────────────────────
startPasteBtn.addEventListener('click', () => {
  const text = pasteArea.value.trim();
  if (!text) return;
  handleTextInput(text);
});

// ── Dev: Load Test PDF ────────────────────────────────────────
const devLoadTest = $('dev-load-test');
devLoadTest.addEventListener('click', async () => {
  showProcessing();
  try {
    const response = await fetch('/references/test.pdf');
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const arrayBuffer = await response.arrayBuffer();
    const result = await extractTextFromPDF(arrayBuffer, (status) => {
      processingStatus.textContent = status;
    });

    if (result.tokens.length === 0) {
      alert('No body text extracted from test.pdf.');
      hideProcessing();
      return;
    }

    startReader(result.tokens);
  } catch (err) {
    console.error('Dev load failed:', err);
    alert('Failed to load test.pdf: ' + err.message);
    hideProcessing();
  }
});

// ── Processing Pipeline ───────────────────────────────────────
async function handlePDFFile(file) {
  showProcessing();

  try {
    const arrayBuffer = await file.arrayBuffer();
    const result = await extractTextFromPDF(arrayBuffer, (status) => {
      processingStatus.textContent = status;
    });

    if (result.tokens.length === 0) {
      alert('No body text could be extracted from this PDF. The document may be scanned (image-based) or have an unusual structure.');
      hideProcessing();
      return;
    }

    startReader(result.tokens);
  } catch (err) {
    console.error('PDF extraction failed:', err);
    alert('Failed to extract text from this PDF. Please try a different file.\n\nError: ' + err.message);
    hideProcessing();
  }
}

function handleTextInput(text) {
  const result = parseTextInput(text);

  if (result.tokens.length === 0) {
    alert('No text was detected. Please paste some content and try again.');
    return;
  }

  startReader(result.tokens);
}

// ── Reader Initialization ─────────────────────────────────────
function startReader(rawTokens) {
  // Sanitize tokens to fix PDF extraction artifacts
  const cleanedTokens = sanitizeTokens(rawTokens);
  const tokens = buildRSVPTokens(cleanedTokens);

  // Clean up previous engine
  if (engine) engine.destroy();

  engine = new RSVPEngine(tokens);
  display = new RSVPDisplay();

  // Wire up engine events
  engine.on('word', (token) => {
    display.showWord(token);
    wordCount.textContent = `${engine.currentIndex} / ${engine.totalWords}`;
  });

  engine.on('progress', (progress) => {
    progressBar.style.width = `${(progress * 100).toFixed(1)}%`;
  });

  engine.on('section', (name) => {
    display.showSection(name);
  });

  engine.on('state', (state) => {
    updatePlayButton(state === 'playing');
  });

  engine.on('wpm', (wpm) => {
    wpmLabel.textContent = `${wpm} wpm`;
    wpmSlider.value = wpm;
  });

  engine.on('complete', () => {
    updatePlayButton(false);
  });

  // Set initial WPM
  engine.setWPM(parseInt(wpmSlider.value, 10));

  // Show the first word
  display.showWord(tokens[0]);
  wordCount.textContent = `0 / ${engine.totalWords}`;
  progressBar.style.width = '0%';

  // Switch to reader screen
  hideProcessing();
  showScreen('reader');
}

// ── Reader Controls ───────────────────────────────────────────
btnPlay.addEventListener('click', () => engine?.toggle());

btnBack.addEventListener('click', () => {
  engine?.skip(-10);
});

btnForward.addEventListener('click', () => {
  engine?.skip(10);
});

btnReset.addEventListener('click', () => {
  engine?.reset();
});

btnNew.addEventListener('click', () => {
  engine?.destroy();
  engine = null;
  display?.clear();
  showScreen('upload');
  // Reset file input
  fileInput.value = '';
  pasteArea.value = '';
});

wpmSlider.addEventListener('input', () => {
  const wpm = parseInt(wpmSlider.value, 10);
  engine?.setWPM(wpm);
  wpmLabel.textContent = `${wpm} wpm`;
});

// Progress bar click to seek
progressContainer.addEventListener('click', (e) => {
  if (!engine) return;
  const rect = progressContainer.getBoundingClientRect();
  const fraction = (e.clientX - rect.left) / rect.width;
  const targetIndex = Math.floor(fraction * engine.totalWords);
  engine.seekTo(targetIndex);
});

// ── Keyboard Shortcuts ────────────────────────────────────────
document.addEventListener('keydown', (e) => {
  // Don't capture keys when typing in the paste area
  if (e.target === pasteArea) return;

  switch (e.code) {
    case 'Space':
      e.preventDefault();
      engine?.toggle();
      break;
    case 'ArrowLeft':
      e.preventDefault();
      engine?.skip(-10);
      break;
    case 'ArrowRight':
      e.preventDefault();
      engine?.skip(10);
      break;
    case 'ArrowUp':
      e.preventDefault();
      if (engine) {
        engine.setWPM(engine.wpm + 25);
      }
      break;
    case 'ArrowDown':
      e.preventDefault();
      if (engine) {
        engine.setWPM(engine.wpm - 25);
      }
      break;
    case 'KeyR':
      if (!e.ctrlKey && !e.metaKey) {
        engine?.reset();
      }
      break;
    case 'Escape':
      engine?.pause();
      break;
  }
});

// ── UI Helpers ────────────────────────────────────────────────
function showScreen(name) {
  uploadScreen.classList.toggle('active', name === 'upload');
  readerScreen.classList.toggle('active', name === 'reader');
}

function showProcessing() {
  processingOverlay.classList.remove('hidden');
}

function hideProcessing() {
  processingOverlay.classList.add('hidden');
}

function updatePlayButton(isPlaying) {
  iconPlay.classList.toggle('hidden', isPlaying);
  iconPause.classList.toggle('hidden', !isPlaying);
}
