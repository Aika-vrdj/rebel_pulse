import * as PIXI from 'pixi.js';
import { spawnParticleBurst, laneFlash, judgmentPopup, screenShake, pulse } from './effects.js';

const KEY_TO_LANE = { KeyD: 0, KeyF: 1, KeyJ: 2, KeyK: 3 };
const LANE_COLORS = [0xff2d55, 0x00e5ff, 0xb967ff, 0xffd23f]; // crimson, cyan, violet, gold
const LANE_KEY_LABEL = ['D', 'F', 'J', 'K'];

// Judgment windows, in seconds either side of the note's exact time.
const WINDOW_PERFECT = 0.030;
const WINDOW_GREAT = 0.060;
const WINDOW_GOOD = 0.100;
const HOLD_RELEASE_WINDOW = 0.100;

const JUDGMENT_SCORE = { perfect: 300, great: 100, good: 50, miss: 0 };

// Announcer voice-line clips (hello1/2/3, cheer1/2/3, streak1-4) are local files
// alongside demo.html, unrelated to the per-song catalog audio. This is the one
// place their extension is decided — change it here if you convert those files to
// a different format, instead of a hardcoded string buried in _playRandomVoice().
const VOICE_LINE_EXT = '.mp3';
const JUDGMENT_WEIGHT = { perfect: 1.0, great: 0.7, good: 0.4, miss: 0 };
const JUDGMENT_COLOR = { perfect: 0xffd23f, great: 0x00e5ff, good: 0xb967ff, miss: 0xff2d55 };

export class Game {
  constructor(pixiContainerEl, audioEngine, callbacks) {
    this.mountEl = pixiContainerEl;
    this.audio = audioEngine;
    this.callbacks = callbacks || {};
    this.scrollSpeed = 900; // px/sec
    this.chart = null;
    this.notes = [];
    this.laneWidth = 120;
    this.hitLineY = 0;
    this.holdState = [null, null, null, null];

    this.score = 0;
    this.streakScore = 0; // <--- Inicializado
    this.combo = 0;
    this.maxCombo = 0;
    this.counts = { perfect: 0, great: 0, good: 0, miss: 0 };
    this.judgedCount = 0;

    this.lastCheerTime = 0;
    this.nextCheerInterval = 35; // Se ajustará de forma aleatoria entre 30 y 40 seg
    this.hasWelcomed = false;
    this.lastStreakMilestone = 0; // Para llevar el conteo de los hitos de racha (5000, 10000, 20000...)
    this.lastStreakActiveState = false; // Detecta el momento exacto en que cruza el umbral de racha

    this.running = false;
    this.finished = false;

    this._onKeyDown = this._onKeyDown.bind(this);
    this._onKeyUp = this._onKeyUp.bind(this);
  }

  async init() {
    this.app = new PIXI.Application();
    await this.app.init({
      resizeTo: this.mountEl,
      backgroundAlpha: 0,
      antialias: true,
    });
    this.mountEl.appendChild(this.app.canvas);

    this.stage = new PIXI.Container();
    this.app.stage.addChild(this.stage);

    this.bgLayer = new PIXI.Container();
    this.laneLayer = new PIXI.Container();
    this.noteLayer = new PIXI.Container();
    this.fxLayer = new PIXI.Container();
    this.stage.addChild(this.bgLayer, this.laneLayer, this.noteLayer, this.fxLayer);

    this._layout();
    this._buildLaneVisuals();
    this._buildNoteTexture();
    this._buildStreakDisplay();

    this._onResize = () => { this._layout(); this._buildLaneVisuals(); this._repositionNotes(); };
    window.addEventListener('resize', this._onResize);
  }

  _playRandomVoice(prefix, maxCount) {
    if (!this.running || this.finished) return;
    const randomIndex = Math.floor(Math.random() * maxCount) + 1;
    const audioFileName = `${prefix}${randomIndex}${VOICE_LINE_EXT}`;
    
    const voiceAudio = new Audio(audioFileName);
    voiceAudio.volume = 0.7; // Ajusta el volumen a tu gusto
    voiceAudio.play().catch(() => {
      // Silencia errores si el navegador bloquea autoplay sin interacción previa (aunque ya hubo clic en Start)
    });
  }

