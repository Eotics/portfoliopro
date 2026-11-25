/* ==========================================
   build-cursors.js — Construction progressive (isolée)
   Style « essaim » : des dizaines de curseurs virtuels volent vers les
   pièces de la page. Chaque pièce (ligne de texte, bouton, image) est
   d'abord tracée en rectangle (poignées + dimensions), puis le texte
   s'écrit en direct avec des copies qui scintillent. Une barre
   « agents / layers » suit l'avancement. Rythmé par le scroll.
   Tout est temporaire : à la fin, le DOM et l'attribut style d'origine
   sont restaurés à l'identique.
========================================== */
(function () {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

  var BLEU = "#4f7cff";
  var ROUGE = "#ef4444";
  var PALETTE = ["#4f7cff", "#22d3ee", "#d946ef", "#a855f7", "#facc15", "#fb923c", "#4ade80", "#f472b6"];
  var DUREE_INTRO = 2200; // ms, blocs déjà visibles au chargement
  var ZONE = 0.45;        // fraction de la hauteur d'écran pour construire
  var PHASE_BOITE = 0.4;  // part de la progression pour tracer les rectangles
  var NB_CURSEURS = window.innerWidth < 600 ? 14 : 30;

  var items = [];
  var swarm = [];
  var debut = performance.now();
  var enAttente = false;
  var cv, g, dpr = 1, hud = null;
  var swarmAlpha = 0;
  var dernierActif = 0;
  var totalCouches = 0;

  function lisser(t) { return t * t * (3 - 2 * t); }
  function borne(v) { return Math.max(0, Math.min(1, v)); }

  function redim() {
    dpr = window.devicePixelRatio || 1;
    cv.width = Math.round(window.innerWidth * dpr);
    cv.height = Math.round(window.innerHeight * dpr);
  }

  /* ─── Pièces (feuilles) d'un bloc : lignes de texte, images ─── */
  function decouper(it) {
    it.feuilles = [];
    it.chars = [];
    it.noeuds = [];
    var parEl = new Map();
    var w = document.createTreeWalker(it.el, NodeFilter.SHOW_TEXT, null);
    var liste = [], n;
    while ((n = w.nextNode())) {
      var tag = n.parentNode.nodeName;
      if (tag === "SCRIPT" || tag === "STYLE" || tag === "svg" || !n.nodeValue.trim()) continue;
      // texte géré par main.js ou champs de saisie : on n'y touche pas
      if (n.parentNode.closest("#typewriter, textarea, option, #cf-status")) continue;
      liste.push(n);
    }
    liste.forEach(function (node) {
      var parent = node.parentNode;
      var f = parEl.get(parent);
      if (!f) {
        f = { el: parent, chars: [], montre: 0 };
        parEl.set(parent, f);
        it.feuilles.push(f);
      }
      var conteneur = document.createElement("span");
      var txt = node.nodeValue;
      for (var i = 0; i < txt.length; i++) {
        var s = document.createElement("span");
        s.textContent = txt[i];
        s.style.opacity = "0";
        conteneur.appendChild(s);
        f.chars.push(s);
      }
      parent.replaceChild(conteneur, node);
      it.noeuds.push({ orig: node, wrap: conteneur });
    });
    it.el.querySelectorAll("img, svg").forEach(function (m) {
      it.feuilles.push({ el: m, chars: [], montre: 0 });
    });
    if (!it.feuilles.length) it.feuilles.push({ el: it.el, chars: [], montre: 0 });
    var nb = it.feuilles.length;
    it.feuilles.forEach(function (f, i) {
      f.debut = (i / nb) * 0.45 + Math.random() * 0.04;
      f.rouge = i % 4 === 3;
    });
    totalCouches += nb;
  }

  function majFeuille(f, nb) {
    for (var k = f.montre; k < nb; k++) f.chars[k].style.opacity = "";
    for (var j = f.montre - 1; j >= nb; j--) f.chars[j].style.opacity = "0";
    f.montre = nb;
  }
  function restaurerTexte(it) {
    it.noeuds.forEach(function (o) {
      if (o.wrap.parentNode) o.wrap.parentNode.replaceChild(o.orig, o.wrap);
    });
    it.noeuds = [];
    it.feuilles.forEach(function (f) { f.chars = []; });
  }

  /* ─── Barre « agents / layers » ─── */
  function creerHud() {
    hud = document.createElement("div");
    hud.setAttribute("aria-hidden", "true");
    hud.style.cssText =
      "position:fixed;left:50%;bottom:20px;transform:translateX(-50%);z-index:1001;" +
      "pointer-events:none;opacity:0;transition:opacity .4s ease;display:flex;align-items:center;" +
      "gap:10px;padding:7px 14px;border-radius:10px;background:rgba(18,18,24,.94);" +
      "border:1px solid rgba(255,255,255,.12);font:500 10px/1 'JetBrains Mono',monospace;" +
      "color:#cfd3e0;white-space:nowrap;";
    var pastilles = PALETTE.slice(0, 5).map(function (c) {
      return '<i style="display:inline-block;width:9px;height:9px;border-radius:50%;margin-right:-4px;background:' + c + '"></i>';
    }).join("");
    hud.innerHTML =
      "<span>" + pastilles + "</span><span style='margin-left:6px'><b data-a>0</b> agents</span>" +
      "<span><b data-c>0</b> / <b>" + totalCouches + "</b> layers</span>" +
      "<span style='display:inline-block;width:70px;height:2px;background:rgba(255,255,255,.15)'>" +
      "<i data-b style='display:block;height:2px;width:0;background:" + BLEU + "'></i></span>" +
      "<span style='padding:3px 7px;border-radius:5px;background:rgba(255,255,255,.1)'>Tour</span>" +
      "<span style='padding:3px 7px;border-radius:5px;background:rgba(255,255,255,.1)'>1x</span>" +
      "<span style='padding:3px 7px;border-radius:5px;background:rgba(255,255,255,.1)'>✕</span>";
    document.body.appendChild(hud);
  }
  function majHud(couches, agents, visible) {
    if (!hud) return;
    hud.style.opacity = visible ? "1" : "0";
    hud.querySelector("[data-a]").textContent = agents;
    hud.querySelector("[data-c]").textContent = couches;
    hud.querySelector("[data-b]").style.width = (totalCouches ? (couches / totalCouches) * 100 : 0) + "%";
  }

  function init() {
    var vh = window.innerHeight;
    cv = document.createElement("canvas");
    cv.setAttribute("aria-hidden", "true");
    cv.style.cssText =
      "position:fixed;left:0;top:0;width:100%;height:100%;z-index:999;pointer-events:none;";
    document.body.appendChild(cv);
    g = cv.getContext("2d");
    redim();

    var n = 0;
    document.querySelectorAll(".reveal").forEach(function (el) {
      var r = el.getBoundingClientRect();
      var it = {
        el: el, fini: false, p: -1, nb: 0,
        intro: r.top < vh * 0.92,
        delai: 0,
        styleOrigine: el.getAttribute("style"),
      };
      if (it.intro) { it.delai = 150 + n * 90; n++; }
      decouper(it);
      it.nb = it.feuilles.length;
      items.push(it);
      appliquer(it, 0);
    });
    creerHud();
    for (var i = 0; i < NB_CURSEURS; i++) {
      swarm.push({
        x: Math.random() * window.innerWidth, y: Math.random() * window.innerHeight,
        wx: Math.random() * window.innerWidth, wy: Math.random() * window.innerHeight,
        c: PALETTE[i % PALETTE.length], k: i % 6 === 0 ? "i" : i % 6 === 3 ? "+" : "a",
        ph: Math.random() * 6.28,
      });
    }
    demander();
  }

  /* contenu masqué, puis révélé de gauche à droite */
  function appliquer(it, p) {
    var w = lisser(borne((p - PHASE_BOITE) / (1 - PHASE_BOITE)));
    it.el.style.clipPath = "inset(-200px " + ((1 - w) * 100).toFixed(2) + "% -200px -200px)";
  }

  function terminer(it) {
    it.fini = true;
    restaurerTexte(it);
    if (it.styleOrigine === null) it.el.removeAttribute("style");
    else it.el.setAttribute("style", it.styleOrigine);
  }

  /* ─── Dessins ─── */
  function poignees(x1, y1, x2, y2, col) {
    g.fillStyle = "#fff";
    g.strokeStyle = col;
    g.lineWidth = 1;
    [[x1, y1], [x2, y1], [x1, y2], [x2, y2]].forEach(function (c) {
      g.fillRect(c[0] - 2.5, c[1] - 2.5, 5, 5);
      g.strokeRect(c[0] - 2.5, c[1] - 2.5, 5, 5);
    });
  }

  function etiquette(w, h, x, y, col) {
    var txt = Math.round(w) + " × " + Math.round(h);
    g.font = "9px 'JetBrains Mono',monospace";
    var tw = g.measureText(txt).width + 10;
    g.fillStyle = col;
    g.fillRect(x - tw / 2, y + 6, tw, 13);
    g.fillStyle = "#fff";
    g.fillText(txt, x - tw / 2 + 5, y + 16);
  }

  var cacheFont = new WeakMap();
  function policeDe(el) {
    var c = cacheFont.get(el);
    if (!c) {
      var cs = getComputedStyle(el);
      c = cs.fontStyle + " " + cs.fontWeight + " " + cs.fontSize + " " + cs.fontFamily;
      cacheFont.set(el, c);
    }
    return c;
  }

  // copies décalées et scintillantes des dernières lettres écrites
  function glitch(f) {
    var font = policeDe(f.el);
    g.font = font;
    g.textBaseline = "alphabetic";
    for (var q = 0; q < 7 && f.montre - 1 - q >= 0; q++) {
      var ch = f.chars[f.montre - 1 - q];
      var cr = ch.getBoundingClientRect();
      var t = ch.textContent;
      if (!t.trim()) continue;
      for (var d = 0; d < 2; d++) {
        g.globalAlpha = 0.55 * (1 - q / 7);
        g.fillStyle = d ? "#d946ef" : "#22d3ee";
        g.fillText(t, cr.left + (Math.random() - 0.5) * 7, cr.top + cr.height * 0.78 + (Math.random() - 0.5) * 5);
      }
    }
  }

  function curseur(c, a) {
    g.save();
    g.translate(c.x, c.y);
    g.globalAlpha = a;
    g.fillStyle = c.c;
    g.strokeStyle = c.c;
    g.lineWidth = 1.5;
    if (c.k === "i") {
      g.beginPath();
      g.moveTo(-3, -6); g.lineTo(3, -6); g.moveTo(0, -6); g.lineTo(0, 6); g.moveTo(-3, 6); g.lineTo(3, 6);
      g.stroke();
    } else if (c.k === "+") {
      g.beginPath();
      g.moveTo(-5, 0); g.lineTo(5, 0); g.moveTo(0, -5); g.lineTo(0, 5);
      g.stroke();
    } else {
      g.beginPath();
      g.moveTo(0, 0); g.lineTo(0, 13); g.lineTo(3.3, 10); g.lineTo(5.6, 15); g.lineTo(7.6, 14); g.lineTo(5.3, 9); g.lineTo(9.8, 9);
      g.closePath();
      g.fill();
    }
    g.restore();
  }

  function frame(now) {
    enAttente = false;
    var vh = window.innerHeight, vw = window.innerWidth;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, vw, vh);

    var cibles = [];
    var actif = false;
    var couches = 0;

    items.forEach(function (it) {
      if (it.fini) { couches += it.nb; return; }
      var p, r = it.el.getBoundingClientRect();
      if (it.intro) {
        p = borne((now - debut - it.delai) / DUREE_INTRO);
      } else {
        // distance de construction réduite pour les blocs du bas de page,
        // qui ne pourront jamais monter assez haut dans l'écran
        var maxScroll = document.documentElement.scrollHeight - vh;
        var topMin = r.top + window.scrollY - maxScroll;
        var D = Math.max(40, Math.min(vh * ZONE, vh - topMin - 4));
        p = borne((vh - r.top) / D);
      }
      if (p >= 1) { terminer(it); couches += it.nb; return; }
      if (p !== it.p) { it.p = p; appliquer(it, p); }
      var visible = r.bottom > 0 && r.top < vh;
      if (p > 0 || it.intro) actif = true;

      // pièces du bloc
      it.feuilles.forEach(function (f, idx) {
        var lp = borne((p - f.debut) / 0.55);
        if (f.chars.length) majFeuille(f, Math.floor(borne((lp - PHASE_BOITE) / (1 - PHASE_BOITE)) * f.chars.length));
        if (lp >= 1) couches++;
        if (!visible) return;
        var fr = f.el.getBoundingClientRect();
        if (fr.bottom < 0 || fr.top > vh) return;
        if (p <= 0) {
          g.globalAlpha = 0.35;
          g.strokeStyle = BLEU;
          g.lineWidth = 1;
          g.strokeRect(fr.left + 0.5, fr.top + 0.5, fr.width, fr.height);
          return;
        }
        if (lp <= 0) return;
        var b = lisser(borne(lp / PHASE_BOITE));
        var a = 1 - borne((lp - 0.85) / 0.15);
        var col = f.rouge && lp < 0.5 ? ROUGE : BLEU;
        var x2 = fr.left + fr.width * b, y2 = fr.top + fr.height * b;
        g.globalAlpha = 0.14 * a * (1 - lisser(borne((lp - PHASE_BOITE) / 0.3)));
        g.fillStyle = col;
        g.fillRect(fr.left, fr.top, x2 - fr.left, y2 - fr.top);
        g.globalAlpha = a;
        g.strokeStyle = col;
        g.lineWidth = 1;
        g.strokeRect(fr.left + 0.5, fr.top + 0.5, x2 - fr.left, y2 - fr.top);
        poignees(fr.left, fr.top, x2, y2, col);
        if (fr.width * b > 50) { g.globalAlpha = a; etiquette(fr.width * b, fr.height * b, (fr.left + x2) / 2, y2, col); }
        if (f.chars.length && lp > PHASE_BOITE && lp < 0.95) { glitch(f); }

        // cible pour un curseur : coin tiré, puis point d'écriture
        if (lp < 1) {
          if (lp < PHASE_BOITE) cibles.push({ x: x2, y: y2 });
          else if (f.montre > 0 && f.chars[f.montre - 1]) {
            var cr = f.chars[f.montre - 1].getBoundingClientRect();
            cibles.push({ x: cr.right, y: cr.bottom });
          } else cibles.push({ x: fr.left + fr.width / 2, y: fr.top + fr.height / 2 });
        }
      });

      // contour fin du bloc entier
      if (visible && p > 0) {
        g.globalAlpha = 0.3 * (1 - p);
        g.strokeStyle = BLEU;
        g.lineWidth = 1;
        g.strokeRect(r.left + 0.5, r.top + 0.5, r.width, r.height);
      }
    });
    g.globalAlpha = 1;

    // essaim de curseurs : certains vont aux pièces en cours, les autres rôdent
    if (actif) dernierActif = now;
    var cible = actif ? 1 : 0;
    swarmAlpha += (cible - swarmAlpha) * 0.08;
    if (swarmAlpha > 0.03) {
      var agents = 0;
      swarm.forEach(function (c, i) {
        var tx, ty, v = 0.07;
        if (cibles.length && i < NB_CURSEURS * 0.7) {
          var t = cibles[i % cibles.length];
          tx = t.x; ty = t.y; v = 0.16; agents++;
        } else {
          if (Math.abs(c.x - c.wx) + Math.abs(c.y - c.wy) < 25) {
            c.wx = Math.random() * vw; c.wy = Math.random() * vh;
          }
          tx = c.wx; ty = c.wy;
        }
        c.x += (tx - c.x) * v + Math.sin(now * 0.006 + c.ph) * 1.2;
        c.y += (ty - c.y) * v + Math.cos(now * 0.005 + c.ph) * 1.2;
        curseur(c, swarmAlpha);
      });
      g.globalAlpha = 1;
      majHud(couches, Math.max(agents, Math.round(NB_CURSEURS * 0.6)), actif);
    } else {
      majHud(couches, 0, false);
    }

    if (actif || swarmAlpha > 0.03) demander();
  }

  function demander() {
    if (enAttente) return;
    enAttente = true;
    requestAnimationFrame(frame);
  }

  window.addEventListener("scroll", demander, { passive: true });
  window.addEventListener("resize", function () {
    if (cv) redim();
    demander();
  });

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
