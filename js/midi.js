// Minimal Standard MIDI File (SMF) reader. We only need note on/off events
// and tempo changes — no instruments, no CCs, no SysEx payloads — so a
// small hand-rolled parser is more predictable than pulling in a library
// for a page that otherwise has zero dependencies.

function readVLQ(view, posRef) {
  let value = 0;
  while (true) {
    const b = view.getUint8(posRef.pos++);
    value = (value << 7) | (b & 0x7f);
    if (!(b & 0x80)) break;
  }
  return value;
}

function readString(view, posRef, len) {
  let s = '';
  for (let i = 0; i < len; i++) s += String.fromCharCode(view.getUint8(posRef.pos + i));
  posRef.pos += len;
  return s;
}

function parseTracks(view) {
  const posRef = { pos: 0 };
  if (readString(view, posRef, 4) !== 'MThd') throw new Error('No es un archivo MIDI válido (falta el header MThd).');
  posRef.pos += 4; // header length, always 6
  const format = view.getUint16(posRef.pos); posRef.pos += 2;
  const numTracks = view.getUint16(posRef.pos); posRef.pos += 2;
  const division = view.getUint16(posRef.pos); posRef.pos += 2;
  if (division & 0x8000) throw new Error('Este MIDI usa timecode SMPTE — exporta con "ticks per quarter note" en tu DAW.');
  const ticksPerQuarter = division;

  const tracks = [];
  for (let t = 0; t < numTracks && posRef.pos < view.byteLength; t++) {
    const chunkId = readString(view, posRef, 4);
    const chunkLen = view.getUint32(posRef.pos); posRef.pos += 4;
    const chunkEnd = posRef.pos + chunkLen;
    if (chunkId !== 'MTrk') { posRef.pos = chunkEnd; continue; }

    const events = [];
    let tick = 0;
    let runningStatus = null;

    while (posRef.pos < chunkEnd) {
      tick += readVLQ(view, posRef);
      let statusByte = view.getUint8(posRef.pos);
      if (statusByte & 0x80) { posRef.pos++; runningStatus = statusByte; } else { statusByte = runningStatus; }

      if (statusByte === 0xff) {
        const metaType = view.getUint8(posRef.pos++);
        const len = readVLQ(view, posRef);
        const dataStart = posRef.pos;
        posRef.pos += len;
        if (metaType === 0x51 && len === 3) {
          const usPerQuarter = (view.getUint8(dataStart) << 16) | (view.getUint8(dataStart + 1) << 8) | view.getUint8(dataStart + 2);
          events.push({ tick, type: 'tempo', usPerQuarter });
        }
      } else if (statusByte === 0xf0 || statusByte === 0xf7) {
        const len = readVLQ(view, posRef);
        posRef.pos += len; // sysex payload, skip
      } else {
        const type = statusByte & 0xf0;
        if (type === 0xc0 || type === 0xd0) {
          posRef.pos += 1; // program change / channel pressure: 1 data byte
        } else {
          const d1 = view.getUint8(posRef.pos++);
          const d2 = view.getUint8(posRef.pos++);
          if (type === 0x90) {
            if (d2 === 0) events.push({ tick, type: 'off', pitch: d1 });
            else events.push({ tick, type: 'on', pitch: d1, velocity: d2 });
          } else if (type === 0x80) {
            events.push({ tick, type: 'off', pitch: d1 });
          }
        }
      }
    }
    posRef.pos = chunkEnd;
    tracks.push(events);
  }

  return { tracks, ticksPerQuarter };
}

function makeTickToSeconds(tempoEvents, ticksPerQuarter) {
  let events = tempoEvents.slice().sort((a, b) => a.tick - b.tick);
  if (events.length === 0) events = [{ tick: 0, usPerQuarter: 500000 }]; // default 120bpm
  else if (events[0].tick !== 0) events.unshift({ tick: 0, usPerQuarter: events[0].usPerQuarter });

  return function tickToSeconds(targetTick) {
    let seconds = 0;
    for (let i = 0; i < events.length; i++) {
      const cur = events[i];
      const next = events[i + 1];
      if (cur.tick >= targetTick) break;
      const segEnd = next && next.tick < targetTick ? next.tick : targetTick;
      const ticksInSeg = segEnd - cur.tick;
      seconds += (ticksInSeg / ticksPerQuarter) * (cur.usPerQuarter / 1e6);
      if (!next || next.tick >= targetTick) break;
    }
    return seconds;
  };
}

function pairNotes(tracks) {
  const allEvents = [];
  for (const evts of tracks) for (const e of evts) if (e.type === 'on' || e.type === 'off') allEvents.push(e);
  allEvents.sort((a, b) => a.tick - b.tick);

  const openByPitch = {};
  const pairs = [];
  for (const e of allEvents) {
    if (e.type === 'on') {
      (openByPitch[e.pitch] = openByPitch[e.pitch] || []).push(e.tick);
    } else {
      const stack = openByPitch[e.pitch];
      if (stack && stack.length) {
        const startTick = stack.shift();
        pairs.push({ pitch: e.pitch, startTick, endTick: e.tick });
      }
    }
  }
  return pairs;
}

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
function midiNoteName(n) { return `${NOTE_NAMES[n % 12]}${Math.floor(n / 12) - 1}`; }

const LANE_KEY_LABEL = ['D', 'F', 'J', 'K'];

// Returns { notes, detectedBPM, laneMapping } or throws a user-facing Error.
export async function parseMidiFile(file) {
  const buf = await file.arrayBuffer();
  const view = new DataView(buf);
  const { tracks, ticksPerQuarter } = parseTracks(view);

  const tempoEvents = [];
  for (const evts of tracks) for (const e of evts) if (e.type === 'tempo') tempoEvents.push(e);
  const tickToSeconds = makeTickToSeconds(tempoEvents, ticksPerQuarter);
  const firstQuarterSec = (tempoEvents[0]?.usPerQuarter ?? 500000) / 1e6;
  const detectedBPM = Math.round((60 / firstQuarterSec) * 10) / 10;
  // Anything shorter than ~60% of a beat is a tap; longer is a hold. Using a
  // tempo-relative threshold (instead of a fixed second count) means a
  // normal 8th/16th note stays a tap at any BPM, and only deliberately
  // sustained notes become holds.
  const holdThresholdSec = firstQuarterSec * 0.6;

  const pairs = pairNotes(tracks);
  if (pairs.length === 0) throw new Error('No se encontraron notas en el MIDI.');

  const distinctPitches = [...new Set(pairs.map((p) => p.pitch))].sort((a, b) => a - b);
  if (distinctPitches.length > 4) {
    const names = distinctPitches.map(midiNoteName).join(', ');
    throw new Error(`Se encontraron ${distinctPitches.length} pitches distintos (${names}) — usa exactamente 4.`);
  }

  const pitchToLane = {};
  distinctPitches.forEach((p, i) => { pitchToLane[p] = i; });

  const notes = pairs.map((p) => {
    const startSec = tickToSeconds(p.startTick);
    const endSec = tickToSeconds(p.endTick);
    const duration = Math.max(0, endSec - startSec);
    const lane = pitchToLane[p.pitch];
    return duration > holdThresholdSec
      ? { time: +startSec.toFixed(4), lane, type: 'hold', duration: +duration.toFixed(4) }
      : { time: +startSec.toFixed(4), lane, type: 'tap' };
  });
  notes.sort((a, b) => a.time - b.time);

  const laneMapping = distinctPitches.map((p, i) => `${midiNoteName(p)} → ${LANE_KEY_LABEL[i]}`).join('  ·  ');

  return { notes, detectedBPM, laneMapping };
}
