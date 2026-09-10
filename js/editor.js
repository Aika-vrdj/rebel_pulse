import { AudioEngine } from './audio.js';
import { parseChartJSON } from './chart.js';
import { parseMidiFile } from './midi.js';

const $ = (id) => document.getElementById(id);
const LANE_COLORS = ['#ff2d55', '#00e5ff', '#b967ff', '#ffd23f'];
const WAVE_BUCKETS = 2000;
const DRAG_THRESHOLD_PX = 6;

const audio = new AudioEngine();
let notes = [];
let peaks = null;
let bpm = 128;
let offsetSec = 0;
let title = 'Mi Canción';
let snapDivision = 4;
let pxPerSecond = 130;
let dragState = null; // { lane, startTime, startX }

const rulerEl = $('ruler');
const waveformEl = $('waveform');
const lanesWrapperEl = $('lanes-wrapper');
const timelineContentEl = $('timeline-content');
const timelineScrollerEl = $('timeline-scroller');
const playheadEl = $('playhead');
const laneRows = [...document.querySelectorAll('.lane-row')];

// ---------- Setup screen wiring ----------

function setupFileDrop(dropEl, inputEl, onFile) {
  dropEl.addEventListener('click', () => inputEl.click());
  inputEl.addEventListener('change', () => { if (inputEl.files[0]) onFile(inputEl.files[0]); });
  ['dragover', 'dragenter'].forEach((evt) =>
    dropEl.addEventListener(evt, (e) => { e.preventDefault(); e.stopPropagation(); dropEl.classList.add('has-file'); })
  );
  dropEl.addEventListener('dragleave', (e) => {
    e.preventDefault(); e.stopPropagation();
    if (!dropEl.contains(e.relatedTarget)) dropEl.classList.remove('has-file');
  });
  dropEl.addEventListener('drop', (e) => {
    e.preventDefault(); e.stopPropagation();
    const file = e.dataTransfer.files[0];
    if (file) onFile(file);
  });
}
window.addEventListener('dragover', (e) => e.preventDefault());
window.addEventListener('drop', (e) => e.preventDefault());

let pendingImportedNotes = null;

setupFileDrop($('e-audio-drop'), $('e-audio-input'), async (file) => {
  $('e-audio-filename').textContent = file.name;
  $('e-audio-drop').classList.add('has-file');
  await audio.loadFile(file);
  const btn = $('e-start-button');
  btn.disabled = false;
  btn.textContent = 'ABRIR EDITOR';
});

setupFileDrop($('e-chart-drop'), $('e-chart-input'), async (file) => {
  try {
    const text = await file.text();
    const data = parseChartJSON(text);
    pendingImportedNotes = data.notes;
    if (data.meta) {
      if (typeof data.meta.bpm === 'number') $('e-bpm-input').value = data.meta.bpm;
      if (typeof data.meta.offset === 'number') $('e-offset-input').value = Math.round(data.meta.offset * 1000);
      if (data.meta.title) $('e-title-input').value = data.meta.title;
    }
    $('e-chart-filename').textContent = `${file.name} (${data.notes.length} notas)`;
    $('e-chart-drop').classList.add('has-file');
  } catch (err) {
    alert('No se pudo leer el chart: ' + err.message);
    pendingImportedNotes = null;
  }
});

setupFileDrop($('e-midi-drop'), $('e-midi-input'), async (file) => {
  try {
    const { notes, detectedBPM, laneMapping } = await parseMidiFile(file);
    pendingImportedNotes = notes;
    $('e-bpm-input').value = detectedBPM;
    $('e-offset-input').value = 0;
    $('e-midi-filename').textContent = `${file.name} (${notes.length} notas) — ${laneMapping}`;
    $('e-midi-drop').classList.add('has-file');
  } catch (err) {
    alert('No se pudo leer el MIDI: ' + err.message);
    pendingImportedNotes = null;
  }
});

$('e-start-button').addEventListener('click', () => {
  bpm = parseFloat($('e-bpm-input').value) || 128;
  offsetSec = (parseFloat($('e-offset-input').value) || 0) / 1000;
  title = $('e-title-input').value || 'Mi Canción';
  notes = pendingImportedNotes ? pendingImportedNotes.map((n) => ({ ...n })) : [];
  openEditor();
});

// ---------- Editor initialization ----------

