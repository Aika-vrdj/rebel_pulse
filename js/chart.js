// Chart format (this is the format the future in-browser editor will export):
// {
//   meta: { title, bpm, offset },
//   notes: [ { time: seconds, lane: 0-3, type: 'tap'|'hold', duration?: seconds } ]
// }

const LANES = 4;

function rngLaneAvoidingRepeat(prevLane) {
  let lane = Math.floor(Math.random() * LANES);
  if (lane === prevLane) lane = (lane + 1 + Math.floor(Math.random() * (LANES - 1))) % LANES;
  return lane;
}

// Builds a playable test chart purely from BPM so you can feel the gameplay
// against any track today, without hand-charting. Swap this out later for
// real charts once the editor exists.
export function generateTestChart(bpm, durationSec, offsetSec, density = 'normal') {
  const beatInterval = 60 / bpm;
  const notes = [];
  const introBeats = 4; // skip the very first few beats so the player gets oriented
  const outroSec = 2.0; // leave the tail note-free

  let subdivision, chordEveryBeats, holdEveryBeats, skipChance;
  if (density === 'sparse') {
    subdivision = 1;      // quarter notes
    chordEveryBeats = 16;
    holdEveryBeats = 0;
    skipChance = 0.15;
  } else if (density === 'dense') {
    subdivision = 2;      // eighth notes
    chordEveryBeats = 6;
    holdEveryBeats = 8;
    skipChance = 0.05;
  } else {
    subdivision = 2;
    chordEveryBeats = 10;
    holdEveryBeats = 0;
    skipChance = 0.12;
  }

  const stepInterval = beatInterval / subdivision;
  const totalBeats = Math.floor((durationSec - outroSec) / beatInterval);
  let prevLane = -1;
  let beatCounter = 0;

  for (let b = introBeats; b < totalBeats; b++) {
    beatCounter++;

    // Occasionally drop a hold note spanning ~2 beats instead of the normal steps
    if (holdEveryBeats && beatCounter % holdEveryBeats === 0) {
      const lane = rngLaneAvoidingRepeat(prevLane);
      const time = offsetSec + b * beatInterval;
      notes.push({ time, lane, type: 'hold', duration: beatInterval * 1.8 });
      prevLane = lane;
      continue;
    }

    for (let s = 0; s < subdivision; s++) {
      if (Math.random() < skipChance) continue;
      const time = offsetSec + b * beatInterval + s * stepInterval;
      const lane = rngLaneAvoidingRepeat(prevLane);
      notes.push({ time, lane, type: 'tap' });
      prevLane = lane;

      // Occasional chord (two simultaneous lanes) for accent beats
      if (s === 0 && beatCounter % chordEveryBeats === 0) {
        let secondLane = rngLaneAvoidingRepeat(lane);
        if (secondLane === lane) secondLane = (lane + 2) % LANES;
        notes.push({ time, lane: secondLane, type: 'tap' });
      }
    }
  }

  notes.sort((a, b) => a.time - b.time);
  return { meta: { title: 'Test Chart', bpm, offset: offsetSec, generated: true }, notes };
}

export function parseChartJSON(text) {
  const data = JSON.parse(text);
  if (!data || !Array.isArray(data.notes)) throw new Error('Chart inválido: falta el array "notes"');
  for (const n of data.notes) {
    if (typeof n.time !== 'number' || typeof n.lane !== 'number') {
      throw new Error('Cada nota necesita "time" y "lane" numéricos');
    }
    if (n.lane < 0 || n.lane >= LANES) throw new Error(`Lane fuera de rango: ${n.lane}`);
    if (!n.type) n.type = 'tap';
  }
  data.notes.sort((a, b) => a.time - b.time);
  return data;
}
