/*
 * PuHu – "Seuraavat kotipelit" -nauha puhujuniorit.fi:n sivuille.
 *
 * Squarespacen Code-lohkoon:
 *
 *   <div id="puhu-nauha"></div>
 *   <script src="https://pelit.puhujuniorit.fi/nauha.js" defer></script>
 *
 * Valinnainen rajaus yhteen joukkueeseen (esim. joukkuesivulle):
 *   <div id="puhu-nauha" data-joukkue="puhuttaret"></div>
 *
 * Nauha hakee tiedot tiedostosta nauha.json, jonka hae.js kirjoittaa kahdesti päivässä.
 * Jo pelatut ottelut suodatetaan pois myös selaimessa, joten nauha siirtyy seuraavaan
 * pelipäivään itse. Jos kotipelejä ei ole tiedossa tai haku epäonnistuu, nauha ei näy
 * lainkaan, eikä sivulle jää tyhjää laatikkoa.
 *
 * Tämä tiedosto on käsin ylläpidetty: hae.js ei kirjoita sitä.
 */
(function () {
  "use strict";

  var SKRIPTI = document.currentScript && document.currentScript.src;
  var LAHDE = SKRIPTI ? SKRIPTI.replace(/[^\/]*$/, "") : "https://pelit.puhujuniorit.fi/";
  var TZ = "Europe/Helsinki";
  var VIIKONPAIVAT = ["Su", "Ma", "Ti", "Ke", "To", "Pe", "La"];

  var LIPPU = '<svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M3 8a1 1 0 0 1 1-1h16a1 1 0 0 1 1 1v2a2 2 0 0 0 0 4v2a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-2a2 2 0 0 0 0-4z"/><path d="M14 7v10" stroke-dasharray="2 2"/></svg>';

  // Tyylit on rajattu .puhu-nauha-luokan alle, jotta ne eivät vaikuta muuhun sivustoon,
  // ja ne nollaavat Squarespacen yleisimmät lista- ja linkkityylit. Fontti periytyy sivustolta.
  var CSS = [
    ".puhu-nauha{box-sizing:border-box;display:flex;flex-wrap:wrap;align-items:center;gap:16px 32px;margin:0;padding:20px 24px;background:#F6F6F6;border-left:6px solid #D62A32;color:#111;font-family:inherit;line-height:1.4;text-align:left}",
    ".puhu-nauha *{box-sizing:border-box}",
    ".puhu-nauha a{color:inherit}",
    ".puhu-nauha a:focus-visible{outline:2px solid #111;outline-offset:2px}",
    ".puhu-nauha .pn-sisalto{flex:1 1 420px;min-width:0}",
    ".puhu-nauha .pn-paa{display:flex;flex-wrap:wrap;align-items:center;gap:6px 14px;margin:0 0 12px}",
    ".puhu-nauha .pn-otsake{flex-basis:100%;margin:0;color:#D62A32;font-size:13px;font-weight:700;text-transform:uppercase;letter-spacing:.12em}",
    ".puhu-nauha .pn-paiva{font-size:22px;font-weight:700;text-transform:uppercase;letter-spacing:.03em;line-height:1.15}",
    ".puhu-nauha .pn-halli{color:#5E5E5E;font-size:15px;text-decoration:underline;text-underline-offset:3px}",
    ".puhu-nauha .pn-halli:hover{color:#111}",
    ".puhu-nauha .pn-vapaa{display:inline-flex;align-items:center;gap:6px;padding:3px 8px;background:#FCEBEC;color:#A11B22;font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:.08em}",
    ".puhu-nauha .pn-pelit{display:grid;gap:8px;margin:0;padding:0;list-style:none}",
    ".puhu-nauha .pn-pelit li{margin:0;padding:0;list-style:none}",
    ".puhu-nauha .pn-pelit li::before{content:none!important;display:none!important}",
    ".puhu-nauha .pn-peli{display:flex;flex-wrap:wrap;align-items:center;gap:4px 12px;font-size:17px;text-decoration:none}",
    ".puhu-nauha a.pn-peli:hover .pn-ottelu{text-decoration:underline;text-underline-offset:3px}",
    ".puhu-nauha .pn-kello{min-width:3.1em;font-weight:700;font-variant-numeric:tabular-nums}",
    ".puhu-nauha .pn-tunniste{min-width:9.6em;text-align:center;padding:3px 7px;color:#fff;font-size:11px;font-weight:600;line-height:1.2;text-transform:uppercase;letter-spacing:.1em}",
    ".puhu-nauha .pn-ottelu strong{font-weight:700}",
    ".puhu-nauha .pn-rivihalli{flex-basis:100%;padding-left:calc(3.1em + 12px);color:#5E5E5E;font-size:14px}",
    ".puhu-nauha .pn-nappi{flex:0 0 auto;display:inline-block;padding:14px 22px;border:0;background:#D62A32;color:#fff!important;font-size:14px;font-weight:600;text-decoration:none!important;text-transform:uppercase;letter-spacing:.1em}",
    ".puhu-nauha .pn-nappi:hover{background:#B5222A}",
    "@media (max-width:640px){",
    ".puhu-nauha{gap:14px;padding:16px 16px 18px}",
    ".puhu-nauha .pn-paiva{font-size:19px}",
    ".puhu-nauha .pn-peli{font-size:16px}",
    ".puhu-nauha .pn-rivihalli{padding-left:0}",
    ".puhu-nauha .pn-nappi{width:100%;text-align:center}",
    "}"
  ].join("");

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  // Päivämäärä Suomen aikaa muodossa VVVV-KK-PP, käyttäjän omasta aikavyöhykkeestä riippumatta.
  function isoPaiva(ms) {
    var osat = {};
    new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" })
      .formatToParts(new Date(ms)).forEach(function (o) { osat[o.type] = o.value; });
    return osat.year + "-" + osat.month + "-" + osat.day;
  }

  function paivaTeksti(iso, nytMs) {
    if (iso === isoPaiva(nytMs)) return "Tänään";
    if (iso === isoPaiva(nytMs + 86400000)) return "Huomenna";
    var o = iso.split("-").map(Number);
    var vkp = VIIKONPAIVAT[new Date(Date.UTC(o[0], o[1] - 1, o[2])).getUTCDay()];
    return vkp + " " + o[2] + "." + o[1] + ".";
  }

  function lyhytHalli(halli) {
    return String(halli || "").split(",")[0].trim();
  }

  function karttalinkki(halli) {
    return "https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent(halli);
  }

  // Seuraavan pelipäivän kotiottelut, tai tyhjä lista.
  function valitse(data, joukkue, nytMs) {
    var kesto = (Number(data.kesto_min) > 0 ? Number(data.kesto_min) : 120) * 60000;
    var tulevat = (data.kotipelit || []).filter(function (o) {
      return (!joukkue || o.joukkue === joukkue) && Date.parse(o.alku) + kesto >= nytMs;
    });
    if (!tulevat.length) return [];
    var paiva = tulevat[0].paiva;
    return tulevat.filter(function (o) { return o.paiva === paiva; });
  }

  function piirra(el, data, nytMs) {
    var joukkue = el.getAttribute("data-joukkue") || "";
    var pelit = valitse(data, joukkue, nytMs);
    if (!pelit.length) { el.hidden = true; el.innerHTML = ""; return; }

    var hallit = pelit.map(function (o) { return o.halli || ""; });
    var samaHalli = hallit.every(function (h) { return h === hallit[0]; }) && hallit[0];
    var joukkueet = data.joukkueet || {};
    var sivu = (data.sivu || LAHDE.replace(/\/$/, "")) + "/" + (joukkue ? "#" + encodeURIComponent(joukkue) : "");

    var rivit = pelit.map(function (o) {
      var j = joukkueet[o.joukkue] || { nimi: o.joukkue, vari: "#111111" };
      var sisalto =
        '<span class="pn-kello">' + esc(o.kello) + "</span>" +
        '<span class="pn-tunniste" style="background:' + esc(j.vari) + '">' + esc(j.nimi) + "</span>" +
        '<span class="pn-ottelu"><strong>' + esc(o.koti) + "</strong> &ndash; " + esc(o.vieras) + "</span>" +
        (!samaHalli && o.halli ? '<span class="pn-rivihalli">' + esc(lyhytHalli(o.halli)) + "</span>" : "");
      return o.linkki
        ? '<li><a class="pn-peli" href="' + esc(o.linkki) + '" target="_blank" rel="noopener">' + sisalto + "</a></li>"
        : '<li><span class="pn-peli">' + sisalto + "</span></li>";
    }).join("");

    var otsake = pelit.length > 1 ? "Seuraavat kotipelit" : "Seuraava kotipeli";

    el.hidden = false;
    el.innerHTML =
      '<section class="puhu-nauha" aria-label="' + otsake + '">' +
        '<div class="pn-sisalto">' +
          '<div class="pn-paa">' +
            '<p class="pn-otsake">' + otsake + "</p>" +
            '<span class="pn-paiva">' + esc(paivaTeksti(pelit[0].paiva, nytMs)) + "</span>" +
            (samaHalli ? '<a class="pn-halli" href="' + esc(karttalinkki(samaHalli)) + '" target="_blank" rel="noopener">' + esc(lyhytHalli(samaHalli)) + "</a>" : "") +
            (data.huomautus ? '<span class="pn-vapaa">' + LIPPU + esc(data.huomautus) + "</span>" : "") +
          "</div>" +
          '<ul class="pn-pelit">' + rivit + "</ul>" +
        "</div>" +
        '<a class="pn-nappi" href="' + esc(sivu) + '">Kaikki pelit ja kalenteri <span aria-hidden="true">&rarr;</span></a>' +
      "</section>";
  }

  function lisaaTyylit() {
    if (document.getElementById("puhu-nauha-tyyli")) return;
    var tyyli = document.createElement("style");
    tyyli.id = "puhu-nauha-tyyli";
    tyyli.textContent = CSS;
    document.head.appendChild(tyyli);
  }

  function alusta() {
    var el = document.getElementById("puhu-nauha");
    if (!el || el.getAttribute("data-puhu-valmis")) return;
    el.setAttribute("data-puhu-valmis", "1");
    el.hidden = true;
    lisaaTyylit();
    fetch(LAHDE + "nauha.json", { cache: "no-cache" })
      .then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); })
      .then(function (data) { piirra(el, data, Date.now()); })
      .catch(function (virhe) {
        el.hidden = true;
        if (window.console) console.warn("PuHu-nauha: otteluita ei saatu haettua.", virhe);
      });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", alusta);
  else alusta();
  // Squarespace 7.0 -teemojen Ajax-sivunvaihto ei lataa sivua uudelleen.
  window.addEventListener("mercury:load", alusta);
})();
