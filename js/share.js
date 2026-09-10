// Draws a shareable "results card" on an offscreen canvas and copies it to
// the clipboard as a real image/png — not a DOM screenshot. We do it this
// way on purpose: the results screen has a <video> background, and browsers
// block canvas-based screenshots of the page from reading video frames
// (tainted canvas / CORS), so a literal screenshot is unreliable. Drawing
// our own branded card sidesteps that entirely and always looks the same.

const COLORS = {
  bg1: '#0a0710',
  bg2: '#1c1530',
  crimson: '#ff2d55',
  cyan: '#00e5ff',
  violet: '#b967ff',
  gold: '#ffd23f',
  text: '#f2eef9',
  textDim: '#9086a8',
};

let fontsReadyPromise = null;

// Call this early (e.g. when the results screen appears) so the custom
// fonts are already loaded by the time the user taps "share".
export function ensureFontsLoaded() {
  if (!fontsReadyPromise) {
    fontsReadyPromise = Promise.all([
      document.fonts.load('700 40px Orbitron'),
      document.fonts.load('900 260px Orbitron'),
      document.fonts.load('700 46px Orbitron'),
      document.fonts.load('600 26px Rajdhani'),
    ]).catch(() => {});
  }
  return fontsReadyPromise;
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function statBlock(ctx, label, value, x, y, color) {
  ctx.textAlign = 'center';
  ctx.font = '700 16px Orbitron';
  ctx.fillStyle = COLORS.textDim;
  ctx.fillText(label, x, y);
  ctx.font = '700 46px Orbitron';
  ctx.fillStyle = color || COLORS.text;
  ctx.fillText(value, x, y + 52);
}

// data: { grade, score, accuracy, maxCombo, counts:{perfect,great,good,miss}, trackTitle }
export function buildResultsCard(data) {
  const W = 1080, H = 1080;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');

  // Background
  const bgGrad = ctx.createLinearGradient(0, 0, W, H);
  bgGrad.addColorStop(0, COLORS.bg1);
  bgGrad.addColorStop(1, COLORS.bg2);
  ctx.fillStyle = bgGrad;
  ctx.fillRect(0, 0, W, H);

  // Ambient glow blobs
  ctx.save();
  ctx.filter = 'blur(90px)';
  ctx.fillStyle = 'rgba(255,45,85,0.35)';
  ctx.beginPath(); ctx.arc(150, 120, 220, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = 'rgba(0,229,255,0.22)';
  ctx.beginPath(); ctx.arc(950, 950, 260, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = 'rgba(185,103,255,0.28)';
  ctx.beginPath(); ctx.arc(950, 140, 200, 0, Math.PI * 2); ctx.fill();
  ctx.restore();

  // Faint grid
  ctx.strokeStyle = 'rgba(185,103,255,0.06)';
  ctx.lineWidth = 1;
  for (let x = 0; x < W; x += 54) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke(); }
  for (let y = 0; y < H; y += 54) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }

  // Brand + track title
  ctx.textAlign = 'center';
  ctx.shadowColor = COLORS.crimson;
  ctx.shadowBlur = 20;
  ctx.font = '700 40px Orbitron';
  ctx.fillStyle = COLORS.text;
  ctx.fillText('REBEL // PULSE', W / 2, 110);
  ctx.shadowBlur = 0;

  if (data.trackTitle) {
    ctx.font = '600 30px Rajdhani';
    ctx.fillStyle = COLORS.textDim;
    ctx.fillText(data.trackTitle.toUpperCase(), W / 2, 155);
  }

  // Grade
  const gradeGrad = ctx.createLinearGradient(W / 2 - 150, 0, W / 2 + 150, 0);
  gradeGrad.addColorStop(0, COLORS.gold);
  gradeGrad.addColorStop(1, COLORS.crimson);
  ctx.fillStyle = gradeGrad;
  ctx.font = '900 260px Orbitron';
  ctx.shadowColor = COLORS.crimson;
  ctx.shadowBlur = 50;
  ctx.fillText(data.grade, W / 2, 480);
  ctx.shadowBlur = 0;

  // Stat card
  ctx.fillStyle = 'rgba(255,255,255,0.04)';
  roundRect(ctx, 90, 560, W - 180, 300, 16);
  ctx.fill();
  ctx.strokeStyle = 'rgba(185,103,255,0.25)';
  ctx.lineWidth = 1.5;
  roundRect(ctx, 90, 560, W - 180, 300, 16);
  ctx.stroke();

  statBlock(ctx, 'SCORE', Math.floor(data.score).toLocaleString(), W / 2 - 300, 650, COLORS.text);
  statBlock(ctx, 'ACCURACY', data.accuracy.toFixed(2) + '%', W / 2, 650, COLORS.cyan);
  statBlock(ctx, 'MAX COMBO', String(data.maxCombo), W / 2 + 300, 650, COLORS.gold);

  const judgments = [
    ['PERFECT', data.counts.perfect, COLORS.gold],
    ['GREAT', data.counts.great, COLORS.cyan],
    ['GOOD', data.counts.good, COLORS.violet],
    ['MISS', data.counts.miss, COLORS.crimson],
  ];
  const jw = (W - 180) / 4;
  judgments.forEach(([label, val, color], i) => {
    const x = 90 + jw * i + jw / 2;
    ctx.font = '600 14px Orbitron';
    ctx.fillStyle = color;
    ctx.fillText(label, x, 770);
    ctx.font = '700 30px Orbitron';
    ctx.fillStyle = COLORS.text;
    ctx.fillText(String(val), x, 805);
  });

  // Footer
  ctx.font = '600 26px Rajdhani';
  ctx.fillStyle = COLORS.textDim;
  ctx.fillText('#jointherebellion  ·  #aikavrdj', W / 2, 960);

  return canvas;
}

// Copies the canvas to the clipboard as image/png. Falls back to triggering
// a download if the Clipboard API (or ClipboardItem) isn't available.
// Returns 'clipboard' or 'download' so the caller can show the right feedback.
export async function copyCanvasToClipboard(canvas) {
  const blobPromise = new Promise((resolve) => canvas.toBlob((b) => resolve(b), 'image/png'));

  if (navigator.clipboard && window.ClipboardItem) {
    // Passing the write() call the *promise* (not an awaited blob) is what
    // keeps this tied to the click's user-gesture — awaiting the blob first
    // and calling write() after would fail the gesture check in some browsers.
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blobPromise })]);
    return 'clipboard';
  }

  const blob = await blobPromise;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'rebel-pulse-score.png';
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  return 'download';
}
