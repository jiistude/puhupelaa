#!/usr/bin/env node
/**
 * Hakee PuHun edustusjoukkueiden tulevat ottelut Koripalloliiton tulospalvelun
 * julkisista kalenterisyötteistä ja rakentaa niistä kansioon docs/:
 *
 *   index.html              otteluohjelmasivu
 *   pelit.ics               kaikki ottelut tilattavana kalenterina
 *   pelit-<tunniste>.ics    yhden joukkueen ottelut
 *   pelit-koti.ics          vain kotiottelut
 *   ottelut.json            sama data koneluettavana
 *
 * Käyttö:
 *   node hae.js                                   normaali ajo
 *   KONFIG=testi/joukkueet-testi.json node hae.js  ajo tallennetuilla syötteillä
 *
 * Ei ulkoisia riippuvuuksia. Vaatii Node 18 tai uudemman.
 * Pohja: StudeBros (basket.stude.fi), kevennetty vain tuleviin otteluihin.
 */

const fs = require("fs");
const path = require("path");

const JUURI = __dirname;
const ULOS = path.join(JUURI, process.env.ULOS || "docs");
const KONFIG = process.env.KONFIG || "joukkueet.json";
const asetukset = JSON.parse(fs.readFileSync(path.join(JUURI, KONFIG), "utf8"));
const TZ = asetukset.aikavyohyke || "Europe/Helsinki";
const KESTO_MIN = Number(asetukset.ottelun_kesto_min) > 0 ? Number(asetukset.ottelun_kesto_min) : 120;

/* ---------------------------------------------------------------- apurit */

const pad = (n) => String(n).padStart(2, "0");

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
  ));
}

function paivaTZ(d) {
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit",
  }).format(d);
}

function kelloTZ(d) {
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: TZ, hour: "2-digit", minute: "2-digit", hour12: false,
  }).format(d);
}

