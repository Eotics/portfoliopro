/* ==========================================
   generer.mjs — Rend la vidéo "Exo présente le portfolio" (maquette/video.html) en MP4
   1920×1080, 30 images/s, H.264 : lisible partout (LinkedIn, Instagram, Windows, téléphones)

   Comment ça marche : chrome-headless-shell (Chrome sans fenêtre) est piloté par le protocole
   DevTools en mode "image par image" (HeadlessExperimental.beginFrame). L'horloge de la page est
   remplacée par une horloge virtuelle : on avance d'une image, on demande au navigateur de
   la dessiner et de la capturer, puis on l'envoie à ffmpeg. Le rendu est fluide même sur une
   machine lente. (Les captures d'écran classiques d'Edge/Chrome se bloquent au bout de
   ~150 images, d'où ce mode.)

   Prérequis : Node 22 ou plus. Au premier lancement, chrome-headless-shell et ffmpeg sont
   téléchargés dans ~/.cache/exo-video (sauf si NAVIGATEUR / FFMPEG_PATH indiquent leur chemin).

   Usage (depuis la racine du dépôt) :
     node maquette/video/generer.mjs                   → maquette/video/exo-presente-le-portfolio.mp4
     node maquette/video/generer.mjs --apercu 3,12.5   → images PNG de contrôle (dossier APERCU_DIR
                                                          ou maquette/video/apercu)
========================================== */

import { execFileSync, spawn } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { once } from "node:events";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ICI = path.dirname(fileURLToPath(import.meta.url));
const PAGE = pathToFileURL(path.join(ICI, "..", "video.html")).href;
const SORTIE = path.join(ICI, "exo-presente-le-portfolio.mp4");
const CACHE = path.join(homedir(), ".cache", "exo-video");
const IPS = 30;
const LARGEUR = 1920;
const HAUTEUR = 1080;

const args = process.argv.slice(2);
const iApercu = args.indexOf("--apercu");
const apercu = iApercu >= 0 ? args[iApercu + 1].split(",").map(Number) : null;

// Horloge virtuelle injectée avant tout script de la page : le temps n'avance que quand on appelle __image()
const HORLOGE = `(() => {
  let t = 0, file = [];
  const base = Date.now();
  performance.now = () => t;
  Date.now = () => base + t;
  window.requestAnimationFrame = (f) => { file.push(f); return file.length; };
  window.cancelAnimationFrame = () => {};
  window.__CAPTURE = true;
  window.__image = (ms) => {
    t += ms;
    const l = file;
    file = [];
    for (const f of l) { try { f(t); } catch (e) { console.error(e); } }
  };
})();`;

/* ─── OUTILS : chrome-headless-shell et ffmpeg (téléchargés au besoin) ─── */
const npx = process.platform === "win32" ? "npx.cmd" : "npx";
const npm = process.platform === "win32" ? "npm.cmd" : "npm";

function chercher(dossier, nom) {
  if (!existsSync(dossier)) return null;
  for (const e of readdirSync(dossier, { withFileTypes: true })) {
    const p = path.join(dossier, e.name);
    if (e.isFile() && e.name === nom) return p;
    if (e.isDirectory()) {
      const trouve = chercher(p, nom);
      if (trouve) return trouve;
    }
  }
  return null;
}

function navigateur() {
  if (process.env.NAVIGATEUR) return process.env.NAVIGATEUR;
  const nom = process.platform === "win32" ? "chrome-headless-shell.exe" : "chrome-headless-shell";
  const dossier = path.join(CACHE, "navigateurs");
  let exe = chercher(dossier, nom);
  if (!exe) {
    console.log("Téléchargement de chrome-headless-shell (une seule fois)…");
    execFileSync(npx, ["--yes", "@puppeteer/browsers", "install", "chrome-headless-shell@stable", "--path", dossier], { stdio: "inherit", shell: process.platform === "win32" });
    exe = chercher(dossier, nom);
  }
  return exe;
}

