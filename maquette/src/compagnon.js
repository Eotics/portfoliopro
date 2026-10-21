/* ==========================================
   compagnon.js — Le compagnon IA de Philippe, dessiné sur l'écran de la mascotte
   Un slime-chat : corps de gelée, oreilles de chat, ailes de chauve-souris, deux orbes
   flottants, une auréole, des moustaches, une bouche "ω" et une marque sur le front.

   Les couleurs viennent du fichier exporté de Nexus (new cat fighter.nexuscombo.json, à la racine
   du dépôt) : on peut le réexporter puis recompiler, le compagnon suit.
   Les expressions et animations reprennent celles du fichier (animationMap / expressionMap).

   Coordonnées du dessin : celles de l'image de référence (≈ 340 × 220), corps centré en x = 180.
========================================== */

import combo from "../../new cat fighter.nexuscombo.json";

// Couleurs d'un calque du fichier, complétées par les couleurs par défaut de Nexus
function couleurs(id, defaut) {
  const calque = combo.data.layers.find((l) => l.assetId === "builtin/" + id && !l.hidden);
  return { ...defaut, ...(calque ? calque.colors : {}) };
}
const C = {
  corps: couleurs("nexus_blob", { primary: "#f4f2ff", secondary: "#c7c3ff", accent: "#9cc0ff", glow: "#6f9bff" }),
  orbes: couleurs("floaty_fins", { primary: "#dcd8ff", secondary: "#9fe3ff", glow: "#7aa2ff" }),
  yeux: couleurs("blob_eyes", { primary: "#12131c" }),
  moustaches: couleurs("cat_whiskers", { primary: "#8a8fb5" }),
  oreilles: couleurs("soft_cat_ears", { primary: "#e9e6ff", secondary: "#ffb6cf" }),
  ailes: couleurs("mini_bat_wings", { primary: "#2fb5b0", secondary: "#1a6f7a" }),
  aureole: couleurs("glow_halo", { primary: "#ffe680" }),
  bouche: couleurs("cat_mouth", { primary: "#1b1f2a" }),
  marque: couleurs("anger_mark", { primary: "#ff4d5e" }),
  badge: { primary: "#c4b5fd", secondary: "#8b5cf6" }, // pastilles d'état aux couleurs du site
};

export const NOM_COMPAGNON = (combo.name || "compagnon").toUpperCase();

// Même correspondance que dans Nexus : expression → animation du corps
const ANIMATION = { normal: "float", focused: "work", thinking: "sway", curious: "sway", happy: "dance", surprised: "bounce" };

const TOUR = Math.PI * 2;
const ondule = (t, periode) => Math.sin((t / periode) * TOUR);

// Le corps : dôme de gelée, plus large en bas
const CORPS = new Path2D("M97 166C97 110 135 81 180 81C225 81 263 110 263 166C263 201 226 212 180 212C134 212 97 201 97 166Z");

/**
 * x : contexte 2D · t : temps (s)
 * o : { cx, cy, echelle, expression, regard: [-1..1, -1..1], clignement, poke, reduit }
 */