function tunnisteeksi(nimi) {
  return String(nimi).toLowerCase()
    .replace(/[äå]/g, "a").replace(/ö/g, "o")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

/* ------------------------------------------------------ kalenterin luku */

// Poistaa iCalendarin rivinjatkeet (rivi alkaa välilyönnillä tai tabilla).
function pura(teksti) {
  return teksti.replace(/\r\n/g, "\n").replace(/\n[ \t]/g, "");
}

function poistaEscapet(arvo) {
  return arvo
    .replace(/\\n/gi, "\n")
    .replace(/\\,/g, ",")
    .replace(/\\;/g, ";")
    .replace(/\\\\/g, "\\");
}

function lueTapahtumat(ics) {
  const tapahtumat = [];
  for (const lohko of pura(ics).split("BEGIN:VEVENT").slice(1)) {
    const runko = lohko.split("END:VEVENT")[0];
    const tapahtuma = {};
    for (const rivi of runko.split("\n")) {
      const kaksoispiste = rivi.indexOf(":");
      if (kaksoispiste < 1) continue;
      const [nimi, ...parametrit] = rivi.slice(0, kaksoispiste).split(";");
      tapahtuma[nimi.toUpperCase()] = {
        arvo: poistaEscapet(rivi.slice(kaksoispiste + 1).trim()),
        parametrit: Object.fromEntries(parametrit.map((p) => {
          const [k, v] = p.split("=");
          return [k.toUpperCase(), (v || "").replace(/"/g, "")];
        })),
      };
    }
    if (tapahtuma.DTSTART) tapahtumat.push(tapahtuma);
  }
  return tapahtumat;
}

// Etsii sen hetken, jolloin annettu seinäkelloaika osuu annetulle vyöhykkeelle.
function seinakelloUTC(v, k, p, t, m, tz) {
  let arvaus = Date.UTC(v, k - 1, p, t, m);
  for (let i = 0; i < 2; i++) {
    const osat = new Intl.DateTimeFormat("sv-SE", {
      timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", hour12: false,
    }).formatToParts(new Date(arvaus));
    const hae = (tyyppi) => Number(osat.find((o) => o.type === tyyppi).value);
    const toteutunut = Date.UTC(hae("year"), hae("month") - 1, hae("day"), hae("hour"), hae("minute"));
    arvaus += Date.UTC(v, k - 1, p, t, m) - toteutunut;
  }
  return new Date(arvaus);
}

function lueAika(kentta) {
  const osat = kentta.arvo.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/);
  if (!osat) return null;
  const [, v, k, p, t = "00", m = "00", , zulu] = osat;
  const luvut = [Number(v), Number(k), Number(p), Number(t), Number(m)];
  if (zulu) return new Date(Date.UTC(luvut[0], luvut[1] - 1, luvut[2], luvut[3], luvut[4]));
  return seinakelloUTC(...luvut, kentta.parametrit.TZID || TZ);
}

/* -------------------------------------------------------- normalisointi */

// SUMMARY on muotoa "Kotijoukkue – Vierasjoukkue, Sarjan nimi".
function jaaJoukkueet(summary, sarja) {
  let teksti = summary;
  if (sarja && teksti.endsWith(`, ${sarja}`)) teksti = teksti.slice(0, -(sarja.length + 2));
  const jako = teksti.split(/\s+[–—-]\s+/);
  if (jako.length >= 2) return { koti: jako[0].trim(), vieras: jako.slice(1).join(" - ").trim() };
  return { koti: teksti.trim(), vieras: "" };
}

function matchId(tapahtuma) {
  const url = tapahtuma.URL?.arvo || tapahtuma.DESCRIPTION?.arvo || "";
  const osuma = url.match(/\/match\/(\d+)/);
  if (osuma) return osuma[1];
  const uid = (tapahtuma.UID?.arvo || "").match(/^(\d+)/);
  return uid ? uid[1] : "";
}

// Varakeino, jos nimi_syotteessa puuttuu: oma joukkue toistuu joka ottelussa.
function paatteleOmaJoukkue(ottelut) {
  const laskuri = new Map();
  for (const o of ottelut) for (const n of [o.koti, o.vieras]) if (n) laskuri.set(n, (laskuri.get(n) || 0) + 1);
  let paras = "", eniten = 0;
  for (const [nimi, maara] of laskuri) if (maara > eniten) { paras = nimi; eniten = maara; }
  return eniten >= 2 ? paras : "";
}

/* ------------------------------------------------------------------ haku */

async function haeSyote(osoite) {
  // Paikallinen tiedosto sallitaan testausta varten.
  if (!/^https?:/i.test(osoite)) return fs.readFileSync(path.join(JUURI, osoite), "utf8");
  const vastaus = await fetch(osoite, {
    headers: { Accept: "text/calendar", "User-Agent": "puhu-pelit/1.0 (PuHu Juniorit ry, otteluohjelma)" },
  });
  if (!vastaus.ok) throw new Error(`HTTP ${vastaus.status} ${vastaus.statusText}`);
  return vastaus.text();
}

async function haeJoukkue(j) {
  const tapahtumat = lueTapahtumat(await haeSyote(j.kalenteri));
  const ottelut = [];
  for (const t of tapahtumat) {
    if ((t.STATUS?.arvo || "").toUpperCase() === "CANCELLED") continue;
    const alku = lueAika(t.DTSTART);
    if (!alku) continue;
    const sarja = t.CATEGORIES?.arvo || "";
    const { koti, vieras } = jaaJoukkueet(t.SUMMARY?.arvo || "", sarja);
    const id = matchId(t);
    ottelut.push({
      match_id: id,
      alku: alku.toISOString(),
      paiva: paivaTZ(alku),
      kello: kelloTZ(alku),
      koti, vieras, sarja,
      halli: (t.LOCATION?.arvo || "").replace(/\s+/g, " ").trim(),
      linkki: id ? `https://tulospalvelu.basket.fi/match/${id}` : (t.URL?.arvo || ""),
      joukkue: j.nimi,
      tunniste: j.tunniste || tunnisteeksi(j.nimi),
      paikka: "",
    });
  }

  // Koti vai vieras: syötteen SUMMARYssa kotijoukkue on aina ensin.
  const oma = j.nimi_syotteessa || paatteleOmaJoukkue(ottelut);
  let tunnistamatta = 0;
  for (const o of ottelut) {
    if (o.koti === oma) o.paikka = "koti";
    else if (o.vieras === oma) o.paikka = "vieras";
    else { tunnistamatta++; continue; }
    // Syötteessä miesten joukkue on nimellä "PuHu Juniorit". Sivulla ja
    // kalenterissa käytetään selkeämpää nimeä, ellei asetus kiellä.
    if (asetukset.korvaa_oma_nimi !== false) {
      if (o.paikka === "koti") o.koti = j.nimi; else o.vieras = j.nimi;
    }
  }
  if (tunnistamatta) {
    console.error(`${j.nimi}: ${tunnistamatta} ottelussa joukkuetta "${oma}" ei löytynyt. Tarkista nimi_syotteessa.`);
  }
  return ottelut;
}

/* ------------------------------------------------------------------ HTML */

const KUUKAUDET = ["tammikuuta", "helmikuuta", "maaliskuuta", "huhtikuuta", "toukokuuta", "kesäkuuta",
  "heinäkuuta", "elokuuta", "syyskuuta", "lokakuuta", "marraskuuta", "joulukuuta"];
const VIIKONPAIVAT = ["sunnuntaina", "maanantaina", "tiistaina", "keskiviikkona", "torstaina", "perjantaina", "lauantaina"];

function pitkaPaiva(iso) {
  const [v, k, p] = iso.split("-").map(Number);
  const d = new Date(Date.UTC(v, k - 1, p));
  return `${VIIKONPAIVAT[d.getUTCDay()]} ${p}. ${KUUKAUDET[k - 1]}`;
}

const LIPPU = `<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M3 8a1 1 0 0 1 1-1h16a1 1 0 0 1 1 1v2a2 2 0 0 0 0 4v2a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-2a2 2 0 0 0 0-4z"/><path d="M14 7v10" stroke-dasharray="2 2"/></svg>`;

function ottelukortti(o, joukkueet) {
  const j = joukkueet[o.tunniste] || { vari: "#111111", nimi: o.joukkue };
  const omaNimi = o.joukkue;
  const nimi = (n) => `<span${n === omaNimi ? ' class="oma"' : ""}>${esc(n)}</span>`;
  const vapaa = asetukset.kotipelien_huomautus ?? "Vapaa pääsy";

  return `
      <article class="ottelu" data-joukkue="${esc(o.tunniste)}" data-paikka="${esc(o.paikka)}" data-alku="${esc(o.alku)}" style="--vari:${esc(j.vari)}">
        <div class="aika">
          <span class="kello">${esc(o.kello)}</span>
          <span class="seuraavaMerkki" hidden>Seuraava</span>
        </div>
        <div class="tiedot">
          <div class="ylarivi"><span class="tunniste">${esc(j.nimi)}</span>${o.sarja ? `<span class="sarja">${esc(o.sarja)}</span>` : ""}</div>
          <div class="joukkueet">${nimi(o.koti)} <span class="vs">&ndash;</span> ${nimi(o.vieras)}</div>
          ${o.halli ? `<a class="halli" target="_blank" rel="noopener" href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(o.halli)}">${esc(o.halli)}</a>` : ""}
          ${o.paikka === "koti" && vapaa ? `<div class="vapaa">${LIPPU}${esc(vapaa)}</div>` : ""}
          ${o.linkki ? `<a class="basketfi" target="_blank" rel="noopener" href="${esc(o.linkki)}">Ottelu basket.fi:ssä <span aria-hidden="true">&rarr;</span></a>` : ""}
        </div>
      </article>`;
}

const CSS = `
  :root {
    --punainen: #D62A32;
    --punainen-tumma: #B5222A;
    --musta: #111;
    --teksti: #111;
    --himmea: #5E5E5E;
    --raja: #E2E2E2;
    --pinta: #F6F6F6;
    --tausta: #FFFFFF;
    --vapaa-pohja: #FCEBEC;
    --vapaa-teksti: #A11B22;
    --fontti: "Jost", "Futura PT", "Futura", "Century Gothic", "Helvetica Neue", Arial, sans-serif;
    color-scheme: light;
  }
  * { box-sizing: border-box; }
  [hidden] { display: none !important; }
  html { -webkit-text-size-adjust: 100%; }
  body {
    margin: 0; background: var(--tausta); color: var(--teksti);
    font-family: var(--fontti); font-size: 17px; line-height: 1.5; letter-spacing: .01em;
  }
  a { color: inherit; }
  .kehys { max-width: 760px; margin: 0 auto; padding: 0 16px 4rem; }

  /* Sivun pää: logo vasemmalla kuten seuran sivustolla, ei mustaa palkkia. */
  .sivupaa { padding: 1.5rem 0 0; }
  .logo { display: inline-block; line-height: 0; }
  .logo img { height: 60px; width: auto; display: block; }
  .logoteksti { font-weight: 700; text-transform: uppercase; letter-spacing: .12em; text-decoration: none; }
  header.otsikko { padding: 2rem 0 1.25rem; }
  h1 {
    font-size: clamp(1.45rem, 6.6vw, 2.75rem); line-height: 1.08; margin: 0;
    text-transform: uppercase; font-weight: 700; letter-spacing: .01em;
    overflow-wrap: break-word; hyphens: manual;
  }
  .alaotsikko {
    margin: .6rem 0 0; color: var(--punainen); font-weight: 500;
    text-transform: uppercase; letter-spacing: .06em; font-size: 1.1rem;
  }
  .selite { color: var(--himmea); margin: 1rem 0 0; max-width: 36rem; }

  /* Valinnat */
  .valinnat { position: sticky; top: 0; z-index: 2; background: var(--tausta); padding: .9rem 0 .75rem; border-bottom: 1px solid var(--raja); }
  .nakymat { display: flex; }
  .nakymat button {
    flex: 1 1 0; font: inherit; cursor: pointer;
    background: var(--tausta); color: var(--teksti);
    border: 2px solid var(--musta); margin-left: -2px; padding: .7rem .5rem;
    font-size: .85rem; font-weight: 700; text-transform: uppercase; letter-spacing: .12em;
  }
  .nakymat button:first-child { margin-left: 0; }
  .nakymat button[aria-selected="true"] { background: var(--punainen); border-color: var(--punainen); color: #fff; position: relative; }
  .nakymat .maara { font-weight: 500; opacity: .8; margin-left: .35em; letter-spacing: 0; }

  /* Joukkuetunniste: valkoinen teksti joukkueen värisessä laatikossa.
     Samaa muotoa käytetään ottelukortissa ja joukkuevalinnassa. */
  .tunniste, .joukkuevalinta button {
    display: inline-block; font-family: inherit; font-weight: 700; text-transform: uppercase;
    letter-spacing: .1em; line-height: 1.3; white-space: nowrap;
  }
  .tunniste { background: var(--vari); color: #fff; font-size: .68rem; padding: .2rem .5rem; }
  .joukkuevalinta { display: flex; flex-wrap: wrap; gap: .45rem; margin-top: .7rem; }
  .joukkuevalinta button {
    cursor: pointer; font-size: .78rem; padding: .4rem .8rem;
    background: var(--tausta); color: var(--vari); border: 2px solid var(--vari);
  }
  .joukkuevalinta button[aria-pressed="true"] { background: var(--vari); color: #fff; }
  .joukkuevalinta button:hover { box-shadow: inset 0 0 0 1px var(--vari); }
  /* "Molemmat" on neutraali, jottei se sekoitu kumpaankaan joukkueväriin. */
  .joukkuevalinta button.molemmat { --vari: #CFCFCF; color: var(--himmea); }
  .joukkuevalinta button.molemmat[aria-pressed="true"] { background: #E8E8E8; border-color: #E8E8E8; color: var(--teksti); }
  button:focus-visible, a:focus-visible { outline: 3px solid var(--punainen); outline-offset: 2px; }

  /* Lista */
  .paiva h2 {
    font-size: .8rem; font-weight: 700; text-transform: uppercase; letter-spacing: .14em;
    color: var(--punainen); margin: 2rem 0 .6rem;
  }
  .ottelu {
    display: grid; grid-template-columns: 4.6rem 1fr; gap: .25rem 1rem;
    border: 1px solid var(--raja); border-left: 5px solid var(--vari);
    padding: .9rem 1rem .95rem .9rem; margin-bottom: .55rem; background: var(--tausta);
  }
  .ottelu.seuraava { border-color: var(--vari); box-shadow: 0 0 0 1px var(--vari); }
  .aika { display: flex; flex-direction: column; align-items: flex-start; gap: .35rem; }
  .kello { font-size: 1.35rem; font-weight: 700; line-height: 1.1; font-variant-numeric: tabular-nums; }
  .seuraavaMerkki { font-size: .62rem; font-weight: 700; text-transform: uppercase; letter-spacing: .12em; color: var(--himmea); }
  .ylarivi { display: flex; flex-wrap: wrap; align-items: center; gap: .3rem .6rem; margin-bottom: .3rem; }
  .sarja { font-size: .72rem; font-weight: 600; text-transform: uppercase; letter-spacing: .1em; color: var(--himmea); }
  .joukkueet { font-size: 1.1rem; font-weight: 500; line-height: 1.3; margin: 0 0 .3rem; overflow-wrap: break-word; }
  .joukkueet .oma { font-weight: 700; }
  .joukkueet .vs { color: var(--himmea); }
  .halli { display: block; color: var(--himmea); font-size: .9rem; text-decoration: none; }
  .halli:hover { text-decoration: underline; text-underline-offset: 3px; }
  .vapaa {
    display: inline-flex; align-items: center; gap: .4rem; margin-top: .55rem;
    background: var(--vapaa-pohja); color: var(--vapaa-teksti); padding: .3rem .65rem;
    font-size: .78rem; font-weight: 700; text-transform: uppercase; letter-spacing: .1em;
  }
  .basketfi {
    display: block; width: fit-content; margin-top: .55rem; color: var(--teksti);
    font-size: .88rem; font-weight: 500; text-decoration: underline;
    text-decoration-color: var(--raja); text-decoration-thickness: 2px; text-underline-offset: 4px;
  }
  .basketfi:hover { text-decoration-color: var(--punainen); }
  .tyhja { color: var(--himmea); padding: 2rem 0 .5rem; margin: 0; }
  .huomio { background: var(--pinta); border-left: 4px solid var(--punainen); padding: .8rem 1rem; margin: 1.5rem 0 0; font-size: .95rem; }

  /* Kalenteritilaus */
  .tilaus { margin-top: 3rem; background: var(--pinta); padding: 1.25rem 1.25rem 1.1rem; }
  .tilaus summary {
    cursor: pointer; font-weight: 700; text-transform: uppercase; letter-spacing: .1em; font-size: .95rem;
    list-style: none; display: flex; justify-content: space-between; align-items: center; gap: 1rem;
  }
  .tilaus summary::-webkit-details-marker { display: none; }
  .tilaus summary::after { content: "+"; font-size: 1.4rem; line-height: 1; color: var(--punainen); }
  .tilaus[open] summary::after { content: "\\2013"; }
  .tilausNapit { display: flex; flex-wrap: wrap; gap: .5rem; margin: 1rem 0 .5rem; }
  .nappi {
    display: inline-block; font: inherit; cursor: pointer; text-decoration: none;
    background: var(--punainen); color: #fff; border: 2px solid var(--punainen);
    padding: .6rem 1rem; font-size: .78rem; font-weight: 700; text-transform: uppercase; letter-spacing: .12em;
  }
  .nappi:hover { background: var(--punainen-tumma); border-color: var(--punainen-tumma); }
  .nappi.toissijainen { background: transparent; color: var(--teksti); border-color: var(--musta); }
  .nappi.toissijainen:hover { background: var(--musta); color: #fff; }
  .tilausSelite { font-size: .9rem; color: var(--himmea); margin: .6rem 0 0; }
  .tilausSelite a { color: var(--teksti); font-weight: 600; text-underline-offset: 3px; }
  .osoite { word-break: break-all; color: var(--teksti); }

  footer { margin-top: 2.5rem; font-size: .85rem; color: var(--himmea); }
  footer a { color: var(--himmea); text-underline-offset: 3px; }

  /* Upotus Squarespaceen (?upotus=1): ei logoa eikä otsikkoa, ne tulevat isäntäsivulta. */
  html.upotus .sivupaa, html.upotus header.otsikko, html.upotus footer .seura { display: none; }
  html.upotus .kehys { padding-bottom: 1rem; }
  html.upotus .valinnat { position: static; padding-top: .25rem; }

  @media (max-width: 420px) {
    body { font-size: 16px; }
    .sivupaa { padding-top: 1rem; }
    .logo img { height: 48px; }
    header.otsikko { padding: 1.5rem 0 1rem; }
    .ottelu { grid-template-columns: 3.9rem 1fr; gap: .2rem .75rem; padding: .8rem .8rem .85rem .75rem; }
    .kello { font-size: 1.2rem; }
    .nakymat button { font-size: .78rem; letter-spacing: .1em; padding: .65rem .3rem; }
    .joukkuevalinta { flex-wrap: nowrap; gap: .35rem; }
    .joukkuevalinta button { flex: 1 1 auto; padding: .4rem .35rem; font-size: .68rem; letter-spacing: .06em; }
  }
  @media print {
    .valinnat, .tilaus, .basketfi { display: none !important; }
    .ottelu { break-inside: avoid; }
  }
`;

function rakennaHtml({ tulevat, puuttuvat, paivitetty }) {
  const joukkueLista = asetukset.joukkueet.map((j) => ({ ...j, tunniste: j.tunniste || tunnisteeksi(j.nimi), vari: j.vari || "#111111" }));
  const joukkueet = Object.fromEntries(joukkueLista.map((j) => [j.tunniste, j]));
  const osoite = (asetukset.sivun_osoite || "").replace(/\/+$/, "");
  const seura = asetukset.seuran_sivu || "";

  const ryhmat = new Map();
  for (const o of tulevat) {
    if (!ryhmat.has(o.paiva)) ryhmat.set(o.paiva, []);
    ryhmat.get(o.paiva).push(o);
  }
  const lista = [...ryhmat.entries()].map(([pvm, ottelut]) => `
    <section class="paiva">
      <h2>${esc(pitkaPaiva(pvm))}</h2>
      ${ottelut.map((o) => ottelukortti(o, joukkueet)).join("")}
    </section>`).join("");

  // Kalenterin tilaus. Tilaus päivittyy itsestään, ladattu tiedosto ei.
  const icsHttps = osoite ? `${osoite}/pelit.ics` : "";
  const webcal = (tiedosto) => `${osoite}/${tiedosto}`.replace(/^https?:/, "webcal:");
  const tilausHtml = icsHttps ? `
  <details class="tilaus" id="tilaus">
    <summary>Tilaa ottelut omaan kalenteriin</summary>
    <div class="tilausNapit">
      <a class="nappi" target="_blank" rel="noopener" href="https://calendar.google.com/calendar/render?cid=${esc(webcal("pelit.ics"))}">Google-kalenteri</a>
      <a class="nappi toissijainen" href="${esc(webcal("pelit.ics"))}">iPhone tai Mac</a>
      <button type="button" class="nappi toissijainen" id="kopioi" data-osoite="${esc(icsHttps)}">Kopioi osoite</button>
    </div>
    <p class="tilausSelite">Kalenterissa ovat molempien joukkueiden koti- ja vierasottelut. Tilattu kalenteri päivittyy itsestään, myös kun otteluaikoja siirretään. Osoite on <span class="osoite">${esc(icsHttps)}</span>.</p>
    <p class="tilausSelite">Vain osa otteluista: <a href="${esc(webcal("pelit-koti.ics"))}">Vain kotiottelut</a>${joukkueLista.map((j) =>
      ` &middot; <a href="${esc(webcal(`pelit-${j.tunniste}.ics`))}">${esc(j.nimi)}</a>`).join("")}</p>
  </details>` : `<p><a class="nappi" href="pelit.ics">Lataa ottelut kalenteriin</a></p>`;

  const huomio = puuttuvat.length
    ? `<p class="huomio">Otteluohjelmaa ei saatu haettua: ${puuttuvat.map(esc).join(", ")}. Ottelut ilmestyvät tähän automaattisesti, kun tiedot ovat saatavilla.</p>`
    : "";

  // Linkin esikatselu (WhatsApp ym.) kertoo seuraavan kotipelin.
  const seuraavaKoti = tulevat.find((o) => o.paikka === "koti");
  const jakoKuvaus = seuraavaKoti
    ? `Seuraava kotipeli: ${seuraavaKoti.koti} – ${seuraavaKoti.vieras}, ${pitkaPaiva(seuraavaKoti.paiva)} klo ${seuraavaKoti.kello.replace(":", ".")}${seuraavaKoti.halli ? `, ${seuraavaKoti.halli.split(",")[0]}` : ""}. ${asetukset.kotipelien_huomautus ?? "Vapaa pääsy"}.`
    : (asetukset.kuvaus || "");
  const otsikko = `${asetukset.otsikko} | PuHu`;
  const logoKuva = asetukset.logo
    ? `<img src="${esc(asetukset.logo)}" alt="PuHu Vantaa" width="750" height="274" onerror="this.hidden=true;this.nextElementSibling.hidden=false"><span class="logoteksti" hidden>PuHu Juniorit</span>`
    : `<span class="logoteksti">PuHu Juniorit</span>`;

  return `<!doctype html>
<html lang="fi">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(otsikko)}</title>
<meta name="description" content="${esc(jakoKuvaus)}">
${asetukset.favicon ? `<link rel="icon" href="${esc(asetukset.favicon)}">` : ""}
<meta property="og:type" content="website">
<meta property="og:site_name" content="PuHu Juniorit">
<meta property="og:title" content="${esc(otsikko)}">
<meta property="og:description" content="${esc(jakoKuvaus)}">
<meta property="og:locale" content="fi_FI">
${osoite ? `<meta property="og:url" content="${esc(osoite)}/">` : ""}
${osoite && asetukset.logo && !/^https?:/.test(asetukset.logo) ? `<meta property="og:image" content="${esc(osoite)}/${esc(asetukset.logo)}">` : ""}
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Jost:wght@400;500;600;700&display=swap" rel="stylesheet">
<script>
  // Upotustila asetetaan ennen piirtoa, jottei logo välähdä iframessa.
  if (/[?&]upotus=1\\b/.test(location.search)) document.documentElement.classList.add('upotus');
</script>
<style>${CSS}</style>
</head>
<body>
<div class="kehys">
  <div class="sivupaa">
    ${seura ? `<a class="logo" href="${esc(seura)}" aria-label="PuHu Juniorit, etusivu">${logoKuva}</a>` : `<span class="logo">${logoKuva}</span>`}
  </div>

  <header class="otsikko">
    <h1>${esc(asetukset.otsikko)}</h1>
    ${asetukset.alaotsikko ? `<p class="alaotsikko">${esc(asetukset.alaotsikko)}</p>` : ""}
    ${asetukset.kuvaus ? `<p class="selite">${esc(asetukset.kuvaus)}</p>` : ""}
  </header>

  <div class="valinnat">
    <div class="nakymat" role="tablist" aria-label="Ottelut">
      <button type="button" role="tab" data-paikka="koti" aria-selected="true">Kotipelit<span class="maara"></span></button>
      <button type="button" role="tab" data-paikka="vieras" aria-selected="false">Vieraspelit<span class="maara"></span></button>
    </div>
    <div class="joukkuevalinta" role="group" aria-label="Joukkue">
      <button type="button" class="molemmat" data-joukkue="molemmat" aria-pressed="true">Molemmat</button>
      ${joukkueLista.map((j) => `<button type="button" data-joukkue="${esc(j.tunniste)}" aria-pressed="false" style="--vari:${esc(j.vari)}">${esc(j.nimi)}</button>`).join("\n      ")}
    </div>
  </div>

  ${huomio}

  <main id="lista">
    ${lista}
    <p class="tyhja" id="tyhja" hidden></p>
  </main>

  ${tilausHtml}

  <footer>
    <p>Päivitetty ${esc(paivitetty)}. Lähde: <a href="https://tulospalvelu.basket.fi/" target="_blank" rel="noopener">Koripalloliiton tulospalvelu</a>.</p>
    ${seura ? `<p class="seura"><a href="${esc(seura)}">PuHu Juniorit ry</a></p>` : ""}
  </footer>
</div>

<script>
(function () {
  var OLETUSKESTO = ${KESTO_MIN};
  var NIMET = ${JSON.stringify(Object.fromEntries(joukkueLista.map((j) => [j.tunniste, j.nimi])))};
  var kortit = [].slice.call(document.querySelectorAll('.ottelu'));
  // Oletuksena kotipelit: tärkein kysymys on, milloin on seuraava kotipeli.
  var tila = { paikka: 'koti', joukkue: 'molemmat' };

  // Sivu on rakennettu ehkä tunteja sitten: jo pelatut ottelut piiloon heti.
  var nyt = Date.now();
  kortit.forEach(function (k) {
    var alku = Date.parse(k.dataset.alku);
    if (!isNaN(alku) && alku + OLETUSKESTO * 60000 < nyt) k.dataset.ohi = '1';
  });

  // Valinta luetaan osoitteen lopusta, esim. #vieras tai #vieras/puhuttaret.
  // Sama muoto toimii myös upotuksen iframe-osoitteessa.
  function lueOsoite() {
    location.hash.replace('#', '').split('/').forEach(function (osa) {
      if (osa === 'koti' || osa === 'vieras') tila.paikka = osa;
      else if (NIMET[osa]) tila.joukkue = osa;
    });
  }
  function kirjoitaOsoite() {
    var osat = [];
    if (tila.paikka !== 'koti') osat.push(tila.paikka);
    if (tila.joukkue !== 'molemmat') osat.push(tila.joukkue);
    var hash = osat.length ? '#' + osat.join('/') : '';
    if (location.hash !== hash) history.replaceState(null, '', hash || location.pathname + location.search);
  }

  function paivita() {
    var maarat = { koti: 0, vieras: 0 };
    var ensimmainen = null;
    kortit.forEach(function (k) {
      k.classList.remove('seuraava');
      k.querySelector('.seuraavaMerkki').hidden = true;
      if (k.dataset.ohi) { k.hidden = true; return; }
      var joukkueOk = tila.joukkue === 'molemmat' || k.dataset.joukkue === tila.joukkue;
      if (joukkueOk && maarat[k.dataset.paikka] !== undefined) maarat[k.dataset.paikka]++;
      var nakyy = joukkueOk && k.dataset.paikka === tila.paikka;
      k.hidden = !nakyy;
      if (nakyy && !ensimmainen) ensimmainen = k;
    });
    if (ensimmainen) {
      ensimmainen.classList.add('seuraava');
      ensimmainen.querySelector('.seuraavaMerkki').hidden = false;
    }
    document.querySelectorAll('.paiva').forEach(function (p) {
      p.hidden = !p.querySelector('.ottelu:not([hidden])');
    });
    document.querySelectorAll('.nakymat button').forEach(function (b) {
      b.setAttribute('aria-selected', String(b.dataset.paikka === tila.paikka));
      b.querySelector('.maara').textContent = maarat[b.dataset.paikka];
    });
    document.querySelectorAll('.joukkuevalinta button').forEach(function (b) {
      b.setAttribute('aria-pressed', String(b.dataset.joukkue === tila.joukkue));
    });
    var tyhja = document.getElementById('tyhja');
    if (!ensimmainen) {
      var kuka = tila.joukkue === 'molemmat' ? '' : NIMET[tila.joukkue] + ': ';
      tyhja.textContent = kuka + 'Ei tulevia ' + (tila.paikka === 'koti' ? 'kotiotteluita' : 'vierasotteluita') + ' tiedossa.';
    }
    tyhja.hidden = !!ensimmainen;
    kerroKorkeus();
  }

  document.querySelectorAll('.nakymat button').forEach(function (b) {
    b.addEventListener('click', function () { tila.paikka = b.dataset.paikka; kirjoitaOsoite(); paivita(); });
  });
  document.querySelectorAll('.joukkuevalinta button').forEach(function (b) {
    b.addEventListener('click', function () { tila.joukkue = b.dataset.joukkue; kirjoitaOsoite(); paivita(); });
  });

  // Upotettuna sivu kertoo korkeutensa isäntäsivulle, joka säätää iframen.
  function kerroKorkeus() {
    if (window.parent === window) return;
    window.parent.postMessage({ tyyppi: 'puhu-pelit-korkeus', korkeus: document.documentElement.scrollHeight }, '*');
  }
  window.addEventListener('load', kerroKorkeus);
  window.addEventListener('resize', kerroKorkeus);

  var tilaus = document.getElementById('tilaus');
  if (tilaus) {
    if (window.matchMedia('(min-width: 720px)').matches && !document.documentElement.classList.contains('upotus')) tilaus.open = true;
    tilaus.addEventListener('toggle', kerroKorkeus);
  }
  var kopioi = document.getElementById('kopioi');
  if (kopioi) kopioi.addEventListener('click', function () {
    var teksti = kopioi.dataset.osoite, alkup = kopioi.textContent;
    var valmis = function () { kopioi.textContent = 'Kopioitu'; setTimeout(function () { kopioi.textContent = alkup; }, 2000); };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(teksti).then(valmis, function () { window.prompt('Kopioi osoite:', teksti); });
    else window.prompt('Kopioi osoite:', teksti);
  });

  lueOsoite();
  paivita();
})();
</script>
</body>
</html>
`;
}

/* ------------------------------------------------------------------- ICS */

function utcLeima(d) {
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}00Z`;
}

// Rivit taitetaan 75 tavuun standardin mukaisesti, monitavuisia merkkejä rikkomatta.
function taita(rivi) {
  const osat = [];
  let jaljella = rivi;
  while (Buffer.byteLength(jaljella, "utf8") > 74) {
    let leikkaus = 74;
    while (Buffer.byteLength(jaljella.slice(0, leikkaus), "utf8") > 74) leikkaus--;
    osat.push(jaljella.slice(0, leikkaus));
    jaljella = " " + jaljella.slice(leikkaus);
  }
  osat.push(jaljella);
  return osat.join("\r\n");
}

function icsTeksti(s) {
  return String(s ?? "").replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
}

function rakennaIcs(ottelut, nimi) {
  const nyt = utcLeima(new Date());
  const rivit = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//puhujuniorit.fi//otteluohjelma//FI",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    taita(`X-WR-CALNAME:${icsTeksti(nimi)}`),
    "X-WR-TIMEZONE:Europe/Helsinki",
    "REFRESH-INTERVAL;VALUE=DURATION:PT6H",
    "X-PUBLISHED-TTL:PT6H",
  ];
  for (const o of ottelut) {
    const alku = new Date(o.alku);
    const loppu = new Date(alku.getTime() + KESTO_MIN * 60000);
    const kv = o.paikka === "koti" ? `Kotiottelu – ${(asetukset.kotipelien_huomautus ?? "Vapaa pääsy").toLowerCase()}` : o.paikka === "vieras" ? "Vierasottelu" : "";
    rivit.push(
      "BEGIN:VEVENT",
      `UID:${o.match_id || `${o.paiva}-${o.kello}-${tunnisteeksi(o.koti)}`}-${o.tunniste}@pelit.puhujuniorit.fi`,
      `DTSTAMP:${nyt}`,
      `DTSTART:${utcLeima(alku)}`,
      `DTEND:${utcLeima(loppu)}`,
      taita(`SUMMARY:${icsTeksti(`${o.koti} – ${o.vieras}`)}`),
      taita(`LOCATION:${icsTeksti(o.halli)}`),
      taita(`DESCRIPTION:${icsTeksti([o.sarja, kv, o.linkki ? `Ottelu basket.fi:ssä: ${o.linkki}` : ""].filter(Boolean).join("\n"))}`),
      ...(o.linkki ? [taita(`URL;VALUE=URI:${o.linkki}`)] : []),
      "END:VEVENT"
    );
  }
  rivit.push("END:VCALENDAR");
  return rivit.join("\r\n") + "\r\n";
}

/* ------------------------------------------------------------------ ajo */

async function main() {
  fs.mkdirSync(ULOS, { recursive: true });

  let kaikki = [];
  const puuttuvat = [];
  let virheita = 0;

  for (const j of asetukset.joukkueet) {
    try {
      const ottelut = await haeJoukkue(j);
      kaikki.push(...ottelut);
      console.log(`${j.nimi}: ${ottelut.length} ottelua syötteessä.`);
    } catch (virhe) {
      // Yhden joukkueen ongelma ei saa kaataa koko sivua.
      virheita++;
      puuttuvat.push(j.nimi);
      console.error(`${j.nimi}: haku epäonnistui (${virhe.message}).`);
    }
  }

  // Jos kaikki haut epäonnistuivat, jätetään edellinen sivu voimaan.
  if (virheita === asetukset.joukkueet.length) {
    console.error("Yksikään syöte ei vastannut. Sivua ei kirjoitettu uudelleen.");
    process.exit(1);
  }

  // Vain tulevat: ottelu poistuu listalta, kun sen arvioitu kesto on kulunut.
  const nytMs = Date.now();
  const rajaMs = nytMs + Math.abs(asetukset.tulevat_paivat ?? 300) * 86400000;
  const tulevat = kaikki
    .filter((o) => {
      const alku = new Date(o.alku).getTime();
      return alku + KESTO_MIN * 60000 >= nytMs && alku <= rajaMs;
    })
    .sort((a, b) => a.alku.localeCompare(b.alku) || a.joukkue.localeCompare(b.joukkue, "fi"));

  const paivitetty = new Intl.DateTimeFormat("fi-FI", {
    timeZone: TZ, dateStyle: "long", timeStyle: "short",
  }).format(new Date());

  fs.writeFileSync(path.join(ULOS, "index.html"), rakennaHtml({ tulevat, puuttuvat, paivitetty }));
  fs.writeFileSync(path.join(ULOS, "pelit.ics"), rakennaIcs(tulevat, "PuHu edustusjoukkueet"));
  for (const j of asetukset.joukkueet) {
    const tunniste = j.tunniste || tunnisteeksi(j.nimi);
    fs.writeFileSync(path.join(ULOS, `pelit-${tunniste}.ics`), rakennaIcs(tulevat.filter((o) => o.tunniste === tunniste), j.nimi));
  }
  fs.writeFileSync(path.join(ULOS, "pelit-koti.ics"), rakennaIcs(tulevat.filter((o) => o.paikka === "koti"), "PuHu kotiottelut"));
  fs.writeFileSync(path.join(ULOS, "ottelut.json"), JSON.stringify({ paivitetty, tulevat }, null, 2));
  fs.writeFileSync(path.join(ULOS, ".nojekyll"), "");

  // Oma osoite talteen, jotta GitHub Pages ei unohda sitä.
  const host = (asetukset.sivun_osoite || "").replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  if (host && !host.endsWith("github.io")) fs.writeFileSync(path.join(ULOS, "CNAME"), host + "\n");

  const koti = tulevat.filter((o) => o.paikka === "koti").length;
  console.log(`Valmis: ${tulevat.length} tulevaa ottelua (${koti} kotona, ${tulevat.length - koti} vieraissa).`);
}

main().catch((virhe) => {
  console.error(virhe);
  process.exit(1);
});
