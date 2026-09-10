import * as PIXI from 'pixi.js';

// A small pool-free particle burst. Cheap enough to spawn dozens per second
// since each note hit fires one — perf matters more than elegance here.
export function spawnParticleBurst(app, container, x, y, color, count = 14) {
  for (let i = 0; i < count; i++) {
    const g = new PIXI.Graphics();
    
    // Mezcla: el 70% de las partículas son del color del carril, el 30% restante son blancas para dar un destello de luz intensa
    const isWhiteFlash = i < Math.floor(count * 0.3);
    const particleColor = isWhiteFlash ? 0xffffff : color;
    
    const size = (isWhiteFlash ? 1.5 : 2) + Math.random() * 3;
    g.circle(0, 0, size).fill({ color: particleColor });
    
    // Usamos blendMode add para que las partículas blancas brillen con intensidad sobre el fondo
    g.blendMode = 'add';
    
    g.x = x;
    g.y = y;
    container.addChild(g);

    const angle = Math.random() * Math.PI * 2;
    // Las partículas blancas salen un poco más rápido y lejos como chispas vivas
    const speed = isWhiteFlash ? (4 + Math.random() * 5) : (2.5 + Math.random() * 6);
    const vx = Math.cos(angle) * speed;
    const vy = Math.sin(angle) * speed - 2; // ligero sesgo hacia arriba
    let life = 0;
    const maxLife = 26 + Math.random() * 16;

    const tick = () => {
      life++;
      g.x += vx;
      g.y += vy + life * 0.08; // gravedad
      g.alpha = 1 - life / maxLife;
      g.scale.set(1 - (life / maxLife) * 0.6);
      if (life >= maxLife) {
        app.ticker.remove(tick);
        container.removeChild(g);
        g.destroy();
      }
    };
    app.ticker.add(tick);
  }
}

// Bright rectangle flash on a lane, fading out. Fires on both keydown (dim)
// and successful hit (bright + colored).
export function laneFlash(app, container, x, width, height, color, intensity = 0.5, fadeFrames = 14) {
  const g = new PIXI.Graphics();
  g.rect(0, 0, width, height).fill({ color, alpha: intensity });
  g.x = x;
  g.y = 0;
  g.blendMode = 'add';
  container.addChild(g);

  let life = 0;
  const tick = () => {
    life++;
    g.alpha = intensity * (1 - life / fadeFrames);
    if (life >= fadeFrames) {
      app.ticker.remove(tick);
      container.removeChild(g);
      g.destroy();
    }
  };
  app.ticker.add(tick);
}

// Floating judgment text ("PERFECT", "MISS"...) that pops and fades upward.
export function judgmentPopup(app, container, x, y, text, color) {
  const t = new PIXI.Text({
    text,
    style: {
      fontFamily: 'Orbitron',
      fontSize: 26,
      fontWeight: '900',
      fill: color,
      letterSpacing: 2,
    },
  });
  t.anchor.set(0.5);
  t.x = x;
  t.y = y;
  t.scale.set(1.4);
  container.addChild(t);

  let life = 0;
  const maxLife = 30;
  const tick = () => {
    life++;
    const p = life / maxLife;
    t.y -= 1.1;
    t.scale.set(1.4 - p * 0.4);
    t.alpha = 1 - p;
    if (life >= maxLife) {
      app.ticker.remove(tick);
      container.removeChild(t);
      t.destroy();
    }
  };
  app.ticker.add(tick);
}

// Punches a container sideways briefly — used on combo breaks so a miss
// actually *feels* like something instead of a silent number reset.
export function screenShake(app, target, intensity = 8, frames = 12) {
  let life = 0;
  const baseX = target.x, baseY = target.y;
  const tick = () => {
    life++;
    const falloff = 1 - life / frames;
    target.x = baseX + (Math.random() * 2 - 1) * intensity * falloff;
    target.y = baseY + (Math.random() * 2 - 1) * intensity * falloff;
    if (life >= frames) {
      target.x = baseX;
      target.y = baseY;
      app.ticker.remove(tick);
    }
  };
  app.ticker.add(tick);
}

// A quick scale "pulse" applied to any display object — used for combo milestones.
export function pulse(app, target, scaleFrom = 1.5, frames = 16) {
  target.scale.set(scaleFrom);
  let life = 0;
  const tick = () => {
    life++;
    const p = life / frames;
    const s = scaleFrom - (scaleFrom - 1) * p;
    target.scale.set(s);
    if (life >= frames) {
      target.scale.set(1);
      app.ticker.remove(tick);
    }
  };
  app.ticker.add(tick);
}
