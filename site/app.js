// Wichteln – Wunschzettel für die Familie
// Reines JavaScript ohne Build-Schritt. Daten kommen vom Cloudflare Worker (window.WICHTEL_API).

const API = String(window.WICHTEL_API || '').replace(/\/+$/, '');
const KEYS = { me: 'wichteln.me', admin: 'wichteln.admin' };

const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch { /* privates Fenster */ } },
};

const S = {
  data: null,
  viewRound: null,
  me: parseInt(store.get(KEYS.me), 10) || null,
  adminKey: store.get(KEYS.admin) || '',
  adminOk: false,
  draft: null,      // neue Idee in Arbeit
  editing: null,    // id der Idee, die gerade bearbeitet wird
  browse: { q: '', cat: '', min: '', max: '' },
  error: null,
  firstPaint: true,
  shareHelp: false,
  installPrompt: null,
  sheet: { open: false, q: '', cat: '', min: '', max: '', sort: 'relevance', items: [], page: 1, hasMore: false, loading: false, error: '', searched: false, adding: {} },
};

const CATEGORIES = [
  { id: 'buch', label: 'Bücher', kw: 'Buch' },
  { id: 'genuss', label: 'Küche & Genuss', kw: 'Genuss Geschenk' },
  { id: 'spiel', label: 'Spiele & Puzzle', kw: 'Spiel' },
  { id: 'wellness', label: 'Wellness', kw: 'Wellness Geschenkset' },
  { id: 'deko', label: 'Wohnen & Deko', kw: 'Deko' },
  { id: 'outdoor', label: 'Sport & Draußen', kw: 'Outdoor' },
  { id: 'technik', label: 'Technik', kw: 'Gadget' },
  { id: 'schmuck', label: 'Schmuck', kw: 'Schmuck' },
  { id: 'personal', label: 'Personalisiert', kw: 'personalisiert' },
];

const PALETTE = ['#C42F45', '#2F7A5A', '#E3A82B', '#3B7BBF', '#7A3E8E', '#E07A93', '#D9682B', '#1F6F78', '#5C6B2E', '#123B2F'];

// ---------- kleine Helfer ----------

