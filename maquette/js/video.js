/* ==========================================
   video.js — Vidéo "Exo présente le portfolio" (plateau 1920×1080, 57 s)
   Tout l'état de l'image est une fonction du temps : rendu(t).
   - ouverte dans un navigateur : aperçu en boucle
   - pilotée par video/generer.mjs : rendu image par image (horloge virtuelle) puis MP4
   La mascotte (js/scene.js) se cale sur la zone .stage de #ecran, et son écran suit #ecran[data-screen]
========================================== */

(function () {
  const L = 1920;
  const H = 1080;
  const rig = (window.EXO_RIG = { intro: 0, progress: 0 });

  // Chapitres : zone de la mascotte [x, y, largeur, hauteur] (px du plateau), rotation de la 3D,
  // intensité des rayons, point regardé quand Exo ne parle pas, et [entrée, sortie] de chaque bulle
  const SCENES = [
    { id: "hero", debut: 0, fin: 11, zone: [1190, 260, 580, 580], rx: 0.08, ry: -0.5, lines: 0.8, regard: [500, 560], bulles: [[3.6, 6.9], [7.1, 10.3]] },
    { id: "profil", debut: 11, fin: 19, zone: [140, 330, 580, 580], rx: 0.04, ry: 0.6, lines: 0.3, regard: [1300, 560], bulles: [[11.9, 15.2], [15.4, 18.4]] },
    { id: "arsenal", debut: 19, fin: 28, zone: [1270, 330, 560, 560], rx: 0.12, ry: -0.8, lines: 0, regard: [640, 560], bulles: [[19.9, 23.6], [23.8, 27.4]] },
    { id: "projets", debut: 28, fin: 37.5, zone: [1450, 430, 400, 400], rx: 0.1, ry: 0.45, lines: 0, regard: [700, 560], bulles: [[28.9, 32.6], [32.8, 36.9]] },
    { id: "veille", debut: 37.5, fin: 46, zone: [140, 330, 580, 580], rx: 0.06, ry: 0.8, lines: 0, regard: [1300, 560], bulles: [[38.4, 41.9], [42.1, 45.4]] },
    { id: "contact", debut: 46, fin: 57, zone: [1170, 260, 600, 600], rx: 0.05, ry: -0.35, lines: 0.5, regard: [560, 560], bulles: [[47.0, 50.4], [50.6, 53.6]] },
  ];
  const DUREE = 57;
  const LETTRES_PAR_S = 38;
  const POKE = 3.65; // Exo se fait "piquer" en disant bonjour
  const QUETES = [29.6, 36.6]; // la barre des quêtes se remplit entre ces deux instants
  const ANGLES_COUPE = [0, -16, 12, -9, 18, -13]; // inclinaison du coup de katana à chaque changement de chapitre
  // Gerbes de pétales : à l'ouverture, puis à chaque coup de katana
  const GERBES = [2.05, ...SCENES.slice(1).map((s) => s.debut - 0.2)];

  const $ = (sel, racine = document) => racine.querySelector(sel);
  const $$ = (sel, racine = document) => Array.from(racine.querySelectorAll(sel));
  const borne = (v, min, max) => Math.min(max, Math.max(min, v));
  const sceneEl = (id) => $(`.scene[data-scene="${id}"]`);

  const plateaux = $$(".plateau");
  const ecran = $("#ecran");
  const zones = [$("#zoneA"), $("#zoneB")];
  const points = $$(".hud-points li");
  const barreQuetes = $(".quetes__barre span");

  /* ─── MISE À L'ÉCHELLE DU PLATEAU DANS LA FENÊTRE ─── */
  const vue = { echelle: 1, x: 0, y: 0 };
  function ajuster() {
    vue.echelle = Math.min(window.innerWidth / L, window.innerHeight / H);
    vue.x = (window.innerWidth - L * vue.echelle) / 2;
    vue.y = (window.innerHeight - H * vue.echelle) / 2;
    plateaux.forEach((p) => { p.style.transform = `translate(${vue.x}px, ${vue.y}px) scale(${vue.echelle})`; });
  }
  ajuster();
  window.addEventListener("resize", ajuster);
  const versFenetre = ([x, y]) => [vue.x + x * vue.echelle, vue.y + y * vue.echelle];

  /* ─── BULLES : cadre en verre (css/video.css) + texte tapé lettre par lettre ─── */
  const bulles = [];

  function preparerFrappe(p) {
    const lettres = [];
    (function parcourir(noeud) {
      Array.from(noeud.childNodes).forEach((n) => {
        if (n.nodeType !== 3) return parcourir(n);
        const morceau = document.createDocumentFragment();
        for (const car of n.textContent) {
          const s = document.createElement("span");
          s.textContent = car;
          s.style.visibility = "hidden";
          morceau.appendChild(s);
          lettres.push(s);
        }
        n.replaceWith(morceau);
      });
    })(p);
    return lettres;
  }

  function preparerBulles() {
    SCENES.forEach((s) => {
      $$(".bulle", sceneEl(s.id)).forEach((el, i) => {
        const [entree, sortie] = s.bulles[i];
        el.style.transformOrigin = el.classList.contains("queue-bd") ? "78% 120%" : "22% 120%";
        bulles.push({ el, scene: s, entree, sortie, lettres: preparerFrappe($("p", el)), affichees: 0 });
      });
    });
  }

  function frapper(b, t) {
    const n = borne(Math.floor((t - b.entree - 0.12) * LETTRES_PAR_S), 0, b.lettres.length);
    if (n === b.affichees) return;
    b.lettres.forEach((s, i) => { s.style.visibility = i < n ? "visible" : "hidden"; });
    b.affichees = n;
  }

  /* ─── TIMELINE (GSAP, en pause : on la positionne à chaque image) ─── */
  function construireTimeline() {
    const tl = gsap.timeline({ paused: true, defaults: { ease: "expo.out", duration: 0.9 } });
    const sortieScene = (cibles, s) => tl.to(cibles, { autoAlpha: 0, x: -50, duration: 0.45, ease: "power2.in" }, s.fin - 0.65);

    // Ouverture : titre, puis un coup de katana tranche l'écran en diagonale et Exo apparaît
    tl.from(".rideau__intro > *", { autoAlpha: 0, y: 30, stagger: 0.12, duration: 0.8 }, 0.1)
      .to(".rideau__intro", { autoAlpha: 0, y: -16, duration: 0.35, ease: "power2.in" }, 1.6)
      .to(".rideau__trait span", { scaleX: 1, duration: 0.3, ease: "power4.out" }, 1.75)
      .to(".rideau__moitie--haut", { x: -36, y: 8, duration: 0.3, ease: "power2.out" }, 2.05)
      .to(".rideau__moitie--bas", { x: 36, y: -8, duration: 0.3, ease: "power2.out" }, 2.05)
      .to(".rideau__trait span", { autoAlpha: 0, duration: 0.4, ease: "power1.in" }, 2.15)
      .to(".rideau__moitie--haut", { yPercent: -101, duration: 0.9, ease: "expo.inOut" }, 2.3)
      .to(".rideau__moitie--bas", { yPercent: 101, duration: 0.9, ease: "expo.inOut" }, 2.3)
      .to(rig, { intro: 1, duration: 1.3, ease: "back.out(1.4)" }, 2.45)
      .from([".hud-logo", ".hud-points"], { autoAlpha: 0, y: 12, stagger: 0.1, duration: 0.8 }, 2.6);

    // Pour chaque chapitre : kanji de fond, titre, bulles
    SCENES.forEach((s, i) => {
      const racine = sceneEl(s.id);
      const entree = i === 0 ? 2.5 : s.debut + 0.3;
      tl.fromTo(`.fond__kanji[data-scene="${s.id}"]`, { autoAlpha: 0, x: 80 }, { autoAlpha: 1, x: 0, duration: 1.4 }, entree - 0.1)
        .to(`.fond__kanji[data-scene="${s.id}"]`, { autoAlpha: 0, duration: 0.4, ease: "power1.in" }, s.fin - 0.5)
        .from($(".chap", racine), { autoAlpha: 0, y: -24, duration: 0.7 }, entree);
      if (i < SCENES.length - 1) tl.to($(".chap", racine), { autoAlpha: 0, duration: 0.3, ease: "power1.in" }, s.fin - 0.6);

      bulles.filter((b) => b.scene === s).forEach((b) => {
        const sens = b.el.classList.contains("queue-bd") ? 1 : -1;
        tl.fromTo(b.el, { autoAlpha: 0, scale: 0.4, rotate: -6 * sens }, { autoAlpha: 1, scale: 1, rotate: 0, duration: 0.5, ease: "back.out(2.2)" }, b.entree)
          .to(b.el, { autoAlpha: 0, scale: 0.85, y: -12, duration: 0.25, ease: "power2.in" }, b.sortie - 0.25);
      });

      // Transition : un coup de katana traverse l'écran pile au changement de chapitre
      if (i > 0) {
        const coup = s.debut - 0.42;
        tl.set(".tranche__trait", { rotation: ANGLES_COUPE[i] }, coup)
          .fromTo(".tranche__trait span", { scaleX: 0, autoAlpha: 1 }, { scaleX: 1, duration: 0.3, ease: "power4.out", immediateRender: false }, coup)
          .fromTo(".tranche__eclair", { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.1, ease: "none", immediateRender: false }, coup + 0.18)
          .to(".tranche__eclair", { autoAlpha: 0, duration: 0.5, ease: "power2.out" }, coup + 0.28)
          .to(".tranche__trait span", { autoAlpha: 0, duration: 0.45, ease: "power2.in" }, coup + 0.32);
      }
    });

    // 01 · Accueil
    const hero = SCENES[0];
    tl.from(".hero .pill", { autoAlpha: 0, y: 20, duration: 0.7 }, 2.6)
      .from(".hero__nom .mot", { yPercent: 60, autoAlpha: 0, stagger: 0.1, duration: 1 }, 2.7)
      .from(".hero__role .mot", { yPercent: 60, autoAlpha: 0, stagger: 0.08, duration: 1 }, 2.95)
      .from(".hero__desc", { autoAlpha: 0, y: 24 }, 3.3);
    sortieScene(".hero", hero);

    // 02 · Profil
    const profil = SCENES[1];
    tl.from(".fiche", { autoAlpha: 0, x: 140, rotate: 3, duration: 1 }, profil.debut + 0.35)
      .from(".fiche__ruby, .fiche__nom, .fiche__classe", { autoAlpha: 0, y: 20, stagger: 0.08 }, profil.debut + 0.6)
      .from(".fiche__stats > div", { autoAlpha: 0, y: 30, stagger: 0.1 }, profil.debut + 0.85)
      .from(".fiche__devise", { autoAlpha: 0, x: -24 }, profil.debut + 1.6);
    sortieScene(".fiche", profil);

    // 03 · Arsenal
    const arsenal = SCENES[2];
    tl.from(".carte", { autoAlpha: 0, y: 90, rotate: (i) => (i % 2 ? 2.5 : -2.5), stagger: 0.15, duration: 1 }, arsenal.debut + 0.35)
      .from(".carte .tags li", { autoAlpha: 0, scale: 0.6, stagger: 0.025, duration: 0.4, ease: "back.out(2)" }, arsenal.debut + 1.0)
      .from(".carte__kanji", { autoAlpha: 0, y: 40, stagger: 0.15, duration: 0.8 }, arsenal.debut + 1.2);
    sortieScene(".arsenal", arsenal);

    // 04 · Projets : les couvertures arrivent, puis chacune se soulève quand la barre passe dessus
    const projets = SCENES[3];
    const couvs = $$(".couv");
    tl.from(couvs, { autoAlpha: 0, x: 700, rotate: 8, stagger: 0.14, duration: 1.1 }, projets.debut + 0.35)
      .from(".quetes__barre", { autoAlpha: 0, duration: 0.6 }, projets.debut + 1.0);
    const parQuete = (QUETES[1] - QUETES[0]) / couvs.length;
    couvs.forEach((c, i) => {
      const t = QUETES[0] + i * parQuete;
      tl.to(c, { y: -34, boxShadow: "0 0 0 2px rgba(139, 92, 246, 1), 0 34px 70px -26px rgba(139, 92, 246, 0.6)", duration: 0.4, ease: "back.out(2)" }, t);
      if (i < couvs.length - 1) tl.to(c, { y: 0, boxShadow: "0 0 0 0px rgba(139, 92, 246, 0), 0 30px 60px -30px rgba(0, 0, 0, 0.85)", duration: 0.35, ease: "power2.out" }, t + parQuete);
    });
    sortieScene([".quetes", ".quetes__barre"], projets);

    // 05 · Veille
    const veille = SCENES[4];
    tl.from(".flash", { autoAlpha: 0, x: 110, stagger: 0.14, duration: 1 }, veille.debut + 0.35)
      .from(".flash__tag", { scaleX: 0, transformOrigin: "left center", stagger: 0.14, duration: 0.5 }, veille.debut + 0.75);
    sortieScene(".radar", veille);

    // 06 · Contact, puis les deux moitiés se referment : またね
    const contact = SCENES[5];
    tl.from(".finale__titre .mot", { yPercent: 60, autoAlpha: 0, stagger: 0.12, duration: 1 }, contact.debut + 0.35)
      .from(".finale__desc", { autoAlpha: 0, y: 24 }, contact.debut + 0.9)
      .from(".finale__mail", { autoAlpha: 0, scale: 0.6, rotate: -4, duration: 0.6, ease: "back.out(2)" }, contact.debut + 1.3)
      .from(".finale__liens li", { autoAlpha: 0, y: 16, stagger: 0.08 }, contact.debut + 1.7)
      .to([".hud-logo", ".hud-points"], { autoAlpha: 0, duration: 0.4 }, 53.7)
      .fromTo(".rideau__moitie--haut", { yPercent: -101, x: -36, y: 8 }, { yPercent: 0, x: 0, y: 0, duration: 0.8, ease: "expo.inOut", immediateRender: false }, 54.0)
      .fromTo(".rideau__moitie--bas", { yPercent: 101, x: 36, y: -8 }, { yPercent: 0, x: 0, y: 0, duration: 0.8, ease: "expo.inOut", immediateRender: false }, 54.0)
      .to(".rideau__fin", { autoAlpha: 1, duration: 0.4 }, 54.6)
      .from(".rideau__matane", { scale: 1.3, autoAlpha: 0, filter: "blur(12px)", duration: 0.8, ease: "expo.out" }, 54.6)
      .from(".rideau__fin .rideau__titre, .rideau__fin .rideau__sous", { autoAlpha: 0, y: 20, stagger: 0.15, duration: 0.8 }, 55.0);

    return tl;
  }

  /* ─── RENDU D'UNE IMAGE ─── */
  let tl = null;
  let sceneCourante = null;
  let zoneCourante = 0;
  let dernierT = -1;
  const compteurs = $$("[data-compteur]").map((el) => ({ el, cible: +el.dataset.compteur, depart: +(el.dataset.depart || 0) }));

  function rendu(t) {
    tl.time(Math.min(t, DUREE));
    const s = SCENES.find((sc) => t < sc.fin) || SCENES[SCENES.length - 1];

    if (s !== sceneCourante) {
      // Nouvelle zone : la mascotte s'y rend en faisant un tour sur elle-même (géré par scene.js)
      zoneCourante = 1 - zoneCourante;
      const z = zones[zoneCourante];
      const [x, y, w, h] = s.zone;
      Object.assign(z.style, { left: x + "px", top: y + "px", width: w + "px", height: h + "px" });
      Object.assign(z.dataset, { rx: s.rx, ry: s.ry, lines: s.lines });
      zones.forEach((el) => el.classList.toggle("stage", el === z));
      ecran.dataset.screen = s.id;
      $$(".scene").forEach((el) => { el.style.visibility = el.dataset.scene === s.id ? "visible" : "hidden"; });
      const n = SCENES.indexOf(s);
      points.forEach((p, i) => p.classList.toggle("actif", i <= n));
      sceneCourante = s;
    }

    bulles.forEach((b) => frapper(b, t));

    // Compteurs de la fiche personnage
    const p = borne((t - SCENES[1].debut - 0.95) / 1.25, 0, 1);
    const doux = 1 - Math.pow(1 - p, 3);
    compteurs.forEach((c) => { c.el.textContent = Math.round(c.depart + (c.cible - c.depart) * doux); });

    // Progression des quêtes : écran de la mascotte (QUÊTE 01 → 04) + barre
    rig.progress = borne((t - QUETES[0]) / (QUETES[1] - QUETES[0]), 0, 0.999);
    barreQuetes.style.transform = `scaleX(${rig.progress})`;

    // Regard : vers le public quand Exo parle, sinon vers le contenu présenté
    const parle = bulles.some((b) => b.scene === s && t >= b.entree && t < b.sortie);
    const [rx, ry] = parle ? [window.innerWidth / 2, window.innerHeight / 2] : versFenetre(s.regard);
    window.dispatchEvent(new PointerEvent("pointermove", { clientX: rx, clientY: ry }));

    // Pétales : à l'ouverture et à chaque coup de katana, depuis le centre de l'écran
    GERBES.forEach((g) => {
      if (dernierT < g && t >= g && window.SAKURA) {
        const [x, y] = versFenetre([960, 540]);
        window.SAKURA.rafale(x, y, 26);
      }
    });

    // "Piqûre" : même réaction que quand on clique sur la mascotte dans le site
    if (dernierT < POKE && t >= POKE) {
      const [x, y, w, h] = SCENES[0].zone;
      const [px, py] = versFenetre([x + w / 2, y + h * 0.42]);
      (document.elementFromPoint(px, py) || document.body).dispatchEvent(new PointerEvent("pointerdown", { clientX: px, clientY: py, bubbles: true }));
    }
    dernierT = t;
  }

  /* ─── DÉMARRAGE ─── */
  function polices() {
    const charges = [
      '700 100px "Geist"',
      '400 30px "Geist"',
      '600 30px "Geist"',
      '500 20px "Geist Mono"',
      '700 20px "Geist Mono"',
    ].map((f) => document.fonts.load(f));
    const japonais = "未来侍刀冒険監視縁壱弐参肆伍陸創網守道人工知能作品集網路学習抜刀またねフィリップ・ヴィマンウェブ開発システム管理防御ツール速報";
    charges.push(document.fonts.load('800 60px "Shippori Mincho"', "Créateur suite évoluer " + japonais));
    charges.push(document.fonts.load('500 30px "Shippori Mincho"', japonais));
    charges.push(document.fonts.load('700 30px "Shippori Mincho"', japonais));
    const attente = new Promise((r) => setTimeout(r, 6000));
    return Promise.race([Promise.all(charges).then(() => document.fonts.ready), attente]);
  }

  const pret = polices().then(() => {
    preparerBulles();
    tl = construireTimeline();
    rendu(0);

    // Boucle : t = temps écoulé depuis le démarrage (horloge réelle en aperçu, virtuelle pendant le rendu MP4)
    let debut = performance.now();
    (function boucle() {
      requestAnimationFrame(boucle);
      let t = (performance.now() - debut) / 1000;
      if (!window.__CAPTURE && t > DUREE + 1.5) {
        debut = performance.now();
        dernierT = -1;
        t = 0;
      }
      rendu(t);
    })();
  });

  // Clic sur la mascotte (la "piqûre" de l'accueil) : gerbe de pétales, comme sur le site
  window.addEventListener("exo:poke", (e) => {
    if (window.SAKURA) window.SAKURA.rafale(e.detail.x, e.detail.y, 30);
  });

  window.VIDEO = { duree: DUREE, pret };
})();
