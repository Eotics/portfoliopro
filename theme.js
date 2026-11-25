/* ==========================================
   theme.js — Bascule mode sombre / mode clair
   - Le mode sombre est celui par défaut (le design d'origine).
   - Le mode clair pose data-theme="light" sur <html> (styles en fin de style.css).
   - Le choix du visiteur est gardé dans son navigateur pour les autres pages.
     Un petit script dans le <head> de chaque page le réapplique avant
     l'affichage, pour éviter un flash de la mauvaise couleur.
   Partagé par les pages FR et EN (les libellés sont dans le HTML).
========================================== */
(function () {
  var CLE = "portfoliopro-theme";
  var racine = document.documentElement;
  var boutons = document.querySelectorAll("[data-theme-toggle]");
  var metaCouleur = document.querySelector('meta[name="theme-color"]');
  var couleurSombre = metaCouleur ? metaCouleur.getAttribute("content") : null;

  function estClair() {
    return racine.getAttribute("data-theme") === "light";
  }

  function majAffichage() {
    boutons.forEach(function (bouton) {
      bouton.setAttribute("aria-pressed", estClair() ? "true" : "false");
    });
    // Couleur de la barre du navigateur sur mobile
    if (metaCouleur && couleurSombre) {
      metaCouleur.setAttribute("content", estClair() ? "#f6f3fc" : couleurSombre);
    }
  }

  boutons.forEach(function (bouton) {
    bouton.addEventListener("click", function () {
      if (estClair()) racine.removeAttribute("data-theme");
      else racine.setAttribute("data-theme", "light");
      try {
        localStorage.setItem(CLE, estClair() ? "light" : "dark");
      } catch (e) {
        // stockage bloqué (navigation privée) : le choix vaut pour cette page seulement
      }
      majAffichage();
    });
  });

  majAffichage();
})();
