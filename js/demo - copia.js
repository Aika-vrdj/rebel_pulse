import { AudioEngine } from './audio.js';
import { parseChartJSON } from './chart.js';
import { Game } from './game.js';
import { buildResultsCard, copyCanvasToClipboard, ensureFontsLoaded } from './share.js';

const $ = (id) => document.getElementById(id);

// --- GESTIÓN DE LA INTRO DE VIDEO (ESTILO AAA) ---
function initIntroVideo() {
  const introScreen = $('intro-screen');
  const introVideo = $('intro-video');
  if (!introScreen || !introVideo) return;

  let skipped = false;

  const dismissIntro = () => {
    if (skipped) return;
    skipped = true;
    
    introVideo.pause();
    introScreen.classList.add('hidden');
    
    // Una vez quitada la intro, evaluamos si muestra el auth (nombre de usuario) o directo al setup
    checkUserSession();
  };

  // Evento cuando el video termina solo
  introVideo.addEventListener('ended', dismissIntro);

  // Omitir al hacer clic en cualquier parte del video/pantalla
  introScreen.addEventListener('click', dismissIntro);

  // Omitir al presionar CUALQUIER tecla
  window.addEventListener('keydown', (e) => {
    if (!introScreen.classList.contains('hidden')) {
      // Evitamos interferir si está escribiendo en algún input (aunque en la intro no hay)
      dismissIntro();
    }
  });

  // Intentar reproducir el video con audio si el navegador lo permite
  introVideo.muted = false; // Ponlo en true si el navegador bloquea la reproducción automática con sonido
  introVideo.play().catch(() => {
    // Fallback si la política de autoplay del navegador bloquea el audio: reproducir muteado
    introVideo.muted = true;
    introVideo.play().catch(() => {});
  });
}

// --- SISTEMA GLOBAL DE UI SFX ---
function playUiClick() {
  try {
    const clickAudio = new Audio('click.mp3');
    clickAudio.volume = 0.4; // Volumen moderado para que no sature
    clickAudio.currentTime = 0;
    clickAudio.play().catch(() => {
      // Ignora errores si el navegador bloquea el audio antes de la primera interacción del usuario
    });
  } catch (e) {
    // Falla silenciosa si el archivo aún no existe
  }
}

// Escucha global de clics en los botones del juego
document.addEventListener('click', (e) => {
  // Si el objetivo del clic es un botón o tiene una clase interactiva de menú
  if (e.target.tagName === 'BUTTON' || e.target.classList.contains('menu-btn')) {
    playUiClick();
  }
});

// Función para lanzar confeti dorado en ráfaga cibernética
function triggerVictoryConfetti() {
  // Verificamos si ya cargó el script de confeti, si no, lo inyectamos al vuelo
  if (!window.confetti) {
    const script = document.createElement('script');
    script.src = 'https://cdn.jsdelivr.net/npm/canvas-confetti@1.6.0/dist/confetti.browser.min.js';
    script.onload = () => fireConfettiEffect();
    document.head.appendChild(script);
  } else {
    fireConfettiEffect();
  }
}

function fireConfettiEffect() {
  const duration = 3 * 1000;
  const animationEnd = Date.now() + duration;
  const colors = ['#ffd23f', '#00e5ff', '#b967ff', '#ffffff']; // Colores de tu paleta cyberpunk/oro

  (function frame() {
    confetti({
      particleCount: 4,
      angle: 60,
      spread: 55,
      origin: { x: 0 },
      colors: colors
    });
    confetti({
      particleCount: 4,
      angle: 120,
      spread: 55,
      origin: { x: 1 },
      colors: colors
    });

    if (Date.now() < animationEnd) {
      requestAnimationFrame(frame);
    }
  }());
}

// --- GESTIÓN DE VICTORIA GLOBAL DE LA CAMPAÑA ---
const COMPLETION_KEY = 'rebel_pulse_game_completed';

async function triggerGameCompletionEvent() {
  // 1. Enviar notificación especial a Discord
  if (DISCORD_WEBHOOK_URL && !DISCORD_WEBHOOK_URL.includes('PEGA_AQUÍ')) {
    try {
      await fetch(DISCORD_WEBHOOK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: `🏆⚡ **REBEL // PULSE - GLOBAL VICTORY** ⚡🏆\n**${currentPlayer || 'A Rebel'}** just completed the entire **Rebel Pulse** campaign! All systems breached. Congrats!`
        })
      });
    } catch (err) {
      console.error('Failed to send completion webhook:', err);
    }
  }
}

function showCompletionScreen() {
  show('completion');
  triggerVictoryConfetti();
  
  const summaryEl = $('completion-summary-list');
  
  let html = '<table style="width: 100%; border-collapse: collapse;">';
  html += '<tr style="color: var(--gold); border-bottom: 1px solid rgba(255,210,63,0.3);"><th style="text-align: left; padding: 4px;">TRACK</th><th style="text-align: right; padding: 4px;">BEST ACCURACY</th></tr>';
  
  SONGS.filter(song => isPackOwned(getPackById(song.packId))).forEach(song => {
    html += `<tr style="border-bottom: 1px solid rgba(255,255,255,0.05);">
      <td style="padding: 6px 4px;">${song.title}</td>
      <td style="text-align: right; padding: 6px 4px; color: var(--cyan);">${(song.bestAccuracy || 0).toFixed(1)}%</td>
    </tr>`;
  });
  html += '</table>';
  summaryEl.innerHTML = html;
}

function applyHeroBackground() {
  const heroImageEl = document.querySelector('.hero-bg-image');
  if (!heroImageEl) return;

  // Priority: a newly-unlocked DLC pack's own art (the most exciting, most recent
  // thing) wins over the permanent post-campaign victory look, which wins over the
  // plain default. This is what makes buying a pack feel like unlocking something,
  // not just adding rows to a dropdown.
  const dlcPackWithArt = catalogPacks
    .filter((p) => !p.free && isPackOwned(p) && p.heroBackground)
    .slice(-1)[0];

  if (dlcPackWithArt) {
    heroImageEl.src = dlcPackWithArt.heroBackground;
  } else if (localStorage.getItem(COMPLETION_KEY) === 'true') {
    heroImageEl.src = 'victory_background.png';
  } else {
    heroImageEl.src = 'heroimage.png';
  }
}