function openEditor() {
  $('editor-setup').classList.add('hidden');
  $('editor-main').classList.remove('hidden');

  peaks = computePeaks(audio.buffer, WAVE_BUCKETS);
  pxPerSecond = parseInt($('zoom-slider').value, 10);

  renderAll();
  attachLaneEvents();
  attachRulerScrub();
  requestAnimationFrame(rafLoop);
  updateNoteCount();
}

function beatInterval() { return 60 / bpm; }
function snapStep() { return beatInterval() / snapDivision; }

function snapTime(t) {
  const step = snapStep();
  const rel = t - offsetSec;
  const snappedRel = Math.round(rel / step) * step;
  return Math.max(0, offsetSec + snappedRel);
}

function computePeaks(buffer, bucketCount) {
  const data = buffer.getChannelData(0);
  const perBucket = Math.max(1, Math.floor(data.length / bucketCount));
  const out = new Float32Array(bucketCount);
  for (let i = 0; i < bucketCount; i++) {
    const start = i * perBucket;
    const end = Math.min(data.length, start + perBucket);
    let max = 0;
    for (let j = start; j < end; j++) {
      const v = Math.abs(data[j]);
      if (v > max) max = v;
    }
    out[i] = max;
  }
  return out;
}

function totalWidthPx() { return audio.duration * pxPerSecond; }

function renderAll() {
  const w = totalWidthPx();
  timelineContentEl.style.width = `${w}px`;

  renderGridBackground();
  renderRulerLabels(w);
  renderWaveform(w);
  renderNotes();
}

function renderGridBackground() {
  const beatPx = beatInterval() * pxPerSecond;
  const stepPx = snapStep() * pxPerSecond;
  const measurePx = beatPx * 4;
  const offsetPx = offsetSec * pxPerSecond;

  const bg = [
    `repeating-linear-gradient(90deg, rgba(255,255,255,0.05) 0 1px, transparent 1px ${stepPx}px)`,
    `repeating-linear-gradient(90deg, rgba(255,255,255,0.12) 0 1px, transparent 1px ${beatPx}px)`,
    `repeating-linear-gradient(90deg, rgba(255,255,255,0.28) 0 2px, transparent 2px ${measurePx}px)`,
  ].join(', ');

  lanesWrapperEl.style.backgroundImage = bg;
  lanesWrapperEl.style.backgroundPosition = `${offsetPx}px 0`;
  rulerEl.style.backgroundImage = bg;
  rulerEl.style.backgroundPosition = `${offsetPx}px 0`;
}

function formatTime(t) {
  if (t < 0) t = 0;
  const m = Math.floor(t / 60);
  const s = (t % 60).toFixed(2).padStart(5, '0');
  return `${m}:${s}`;
}

function renderRulerLabels(totalWidth) {
  rulerEl.querySelectorAll('.ruler-label').forEach((el) => el.remove());
  const labelIntervalSec = pxPerSecond < 80 ? 10 : pxPerSecond < 160 ? 5 : 2;
  const count = Math.ceil(audio.duration / labelIntervalSec);
  const frag = document.createDocumentFragment();
  for (let i = 0; i <= count; i++) {
    const t = i * labelIntervalSec;
    const label = document.createElement('div');
    label.className = 'ruler-label';
    label.style.left = `${t * pxPerSecond}px`;
    label.textContent = formatTime(t);
    frag.appendChild(label);
  }
  rulerEl.appendChild(frag);
}

function renderWaveform(totalWidth) {
  waveformEl.innerHTML = '';
  const barWidth = Math.max(1, totalWidth / WAVE_BUCKETS);
  const maxBarHeight = 64;
  const frag = document.createDocumentFragment();
  for (let i = 0; i < WAVE_BUCKETS; i++) {
    const amp = peaks[i];
    if (amp < 0.01) continue;
    const bar = document.createElement('div');
    bar.className = 'wave-bar';
    bar.style.left = `${i * barWidth}px`;
    bar.style.width = `${Math.max(1, barWidth)}px`;
    bar.style.height = `${Math.max(2, amp * maxBarHeight)}px`;
    frag.appendChild(bar);
  }
  waveformEl.appendChild(frag);
}

function renderNotes() {
  laneRows.forEach((row) => (row.innerHTML = ''));
  for (const note of notes) {
    const row = laneRows[note.lane];
    const el = document.createElement('div');
    el.className = `note-block ${note.type}`;
    el.style.background = LANE_COLORS[note.lane];
    const left = note.time * pxPerSecond;
    if (note.type === 'hold') {
      const width = Math.max(4, note.duration * pxPerSecond);
      el.style.left = `${left}px`;
      el.style.width = `${width}px`;
    } else {
      el.style.left = `${left - 7}px`;
      el.style.width = '14px';
    }
    el.title = `${note.time.toFixed(3)}s`;
    el.addEventListener('mousedown', (e) => e.stopPropagation());
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      notes = notes.filter((n) => n !== note);
      renderNotes();
      updateNoteCount();
    });
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    row.appendChild(el);
  }
}

