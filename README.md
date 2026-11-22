# Wichteln

Unsere Wunschzettel fürs Familien-Wichteln. Jede*r wählt die eigene Christbaumkugel, trägt Geschenkideen per Link ein und sieht, was sich die anderen wünschen.

- **Wunschzettel per Link:** Link aus dem Shop einfügen, Titel, Bild und Preis werden automatisch geholt. Fehlt etwas, kann man es selbst ergänzen.
- **Ideen ohne Link:** zum Beispiel „Kinogutschein“ oder „Etwas Selbstgemachtes“.
- **Herzenswunsch:** Markiert, was man sich am meisten wünscht.
- **Gut zu wissen:** Größen, Lieblingsfarben und was man gar nicht mag.
- **Amazon-Suche im Tool:** Suchen, nach Kategorie und Preis filtern und mit einem Tippen auf die Liste setzen (über SerpApi, Fallback amazonscraperapi).
- **Teilen statt Kopieren:** Unter Android lässt sich Wichteln als App installieren und erscheint im Teilen-Menü. Fürs iPhone gibt es eine Kurzbefehl-Anleitung im Tool unter „Direkt aus Apps teilen“.
- **Stöbern:** Öffnet außerdem die Suche bei Amazon oder Etsy im Shop, schon nach Budget und Kategorie gefiltert.
- **Jedes Jahr neu:** Frühere Jahre bleiben zum Nachschauen erhalten.
- **Verwaltung (nur mit Passwort):** Teilnehmende, Budget, Datum der Bescherung, neues Jahr starten.

Die Webseite liegt auf **GitHub Pages**. Die Daten liegen in einem kleinen **Cloudflare Worker** mit Datenbank (D1). Beides ist im kostenlosen Tarif.

```
site/      Webseite (HTML, CSS, JavaScript, ohne Build-Schritt)
worker/    API: Cloudflare Worker + D1-Datenbank
scripts/   Hilfsskript für das Deployment
.github/   Automatisches Veröffentlichen bei jedem Push auf main
```

---

## Einrichtung (einmalig, ca. 10 Minuten)

### 1. Cloudflare vorbereiten