// Evento para volver al menú tras ver la victoria
document.addEventListener('DOMContentLoaded', () => {
  const completionBtn = $('completion-menu-btn');
  if (completionBtn) {
    completionBtn.addEventListener('click', () => {
      applyHeroBackground(); // Aplica el cambio de fondo permanente
      show('setup');
    });
  }
});

// --- CONFIGURACIÓN DE DISCORD WEBHOOK ---
const DISCORD_WEBHOOK_URL = 'https://discord.com/api/webhooks/1545462120802680912/KmfPzexXGfWM4z0RfD4IF8DFXI4wXcvJIs1y_P6a0QdbCR441ogzvAfhPuyKvQtbPnOZ';

async function sendDiscordNotification(song, results) {
  if (!DISCORD_WEBHOOK_URL || DISCORD_WEBHOOK_URL.includes('PEGA_AQUÍ')) return;

  const message = {
    content: `⚡ **REBEL // PULSE BROADCAST** ⚡\n**${currentPlayer || 'A Rebel'}** just scored **${results.accuracy.toFixed(2)}%** (Grade: **${results.grade}** - Score: ${Math.floor(results.score)}) on **${song.title}**!\n*The rebellion grows stronger.*`
  };

  try {
    await fetch(DISCORD_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(message)
    });
  } catch (err) {
    console.error('Failed to send Discord webhook:', err);
  }
}

// --- CONFIGURACIÓN DE SUPABASE ---
const SUPABASE_URL = 'https://twyfuamtvdbtbnvbalbe.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InR3eWZ1YW10dmRidGJudmJhbGJlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3MzY0NzY2OTUsImV4cCI6MjA1MjA1MjY5NX0.WElpewiIfSNHNA11YQLfmyo93Jyn8fHg5J_Hdf5N0_A';

async function submitScoreToLeaderboard(songId, score, accuracy) {
  if (!currentPlayer || !SUPABASE_URL.includes('http')) return;

  try {
    const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/upsert_higher_score`, {
      method: 'POST',
      headers: {
        'apikey': SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        p_username: currentPlayer,
        p_song_id: songId,
        p_score: Math.floor(score),
        p_accuracy: parseFloat(accuracy.toFixed(2))
      })
    });

    if (!response.ok) {
      console.error('Error al actualizar high score en Supabase:', await response.text());
    }
  } catch (err) {
    console.error('Fallo de red al conectar con el leaderboard:', err);
  }
}

// --- CONFIGURACIÓN DE ANUNCIOS (MARQUESINA) ---
// Reemplaza esta URL con el enlace público directo a tu archivo .txt en el bucket o servidor
const TICKER_TXT_URL = 'https://twyfuamtvdbtbnvbalbe.supabase.co/storage/v1/object/public/rebel_pulse/announcements.txt';

async function loadDynamicTicker() {
  const tickerEl = $('announcement-ticker');
  if (!tickerEl) return;

  try {
    // Añadimos un parámetro de tiempo aleatorio (?v=...) para evitar que el navegador guarde en caché el texto viejo
    const response = await fetch(`${TICKER_TXT_URL}?v=${Date.now()}`);
    if (!response.ok) throw new Error('Could not fetch announcements');
    
    let text = await response.text();
    text = text.trim().replace(/\n/g, '   ///   '); // Reemplaza saltos de línea por separadores visuales
    
    if (text) {
      // Repetimos el texto varias veces para que la animación de la marquesina sea continua y fluida
      tickerEl.textContent = `${text}   ⚡   ${text}   ⚡   ${text}`;
    }
  } catch (err) {
    console.warn('Using default ticker broadcast due to network error:', err);
    tickerEl.textContent = 'WELCOME TO REBEL // PULSE   ⚡   FIGHT THE SYSTEM   ⚡   JOIN THE DISCORD';
  }
}

// --- GESTIÓN DEL LEADERBOARD MODAL ---

async function openLeaderboard() {
  const modal = $('leaderboard-modal');
  const content = $('lb-content');
  const title = $('lb-title');
  
  if (!currentSong) return;
  
  modal.classList.remove('hidden');
  content.innerHTML = '<p style="color: var(--text-dim);">Connecting to global network...</p>';
  title.textContent = `RANKINGS: ${currentSong.title.toUpperCase()}`;

  try {
    const response = await fetch(`${SUPABASE_URL}/rest/v1/pulse_leaderboard?song_id=eq.${currentSong.id}&order=score.desc&limit=10`, {
      method: 'GET',
      headers: {
        'apikey': SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`
      }
    });

    if (!response.ok) throw new Error('Failed to fetch rankings');

    const data = await response.json();

    if (data.length === 0) {
      content.innerHTML = '<p style="color: var(--text-dim);">No scores recorded yet. Be the first!</p>';
      return;
    }

    let html = '<table style="width: 100%; border-collapse: collapse; text-align: left;">';
    html += '<tr style="border-bottom: 1px solid rgba(185,103,255,0.3); color: var(--violet); font-size: 12px;"><th style="padding: 6px;">#</th><th>REBEL</th><th>SCORE</th><th>ACC</th></tr>';
    
    data.forEach((row, index) => {
      const isMe = row.username === currentPlayer;
      const colorStyle = isMe ? 'color: var(--cyan); font-weight: bold;' : 'color: var(--text);';
      html += `<tr style="border-bottom: 1px solid rgba(255,255,255,0.05); ${colorStyle}">
        <td style="padding: 8px 6px;">${index + 1}</td>
        <td>${row.username}</td>
        <td>${row.score}</td>
        <td>${row.accuracy}%</td>
      </tr>`;
    });
    html += '</table>';
    
    content.innerHTML = html;

  } catch (err) {
    console.error('Error loading leaderboard:', err);
    content.innerHTML = '<p style="color: var(--crimson);">Error connecting to the global network.</p>';
  }
}

