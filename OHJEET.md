# PuHun edustusjoukkueiden ottelut

Sivu kokoaa **Puhuttarien** ja **PuHu Miesten** tulevat ottelut yhdelle sivulle osoitteeseen
**pelit.puhujuniorit.fi** ja tuottaa niistä tilattavat kalenterit. Tiedot haetaan
Koripalloliiton tulospalvelun julkisista kalenterisyötteistä kahdesti päivässä. API-avainta ei
tarvita, eikä sivulle tarvitse kirjata mitään käsin.

Rakenne on sama kuin StudeBros-sivulla (basket.stude.fi), mutta kevyempi: vain tulevat ottelut,
ei tuloksia eikä arkistoa.

## Mitä sivulla on

- Tulevat ottelut päivittäin ryhmiteltyinä, lähin ensin. Lähin ottelu on korostettu ("Seuraava").
- **Oletusnäkymä on kotipelit**, koska tärkein kysymys on, milloin on seuraava kotipeli.
  Vieraspelit ovat toinen valinta. Kaikki-näkymää ei ole (lisätään, jos sitä kaivataan).
- Joukkuevalinta **Molemmat / Puhuttaret / PuHu Miehet**. Joukkuetunniste on sama kuin
  ottelukortissa: Puhuttaret valkoisella tekstillä punaisessa laatikossa, PuHu Miehet mustassa.
- Kotipeleissä selvästi erottuva merkintä **Vapaa pääsy** (asetus `kotipelien_huomautus`,
  tyhjä merkkijono poistaa sen)
- Jokaisesta ottelusta linkki tulospalveluun ("Ottelu basket.fi:ssä") ja halli Google Mapsiin
- Kalenteritilaukset: kaikki ottelut, kumpikin joukkue erikseen ja vain kotiottelut
- Jo pelatut ottelut katoavat listalta itsestään noin kaksi tuntia alkamisen jälkeen

Valinnan voi antaa osoitteessa, esim. `pelit.puhujuniorit.fi/#vieras` tai
`pelit.puhujuniorit.fi/#puhuttaret` (Puhuttarien kotipelit) tai `#vieras/miehet`. Valinta päivittyy osoitteeseen, joten näkymän voi
jakaa linkkinä.

## Tiedostot

| Tiedosto | Mitä |
|---|---|
| `joukkueet.json` | Asetukset: otsikot, joukkueet, kalenterisyötteet, logo |
| `hae.js` | Hakee syötteet ja rakentaa sivun. Ei riippuvuuksia. |
| `.github/workflows/paivita.yml` | Ajaa haun klo ~6 ja ~21 Suomen aikaa sekä jokaisen muutoksen jälkeen |
| `docs/` | Valmis sivu ja kalenterit (GitHub Pages julkaisee tämän kansion) |
| `docs/nauha.js` | Etusivun "Seuraavat kotipelit" -nauha, käsin ylläpidetty (ks. kohta 4) |
| `testi/` | Tallennetut syötteet paikallista testausta varten |

## Joukkueet

| Joukkue | Sarja | Kalenterisyöte |
|---|---|---|
| Puhuttaret | Naisten I divisioona | `koripallo-api.torneopal.fi/calendar/team/36` |
| PuHu Miehet | Miesten I divisioona B | `koripallo-api.torneopal.fi/calendar/team/1011` |

**Huom. nimistä:** tulospalvelussa miesten joukkue on nimellä **PuHu Juniorit**. Kenttä
`nimi_syotteessa` kertoo, millä nimellä joukkue löytyy syötteestä. Siitä päätellään koti- ja
vierasottelut (kotijoukkue on syötteessä aina ensin). Sivulla ja kalenterissa näytetään
kentän `nimi` mukainen nimi. Jos haluat näyttää tulospalvelun nimet sellaisinaan, lisää
`joukkueet.json`-tiedostoon rivi `"korvaa_oma_nimi": false,`.

**Kun kausi vaihtuu tai joukkue vaihtaa sarjaa:** joukkueen numero voi muuttua. Numero on sama
kuin tulospalvelun osoitteessa `tulospalvelu.basket.fi/team/`**`36`**`/fixture`. Vaihda numero
kenttään `kalenteri` ja tarkista `nimi_syotteessa`. Jos nimi ei täsmää, Actions-ajon loki
kertoo sen ("joukkuetta ... ei löytynyt"), eikä ottelu näy sivulla lainkaan.