function ffmpeg() {
  if (process.env.FFMPEG_PATH) return process.env.FFMPEG_PATH;
  try {
    execFileSync("ffmpeg", ["-version"], { stdio: "ignore" });
    return "ffmpeg";
  } catch {}
  const nom = process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg";
  let exe = chercher(path.join(CACHE, "node_modules", "ffmpeg-static"), nom);
  if (!exe) {
    console.log("Téléchargement de ffmpeg (une seule fois)…");
    execFileSync(npm, ["install", "--prefix", CACHE, "--no-audit", "--no-fund", "ffmpeg-static@5"], { stdio: "inherit", shell: process.platform === "win32" });
    exe = chercher(path.join(CACHE, "node_modules", "ffmpeg-static"), nom);
  }
  return exe;
}

/* ─── MINI-CLIENT DU PROTOCOLE DEVTOOLS ─── */
function connecter(url) {
  return new Promise((ok, ko) => {
    const ws = new WebSocket(url);
    let id = 0;
    const attente = new Map();
    ws.onerror = () => ko(new Error("Connexion DevTools impossible"));
    ws.onmessage = (m) => {
      const d = JSON.parse(m.data);
      if (d.id && attente.has(d.id)) {
        const { r, e } = attente.get(d.id);
        attente.delete(d.id);
        d.error ? e(new Error(d.error.message)) : r(d.result);
      } else if (d.method === "Runtime.consoleAPICalled" && d.params.type === "error") {
        console.error("\n[page]", d.params.args.map((a) => a.value ?? a.description).join(" "));
      }
    };
    ws.onopen = () =>
      ok({
        // Garde-fou : une commande sans réponse au bout d'une minute fait échouer le rendu au lieu de le figer
        envoyer: (method, params = {}) =>
          new Promise((r, e) => {
            const n = ++id;
            const minuteur = setTimeout(() => {
              attente.delete(n);
              e(new Error(`Le navigateur ne répond plus (${method})`));
            }, 60000);
            attente.set(n, { r: (v) => { clearTimeout(minuteur); r(v); }, e: (x) => { clearTimeout(minuteur); e(x); } });
            ws.send(JSON.stringify({ id: n, method, params }));
          }),
        fermer: () => ws.close(),
      });
  });
}

async function lancerNavigateur(profil) {
  const nav = spawn(
    navigateur(),
    ["--remote-debugging-port=0", `--user-data-dir=${profil}`, "--deterministic-mode", "--hide-scrollbars", "--mute-audio",
      `--window-size=${LARGEUR},${HAUTEUR}`, "--force-device-scale-factor=1"],
    { stdio: ["ignore", "ignore", "pipe"] }
  );
  // Le navigateur annonce son adresse DevTools sur stderr
  let journal = "";
  const adresse = await new Promise((ok, ko) => {
    nav.stderr.on("data", (morceau) => {
      journal += morceau;
      const m = journal.match(/DevTools listening on (ws:\/\/\S+)/);
      if (m) ok(m[1]);
    });
    nav.on("exit", () => ko(new Error("Le navigateur s'est fermé au démarrage :\n" + journal)));
  });
  // Onglet créé en mode "image par image" : il ne dessine que quand on le lui demande
  const navCdp = await connecter(adresse);
  const { targetId } = await navCdp.envoyer("Target.createTarget", { url: "about:blank", enableBeginFrameControl: true, width: LARGEUR, height: HAUTEUR });
  const cibles = await (await fetch(`http://127.0.0.1:${new URL(adresse).port}/json/list`)).json();
  const cdp = await connecter(cibles.find((c) => c.id === targetId).webSocketDebuggerUrl);
  return { nav, navCdp, cdp };
}

function lancerFfmpeg() {
  return spawn(
    ffmpeg(),
    ["-y", "-loglevel", "error", "-f", "image2pipe", "-framerate", String(IPS), "-c:v", "mjpeg", "-i", "-",
      "-c:v", "libx264", "-preset", "slow", "-crf", "18", "-pix_fmt", "yuv420p", "-movflags", "+faststart", SORTIE],
    { stdio: ["pipe", "inherit", "inherit"] }
  );
}