// Eventos de los botones del Leaderboard
document.addEventListener('DOMContentLoaded', () => {
  const viewLbBtn = $('view-leaderboard-btn');
  const closeLbBtn = $('close-leaderboard-btn');

  if (viewLbBtn) {
    viewLbBtn.addEventListener('click', openLeaderboard);
  }

  if (closeLbBtn) {
    closeLbBtn.addEventListener('click', () => {
      $('leaderboard-modal').classList.add('hidden');
    });
  }
});

// --- GESTIÓN DE USUARIO ---
const USER_KEY = 'rebel_pulse_username';
let currentPlayer = '';

function checkUserSession() {
  const savedUser = localStorage.getItem(USER_KEY);
  if (!savedUser) {
    show('auth');
  } else {
    currentPlayer = savedUser;
    applyUserGreeting();
    show('setup');
    refreshOwnedPacksFromServer(); // fire-and-forget: DLC songs appear once this resolves
  }
}

function applyUserGreeting() {
  const welcomeEl = $('welcome-message');
  if (welcomeEl) {
    welcomeEl.innerHTML = `Welcome back, <b style="color: var(--cyan); text-shadow: 0 0 10px rgba(0,229,255,0.4);">${currentPlayer}</b>. Pick a track and fight the system.`;
  }
}

// Evento del botón de registro
document.addEventListener('DOMContentLoaded', () => {
  const saveBtn = $('save-user-btn');
  const userinput = $('username-input');

  if (saveBtn && userinput) {
    saveBtn.addEventListener('click', () => {
      const name = userinput.value.trim();
      if (name.length < 2) {
        alert('Please enter a valid alias (at least 2 characters).');
        return;
      }
      currentPlayer = name;
      localStorage.setItem(USER_KEY, currentPlayer);
      applyUserGreeting();
      show('setup');
      refreshOwnedPacksFromServer(); // brand-new alias — almost always empty, harmless
    });
  }
});

// ===================== Song catalog (remote, supports DLC packs) =====================
// The catalog used to be a hardcoded array here. It now lives in catalog.json in the
// same Supabase bucket as announcements.txt, so new song packs — free or paid — can be
// added or updated without touching this file or redeploying the game.
const CATALOG_URL = 'https://twyfuamtvdbtbnvbalbe.supabase.co/storage/v1/object/public/rebel_pulse/catalog.json';

// Packs marked "free" in the catalog are always playable. Paid packs are sold outside
// the game (your store handles checkout); once bought, the pack id gets added here.
const UNLOCKED_PACKS_KEY = 'rebel_pulse_unlocked_packs';

let SONGS = []; // populated at runtime from the catalog, see loadCatalog()
let catalogPacks = []; // raw pack list from catalog.json, kept for ownership lookups
const SCROLL_SPEED = 900;

function getUnlockedPackIds() {
  try {
    return JSON.parse(localStorage.getItem(UNLOCKED_PACKS_KEY) || '[]');
  } catch (e) {
    return [];
  }
}

function saveUnlockedPackIds(ids) {
  localStorage.setItem(UNLOCKED_PACKS_KEY, JSON.stringify(ids));
}

function getPackById(packId) {
  return catalogPacks.find((p) => p.id === packId) || null;
}

function isPackOwned(pack) {
  if (!pack) return false;
  return !!pack.free || getUnlockedPackIds().includes(pack.id);
}