## Käyttöönotto

### 1. Repo ja GitHub Pages

1. Luo GitHubiin uusi julkinen repo, esim. `jiistude/puhu-pelit`, ja vie nämä tiedostot sinne
   (koko kansio, myös piilokansio `.github`).
2. **Settings → Actions → General → Workflow permissions:** valitse *Read and write permissions*.
   Ilman tätä robotti ei voi tallentaa päivityksiä.
3. **Settings → Pages:** Source *Deploy from a branch*, branch `main`, kansio `/docs`.
4. **Actions**-välilehti → *Päivitä ottelut* → *Run workflow*. Ensimmäinen ajo korvaa
   testidatalla rakennetun sivun oikealla datalla.

### 2. Oma osoite pelit.puhujuniorit.fi

1. puhujuniorit.fi:n DNS-hallinnassa lisää tietue:
   `pelit  CNAME  jiistude.github.io.`
   (käyttäjä- tai organisaationimi sen mukaan, kenen alla repo on)
2. **Settings → Pages → Custom domain:** `pelit.puhujuniorit.fi` → Save.
   Tiedosto `docs/CNAME` kirjoitetaan joka ajossa asetuksen `sivun_osoite` perusteella, joten
   osoite ei katoa.
3. Kun GitHub on tarkistanut DNS:n, ruksaa **Enforce HTTPS**. Sertifikaatti voi viedä tunnin.

Suositus: varmista domain GitHubissa (Settings → Pages → *Verified domains* käyttäjä- tai
organisaatioprofiilissa). Se estää ketään muuta ottamasta alidomainia käyttöön, jos repo
joskus poistetaan mutta DNS-tietue jää.

### 3. Linkki Squarespace-sivustolle

**Suositus: linkki tai painike**, esim. valikkoon kohta *Ottelut* → `https://pelit.puhujuniorit.fi`.
Yksinkertaisin ja toimii kaikilla Squarespace-tilauksilla. Sivu on tehty seuran sivuston
näköiseksi, ja logosta pääsee takaisin puhujuniorit.fi:n etusivulle.

**Vaihtoehto: upotus sivun sisään.** Lisää Squarespace-sivulle *Code*-lohko ja siihen:

```html
<iframe id="puhu-pelit" src="https://pelit.puhujuniorit.fi/?upotus=1"
  title="PuHun edustusjoukkueiden ottelut" loading="lazy"
  style="width:100%;border:0;height:1200px;display:block"></iframe>
<script>
  window.addEventListener('message', function (e) {
    if (e.origin !== 'https://pelit.puhujuniorit.fi') return;
    if (e.data && e.data.tyyppi === 'puhu-pelit-korkeus') {
      document.getElementById('puhu-pelit').style.height = e.data.korkeus + 'px';
    }
  });
</script>
```

- `?upotus=1` piilottaa sivun oman logon ja otsikon, koska ne tulevat Squarespacelta.
- Skripti säätää iframen korkeuden sisällön mukaan, ettei upotukseen tule omaa vierityspalkkia.
  Jos Squarespace-tilaus ei salli skriptejä Code-lohkossa, jätä `<script>` pois. Iframe toimii
  silloinkin, mutta kiinteällä korkeudella ja omalla vierityksellä. Tarkista tilaustasosi
  ennen kuin lupaat upotuksen kenellekään.
- Valmiiksi rajattu näkymä, esim. vain Puhuttarien pelit (kotipelit oletuksena):
  `src="https://pelit.puhujuniorit.fi/?upotus=1#puhuttaret"`. Sopii esim. joukkuesivulle.

### 4. Seuraavat kotipelit -nauha etusivulle

Etusivulle (tai mille tahansa sivulle) saa kompaktin nauhan, joka näyttää kaksi seuraavaa
kotipeliä päivästä riippumatta: halli, vapaa pääsy ja ottelut päivineen ja kellonaikoineen,
sekä painikkeen tälle sivulle. Jos molemmat pelit ovat samana päivänä, päivä näkyy kerran
otsikkorivillä; muuten jokaisella rivillä. Lisää Squarespaceen *Code*-lohko, esim. heti hero-karusellin alle:

```html
<div id="puhu-nauha"></div>
<script src="https://pelit.puhujuniorit.fi/nauha.js" defer></script>
```

- Nauha hakee tiedot tiedostosta `nauha.json`, jonka `hae.js` kirjoittaa jokaisella ajolla.
  Ottelu poistuu nauhasta itsestään noin kaksi tuntia alkamisensa jälkeen, ja tilalle tulee
  seuraava kotipeli ilman uutta ajoa.
- Näytettävien pelien määrä: `<div id="puhu-nauha" data-maara="3"></div>` (oletus 2).
- Jos kotipelejä ei ole tiedossa (esim. joulutauko) tai haku epäonnistuu, nauha ei näy
  lainkaan.
- Vain yhden joukkueen pelit, esim. joukkuesivulle: `<div id="puhu-nauha" data-joukkue="puhuttaret"></div>`
  (`miehet` miesten joukkueelle). Painike vie silloin suoraan joukkueen näkymään.
- Fontti periytyy Squarespacelta, joten nauha näyttää sivuston omalta. Tyylit ovat
  `.puhu-nauha`-luokan alla eivätkä vaikuta muuhun sivustoon.
- **Edellyttää, että Squarespace-tilaus sallii skriptit Code-lohkossa.** Jos nauha näkyy vasta,
  kun sivun lataa uudelleen, mutta ei kun sivulle tulee toiselta sivulta, sivustossa on päällä
  Ajax-sivunvaihto (7.0-teemat). Nauha yrittää käsitellä sen itse; jos ei onnistu, Ajax-lataus
  kytketään pois sivuston asetuksista.
- `docs/nauha.js` on käsin ylläpidetty tiedosto, `hae.js` ei kirjoita sitä. Muutokset näkyvät
  seuran sivuilla noin kymmenen minuutin kuluessa julkaisusta, eikä Squarespaceen tarvitse koskea.

## Ulkoasu

Värit, typografia ja rytmi on haettu puhujuniorit.fi:stä: seuran logo,
punainen `#D62A32`, versaalit ja harvennetut otsikot, suorakulmaiset painikkeet.

**Fontti:** seuran sivusto käyttää Futura PT:tä, joka tulee Adoben fonttipalvelusta
Squarespacen lisenssillä. Sitä ei voi käyttää toisella osoitteella. Tilalla on **Jost**
(Google Fonts, ilmainen), joka on suunniteltu Futuran pohjalta ja näyttää lähes samalta.

**Logo** on tiedostossa `docs/logo.png` (läpinäkyvä PNG) ja linkittää puhujuniorit.fi:n
etusivulle. Sivulla ei ole mustaa yläpalkkia. Seuran sivustolla sellainen näkyy vain
mobiilin hampurilaisvalikon kanssa, eikä tällä sivulla ole valikkoa. `hae.js` ei koske
logotiedostoon, joten sen voi vaihtaa vain korvaamalla tiedoston.

Joukkueiden tunnusvärit (`vari`) näkyvät joukkuetunnisteessa, joukkuevalinnassa ja
ottelukortin reunaviivassa.

## Testaus omalla koneella

```
KONFIG=testi/joukkueet-testi.json node hae.js
```

Ajo käyttää `testi/`-kansion tallennettuja syötteitä ja kirjoittaa sivun `docs/`-kansioon.
Avaa `docs/index.html` selaimessa. Normaali `node hae.js` hakee syötteet verkosta.

## Jos jokin menee rikki

- **Sivu ei päivity:** Actions-välilehdeltä näkee viimeisimmän ajon lokin. Jos kumpikaan syöte
  ei vastaa, edellinen sivu jää voimaan eikä mitään rikota.
- **Toisen joukkueen haku epäonnistuu:** sivu rakentuu toisen joukkueen tiedoilla ja näyttää
  huomautuksen.
- **Ottelu puuttuu koti/vieras-näkymistä:** `nimi_syotteessa` ei täsmää tulospalvelun nimeen.