  _layout() {
    const w = this.app.screen.width;
    const h = this.app.screen.height;
    this.hitLineY = h * 0.82;
    this.playfieldWidth = this.laneWidth * 4;
    this.playfieldX = (w - this.playfieldWidth) / 2;
    
    if (this.streakContainer) {
      this.streakContainer.x = w / 2;
      this.streakContainer.y = h * 0.45;
    }
  }

  _buildLaneVisuals() {
    this.laneLayer.removeChildren();
    this.bgLayer.removeChildren();

    // Ambient reactive glow behind the playfield
    this.bgGlow = new PIXI.Graphics();
    this.bgLayer.addChild(this.bgGlow);

    const h = this.app.screen.height;

    for (let i = 0; i < 4; i++) {
      const x = this.playfieldX + i * this.laneWidth;

      const laneBg = new PIXI.Graphics();
      laneBg.rect(0, 0, this.laneWidth, h).fill({ color: LANE_COLORS[i], alpha: 0.035 });
      laneBg.x = x;
      this.laneLayer.addChild(laneBg);

      const divider = new PIXI.Graphics();
      divider.rect(0, 0, 1, h).fill({ color: 0xffffff, alpha: 0.06 });
      divider.x = x;
      this.laneLayer.addChild(divider);
    }
    // right edge divider
    const rightDivider = new PIXI.Graphics();
    rightDivider.rect(0, 0, 1, h).fill({ color: 0xffffff, alpha: 0.06 });
    rightDivider.x = this.playfieldX + this.playfieldWidth;
    this.laneLayer.addChild(rightDivider);

    // Hit line + per-lane key labels + press-glow placeholders
    this.hitLine = new PIXI.Graphics();
    this.hitLine.rect(this.playfieldX, this.hitLineY, this.playfieldWidth, 3).fill({ color: 0xffffff, alpha: 0.85 });
    this.laneLayer.addChild(this.hitLine);

    this.laneKeyCaps = [];
    for (let i = 0; i < 4; i++) {
      const x = this.playfieldX + i * this.laneWidth + this.laneWidth / 2;
      const cap = new PIXI.Graphics();
      cap.roundRect(-26, -26, 52, 52, 8).stroke({ width: 2, color: LANE_COLORS[i], alpha: 0.8 });
      cap.x = x;
      cap.y = this.hitLineY + 40;
      const label = new PIXI.Text({
        text: LANE_KEY_LABEL[i],
        style: { fontFamily: 'Orbitron', fontSize: 20, fontWeight: '700', fill: LANE_COLORS[i] },
      });
      label.anchor.set(0.5);
      label.x = x;
      label.y = this.hitLineY + 40;
      this.laneLayer.addChild(cap, label);
      this.laneKeyCaps.push(cap);
    }
  }

  _buildStreakDisplay() {
    this.streakContainer = new PIXI.Container();
    this.streakContainer.x = this.app.screen.width / 2;
    this.streakContainer.y = this.app.screen.height * 0.45;
    this.streakContainer.visible = false;
    this.stage.addChild(this.streakContainer);

    this.streakText = new PIXI.Text({
      text: '0',
      style: {
        fontFamily: 'Orbitron',
        fontSize: 54,
        fontWeight: '900',
        fill: 0xffd23f,
        align: 'center',
        letterSpacing: 4,
      },
    });
    this.streakText.anchor.set(0.5);
    this.streakText.blendMode = 'add';
    this.streakContainer.addChild(this.streakText);
  }

  _buildNoteTexture() {
    const g = new PIXI.Graphics();
    g.roundRect(0, 0, this.laneWidth - 20, 18, 6).fill({ color: 0xffffff });
    this.noteTexture = this.app.renderer.generateTexture(g);
    g.destroy();
  }

  _repositionNotes() {
    if (!this.notes) return;
    for (const note of this.notes) {
      note.display.x = this.playfieldX + note.lane * this.laneWidth + 10;
    }
  }

  loadChart(chart) {
    this.chart = chart;
    this.noteLayer.removeChildren();
    this.notes = chart.notes.map((n) => {
      const laneX = this.playfieldX + n.lane * this.laneWidth + 10;
      let display;
      if (n.type === 'hold') {
        display = new PIXI.Graphics();
      } else {
        display = new PIXI.Sprite(this.noteTexture);
        display.tint = LANE_COLORS[n.lane];
      }
      display.x = laneX;
      display.visible = false;
      this.noteLayer.addChild(display);
      return { ...n, judged: false, holdActive: false, holdSuccess: false, display };
    });
  }

