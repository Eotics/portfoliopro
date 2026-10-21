/* ==========================================
   sakura.js — Pétales de cerisier qui tombent (canvas 2D)
   Le canvas #sakura est placé entre la mascotte 3D et le contenu :
   les cadres en verre floutent les pétales qui passent derrière eux.
   window.SAKURA.rafale(x, y, n) : gerbe de pétales (clic sur la mascotte)
========================================== */

(function () {
  const canvas = document.getElementById("sakura");
  if (!canvas) return;
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

  const ctx = canvas.getContext("2d");
  const TOUR = Math.PI * 2;
  const hasard = (a, b) => a + Math.random() * (b - a);

  // Pétales pré-dessinés : rose pâle (majorité), blanc rosé, et quelques-uns lavande
  const TEINTES = [
    ["#ffe9f2", "#f4a3c4"],
    ["#fff6fa", "#f7c2d7"],
    ["#f1e9ff", "#c4b5fd"],
  ];
  const sprites = TEINTES.map(([clair, fonce]) => {
    const c = document.createElement("canvas");
    c.width = c.height = 64;
    const x = c.getContext("2d");
    const g = x.createLinearGradient(32, 60, 32, 4);
    g.addColorStop(0, fonce);
    g.addColorStop(1, clair);
    x.fillStyle = g;
    // Pétale de sakura : base en bas, petite encoche en haut
    x.beginPath();
    x.moveTo(32, 60);
    x.bezierCurveTo(10, 46, 5, 14, 21, 4);
    x.lineTo(32, 12);
    x.lineTo(43, 4);
    x.bezierCurveTo(59, 14, 54, 46, 32, 60);
    x.fill();
    return c;
  });
  const choisirSprite = () => sprites[Math.random() < 0.15 ? 2 : Math.random() < 0.55 ? 0 : 1];

  let L = 0, H = 0, dpr = 1;
  const flottants = []; // pétales d'ambiance (bouclent sans fin)
  const gerbes = []; // pétales d'une rafale (disparaissent)

  function placer(p, depuisLeHaut) {
    p.x = hasard(-20, L + 60);
    p.y = depuisLeHaut ? hasard(-60, -16) : hasard(-20, H);
    p.taille = hasard(9, 17);
    p.profondeur = p.taille / 17; // les petits pétales sont "loin" : plus lents, plus transparents
    p.vy = hasard(22, 42) * (0.6 + p.profondeur * 0.5);
    p.vx = hasard(-22, -8); // léger vent vers la gauche
    p.phase = hasard(0, TOUR);
    p.oscillation = hasard(0.5, 1.3);
    p.amplitude = hasard(12, 30);
    p.angle = hasard(0, TOUR);
    p.vAngle = hasard(-1.4, 1.4);
    p.bascule = hasard(0, TOUR);
    p.vBascule = hasard(1.2, 3.2);
    p.alpha = hasard(0.45, 0.9) * (0.55 + p.profondeur * 0.45);
    p.sprite = choisirSprite();
    return p;
  }

  function redimensionner() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    L = window.innerWidth;
    H = window.innerHeight;
    canvas.width = Math.round(L * dpr);
    canvas.height = Math.round(H * dpr);
    const voulu = Math.round(Math.min(42, Math.max(10, (L * H) / 36000)));
    while (flottants.length < voulu) flottants.push(placer({}, false));
    flottants.length = voulu;
  }
  redimensionner();
  window.addEventListener("resize", redimensionner);

  function dessiner(p, alpha) {
    // "bascule" : le pétale tourne sur lui-même en tombant (on écrase sa largeur)
    const largeur = Math.max(0.18, Math.abs(Math.cos(p.bascule)));
    ctx.setTransform(dpr, 0, 0, dpr, p.x * dpr, p.y * dpr);
    ctx.rotate(p.angle);
    ctx.scale(largeur, 1);
    ctx.globalAlpha = alpha;
    ctx.drawImage(p.sprite, -p.taille / 2, -p.taille / 2, p.taille, p.taille);
  }

  /* ─── RAFALE (clic sur la mascotte) ─── */
  function rafale(x, y, n = 28) {
    for (let i = 0; i < n; i++) {
      const a = hasard(0, TOUR);
      const v = hasard(120, 380);
      gerbes.push({
        x, y,
        vx: Math.cos(a) * v,
        vy: Math.sin(a) * v - 120, // plutôt vers le haut, puis ça retombe
        taille: hasard(10, 20),
        angle: hasard(0, TOUR),
        vAngle: hasard(-6, 6),
        bascule: hasard(0, TOUR),
        vBascule: hasard(3, 7),
        vie: 0,
        duree: hasard(1.4, 2.4),
        sprite: choisirSprite(),
      });
    }
  }
  window.SAKURA = { rafale };

  /* ─── BOUCLE ─── */
  let precedent = performance.now();
  let scrollPrecedent = window.scrollY;
  let visible = true;
  document.addEventListener("visibilitychange", () => {
    visible = !document.hidden;
    precedent = performance.now();
  });

  function boucle(maintenant) {
    requestAnimationFrame(boucle);
    if (!visible) return;
    const dt = Math.min((maintenant - precedent) / 1000, 0.05);
    precedent = maintenant;
    // Quand on fait défiler la page, les pétales "restent dans l'air" (effet de profondeur).
    // Un saut brutal (lien d'ancre, rechargement) est ignoré.
    let defilement = window.scrollY - scrollPrecedent;
    scrollPrecedent = window.scrollY;
    if (Math.abs(defilement) > H * 0.5) defilement = 0;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    for (const p of flottants) {
      p.phase += dt * p.oscillation;
      p.x += (p.vx + Math.cos(p.phase) * p.amplitude) * dt;
      p.y += p.vy * dt - defilement * (0.15 + p.profondeur * 0.35);
      p.angle += p.vAngle * dt;
      p.bascule += p.vBascule * dt;
      // Sortis par le haut ou le bas à cause du scroll : on les fait reboucler de l'autre côté
      // (la répartition reste homogène, pas de "paquet" de pétales qui repart d'en haut)
      if (p.y < -80) { p.y += H + 140; p.x = hasard(-20, L + 60); }
      else if (p.y > H + 30 && defilement < 0) { p.y -= H + 110; p.x = hasard(-20, L + 60); }
      else if (p.y > H + 30 || p.x < -40) placer(p, true);
      dessiner(p, p.alpha);
    }

    for (let i = gerbes.length - 1; i >= 0; i--) {
      const p = gerbes[i];
      p.vie += dt;
      if (p.vie >= p.duree) { gerbes.splice(i, 1); continue; }
      const freinage = Math.exp(-dt * 2.2);
      p.vx *= freinage;
      p.vy = p.vy * freinage + 260 * dt; // gravité douce
      p.x += p.vx * dt;
      p.y += p.vy * dt - defilement;
      p.angle += p.vAngle * dt;
      p.bascule += p.vBascule * dt;
      const restant = 1 - p.vie / p.duree;
      dessiner(p, Math.min(1, restant * 2.5));
    }
  }
  requestAnimationFrame(boucle);
})();