export function dessinerCompagnon(x, t, o) {
  const vit = o.reduit ? 0 : 1;
  const anim = ANIMATION[o.expression] || "float";
  const [rx, ry] = o.regard || [0, 0];
  const ox = rx * 5, oy = -ry * 3.5; // le regard suit la souris

  // Animation du corps entier (pivot : bas du corps)
  let dy = 0, rot = 0, ecrase = 0;
  if (anim === "float") dy = -4 * (0.5 - 0.5 * Math.cos((t / 3) * TOUR));
  if (anim === "sway") rot = ondule(t, 2.6) * 0.07;
  if (anim === "work") dy = -Math.abs(ondule(t, 0.9)) * 3;
  if (anim === "dance") { rot = ondule(t, 0.8) * 0.12; dy = -Math.abs(ondule(t, 0.8)) * 7; }
  if (anim === "bounce") dy = -Math.abs(ondule(t, 0.7)) * 8;
  if (o.poke > 0) ecrase = Math.sin((1.2 - o.poke) * 18) * 0.1 * o.poke;
  else ecrase = ondule(t, 2) * 0.02;
  if (o.reduit) dy = rot = ecrase = 0;

  x.save();
  x.translate(o.cx, o.cy);
  x.scale(o.echelle, o.echelle);
  x.translate(-180, -124);
  x.lineCap = "round";
  x.lineJoin = "round";

  // Ombre lumineuse au sol (reste au sol quand il flotte : elle rétrécit)
  const sol = 1 + dy / 40;
  x.save();
  x.translate(180, 214);
  x.scale(sol, 1);
  const ombre = x.createRadialGradient(0, 0, 0, 0, 0, 80);
  ombre.addColorStop(0, hexa(C.corps.glow, 0.75));
  ombre.addColorStop(0.5, hexa(C.corps.glow, 0.3));
  ombre.addColorStop(1, hexa(C.corps.glow, 0));
  x.fillStyle = ombre;
  x.beginPath(); x.ellipse(0, 0, 80, 12, 0, 0, TOUR); x.fill();
  x.restore();

  x.translate(0, dy);
  x.translate(180, 212); x.rotate(rot); x.scale(1 + ecrase, 1 - ecrase); x.translate(-180, -212);

  // ─── Ailes de chauve-souris (derrière tout) : battent vite ───
  [-1, 1].forEach((cote) => {
    x.save();
    x.translate(180 + cote * 72, 112);
    x.scale(-cote, 1); // l'aile est dessinée vers la gauche : on la retourne pour le côté droit
    x.rotate(-Math.max(0, ondule(t, 0.9)) * 0.21 * vit);
    const aile = x.createLinearGradient(0, -26, 0, 16);
    aile.addColorStop(0, C.ailes.primary);
    aile.addColorStop(1, C.ailes.secondary);
    x.fillStyle = aile;
    x.beginPath();
    x.moveTo(6, -8);
    x.bezierCurveTo(-8, -28, -38, -28, -57, -17);
    x.quadraticCurveTo(-47, -6, -41, 6);
    x.quadraticCurveTo(-34, -3, -27, 8);
    x.quadraticCurveTo(-19, 1, -11, 13);
    x.quadraticCurveTo(-3, 8, 6, 14);
    x.closePath();
    x.fill();
    x.restore();
  });

  // ─── Orbes flottants (devant les ailes, derrière le corps) ───
  [-1, 1].forEach((cote, i) => {
    x.save();
    x.translate(180 + cote * 107, 137);
    x.rotate(cote * 0.45 + (ondule(t + i * 1.3, 3.7 + i * 0.6) * 0.06 - 0.04) * cote * vit);
    x.shadowColor = hexa(C.orbes.glow, 0.8);
    x.shadowBlur = 10;
    const orbe = x.createLinearGradient(-14, -20, 14, 20);
    orbe.addColorStop(0, "#ffffff");
    orbe.addColorStop(0.45, C.orbes.primary);
    orbe.addColorStop(1, C.orbes.secondary);
    x.fillStyle = orbe;
    x.globalAlpha = 0.95;
    x.beginPath(); x.ellipse(0, 0, 15.5, 21.5, 0, 0, TOUR); x.fill();
    x.shadowBlur = 0;
    x.globalAlpha = 1;
    x.lineWidth = 1.8; x.strokeStyle = "rgba(255,255,255,0.7)"; x.stroke();
    x.fillStyle = "rgba(255,255,255,0.8)";
    x.beginPath(); x.ellipse(-5 * cote, -9, 3.6, 7, -0.3 * cote, 0, TOUR); x.fill();
    x.restore();
  });

  // ─── Oreilles de chat : pointe claire, base teintée, intérieur rose ───
  [-1, 1].forEach((cote) => {
    x.save();
    x.translate(180, 0); x.scale(cote, 1); x.translate(-180, 0);
    const oreille = x.createLinearGradient(0, 112, 0, 45);
    oreille.addColorStop(0, C.oreilles.primary);
    oreille.addColorStop(1, "#ffffff");
    x.fillStyle = oreille;
    x.beginPath();
    x.moveTo(103, 114);
    x.quadraticCurveTo(102, 66, 121, 45);
    x.quadraticCurveTo(148, 60, 172, 86);
    x.closePath();
    x.fill();
    x.fillStyle = hexa(C.oreilles.secondary, 0.85);
    x.beginPath();
    x.moveTo(117, 104);
    x.quadraticCurveTo(115, 78, 124, 61);
    x.quadraticCurveTo(144, 72, 157, 88);
    x.closePath();
    x.fill();
    x.restore();
  });

  // ─── Corps : gelée (reflet blanc → couleur → bord sombre), dessous teinté, halo ───
  x.save();
  x.shadowColor = hexa(C.corps.glow, 0.9);
  x.shadowBlur = 18;
  const gelee = x.createRadialGradient(165, 118, 0, 165, 118, 112);
  gelee.addColorStop(0, "#ffffff");
  gelee.addColorStop(0.3, C.corps.primary);
  gelee.addColorStop(0.78, C.corps.primary);
  gelee.addColorStop(1, C.corps.secondary);
  x.fillStyle = gelee;
  x.fill(CORPS);
  x.restore();
  x.save();
  x.clip(CORPS);
  const dessous = x.createLinearGradient(0, 81, 0, 212);
  dessous.addColorStop(0.55, hexa(C.corps.accent, 0));
  dessous.addColorStop(1, hexa(C.corps.accent, 0.55));
  x.fillStyle = dessous;
  x.fillRect(90, 80, 180, 140);
  // Grand reflet doux en haut à gauche
  x.translate(150, 108); x.rotate(-0.42);
  const reflet = x.createRadialGradient(0, 0, 0, 0, 0, 34);
  reflet.addColorStop(0, "rgba(255,255,255,0.9)");
  reflet.addColorStop(1, "rgba(255,255,255,0)");
  x.fillStyle = reflet;
  x.scale(1, 0.5);
  x.beginPath(); x.arc(0, 0, 34, 0, TOUR); x.fill();
  x.restore();
  x.lineWidth = 1.6;
  x.strokeStyle = hexa(C.corps.glow, 0.65);
  x.stroke(CORPS);
  x.fillStyle = "rgba(255,255,255,0.35)";
  x.beginPath(); x.ellipse(229, 183, 13, 6, -0.5, 0, TOUR); x.fill();

  // ─── Visage ───
  // Moustaches
  x.strokeStyle = hexa(C.moustaches.primary, 0.7);
  x.lineWidth = 1.6;
  [[134, 152, 112, 148], [134, 160, 112, 164], [226, 152, 248, 148], [226, 160, 248, 164]].forEach(([a, b, c, d]) => {
    x.beginPath(); x.moveTo(a + ox * 0.6, b + oy * 0.6); x.lineTo(c + ox * 0.6, d + oy * 0.6); x.stroke();
  });

  // Yeux selon l'expression (clignent de temps en temps)
  x.fillStyle = C.yeux.primary;
  x.strokeStyle = C.yeux.primary;
  const exp = o.expression;
  [[151, 130], [210, 130]].forEach(([ex, ey]) => {
    let px = ex + ox, py = ey + oy;
    if (exp === "thinking") { px += 6; py -= 5; } // regarde en l'air, sur le côté
    x.beginPath();
    if (exp === "happy") {
      x.lineWidth = 4;
      x.moveTo(px - 8, py + 3); x.quadraticCurveTo(px, py - 9, px + 8, py + 3);
      x.stroke();
    } else if (o.clignement > 0 && exp !== "surprised") {
      x.lineWidth = 3;
      x.moveTo(px - 7, py); x.lineTo(px + 7, py);
      x.stroke();
    } else {
      const [ex2, ey2] = { surprised: [9, 13], curious: [8, 11.5], focused: [7.6, 9], thinking: [7.2, 10] }[exp] || [7.6, 10.8];
      x.ellipse(px, py, ex2, ey2, 0, 0, TOUR);
      x.fill();
    }
  });

  // Bouche "ω" (plus ouverte quand il est content)
  const mx = 180 + ox * 0.6, my = 153 + oy * 0.6;
  const grand = exp === "happy" ? 1.2 : 1;
  x.strokeStyle = C.bouche.primary;
  x.lineWidth = exp === "happy" ? 6 : 5;
  x.beginPath();
  x.moveTo(mx - 15 * grand, my);
  x.quadraticCurveTo(mx - 7.5 * grand, my + 11 * grand, mx, my);
  x.quadraticCurveTo(mx + 7.5 * grand, my + 11 * grand, mx + 15 * grand, my);
  x.stroke();

  // Marque sur le front (clignote doucement)
  x.save();
  x.globalAlpha = 1 - 0.45 * (0.5 - 0.5 * Math.cos((t / 0.8) * TOUR)) * vit;
  x.shadowColor = C.marque.primary;
  x.shadowBlur = 5;
  x.strokeStyle = C.marque.primary;
  x.lineWidth = 4;
  const [mqx, mqy] = [212, 98];
  x.beginPath();
  x.moveTo(mqx - 10, mqy - 9); x.quadraticCurveTo(mqx - 3, mqy - 7, mqx - 3, mqy);
  x.quadraticCurveTo(mqx - 3, mqy + 7, mqx - 10, mqy + 9);
  x.moveTo(mqx + 10, mqy - 9); x.quadraticCurveTo(mqx + 3, mqy - 7, mqx + 3, mqy);
  x.quadraticCurveTo(mqx + 3, mqy + 7, mqx + 10, mqy + 9);
  x.stroke();
  x.restore();

  // ─── Auréole qui flotte ───
  x.save();
  x.shadowColor = C.aureole.primary;
  x.shadowBlur = 14;
  x.strokeStyle = C.aureole.primary;
  x.lineWidth = 5.5;
  x.beginPath();
  x.ellipse(180, 47 - 4 * (0.5 - 0.5 * Math.cos((t / 2.4) * TOUR)) * vit, 37, 10, 0, 0, TOUR);
  x.stroke();
  x.restore();

  // ─── Pastille d'état (à droite de la tête), comme dans Nexus ───
  dessinerBadge(x, t * vit, exp);

  x.restore();
}

