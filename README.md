# Wunschliste

Wunschzettel für die Familie. Man wählt die Liste seiner Familie (z. B. Goldenstein oder Kebel), tippt auf den eigenen Namen, meldet sich mit einem selbst gewählten 4-stelligen Code an und trägt Wünsche ein. Die anderen sehen die Wünsche und können sie als gekauft markieren, ohne dass die beschenkte Person es merkt.

- **Listen pro Familie und Jahr:** z. B. „Weihnachten 2026“ oder „Geburtstag Eric 27“. Liegt der Termin zwischen 1. Dezember und 6. Januar, sieht die Liste weihnachtlich aus.
- **Codes:** Jede Person legt ihren Code beim ersten Mal selbst fest. Ohne Code gibt der Server keine Wunschzettel heraus. „Code vergessen“ zeigt ihn nach drei Rückfragen, Eric sieht in der Verwaltung, wer das benutzt hat.
- **Amazon-Suche im Tool** über SerpApi, Fallback amazonscraperapi, Ergebnisse 24 h zwischengespeichert.
- **Links aus anderen Shops** mit automatischer Vorschau (Bild, Titel, Preis), Ideen ohne Link, Herzenswunsch, „Gut zu wissen“.
- **Teilen aus Apps:** Unter Android als App installieren, dann erscheint „Wunschliste“ im Teilen-Menü. Fürs iPhone gibt es eine Kurzbefehl-Anleitung im Tool.
- **Verwaltung (Admin-Passwort):** Familien, Personen, Codes, Listen anlegen und archivieren.

## Aufbau

```
site/      Webseite (HTML, CSS, JavaScript, ohne Build-Schritt) → GitHub Pages
worker/    API: Cloudflare Worker + D1-Datenbank
.github/   Veröffentlichen bei jedem Push
```

- **Live:** https://frameson0.github.io/wunschliste/ (Branch `main`, Worker `wunschliste-api`)
- **Testversion:** https://frameson0.github.io/wunschliste/test/ (Branch `test`, Worker `wunschliste-api-test`, eigene Datenbank, nur mit Admin-Passwort)
- Ein Push auf `test` stößt einen Lauf auf `main` an, weil GitHub Pages nur von `main` veröffentlicht.
- Die D1-Datenbanken heißen aus der Anfangszeit `wichteln` und `wichteln-test`. Datenbank-Änderungen liegen in `worker/migrations/` und werden über die Cloudflare-Verbindung eingespielt (der Token im Workflow hat keine D1-Rechte).
- Das alte Repo `wichteln` enthält nur eine Weiterleitung auf die neue Adresse.

## Secrets (Settings → Secrets and variables → Actions)

| Name | Inhalt |
|---|---|
| `CLOUDFLARE_API_TOKEN` | Cloudflare-Token, Vorlage „Edit Cloudflare Workers“ |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare-Account-ID |
| `ADMIN_PASSWORD` | Passwort für die Verwaltung (dient auch zum Signieren der Anmeldungen) |
| `SERPAPI_KEY` | optional, Amazon-Suche |
| `AMAZONSCRAPER_KEY` | optional, Amazon-Suche (Fallback) und Amazon-Vorschau |

Alles läuft in den kostenlosen Tarifen von Cloudflare und GitHub. Ist ein Kontingent aufgebraucht, schaltet der Dienst ab, statt etwas zu berechnen.