// Lightweight, server-side redemption tied to the player's alias (the same one used
// for the leaderboard) — NOT a general player database, just a pack_id per alias.
// The store handles the actual payment; a code generated at sale time is the bridge
// between "player has a code" and "pack is playable on any device with this alias".
async function redeemPackCode(inputCode) {
  const code = (inputCode || '').trim().toUpperCase();
  if (!code) return { ok: false, message: 'Enter a code.' };
  if (!currentPlayer) return { ok: false, message: 'Set your alias first, then redeem your code.' };

  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/redeem_pack_code`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      },
      body: JSON.stringify({ p_code: code, p_username: currentPlayer }),
    });

    const data = await res.json().catch(() => null);

    if (!res.ok) {
      const reason = (data && (data.message || data.hint)) || '';
      if (reason.includes('invalid_code')) return { ok: false, message: 'Invalid code.' };
      if (reason.includes('code_already_used')) return { ok: false, message: 'This code has already been redeemed.' };
      return { ok: false, message: 'Could not redeem code — try again in a moment.' };
    }

    const packId = Array.isArray(data) ? data[0] && data[0].pack_id : data && data.pack_id;
    if (!packId) return { ok: false, message: 'Invalid code.' };

    // Cache locally too, so ownership still shows instantly on this device even
    // offline/before the next server round trip.
    const owned = getUnlockedPackIds();
    if (!owned.includes(packId)) {
      owned.push(packId);
      saveUnlockedPackIds(owned);
    }

    mergeSongsFromPacks();
    loadCampaignProgress();
    populateSongSelect();
    applyHeroBackground();

    const pack = getPackById(packId);
    return { ok: true, message: `Unlocked "${pack ? pack.title : 'new pack'}"!`, packId };
  } catch (e) {
    return { ok: false, message: 'Network error — check your connection and try again.' };
  }
}

// Pulls this alias's unlocked packs from Supabase, so ownership follows the player
// across devices/browsers instead of living only in this device's localStorage.
async function fetchOwnedPackIdsFromServer(username) {
  if (!username) return [];
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/pulse_pack_unlocks?username=eq.${encodeURIComponent(username)}&select=pack_id`,
      { headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` } }
    );
    if (!res.ok) return [];
    const rows = await res.json();
    return rows.map((r) => r.pack_id);
  } catch (e) {
    console.error('No se pudo sincronizar los packs desbloqueados:', e);
    return [];
  }
}

// Called once the alias is known (returning player or just-created one). Non-blocking
// by design — the setup screen doesn't wait on this, DLC songs just quietly appear in
// the dropdown a moment later if this alias owns any.
async function refreshOwnedPacksFromServer() {
  const remoteIds = await fetchOwnedPackIdsFromServer(currentPlayer);
  if (remoteIds.length > 0) {
    const merged = Array.from(new Set([...getUnlockedPackIds(), ...remoteIds]));
    saveUnlockedPackIds(merged);
  }
  if (catalogPacks.length > 0) {
    mergeSongsFromPacks();
    loadCampaignProgress();
    populateSongSelect();
    applyHeroBackground();
  }
}

// Flattens packs -> SONGS. Reuses and MUTATES existing song objects by id instead of
// creating new ones, so a reference held elsewhere (like `currentSong` while a track
// is loaded or being played) stays valid even if this runs again mid-session — which
// it does, since ownership gets re-synced from the server in the background. Without
// this, a background sync mid-song would silently detach `currentSong` from the live
// SONGS array, and that song's completion would never actually get recorded.
function mergeSongsFromPacks() {
  const existingById = {};
  SONGS.forEach((s) => { existingById[s.id] = s; });

  const flattened = [];
  catalogPacks.forEach((pack) => {
    pack.songs.forEach((songDef) => {
      let song = existingById[songDef.id];

      if (song) {
        // Refresh catalog-provided fields (title, URLs, etc.) but keep this exact
        // object and its live progress — don't let catalog defaults stomp on it.
        const unlocked = song.unlocked;
        const bestAccuracy = song.bestAccuracy;
        Object.assign(song, songDef, {
          packId: pack.id,
          packTitle: pack.title,
          packFree: !!pack.free,
          storeUrl: pack.storeUrl || null,
          unlocked,
          bestAccuracy,
        });
      } else {
        song = {
          ...songDef,
          packId: pack.id,
          packTitle: pack.title,
          packFree: !!pack.free,
          storeUrl: pack.storeUrl || null,
          unlocked: !!songDef.unlocked,
          bestAccuracy: 0,
        };
      }

      flattened.push(song);
    });
  });

  SONGS = flattened;
}

// Forces every song in a not-yet-owned paid pack to be locked, even if it was unlocked
// in saved progress from before (e.g. testing) — ownership always wins over progress.
function applyPackOwnership() {
  SONGS.forEach((song) => {
    if (!isPackOwned(getPackById(song.packId))) {
      song.unlocked = false;
    }
  });
}

async function loadCatalog() {
  setStatus('Fetching song catalog…');
  // Cache-bust the same way the announcement ticker does, so new/updated packs show
  // up without players needing a hard refresh.
  const res = await fetch(`${CATALOG_URL}?v=${Date.now()}`);
  if (!res.ok) throw new Error('Could not fetch the song catalog. Check your connection and reload.');

  const data = await res.json();
  catalogPacks = data.packs || [];
  mergeSongsFromPacks();
}
// ===============================================================================

// --- GESTIÓN DE PROGRESO Y LOCALSTORAGE ---
const PROGRESS_KEY = 'rebel_pulse_progress_v1';

function loadCampaignProgress() {
  try {
    const saved = localStorage.getItem(PROGRESS_KEY);
    if (saved) {
      const data = JSON.parse(saved);
      SONGS.forEach(song => {
        if (data[song.id]) {
          song.unlocked = data[song.id].unlocked;
          song.bestAccuracy = data[song.id].bestAccuracy || 0;
        }
      });
    }
  } catch (e) {
    console.error('Error al cargar el progreso:', e);
  }
  applyPackOwnership();
  evaluatePhaseUnlocks();
}

function saveCampaignProgress() {
  const data = {};
  SONGS.forEach(song => {
    data[song.id] = {
      unlocked: song.unlocked,
      bestAccuracy: song.bestAccuracy || 0
    };
  });
  localStorage.setItem(PROGRESS_KEY, JSON.stringify(data));
}

// Each pack's phase 1 -> 2 -> 3 progression is independent of every other pack's —
// scoped by packId, not just by phase number. Without this, a DLC pack that happens
// to reuse phase numbers 1/2/3 (very likely, since packs are authored independently)
// would silently entangle with Core's progression: an unplayed DLC "phase 1" song
// would block Core's Phase 2 from ever unlocking, and vice versa.
function evaluatePhaseUnlocks() {
  let newlyUnlocked = false;

  catalogPacks.forEach((pack) => {
    if (!isPackOwned(pack)) return;

    const packSongs = SONGS.filter((s) => s.packId === pack.id);
    const maxPhase = packSongs.reduce((max, s) => Math.max(max, s.phase || 1), 1);

    for (let phase = 1; phase < maxPhase; phase++) {
      const phaseSongs = packSongs.filter((s) => s.phase === phase);
      if (phaseSongs.length === 0) continue;

      const phaseCompleted = phaseSongs.every((s) => (s.bestAccuracy || 0) >= 60);
      if (phaseCompleted) {
        packSongs.filter((s) => s.phase === phase + 1).forEach((s) => {
          if (!s.unlocked) { s.unlocked = true; newlyUnlocked = true; }
        });
      }
    }
  });

  saveCampaignProgress();
  return newlyUnlocked;
}



const screens = {
  intro: $('intro-screen'),
  auth: $('auth-screen'),
  setup: $('setup-screen'),
  game: $('game-screen'),
  pause: $('pause-overlay'),
  results: $('results-screen'),
  completion: $('completion-screen'),
};

function show(name) {
  Object.values(screens).forEach((el) => el.classList.add('hidden'));
  screens[name].classList.remove('hidden');
}

const audio = new AudioEngine();
const bgVideo = $('bg-video');
const finalVideo = $('final-video');
let chart = null;
let currentGame = null;
let currentSong = null;
let lastResults = null;
let loadToken = 0;

function setStatus(text, cls) {
  const el = $('demo-status');
  el.textContent = text;
  el.className = 'demo-status' + (cls ? ' ' + cls : '');
}

function setStartButton(disabled, text) {
  const btn = $('start-button');
  btn.disabled = disabled;
  btn.textContent = text;
}

// ---------- Video helpers ----------

function playVideo(el, src) {
  el.classList.remove('video-missing');
  const onError = () => el.classList.add('video-missing');
  el.removeEventListener('error', el._onErrorHandler || (() => {}));
  el._onErrorHandler = onError;
  el.addEventListener('error', onError, { once: true });
  el.src = src;
  el.currentTime = 0;
  el.play().catch(() => {});
}

// ---------- Song dropdown ----------

function populateSongSelect() {
  const select = $('song-select');
  select.innerHTML = '';

  // Only packs the player actually owns get shown at all — no lock icon, no store
  // link, no group header hinting anything else exists. Un-owned DLC packs are
  // invisible: the game should look and play exactly like a Core-only release until
  // a pack is actually unlocked (redeemed), at which point its songs just appear.
  const ownedPacks = catalogPacks.filter((pack) => isPackOwned(pack));

  ownedPacks.forEach((pack) => {
    const packSongs = SONGS.filter((s) => s.packId === pack.id);
    if (packSongs.length === 0) return;

    const group = document.createElement('optgroup');
    group.label = pack.title;

    packSongs.forEach((song) => {
      const opt = document.createElement('option');
      opt.value = song.id;

      if (song.unlocked) {
        opt.textContent = `${song.title} ${song.bestAccuracy ? `(Best: ${song.bestAccuracy.toFixed(1)}%)` : ''}`;
      } else {
        // Locked by campaign progress (phase gating), not by ownership — this still
        // applies within an owned pack, same as it always did.
        opt.textContent = '🔒';
        opt.disabled = true;
      }
      group.appendChild(opt);
    });

    select.appendChild(group);
  });

  select.removeEventListener('change', onSongSelectChange);
  select.addEventListener('change', onSongSelectChange);

  // Rebuilding the <select> resets its visible selection to the first option by
  // default — without this, finishing a song would silently flip the dropdown back
  // to song #1, making it easy to accidentally replay the same song repeatedly
  // instead of progressing (exactly what happened testing phase unlocks).
  if (currentSong && SONGS.some((s) => s.id === currentSong.id)) {
    select.value = currentSong.id;
  }
}

function onSongSelectChange() {
  loadSong($('song-select').value);
}

// Object URLs for the currently-loaded song's videos, so we can revoke them when the
// player switches tracks instead of leaking memory over a long session.
let currentObjectUrls = [];

function revokeCurrentObjectUrls() {
  currentObjectUrls.forEach((url) => URL.revokeObjectURL(url));
  currentObjectUrls = [];
}

// ---------- Loading progress bar ----------
// Self-contained: injects its own styles/markup on first use so no HTML edits are
// needed. Shows real download progress (bytes received vs. Content-Length), falling
// back to an indeterminate animation for assets that don't report a size.

function ensureLoadingBarStyles() {
  if (document.getElementById('loading-bar-styles')) return;
  const style = document.createElement('style');
  style.id = 'loading-bar-styles';
  style.textContent = `
    #song-loading-bar-track {
      width: 100%;
      height: 6px;
      background: rgba(255,255,255,0.08);
      border-radius: 3px;
      overflow: hidden;
      margin-top: 8px;
    }
    #song-loading-bar-fill {
      height: 100%;
      width: 0%;
      background: var(--cyan, #00e5ff);
      transition: width 0.15s ease-out;
    }
    #song-loading-bar-fill.indeterminate {
      width: 35% !important;
      animation: song-loading-indeterminate 1.1s ease-in-out infinite;
    }
    @keyframes song-loading-indeterminate {
      0%   { margin-left: -35%; }
      100% { margin-left: 100%; }
    }
  `;
  document.head.appendChild(style);
}

function ensureLoadingBarEl() {
  ensureLoadingBarStyles();
  let track = $('song-loading-bar-track');
  if (!track) {
    track = document.createElement('div');
    track.id = 'song-loading-bar-track';
    const fill = document.createElement('div');
    fill.id = 'song-loading-bar-fill';
    track.appendChild(fill);

    const statusEl = $('demo-status');
    statusEl.parentNode.insertBefore(track, statusEl.nextSibling);
  }
  return track;
}

// fraction: 0–1 for a known amount, null/undefined for indeterminate, >=1 hides the bar.
function setLoadingProgress(fraction) {
  const track = ensureLoadingBarEl();
  const fill = $('song-loading-bar-fill');

  if (fraction === null || fraction === undefined) {
    track.style.display = 'block';
    fill.classList.add('indeterminate');
    fill.style.width = '';
  } else if (fraction >= 1) {
    fill.classList.remove('indeterminate');
    fill.style.width = '100%';
    setTimeout(() => { track.style.display = 'none'; }, 250);
  } else {
    track.style.display = 'block';
    fill.classList.remove('indeterminate');
    fill.style.width = `${Math.max(2, fraction * 100)}%`;
  }
}

// Downloads a single asset as a Blob while reporting bytes received via onProgress.
// Falls back to a plain (non-streamed) download on browsers without a readable stream
// body, or when the server doesn't expose a byte length — either way, onProgress just
// gets called once at the end instead of incrementally.
async function fetchAssetWithProgress(url, label, onProgress) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Missing ${label} — check the URL in the catalog.`);

  const totalBytes = Number(response.headers.get('Content-Length')) || 0;

  if (!response.body || !response.body.getReader) {
    const blob = await response.blob();
    onProgress(blob.size, blob.size);
    return blob;
  }

  const reader = response.body.getReader();
  const chunks = [];
  let received = 0;

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.byteLength;
    onProgress(received, totalBytes);
  }

  return new Blob(chunks);
}

