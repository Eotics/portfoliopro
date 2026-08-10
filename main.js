/* ==========================================
   main.js — Scripts du portfolio
   Philippe Viman
========================================== */


/* ─── PARTICULES ─── */

const canvas = document.getElementById("particles");
const ctx = canvas.getContext("2d");

canvas.width = window.innerWidth;
canvas.height = window.innerHeight;

window.addEventListener("resize", function () {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
});

// Couleurs disponibles pour les particules
const couleurs = [
  "rgba(124, 58, 237,",   // violet
  "rgba(168, 85, 247,",   // violet clair
  "rgba(217, 70, 239,",   // rose
  "rgba(34, 211, 238,",   // cyan
];

// Création de 70 particules aléatoires
const particules = [];
for (let i = 0; i < 70; i++) {
  particules.push({
    x:        Math.random() * canvas.width,
    y:        Math.random() * canvas.height,
    vitesseX: (Math.random() - 0.5) * 0.3,
    vitesseY: (Math.random() - 0.5) * 0.3,
    rayon:    Math.random() * 1.5 + 0.3,
    couleur:  couleurs[Math.floor(Math.random() * couleurs.length)],
    opacite:  Math.random() * 0.5 + 0.2,
  });
}

function animer() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // Déplacement et dessin de chaque particule
  for (const p of particules) {
    p.x += p.vitesseX;
    p.y += p.vitesseY;

    // Rebond de l'autre côté si elle sort de l'écran
    if (p.x < 0) p.x = canvas.width;
    if (p.x > canvas.width) p.x = 0;
    if (p.y < 0) p.y = canvas.height;
    if (p.y > canvas.height) p.y = 0;

    ctx.beginPath();
    ctx.arc(p.x, p.y, p.rayon, 0, Math.PI * 2);
    ctx.fillStyle = p.couleur + p.opacite + ")";
    ctx.fill();
  }

  // Lignes entre les particules proches (effet constellation)
  for (let i = 0; i < particules.length; i++) {
    for (let j = i + 1; j < particules.length; j++) {
      const dx = particules[i].x - particules[j].x;
      const dy = particules[i].y - particules[j].y;
      const distance = Math.sqrt(dx * dx + dy * dy);

      // On ne trace la ligne que si les deux particules sont assez proches
      if (distance < 120) {
        // Plus elles sont proches, plus la ligne est visible
        const opaciteLigne = 0.15 * (1 - distance / 120);
        ctx.beginPath();
        ctx.moveTo(particules[i].x, particules[i].y);
        ctx.lineTo(particules[j].x, particules[j].y);
        ctx.strokeStyle = "rgba(124, 58, 237," + opaciteLigne + ")";
        ctx.lineWidth = 0.5;
        ctx.stroke();
      }
    }
  }

  requestAnimationFrame(animer);
}

if (!window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
  animer();
}


/* ─── BADGES DE COMPÉTENCES EN ORBITE (index.html uniquement) ─── */

const conteneurBadges = document.getElementById("deco-badges");

if (conteneurBadges) {
  const competencesDev = [
    "HTML/CSS", "JavaScript", "Node.js", "Python", "Java", "C++",
    "Git/GitHub", "PHP", "Tailwind", "API REST", "AJAX", "SQL",
    "MySQL", "MariaDB", "JSON",
  ];
  const competencesSys = [
    "Cisco", "Réseau", "VLAN", "DNS", "Pare-feu", "Windows",
    "Linux", "VirtualBox", "VMware", "Support IT", "Montage PC",
  ];

  // Place une liste de badges à égale distance les uns des autres sur un cercle
  function placerSurCercle(liste, rayonPourcent, delaiDepart) {
    const total = liste.length;
    liste.forEach(function (nom, i) {
      const angle = (i / total) * 2 * Math.PI - Math.PI / 2;
      const x = 50 + rayonPourcent * Math.cos(angle);
      const y = 50 + rayonPourcent * Math.sin(angle);

      const badge = document.createElement("div");
      badge.className = "deco-badge";
      badge.textContent = nom;
      badge.style.left = x + "%";
      badge.style.top = y + "%";
      badge.style.animationDelay = delaiDepart + i * 0.12 + "s";
      conteneurBadges.appendChild(badge);
    });
  }

  placerSurCercle(competencesDev, 47, 0);
  placerSurCercle(competencesSys, 32, 0.4);
}


