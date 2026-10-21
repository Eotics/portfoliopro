/* ==========================================
   main.js — Animations de la maquette
   GSAP + ScrollTrigger + SplitText + Lenis (dossier vendor/)

   Système de mouvement :
   - révélations "masquées" (le texte monte depuis sous une ligne invisible)
   - une seule courbe principale (expo.out) et des durées cohérentes
   - la mascotte 3D (js/scene.js) se cale seule sur les zones .stage ;
     ici on gère seulement son intro (EXO_RIG.intro) et la progression des projets
========================================== */

(function () {
  const reduit = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const rig = (window.EXO_RIG = { intro: 1, progress: 0 });

  const EASE = "expo.out";
  const DUREE = 1.1;

  /* ─── MENU MOBILE ─── */
  const burger = document.querySelector(".nav__burger");
  const menu = document.getElementById("menu");
  function basculerMenu(ouvrir) {
    burger.setAttribute("aria-expanded", ouvrir ? "true" : "false");
    burger.setAttribute("aria-label", ouvrir ? "Fermer le menu" : "Ouvrir le menu");
    menu.hidden = !ouvrir;
    if (ouvrir) menu.querySelector("a").focus();
  }
  burger.addEventListener("click", () => basculerMenu(menu.hidden));
  menu.querySelectorAll("a").forEach((a) => a.addEventListener("click", () => basculerMenu(false)));
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !menu.hidden) {
      basculerMenu(false);
      burger.focus();
    }
  });

  /* ─── SON QUAND ON CLIQUE SUR LA MASCOTTE ───
     "J'AVOUEEEE" : extrait audio dans maquette/sons/javoue.m4a */
  const javoue = new Audio("sons/javoue.m4a");
  javoue.preload = "auto";

  // Un nouveau clic relance le son depuis le début
  function direJavoue() {
    javoue.currentTime = 0;
    javoue.play().catch(() => {}); // lecture refusée ou fichier illisible : on reste silencieux
  }

  /* ─── RÉACTION QUAND ON CLIQUE SUR LA MASCOTTE ─── */
  window.addEventListener("exo:poke", (e) => {
    direJavoue();
    // Gerbe de pétales de sakura depuis le point cliqué (js/sakura.js, absent si "réduire les animations")
    if (window.SAKURA) window.SAKURA.rafale(e.detail.x, e.detail.y, 30);
  });

  /* ─── VIDÉO "EXO PRÉSENTE LE PORTFOLIO" (fenêtre par-dessus la page) ─── */
  const fenetreVideo = document.getElementById("video-modal");
  const lecteur = fenetreVideo.querySelector("video");
  document.querySelectorAll("[data-video-ouvrir]").forEach((bouton) =>
    bouton.addEventListener("click", () => {
      fenetreVideo.showModal();
      lecteur.currentTime = 0;
      lecteur.play().catch(() => {}); // lecture auto refusée : le visiteur lance avec les contrôles
    })
  );
  fenetreVideo.querySelector("[data-video-fermer]").addEventListener("click", () => fenetreVideo.close());
  // Clic sur le fond sombre autour de la vidéo : on ferme (Échap ferme aussi, géré par <dialog>)
  fenetreVideo.addEventListener("click", (e) => {
    if (e.target === fenetreVideo) fenetreVideo.close();
  });
  fenetreVideo.addEventListener("close", () => lecteur.pause());
  // Les clics dans la fenêtre ne doivent pas atteindre la mascotte 3D qui est derrière
  fenetreVideo.addEventListener("pointerdown", (e) => e.stopPropagation());

  // Sans GSAP ou avec "réduire les animations" : page statique, tout reste lisible
  if (!window.gsap || !window.ScrollTrigger || !window.SplitText || reduit) {
    const loader = document.querySelector(".loader");
    if (loader) loader.remove();
    return;
  }

  gsap.registerPlugin(ScrollTrigger, SplitText);
  gsap.defaults({ ease: EASE, duration: DUREE });

  /* ─── SCROLL FLUIDE (Lenis) ─── */
  const lenis = new Lenis({ lerp: 0.09, wheelMultiplier: 0.9 });
  lenis.on("scroll", ScrollTrigger.update);
  gsap.ticker.add((t) => lenis.raf(t * 1000));
  gsap.ticker.lagSmoothing(0);

  const hauteurNav = () => document.querySelector(".nav").offsetHeight;
  document.querySelectorAll('a[href^="#"]').forEach((lien) => {
    lien.addEventListener("click", (e) => {
      const cible = document.querySelector(lien.getAttribute("href"));
      if (!cible) return;
      e.preventDefault();
      lenis.scrollTo(cible, { offset: cible.id === "accueil" ? 0 : -hauteurNav() + 1, duration: 1.4 });
    });
  });

  /* ─── PROJETS : scroll horizontal épinglé (desktop) ─── */
  // Créé avant les déclencheurs suivants pour que leurs positions tiennent compte de l'épinglage
  const mm = gsap.matchMedia();
  mm.add("(min-width: 901px)", () => {
    const piste = document.querySelector(".quests__track");
    const compteurQuetes = document.querySelector(".quests__count");
    const distance = () => piste.scrollWidth - window.innerWidth;
    gsap.to(piste, {
      x: () => -distance(),
      ease: "none",
      scrollTrigger: {
        trigger: ".quests",
        start: "top top",
        end: () => "+=" + distance(),
        pin: true,
        scrub: 0.8,
        invalidateOnRefresh: true,
        onUpdate: (self) => {
          rig.progress = self.progress;
          gsap.set(".quests__progress span", { scaleX: self.progress });
          compteurQuetes.textContent = String(Math.min(4, Math.floor(self.progress * 4) + 1)).padStart(2, "0") + " / 04";
        },
      },
    });
    // Les couvertures se redressent en entrant à l'écran
    gsap.utils.toArray(".cover").forEach((c, i) => {
      gsap.fromTo(c, { y: 60, rotate: i % 2 ? 2 : -2, autoAlpha: 0 }, { y: 0, rotate: 0, autoAlpha: 1, duration: 1, delay: i * 0.08, clearProps: "transform", scrollTrigger: { trigger: ".quests", start: "top 70%", once: true } });
    });
  });

  /* ─── INTRO ─── */
  lenis.stop();
  rig.intro = 0;

  // 1) Chargement : compteur + barre
  const compteur = { v: 0 };
  const chargement = gsap.to(compteur, {
    v: 100,
    duration: 1.2,
    ease: "power3.inOut",
    onUpdate: () => {
      document.querySelector(".loader__count").textContent = String(Math.round(compteur.v)).padStart(3, "0");
      gsap.set(".loader__bar span", { scaleX: compteur.v / 100 });
    },
  });

  // 2) Ouverture : seulement quand les polices sont chargées, sinon les coupures de lignes seraient fausses
  const policesPretes = Promise.race([document.fonts ? document.fonts.ready : Promise.resolve(), new Promise((r) => setTimeout(r, 3000))]);
  Promise.all([policesPretes, chargement.then()]).then(() => {
    const lignesHero = gsap.utils.toArray(".hero__line").map((el) => SplitText.create(el, { type: "words, chars", mask: "words" }));
    const descHero = SplitText.create(".hero__desc", { type: "lines", mask: "lines" });

    // Le trait du sabre suit exactement la découpe des deux moitiés (de 61 % à gauche à 39 % à droite)
    const angleCoupe = (Math.atan2(-0.22 * window.innerHeight, window.innerWidth) * 180) / Math.PI;
    document.querySelector(".loader__slash").style.setProperty("--angle", angleCoupe + "deg");

    gsap
      .timeline({
        onComplete: () => {
          // On rend le texte d'origine : il se recoupe naturellement si la fenêtre change de taille
          descHero.revert();
          lignesHero.forEach((l) => l.revert());
          lenis.start();
          ScrollTrigger.refresh();
        },
      })
      .to(".loader__content", { autoAlpha: 0, y: -12, duration: 0.4, ease: "power2.in" })
      // Coup de katana : le trait traverse l'écran, les moitiés glissent le long de la coupe puis s'écartent
      .fromTo(".loader__slash span", { scaleX: 0 }, { scaleX: 1, duration: 0.3, ease: "power4.out" })
      .addLabel("coupe")
      .to(".loader__half--top", { x: -28, y: 6, duration: 0.35, ease: "power2.out" }, "coupe")
      .to(".loader__half--bottom", { x: 28, y: -6, duration: 0.35, ease: "power2.out" }, "coupe")
      .to(".loader__slash", { autoAlpha: 0, duration: 0.4 }, "coupe+=0.15")
      .addLabel("ouverture", "coupe+=0.3")
      .to(".loader__half--top", { yPercent: -100, duration: 1, ease: "expo.inOut" }, "ouverture")
      .to(".loader__half--bottom", { yPercent: 100, duration: 1, ease: "expo.inOut" }, "ouverture")
      .set(".loader", { display: "none" })
      .to(rig, { intro: 1, duration: 1.4, ease: "back.out(1.3)" }, "ouverture+=0.45")
      .from(".pill", { autoAlpha: 0, y: 16, duration: 0.8 }, "ouverture+=0.5")
      .from(lignesHero[0].chars, { yPercent: 110, duration: 1.2, stagger: 0.025 }, "ouverture+=0.55")
      .from(lignesHero[1].chars, { yPercent: 110, duration: 1.2, stagger: 0.025 }, "ouverture+=0.68")
      .from(descHero.lines, { yPercent: 110, duration: 1, stagger: 0.08 }, "ouverture+=0.9")
      // fromTo : le bouton a une transition CSS sur transform, une valeur d'arrivée explicite évite qu'il reste décalé
      .fromTo([".hero__ctas > *", ".socials li"], { autoAlpha: 0, y: 24 }, { autoAlpha: 1, y: 0, duration: 0.9, stagger: 0.06, clearProps: "transform" }, "ouverture+=1.05")
      .from(".hero__meta > *", { autoAlpha: 0, y: 10, duration: 0.8, stagger: 0.08 }, "ouverture+=1.1")
      .from(".hero__sakura", { autoAlpha: 0, duration: 1.8, ease: "power2.out" }, "ouverture+=0.6")
      .from(".stage--hero .bubble", { scale: 0, transformOrigin: "20% 100%", duration: 0.7, ease: "back.out(2)" }, "ouverture+=1.35");
  });

  /* ─── EN-TÊTES DE SECTION ─── */
  gsap.utils.toArray(".section .sec-head, .quests .sec-head").forEach((tete) => {
    const titre = tete.querySelector(".sec-head__title");
    const meta = tete.querySelector(".sec-head__meta");
    const regle = tete.querySelector(".sec-head__rule");
    const lead = tete.querySelector(".sec-head__lead");
    SplitText.create(titre, {
      type: "lines",
      mask: "lines",
      autoSplit: true,
      onSplit: (self) => {
        const tl = gsap.timeline({ scrollTrigger: { trigger: tete, start: "top 82%", once: true } });
        tl.from(meta.children, { autoAlpha: 0, x: -12, duration: 0.8, stagger: 0.08 })
          // Le katana se dégaine : révélé de la poignée vers la pointe
          .fromTo(regle, { clipPath: "inset(0% 100% 0% 0%)" }, { clipPath: "inset(0% 0% 0% 0%)", duration: 1.1, ease: "expo.inOut" }, 0.1)
          .from(self.lines, { yPercent: 110, duration: 1.2, stagger: 0.1 }, 0.1);
        if (lead) tl.from(lead, { autoAlpha: 0, y: 20, duration: 1 }, 0.35);
        return tl;
      },
    });
  });

  /* ─── CARTES ─── */
  ScrollTrigger.batch("[data-reveal]", {
    start: "top 88%",
    once: true,
    // fromTo + clearProps : valeurs finales garanties et l'effet de survol CSS reste actif après l'apparition
    onEnter: (els) =>
      gsap.fromTo(els, { autoAlpha: 0, y: 48 }, { autoAlpha: 1, y: 0, duration: 1.1, stagger: 0.09, overwrite: "auto", clearProps: "transform" }),
  });

  // Kanjis décoratifs en parallaxe
  gsap.utils.toArray(".ornament").forEach((o) => {
    gsap.fromTo(o, { yPercent: -12 }, { yPercent: 12, ease: "none", scrollTrigger: { trigger: o.parentElement, start: "top bottom", end: "bottom top", scrub: true } });
  });

  /* ─── NAV : se cache en descendant, réapparaît en remontant ─── */
  const nav = document.querySelector(".nav");
  ScrollTrigger.create({
    start: 0,
    end: "max",
    onUpdate: (self) => {
      gsap.set(".nav__progress span", { scaleX: self.progress });
      const cacher = self.direction === 1 && self.scroll() > window.innerHeight * 0.6;
      nav.classList.toggle("is-hidden", cacher && menu.hidden);
    },
  });

  const liensNav = document.querySelectorAll(".nav__links a");
  document.querySelectorAll("[data-screen]").forEach((section) => {
    ScrollTrigger.create({
      trigger: section,
      start: "top 50%",
      end: "bottom 50%",
      onToggle: (self) => {
        if (!self.isActive) return;
        liensNav.forEach((a) => a.classList.toggle("is-active", a.getAttribute("href") === "#" + section.id));
      },
    });
  });

  /* ─── COUP DE KATANA SUR LA BANDE : le trait part de la gauche, des pétales s'envolent ─── */
  gsap.fromTo(".coupe__trait", { scaleX: 0 }, {
    scaleX: 1,
    duration: 0.5,
    ease: "power4.out",
    scrollTrigger: { trigger: ".coupe", start: "top 75%", once: true },
    onComplete: () => {
      const r = document.querySelector(".coupe").getBoundingClientRect();
      if (window.SAKURA) window.SAKURA.rafale(r.left + r.width * 0.62, r.top + r.height / 2, 18);
    },
  });

  /* ─── BANDE DÉFILANTE (accélère avec la vitesse de scroll) ─── */
  const bandes = gsap.utils.toArray("[data-marquee]").map((piste) =>
    piste.hasAttribute("data-reverse")
      ? gsap.fromTo(piste, { xPercent: -50 }, { xPercent: 0, duration: 26, ease: "none", repeat: -1 })
      : gsap.to(piste, { xPercent: -50, duration: 26, ease: "none", repeat: -1 })
  );
  const retourAuCalme = gsap.delayedCall(0.2, () => bandes.forEach((b) => gsap.to(b, { timeScale: 1, duration: 1, ease: "power2.out", overwrite: true }))).pause();
  ScrollTrigger.create({
    onUpdate: (self) => {
      const vitesse = 1 + Math.min(Math.abs(self.getVelocity()) / 250, 5);
      bandes.forEach((b) => gsap.to(b, { timeScale: vitesse, duration: 0.25, ease: "power2.out", overwrite: true }));
      retourAuCalme.restart(true);
    },
  });

  /* ─── EFFETS SOURIS (uniquement souris / trackpad) ─── */
  if (window.matchMedia("(hover: hover) and (pointer: fine)").matches) {
    // Boutons magnétiques (CTA principaux seulement)
    document.querySelectorAll("[data-magnetic]").forEach((el) => {
      const xTo = gsap.quickTo(el, "x", { duration: 0.8, ease: "elastic.out(1, 0.45)" });
      const yTo = gsap.quickTo(el, "y", { duration: 0.8, ease: "elastic.out(1, 0.45)" });
      el.addEventListener("pointermove", (e) => {
        const r = el.getBoundingClientRect();
        xTo((e.clientX - r.left - r.width / 2) * 0.25);
        yTo((e.clientY - r.top - r.height / 2) * 0.25);
      });
      el.addEventListener("pointerleave", () => {
        xTo(0);
        yTo(0);
      });
    });

    // Couvertures inclinées en 3D au survol
    document.querySelectorAll("[data-tilt]").forEach((carte) => {
      const cible = carte.querySelector("a");
      const rx = gsap.quickTo(cible, "rotationX", { duration: 0.6, ease: "power3.out" });
      const ry = gsap.quickTo(cible, "rotationY", { duration: 0.6, ease: "power3.out" });
      carte.addEventListener("pointermove", (e) => {
        const r = carte.getBoundingClientRect();
        ry(((e.clientX - r.left) / r.width - 0.5) * 12);
        rx(-((e.clientY - r.top) / r.height - 0.5) * 9);
      });
      carte.addEventListener("pointerleave", () => {
        rx(0);
        ry(0);
      });
    });
  }

  // Recalcule les positions une fois les polices chargées
  document.fonts && document.fonts.ready.then(() => {
    ScrollTrigger.sort();
    ScrollTrigger.refresh();
  });
})();
