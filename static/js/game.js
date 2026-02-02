/* ==========================================================================
   Error Galaxy Shooter — Game Loop
   Boas práticas aplicadas:
   - Estado encapsulado (Game)
   - Constantes de config agrupadas
   - Pointer Events (mouse + touch) unificados
   - Canvas HiDPI (devicePixelRatio) para ficar nítido
   - Pausa em background (visibilitychange)
   - Overlay acessível (aria-hidden + foco)
   - Configurável para diferentes códigos de erro
   ========================================================================== */

(() => {
  "use strict";

  /** @type {HTMLCanvasElement | null} */
  const canvas = document.querySelector("#game");
  if (!canvas) return;

  const ctx = canvas.getContext("2d", { alpha: false });
  if (!ctx) return;

  const overlay = /** @type {HTMLElement} */ (document.querySelector("#overlay"));
  const restartBtn = /** @type {HTMLButtonElement} */ (document.querySelector("#restartBtn"));
  const homeBtn = /** @type {HTMLButtonElement} */ (document.querySelector("#homeBtn"));

  // Lê configurações do data-attribute do body
  const errorCode = document.body.dataset.error || "404";
  const errorText = document.body.dataset.errorText || errorCode;

  // Carrega imagem da nave
  const naveImg = new Image();
  naveImg.src = "./static/img/nave.png";

  // Função para tocar som de acerto (cria nova instância para evitar cortes)
  function playBubbleSound() {
    const sound = new Audio("./static/sound/bubble.mp3");
    sound.volume = 0.4;
    sound.play().catch(() => {});
  }

  const CONFIG = {
    backgroundStarDensity: 18000, // maior => menos estrelas
    shootIntervalMs: 120,
    shakeDurationMs: 150,
    maxDeltaMs: 40, // limita dt para evitar “teleporte” se travar
    bulletRadius: 4,
    bulletSpeedMin: 400,
    bulletSpeedFactor: 0.7,
    playerLerp: 0.18,
    gravity: 400 * 0.3,
    text: errorText,
    piece: {
      step: 9,
      alphaThreshold: 80,
      radiusMin: 3,
      radiusRand: 2
    }
  };

  const prefersReducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches ?? false;

  const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const now = () => performance.now();

  function setOverlayVisible(isVisible) {
    if (!overlay) return;

    overlay.classList.toggle("is-visible", isVisible);
    overlay.setAttribute("aria-hidden", String(!isVisible));

    // Move foco para o modal quando abrir
    if (isVisible) {
      overlay.focus();
      restartBtn?.focus();
    }
  }

  class Game {
    constructor(canvasEl, context2d) {
      this.canvas = canvasEl;
      this.ctx = context2d;

      // dimensões em CSS px
      this.width = window.innerWidth;
      this.height = window.innerHeight;

      // HiDPI
      this.dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));

      // estado do jogo
      this.player = null;
      this.stars = [];
      this.pieces = [];
      this.bullets = [];
      this.particles = [];

      this.pointerX = this.width / 2;
      this.pointerDown = false;

      this.globalTime = 0;
      this.lastShotAt = 0;
      this.lastFrameAt = now();

      // shake
      this.shakeMs = 0;
      this.shakeIntensity = 0;

      this.rafId = 0;
      this.isRunning = false;
      this.isGameOver = false;

      // binds
      this.onResize = this.onResize.bind(this);
      this.onVisibilityChange = this.onVisibilityChange.bind(this);
      this.loop = this.loop.bind(this);
      this.onPointerMove = this.onPointerMove.bind(this);
      this.onPointerDown = this.onPointerDown.bind(this);
      this.onPointerUp = this.onPointerUp.bind(this);
    }

    start() {
      this.isRunning = true;
      this.isGameOver = false;

      setOverlayVisible(false);

      this.setupCanvas();
      this.createStars();
      this.createPlayer();
      this.create404Pieces();

      this.attachEvents();

      this.lastFrameAt = now();
      this.rafId = requestAnimationFrame(this.loop);
    }

    stop() {
      this.isRunning = false;
      if (this.rafId) cancelAnimationFrame(this.rafId);
      this.rafId = 0;
      this.detachEvents();
    }

    reset() {
      // reset “limpo” sem reload — fica mais profissional
      this.player = null;
      this.stars = [];
      this.pieces = [];
      this.bullets = [];
      this.particles = [];

      this.pointerX = this.width / 2;
      this.pointerDown = false;

      this.globalTime = 0;
      this.lastShotAt = 0;
      this.lastFrameAt = now();

      this.shakeMs = 0;
      this.shakeIntensity = 0;

      this.isGameOver = false;

      this.setupCanvas();
      this.createStars();
      this.createPlayer();
      this.create404Pieces();
      setOverlayVisible(false);
    }

    attachEvents() {
      window.addEventListener("resize", this.onResize, { passive: true });
      document.addEventListener("visibilitychange", this.onVisibilityChange, { passive: true });

      // Pointer Events unifica mouse + touch
      this.canvas.addEventListener("pointermove", this.onPointerMove, { passive: true });
      this.canvas.addEventListener("pointerdown", this.onPointerDown, { passive: false });
      this.canvas.addEventListener("pointerup", this.onPointerUp, { passive: true });
      this.canvas.addEventListener("pointercancel", this.onPointerUp, { passive: true });
      this.canvas.addEventListener("pointerleave", this.onPointerUp, { passive: true });
    }

    detachEvents() {
      window.removeEventListener("resize", this.onResize);
      document.removeEventListener("visibilitychange", this.onVisibilityChange);

      this.canvas.removeEventListener("pointermove", this.onPointerMove);
      this.canvas.removeEventListener("pointerdown", this.onPointerDown);
      this.canvas.removeEventListener("pointerup", this.onPointerUp);
      this.canvas.removeEventListener("pointercancel", this.onPointerUp);
      this.canvas.removeEventListener("pointerleave", this.onPointerUp);
    }

    onResize() {
      this.width = window.innerWidth;
      this.height = window.innerHeight;
      this.dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));

      this.setupCanvas();

      // Reposiciona nave e recria fundo/404 para ficar proporcional
      if (this.player) this.player.y = this.height * 0.85;
      this.createStars();
      this.create404Pieces();
    }

    onVisibilityChange() {
      if (document.hidden) {
        // pausa “real”: evita dt gigante quando volta
        if (this.isRunning) cancelAnimationFrame(this.rafId);
      } else {
        this.lastFrameAt = now();
        this.rafId = requestAnimationFrame(this.loop);
      }
    }

    getCanvasRelativeX(clientX) {
      const rect = this.canvas.getBoundingClientRect();
      return clientX - rect.left;
    }

    onPointerMove(e) {
      this.pointerX = this.getCanvasRelativeX(e.clientX);
      if (this.player) this.player.targetX = this.pointerX;
    }

    onPointerDown(e) {
      // Evita scroll em mobile
      e.preventDefault();

      this.pointerDown = true;
      this.pointerX = this.getCanvasRelativeX(e.clientX);

      if (this.player) this.player.targetX = this.pointerX;

      // Captura o ponteiro para garantir eventos mesmo se sair do canvas
      try {
        this.canvas.setPointerCapture(e.pointerId);
      } catch (_) {
        // não crítico
      }
    }

    onPointerUp() {
      this.pointerDown = false;
    }

    setupCanvas() {
      // set tamanho real do buffer (HiDPI), mantendo tamanho CSS via CSS
      this.canvas.width = Math.floor(this.width * this.dpr);
      this.canvas.height = Math.floor(this.height * this.dpr);

      // desenhar em “CSS pixels”
      this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    }

    createStars() {
      const count = Math.floor((this.width * this.height) / CONFIG.backgroundStarDensity);
      this.stars = Array.from({ length: count }, () => ({
        x: Math.random() * this.width,
        y: Math.random() * this.height,
        r: Math.random() * 1.5 + 0.3,
        tw: Math.random() * Math.PI * 2
      }));
    }

    createPlayer() {
      this.player = {
        x: this.width / 2,
        y: this.height * 0.85,
        w: Math.max(50, this.width * 0.05),
        h: Math.max(18, this.height * 0.025),
        targetX: this.width / 2
      };
    }

    create404Pieces() {
      this.pieces = [];

      const off = document.createElement("canvas");
      off.width = Math.floor(this.width);
      off.height = Math.floor(this.height);

      const offCtx = off.getContext("2d");
      if (!offCtx) return;

      const fontSize = Math.min(this.width, this.height) * 0.35;
      const cx = this.width / 2;
      const cy = this.height * 0.45;

      offCtx.clearRect(0, 0, off.width, off.height);
      offCtx.fillStyle = "#ffffff";
      offCtx.textAlign = "center";
      offCtx.textBaseline = "middle";
      offCtx.font = `800 ${fontSize}px system-ui, -apple-system, Segoe UI, sans-serif`;
      offCtx.fillText(CONFIG.text, cx, cy);

      const metrics = offCtx.measureText(CONFIG.text);
      const textWidth = metrics.width;
      const textHeight = fontSize * 0.9;

      const startX = Math.max(0, Math.floor(cx - textWidth / 2));
      const endX = Math.min(this.width, Math.ceil(cx + textWidth / 2));
      const startY = Math.max(0, Math.floor(cy - textHeight / 2));
      const endY = Math.min(this.height, Math.ceil(cy + textHeight / 2));

      const step = CONFIG.piece.step;

      const img = offCtx.getImageData(startX, startY, endX - startX, endY - startY);
      const data = img.data;
      const w = img.width;

      // Obtém faixa de matiz (hue) do CSS para cada tipo de erro
      const style = getComputedStyle(document.body);
      const hueMin = parseInt(style.getPropertyValue('--piece-hue-min').trim()) || 180;
      const hueMax = parseInt(style.getPropertyValue('--piece-hue-max').trim()) || 300;

      for (let y = 0; y < img.height; y += step) {
        for (let x = 0; x < img.width; x += step) {
          const idx = (y * w + x) * 4;
          const alpha = data[idx + 3];

          if (alpha > CONFIG.piece.alphaThreshold) {
            const px = startX + x;
            const py = startY + y;
            const radius = CONFIG.piece.radiusMin + Math.random() * CONFIG.piece.radiusRand;

            // Calcula hue considerando wrap-around (ex: 340-20 passa por 0)
            let hue;
            if (hueMin > hueMax) {
              // Wrap around (ex: vermelho 340-20)
              const range = (360 - hueMin) + hueMax;
              const randomValue = Math.random() * range;
              hue = (hueMin + randomValue) % 360;
            } else {
              // Range normal
              hue = hueMin + Math.random() * (hueMax - hueMin);
            }

            this.pieces.push({
              x: px + (Math.random() - 0.5) * 2,
              y: py + (Math.random() - 0.5) * 2,
              r: radius,
              color: `hsl(${hue}, 90%, 70%)`
            });
          }
        }
      }
    }

    spawnBullet() {
      if (!this.player) return;

      const speed = 0.9 * Math.max(CONFIG.bulletSpeedMin, this.height * CONFIG.bulletSpeedFactor);
      this.bullets.push({
        x: this.player.x,
        y: this.player.y - this.player.h / 2,
        vy: -speed,
        r: CONFIG.bulletRadius
      });
    }

    spawnExplosion(x, y, baseColor) {
      const count = 12 + Math.random() * 10;

      for (let i = 0; i < count; i++) {
        const angle = Math.random() * Math.PI * 2;
        const speed = 50 + Math.random() * 200;

        this.particles.push({
          x,
          y,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed,
          life: 0.4 + Math.random() * 0.5,
          age: 0,
          alpha: 1,
          color: baseColor
        });
      }
    }

    triggerShake() {
      if (prefersReducedMotion) return;

      this.shakeMs = CONFIG.shakeDurationMs;
      this.shakeIntensity = 7;
    }

    update(dtMs) {
      if (!this.player) return;

      const dt = Math.min(dtMs, CONFIG.maxDeltaMs);
      const dtSec = dt / 1000;

      this.globalTime += dt;

      // Player segue o alvo suavemente
      this.player.x = lerp(this.player.x, this.player.targetX, CONFIG.playerLerp);
      this.player.x = clamp(this.player.x, this.player.w / 2, this.width - this.player.w / 2);

      // Tiro contínuo
      if (!this.isGameOver && this.pointerDown && now() - this.lastShotAt > CONFIG.shootIntervalMs) {
        this.spawnBullet();
        this.lastShotAt = now();
      }

      // Balas
      for (let i = this.bullets.length - 1; i >= 0; i--) {
        const b = this.bullets[i];
        b.y += b.vy * dtSec;

        if (b.y + b.r < 0) {
          this.bullets.splice(i, 1);
        }
      }

      // Colisão bala x peça
      for (let i = this.bullets.length - 1; i >= 0; i--) {
        const b = this.bullets[i];

        for (let j = this.pieces.length - 1; j >= 0; j--) {
          const p = this.pieces[j];
          const dx = b.x - p.x;
          const dy = b.y - p.y;
          const rr = b.r + p.r;

          if (dx * dx + dy * dy <= rr * rr) {
            this.spawnExplosion(p.x, p.y, p.color);
            this.pieces.splice(j, 1);
            this.bullets.splice(i, 1);
            this.triggerShake();
            playBubbleSound(); // Toca som de acerto
            break;
          }
        }
      }

      // Partículas
      for (let i = this.particles.length - 1; i >= 0; i--) {
        const pa = this.particles[i];
        pa.age += dtSec;

        if (pa.age >= pa.life) {
          this.particles.splice(i, 1);
          continue;
        }

        const t = 1 - pa.age / pa.life;
        pa.alpha = t;

        pa.x += pa.vx * dtSec;
        pa.y += pa.vy * dtSec;
        pa.vy += CONFIG.gravity * dtSec;
      }

      // Shake
      if (this.shakeMs > 0) {
        this.shakeMs -= dt;
        if (this.shakeMs < 0) this.shakeMs = 0;
      }

      // Victory
      if (!this.isGameOver && this.pieces.length === 0) {
        this.isGameOver = true;

        // pequena “pausa” antes do modal (feedback melhor)
        window.setTimeout(() => setOverlayVisible(true), 350);
      }
    }

    drawBackground() {
      const { ctx } = this;
      const cx = this.width / 2;
      const cy = this.height / 2;
      const maxR = Math.sqrt(cx * cx + cy * cy);

      // Obtém cores do CSS para cada tipo de erro
      const style = getComputedStyle(document.body);
      const gradientStart = style.getPropertyValue('--bg-gradient-start').trim() || "#020617";
      const gradientMid = style.getPropertyValue('--bg-gradient-mid').trim() || "#020617";
      const gradientEnd = style.getPropertyValue('--bg-gradient-end').trim() || "#000000";
      const nebula1 = style.getPropertyValue('--nebula-color1').trim() || "rgba(56,189,248,0.9)";
      const nebula2 = style.getPropertyValue('--nebula-color2').trim() || "rgba(79,70,229,0.0)";

      const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, maxR);
      g.addColorStop(0, gradientStart);
      g.addColorStop(0.4, gradientMid);
      g.addColorStop(1, gradientEnd);

      ctx.fillStyle = g;
      ctx.fillRect(0, 0, this.width, this.height);

      // Nebulosa suave com cores personalizadas
      ctx.save();
      ctx.globalAlpha = 0.35;

      const g2 = ctx.createRadialGradient(
        cx + Math.sin(this.globalTime * 0.0002) * this.width * 0.15,
        cy - Math.cos(this.globalTime * 0.00025) * this.height * 0.15,
        0,
        cx,
        cy,
        maxR * 0.8
      );

      g2.addColorStop(0, nebula1);
      g2.addColorStop(0.6, nebula2);
      g2.addColorStop(1, "rgba(15,23,42,0.0)");

      ctx.fillStyle = g2;
      ctx.fillRect(0, 0, this.width, this.height);

      ctx.restore();

      // Estrelas
      for (const s of this.stars) {
        const twinkle = 0.3 + 0.7 * (0.5 + 0.5 * Math.sin(this.globalTime * 0.001 + s.tw));
        ctx.globalAlpha = twinkle;
        ctx.beginPath();
        ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
        ctx.fillStyle = "#e5e7eb";
        ctx.fill();
      }

      ctx.globalAlpha = 1;
    }

    drawErrorWatermark() {
      const { ctx } = this;

      // Desenha o código do erro no canto superior direito de forma sutil
      const style = getComputedStyle(document.body);
      const accentColor = style.getPropertyValue('--accent').trim() || "#38bdf8";

      ctx.save();

      // Posição no canto superior direito
      const x = this.width - 40;
      const y = 40;
      const fontSize = Math.max(18, this.width * 0.025);

      // Texto com opacidade variável (pulsa sutilmente)
      const pulse = 0.15 + 0.1 * Math.sin(this.globalTime * 0.002);
      ctx.globalAlpha = pulse;

      ctx.font = `700 ${fontSize}px system-ui, -apple-system, monospace`;
      ctx.fillStyle = accentColor;
      ctx.textAlign = "right";
      ctx.textBaseline = "top";
      ctx.fillText(errorCode, x, y);

      // Adiciona um pequeno ícone/indicador ao lado
      ctx.globalAlpha = pulse * 0.6;
      ctx.beginPath();
      ctx.arc(x - ctx.measureText(errorCode).width - 12, y + fontSize / 2, 4, 0, Math.PI * 2);
      ctx.fillStyle = accentColor;
      ctx.fill();

      ctx.restore();
    }

    drawPieces() {
      const { ctx } = this;

      for (const p of this.pieces) {
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fillStyle = p.color;
        ctx.fill();
      }
    }

    drawBullets() {
      const { ctx } = this;

      for (const b of this.bullets) {
        const g = ctx.createRadialGradient(b.x, b.y, 0, b.x, b.y, b.r * 2);
        g.addColorStop(0, "#fef9c3");
        g.addColorStop(0.5, "#facc15");
        g.addColorStop(1, "rgba(245,158,11,0)");

        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(b.x, b.y, b.r * 2, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = "#fde047";
        ctx.beginPath();
        ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    drawParticles() {
      const { ctx } = this;

      for (const pa of this.particles) {
        ctx.globalAlpha = pa.alpha;
        ctx.beginPath();
        ctx.arc(pa.x, pa.y, 2 + pa.alpha * 3, 0, Math.PI * 2);
        ctx.fillStyle = pa.color;
        ctx.fill();
      }

      ctx.globalAlpha = 1;
    }

    drawPlayer() {
      if (!this.player) return;

      const { ctx } = this;
      const p = this.player;

      ctx.save();
      ctx.translate(p.x, p.y);

      // Se a imagem da nave estiver carregada, usa ela
      if (naveImg.complete && naveImg.naturalHeight !== 0) {
        // Define tamanho da imagem (pixel art 48x48, escalado para caber no tamanho do player)
        const imgSize = Math.max(p.w, p.h * 2.5); // ajusta proporção
        ctx.imageSmoothingEnabled = false; // mantém pixel art nítida
        ctx.drawImage(naveImg, -imgSize / 2, -imgSize / 2, imgSize, imgSize);
      } else {
        // Fallback: desenha nave geométrica se a imagem não carregar
        const grd = ctx.createLinearGradient(-p.w / 2, 0, p.w / 2, 0);
        grd.addColorStop(0, "#22d3ee");
        grd.addColorStop(0.5, "#38bdf8");
        grd.addColorStop(1, "#6366f1");

        ctx.fillStyle = grd;
        ctx.beginPath();
        ctx.moveTo(0, -p.h * 0.9);
        ctx.lineTo(p.w / 2, p.h * 0.8);
        ctx.lineTo(-p.w / 2, p.h * 0.8);
        ctx.closePath();
        ctx.fill();

        // Cockpit
        ctx.fillStyle = "rgba(248,250,252,0.9)";
        ctx.beginPath();
        ctx.ellipse(0, -p.h * 0.1, p.w * 0.18, p.h * 0.4, 0, 0, Math.PI * 2);
        ctx.fill();
      }

      ctx.restore();
    }

    applyShake() {
      if (this.shakeMs <= 0) return;

      const t = this.shakeMs / CONFIG.shakeDurationMs;
      const intensity = this.shakeIntensity * t;

      const ox = (Math.random() - 0.5) * intensity;
      const oy = (Math.random() - 0.5) * intensity;

      this.ctx.translate(ox, oy);
    }

    render() {
      // draw em CSS pixels (por causa do setTransform(dpr...))
      this.ctx.save();

      this.drawBackground();
      this.drawErrorWatermark(); // Adiciona marca visual do erro
      this.applyShake();

      this.drawPieces();
      this.drawParticles();
      this.drawPlayer();
      this.drawBullets();

      this.ctx.restore();
    }

    loop(ts) {
      if (!this.isRunning) return;

      const dt = ts - this.lastFrameAt;
      this.lastFrameAt = ts;

      this.update(dt);
      this.render();

      this.rafId = requestAnimationFrame(this.loop);
    }
  }

  const game = new Game(canvas, ctx);

  // UI actions
  restartBtn?.addEventListener("click", () => game.reset());
  homeBtn?.addEventListener("click", () => {
    const homeUrl = overlay?.dataset?.homeUrl || "/home";
    window.location.href = homeUrl;
  });

  // Atalho: Enter/Espaço no overlay reinicia, Esc volta pra home
  window.addEventListener("keydown", (e) => {
    const overlayVisible = overlay?.classList?.contains("is-visible");
    if (!overlayVisible) return;

    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      game.reset();
    }

    if (e.key === "Escape") {
      const homeUrl = overlay?.dataset?.homeUrl || "/home";
      window.location.href = homeUrl;
    }
  });

  // Start
  game.start();
})();