1. Kostenloses Konto anlegen auf [dash.cloudflare.com](https://dash.cloudflare.com/sign-up).
2. Links **Workers & Pages** (bzw. „Compute“) einmal öffnen. Dabei bekommt dein Konto seine `workers.dev`-Adresse. Wenn Cloudflare dich nach einem Subdomain-Namen fragt, such dir einen aus.
3. **Account-ID kopieren:** Sie steht auf der Übersichtsseite von Workers & Pages rechts („Account ID“). Alternativ steht sie in der Adresszeile: `dash.cloudflare.com/<ACCOUNT-ID>/…`.
4. **API-Token erstellen:** **Manage Account** (bzw. dein Profil) → **API Tokens** → **Create Token**.
   - Token-Name z. B. `wichteln`, bei **Policies** die Vorlage **„Edit Cloudflare Workers“** wählen.
   - Falls nach dem Konto gefragt wird: dein Konto auswählen.
   - **Continue to summary** → **Create token** → Token kopieren. Er wird nur einmal angezeigt.

   Die Datenbank (D1, Name `wichteln`) ist bereits angelegt und in `worker/wrangler.toml` eingetragen. Wenn später neue Dateien in `worker/migrations/` dazukommen, braucht der Token zusätzlich `Account · D1 · Edit`, damit der Workflow sie einspielen kann.

### 2. Secrets bei GitHub eintragen

Im Repo: **Settings** → **Secrets and variables** → **Actions** → **New repository secret**. Diese drei Secrets anlegen:

| Name | Inhalt |
|---|---|
| `CLOUDFLARE_API_TOKEN` | der Token aus Schritt 1.4 |
| `CLOUDFLARE_ACCOUNT_ID` | die Account-ID aus Schritt 1.3 |
| `ADMIN_PASSWORD` | ein Passwort deiner Wahl für die Verwaltung |

### 3. GitHub Pages einschalten

Im Repo: **Settings** → **Pages** → bei **Source** „**GitHub Actions**“ auswählen.

### 4. Veröffentlichen

Im Repo: **Actions** → links **Veröffentlichen** → **Run workflow**. Nach 2–3 Minuten sind beide Teile grün.

Die Seite ist dann erreichbar unter **https://frameson0.github.io/wichteln/**

Ab jetzt wird bei jedem Push auf `main` automatisch neu veröffentlicht.

### 5. Loslegen

1. Seite öffnen, ganz unten auf **Verwaltung** klicken und mit dem Admin-Passwort anmelden.
2. Das **Budget** eintragen und die Teilnehmenden prüfen. Eric, Dana, Fine, Mika, Alwin und Silke sind schon angelegt. Bescherung ist auf den 24.12. gesetzt.
3. Den Link in die Familiengruppe schicken. Mehr braucht niemand: Kugel antippen, fertig.

### 6. Amazon-Suche im Tool einschalten (optional)

1. Kostenloses Konto bei [serpapi.com](https://serpapi.com/users/sign_up) anlegen und den **API Key** aus dem Dashboard kopieren (Gratis: 250 Suchen pro Monat).
2. Als Reserve ein kostenloses Konto bei [amazonscraperapi.com](https://amazonscraperapi.com) anlegen und den API-Key kopieren (Gratis: 1.000 Anfragen pro Monat). Er wird auch genutzt, um Bilder für geteilte Amazon-Links zu holen, wenn Amazon die normale Vorschau blockt.
3. Bei GitHub zwei weitere Secrets anlegen: `SERPAPI_KEY` und `AMAZONSCRAPER_KEY`.
4. Den Workflow **Veröffentlichen** erneut starten.

Beide Dienste haben keine Kreditkarte hinterlegt und berechnen nichts: Ist das Monatskontingent aufgebraucht, sagt das Such-Fenster Bescheid und bietet den Weg über amazon.de an. Jede Suche wird 24 Stunden zwischengespeichert, gleiche Suchen kosten also kein zweites Mal.

---

## Jedes Jahr

**Verwaltung** → **Neues Jahr starten**. Wer möchte, kann die Wunschzettel vom Vorjahr übernehmen. Ältere Jahre lassen sich unten auf der Seite über **Jahr** auswählen und anschauen, aber nicht mehr ändern.

## Gut zu wissen

- **Kein Login:** Wie gewünscht wählt man nur seinen Namen aus. Das Gerät merkt sich die Auswahl. Ändern kann man Ideen nur auf dem eigenen Wunschzettel.
- **Amazon-Vorschau:** Amazon blockt automatische Abrufe manchmal. Dann erscheint ein Hinweis, und man trägt Titel und Bild selbst ein. Die Bildadresse bekommt man per Rechtsklick aufs Produktbild („Bildadresse kopieren“), am Handy durch langes Drücken. Als zweiter Versuch fragt der Worker den kostenlosen Dienst [microlink.io](https://microlink.io).
- **Stöbern** öffnet nur die Suche im Shop. Es werden keine Daten an Amazon oder Etsy geschickt.
- **Kosten:** Die kostenlosen Tarife von Cloudflare Workers, D1 und GitHub Pages reichen für eine Familie bei Weitem.

## Lokal ausprobieren

```bash
cd worker
npm install
echo "ADMIN_PASSWORD=test123" > .dev.vars
npx wrangler d1 migrations apply wichteln --local
npx wrangler dev --port 8787
```

In einem zweiten Terminal:

```bash
cd site
python3 -m http.server 8080
```

Dann http://localhost:8080 öffnen. `site/config.js` zeigt lokal auf `http://localhost:8787`.

## Probleme?

- **Workflow scheitert bei „Prüfen, ob alle Secrets eingetragen sind“:** Ein Secret aus Schritt 2 fehlt oder ist falsch geschrieben.
- **Fehler „Authentication error“ oder „not authorized“:** Dem API-Token fehlt die Berechtigung `D1 · Edit`, oder er gilt für ein anderes Konto.
- **Fehler wegen fehlender workers.dev-Subdomain:** Schritt 1.2 nachholen und den Workflow erneut starten.
- **Die Seite lädt, zeigt aber „Keine Verbindung zur Wichtel-API“:** Im Actions-Log beim Schritt „API-Adresse eintragen“ nachsehen, welche Adresse eingetragen wurde. Falls sie fehlt oder falsch ist, unter **Settings → Secrets and variables → Actions → Variables** eine Variable `API_URL` mit der Worker-Adresse anlegen (z. B. `https://wichteln-api.deinname.workers.dev`) und den Workflow neu starten.
- **Verwaltung sagt „Falsches Admin-Passwort“:** Das Secret `ADMIN_PASSWORD` ändern und den Workflow neu starten.
