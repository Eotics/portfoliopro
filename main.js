/* ==========================================
   main.js — Scripts du portfolio
   Philippe Viman
========================================== */


/* ─── PARTICULES (points violets animés en fond) ─── */

// On récupère le canvas (zone de dessin) dans la page
const canvas = document.getElementById("particles");
const ctx = canvas.getContext("2d"); // outil de dessin

// Le canvas prend toute la taille de la fenêtre
canvas.width = window.innerWidth;
canvas.height = window.innerHeight;

// Si la fenêtre est redimensionnée, on remet à jour la taille
window.addEventListener("resize", function () {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
});

// On crée 60 particules avec une position et vitesse aléatoires
const particules = [];
for (let i = 0; i < 60; i++) {
  particules.push({
    x: Math.random() * canvas.width,
    y: Math.random() * canvas.height,
    vitesseX: (Math.random() - 0.5) * 0.4,
    vitesseY: (Math.random() - 0.5) * 0.4,
    rayon: Math.random() * 1.5 + 0.5,
  });
}

// Cette fonction dessine et anime les particules en boucle infinie
function animer() {
  // On efface le canvas avant de redessiner
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  for (const p of particules) {
    // On déplace la particule selon sa vitesse
    p.x += p.vitesseX;
    p.y += p.vitesseY;

    // Si elle sort d'un côté, elle réapparaît de l'autre côté
    if (p.x < 0) p.x = canvas.width;
    if (p.x > canvas.width) p.x = 0;
    if (p.y < 0) p.y = canvas.height;
    if (p.y > canvas.height) p.y = 0;

    // On dessine un petit cercle violet semi-transparent
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.rayon, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(168, 85, 247, 0.5)";
    ctx.fill();
  }

  // requestAnimationFrame relance la fonction à chaque image (~60 fois/s)
  requestAnimationFrame(animer);
}
animer();


/* ─── MARQUEE (bande de texte qui défile en bas de page) ─── */

const mots = [
  "Développement Web",
  "BTS SIO",
  "Cybersécurité",
  "Linux",
  "JavaScript",
  "Design",
  "Exotic.IA",
  "GitHub",
];

const piste = document.getElementById("mtrack");

if (piste) {
  // On double la liste pour que le défilement soit continu et sans coupure
  const tousLesMots = [...mots, ...mots];
  piste.innerHTML = tousLesMots
    .map((mot) => `<span class="marquee-item">${mot}<span class="dot">✦</span></span>`)
    .join("");
}


/* ─── APPARITION AU SCROLL (les éléments arrivent en scrollant) ─── */

// IntersectionObserver détecte quand un élément est visible à l'écran
const observer = new IntersectionObserver(
  function (entries) {
    entries.forEach(function (entry) {
      if (entry.isIntersecting) {
        // Quand l'élément est visible, on ajoute la classe "visible"
        // Cette classe déclenche l'animation CSS (voir style.css)
        entry.target.classList.add("visible");
      }
    });
  },
  { threshold: 0.12 } // se déclenche quand 12% de l'élément est visible
);

// On observe tous les éléments qui ont la classe "reveal"
document.querySelectorAll(".reveal").forEach(function (el) {
  observer.observe(el);
});


/* ─── BARRES DE COMPÉTENCES (uniquement sur arsenal.html) ─── */

// On observe quand les blocs arsenal arrivent à l'écran
const barreObserver = new IntersectionObserver(
  function (entries) {
    entries.forEach(function (entry) {
      if (entry.isIntersecting) {
        // On remplit chaque barre jusqu'au pourcentage indiqué (data-w)
        document.querySelectorAll(".skill-bar-fill").forEach(function (barre) {
          barre.style.width = barre.dataset.w + "%";
        });
      }
    });
  },
  { threshold: 0.3 }
);

document.querySelectorAll(".arsenal-block").forEach(function (el) {
  barreObserver.observe(el);
});


/* ─── LIEN ACTIF DANS LA NAVIGATION ─── */

// On récupère le nom de la page actuelle (ex: "contact.html")
const pageCourante = window.location.pathname.split("/").pop() || "index.html";

// On ajoute la classe "active" au lien qui correspond à la page ouverte
document.querySelectorAll(".nav-links a").forEach(function (lien) {
  if (lien.getAttribute("href") === pageCourante) {
    lien.classList.add("active");
  }
});