/* ─── MARQUEE ─── */

const mots = [
  "Développement Web", "BTS SIO", "Cybersécurité",
  "Linux", "JavaScript", "Design", "Exotic.IA", "GitHub",
];

const piste = document.getElementById("mtrack");
if (piste) {
  // Liste doublée pour que le défilement soit continu
  piste.innerHTML = [...mots, ...mots]
    .map((mot) => `<span class="marquee-item">${mot}<span class="dot">✦</span></span>`)
    .join("");
}


/* ─── APPARITION AU SCROLL ─── */

// Quand un élément .reveal arrive à l'écran, on lui ajoute .visible (animé en CSS)
const observer = new IntersectionObserver(
  function (entries) {
    entries.forEach(function (entry) {
      if (entry.isIntersecting) {
        entry.target.classList.add("visible");
      }
    });
  },
  { threshold: 0.12 }
);

document.querySelectorAll(".reveal").forEach(function (el) {
  observer.observe(el);
});


/* ─── BARRES DE COMPÉTENCES (arsenal.html) ─── */




/* ─── MACHINE À ÉCRIRE (contact.html uniquement) ─── */

const zoneTypewriter = document.getElementById("typewriter");

if (zoneTypewriter) {
  const texte =
`> Connexion établie... [OK]
> Chargement du profil : Philippe Viman

> whoami
  Développeur Web — BTS SIO 2026

> cat skills.txt
  → HTML / CSS / JavaScript
  → Cybersécurité
  → Linux / Windows

> ping contact
  PING réussi — Je suis disponible ✓

> En attente d'une connexion...`;

  let position = 0;

  function ecrire() {
    if (position < texte.length) {
      zoneTypewriter.textContent += texte[position];
      position++;
      setTimeout(ecrire, 28); // vitesse : 28ms entre chaque lettre
    }
  }

  // On démarre la frappe une fois la page chargée
  window.addEventListener("load", ecrire);
}


/* ─── FORMULAIRE DE CONTACT (EmailJS, contact.html uniquement) ─── */

// 🔧 À remplacer par tes identifiants du dashboard EmailJS (dashboard.emailjs.com)
const EMAILJS_PUBLIC_KEY = "SAEORvTedlnc9LlZg";
const EMAILJS_SERVICE_ID = "service_l6w7oxl";
const EMAILJS_TEMPLATE_ID = "template_bb8gvsn";

const formulaireContact = document.getElementById("contact-form");

if (formulaireContact && window.emailjs) {
  emailjs.init(EMAILJS_PUBLIC_KEY);

  const statutForm = document.getElementById("cf-status");
  const boutonEnvoyer = formulaireContact.querySelector("button[type='submit']");

  formulaireContact.addEventListener("submit", function (e) {
    e.preventDefault();
    boutonEnvoyer.disabled = true;
    statutForm.textContent = "Envoi en cours...";
    statutForm.className = "form-status";

    emailjs.sendForm(EMAILJS_SERVICE_ID, EMAILJS_TEMPLATE_ID, formulaireContact)
      .then(function () {
        statutForm.textContent = "Message envoyé ! Je te réponds vite.";
        statutForm.className = "form-status success";
        formulaireContact.reset();
      })
      .catch(function (erreur) {
        console.error("Erreur EmailJS :", erreur);
        statutForm.textContent = "Erreur lors de l'envoi. Réessaie ou écris-moi par email.";
        statutForm.className = "form-status error";
      })
      .finally(function () {
        boutonEnvoyer.disabled = false;
      });
  });
}


/* ─── LIEN ACTIF DANS LA NAV ─── */

// On compare l'URL actuelle avec le href de chaque lien
const pageCourante = window.location.pathname.split("/").pop() || "index.html";

document.querySelectorAll(".nav-links a").forEach(function (lien) {
  if (lien.getAttribute("href") === pageCourante) {
    lien.classList.add("active");
  }
});