const $ = (sel, root = document) => root.querySelector(sel);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const httpUrl = (u) => (/^https?:\/\//i.test(String(u || '')) ? String(u) : '');
const genitive = (name) => (/[sßxz]$/i.test(name) ? `${name}’` : `${name}s`);
const ideas = (n) => (n === 1 ? '1 Idee' : `${n} Ideen`);

function isLight(hex) {
  const n = parseInt(String(hex).slice(1), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    v /= 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.35;
}

function budgetText(r) {
  if (!r) return '';
  const { budget_min: lo, budget_max: hi } = r;
  if (lo != null && hi != null) return `${lo} bis ${hi} €`;
  if (hi != null) return `bis ${hi} €`;
  if (lo != null) return `ab ${lo} €`;
  return '';
}

function exchangeText(r) {
  if (!r || !r.exchange_date) return '';
  const d = new Date(`${r.exchange_date}T00:00:00`);
  if (isNaN(d)) return '';
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const days = Math.round((d - today) / 86400000);
  const date = d.toLocaleDateString('de-DE', { day: 'numeric', month: 'long' });
  if (days > 1) return `Bescherung am ${date}, in ${days} Tagen`;
  if (days === 1) return `Bescherung morgen, am ${date}`;
  if (days === 0) return 'Heute ist Bescherung!';
  return `Bescherung war am ${date}`;
}

let toastTimer;
function toast(msg, kind = '') {
  const el = $('#toast');
  el.textContent = msg;
  el.className = `is-visible ${kind}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.className = ''), kind === 'is-error' ? 5000 : 2600);
}

async function api(path, { method = 'GET', body, admin = false } = {}) {
  if (!API) throw new Error('Die Adresse der Wichtel-API fehlt in config.js.');
  const headers = {};
  if (body) headers['Content-Type'] = 'application/json';
  if (admin) headers['X-Admin-Key'] = S.adminKey;
  let res;
  try {
    res = await fetch(API + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  } catch {
    throw new Error('Keine Verbindung zur Wichtel-API. Prüf deine Internetverbindung und versuch es noch mal.');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const e = new Error(data.error || `Fehler ${res.status}`);
    e.status = res.status;
    throw e;
  }
  return data;
}

async function load() {
  S.data = await api(`/api/state${S.viewRound ? `?round=${S.viewRound}` : ''}`);
  S.error = null;
  if (S.me && !S.data.people.some((p) => p.id === S.me)) setMe(null);
}

function setMe(id) {
  S.me = id;
  store.set(KEYS.me, id ? String(id) : null);
}

// ---------- abgeleitete Daten ----------

const round = () => S.data && S.data.round;
const editableRound = () => Boolean(round() && round().is_current);
const people = () => (S.data ? S.data.people : []);
const person = (id) => people().find((p) => p.id === id);
const members = () => people().filter((p) => S.data.members.includes(p.id));
const itemsOf = (id) => S.data.items.filter((i) => i.person_id === id);
const currentRoundId = () => (S.data.rounds.find((r) => r.is_current) || {}).id;

function route() {
  const h = location.hash.replace(/^#\/?/, '');
  if (h.startsWith('admin')) return { view: 'admin' };
  const m = h.match(/^p\/(\d+)/);
  if (m) return { view: 'person', id: parseInt(m[1], 10) };
  return { view: 'home' };
}

// ---------- Bausteine ----------

function garland(list, { activeId = null, big = false, pick = false } = {}) {
  const drops = [26, 50, 34, 58, 30, 46, 38, 54];
  const n = list.length || 1;
  return `
  <nav class="garland ${big ? 'garland--big' : ''} ${S.firstPaint ? 'is-entering' : ''}" aria-label="${pick ? 'Wer bist du?' : 'Wunschzettel der Familie'}">
    <svg class="garland__rope" viewBox="0 0 100 10" preserveAspectRatio="none" aria-hidden="true"><path d="M-2,1 Q50,10 102,1" vector-effect="non-scaling-stroke"/></svg>
    <ul>
      ${list
        .map((p, i) => {
          const t = (i + 0.5) / n;
          const sag = (1 - t) * (1 - t) * 1 + 2 * (1 - t) * t * 10 + t * t * 1; // y auf der Kurve (0–10)
          const attrs = pick
            ? `href="#/" data-act="pick" data-id="${p.id}"`
            : `href="#/p/${p.id}" ${p.id === activeId ? 'aria-current="page"' : ''}`;
          return `
        <li style="--i:${i};--c:${esc(p.color)};--sag:${sag.toFixed(2)};--drop:${drops[i % drops.length]}px">
          <a class="bauble ${p.id === activeId ? 'is-active' : ''} ${isLight(p.color) ? 'is-light' : ''}" ${attrs}>
            <span class="bauble__string" aria-hidden="true"></span>
            <span class="bauble__cap" aria-hidden="true"></span>
            <span class="bauble__ball" aria-hidden="true">${esc(p.name.slice(0, 1).toUpperCase())}</span>
            <span class="bauble__name">${esc(p.name)}${p.id === S.me && !pick ? '<span class="you">du</span>' : ''}</span>
          </a>
        </li>`;
        })
        .join('')}
    </ul>
  </nav>`;
}

function topbar() {
  const me = person(S.me);
  return `
  <header class="topbar">
    <a class="brand" href="#/">Wichteln</a>
    ${
      me
        ? `<div class="whoami"><span>Du bist <strong>${esc(me.name)}</strong></span><button class="btn btn--ghost btn--small" data-act="switch">Wechseln</button></div>`
        : ''
    }
  </header>`;
}

function archiveBanner() {
  if (!round() || round().is_current) return '';
  const cur = S.data.rounds.find((r) => r.is_current);
  return `<div class="archive" role="note">Du schaust dir <strong>${esc(round().title)}</strong> an. Ältere Wunschzettel lassen sich nicht mehr ändern.
    ${cur ? `<button class="btn btn--small btn--ghost-dark" data-act="round" data-id="">Zurück zu ${esc(cur.title)}</button>` : ''}</div>`;
}

function footer() {
  const rounds = S.data ? S.data.rounds : [];
  return `
  <footer class="footer">
    ${
      rounds.length > 1
        ? `<label class="footer__rounds">Jahr
            <select data-act="round-select">
              ${rounds.map((r) => `<option value="${r.id}" ${round() && r.id === round().id ? 'selected' : ''}>${esc(r.title)}</option>`).join('')}
            </select></label>`
        : '<span></span>'
    }
    <a href="#/admin">Verwaltung</a>
  </footer>`;
}

function thumb(it, size = '') {
  const src = httpUrl(it.image);
  return `<span class="thumb ${size} ${src ? '' : 'is-empty'}">${
    src ? `<img src="${esc(src)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.parentNode.classList.add('is-empty');this.remove()">` : ''
  }</span>`;
}

// ---------- Ansichten ----------

function viewPicker() {
  const list = members();
  return `
  ${topbar()}
  <main id="main" class="picker">
    ${garland(list, { big: true, pick: true })}
    <div class="picker__text">
      <h1>Wer bist du?</h1>
      <p>Tipp auf deine Kugel. Danach füllst du deinen Wunschzettel und schaust, was sich die anderen wünschen.</p>
      ${list.length ? '' : '<p class="empty">Für dieses Jahr ist noch niemand eingetragen. Das geht in der Verwaltung.</p>'}
    </div>
  </main>
  ${footer()}`;
}

function viewHome() {
  const r = round();
  const list = members().slice().sort((a, b) => (a.id === S.me ? -1 : b.id === S.me ? 1 : 0));
  const facts = [budgetText(r) && `<span class="fact"><span class="fact__label">Budget</span> ${esc(budgetText(r))}</span>`, exchangeText(r) && `<span class="fact">${esc(exchangeText(r))}</span>`].filter(Boolean).join('');
  return `
  ${topbar()}
  ${archiveBanner()}
  ${garland(members())}
  <main id="main" class="home">
    <div class="intro">
      <h1>${esc(r ? r.title : 'Wichteln')}</h1>
      ${facts ? `<p class="facts">${facts}</p>` : ''}
    </div>
    <div class="sheets">
      ${list
        .map((p) => {
          const its = itemsOf(p.id);
          const mine = p.id === S.me;
          const withImg = its.filter((i) => httpUrl(i.image)).slice(0, 4);
          return `
        <a class="sheet-tile paper" href="#/p/${p.id}" style="--c:${esc(p.color)}">
          <span class="paper__inner">
            <span class="sheet-tile__head">
              <span class="dot" aria-hidden="true"></span>
              <span class="sheet-tile__name">${mine ? 'Dein Wunschzettel' : esc(genitive(p.name)) + ' Wunschzettel'}</span>
            </span>
            <span class="sheet-tile__count">${its.length ? ideas(its.length) : mine && editableRound() ? 'Noch leer, leg los' : 'Noch keine Ideen'}</span>
            ${withImg.length ? `<span class="sheet-tile__thumbs">${withImg.map((i) => thumb(i, 'thumb--s')).join('')}</span>` : ''}
            ${
              !withImg.length && its.length
                ? `<span class="sheet-tile__list">${its.slice(0, 3).map((i) => `<span>${esc(i.title || i.comment)}</span>`).join('')}</span>`
                : ''
            }
            ${p.about ? `<span class="sheet-tile__about">${esc(p.about)}</span>` : ''}
          </span>
        </a>`;
        })
        .join('')}
    </div>
  </main>
  ${footer()}`;
}

function itemFields(v, prefix) {
  return `
    <div class="fields">
      <label class="field field--wide"><span>Was ist es?</span>
        <input data-${prefix}="title" value="${esc(v.title)}" maxlength="300" placeholder="z. B. Glas-Teekanne mit Sieb"></label>
      <label class="field"><span>Preis</span>
        <input data-${prefix}="price" value="${esc(v.price)}" maxlength="40" placeholder="z. B. 24,99 €"></label>
      <label class="field field--wide"><span>Anmerkung</span>
        <textarea data-${prefix}="comment" rows="2" maxlength="1000" placeholder="Größe, Farbe, Variante …">${esc(v.comment)}</textarea></label>
      <details class="field field--wide" ${v.url && !httpUrl(v.image) ? 'open' : ''}>
        <summary>Link und Bild</summary>
        <label class="field"><span>Link zum Produkt</span>
          <input data-${prefix}="url" type="url" value="${esc(v.url)}" placeholder="https://…"></label>
        <label class="field"><span>Bildadresse</span>
          <input data-${prefix}="image" type="url" value="${esc(v.image)}" placeholder="https://…/bild.jpg"></label>
        <p class="hint">Bildadresse: Rechtsklick aufs Produktbild im Shop und „Bildadresse kopieren“ wählen. Am Handy das Bild lange gedrückt halten.</p>
      </details>
      <label class="check"><input type="checkbox" data-${prefix}="favorite" ${v.favorite ? 'checked' : ''}> Herzenswunsch</label>
    </div>`;
}

function addBox() {
  const d = S.draft;
  let draft = '';
  if (d && d.loading) {
    draft = `<div class="draft is-loading"><span class="thumb thumb--l is-empty"></span><p>Vorschau wird geholt …</p></div>`;
  } else if (d) {
    draft = `
    <form class="draft" data-form="save-draft">
      <div class="draft__media">${thumb(d, 'thumb--l')}</div>
      <div class="draft__body">
        ${d.url && !d.complete ? '<p class="note">Der Shop hat keine vollständige Vorschau geliefert. Ergänze Titel oder Bild einfach selbst.</p>' : ''}
        ${itemFields(d, 'draft')}
        <div class="actions">
          <button class="btn btn--primary" type="submit">Auf den Wunschzettel</button>
          <button class="btn btn--ghost" type="button" data-act="discard">Verwerfen</button>
        </div>
      </div>
    </form>`;
  }
  const busy = d && d.loading ? 'disabled' : '';
  const search = S.data.features && S.data.features.amazonSearch;
  const linkPart = `
    <form class="add__form" data-form="preview">
      <label for="add-url">Link einfügen</label>
      <div class="add__row">
        <input id="add-url" type="url" inputmode="url" autocomplete="off" placeholder="https://…" ${busy}>
        <button class="btn ${search ? 'btn--ghost' : 'btn--primary'}" type="submit" ${busy}>Vorschau holen</button>
      </div>
    </form>
    <p class="add__alt">
      ${canReadClipboard() ? `<button class="chip chip--action" type="button" data-act="paste" ${busy}>Kopierten Link einfügen</button>` : ''}
      <button class="chip chip--action" type="button" data-act="no-link">Idee ohne Link</button>
      <button class="chip chip--action" type="button" data-act="share-help" aria-expanded="${S.shareHelp ? 'true' : 'false'}">Direkt aus Apps teilen</button>
    </p>
    ${S.shareHelp ? shareHelp() : ''}
    ${draft}`;

  if (!search) {
    return `
    <section class="add paper"><div class="paper__inner">
      <h2>Neue Idee</h2>
      ${linkPart}
    </div></section>`;
  }

  const links = browseLinks();
  return `
  <section class="finder">
    <h2>Bei Amazon stöbern</h2>
    <p class="finder__sub">Suchen, nach Preis filtern und mit einem Tippen auf deinen Wunschzettel setzen.</p>
    <form class="finder__form" data-form="finder" role="search">
      <input id="finder-q" type="search" enterkeyhint="search" autocomplete="off" placeholder="Was wünschst du dir?" aria-label="Bei Amazon suchen" value="${esc(S.sheet.q)}">
      <button class="btn btn--primary" type="submit">Suchen</button>
    </form>
    <div class="chips finder__chips">
      ${SUGGESTIONS.slice(0, 6).map((q) => `<button type="button" class="chip" data-act="finder-suggest" data-q="${esc(q)}">${esc(q)}</button>`).join('')}
      ${S.sheet.searched ? '<button type="button" class="chip chip--dark" data-act="sheet-open">Letzte Suche öffnen</button>' : ''}
    </div>
  </section>
  <section class="add paper"><div class="paper__inner">
    <h2>Aus einem anderen Shop oder eigene Idee</h2>
    ${linkPart}
    <p class="hint add__shops">Ideen holen: <a href="${esc(links.etsy)}" target="_blank" rel="noopener noreferrer" data-shop="etsy">Etsy öffnen</a> oder <a href="${esc(links.amazon)}" target="_blank" rel="noopener noreferrer" data-shop="amazon">amazon.de öffnen</a>, dann den Link hier einfügen.</p>
  </div></section>`;
}

function canReadClipboard() {
  return Boolean(navigator.clipboard && navigator.clipboard.readText);
}

const isIOS = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const isStandalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;

function shareHelp() {
  const base = `${location.origin}${location.pathname}`;
  const ios = `
    <ol class="steps">
      <li>Öffne die App <strong>Kurzbefehle</strong> und tippe auf <strong>+</strong>. Nenne den Kurzbefehl „Auf Wunschzettel“.</li>
      <li>Tippe unten auf das <strong>ⓘ</strong> und schalte <strong>Im Share-Sheet anzeigen</strong> ein.</li>
      <li>Füge die Aktion <strong>URL codieren</strong> hinzu (englisch „Encode URL“). Als Eingabe: <em>Kurzbefehleingabe</em>.</li>
      <li>Füge die Aktion <strong>Text</strong> hinzu. Inhalt: die Adresse unten, direkt dahinter die Variable <em>Codierte URL</em>.
        <span class="copyline"><code>${esc(base)}?text=</code><button class="btn btn--ghost btn--small" type="button" data-act="copy" data-text="${esc(base)}?text=">Kopieren</button></span></li>
      <li>Füge die Aktion <strong>URLs öffnen</strong> hinzu. Fertig.</li>
      <li>Ab jetzt in der Amazon-App (oder Safari): <strong>Teilen → Auf Wunschzettel</strong>.</li>
    </ol>`;
  const android = `
    <ol class="steps">
      <li>${
        S.installPrompt
          ? 'Installiere Wichteln als App: <button class="btn btn--primary btn--small" type="button" data-act="install">Als App installieren</button>'
          : isStandalone()
            ? 'Wichteln ist schon als App installiert.'
            : 'Installiere Wichteln als App: In Chrome oben rechts auf <strong>⋮</strong> und dann <strong>App installieren</strong> bzw. <strong>Zum Startbildschirm hinzufügen</strong>.'
      }</li>
      <li>In der Amazon-App (oder jeder anderen App) beim Artikel auf <strong>Teilen</strong> tippen und <strong>Wichteln</strong> wählen.</li>
      <li>Wichteln öffnet sich mit der Vorschau. Ein Tippen auf „Auf den Wunschzettel“, fertig.</li>
    </ol>`;
  const first = isIOS() ? ['iPhone', ios, 'Android', android] : ['Android', android, 'iPhone', ios];
  return `
    <div class="share-help">
      <h3>${first[0]}</h3>${first[1]}
      <details><summary>Anleitung für ${first[2]}</summary>${first[3]}</details>
    </div>`;
}

function itemRow(it, own) {
  const editable = own && editableRound();
  if (editable && S.editing === it.id) {
    return `
    <li class="item is-editing">
      <form class="draft" data-form="save-edit" data-id="${it.id}">
        <div class="draft__media">${thumb(it, 'thumb--l')}</div>
        <div class="draft__body">
          ${itemFields(it, 'edit')}
          <div class="actions">
            <button class="btn btn--primary" type="submit">Änderungen speichern</button>
            <button class="btn btn--ghost" type="button" data-act="cancel-edit">Abbrechen</button>
            ${it.url ? `<button class="btn btn--ghost" type="button" data-act="refresh" data-id="${it.id}">Vorschau neu holen</button>` : ''}
          </div>
        </div>
      </form>
    </li>`;
  }
  const link = httpUrl(it.url);
  const title = esc(it.title || (link ? it.site || 'Link' : 'Idee'));
  return `
  <li class="item ${it.favorite ? 'is-fav' : ''}">
    ${link ? `<a class="item__media" href="${esc(link)}" target="_blank" rel="noopener noreferrer" tabindex="-1" aria-hidden="true">${thumb(it)}</a>` : `<span class="item__media">${thumb(it)}</span>`}
    <div class="item__body">
      ${it.favorite ? '<span class="fav-badge">Herzenswunsch</span>' : ''}
      <h3 class="item__title">${link ? `<a href="${esc(link)}" target="_blank" rel="noopener noreferrer">${title}</a>` : title}</h3>
      ${it.price || it.site ? `<p class="item__meta">${it.price ? `<span class="price">${esc(it.price)}</span>` : ''}${it.site ? `<span class="site">bei ${esc(it.site)}</span>` : ''}</p>` : ''}
      ${it.comment ? `<p class="item__comment">${esc(it.comment)}</p>` : ''}
    </div>
    ${
      editable
        ? `<div class="item__actions">
            <button class="icon-btn star" data-act="fav" data-id="${it.id}" aria-pressed="${it.favorite ? 'true' : 'false'}" title="Herzenswunsch">
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3.2l2.6 5.4 5.9.8-4.3 4.1 1 5.9L12 16.6l-5.2 2.8 1-5.9-4.3-4.1 5.9-.8z"/></svg>
              <span class="sr">Herzenswunsch</span></button>
            <button class="btn btn--ghost btn--small" data-act="edit" data-id="${it.id}">Bearbeiten</button>
            <button class="btn btn--ghost btn--small btn--danger" data-act="delete" data-id="${it.id}">Löschen</button>
          </div>`
        : ''
    }
  </li>`;
}

function browseLinks() {
  const b = S.browse;
  const cat = CATEGORIES.find((c) => c.id === b.cat);
  const q = [b.q.trim(), cat ? cat.kw : ''].filter(Boolean).join(' ') || 'Geschenk';
  const lo = parseInt(b.min, 10);
  const hi = parseInt(b.max, 10);
  const amazon = new URL('https://www.amazon.de/s');
  amazon.searchParams.set('k', q);
  if (lo >= 0 || hi > 0) amazon.searchParams.set('rh', `p_36:${lo > 0 ? lo * 100 : ''}-${hi > 0 ? hi * 100 : ''}`);
  const etsy = new URL('https://www.etsy.com/de/search');
  etsy.searchParams.set('q', q);
  if (lo > 0) etsy.searchParams.set('min', lo);
  if (hi > 0) etsy.searchParams.set('max', hi);
  return { amazon: amazon.toString(), etsy: etsy.toString() };
}

function browseBox(p, own) {
  const links = browseLinks();
  if (own && S.data.features && S.data.features.amazonSearch) {
    return `
    <section class="browse paper" id="browse"><div class="paper__inner">
      <h2>Stöbern</h2>
      <p class="muted">Bei Amazon suchst du direkt hier im Tool, schon nach eurem Budget gefiltert.</p>
      <button class="btn btn--primary" type="button" data-act="sheet-open">Bei Amazon stöbern</button>
      <p class="hint">Lieber im Shop selbst? <a href="${esc(links.amazon)}" target="_blank" rel="noopener noreferrer" data-shop="amazon">amazon.de öffnen</a> oder <a href="${esc(links.etsy)}" target="_blank" rel="noopener noreferrer" data-shop="etsy">Etsy öffnen</a> und den Link oben einfügen.</p>
    </div></section>`;
  }
  return `
  <section class="browse paper" id="browse"><div class="paper__inner">
    <h2>${own ? 'Stöbern' : `Für ${esc(p.name)} stöbern`}</h2>
    <label class="field"><span>Suchbegriff</span>
      <input data-browse="q" value="${esc(S.browse.q)}" placeholder="z. B. Tee, Puzzle, Wollsocken"></label>
    <div class="chips" role="group" aria-label="Kategorie">
      ${CATEGORIES.map((c) => `<button type="button" class="chip" data-act="cat" data-id="${c.id}" aria-pressed="${S.browse.cat === c.id}">${esc(c.label)}</button>`).join('')}
    </div>
    <div class="range">
      <label class="field"><span>Preis von</span><input data-browse="min" type="number" min="0" inputmode="numeric" value="${esc(S.browse.min)}" placeholder="0"></label>
      <label class="field"><span>bis</span><input data-browse="max" type="number" min="0" inputmode="numeric" value="${esc(S.browse.max)}" placeholder="beliebig"></label>
      <span class="range__unit">€</span>
    </div>
    <div class="shops">
      <a class="btn btn--shop" data-shop="amazon" href="${esc(links.amazon)}" target="_blank" rel="noopener noreferrer">Bei Amazon suchen</a>
      <a class="btn btn--shop" data-shop="etsy" href="${esc(links.etsy)}" target="_blank" rel="noopener noreferrer">Bei Etsy suchen</a>
    </div>
    <p class="hint">${
      own
        ? 'Die Suche öffnet sich in einem neuen Tab. Gefällt dir etwas, kopier den Link und füg ihn bei „Neue Idee“ ein.'
        : `Die Suche öffnet sich in einem neuen Tab, schon nach Preis gefiltert. ${esc(p.name)} sieht nicht, wonach du suchst.`
    }</p>
  </div></section>`;
}

function aboutBox(p, own) {
  if (own && editableRound()) {
    return `
    <section class="about paper"><div class="paper__inner">
      <h2>Gut zu wissen</h2>
      <form data-form="about">
        <label class="field"><span>Größen, Lieblingsfarben, was du gar nicht magst</span>
          <textarea name="about" rows="4" maxlength="2000" placeholder="Schuhgröße 42, trinkt gern Tee, bitte keine Duftkerzen">${esc(p.about)}</textarea></label>
        <button class="btn btn--ghost" type="submit">Speichern</button>
      </form>
    </div></section>`;
  }
  return `
  <section class="about paper"><div class="paper__inner">
    <h2>Gut zu wissen</h2>
    ${p.about ? `<p class="about__text">${esc(p.about)}</p>` : `<p class="muted">${own ? 'Hier steht noch nichts.' : `${esc(p.name)} hat hier noch nichts eingetragen.`}</p>`}
  </div></section>`;
}

function viewPerson(id) {
  const p = person(id);
  if (!p) {
    return `${topbar()}${garland(members())}<main id="main" class="profile"><p class="empty">Diese Person gibt es nicht. <a href="#/">Zur Übersicht</a></p></main>${footer()}`;
  }
  const own = id === S.me;
  const isMember = S.data.members.includes(id);
  const its = itemsOf(id);
  const canEdit = own && editableRound() && isMember;
  const empty = own
    ? editableRound()
      ? 'Dein Wunschzettel ist noch leer. Füg oben einen Link ein oder schreib eine Idee ohne Link auf.'
      : 'Auf diesem Wunschzettel stand nichts.'
    : `${esc(p.name)} hat noch nichts eingetragen. Schau später noch mal vorbei oder stöber schon mal selbst.`;

  return `
  ${topbar()}
  ${archiveBanner()}
  ${garland(members(), { activeId: id })}
  <main id="main" class="profile" style="--c:${esc(p.color)}">
    <div class="profile__main">
      <h1 class="profile__title">${own ? 'Dein Wunschzettel' : `${esc(genitive(p.name))} Wunschzettel`}</h1>
      ${!isMember ? `<p class="note">${esc(p.name)} macht bei ${esc(round().title)} nicht mit.</p>` : ''}
      ${canEdit ? addBox() : ''}
      <section class="sheet paper"><div class="paper__inner">
        <h2 class="sr">Ideen</h2>
        ${its.length ? `<ul class="items">${its.map((it) => itemRow(it, own)).join('')}</ul>` : `<p class="empty">${empty}</p>`}
      </div></section>
    </div>
    <aside class="profile__side">
      ${aboutBox(p, own)}
      ${editableRound() && !(own && S.data.features && S.data.features.amazonSearch) ? browseBox(p, own) : ''}
    </aside>
  </main>
  ${footer()}`;
}

// ---------- Verwaltung ----------

function viewAdmin() {
  if (!S.adminOk) {
    return `
    ${topbar()}
    <main id="main" class="admin">
      <h1>Verwaltung</h1>
      <section class="paper"><div class="paper__inner">
        <form data-form="admin-login" class="stack">
          <label class="field"><span>Admin-Passwort</span><input type="password" name="key" autocomplete="current-password" required></label>
          <button class="btn btn--primary" type="submit">Anmelden</button>
        </form>
      </div></section>
      <p><a href="#/">Zurück zu den Wunschzetteln</a></p>
    </main>`;
  }
  const r = round();
  const cur = S.data.rounds.find((x) => x.is_current) || r;
  const allPeople = people();
  const memberSet = new Set(S.data.members);
  const nextYear = Math.max(...S.data.rounds.map((x) => x.year), new Date().getFullYear() - 1) + 1;
  const colorSelect = (name, value) => `
    <span class="swatches" role="radiogroup" aria-label="Farbe">
      ${PALETTE.map((c) => `<label class="swatch" style="--c:${c}"><input type="radio" name="${name}" value="${c}" ${c.toLowerCase() === String(value).toLowerCase() ? 'checked' : ''}><span class="sr">${c}</span></label>`).join('')}
    </span>`;

  return `
  ${topbar()}
  <main id="main" class="admin">
    <div class="admin__head">
      <h1>Verwaltung</h1>
      <button class="btn btn--ghost btn--small" data-act="admin-logout">Abmelden</button>
    </div>

    ${r.id !== cur.id ? `<p class="note">Du bearbeitest gerade ${esc(r.title)}, nicht das aktuelle Jahr.</p>` : ''}

    <section class="paper"><div class="paper__inner">
      <h2>${esc(r.title)}</h2>
      <form data-form="admin-round" data-id="${r.id}" class="stack">
        <div class="grid2">
          <label class="field"><span>Name der Runde</span><input name="title" value="${esc(r.title)}" maxlength="80"></label>
          <label class="field"><span>Bescherung</span><input name="exchange_date" type="date" value="${esc(r.exchange_date || '')}"></label>
          <label class="field"><span>Budget von (€)</span><input name="budget_min" type="number" min="0" value="${r.budget_min ?? ''}"></label>
          <label class="field"><span>Budget bis (€)</span><input name="budget_max" type="number" min="0" value="${r.budget_max ?? ''}"></label>
        </div>
        <fieldset class="field"><legend>Wer macht mit?</legend>
          <div class="checks">${allPeople.map((p) => `<label class="check"><input type="checkbox" name="member" value="${p.id}" ${memberSet.has(p.id) ? 'checked' : ''}> ${esc(p.name)}</label>`).join('')}</div>
        </fieldset>
        <div><button class="btn btn--primary" type="submit">Runde speichern</button></div>
      </form>
    </div></section>

    <section class="paper"><div class="paper__inner">
      <h2>Personen</h2>
      <ul class="people-admin">
        ${allPeople
          .map(
            (p) => `
          <li><form data-form="admin-person" data-id="${p.id}" class="person-row">
            <input name="name" value="${esc(p.name)}" maxlength="40" aria-label="Name">
            ${colorSelect(`color-${p.id}`, p.color)}
            <span class="person-row__actions">
              <button class="btn btn--ghost btn--small" type="submit">Speichern</button>
              <button class="btn btn--ghost btn--small btn--danger" type="button" data-act="admin-del-person" data-id="${p.id}">Löschen</button>
            </span>
          </form></li>`,
          )
          .join('')}
      </ul>
      <form data-form="admin-add-person" class="person-row person-row--new">
        <input name="name" maxlength="40" placeholder="Neue Person" aria-label="Name der neuen Person" required>
        ${colorSelect('color-new', PALETTE[allPeople.length % PALETTE.length])}
        <span class="person-row__actions"><button class="btn btn--primary btn--small" type="submit">Hinzufügen</button></span>
      </form>
    </div></section>

    <section class="paper"><div class="paper__inner">
      <h2>Neues Jahr starten</h2>
      <p class="muted">Die neue Runde wird zur aktuellen. Ältere Runden bleiben zum Nachschauen erhalten.</p>
      <form data-form="admin-new-round" class="stack">
        <div class="grid2">
          <label class="field"><span>Jahr</span><input name="year" type="number" value="${nextYear}" required></label>
          <label class="field"><span>Bescherung</span><input name="exchange_date" type="date" value="${nextYear}-12-24"></label>
          <label class="field"><span>Budget von (€)</span><input name="budget_min" type="number" min="0" value="${cur.budget_min ?? ''}"></label>
          <label class="field"><span>Budget bis (€)</span><input name="budget_max" type="number" min="0" value="${cur.budget_max ?? ''}"></label>
        </div>
        <label class="check"><input type="checkbox" name="copy" value="${cur.id}"> Wunschzettel aus ${esc(cur.title)} übernehmen</label>
        <div><button class="btn btn--primary" type="submit">Neues Jahr starten</button></div>
      </form>
    </div></section>

    ${
      S.data.rounds.length > 1
        ? `<section class="paper"><div class="paper__inner">
        <h2>Alle Runden</h2>
        <ul class="rounds-admin">
          ${S.data.rounds
            .map(
              (x) => `<li><span>${esc(x.title)}${x.is_current ? ' <span class="pill">aktuell</span>' : ''}</span>
            <span class="person-row__actions">
              ${x.id !== r.id ? `<button class="btn btn--ghost btn--small" data-act="round" data-id="${x.id}">Bearbeiten</button>` : ''}
              ${x.is_current ? '' : `<button class="btn btn--ghost btn--small" data-act="admin-make-current" data-id="${x.id}">Zur aktuellen machen</button>`}
              <button class="btn btn--ghost btn--small btn--danger" data-act="admin-del-round" data-id="${x.id}">Löschen</button>
            </span></li>`,
            )
            .join('')}
        </ul>
      </div></section>`
        : ''
    }
    <p><a href="#/">Zurück zu den Wunschzetteln</a></p>
  </main>`;
}

// ---------- Rendern ----------

function render() {
  const app = $('#app');
  if (S.error && !S.data) {
    app.innerHTML = `
      <main id="main" class="fatal">
        <h1>Die Wunschzettel lassen sich gerade nicht laden.</h1>
        <p>${esc(S.error)}</p>
        <button class="btn btn--primary" data-act="reload">Noch mal versuchen</button>
      </main>`;
    return;
  }
  if (!S.data) return;
  const r = route();
  let html;
  if (r.view === 'admin') html = viewAdmin();
  else if (!S.me) html = viewPicker();
  else if (r.view === 'person') html = viewPerson(r.id);
  else html = viewHome();
  app.innerHTML = html;
  document.title = r.view === 'person' && person(r.id) ? `${person(r.id).name} – Wichteln` : 'Wichteln';
  if (S.firstPaint) requestAnimationFrame(() => setTimeout(() => (S.firstPaint = false), 50));
}

function busyTyping() {
  const a = document.activeElement;
  return Boolean(S.draft || S.editing || S.sheet.open || (a && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName)));
}

async function refresh({ quiet = false } = {}) {
  try {
    await load();
  } catch (e) {
    if (!quiet) toast(e.message, 'is-error');
    if (!S.data) S.error = e.message;
  }
  render();
}

// ---------- Aktionen ----------

function readFields(root, prefix) {
  const get = (k) => root.querySelector(`[data-${prefix}="${k}"]`);
  return {
    title: get('title').value.trim(),
    price: get('price').value.trim(),
    comment: get('comment').value.trim(),
    url: get('url').value.trim(),
    image: get('image').value.trim(),
    favorite: get('favorite').checked,
  };
}

async function loadPreview(url, titleHint = '') {
  url = url.trim();
  if (!url) return;
  S.draft = { loading: true, url };
  render();
  try {
    const p = await api(`/api/preview?url=${encodeURIComponent(url)}`);
    S.draft = { ...p, title: p.title || titleHint, comment: '', favorite: false };
  } catch (e) {
    S.draft = { url, title: titleHint, image: '', price: '', site: '', comment: '', favorite: false, complete: false };
    toast(e.message, 'is-error');
  }
  render();
  const first = $('[data-draft="title"]');
  if (first) first.focus();
}

function resetBrowse() {
  const r = round();
  S.browse.min = r && r.budget_min != null ? String(r.budget_min) : '';
  S.browse.max = r && r.budget_max != null ? String(r.budget_max) : '';
}

function updateBrowseLinks() {
  const links = browseLinks();
  document.querySelectorAll('[data-shop]').forEach((a) => (a.href = links[a.dataset.shop]));
}

const actions = {
  async pick(el) {
    setMe(parseInt(el.dataset.id, 10));
    if (sessionStorage.getItem(SHARE_KEY)) processShare();
    else location.hash = `#/p/${S.me}`;
  },
  'sheet-open'(el) { openSheet(el); },
  'sheet-close'() { closeSheet(); },
  'sheet-cat'(el) {
    S.sheet.cat = S.sheet.cat === el.dataset.id ? '' : el.dataset.id;
    document.querySelectorAll('[data-act="sheet-cat"]').forEach((c) => c.setAttribute('aria-pressed', String(c.dataset.id === S.sheet.cat)));
    if (S.sheet.q.trim() || S.sheet.cat) runSearch();
  },
  'finder-suggest'(el) {
    S.sheet.q = el.dataset.q;
    openSheet(el);
    runSearch();
  },
  'sheet-suggest'(el) {
    S.sheet.q = el.dataset.q;
    const inp = $('#sheet-q');
    if (inp) inp.value = S.sheet.q;
    runSearch();
  },
  'sheet-more'() { runSearch({ more: true }); },
  'sheet-add'(el) { addFromSheet(el.dataset.asin); },
  'sheet-retry'() { runSearch(); },
  async paste() {
    try {
      const text = await navigator.clipboard.readText();
      const m = String(text || '').match(/https?:\/\/\S+/);
      if (!m) return toast('In der Zwischenablage ist kein Link. Kopier zuerst den Link im Shop.', 'is-error');
      const inp = $('#add-url');
      if (inp) inp.value = m[0];
      loadPreview(m[0], titleFromSharedText(text, m[0]));
    } catch {
      toast('Kein Zugriff auf die Zwischenablage. Füg den Link bitte direkt ins Feld ein.', 'is-error');
    }
  },
  'share-help'() { S.shareHelp = !S.shareHelp; render(); },
  async install() {
    const pr = S.installPrompt;
    if (!pr) return;
    pr.prompt();
    const choice = await pr.userChoice.catch(() => null);
    S.installPrompt = null;
    if (choice && choice.outcome === 'accepted') toast('Wichteln wird installiert');
    render();
  },
  async copy(el) {
    try { await navigator.clipboard.writeText(el.dataset.text); toast('Kopiert'); }
    catch { toast('Kopieren ging nicht. Bitte von Hand markieren.', 'is-error'); }
  },
  switch() {
    setMe(null);
    S.draft = null;
    S.editing = null;
    location.hash = '#/';
    render();
  },
  reload() { refresh(); },
  async round(el) {
    const id = parseInt(el.dataset.id, 10) || null;
    S.viewRound = id && id !== currentRoundId() ? id : null;
    S.draft = null; S.editing = null;
    await refresh();
    resetBrowse();
    render();
  },
  'no-link'() {
    S.draft = { url: '', title: '', image: '', price: '', site: '', comment: '', favorite: false, complete: true };
    render();
    $('[data-draft="title"]').focus();
  },
  'to-browse'(el, ev) {
    ev.preventDefault();
    const b = $('#browse');
    if (b) { b.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' }); $('[data-browse="q"]').focus({ preventScroll: true }); }
  },
  discard() { S.draft = null; render(); },
  edit(el) { S.editing = parseInt(el.dataset.id, 10); render(); const f = $('[data-edit="title"]'); if (f) f.focus(); },
  'cancel-edit'() { S.editing = null; render(); },
  async fav(el) {
    const id = parseInt(el.dataset.id, 10);
    const it = S.data.items.find((i) => i.id === id);
    try {
      await api(`/api/items/${id}`, { method: 'PATCH', body: { favorite: !it.favorite } });
      toast(it.favorite ? 'Kein Herzenswunsch mehr' : 'Als Herzenswunsch markiert');
      await refresh();
    } catch (e) { toast(e.message, 'is-error'); }
  },
  async delete(el) {
    const id = parseInt(el.dataset.id, 10);
    const it = S.data.items.find((i) => i.id === id);
    if (!confirm(`„${it.title || 'Diese Idee'}“ vom Wunschzettel löschen?`)) return;
    try {
      await api(`/api/items/${id}`, { method: 'DELETE' });
      toast('Gelöscht');
      await refresh();
    } catch (e) { toast(e.message, 'is-error'); }
  },
  async refresh(el) {
    const id = parseInt(el.dataset.id, 10);
    el.disabled = true;
    el.textContent = 'Wird geholt …';
    try {
      await api(`/api/items/${id}/refresh`, { method: 'POST' });
      S.editing = null;
      toast('Vorschau aktualisiert');
      await refresh();
    } catch (e) { toast(e.message, 'is-error'); el.disabled = false; el.textContent = 'Vorschau neu holen'; }
  },
  cat(el) {
    S.browse.cat = S.browse.cat === el.dataset.id ? '' : el.dataset.id;
    document.querySelectorAll('.chip').forEach((c) => c.setAttribute('aria-pressed', String(c.dataset.id === S.browse.cat)));
    updateBrowseLinks();
  },
  'admin-logout'() {
    S.adminKey = ''; S.adminOk = false; store.set(KEYS.admin, null); render();
  },
  async 'admin-del-person'(el) {
    const p = person(parseInt(el.dataset.id, 10));
    if (!confirm(`${p.name} löschen? Alle Wunschzettel von ${p.name} werden dabei mitgelöscht, auch aus früheren Jahren.`)) return;
    await adminCall(`/api/admin/people/${p.id}`, { method: 'DELETE' }, `${p.name} gelöscht`);
    if (S.me === p.id) setMe(null);
  },
  async 'admin-make-current'(el) {
    await adminCall(`/api/admin/rounds/${el.dataset.id}`, { method: 'PATCH', body: { is_current: true } }, 'Ist jetzt die aktuelle Runde');
    S.viewRound = null;
    await refresh();
  },
  async 'admin-del-round'(el) {
    const r = S.data.rounds.find((x) => x.id === parseInt(el.dataset.id, 10));
    if (!confirm(`${r.title} mit allen Wunschzetteln endgültig löschen?`)) return;
    await adminCall(`/api/admin/rounds/${r.id}`, { method: 'DELETE' }, `${r.title} gelöscht`);
    S.viewRound = null;
    await refresh();
  },
};

async function adminCall(path, opts, okMsg) {
  try {
    const res = await api(path, { ...opts, admin: true });
    toast(okMsg);
    await refresh();
    return res;
  } catch (e) {
    if (e.status === 401) { S.adminOk = false; render(); }
    toast(e.message, 'is-error');
    return null;
  }
}

const forms = {
  preview(f) { loadPreview(f.querySelector('#add-url').value); },
  finder(f) {
    const q = f.querySelector('#finder-q').value.trim();
    if (!q) return f.querySelector('#finder-q').focus();
    S.sheet.q = q;
    openSheet(f.querySelector('button'));
    runSearch();
  },
  'sheet-search'(f) {
    const inp = f.querySelector('#sheet-q');
    S.sheet.q = inp.value;
    inp.blur(); // Tastatur am Handy schließen, damit man die Ergebnisse sieht
    runSearch();
  },
  async 'save-draft'(f) {
    const v = readFields(f, 'draft');
    if (!v.title && !v.url && !v.comment) return toast('Schreib kurz auf, was du dir wünschst.', 'is-error');
    const btn = f.querySelector('[type="submit"]');
    btn.disabled = true;
    try {
      await api('/api/items', { method: 'POST', body: { ...v, site: S.draft.site || '', person_id: S.me, round_id: round().id } });
      S.draft = null;
      toast('Steht jetzt auf deinem Wunschzettel');
      await refresh();
      $('#add-url') && $('#add-url').focus();
    } catch (e) { btn.disabled = false; toast(e.message, 'is-error'); }
  },
  async 'save-edit'(f) {
    const id = parseInt(f.dataset.id, 10);
    try {
      await api(`/api/items/${id}`, { method: 'PATCH', body: readFields(f, 'edit') });
      S.editing = null;
      toast('Änderungen gespeichert');
      await refresh();
    } catch (e) { toast(e.message, 'is-error'); }
  },
  async about(f) {
    try {
      await api(`/api/people/${S.me}`, { method: 'PATCH', body: { about: f.about.value } });
      toast('Gespeichert');
      f.about.blur();
      await refresh();
    } catch (e) { toast(e.message, 'is-error'); }
  },
  async 'admin-login'(f) {
    S.adminKey = f.key.value;
    try {
      await api('/api/admin/check', { method: 'POST', admin: true });
      S.adminOk = true;
      store.set(KEYS.admin, S.adminKey);
      render();
    } catch (e) { toast(e.message, 'is-error'); }
  },
  async 'admin-round'(f) {
    const body = {
      title: f.title.value,
      exchange_date: f.exchange_date.value,
      budget_min: f.budget_min.value,
      budget_max: f.budget_max.value,
      member_ids: [...f.querySelectorAll('[name="member"]:checked')].map((c) => parseInt(c.value, 10)),
    };
    await adminCall(`/api/admin/rounds/${f.dataset.id}`, { method: 'PATCH', body }, 'Runde gespeichert');
    resetBrowse();
  },
  async 'admin-person'(f) {
    const id = f.dataset.id;
    const color = (f.querySelector(`[name="color-${id}"]:checked`) || {}).value;
    await adminCall(`/api/admin/people/${id}`, { method: 'PATCH', body: { name: f.name.value, color } }, 'Gespeichert');
  },
  async 'admin-add-person'(f) {
    const color = (f.querySelector('[name="color-new"]:checked') || {}).value;
    await adminCall('/api/admin/people', { method: 'POST', body: { name: f.name.value, color } }, `${f.name.value} ist dabei`);
  },
  async 'admin-new-round'(f) {
    const year = parseInt(f.year.value, 10);
    const res = await adminCall(
      '/api/admin/rounds',
      {
        method: 'POST',
        body: {
          year,
          title: `Weihnachten ${year}`,
          exchange_date: f.exchange_date.value,
          budget_min: f.budget_min.value,
          budget_max: f.budget_max.value,
          member_ids: S.data.members,
          copy_items_from: f.copy.checked ? parseInt(f.copy.value, 10) : null,
        },
      },
      `Weihnachten ${year} ist gestartet`,
    );
    if (res) { S.viewRound = null; await refresh(); resetBrowse(); }
  },
};

// ---------- Such-Fenster (Amazon) ----------

const SUGGESTIONS = ['Tee', 'Puzzle', 'Kochbuch', 'Wollsocken', 'Brettspiel', 'Kuscheldecke', 'Thermobecher', 'Duftkerze', 'Bluetooth-Box', 'Gin-Set'];
const SORT_LABELS = { relevance: 'Passend', price_asc: 'Günstigste zuerst', price_desc: 'Teuerste zuerst', rating: 'Beste Bewertung' };

let sheetOpener = null;
const fmtRating = (r) => (Math.round(Number(r) * 10) / 10).toLocaleString('de-DE', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

function openSheet(opener) {
  sheetOpener = opener || document.activeElement;
  const r = round();
  if (!S.sheet.prefilled) {
    S.sheet.prefilled = true;
    S.sheet.min = r && r.budget_min != null ? String(r.budget_min) : '';
    S.sheet.max = r && r.budget_max != null ? String(r.budget_max) : '';
  }
  S.sheet.open = true;
  history.pushState({ sheet: true }, '');
  document.body.classList.add('has-sheet');
  renderSheet();
  requestAnimationFrame(() => {
    const root = $('#sheet-root');
    root.classList.add('is-open');
    // Am Handy nicht sofort die Tastatur aufklappen, wenn schon Ergebnisse da sind
    if (!S.sheet.q) $('#sheet-q').focus({ preventScroll: true });
    else $('.sheet__close').focus({ preventScroll: true });
  });
}

function closeSheet({ fromHistory = false } = {}) {
  if (!S.sheet.open) return;
  S.sheet.open = false;
  if (!fromHistory && history.state && history.state.sheet) history.back();
  document.body.classList.remove('has-sheet');
  const root = $('#sheet-root');
  root.classList.remove('is-open');
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  setTimeout(() => { if (!S.sheet.open) root.innerHTML = ''; }, reduce ? 0 : 260);
  if (sheetOpener && document.contains(sheetOpener)) sheetOpener.focus({ preventScroll: true });
}

function ownAsins() {
  const set = new Set();
  if (!S.data) return set;
  S.data.items.filter((i) => i.person_id === S.me).forEach((i) => {
    const m = String(i.url).match(/\/dp\/([A-Z0-9]{10})/i);
    if (m) set.add(m[1].toUpperCase());
  });
  return set;
}

function renderSheet() {
  let root = $('#sheet-root');
  if (!root) {
    root = document.createElement('div');
    root.id = 'sheet-root';
    document.body.appendChild(root);
  }
  const sh = S.sheet;
  root.innerHTML = `
    <div class="sheet-backdrop" data-act="sheet-close"></div>
    <section class="bsheet" role="dialog" aria-modal="true" aria-labelledby="sheet-title">
      <header class="sheet__head">
        <span class="sheet__grip" aria-hidden="true"></span>
        <h2 id="sheet-title">Bei Amazon stöbern</h2>
        <button class="icon-btn sheet__close" type="button" data-act="sheet-close" aria-label="Schließen">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>
        </button>
      </header>
      <form class="sheet__search" data-form="sheet-search" role="search">
        <div class="searchbar">
          <input id="sheet-q" type="search" enterkeyhint="search" autocomplete="off" placeholder="Was suchst du?" value="${esc(sh.q)}" aria-label="Suchbegriff">
          <button class="btn btn--primary" type="submit">Suchen</button>
        </div>
        <div class="chips chips--scroll" role="group" aria-label="Kategorie">
          ${CATEGORIES.map((c) => `<button type="button" class="chip" data-act="sheet-cat" data-id="${c.id}" aria-pressed="${sh.cat === c.id}">${esc(c.label)}</button>`).join('')}
        </div>
        <div class="sheet__filters">
          <label class="mini"><span>Preis von</span><input data-sheet="min" type="number" min="0" inputmode="numeric" value="${esc(sh.min)}" placeholder="0"></label>
          <label class="mini"><span>bis</span><input data-sheet="max" type="number" min="0" inputmode="numeric" value="${esc(sh.max)}" placeholder="∞"></label>
          <label class="mini mini--grow"><span>Sortierung</span>
            <select data-sheet="sort">${Object.entries(SORT_LABELS).map(([k, v]) => `<option value="${k}" ${sh.sort === k ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
        </div>
      </form>
      <div class="sheet__body" id="sheet-body">${sheetBody()}</div>
    </section>`;
}

function sheetBody() {
  const sh = S.sheet;
  if (sh.loading && !sh.items.length) {
    return `<div class="hits" aria-busy="true">${Array.from({ length: 6 }, () => '<div class="hit is-skeleton"><span class="hit__img"></span><span class="sk"></span><span class="sk sk--short"></span></div>').join('')}</div>`;
  }
  if (sh.error) {
    return `<div class="sheet__msg"><p>${esc(sh.error)}</p>
      <div class="actions"><button class="btn btn--ghost" type="button" data-act="sheet-retry">Noch mal versuchen</button>
      <a class="btn btn--ghost" href="${esc(browseLinksFor(sh).amazon)}" target="_blank" rel="noopener noreferrer">Auf amazon.de suchen</a></div></div>`;
  }
  if (!sh.searched) {
    return `<div class="sheet__msg"><p>Gib oben ein, was du dir wünschst, oder fang mit einer Idee an:</p>
      <div class="chips">${SUGGESTIONS.map((q) => `<button type="button" class="chip chip--action" data-act="sheet-suggest" data-q="${esc(q)}">${esc(q)}</button>`).join('')}</div></div>`;
  }
  if (!sh.items.length) {
    return `<div class="sheet__msg"><p>Dazu gibt es in diesem Preisbereich nichts. Versuch einen anderen Begriff oder lockere den Preisfilter.</p></div>`;
  }
  const mine = ownAsins();
  return `
    <div class="hits">
      ${sh.items
        .map((it) => {
          const added = mine.has(it.asin);
          const adding = sh.adding[it.asin];
          return `
          <article class="hit">
            <a class="hit__img" href="${esc(it.url)}" target="_blank" rel="noopener noreferrer" aria-label="${esc(it.title)} bei Amazon ansehen">
              ${httpUrl(it.image) ? `<img src="${esc(it.image)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : ''}
            </a>
            <h3 class="hit__title">${esc(it.title)}</h3>
            <p class="hit__meta">${it.price ? `<span class="price">${esc(it.price)}</span>` : '<span class="muted">Preis im Shop</span>'}
              ${it.rating ? `<span class="hit__rating" aria-label="${fmtRating(it.rating)} von 5 Sternen">★ ${fmtRating(it.rating)}</span>` : ''}</p>
            ${
              added
                ? '<button class="btn btn--small hit__add is-added" type="button" disabled>Auf deiner Liste ✓</button>'
                : `<button class="btn btn--primary btn--small hit__add" type="button" data-act="sheet-add" data-asin="${esc(it.asin)}" ${adding ? 'disabled' : ''}>${adding ? 'Kommt drauf …' : 'Auf meine Liste'}</button>`
            }
          </article>`;
        })
        .join('')}
    </div>
    ${sh.hasMore ? `<div class="sheet__more"><button class="btn btn--ghost" type="button" data-act="sheet-more" ${sh.loading ? 'disabled' : ''}>${sh.loading ? 'Lädt …' : 'Mehr anzeigen'}</button></div>` : ''}
    <p class="hint sheet__note">Preise laut Amazon zum Zeitpunkt der Suche.</p>`;
}

function renderSheetBody() {
  const body = $('#sheet-body');
  if (body) body.innerHTML = sheetBody();
}

function browseLinksFor(sh) {
  const saved = S.browse;
  S.browse = { q: sh.q, cat: sh.cat, min: sh.min, max: sh.max };
  const links = browseLinks();
  S.browse = saved;
  return links;
}

let searchSeq = 0;
async function runSearch({ more = false } = {}) {
  const sh = S.sheet;
  const cat = CATEGORIES.find((c) => c.id === sh.cat);
  const q = [sh.q.trim(), cat ? cat.kw : ''].filter(Boolean).join(' ');
  if (!q) {
    const inp = $('#sheet-q');
    if (inp) inp.focus();
    return;
  }
  const seq = ++searchSeq;
  const page = more ? sh.page + 1 : 1;
  sh.loading = true;
  sh.error = '';
  sh.searched = true;
  if (!more) { sh.items = []; const b = $('#sheet-body'); if (b) b.scrollTop = 0; }
  renderSheetBody();
  try {
    const params = new URLSearchParams({ q, page: String(page), sort: sh.sort });
    if (sh.min) params.set('min', sh.min);
    if (sh.max) params.set('max', sh.max);
    const res = await api(`/api/search?${params}`);
    if (seq !== searchSeq) return;
    const known = new Set(sh.items.map((i) => i.asin));
    sh.items = more ? sh.items.concat(res.items.filter((i) => !known.has(i.asin))) : res.items;
    sh.page = page;
    sh.hasMore = res.hasMore && page < 5;
  } catch (e) {
    if (seq !== searchSeq) return;
    if (!more) sh.error = e.message;
    else toast(e.message, 'is-error');
  }
  sh.loading = false;
  renderSheetBody();
}

async function addFromSheet(asin) {
  const it = S.sheet.items.find((i) => i.asin === asin);
  if (!it) return;
  S.sheet.adding[asin] = true;
  renderSheetBody();
  try {
    await api('/api/items', {
      method: 'POST',
      body: { person_id: S.me, round_id: round().id, url: it.url, title: it.title, image: it.image, price: it.price, site: 'Amazon' },
    });
    await load();
    toast('Steht jetzt auf deinem Wunschzettel');
    render();
  } catch (e) {
    toast(e.message, 'is-error');
  }
  delete S.sheet.adding[asin];
  renderSheetBody();
}

// ---------- Teilen aus anderen Apps ----------

const SHARE_KEY = 'wichteln.share';

function titleFromSharedText(text, url) {
  return String(text || '')
    .replace(url, '')
    .replace(/https?:\/\/\S+/g, '')
    .replace(/^(schau dir|sieh dir|check out|ich habe).*?(an|gefunden|out)\s*[:\-–]?\s*/i, '')
    .replace(/["“”„]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[:\-–]$/, '')
    .slice(0, 200);
}

// Liest ?url=/?text=/?title= (Android-Share-Target oder iPhone-Kurzbefehl) und merkt sie sich
function captureShare() {
  const sp = new URLSearchParams(location.search);
  if (!sp.has('url') && !sp.has('text')) return;
  const text = [sp.get('title'), sp.get('text'), sp.get('url')].filter(Boolean).join(' ');
  const m = text.match(/https?:\/\/\S+/);
  if (m) {
    const title = sp.get('title') && !/^https?:/.test(sp.get('title')) ? sp.get('title') : titleFromSharedText(sp.get('text') || '', m[0]);
    try { sessionStorage.setItem(SHARE_KEY, JSON.stringify({ url: m[0], title })); } catch { /* egal */ }
  }
  history.replaceState(null, '', location.pathname + location.hash);
}

function processShare() {
  let share = null;
  try { share = JSON.parse(sessionStorage.getItem(SHARE_KEY) || 'null'); } catch { /* egal */ }
  if (!share || !S.data || !S.me) return; // ohne Namen erst die Kugel wählen lassen
  sessionStorage.removeItem(SHARE_KEY);
  if (!editableRound()) {
    S.viewRound = null;
  }
  if (location.hash !== `#/p/${S.me}`) {
    history.replaceState(null, '', `#/p/${S.me}`);
    render();
  }
  loadPreview(share.url, share.title);
}

// ---------- Events ----------

document.addEventListener('click', (ev) => {
  const el = ev.target.closest('[data-act]');
  if (!el || el.tagName === 'SELECT') return;
  const fn = actions[el.dataset.act];
  if (!fn) return;
  if (el.tagName === 'A' && el.dataset.act !== 'to-browse') ev.preventDefault();
  fn(el, ev);
});

document.addEventListener('submit', (ev) => {
  const f = ev.target.closest('[data-form]');
  if (!f) return;
  ev.preventDefault();
  forms[f.dataset.form](f);
});

document.addEventListener('change', (ev) => {
  if (ev.target.matches('[data-act="round-select"]')) {
    actions.round({ dataset: { id: ev.target.value } });
  }
  if (ev.target.dataset.sheet) {
    S.sheet[ev.target.dataset.sheet] = ev.target.value;
    if (S.sheet.searched) runSearch();
  }
});

document.addEventListener('input', (ev) => {
  const t = ev.target;
  if (t.id === 'sheet-q') S.sheet.q = t.value;
  if (t.dataset.browse) {
    S.browse[t.dataset.browse] = t.value;
    updateBrowseLinks();
  }
});

document.addEventListener('paste', (ev) => {
  if (ev.target.id === 'add-url') setTimeout(() => loadPreview(ev.target.value), 0);
});

document.addEventListener('keydown', (ev) => {
  if (ev.key === 'Escape') {
    if (S.sheet.open) { closeSheet(); return; }
    if (S.editing) { S.editing = null; render(); }
    else if (S.draft && !S.draft.loading) { S.draft = null; render(); }
  }
});

window.addEventListener('popstate', () => {
  // Zurück-Taste am Handy schließt das Such-Fenster
  if (S.sheet.open && !(history.state && history.state.sheet)) closeSheet({ fromHistory: true });
});

window.addEventListener('hashchange', () => {
  S.draft = null;
  S.editing = null;
  render();
  window.scrollTo(0, 0);
});

// Änderungen der anderen regelmäßig abholen
setInterval(() => { if (!document.hidden && !busyTyping()) refresh({ quiet: true }); }, 45000);
document.addEventListener('visibilitychange', () => { if (!document.hidden && !busyTyping()) refresh({ quiet: true }); });

// ---------- Start ----------

(async function start() {
  captureShare();
  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    S.installPrompt = e;
    if (S.shareHelp) render();
  });
  try {
    await load();
    resetBrowse();
    if (S.adminKey) {
      try { await api('/api/admin/check', { method: 'POST', admin: true }); S.adminOk = true; } catch { S.adminOk = false; }
    }
  } catch (e) {
    S.error = e.message;
  }
  render();
  processShare();
})();