// Same as above, but for assets that are nice-to-have, not required — a missing
// background/results video shouldn't block a song from loading and playing (it just
// plays without that video, same as before this preload system existed).
async function fetchOptionalAssetWithProgress(url, label, onProgress) {
  try {
    return await fetchAssetWithProgress(url, label, onProgress);
  } catch (err) {
    console.warn(`Optional asset not found, continuing without it — ${label}`);
    onProgress(0, 0); // don't let a missing optional asset stall the progress bar
    return null;
  }
}

async function loadSong(id) {
  const song = SONGS.find((s) => s.id === id);
  if (!song || !song.unlocked) return;

  currentSong = song;
  chart = null;

  const myToken = ++loadToken;
  setStartButton(true, 'LOADING…');
  revokeCurrentObjectUrls();
  setLoadingProgress(0);

  // Tracks bytes received/expected per asset, so the bar reflects true combined
  // download progress across all four files instead of just "asset 1 of 4 done".
  const received = { audio: 0, chart: 0, bgVideo: 0, finalVideo: 0 };
  const totals = { audio: 0, chart: 0, bgVideo: 0, finalVideo: 0 };

  const updateProgress = () => {
    if (myToken !== loadToken) return;
    const receivedBytes = Object.values(received).reduce((a, b) => a + b, 0);
    const totalBytes = Object.values(totals).reduce((a, b) => a + b, 0);

    if (totalBytes > 0) {
      const pct = Math.min(100, Math.round((receivedBytes / totalBytes) * 100));
      setStatus(`Downloading "${song.title}"… ${pct}%`);
      setLoadingProgress(receivedBytes / totalBytes);
    } else {
      setStatus(`Downloading "${song.title}"…`);
      setLoadingProgress(null); // sizes not known yet — show indeterminate
    }
  };

  const trackerFor = (key) => (bytesReceived, bytesTotal) => {
    received[key] = bytesReceived;
    totals[key] = bytesTotal;
    updateProgress();
  };

  try {
    // Fetch all four assets in parallel, streaming each into a Blob (not just pointing
    // <video>/<audio> at the remote URL) so that once loading finishes, the song plays
    // entirely from memory — no mid-song buffering or network jitter that could throw
    // off timing/sync in a precision rhythm game.
    //
    // Audio + chart are required — the game can't play without them. Videos are
    // optional: if a background/results video isn't ready yet for a song, the game
    // should still load and play without it, same as before this preload system existed.
    const [audioBlob, chartBlob, bgVideoBlob, finalVideoBlob] = await Promise.all([
      fetchAssetWithProgress(song.audioUrl, `audio track for "${song.title}"`, trackerFor('audio')),
      fetchAssetWithProgress(song.chartUrl, `chart for "${song.title}"`, trackerFor('chart')),
      fetchOptionalAssetWithProgress(song.bgVideoUrl, `background video for "${song.title}"`, trackerFor('bgVideo')),
      fetchOptionalAssetWithProgress(song.finalVideoUrl, `results video for "${song.title}"`, trackerFor('finalVideo')),
    ]);
    if (myToken !== loadToken) return;

    setStatus(`Preparing "${song.title}"…`);

    // audio.loadFile() expects a fetch Response; wrapping the Blob back into one keeps
    // that interface unchanged while guaranteeing it reads from the in-memory copy.
    await audio.loadFile(new Response(audioBlob));

    const chartText = await chartBlob.text();
    chart = parseChartJSON(chartText);
    if (myToken !== loadToken) return;

    const bgVideoObjectUrl = bgVideoBlob ? URL.createObjectURL(bgVideoBlob) : null;
    const finalVideoObjectUrl = finalVideoBlob ? URL.createObjectURL(finalVideoBlob) : null;
    if (bgVideoObjectUrl) currentObjectUrls.push(bgVideoObjectUrl);
    if (finalVideoObjectUrl) currentObjectUrls.push(finalVideoObjectUrl);
    currentSong.bgVideoObjectUrl = bgVideoObjectUrl;
    currentSong.finalVideoObjectUrl = finalVideoObjectUrl;

    setLoadingProgress(1);
    const missingVideoNote = (!bgVideoObjectUrl || !finalVideoObjectUrl) ? ' (no video yet for this track)' : ', fully cached locally.';
    setStatus(`Ready — ${chart.notes.length} notes loaded${missingVideoNote}`, 'ready');
    setStartButton(false, 'START');
  } catch (err) {
    if (myToken !== loadToken) return;
    const track = $('song-loading-bar-track');
    if (track) track.style.display = 'none';
    setStatus(err.message, 'error');
    setStartButton(true, 'LOAD ERROR');
  }
}

