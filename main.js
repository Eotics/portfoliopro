/* ═══════════════════════════════════════
   EXOTIC未来 — Portfolio Philippe Viman
   main.js — Tous les scripts
═══════════════════════════════════════ */

/* ─── CURSOR PERSONNALISÉ ─── */
const cur = document.getElementById("cur");
const cur2 = document.getElementById("cur2");
let mx = 0,
  my = 0,
  cx = 0,
  cy = 0;

document.addEventListener("mousemove", (e) => {
  mx = e.clientX;
  my = e.clientY;
  cur.style.left = mx + "px";
  cur.style.top = my + "px";
});

function lerp(a, b, t) {
  return a + (b - a) * t;
}
(function loopCursor() {
  cx = lerp(cx, mx, 0.14);
  cy = lerp(cy, my, 0.14);
  cur2.style.left = cx + "px";
  cur2.style.top = cy + "px";
  requestAnimationFrame(loopCursor);
})();

document
  .querySelectorAll(
    "a,button,.skill-card,.project-card,.contact-link,.tag,.arsenal-block",
  )
  .forEach((el) => {
    el.addEventListener("mouseenter", () => cur2.classList.add("big"));
    el.addEventListener("mouseleave", () => cur2.classList.remove("big"));
  });

/* ─── PARTICULES ─── */
const canvas = document.getElementById("particles");
const ctx = canvas.getContext("2d");
let W, H;
const pts = [];

function resizeCanvas() {
  W = canvas.width = window.innerWidth;
  H = canvas.height = window.innerHeight;
}
resizeCanvas();
window.addEventListener("resize", resizeCanvas);

const COLORS = [
  "rgba(124,58,237,",
  "rgba(168,85,247,",
  "rgba(217,70,239,",
  "rgba(34,211,238,",
];

for (let i = 0; i < 70; i++) {
  pts.push({
    x: Math.random() * 2000,
    y: Math.random() * 1200,
    vx: (Math.random() - 0.5) * 0.25,
    vy: (Math.random() - 0.5) * 0.25,
    r: Math.random() * 1.5 + 0.3,
    c: COLORS[Math.floor(Math.random() * COLORS.length)],
    a: Math.random() * 0.5 + 0.1,
  });
}

function drawParticles() {
  ctx.clearRect(0, 0, W, H);
  for (const p of pts) {
    p.x += p.vx;
    p.y += p.vy;
    if (p.x < 0) p.x = W;
    if (p.x > W) p.x = 0;
    if (p.y < 0) p.y = H;
    if (p.y > H) p.y = 0;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
    ctx.fillStyle = p.c + p.a + ")";
    ctx.fill();
  }
  for (let i = 0; i < pts.length; i++) {
    for (let j = i + 1; j < pts.length; j++) {
      const dx = pts[i].x - pts[j].x;
      const dy = pts[i].y - pts[j].y;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d < 110) {
        ctx.beginPath();
        ctx.moveTo(pts[i].x, pts[i].y);
        ctx.lineTo(pts[j].x, pts[j].y);
        ctx.strokeStyle = "rgba(124,58,237," + 0.12 * (1 - d / 110) + ")";
        ctx.lineWidth = 0.5;
        ctx.stroke();
      }
    }
  }
  requestAnimationFrame(drawParticles);
}
drawParticles();

/* ─── MARQUEE ─── */
function initMarquee() {
  const el = document.getElementById("mtrack");
  if (!el) return;
  const items = [
    "Développement Web",
    "BTS SIO",
    "Cybersécurité",
    "Linux",
    "JavaScript",
    "Design",
    "Exotic.IA",
    "GitHub",
  ];
  el.innerHTML = [...items, ...items]
    .map(
      (i) => `<span class="marquee-item">${i}<span class="dot">✦</span></span>`,
    )
    .join("");
}
initMarquee();

/* ─── SCROLL REVEAL ─── */
const revealObs = new IntersectionObserver(
  (entries) => {
    entries.forEach((e) => {
      if (e.isIntersecting) e.target.classList.add("visible");
    });
  },
  { threshold: 0.12 },
);
document.querySelectorAll(".reveal").forEach((el) => revealObs.observe(el));

/* ─── SKILL BARS (arsenal.html uniquement) ─── */
let barsTriggered = false;
function triggerBars() {
  if (barsTriggered) return;
  barsTriggered = true;
  document.querySelectorAll(".skill-bar-fill").forEach((bar) => {
    setTimeout(() => {
      bar.style.width = bar.dataset.w + "%";
    }, 100);
  });
}
const barObs = new IntersectionObserver(
  (entries) => {
    if (entries.some((e) => e.isIntersecting)) triggerBars();
  },
  { threshold: 0.3 },
);
document.querySelectorAll(".arsenal-block").forEach((el) => barObs.observe(el));

/* ─── ACTIVE NAV LINK ─── */
(function setActiveNav() {
  const page = window.location.pathname.split("/").pop() || "index.html";
  document.querySelectorAll(".nav-links a").forEach((a) => {
    if (
      a.getAttribute("href") === page ||
      (page === "" && a.getAttribute("href") === "index.html")
    ) {
      a.classList.add("active");
    }
  });
})();