/* ─── RENDU ─── */
const profil = await mkdtemp(path.join(tmpdir(), "exo-video-"));
const { nav, navCdp, cdp } = await lancerNavigateur(profil);
const attendre = (ms) => new Promise((r) => setTimeout(r, ms));
const image = (params = {}) => cdp.envoyer("HeadlessExperimental.beginFrame", { interval: 1000 / IPS, ...params });

try {
  const evaluer = async (expression) => {
    const r = await cdp.envoyer("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    return r.result.value;
  };

  await cdp.envoyer("Page.enable");
  await cdp.envoyer("Runtime.enable");
  await cdp.envoyer("Emulation.setDeviceMetricsOverride", { width: LARGEUR, height: HAUTEUR, deviceScaleFactor: 1, mobile: false });
  await cdp.envoyer("Page.addScriptToEvaluateOnNewDocument", { source: HORLOGE });
  await cdp.envoyer("Page.navigate", { url: PAGE });

  // Chargement : on fait tourner le compositeur pour que la mise en page et les polices se fassent
  const prete = async () =>
    evaluer("window.VIDEO ? (window.VIDEO.pret.then(() => { window.VIDEO.charge = true; }), !!window.VIDEO.charge) : false").catch(() => false);
  for (let k = 0; k < 600 && !(await prete()); k++) {
    await image().catch(() => {});
    await attendre(30);
  }
  if (!(await prete())) throw new Error("La page video.html ne s'est pas chargée");
  if (await evaluer("document.documentElement.classList.contains('no-webgl')")) throw new Error("WebGL indisponible : la mascotte ne peut pas être rendue");

  const duree = await evaluer("window.VIDEO.duree");
  const total = Math.round(duree * IPS);
  const dossierApercu = process.env.APERCU_DIR || path.join(ICI, "apercu");
  const imagesApercu = apercu ? new Map(apercu.map((s) => [Math.max(1, Math.round(s * IPS)), s])) : null;
  const derniere = apercu ? Math.max(...imagesApercu.keys()) : total;
  if (apercu) await mkdir(dossierApercu, { recursive: true });
  const ff = apercu ? null : lancerFfmpeg();
  if (ff) ff.on("error", (e) => { console.error("\nffmpeg introuvable :", e.message); process.exit(1); });

  const debut = Date.now();
  let precedente = null;
  for (let i = 1; i <= derniere; i++) {
    await evaluer(`__image(${1000 / IPS})`); // l'image i montre l'instant t = i / IPS
    // Capture à chaque image, même celles qu'on ne garde pas : sans capture, le mode image par image se fige
    const png = apercu && imagesApercu.has(i);
    const r = await image({ screenshot: png ? { format: "png" } : { format: "jpeg", quality: 95, optimizeForSpeed: true } });
    if (apercu && !png) continue;
    // Image identique à la précédente : le navigateur ne renvoie pas de capture, on répète la dernière
    const capture = r.screenshotData ? Buffer.from(r.screenshotData, "base64") : precedente;
    if (!capture) continue;
    precedente = capture;

    if (apercu) {
      const fichier = path.join(dossierApercu, `t${String(imagesApercu.get(i)).replace(".", "_")}s.png`);
      await writeFile(fichier, capture);
      console.log("aperçu :", fichier);
    } else {
      if (!ff.stdin.write(capture)) await once(ff.stdin, "drain");
      if (i % IPS === 0) process.stdout.write(`\r${Math.round(i / IPS)} s / ${Math.round(duree)} s rendues (${Math.round((Date.now() - debut) / 1000)} s écoulées)`);
    }
  }

  if (ff) {
    ff.stdin.end();
    const [code] = await once(ff, "exit");
    if (code !== 0) throw new Error("ffmpeg a échoué (code " + code + ")");
    console.log("\nVidéo prête :", SORTIE);
  }
} finally {
  cdp.fermer();
  navCdp.fermer();
  if (nav.exitCode === null) {
    const ferme = once(nav, "exit");
    nav.kill();
    await ferme;
  }
  await rm(profil, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 }).catch(() => {});
}