// ---------- Start / countdown / game lifecycle ----------

function wait(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

async function runCountdown() {
  const overlay = $('countdown-overlay');
  const numberEl = $('countdown-number');
  overlay.classList.remove('hidden');
  for (const val of ['3', '2', '1']) {
    numberEl.textContent = val;
    numberEl.classList.remove('countdown-pulse');
    void numberEl.offsetWidth;
    numberEl.classList.add('countdown-pulse');
    await wait(800);
  }
  overlay.classList.add('hidden');
}

$('start-button').addEventListener('click', async () => {
  if (!chart) return;
  await startGame();
});

// Shared by real gameplay and the debug force-finish hotkey below. `debug: true`
// skips reporting side effects (leaderboard submission, Discord pings) so testing
// doesn't pollute the real leaderboard or spam your server — but still runs the
// actual phase-unlock/campaign-completion logic, since that's the point of testing.
function handleSongFinish(results, { debug = false } = {}) {
  bgVideo.pause();
  bgVideo.currentTime = 0;

  let justUnlockedPhase = false;

  if (currentSong) {
    const currentBest = currentSong.bestAccuracy || 0;
    if (results.accuracy > currentBest) {
      currentSong.bestAccuracy = results.accuracy;
      // Persist immediately, not just when a whole phase completes — a single song's
      // improved score shouldn't sit unsaved in memory, vulnerable to being wiped by
      // a page reload or a background ownership sync re-reading stale localStorage.
      saveCampaignProgress();
    }

    justUnlockedPhase = checkPhaseCompletion(currentSong, results.accuracy);

    evaluatePhaseUnlocks();
    populateSongSelect();

    if (!debug) {
      submitScoreToLeaderboard(currentSong.id, results.score, results.accuracy);
      sendDiscordNotification(currentSong, results);
    }

    // --- VERIFICAR SI TERMINÓ TODO EL JUEGO ---
    const ownedSongs = SONGS.filter(s => isPackOwned(getPackById(s.packId)));
    const allDone = ownedSongs.length > 0 && ownedSongs.every(s => (s.bestAccuracy || 0) >= 60);
    if (allDone && !localStorage.getItem(COMPLETION_KEY)) {
      localStorage.setItem(COMPLETION_KEY, 'true'); // was missing — this is what applyHeroBackground() checks
      if (!debug) triggerGameCompletionEvent();
      showCompletionScreen();
      return; // Detenemos el flujo normal para mostrar la pantalla de victoria global
    }
  }

  showResults(results, justUnlockedPhase);
}

// Force-finishes the currently loaded song at exactly 60% accuracy — the campaign
// threshold — without having to actually play it. Skips leaderboard/Discord side
// effects. Not on the setup screen or documented anywhere on purpose: this is a
// dev-only shortcut for testing phase unlocks, not a player-facing feature.
window.addEventListener('keydown', (e) => {
  if (e.ctrlKey && e.shiftKey && e.code === 'KeyF') {
    e.preventDefault();
    if (!currentGame || currentGame.finished) return;

    console.log('⚡ DEBUG: Force-finishing current song at 60% accuracy...');
    currentGame.pause();

    handleSongFinish({
      score: 0,
      accuracy: 60,
      grade: 'DEBUG',
      maxCombo: 0,
      counts: { perfect: 0, great: 0, good: 0, miss: 0 },
    }, { debug: true });
  }
});

async function startGame() {
  show('game');

  if (currentSong.bgVideoObjectUrl) {
    bgVideo.src = currentSong.bgVideoObjectUrl;
    bgVideo.currentTime = 0;
    bgVideo.pause();
  } else {
    // No background video for this track — clear any previous song's video instead
    // of leaving it playing, and don't set a src at all (avoids a bogus 404 request).
    bgVideo.removeAttribute('src');
    bgVideo.load();
  }

  if (currentGame) currentGame.destroy();
  currentGame = new Game($('pixi-container'), audio, {
    onScoreUpdate: ({ score, accuracy }) => {
      $('score-value').textContent = Math.floor(score);
      $('accuracy-value').textContent = accuracy.toFixed(2) + '%';
    },
    onProgress: (fraction) => {
      $('song-progress-fill').style.width = `${Math.min(100, Math.max(0, fraction * 100))}%`;
    },
    onComboMilestone: () => {},
    onFinish: (results) => handleSongFinish(results),
  });

  await currentGame.init();
  if (currentGame.app && currentGame.app.renderer) {
    currentGame.app.resize();
  }
  currentGame.scrollSpeed = SCROLL_SPEED;
  currentGame.loadChart(chart);

  await runCountdown();

  bgVideo.play().catch(() => {});
  currentGame.start();
}

function checkPhaseCompletion(completedSong, accuracy) {
  if (accuracy < 60) return false;

  const currentPhase = completedSong.phase;
  // Scoped to this song's own pack — see evaluatePhaseUnlocks() for why that matters.
  const packSongs = SONGS.filter(s => s.packId === completedSong.packId);
  const phaseSongs = packSongs.filter(s => s.phase === currentPhase);
  const phaseCompleted = phaseSongs.every(s => s === completedSong || (s.bestAccuracy || 0) >= 60);

  if (phaseCompleted) {
    const nextPhaseSongs = packSongs.filter(s => s.phase === currentPhase + 1);
    if (nextPhaseSongs.length > 0 && !nextPhaseSongs[0].unlocked) {
      nextPhaseSongs.forEach(s => s.unlocked = true);
      saveCampaignProgress();
      return true;
    }
  }
  return false;
}

function showResults(results, unlockedNewPhase = false) {
  lastResults = results;
  bgVideo.pause();
  show('results');

  const videoSrc = (currentSong && currentSong.finalVideoObjectUrl) ? currentSong.finalVideoObjectUrl : 'final.mp4';
  playVideo(finalVideo, videoSrc);
  ensureFontsLoaded();

  if ($('results-grade')) $('results-grade').textContent = results.grade || 'S';
  if ($('results-score')) $('results-score').textContent = Math.floor(results.score || 0);
  if ($('results-accuracy')) $('results-accuracy').textContent = (results.accuracy || 0).toFixed(2) + '%';
  if ($('results-combo')) $('results-combo').textContent = results.maxCombo || 0;
  
  if (results.counts) {
    if ($('results-perfect')) $('results-perfect').textContent = results.counts.perfect || 0;
    if ($('results-great')) $('results-great').textContent = results.counts.great || 0;
    if ($('results-good')) $('results-good').textContent = results.counts.good || 0;
    if ($('results-miss')) $('results-miss').textContent = results.counts.miss || 0;
  }

  const unlockBanner = $('unlock-notification');
  if (unlockBanner) {
    if (unlockedNewPhase) {
      unlockBanner.classList.remove('hidden');
      unlockBanner.style.animation = 'pulse 1s infinite alternate';
    } else {
      unlockBanner.classList.add('hidden');
    }
  }
}

// ---------- Pause / resume / quit ----------

$('pause-button').addEventListener('click', () => {
  if (!currentGame || currentGame.finished) return;
  currentGame.pause();
  bgVideo.pause();
  show('pause');
});

window.addEventListener('keydown', (e) => {
  if (e.code === 'Escape' && currentGame && !currentGame.finished) {
    if (screens.pause.classList.contains('hidden')) {
      currentGame.pause();
      bgVideo.pause();
      show('pause');
    } else {
      currentGame.resume();
      bgVideo.play().catch(() => {});
      show('game');
    }
  }
});

$('resume-button').addEventListener('click', () => {
  currentGame.resume();
  bgVideo.play().catch(() => {});
  show('game');
});

$('restart-button').addEventListener('click', async () => {
  await startGame();
});

$('quit-button').addEventListener('click', () => {
  if (currentGame) currentGame.destroy();
  currentGame = null;
  bgVideo.pause();
  show('setup');
});

$('results-restart').addEventListener('click', async () => {
  finalVideo.pause();
  await startGame();
});

$('results-menu').addEventListener('click', () => {
  if (currentGame) currentGame.destroy();
  currentGame = null;
  finalVideo.pause();
  show('setup');
});

window.addEventListener('keydown', (e) => {
  if (e.ctrlKey && e.shiftKey && e.code === 'KeyV') {
    e.preventDefault();
    console.log('⚡ MODO PRUEBA: Forzando victoria global de campaña...');
    
    // 1. Simulamos que todas las canciones tienen 100% de precisión en el almacenamiento local
    SONGS.forEach(song => {
      song.bestAccuracy = 100;
    });
    saveCampaignProgress();
    
    // 2. Marcamos el juego como completado y aplicamos el cambio de skin (heroimage -> victory_background)
    localStorage.setItem(COMPLETION_KEY, 'true');
    applyHeroBackground();
    
    // 3. Disparamos el evento de victoria y mostramos la pantalla
    triggerGameCompletionEvent();
    showCompletionScreen();
  }
});

// ---------- Share (real PNG to clipboard) ----------
 
$('results-share').addEventListener('click', () => {
  if (!lastResults) return;

  const flashAudio = new Audio('flash.mp3');
  flashAudio.volume = 0.8;
  flashAudio.play().catch(() => {});
 
  const trackTitle = currentSong ? currentSong.title : 'REBEL TRACK';
  const canvas = buildResultsCard({ ...lastResults, trackTitle });
 
  const btn = $('results-share');
  const originalText = btn.textContent;
 
  copyCanvasToClipboard(canvas)
    .then((method) => {
      btn.textContent = method === 'clipboard' ? '✅ Copied to clipboard!' : '⬇️ Downloaded';
      setTimeout(() => { btn.textContent = originalText; }, 1800);
    })
    .catch((err) => {
      console.error('Share image failed:', err);
      btn.textContent = '⚠️ Copy failed';
      setTimeout(() => { btn.textContent = originalText; }, 1800);
    });
});

// ---------- Boot ----------
async function boot() {
  try {
    await loadCatalog();
    loadCampaignProgress();
    populateSongSelect();

    const firstPlayable = SONGS.find((s) => s.unlocked);
    if (firstPlayable) {
      loadSong(firstPlayable.id);
    } else {
      setStatus('No songs unlocked yet.', 'error');
    }
  } catch (e) {
    console.error('Error durante la inicialización del boot:', e);
    setStatus(e.message || 'Failed to load the song catalog.', 'error');
  }

  loadDynamicTicker();
  applyHeroBackground();
  refreshOwnedPacksFromServer(); // no-op if currentPlayer isn't set yet
}

// El video de intro arranca de inmediato para no bloquear la UX; el catálogo se carga
// en paralelo y ya debería estar listo (o casi) para cuando el jugador llegue al setup.
// ---------- Redeem code UI ----------
// Deliberately understated: a small "Have a code?" toggle rather than a prominent
// field, so the setup screen still reads as Core-only until someone actually has a
// pack to redeem.
function ensureRedeemUI() {
  if ($('redeem-toggle')) return;

  const style = document.createElement('style');
  style.id = 'redeem-ui-styles';
  style.textContent = `
    #redeem-toggle {
      display: inline-block;
      margin-top: 14px;
      font-size: 11px;
      color: rgba(255,255,255,0.4);
      cursor: pointer;
      text-decoration: underline dotted;
    }
    #redeem-panel {
      display: none;
      gap: 6px;
      margin-top: 8px;
    }
    #redeem-panel.open { display: flex; }
    #redeem-code-input {
      flex: 1;
      background: rgba(0,0,0,0.4);
      border: 1px solid rgba(255,255,255,0.15);
      color: #fff;
      padding: 6px 8px;
      font-size: 12px;
      border-radius: 3px;
    }
    #redeem-message {
      font-size: 11px;
      margin-top: 6px;
      min-height: 14px;
    }
    #redeem-message.error { color: #ff5c5c; }
    #redeem-message.success { color: var(--cyan, #00e5ff); }
  `;
  document.head.appendChild(style);

  const panel = document.createElement('div');
  panel.id = 'redeem-panel';

  const input = document.createElement('input');
  input.id = 'redeem-code-input';
  input.type = 'text';
  input.placeholder = 'Enter code';
  input.maxLength = 32;
  input.autocomplete = 'off';

  const button = document.createElement('button');
  button.id = 'redeem-code-btn';
  button.className = 'menu-btn';
  button.style.fontSize = '11px';
  button.style.padding = '6px 12px';
  button.textContent = 'Redeem';

  panel.appendChild(input);
  panel.appendChild(button);

  const message = document.createElement('div');
  message.id = 'redeem-message';

  const toggle = document.createElement('div');
  toggle.id = 'redeem-toggle';
  toggle.textContent = 'Have a code?';
  toggle.addEventListener('click', () => {
    panel.classList.toggle('open');
    if (panel.classList.contains('open')) input.focus();
  });

  const doRedeem = async () => {
    button.disabled = true;
    message.className = '';
    message.textContent = 'Checking…';

    const result = await redeemPackCode(input.value);

    message.textContent = result.message;
    message.className = result.ok ? 'success' : 'error';
    button.disabled = false;
    if (result.ok) input.value = '';
  };

  button.addEventListener('click', doRedeem);
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') doRedeem(); });

  const panelEl = document.querySelector('.setup-panel');
  if (panelEl) {
    panelEl.appendChild(toggle);
    panelEl.appendChild(panel);
    panelEl.appendChild(message);
  }
}

boot();
initIntroVideo();
ensureRedeemUI();