function dessinerBadge(x, t, exp) {
  if (!["happy", "surprised", "thinking", "curious", "focused"].includes(exp)) return;
  const { primary, secondary } = C.badge;
  x.save();
  x.translate(268, 58 - 5 * (0.5 - 0.5 * Math.cos((t / 1.8) * TOUR)));
  x.shadowColor = primary;
  x.shadowBlur = 8;
  x.strokeStyle = primary;
  x.fillStyle = primary;
  x.lineWidth = 4;
  x.beginPath();
  if (exp === "happy") {
    // Coche dans un cercle
    x.arc(0, 0, 17, 0, TOUR);
    x.fillStyle = hexa(secondary, 0.25); x.fill(); x.stroke();
    x.beginPath(); x.moveTo(-8, 1); x.lineTo(-2, 7); x.lineTo(9, -6); x.stroke();
  } else if (exp === "surprised") {
    // "!!"
    [-7, 7].forEach((bx) => {
      x.beginPath(); x.moveTo(bx, -20); x.lineTo(bx, 2); x.stroke();
      x.beginPath(); x.arc(bx, 11, 3, 0, TOUR); x.fill();
    });
  } else if (exp === "thinking") {
    // "?"
    x.lineWidth = 5;
    x.moveTo(-9, -12); x.quadraticCurveTo(-9, -24, 2, -24); x.quadraticCurveTo(12, -24, 12, -14);
    x.quadraticCurveTo(12, -6, 3, -2); x.lineTo(1, 5); x.stroke();
    x.beginPath(); x.arc(1, 14, 3.5, 0, TOUR); x.fill();
  } else if (exp === "curious") {
    // Petit cercle de recherche qui tourne
    x.arc(0, 0, 16, 0, TOUR);
    x.fillStyle = hexa(secondary, 0.25); x.fill();
    x.strokeStyle = hexa(primary, 0.45); x.lineWidth = 3; x.stroke();
    x.beginPath(); x.strokeStyle = primary; x.lineWidth = 4.5;
    const a = (t / 1.1) * TOUR;
    x.arc(0, 0, 16, a, a + 2.1); x.stroke();
  } else if (exp === "focused") {
    // Petite fenêtre de code
    x.lineWidth = 2;
    x.fillStyle = hexa(secondary, 0.2);
    x.beginPath(); x.roundRect(-22, -16, 44, 32, 4); x.fill(); x.stroke();
    x.lineWidth = 2.4;
    [[-15, -7, 10], [-15, 0, 16], [-15, 7, 4]].forEach(([a, b, l]) => { x.beginPath(); x.moveTo(a, b); x.lineTo(a + l, b); x.stroke(); });
  }
  x.restore();
}

// "#rrggbb" + opacité → rgba()
function hexa(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}
