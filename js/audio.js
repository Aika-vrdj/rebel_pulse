// Thin wrapper around the Web Audio API.
// The whole game's timing is derived from audioContext.currentTime, never
// from setInterval/requestAnimationFrame deltas — that's what keeps notes
// sample-accurate to the music instead of drifting over a 3-4 minute song.

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.buffer = null;
    this.source = null;
    this.analyser = null;
    this.freqData = null;

    this.scheduledStartCtxTime = 0; // ctx.currentTime value at which playback began
    this.pauseOffset = 0;           // how far into the song we were when paused
    this.isPlaying = false;
    this.duration = 0;
  }

  async loadFile(file) {
    if (!this.ctx) this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    const arrayBuffer = await file.arrayBuffer();
    this.buffer = await this.ctx.decodeAudioData(arrayBuffer);
    this.duration = this.buffer.duration;
    return this.duration;
  }

  _makeAnalyser() {
    const analyser = this.ctx.createAnalyser();
    analyser.fftSize = 256;
    analyser.smoothingTimeConstant = 0.82;
    this.freqData = new Uint8Array(analyser.frequencyBinCount);
    return analyser;
  }

  // Starts playback `leadInSec` from now, so the caller has a moment to
  // start its render loop before the first note reaches the hit line.
  start(leadInSec = 0.3) {
    if (this.ctx.state === 'suspended') this.ctx.resume();

    this.source = this.ctx.createBufferSource();
    this.source.buffer = this.buffer;
    this.analyser = this._makeAnalyser();
    this.source.connect(this.analyser);
    this.analyser.connect(this.ctx.destination);

    this.pauseOffset = 0;
    this.scheduledStartCtxTime = this.ctx.currentTime + leadInSec;
    this.source.start(this.scheduledStartCtxTime, 0);
    this.isPlaying = true;
  }

  pause() {
    if (!this.isPlaying) return;
    this.pauseOffset = this.getSongTime();
    this.source.stop();
    this.isPlaying = false;
  }

  resume(leadInSec = 0.05) {
    if (this.isPlaying) return;
    if (this.ctx.state === 'suspended') this.ctx.resume();
    this.source = this.ctx.createBufferSource();
    this.source.buffer = this.buffer;
    if (!this.analyser) this.analyser = this._makeAnalyser();
    this.source.connect(this.analyser);
    this.analyser.connect(this.ctx.destination);
    this.scheduledStartCtxTime = this.ctx.currentTime + leadInSec - this.pauseOffset;
    this.source.start(this.ctx.currentTime + leadInSec, this.pauseOffset);
    this.isPlaying = true;
  }

  stop() {
    if (this.source) {
      try { this.source.stop(); } catch (e) { /* already stopped */ }
    }
    this.isPlaying = false;
  }

  // Jumps playback to an arbitrary point without starting it — used by the
  // chart editor's scrubber. Call resume() afterwards to actually play from here.
  seek(timeSec) {
    if (this.isPlaying) {
      try { this.source.stop(); } catch (e) { /* already stopped */ }
      this.isPlaying = false;
    }
    this.pauseOffset = Math.max(0, Math.min(timeSec, this.duration));
  }

  // Current position in the song, in seconds. Negative during lead-in —
  // callers use this to know notes haven't "started" yet.
  getSongTime() {
    if (!this.ctx) return 0;
    if (!this.isPlaying) return this.pauseOffset;
    return this.ctx.currentTime - this.scheduledStartCtxTime;
  }

  // Average frequency amplitude (0-1), used to drive background pulse.
  getAmplitude() {
    if (!this.analyser) return 0;
    this.analyser.getByteFrequencyData(this.freqData);
    let sum = 0;
    for (let i = 0; i < this.freqData.length; i++) sum += this.freqData[i];
    return sum / this.freqData.length / 255;
  }

  // Bass-focused amplitude (first few bins) — punchier reaction to kicks.
  getBassAmplitude() {
    if (!this.analyser) return 0;
    this.analyser.getByteFrequencyData(this.freqData);
    const bins = Math.max(4, Math.floor(this.freqData.length * 0.08));
    let sum = 0;
    for (let i = 0; i < bins; i++) sum += this.freqData[i];
    return sum / bins / 255;
  }
}