  start() {
    this.running = true;
    this.finished = false;
    this.score = 0;
    this.streakScore = 0; // <--- Reseteo al iniciar partida
    this.combo = 0;
    this.maxCombo = 0;
    this.counts = { perfect: 0, great: 0, good: 0, miss: 0 };
    this.judgedCount = 0;
    this.holdState = [null, null, null, null];

    window.addEventListener('keydown', this._onKeyDown);
    window.addEventListener('keyup', this._onKeyUp);

    this.audio.start(0.35);
    this.app.ticker.add(this._tick, this);
    this.lastCheerTime = 0;
    
    this.nextCheerInterval = 30 + Math.random() * 10; // Entre 30 y 40 segundos
    this.hasWelcomed = false;
    this.lastStreakMilestone = 0;
    this.lastStreakActiveState = false;

    // Programar el saludo inicial (ej. a los 2.5 segundos de arrancar la canción)
    setTimeout(() => {
      if (this.running && !this.finished) {
        this._playRandomVoice('hello', 3); 
      }
    }, 2500);
  }

  pause() {
    this.running = false;
    this.audio.pause();
  }

  resume() {
    this.running = true;
    this.audio.resume();
  }

  destroy() {
    window.removeEventListener('keydown', this._onKeyDown);
    window.removeEventListener('keyup', this._onKeyUp);
    if (this._onResize) window.removeEventListener('resize', this._onResize);
    this.app.ticker.remove(this._tick, this);
    this.audio.stop();

    if (this.app.canvas && this.app.canvas.parentNode) {
      this.app.canvas.parentNode.removeChild(this.app.canvas);
    }
    this.app.destroy(true, { children: true, texture: true });
  }

  _tick() {
    if (!this.running) return;
    const songTime = this.audio.getSongTime();

    this._updateNotes(songTime);
    this._updateBackground();
    this._checkAutoMiss(songTime);
    this._updateStreakDisplay();

    // --- 1. RANDOM CHEER (Cada 30-40 segundos) ---
    if (songTime - this.lastCheerTime > this.nextCheerInterval) {
      this._playRandomVoice('cheer', 3); 
      this.lastCheerTime = songTime;
      this.nextCheerInterval = 30 + Math.random() * 10; // Nuevo intervalo aleatorio
    }

    // --- 2. AUDIO DE RACHA ---
    const isStreakActive = this.streakContainer && this.streakContainer.visible;
    
    // Detecta el instante exacto en que se enciende la racha por primera vez
    if (isStreakActive && !this.lastStreakActiveState) {
      this._playRandomVoice('streak', 4); 
      this.lastStreakMilestone = 5000; // Siguiente hito a buscar
    }

    // Control de hitos de puntaje de racha (5000, 10000, 20000, 30000...)
    if (isStreakActive) {
      if (this.streakScore >= 10000 && this.lastStreakMilestone === 5000) {
        this._playRandomVoice('streak', 3);
        this.lastStreakMilestone = 10000;
      } else if (this.streakScore >= this.lastStreakMilestone + 10000 && this.lastStreakMilestone >= 10000) {
        this._playRandomVoice('streak', 3);
        this.lastStreakMilestone += 10000;
      }
    }

    this.lastStreakActiveState = isStreakActive;
    
    const totalDur = this.audio.duration;
    if (this.callbacks.onProgress) this.callbacks.onProgress(Math.max(0, songTime) / totalDur);

    if (songTime > totalDur + 0.5 && !this.finished) {
      this._finish();
    }
  }

  _updateStreakDisplay() {
    if (!this.streakContainer) return;

    const MIN_COMBO_TO_SHOW = 10;

    if (this.combo >= MIN_COMBO_TO_SHOW) {
      this.streakContainer.visible = true;
      this.streakText.text = Math.floor(this.streakScore);

      // --- TOPE ESTRICTO DE VIBRACIÓN ---
      // Limitamos el combo virtual a un máximo de 60 para que la vibración jamás rebase una intensidad segura y legible
      const cappedCombo = Math.min(this.combo, 60); 
      const intensityFactor = cappedCombo / 60; // Llega a 1.0 y se detiene para siempre ahí

      const shakeSpeed = 30;
      const offsetX = (Math.sin(Date.now() / 100 * shakeSpeed) * 3) * intensityFactor;
      const offsetY = (Math.cos(Date.now() / 100 * shakeSpeed) * 3) * intensityFactor;
      
      this.streakText.x = offsetX;
      this.streakText.y = offsetY;

      const pulseScale = 1 + (Math.sin(Date.now() / 150) * 0.04 * intensityFactor);
      this.streakText.scale.set(pulseScale);
    } else {
      this.streakContainer.visible = false;
      this.streakScore = 0;
    }
  }

