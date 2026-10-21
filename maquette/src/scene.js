/* ==========================================
   scene.js — Mascotte 3D "Exo" (ordinateur rétro samouraï : katana dans le dos, bandeau, sakura)
   Sur l'écran : le compagnon IA de Philippe (src/compagnon.js, couleurs du fichier Nexus)
   Cel-shading (MeshToonMaterial) + contours encre (OutlineEffect)
   La mascotte se cale sur les zones .stage de chaque section : la mise en page
   reste la seule source de vérité, les proportions sont justes sur tous les écrans.
   window.EXO_RIG (js/main.js) fournit l'intro (0 → 1) et la progression des projets.

   Rebuild après modification :
   npx esbuild maquette/src/scene.js --bundle --minify --format=iife --outfile=maquette/js/scene.js
========================================== */

import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { OutlineEffect } from "three/addons/effects/OutlineEffect.js";
import { dessinerCompagnon, NOM_COMPAGNON } from "./compagnon.js";

const COULEURS = {
  encre: 0x09090d,
  papier: 0xf4f4f6,
  papier2: 0xd6d6de,
  graphite: 0x2a2a33,
  violet: 0x8b5cf6, // couleur principale
  violetClair: 0xc4b5fd,
  sakura: 0xf9c6da, // pétales
  acier: 0xdedee8, // lame du katana
  lime: 0xbef264, // seulement le voyant
  ecran: 0x16161d,
};