function updateNoteCount() {
  $('note-count').textContent = `${notes.length} notas`;
}

function xToTime(clientX) {
  const rect = timelineContentEl.getBoundingClientRect();
  return (clientX - rect.left) / pxPerSecond;
}

function attachLaneEvents() {
  laneRows.forEach((row) => {
    const lane = parseInt(row.dataset.lane, 10);
    row.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;
      dragState = { lane, startTime: xToTime(e.clientX), startX: e.clientX };
    });
  });

  window.addEventListener('mousemove', (e) => {
    if (!dragState) return;
    // (visual drag preview omitted for v1 — snap is applied on release)
  });

  window.addEventListener('mouseup', (e) => {
    if (!dragState) return;
    const { lane, startTime, startX } = dragState;
    dragState = null;
    const endTime = xToTime(e.clientX);
    const dxPx = Math.abs(e.clientX - startX);

    if (dxPx < DRAG_THRESHOLD_PX) {
      const time = snapTime(startTime);
      notes.push({ time, lane, type: 'tap' });
    } else {
      const t0 = snapTime(Math.min(startTime, endTime));
      const t1 = snapTime(Math.max(startTime, endTime));
      const duration = Math.max(snapStep(), t1 - t0);
      notes.push({ time: t0, lane, type: 'hold', duration });
    }
    notes.sort((a, b) => a.time - b.time);
    renderNotes();
    updateNoteCount();
  });
}

function attachRulerScrub() {
  rulerEl.addEventListener('mousedown', (e) => {
    const wasPlaying = audio.isPlaying;
    const t = xToTime(e.clientX);
    audio.seek(t);
    if (wasPlaying) audio.resume();
  });
}

// ---------- Playback ----------

function togglePlay() {
  if (audio.isPlaying) audio.pause();
  else audio.resume();
  $('play-button').textContent = audio.isPlaying ? '❚❚' : '▶';
}

$('play-button').addEventListener('click', togglePlay);

window.addEventListener('keydown', (e) => {
  if (document.activeElement && ['INPUT', 'SELECT'].includes(document.activeElement.tagName)) return;
  if ($('editor-main').classList.contains('hidden')) return;
  if (e.code === 'Space') { e.preventDefault(); togglePlay(); }
});

function rafLoop() {
  if (!$('editor-main').classList.contains('hidden')) {
    const t = audio.getSongTime();
    const x = t * pxPerSecond;
    playheadEl.style.left = `${x}px`;
    $('time-display').textContent = formatTime(t);

    // Keep playhead comfortably in view while playing
    if (audio.isPlaying) {
      const scrollerRect = timelineScrollerEl.getBoundingClientRect();
      const visibleLeft = timelineScrollerEl.scrollLeft;
      const visibleRight = visibleLeft + scrollerRect.width;
      if (x > visibleRight - 200 || x < visibleLeft) {
        timelineScrollerEl.scrollLeft = x - scrollerRect.width * 0.3;
      }
    }
  }
  requestAnimationFrame(rafLoop);
}

// ---------- Toolbar controls ----------

$('snap-select').addEventListener('change', (e) => {
  snapDivision = parseInt(e.target.value, 10);
  renderGridBackground();
});

$('zoom-slider').addEventListener('input', (e) => {
  pxPerSecond = parseInt(e.target.value, 10);
  renderAll();
});

$('clear-button').addEventListener('click', () => {
  if (notes.length && !confirm(`¿Borrar las ${notes.length} notas del chart?`)) return;
  notes = [];
  renderNotes();
  updateNoteCount();
});

$('export-button').addEventListener('click', () => {
  const chart = {
    meta: { title, bpm, offset: offsetSec, generated: false },
    notes: notes.map((n) => ({
      time: +n.time.toFixed(4),
      lane: n.lane,
      type: n.type,
      ...(n.type === 'hold' ? { duration: +n.duration.toFixed(4) } : {}),
    })),
  };
  const blob = new Blob([JSON.stringify(chart, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const safeTitle = title.replace(/[^a-z0-9\-_]+/gi, '_').toLowerCase() || 'chart';
  a.href = url;
  a.download = `${safeTitle}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
});
