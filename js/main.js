import { AudioEngine } from './audio.js';
import { generateTestChart, parseChartJSON } from './chart.js';
import { Game } from './game.js';
import { buildResultsCard, copyCanvasToClipboard, ensureFontsLoaded } from './share.js';

const $ = (id) => document.getElementById(id);

const screens = {
  setup: $('setup-screen'),
  game: $('game-screen'),
  pause: $('pause-overlay'),
  results: $('results-screen'),
};

function show(name) {
  Object.values(screens).forEach((el) => el.classList.add('hidden'));
  screens[name].classList.remove('hidden');
}

const audio = new AudioEngine();
let currentGame = null;
let customChartData = null;
let audioFile = null;
let lastResults = null;

// ---------- Setup screen wiring ----------

// The browser's default reaction to a dropped file is to navigate the tab
// to it, which would kill the whole app. Block that globally first, then
// wire up each drop zone on top of that safety net.
window.addEventListener('dragover', (e) => e.preventDefault());
window.addEventListener('drop', (e) => e.preventDefault());

function setupFileDrop(dropEl, inputEl, onFile) {
  dropEl.addEventListener('click', () => inputEl.click());
  inputEl.addEventListener('change', () => {
    if (inputEl.files[0]) onFile(inputEl.files[0]);
  });
  ['dragover', 'dragenter'].forEach((evt) =>
    dropEl.addEventListener(evt, (e) => {
      e.preventDefault();
      e.stopPropagation();
      dropEl.classList.add('has-file');
    })
  );
  dropEl.addEventListener('dragleave', (e) => {
    e.preventDefault();
    e.stopPropagation();
    // Only clear the highlight once we've actually left the zone (not just
    // moved between its child elements, which also fires dragleave).
    if (!dropEl.contains(e.relatedTarget)) dropEl.classList.remove('has-file');
  });
  dropEl.addEventListener('drop', (e) => {
    e.preventDefault();
    e.stopPropagation();
    const file = e.dataTransfer.files[0];
    if (file) onFile(file);
  });
}

setupFileDrop($('audio-drop'), $('audio-input'), async (file) => {
  $('audio-filename').textContent = file.name;
  $('audio-drop').classList.add('has-file');
  audioFile = file;
  await audio.loadFile(file);
  updateStartButton();
});

setupFileDrop($('chart-drop'), $('chart-input'), async (file) => {
  try {
    const text = await file.text();
    customChartData = parseChartJSON(text);
    $('chart-filename').textContent = `${file.name} (${customChartData.notes.length} notas)`;
    $('chart-drop').classList.add('has-file');
  } catch (err) {
    alert('No se pudo leer el chart: ' + err.message);
    customChartData = null;
  }
});

$('speed-slider').addEventListener('input', (e) => {
  $('speed-value').textContent = e.target.value;
});

function updateStartButton() {
  const btn = $('start-button');
  if (audioFile) {
    btn.disabled = false;
    btn.textContent = 'INICIAR';
  } else {
    btn.disabled = true;
    btn.textContent = 'CARGA UN AUDIO PRIMERO';
  }
}

$('start-button').addEventListener('click', async () => {
  await startGame();
});

// ---------- Game lifecycle ----------

async function ensureGame() {
  if (currentGame) return currentGame;
  currentGame = new Game($('pixi-container'), audio, {
    onScoreUpdate: ({ score, accuracy }) => {
      $('score-value').textContent = Math.floor(score);
      $('accuracy-value').textContent = accuracy.toFixed(2) + '%';
    },
    onProgress: (fraction) => {
      $('song-progress-fill').style.width = `${Math.min(100, Math.max(0, fraction * 100))}%`;
    },
    onComboMilestone: () => {},
    onFinish: (results) => showResults(results),
  });
  await currentGame.init();
  return currentGame;
}

async function startGame() {
  show('game');

  const bpm = parseFloat($('bpm-input').value) || 120;
  const offsetSec = (parseFloat($('offset-input').value) || 0) / 1000;
  const density = $('density-select').value;
  const scrollSpeed = parseInt($('speed-slider').value, 10);

  const chart = customChartData || generateTestChart(bpm, audio.duration, offsetSec, density);

  const game = await ensureGame();
  game.scrollSpeed = scrollSpeed;
  game.loadChart(chart);
  game.start();
}

function showResults(results) {
  lastResults = results;
  show('results');
  ensureFontsLoaded(); // warm the fonts now so the share card is instant later

  $('results-grade').textContent = results.grade;
  $('results-score').textContent = Math.floor(results.score);
  $('results-accuracy').textContent = results.accuracy.toFixed(2) + '%';
  $('results-combo').textContent = results.maxCombo;
  $('results-perfect').textContent = results.counts.perfect;
  $('results-great').textContent = results.counts.great;
  $('results-good').textContent = results.counts.good;
  $('results-miss').textContent = results.counts.miss;
}

// ---------- Pause / resume / quit ----------

$('pause-button').addEventListener('click', () => {
  if (!currentGame || currentGame.finished) return;
  currentGame.pause();
  show('pause');
});

window.addEventListener('keydown', (e) => {
  if (e.code === 'Escape' && currentGame && !currentGame.finished) {
    if (screens.pause.classList.contains('hidden')) {
      currentGame.pause();
      show('pause');
    } else {
      currentGame.resume();
      show('game');
    }
  }
});

$('resume-button').addEventListener('click', () => {
  currentGame.resume();
  show('game');
});

$('restart-button').addEventListener('click', async () => {
  await startGame();
});

$('quit-button').addEventListener('click', () => {
  if (currentGame) currentGame.pause();
  show('setup');
});

$('results-restart').addEventListener('click', async () => {
  await startGame();
});

$('results-menu').addEventListener('click', () => {
  show('setup');
});

// ---------- Share (real PNG to clipboard) ----------

$('results-share').addEventListener('click', () => {
  if (!lastResults) return;

  const flashAudio = new Audio('flash.mp3');
  flashAudio.volume = 0.8;
  flashAudio.play().catch(() => {});

  const trackTitle = audioFile ? audioFile.name.replace(/\.[^/.]+$/, '') : 'REBEL TRACK';
  const canvas = buildResultsCard({ ...lastResults, trackTitle });

  const btn = $('results-share');
  const originalText = btn.textContent;

  // copyCanvasToClipboard() is called synchronously right here (nothing
  // awaited before it) so the click's user-gesture is still active when
  // navigator.clipboard.write() actually runs.
  copyCanvasToClipboard(canvas)
    .then((method) => {
      btn.textContent = method === 'clipboard' ? '✅ ¡Copiado al portapapeles!' : '⬇️ Descargado';
      setTimeout(() => { btn.textContent = originalText; }, 1800);
    })
    .catch((err) => {
      console.error('Share image failed:', err);
      btn.textContent = '⚠️ No se pudo copiar';
      setTimeout(() => { btn.textContent = originalText; }, 1800);
    });
});

updateStartButton();