function init() {
  const canvas = document.getElementById("scene3d");
  if (!canvas) return;

  const reduit = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const rig = window.EXO_RIG || (window.EXO_RIG = { intro: 1, progress: 0 });

  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: "high-performance" });
  } catch (e) {
    document.documentElement.classList.add("no-webgl");
    return;
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
  renderer.setClearColor(0x000000, 0);

  const effet = new OutlineEffect(renderer, { defaultThickness: 0.0055, defaultColor: [0.03, 0.02, 0.06] });
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 100);
  camera.position.set(0, 0, 10);

  // Lumières : une principale (haut gauche) + ambiance violette
  scene.add(new THREE.HemisphereLight(0xffffff, 0x2e2a45, 1.1));
  const soleil = new THREE.DirectionalLight(0xffffff, 2.4);
  soleil.position.set(-4, 6, 6);
  scene.add(soleil);

  // Dégradé 3 tons = rendu "cel-shading" façon anime
  const tons = new Uint8Array([90, 170, 255]);
  const gradientMap = new THREE.DataTexture(tons, tons.length, 1, THREE.RedFormat);
  gradientMap.minFilter = gradientMap.magFilter = THREE.NearestFilter;
  gradientMap.needsUpdate = true;
  const toon = (color) => new THREE.MeshToonMaterial({ color, gradientMap });
  const sansContour = (mat) => { mat.userData.outlineParameters = { visible: false }; return mat; };

  /* ─── HIÉRARCHIE : stage (position scroll) > flottant (idle + souris) > modèle ─── */
  const stage = new THREE.Group();
  const flottant = new THREE.Group();
  stage.add(flottant);
  scene.add(stage);

  // Lune derrière la mascotte : disque pâle + halo violet (sépare la silhouette du fond sombre)
  const auraCanvas = document.createElement("canvas");
  auraCanvas.width = auraCanvas.height = 512;
  const actx = auraCanvas.getContext("2d");
  const grad = actx.createRadialGradient(256, 256, 0, 256, 256, 256);
  grad.addColorStop(0, "rgba(245,243,255,0.34)");
  grad.addColorStop(0.4, "rgba(237,233,254,0.27)");
  grad.addColorStop(0.43, "rgba(196,181,253,0.2)");
  grad.addColorStop(0.6, "rgba(139,92,246,0.11)");
  grad.addColorStop(1, "rgba(139,92,246,0)");
  actx.fillStyle = grad;
  actx.fillRect(0, 0, 512, 512);
  const auraTex = new THREE.CanvasTexture(auraCanvas);
  auraTex.colorSpace = THREE.SRGBColorSpace;
  const aura = new THREE.Mesh(
    new THREE.PlaneGeometry(7.5, 7.5),
    sansContour(new THREE.MeshBasicMaterial({ map: auraTex, transparent: true, depthWrite: false }))
  );
  aura.position.set(0.45, 0.5, -2.4);
  stage.add(aura);

  /* ─── L'ORDINATEUR ─── */
  const modele = new THREE.Group();
  modele.position.y = -0.35;
  flottant.add(modele);

  const coque = new THREE.Mesh(new RoundedBoxGeometry(2.4, 1.9, 1.7, 5, 0.22), toon(COULEURS.papier));
  coque.position.y = 0.35;
  modele.add(coque);

  const arriere = new THREE.Mesh(new RoundedBoxGeometry(1.8, 1.4, 1, 4, 0.18), toon(COULEURS.papier2));
  arriere.position.set(0, 0.4, -1.1);
  modele.add(arriere);

  const cadre = new THREE.Mesh(new RoundedBoxGeometry(2.02, 1.48, 0.14, 4, 0.06), toon(COULEURS.ecran));
  cadre.position.set(0, 0.45, 0.82);
  modele.add(cadre);

  // Écran : texture dessinée en 2D, redessinée à chaque frame
  const ecranCanvas = document.createElement("canvas");
  ecranCanvas.width = 640;
  ecranCanvas.height = 448;
  const ectx = ecranCanvas.getContext("2d");
  const ecranTex = new THREE.CanvasTexture(ecranCanvas);
  ecranTex.colorSpace = THREE.SRGBColorSpace;
  const ecran = new THREE.Mesh(new THREE.PlaneGeometry(1.8, 1.26), sansContour(new THREE.MeshBasicMaterial({ map: ecranTex, toneMapped: false })));
  ecran.position.set(0, 0.45, 0.895);
  modele.add(ecran);

  // Voyant + plaque
  const voyant = new THREE.Mesh(new THREE.SphereGeometry(0.05, 16, 16), sansContour(new THREE.MeshBasicMaterial({ color: COULEURS.lime })));
  voyant.position.set(0.9, -0.42, 0.86);
  modele.add(voyant);
  const plaque = new THREE.Mesh(new RoundedBoxGeometry(0.5, 0.1, 0.05, 2, 0.02), toon(COULEURS.violet));
  plaque.position.set(-0.75, -0.42, 0.86);
  modele.add(plaque);

  // Aérations sur le côté
  for (let i = 0; i < 4; i++) {
    const fente = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.06, 0.9), toon(COULEURS.violet));
    fente.position.set(1.205, 0.75 - i * 0.18, 0);
    modele.add(fente);
  }

  // Pied + socle
  const cou = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.4, 0.35, 24), toon(COULEURS.violet));
  cou.position.y = -0.75;
  modele.add(cou);
  const socle = new THREE.Mesh(new RoundedBoxGeometry(1.7, 0.18, 1.3, 3, 0.07), toon(COULEURS.graphite));
  socle.position.y = -0.98;
  modele.add(socle);

  // Clavier + touches (InstancedMesh : 1 seul appel de dessin pour toutes les touches)
  const clavier = new THREE.Mesh(new RoundedBoxGeometry(2.6, 0.16, 0.95, 3, 0.06), toon(COULEURS.papier));
  clavier.position.set(0, -1.12, 1.5);
  clavier.rotation.x = 0.1;
  modele.add(clavier);

  const COLS = 12, RANGS = 3;
  const touches = new THREE.InstancedMesh(
    new RoundedBoxGeometry(0.16, 0.08, 0.16, 2, 0.03),
    sansContour(toon(0xffffff)),
    COLS * RANGS + 1
  );
  const m = new THREE.Matrix4();
  const c = new THREE.Color();
  let k = 0;
  for (let r = 0; r < RANGS; r++) {
    for (let col = 0; col < COLS; col++) {
      m.makeTranslation(-1.1 + col * 0.2, 0.1, -0.28 + r * 0.2);
      touches.setMatrixAt(k, m);
      const speciale = (r === 1 && col >= 1 && col <= 3) || (r === 0 && col === 2);
      touches.setColorAt(k, c.setHex(speciale ? COULEURS.violetClair : COULEURS.papier2));
      k++;
    }
  }
  m.makeScale(6, 1, 1).setPosition(0, 0.1, 0.34);
  touches.setMatrixAt(k, m);
  touches.setColorAt(k, c.setHex(COULEURS.violet));
  clavier.add(touches);

  // Antenne avec boule lumineuse
  const tige = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.7, 8), toon(COULEURS.violet));
  tige.position.set(0.75, 1.55, -0.2);
  tige.rotation.z = -0.35;
  modele.add(tige);
  const boule = new THREE.Mesh(new THREE.SphereGeometry(0.11, 20, 20), sansContour(new THREE.MeshBasicMaterial({ color: COULEURS.violetClair })));
  boule.position.set(0.88, 1.88, -0.2);
  modele.add(boule);

  // Bandeau de samouraï (hachimaki) autour du haut de l'écran, avec deux pans qui flottent au vent
  const bandeau = new THREE.Mesh(new RoundedBoxGeometry(2.5, 0.2, 1.8, 4, 0.09), toon(COULEURS.violet));
  bandeau.position.set(0, 1.17, 0);
  modele.add(bandeau);
  const noeud = new THREE.Mesh(new THREE.SphereGeometry(0.11, 14, 14), toon(COULEURS.violet));
  noeud.position.set(1.22, 1.17, -0.62);
  modele.add(noeud);
  // Chaque pan est un ruban souple : sa géométrie ondule à chaque image (voir rendre())
  const matPan = toon(COULEURS.violet);
  const pans = [0, 1].map((i) => {
    const geo = new THREE.BoxGeometry(0.15, 1.0 - i * 0.18, 0.025, 1, 14, 1);
    geo.translate(0, -(1.0 - i * 0.18) / 2, 0); // pivot en haut du pan
    const pan = new THREE.Mesh(geo, matPan);
    pan.userData.repos = geo.attributes.position.array.slice();
    pan.position.copy(noeud.position);
    pan.rotation.set(0, 0.5 + i * 0.3, 0.8 + i * 0.4); // pend en diagonale, vers la droite et l'arrière
    modele.add(pan);
    return pan;
  });

  // Katana porté dans le dos : poignée au-dessus de l'épaule gauche, pointe qui dépasse à droite
  const katana = new THREE.Group();
  const formeLame = new THREE.Shape();
  formeLame.moveTo(0, -0.06);
  formeLame.lineTo(2.85, -0.06);
  formeLame.quadraticCurveTo(3.02, -0.045, 3.1, 0.06);
  formeLame.lineTo(0, 0.06);
  formeLame.closePath();
  const lameGeo = new THREE.ExtrudeGeometry(formeLame, { depth: 0.03, bevelEnabled: false });
  lameGeo.translate(0, 0, -0.015);
  katana.add(new THREE.Mesh(lameGeo, toon(COULEURS.acier)));
  const tsuba = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, 0.05, 24), toon(COULEURS.graphite));
  tsuba.rotation.z = Math.PI / 2;
  katana.add(tsuba);
  const tsuka = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.075, 0.95, 12), toon(COULEURS.violet));
  tsuka.rotation.z = Math.PI / 2;
  tsuka.position.x = -0.5;
  katana.add(tsuka);
  const kashira = new THREE.Mesh(new THREE.CylinderGeometry(0.085, 0.085, 0.08, 12), toon(COULEURS.graphite));
  kashira.rotation.z = Math.PI / 2;
  kashira.position.x = -1.0;
  katana.add(kashira);
  katana.position.set(-0.95, 1.25, -1.75);
  katana.rotation.z = -0.55;
  modele.add(katana);

  // Autocollant "未来" sur le côté gauche
  const stickerCanvas = document.createElement("canvas");
  stickerCanvas.width = stickerCanvas.height = 256;
  const stickerTex = new THREE.CanvasTexture(stickerCanvas);
  stickerTex.colorSpace = THREE.SRGBColorSpace;
  function dessinerSticker() {
    const s = stickerCanvas.getContext("2d");
    s.clearRect(0, 0, 256, 256);
    // Sceau (hanko) violet
    s.fillStyle = "#7c3aed";
    s.beginPath(); s.arc(128, 128, 118, 0, Math.PI * 2); s.fill();
    s.lineWidth = 10; s.strokeStyle = "#09090d"; s.stroke();
    s.fillStyle = "#f4f4f6";
    s.font = '800 96px "Shippori Mincho", serif';
    s.textAlign = "center"; s.textBaseline = "middle";
    s.fillText("未来", 128, 134);
    stickerTex.needsUpdate = true;
  }
  dessinerSticker();
  const sticker = new THREE.Mesh(new THREE.PlaneGeometry(0.75, 0.75), sansContour(new THREE.MeshBasicMaterial({ map: stickerTex, transparent: true })));
  sticker.position.set(-1.21, 0.5, 0.15);
  sticker.rotation.set(0, -Math.PI / 2, 0.2);
  modele.add(sticker);

  /* ─── OBJETS EN ORBITE ─── */
  const orbite = new THREE.Group();
  flottant.add(orbite);

  function cubeTexte(txt, fond, encre) {
    const cv = document.createElement("canvas");
    cv.width = cv.height = 128;
    const x = cv.getContext("2d");
    x.fillStyle = fond; x.fillRect(0, 0, 128, 128);
    x.fillStyle = encre;
    x.font = 'bold 54px "Geist Mono", monospace';
    x.textAlign = "center"; x.textBaseline = "middle";
    x.fillText(txt, 64, 68);
    const t = new THREE.CanvasTexture(cv);
    t.colorSpace = THREE.SRGBColorSpace;
    return new THREE.Mesh(new RoundedBoxGeometry(0.5, 0.5, 0.5, 3, 0.06), new THREE.MeshToonMaterial({ map: t, gradientMap }));
  }

  // Fleur de sakura : 5 pétales échancrés + cœur violet
  const formePetale = new THREE.Shape();
  formePetale.moveTo(0, 0);
  formePetale.bezierCurveTo(-0.15, 0.07, -0.18, 0.24, -0.065, 0.31);
  formePetale.lineTo(0, 0.265);
  formePetale.lineTo(0.065, 0.31);
  formePetale.bezierCurveTo(0.18, 0.24, 0.15, 0.07, 0, 0);
  const petaleGeo = new THREE.ExtrudeGeometry(formePetale, { depth: 0.04, bevelEnabled: false });
  const matSakura = toon(COULEURS.sakura);
  function fleurSakura(echelle) {
    const fleur = new THREE.Group();
    for (let i = 0; i < 5; i++) {
      const petale = new THREE.Mesh(petaleGeo, matSakura);
      petale.rotation.z = (i / 5) * Math.PI * 2;
      fleur.add(petale);
    }
    const coeur = new THREE.Mesh(new THREE.SphereGeometry(0.07, 12, 12), toon(COULEURS.violet));
    coeur.position.z = 0.04;
    fleur.add(coeur);
    fleur.scale.setScalar(echelle);
    return fleur;
  }

  const satellites = [
    { obj: cubeTexte("</>", "#f4f4f6", "#8b5cf6"), r: 2.15, v: 0.42, h: 0.35, p: 0 },
    { obj: fleurSakura(1.15), r: 2.35, v: 0.3, h: 0.2, p: 2.1 },
    { obj: fleurSakura(0.85), r: 2.0, v: 0.36, h: 0.3, p: 4.2 },
  ];
  satellites.forEach((s) => orbite.add(s.obj));

  /* ─── ÉCRAN : le compagnon IA + contenus par section ─── */
  const pointeur = { x: 0, y: 0, lx: 0, ly: 0 };
  let clignement = 0;
  let prochainClignement = 2;
  let poke = 0;

  const PROJETS = ["EXOTIC.IA", "PORTFOLIO PRO", "SYS & RÉSEAUX", "PROJETS BTS"];

  // Réglages communs du compagnon (regard, clignement, piqûre)
  const etatCompagnon = (cx, cy, echelle, expression) => ({
    cx, cy, echelle, expression, regard: [pointeur.lx, pointeur.ly], clignement, poke, reduit,
  });

  function dessinerEcran(t) {
    const x = ectx, W = 640, H = 448;
    x.fillStyle = "#0c0c12";
    x.fillRect(0, 0, W, H);
    x.textAlign = "left"; x.textBaseline = "alphabetic";
    x.font = '500 22px "Geist Mono", monospace';
    x.fillStyle = "#8b5cf6";
    x.fillText(NOM_COMPAGNON, 28, 44);
    x.fillStyle = Math.sin(t * 4) > 0 ? "#f9c6da" : "#0c0c12";
    x.fillRect(W - 52, 28, 22, 22);

    const mode = poke > 0 ? "poke" : ecranMode;

    if (mode === "poke") {
      dessinerCompagnon(x, t, etatCompagnon(320, 232, 1.5, "surprised"));
      x.font = '700 50px "Geist", sans-serif';
      x.fillStyle = "#c4b5fd"; x.textAlign = "center";
      x.fillText("J'AVOUE !", W / 2, 418);
    } else if (mode === "arsenal") {
      x.font = '700 46px "Geist", sans-serif';
      x.fillStyle = "#f4f4f6";
      x.fillText("ARSENAL.EXE", 28, 130);
      dessinerCompagnon(x, t, etatCompagnon(505, 330, 0.95, "focused"));
      const items = ["> HTML / CSS / JS", "> LINUX / WINDOWS", "> CISCO / VLAN / DNS", "> GIT / GITHUB"];
      x.font = '500 28px "Geist Mono", monospace';
      const visibles = Math.floor((t * 2) % (items.length + 2));
      items.slice(0, visibles).forEach((it, i) => {
        x.fillStyle = i % 2 ? "#c4b5fd" : "#dcdce3";
        x.fillText(it, 28, 200 + i * 48);
      });
      x.fillStyle = "#8b5cf6";
      x.fillRect(28, 400, ((t * 0.4) % 1) * 372, 14);
    } else if (mode === "projets") {
      const n = Math.min(PROJETS.length - 1, Math.floor(rig.progress * PROJETS.length));
      x.font = '500 26px "Geist Mono", monospace';
      x.fillStyle = "#8b5cf6";
      x.fillText("QUÊTE " + String(n + 1).padStart(2, "0") + " / 04", 28, 130);
      x.font = '700 44px "Geist", sans-serif';
      x.fillStyle = "#f4f4f6";
      x.fillText(PROJETS[n], 28, 222);
      x.strokeStyle = "#f4f4f6"; x.lineWidth = 4;
      x.strokeRect(28, 300, 372, 36);
      x.fillStyle = "#8b5cf6";
      x.fillRect(34, 306, 360 * rig.progress, 24);
      dessinerCompagnon(x, t, etatCompagnon(505, 330, 0.95, "thinking"));
    } else if (mode === "veille") {
      const cx = 205, cy = 236, R = 140;
      x.strokeStyle = "rgba(139,92,246,0.6)"; x.lineWidth = 3;
      [1, 0.66, 0.33].forEach((f) => { x.beginPath(); x.arc(cx, cy, R * f, 0, Math.PI * 2); x.stroke(); });
      const a = t * 2;
      x.strokeStyle = "#c4b5fd"; x.lineWidth = 6;
      x.beginPath(); x.moveTo(cx, cy); x.lineTo(cx + Math.cos(a) * R, cy + Math.sin(a) * R); x.stroke();
      [[0.5, 0.8], [2.2, 0.5], [3.9, 0.9], [5.1, 0.35]].forEach(([ang, d]) => {
        const diff = ((a - ang) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2);
        x.fillStyle = "rgba(249,198,218," + Math.max(0.15, 1 - diff / 3) + ")";
        x.beginPath(); x.arc(cx + Math.cos(ang) * R * d, cy + Math.sin(ang) * R * d, 12, 0, Math.PI * 2); x.fill();
      });
      x.font = '500 24px "Geist Mono", monospace';
      x.fillStyle = "#c4b5fd";
      x.fillText("RADAR: 4 SUJETS", 28, 430);
      dessinerCompagnon(x, t, etatCompagnon(505, 330, 0.95, "curious"));
    } else {
      const contact = mode === "contact";
      dessinerCompagnon(x, t, contact ? etatCompagnon(320, 232, 1.5, "happy") : etatCompagnon(320, 252, 1.9, "normal"));
      if (contact) {
        x.font = '700 42px "Geist", "Shippori Mincho", sans-serif';
        x.fillStyle = "#c4b5fd"; x.textAlign = "center";
        x.fillText("PING ! またね", W / 2, 418);
      }
    }

    // Scanlines CRT (légères, pour garder le compagnon lumineux)
    x.fillStyle = "rgba(0,0,0,0.12)";
    for (let y = 0; y < H; y += 4) x.fillRect(0, y, W, 2);
    ecranTex.needsUpdate = true;
  }

  /* ─── TAILLE ─── */
  let visW = 1, visH = 1;
  function redimensionner() {
    const w = window.innerWidth, h = window.innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    visH = 2 * camera.position.z * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    visW = visH * camera.aspect;
  }
  redimensionner();
  window.addEventListener("resize", redimensionner);

  /* ─── SUIVI DES ZONES .stage ─── */
  const TAILLE_MODELE = 4; // encombrement du modèle (unités 3D) pour le caler dans sa zone
  const sections = Array.from(document.querySelectorAll("[data-screen]"));
  const etat = { x: 0, y: 0, s: 0, rx: 0.08, ry: -0.5, lines: 1 };
  let ecranMode = "hero";
  let zoneActive = null;
  let tours = 0;
  let premiereFrame = true;

  function cible() {
    const vh = window.innerHeight, vw = window.innerWidth;
    // Section qui contient le milieu de l'écran
    let section = sections[0];
    for (const sec of sections) {
      const r = sec.getBoundingClientRect();
      if (r.top <= vh * 0.5 && r.bottom > vh * 0.5) { section = sec; break; }
    }
    ecranMode = section.dataset.screen;
    const zone = section.querySelector(".stage");
    if (!zone || !zone.getClientRects().length) return { zone: null };
    const r = zone.getBoundingClientRect();
    const largeur = (r.width / vw) * visW;
    const hauteur = (r.height / vh) * visH;
    return {
      zone,
      x: ((r.left + r.width / 2) / vw - 0.5) * visW,
      y: -((r.top + r.height / 2) / vh - 0.5) * visH,
      s: Math.min(largeur, hauteur) / TAILLE_MODELE,
      rx: parseFloat(zone.dataset.rx || 0),
      ry: parseFloat(zone.dataset.ry || 0),
      lines: parseFloat(zone.dataset.lines || 0),
    };
  }

  /* ─── INTERACTIONS ─── */
  window.addEventListener("pointermove", (e) => {
    pointeur.x = (e.clientX / window.innerWidth) * 2 - 1;
    pointeur.y = -((e.clientY / window.innerHeight) * 2 - 1);
  });

  // Clic sur la mascotte → "J'AVOUE !" (son + pétales : js/main.js)
  const raycaster = new THREE.Raycaster();
  const cibles = [coque, cadre, ecran, arriere, clavier, socle, bandeau];
  window.addEventListener("pointerdown", (e) => {
    if (e.target.closest("a, button, input, textarea, label")) return;
    const ndc = new THREE.Vector2((e.clientX / window.innerWidth) * 2 - 1, -((e.clientY / window.innerHeight) * 2 - 1));
    raycaster.setFromCamera(ndc, camera);
    if (raycaster.intersectObjects(cibles, false).length) {
      poke = 1.2;
      window.dispatchEvent(new CustomEvent("exo:poke", { detail: { x: e.clientX, y: e.clientY } }));
    }
  });

  /* ─── BOUCLE DE RENDU ─── */
  const horloge = new THREE.Clock();
  let visible = true;
  document.addEventListener("visibilitychange", () => { visible = !document.hidden; });

  function rendre(dt) {
    const t = horloge.elapsedTime;
    const c = cible();

    if (c.zone) {
      // Nouvelle zone : un tour complet pendant le trajet (comme la canette de Ciao Kombucha)
      if (zoneActive && c.zone !== zoneActive && !reduit) tours += c.x > etat.x ? 1 : -1;
      zoneActive = c.zone;
      const suivi = premiereFrame || reduit ? 1 : 1 - Math.exp(-dt * 5.5);
      const doux = reduit ? 1 : 1 - Math.exp(-dt * 3.2);
      etat.x += (c.x - etat.x) * suivi;
      etat.y += (c.y - etat.y) * suivi;
      etat.s += (c.s - etat.s) * suivi;
      etat.rx += (c.rx - etat.rx) * doux;
      etat.ry += (c.ry + tours * Math.PI * 2 - etat.ry) * doux;
      etat.lines += (c.lines - etat.lines) * doux;
      premiereFrame = false;
    } else {
      // Pas de zone visible (mobile) : la mascotte disparaît en douceur
      etat.s += (0 - etat.s) * (reduit ? 1 : 1 - Math.exp(-dt * 6));
      etat.lines += (0 - etat.lines) * 0.2;
    }

    const echelle = etat.s * rig.intro;
    stage.position.set(etat.x, etat.y, 0);
    stage.scale.setScalar(Math.max(echelle, 0.0001));
    stage.visible = echelle > 0.01;
    if (!stage.visible) return;

    pointeur.lx += (pointeur.x - pointeur.lx) * 0.08;
    pointeur.ly += (pointeur.y - pointeur.ly) * 0.08;

    const saut = poke > 0 ? Math.sin((1.2 - poke) * 14) * 0.25 * poke : 0;
    flottant.position.y = (reduit ? 0 : Math.sin(t * 1.4) * 0.08) + Math.abs(saut);
    flottant.rotation.set(etat.rx - pointeur.ly * 0.12, etat.ry + pointeur.lx * 0.25, reduit ? 0 : Math.sin(t * 0.9) * 0.03 + saut * 0.3);

    satellites.forEach((s) => {
      const a = s.p + (reduit ? 0 : t * s.v);
      // Orbite inclinée : passe au-dessus de l'écran par l'avant, derrière l'ordinateur par l'arrière
      s.obj.position.set(Math.cos(a) * s.r, s.h + Math.sin(a) * s.r * 0.55 + Math.sin(a * 2) * 0.1, Math.sin(a) * s.r * 0.45 - 0.3);
      s.obj.rotation.set(t * 0.7, t * 0.9, 0);
    });

    // data-lines de la zone = éclat de la lune (plus forte dans l'accueil et le contact)
    aura.material.opacity = 0.6 + etat.lines * 0.4;
    boule.scale.setScalar(1 + Math.sin(t * 5) * 0.12);

    // Les pans du bandeau ondulent au vent (vague qui part du nœud vers le bout)
    if (!reduit) {
      pans.forEach((pan, i) => {
        const pos = pan.geometry.attributes.position;
        const repos = pan.userData.repos;
        for (let v = 0; v < pos.count; v++) {
          const d = -repos[v * 3 + 1]; // distance au nœud (0 → longueur du pan)
          const vague = Math.sin(d * 6 - t * 7 - i * 1.3) * 0.11 * d;
          pos.array[v * 3] = repos[v * 3] + Math.sin(d * 3 - t * 4 + i) * 0.04 * d;
          pos.array[v * 3 + 2] = repos[v * 3 + 2] + vague;
        }
        pos.needsUpdate = true;
        pan.geometry.computeVertexNormals();
      });
    }

    if (clignement > 0) clignement -= dt;
    prochainClignement -= dt;
    if (prochainClignement <= 0) { clignement = 0.14; prochainClignement = 2 + Math.random() * 3; }
    if (poke > 0) poke -= dt;

    dessinerEcran(t);
  }

  function afficher(dt) {
    rendre(dt);
    if (stage.visible) effet.render(scene, camera);
    else renderer.clear();
  }

  document.fonts && document.fonts.load('800 96px "Shippori Mincho"', "未来").then(dessinerSticker).catch(() => {});

  function boucle() {
    requestAnimationFrame(boucle);
    const dt = Math.min(horloge.getDelta(), 0.05);
    if (!visible) return;
    afficher(dt);
  }
  boucle();
}

init();