  _updateNotes(songTime) {
    const speed = this.scrollSpeed;
    for (const note of this.notes) {
      if (note.judged && note.type !== 'hold') continue;
      if (note.type === 'hold' && note.judged && !note.holdActive) continue;

      const headOffset = note.time - songTime;
      const visibleWindow = (this.hitLineY / speed) + 0.6;
      if (headOffset > visibleWindow) { note.display.visible = false; continue; }

      const yBottom = this.hitLineY - headOffset * speed;

      if (note.type === 'hold') {
        const barHeight = note.duration * speed;
        const yTop = yBottom - barHeight;
        const g = note.display;
        g.clear();
        const color = LANE_COLORS[note.lane];
        
        const isActive = note.holdActive;
        const alpha = isActive ? 0.95 : 0.55;
        
        g.roundRect(0, Math.min(yTop, yBottom), this.laneWidth - 20, Math.abs(barHeight), 6)
          .fill({ color, alpha });

        if (isActive) {
          const pulseEffect = 0.3 + Math.sin(songTime * 25) * 0.15;
          g.roundRect(-2, Math.min(yTop, yBottom) - 2, this.laneWidth - 16, Math.abs(barHeight) + 4, 8)
            .stroke({ width: 3, color: 0xffffff, alpha: 0.6 + pulseEffect });
        }

        g.visible = true;
      } else {
        note.display.y = yBottom;
        note.display.visible = true;
      }
    }
  }

  _updateBackground() {
    const amp = this.audio.getBassAmplitude();
    const w = this.app.screen.width, h = this.app.screen.height;
    this.bgGlow.clear();
    
    const borderWidth = 3 + (amp * 10);
    const borderAlpha = 0.15 + (amp * 0.4);
    
    this.bgGlow.rect(0, 0, w, h)
      .stroke({ width: borderWidth, color: 0xb967ff, alpha: borderAlpha });
  }

  _checkAutoMiss(songTime) {
    for (const note of this.notes) {
      if (note.judged) continue;

      if (note.type === 'tap') {
        if (songTime - note.time > WINDOW_GOOD) this._judge(note, 'miss', songTime);
      } else if (note.type === 'hold') {
        if (!note.holdActive && songTime - note.time > WINDOW_GOOD) {
          this._judge(note, 'miss', songTime);
        } else if (note.holdActive) {
          const tailTime = note.time + note.duration;
          if (songTime - tailTime > HOLD_RELEASE_WINDOW) {
            this._completeHold(note, songTime);
          }
        }
      }
    }
  }

  _onKeyDown(e) {
    if (!(e.code in KEY_TO_LANE)) return;
    if (e.repeat) return;
    const lane = KEY_TO_LANE[e.code];
    this._flashLane(lane, 0.35);
    if (!this.running) return;

    const songTime = this.audio.getSongTime();
    const candidate = this._findNearestUnjudged(lane, songTime);
    if (!candidate) return;

    const diff = Math.abs(candidate.time - songTime);
    if (diff > WINDOW_GOOD) return;

    const judgment = this._judgmentForDiff(diff);

    if (candidate.type === 'hold') {
      candidate.holdActive = true;
      candidate.headJudgment = judgment;
      this.holdState[lane] = candidate;
      this._flashLane(lane, 0.7);
      this._judge(candidate, judgment, songTime);
    } else {
      this._judge(candidate, judgment, songTime);
    }
  }

  _onKeyUp(e) {
    if (!(e.code in KEY_TO_LANE)) return;
    const lane = KEY_TO_LANE[e.code];
    const active = this.holdState[lane];
    if (!active) return;

    const songTime = this.audio.getSongTime();
    const tailTime = active.time + active.duration;
    if (tailTime - songTime > HOLD_RELEASE_WINDOW) {
      active.holdActive = false;
      this._judge(active, 'miss', songTime);
    } else {
      this._completeHold(active, songTime);
    }
    this.holdState[lane] = null;
  }

  _completeHold(note, songTime) {
    note.holdActive = false;
    note.judged = true; // <--- Marca la nota como completamente terminada para que deje de renderizarse
    if (note.display) {
      note.display.visible = false; // <--- Oculta visualmente la barra larga de inmediato
    }
    this.holdState[note.lane] = null;
  }

  _findNearestUnjudged(lane, songTime) {
    let best = null, bestDiff = Infinity;
    for (const n of this.notes) {
      if (n.judged || n.lane !== lane) continue;
      if (n.type === 'hold' && n.holdActive) continue;
      const diff = Math.abs(n.time - songTime);
      if (diff < bestDiff) { bestDiff = diff; best = n; }
    }
    return best;
  }

  _judgmentForDiff(diff) {
    if (diff <= WINDOW_PERFECT) return 'perfect';
    if (diff <= WINDOW_GREAT) return 'great';
    return 'good';
  }

  _judge(note, judgment, songTime) {
    note.judged = true;
    note.display.visible = false;

    this.counts[judgment]++;
    this.judgedCount++;
    
    // El score global de la esquina superior izquierda sigue sumando normalmente
    this.score += JUDGMENT_SCORE[judgment];

    if (judgment === 'miss') {
      // --- MARGEN DE TOLERANCIA PARA LA RACHA ---
      // En lugar de romper la racha de inmediato, restamos combo o aplicamos tolerancia
      this.combo = Math.max(0, this.combo - 5); // Penaliza 5 puntos de combo en lugar de matarlo de golpe
      this.streakScore = Math.max(0, this.streakScore - 150); // Resta una penalización de puntos

      // Solo si el combo cae por debajo del umbral mínimo (ej. menor a 5 o 10), la racha muere oficialmente
      if (this.combo < 5) {
        this.combo = 0;
        this.streakScore = 0; 
      }

      screenShake(this.app, this.stage, 6, 10);
    } else {
      this.combo++;
      // El contador central suma los puntos del acierto
      this.streakScore += JUDGMENT_SCORE[judgment]; 
      
      this.maxCombo = Math.max(this.maxCombo, this.combo);
      if (this.combo > 0 && this.combo % 25 === 0 && this.callbacks.onComboMilestone) {
        this.callbacks.onComboMilestone(this.combo);
      }
    }

    const laneX = this.playfieldX + note.lane * this.laneWidth + this.laneWidth / 2;
    judgmentPopup(this.app, this.fxLayer, laneX, this.hitLineY - 60, judgment.toUpperCase(), JUDGMENT_COLOR[judgment]);
    if (judgment !== 'miss') {
      spawnParticleBurst(this.app, this.fxLayer, laneX, this.hitLineY, LANE_COLORS[note.lane], judgment === 'perfect' ? 18 : 12);
    }

    this._updateHUD();
  }

  _flashLane(lane, intensity) {
    const x = this.playfieldX + lane * this.laneWidth;
    laneFlash(this.app, this.fxLayer, x, this.laneWidth, this.app.screen.height, LANE_COLORS[lane], intensity);
    pulse(this.app, this.laneKeyCaps[lane], 1.3, 10);
  }

  _updateHUD() {
    const totalWeight = Object.keys(this.counts).reduce(
      (sum, k) => sum + this.counts[k] * JUDGMENT_WEIGHT[k], 0
    );
    const accuracy = this.judgedCount > 0 ? (totalWeight / this.judgedCount) * 100 : 100;
    if (this.callbacks.onScoreUpdate) {
      this.callbacks.onScoreUpdate({ score: this.score, accuracy, combo: this.combo });
    }
  }

  _finish() {
    this.finished = true;
    this.running = false;
    this.audio.stop();
    const totalWeight = Object.keys(this.counts).reduce(
      (sum, k) => sum + this.counts[k] * JUDGMENT_WEIGHT[k], 0
    );
    const accuracy = this.judgedCount > 0 ? (totalWeight / this.judgedCount) * 100 : 100;
    let grade = 'D';
    if (accuracy >= 95) grade = 'S';
    else if (accuracy >= 90) grade = 'A';
    else if (accuracy >= 80) grade = 'B';
    else if (accuracy >= 70) grade = 'C';

    if (this.callbacks.onFinish) {
      this.callbacks.onFinish({
        score: this.score,
        accuracy,
        maxCombo: this.maxCombo,
        counts: this.counts,
        grade,
      });
    }
  }
}
