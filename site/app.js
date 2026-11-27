// Wunschliste – Wunschzettel für die Familie
// Reines JavaScript ohne Build-Schritt. Daten kommen vom Cloudflare Worker (window.WICHTEL_API).

const API = String(window.WICHTEL_API || '').replace(/\/+$/, '');
// Die Testversion läuft unter /test/ auf derselben Adresse und bekommt eigene Speicher-Schlüssel
const TEST = Boolean(window.WICHTEL_TEST);
const PFX = TEST ? 'wichteln.test.' : 'wichteln.';
const KEYS = { token: `${PFX}token`, admin: `${PFX}admin`, family: `${PFX}family`, group: (fid) => `${PFX}group.${fid}` };

const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch { /* privates Fenster */ } },
};

const S = {
  data: null,
  family: parseInt(store.get(KEYS.family), 10) || null,
  viewRound: null,
  token: store.get(KEYS.token) || '',
  viewer: null,     // mit Code angemeldete Person
  me: null,         // angemeldete Person, wenn sie in der angezeigten Gruppe mitmacht
  pinFor: null,     // Person, deren Code gerade abgefragt wird
  forgot: 0,        // Schritt beim "Code vergessen"
  pinFirst: '',     // beim ersten Festlegen: der zuerst eingegebene Code
  pins: [],         // Codes für die Verwaltung
  // In der Testversion gilt auch das Passwort, mit dem du auf der Live-Seite angemeldet bist
  adminKey: store.get(KEYS.admin) || (TEST ? store.get('wichteln.admin') || '' : ''),
  needAdmin: false,
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

// Weihnachts-Look nur, wenn der Termin der Gruppe in der Weihnachtszeit liegt (1. Dezember bis 6. Januar).
// Ohne Termin entscheidet der Name ("Weihnachten", "Wichteln", "Advent" …).
function xmasDate(str) {
  const d = new Date(`${str}T00:00:00`);
  if (isNaN(d)) return false;
  return d.getMonth() === 11 || (d.getMonth() === 0 && d.getDate() <= 6);
}
function isXmas() {
  const r = S.data && S.data.round;
  if (!r) return false;
  if (r.exchange_date) return xmasDate(r.exchange_date);
  return /weihnacht|wichtel|advent|nikolaus|christmas|xmas/i.test(r.title || '');
}

function exchangeText(r) {
  if (!r || !r.exchange_date) return '';
  const d = new Date(`${r.exchange_date}T00:00:00`);
  if (isNaN(d)) return '';
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const days = Math.round((d - today) / 86400000);
  const date = d.toLocaleDateString('de-DE', { day: 'numeric', month: 'long' });
  if (xmasDate(r.exchange_date)) {
    if (days > 1) return `Bescherung am ${date}, in ${days} Tagen`;
    if (days === 1) return `Bescherung morgen, am ${date}`;
    if (days === 0) return 'Heute ist Bescherung!';
    return `Bescherung war am ${date}`;
  }
  if (days > 1) return `Am ${date}, in ${days} Tagen`;
  if (days === 1) return `Morgen ist es so weit (${date})`;
  if (days === 0) return 'Heute ist es so weit!';
  return `War am ${date}`;
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
  if (!API) throw new Error('Die Adresse der API fehlt in config.js.');
  const headers = {};
  if (body) headers['Content-Type'] = 'application/json';
  if (admin || TEST) headers['X-Admin-Key'] = S.adminKey;
  if (S.token) headers['X-Person-Token'] = S.token;
  let res;
  try {
    res = await fetch(API + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  } catch {
    throw new Error('Keine Verbindung zum Server. Prüf deine Internetverbindung und versuch es noch mal.');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const e = new Error(data.error || `Fehler ${res.status}`);
    e.status = res.status;
    if (data.admin_required) { S.needAdmin = true; S.adminOk = false; }
    throw e;
  }
  return data;
}

async function load() {
  const qs = new URLSearchParams();
  if (S.family) {
    qs.set('family', S.family);
    if (!S.viewRound) S.viewRound = parseInt(store.get(KEYS.group(S.family)), 10) || null;
    if (S.viewRound) qs.set('round', S.viewRound);
  }
  const d = await api(`/api/state${qs.toString() ? `?${qs}` : ''}`);
  S.data = d;
  S.error = null;
  S.needAdmin = false;
  if (d.family && d.family.id !== S.family) setFamily(d.family.id);
  if (!d.family && S.family) setFamily(null);
  if (S.viewRound && !d.rounds.some((r) => r.id === S.viewRound)) setGroup(null);
  if (S.token && !d.viewer) setToken(''); // Code wurde geändert: neu anmelden
  S.viewer = d.viewer;
  S.me = d.viewer && d.members.includes(d.viewer) ? d.viewer : null;
  if (S.adminOk && route().view === 'admin' && d.family) {
    S.pins = await api(`/api/admin/pins?family=${d.family.id}`, { admin: true }).catch(() => []);
  }
}

function setToken(token) {
  S.token = token || '';
  store.set(KEYS.token, token || null);
  if (!token) { S.viewer = null; S.me = null; }
}

const logout = () => setToken('');

function setFamily(id) {
  S.family = id;
  S.viewRound = null;
  store.set(KEYS.family, id ? String(id) : null);
}

function setGroup(id) {
  S.viewRound = id;
  if (S.family) store.set(KEYS.group(S.family), id ? String(id) : null);
}

// ---------- abgeleitete Daten ----------

const round = () => S.data && S.data.round;
const editableRound = () => Boolean(round() && round().is_current);
const people = () => (S.data ? S.data.people : []);
const person = (id) => people().find((p) => p.id === id);
const members = () => people().filter((p) => S.data.members.includes(p.id));
const itemsOf = (id) => S.data.items.filter((i) => i.person_id === id);
const family = () => S.data && S.data.family;
const activeRounds = () => (S.data ? S.data.rounds.filter((r) => r.is_current) : []);
const familyPeople = () => people().filter((p) => S.data.family_people.includes(p.id));
// Mehrere aktive Gruppen und noch keine gewählt: erst fragen
const needGroupChoice = () => Boolean(family() && !S.viewRound && activeRounds().length > 1);
const roundLabel = (r) => (String(r.title).includes(String(r.year)) || String(r.title).includes(String(r.year).slice(2)) ? r.title : `${r.title} (${r.year})`);

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
  <nav class="garland ${big ? 'garland--big' : ''} ${list.length > 7 ? 'garland--many' : ''} ${S.firstPaint ? 'is-entering' : ''}" aria-label="${pick ? 'Wer bist du?' : 'Wunschzettel der Familie'}">
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
  ${TEST ? '<div class="testbar" role="note"><strong>Testversion</strong> · nur für dich sichtbar · eigene Testdaten</div>' : ''}
  <header class="topbar">
    <span class="topbar__left">
      <a class="brand" href="#/">Wunschliste</a>
      ${family() ? `<button class="ctx" type="button" data-act="switch-family" aria-label="Familie wechseln, gerade: ${esc(family().name)}">${esc(family().name)}<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M3 4.5l3 3 3-3"/></svg></button>` : ''}
    </span>
    ${
      me
        ? `<div class="whoami"><span>Du bist <strong>${esc(me.name)}</strong></span><button class="btn btn--ghost btn--small" data-act="switch">Wechseln</button></div>`
        : ''
    }
  </header>`;
}

function archiveBanner() {
  if (!round() || round().is_current) return '';
  const cur = activeRounds()[0];
  return `<div class="archive" role="note"><strong>${esc(round().title)}</strong> ist archiviert. Die Wunschzettel lassen sich nicht mehr ändern.
    ${cur ? `<button class="btn btn--small btn--ghost-dark" data-act="round" data-id="${cur.id}">Zu ${esc(cur.title)}</button>` : ''}</div>`;
}

const REINDEER_SVG = `
<svg class="reindeer" viewBox="0 0 120 130" aria-hidden="true">
  <g fill="none" stroke="#7a5333" stroke-width="5" stroke-linecap="round" stroke-linejoin="round">
    <path d="M42 40 C36 26 30 18 22 10 M33 26 L20 26 M37 32 L28 38"/>
    <path d="M78 40 C84 26 90 18 98 10 M87 26 L100 26 M83 32 L92 38"/>
  </g>
  <ellipse cx="33" cy="50" rx="10" ry="5.5" fill="#8b5e3c" transform="rotate(-25 33 50)"/>
  <ellipse cx="87" cy="50" rx="10" ry="5.5" fill="#8b5e3c" transform="rotate(25 87 50)"/>
  <path d="M60 36 C80 36 88 52 86 70 C84 90 74 104 60 104 C46 104 36 90 34 70 C32 52 40 36 60 36 Z" fill="#9a6a45"/>
  <ellipse cx="60" cy="88" rx="17" ry="15" fill="#e2c29f"/>
  <circle cx="50" cy="62" r="4.2" fill="#123b2f"/><circle cx="70" cy="62" r="4.2" fill="#123b2f"/>
  <circle cx="51.3" cy="60.6" r="1.4" fill="#fff"/><circle cx="71.3" cy="60.6" r="1.4" fill="#fff"/>
  <circle cx="60" cy="80" r="7" fill="#c42f45"/><circle cx="57.6" cy="77.6" r="2" fill="#fff" opacity=".55"/>
  <path d="M54 93 Q60 98 66 93" fill="none" stroke="#7a5333" stroke-width="2.4" stroke-linecap="round"/>
  <path d="M44 104 Q60 114 76 104 L80 126 Q60 132 40 126 Z" fill="#9a6a45"/>
  <path d="M46 106 Q60 113 74 106" fill="none" stroke="#c42f45" stroke-width="5" stroke-linecap="round"/>
  <circle cx="60" cy="113" r="3.6" fill="#e3a82b"/>
</svg>`;

// Außerhalb der Weihnachtszeit hilft ein kleines Geschenk statt des Rentiers
const GIFT_SVG = `
<svg class="reindeer gift" viewBox="0 0 120 130" aria-hidden="true">
  <path d="M60 42 C48 20 26 22 32 38 C35 45 50 44 60 42 Z" fill="#efb03f"/>
  <path d="M60 42 C72 20 94 22 88 38 C85 45 70 44 60 42 Z" fill="#efb03f"/>
  <path d="M60 42 C52 31 41 30 40 36" fill="none" stroke="#c98a1c" stroke-width="2.4" stroke-linecap="round"/>
  <path d="M60 42 C68 31 79 30 80 36" fill="none" stroke="#c98a1c" stroke-width="2.4" stroke-linecap="round"/>
  <rect x="24" y="42" width="72" height="18" rx="5" fill="#c4432f"/>
  <rect x="30" y="58" width="60" height="58" rx="7" fill="#e0553f"/>
  <rect x="54" y="42" width="12" height="74" fill="#efb03f"/>
  <circle cx="60" cy="42" r="6" fill="#f6c766"/>
  <circle cx="43" cy="78" r="4.2" fill="#1e2b3c"/><circle cx="77" cy="78" r="4.2" fill="#1e2b3c"/>
  <circle cx="44.3" cy="76.6" r="1.4" fill="#fff"/><circle cx="78.3" cy="76.6" r="1.4" fill="#fff"/>
  <circle cx="38" cy="90" r="4.5" fill="#f19a8b"/><circle cx="82" cy="90" r="4.5" fill="#f19a8b"/>
  <path d="M48 92 Q60 102 72 92" fill="none" stroke="#1e2b3c" stroke-width="2.6" stroke-linecap="round"/>
  <ellipse cx="44" cy="120" rx="8" ry="4.5" fill="#c4432f"/><ellipse cx="76" cy="120" rx="8" ry="4.5" fill="#c4432f"/>
</svg>`;
const helperSvg = () => (isXmas() ? REINDEER_SVG : GIFT_SVG);

function helper() {
  return `
  <div class="helper-wrap">
    <button class="helper" type="button" data-act="tour" aria-label="Hilfe: Wie geht das alles? Kurze Anleitung starten">
      ${helperSvg()}
      <span class="helper__sign" aria-hidden="true"><span>Hilfe!</span> Wie geht das alles?</span>
    </button>
  </div>`;
}

function footer() {
  const rounds = S.data ? S.data.rounds : [];
  return `
  ${helper()}
  <footer class="footer">
    ${
      rounds.length > 1
        ? `<label class="footer__rounds">Gruppe
            <select data-act="round-select">
              ${rounds.map((r) => `<option value="${r.id}" ${round() && r.id === round().id ? 'selected' : ''}>${esc(roundLabel(r))}${r.is_current ? '' : ' · archiviert'}</option>`).join('')}
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

function viewTestLogin() {
  return `
  <div class="testbar" role="note"><strong>Testversion</strong> · nur für dich sichtbar</div>
  <main id="main" class="admin">
    <h1>Testversion</h1>
    <section class="paper"><div class="paper__inner">
      <p class="muted">Die Testversion ist nur mit dem Admin-Passwort zugänglich. Sie hat eigene Testdaten, an der echten Seite ändert sich nichts.</p>
      <form data-form="admin-login" class="stack">
        <label class="field"><span>Admin-Passwort</span><input type="password" name="key" autocomplete="current-password" required></label>
        <button class="btn btn--primary" type="submit">Anmelden</button>
      </form>
    </div></section>
    <p><a href="../">Zur echten Seite</a></p>
  </main>`;
}

function viewFamilyPicker() {
  const fams = S.data.families;
  return `
  ${topbar()}
  <main id="main" class="choose">
    <div class="choose__text">
      <h1>Zu welcher Familie gehörst du?</h1>
      <p>Tipp auf deine Familie. Danach wählst du deinen Namen.</p>
    </div>
    <div class="choose__list">
      ${fams
        .map(
          (f, i) => `
        <button class="family-card paper" type="button" data-act="pick-family" data-id="${f.id}" style="--c:${PALETTE[(i * 3) % PALETTE.length]}">
          <span class="paper__inner">
            <span class="family-card__ball" aria-hidden="true">${esc(f.name.slice(0, 1).toUpperCase())}</span>
            <span class="family-card__name"><small>Familie</small>${esc(f.name)}</span>
          </span>
        </button>`,
        )
        .join('')}
      ${fams.length ? '' : '<p class="empty">Es gibt noch keine Familie. Leg sie in der Verwaltung an.</p>'}
    </div>
  </main>
  ${footer()}`;
}

function viewGroupPicker() {
  const list = activeRounds();
  return `
  ${topbar()}
  <main id="main" class="choose">
    <div class="choose__text">
      <h1>Welche Liste?</h1>
      <p>In der Familie ${esc(family().name)} gibt es gerade mehrere Listen. Tipp auf die, die du suchst.</p>
    </div>
    <div class="choose__list">
      ${list
        .map((r) => {
          const facts = [budgetText(r) && `Budget ${budgetText(r)}`, exchangeText(r)].filter(Boolean).join(' · ');
          return `
        <button class="group-card paper" type="button" data-act="round" data-id="${r.id}">
          <span class="paper__inner">
            <span class="group-card__year">${r.year}</span>
            <span class="group-card__title">${esc(r.title)}</span>
            ${facts ? `<span class="group-card__facts">${esc(facts)}</span>` : ''}
          </span>
        </button>`;
        })
        .join('')}
    </div>
  </main>
  ${footer()}`;
}

function viewNoGroup() {
  return `
  ${topbar()}
  <main id="main" class="choose">
    <div class="choose__text">
      <h1>Familie ${esc(family().name)}</h1>
      <p>Für die Familie ${esc(family().name)} gibt es noch keine Liste.${S.adminOk ? '' : ' Sobald Eric eine anlegt, geht es hier los.'}</p>
      ${S.adminOk ? '<p><a class="btn btn--primary" href="#/admin">Gruppe anlegen</a></p>' : ''}
      <p><button class="btn btn--ghost" type="button" data-act="switch-family">Andere Familie wählen</button></p>
    </div>
  </main>
  ${footer()}`;
}

function viewPin() {
  const p = person(S.pinFor);
  if (!p) { S.pinFor = null; return viewPicker(); }
  if (!p.has_pin) return viewPinSetup(p);
  return `
  ${topbar()}
  <main id="main" class="choose pin" style="--c:${esc(p.color)}">
    <span class="pin__ball ${isLight(p.color) ? 'is-light' : ''}" aria-hidden="true">${esc(p.name.slice(0, 1).toUpperCase())}</span>
    <div class="choose__text">
      <h1>Hallo ${esc(p.name)}!</h1>
      <p>Gib deinen 4-stelligen Code ein.</p>
    </div>
    <form class="pin__form" data-form="pin-login" autocomplete="off">
      <label class="sr" for="pin">Code für ${esc(p.name)}</label>
      <input id="pin" name="pin" type="password" inputmode="numeric" pattern="[0-9]*" maxlength="4" autocomplete="one-time-code" enterkeyhint="go" placeholder="····" aria-describedby="pin-hint">
      <button class="btn btn--primary pin__go" type="submit">Weiter</button>
    </form>
    <p class="pin__reveal" role="status"></p>
    <div class="pin__more">
      <button class="btn btn--ghost" type="button" data-act="pin-back">Ich bin jemand anderes</button>
      ${S.forgot < 4 ? `<button class="linklike pin__forgot ${S.forgot ? 'is-asking' : ''}" type="button" data-act="forgot">${esc(forgotLabel(p))}</button>` : ''}
      <p class="hint" id="pin-hint">Das ist der Code, den du dir beim ersten Mal ausgedacht hast. Wer „Code vergessen“ benutzt, sieht Eric in der Verwaltung.</p>
    </div>
  </main>
  ${footer()}`;
}

function viewPinSetup(p) {
  const again = Boolean(S.pinFirst);
  return `
  ${topbar()}
  <main id="main" class="choose pin" style="--c:${esc(p.color)}">
    <span class="pin__ball ${isLight(p.color) ? 'is-light' : ''}" aria-hidden="true">${esc(p.name.slice(0, 1).toUpperCase())}</span>
    <div class="choose__text">
      <h1>${again ? 'Noch einmal, bitte' : `Hallo ${esc(p.name)}!`}</h1>
      <p>${
        again
          ? 'Gib deinen neuen Code zur Sicherheit noch einmal ein.'
          : 'Du bist zum ersten Mal hier. Denk dir einen 4-stelligen Code aus. Damit kann niemand sonst deinen Wunschzettel öffnen.'
      }</p>
    </div>
    <form class="pin__form" data-form="pin-login" autocomplete="off">
      <label class="sr" for="pin">${again ? 'Code wiederholen' : `Neuer Code für ${esc(p.name)}`}</label>
      <input id="pin" name="pin" type="password" inputmode="numeric" pattern="[0-9]*" maxlength="4" autocomplete="new-password" enterkeyhint="go" placeholder="····">
      <button class="btn btn--primary pin__go" type="submit">${again ? 'Code speichern' : 'Weiter'}</button>
    </form>
    <p class="pin__steps" aria-hidden="true"><span class="${again ? '' : 'is-on'}"></span><span class="${again ? 'is-on' : ''}"></span></p>
    <div class="pin__more">
      <button class="btn btn--ghost" type="button" data-act="pin-back">Ich bin jemand anderes</button>
      <p class="hint">Merk dir den Code gut, zum Beispiel ein Geburtstag oder eine Hausnummer. Vergessen ist aber auch kein Drama.</p>
    </div>
  </main>
  ${footer()}`;
}

function viewPicker() {
  const list = members();
  return `
  ${topbar()}
  <main id="main" class="picker">
    ${garland(list, { big: true, pick: true })}
    <div class="picker__text">
      <h1>Wer bist du?</h1>
      <p>Tipp auf ${isXmas() ? 'deine Kugel' : 'deinen Namen'}. Danach füllst du deinen Wunschzettel und schaust, was sich die anderen wünschen.</p>
      ${list.length ? '' : '<p class="empty">In dieser Gruppe ist noch niemand eingetragen. Das geht in der Verwaltung.</p>'}
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
      <h1>${esc(r ? r.title : 'Wunschliste')}</h1>
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
            <span class="sheet-tile__count">${its.length ? ideas(its.length) : mine && editableRound() ? 'Noch leer, leg los' : 'Noch keine Ideen'}${
              !mine && its.some((i) => i.purchased_by) ? `<span class="tile-bought">${its.filter((i) => i.purchased_by).length} schon gekauft</span>` : ''
            }</span>
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
          ? 'Installiere die Wunschliste als App: <button class="btn btn--primary btn--small" type="button" data-act="install">Als App installieren</button>'
          : isStandalone()
            ? 'Die Wunschliste ist schon als App installiert.'
            : 'Installiere die Wunschliste als App: In Chrome oben rechts auf <strong>⋮</strong> und dann <strong>App installieren</strong> bzw. <strong>Zum Startbildschirm hinzufügen</strong>.'
      }</li>
      <li>In der Amazon-App (oder jeder anderen App) beim Artikel auf <strong>Teilen</strong> tippen und <strong>Wunschliste</strong> wählen.</li>
      <li>Die Wunschliste öffnet sich mit der Vorschau. Ein Tippen auf „Auf den Wunschzettel“, fertig.</li>
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
  const buyer = !own && it.purchased_by ? person(it.purchased_by) : null;
  const canBuy = !own && S.me && editableRound();
  let buyBlock = '';
  if (!own && it.purchased_by) {
    const mine = it.purchased_by === S.me;
    buyBlock = `<div class="bought">
        <span class="bought__badge">✓ Schon gekauft${mine ? ' von dir' : buyer ? ` von ${esc(buyer.name)}` : ''}</span>
        ${canBuy && mine ? `<button class="linklike" type="button" data-act="unbuy" data-id="${it.id}">Doch nicht gekauft</button>` : ''}
      </div>`;
  } else if (canBuy) {
    buyBlock = `<div class="bought"><button class="btn btn--ghost btn--small btn--buy" type="button" data-act="buy" data-id="${it.id}">Hab ich gekauft</button></div>`;
  }
  return `
  <li class="item ${it.favorite ? 'is-fav' : ''} ${!own && it.purchased_by ? 'is-bought' : ''}">
    ${link ? `<a class="item__media" href="${esc(link)}" target="_blank" rel="noopener noreferrer" tabindex="-1" aria-hidden="true">${thumb(it)}</a>` : `<span class="item__media">${thumb(it)}</span>`}
    <div class="item__body">
      ${it.favorite ? '<span class="fav-badge">Herzenswunsch</span>' : ''}
      <h3 class="item__title">${link ? `<a href="${esc(link)}" target="_blank" rel="noopener noreferrer">${title}</a>` : title}</h3>
      ${it.price || it.site ? `<p class="item__meta">${it.price ? `<span class="price">${esc(it.price)}</span>` : ''}${it.site ? `<span class="site">bei ${esc(it.site)}</span>` : ''}</p>` : ''}
      ${it.comment ? `<p class="item__comment">${esc(it.comment)}</p>` : ''}
      ${buyBlock}
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
      <section class="sheet paper" id="my-list"><div class="paper__inner">
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

const pinOf = (id) => S.pins.find((x) => x.id === id) || {};
const fmtDay = (s) => {
  const d = new Date(String(s || '').replace(' ', 'T') + 'Z');
  return isNaN(d) ? '' : d.toLocaleDateString('de-DE', { day: 'numeric', month: 'long' });
};

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
  const fam = family();
  const colorSelect = (name, value) => `
    <span class="swatches" role="radiogroup" aria-label="Farbe">
      ${PALETTE.map((c) => `<label class="swatch" style="--c:${c}"><input type="radio" name="${name}" value="${c}" ${c.toLowerCase() === String(value).toLowerCase() ? 'checked' : ''}><span class="sr">${c}</span></label>`).join('')}
    </span>`;
  const famTabs = `
    <div class="chips admin__tabs" role="group" aria-label="Familie">
      ${S.data.families.map((f) => `<button type="button" class="chip" data-act="admin-family" data-id="${f.id}" aria-pressed="${fam && f.id === fam.id}">Familie ${esc(f.name)}</button>`).join('')}
    </div>`;
  const testLink = !TEST
    ? `<section class="paper admin__test"><div class="paper__inner">
        <h2>Testversion</h2>
        <p class="muted">Neue Funktionen probierst du hier aus, bevor sie für alle live gehen. Sie hat eigene Testdaten und ist nur mit deinem Admin-Passwort sichtbar.</p>
        <a class="btn btn--ghost" href="./test/#/admin">Testversion öffnen</a>
      </div></section>`
    : `<p class="note">Du bist in der Testversion. Änderungen hier betreffen nur die Testdaten. <a href="../#/admin">Zur echten Verwaltung</a></p>`;

  const familiesBox = `
    <section class="paper"><div class="paper__inner">
      <h2>Familien</h2>
      <ul class="people-admin">
        ${S.data.families
          .map(
            (f) => `
          <li><form data-form="admin-family" data-id="${f.id}" class="person-row">
            <input name="name" value="${esc(f.name)}" maxlength="40" aria-label="Name der Familie">
            <span class="person-row__actions">
              <button class="btn btn--ghost btn--small" type="submit">Speichern</button>
              <button class="btn btn--ghost btn--small btn--danger" type="button" data-act="admin-del-family" data-id="${f.id}">Löschen</button>
            </span>
          </form></li>`,
          )
          .join('')}
      </ul>
      <form data-form="admin-add-family" class="person-row person-row--new">
        <input name="name" maxlength="40" placeholder="Neue Familie" aria-label="Name der neuen Familie" required>
        <span class="person-row__actions"><button class="btn btn--primary btn--small" type="submit">Hinzufügen</button></span>
      </form>
    </div></section>`;

  if (!fam) {
    return `
    ${topbar()}
    <main id="main" class="admin">
      <div class="admin__head"><h1>Verwaltung</h1><button class="btn btn--ghost btn--small" data-act="admin-logout">Abmelden</button></div>
      ${famTabs}
      <p class="muted">Wähl oben eine Familie aus.</p>
      ${familiesBox}
      ${testLink}
    </main>`;
  }

  const r = round();
  const famPeople = familyPeople();
  const thisYear = new Date().getFullYear();
  const memberChecks = (selected) =>
    `<div class="checks">${people()
      .filter((p) => S.data.family_people.includes(p.id) || selected.has(p.id))
      .map((p) => `<label class="check"><input type="checkbox" name="member" value="${p.id}" ${selected.has(p.id) ? 'checked' : ''}> ${esc(p.name)}</label>`)
      .join('')}</div>`;

  const groupsBox = `
    <section class="paper"><div class="paper__inner">
      <h2>Gruppen der Familie ${esc(fam.name)}</h2>
      ${
        S.data.rounds.length
          ? `<ul class="rounds-admin">
          ${S.data.rounds
            .map(
              (x) => `<li class="${r && x.id === r.id ? 'is-selected' : ''}"><span><span class="pill pill--year">${x.year}</span> ${esc(x.title)}${x.is_current ? ' <span class="pill">aktiv</span>' : ' <span class="pill pill--muted">archiviert</span>'}</span>
            <span class="person-row__actions">
              ${r && x.id === r.id ? '<span class="muted">wird unten bearbeitet</span>' : `<button class="btn btn--ghost btn--small" data-act="round" data-id="${x.id}">Bearbeiten</button>`}
              <button class="btn btn--ghost btn--small" data-act="admin-toggle-round" data-id="${x.id}">${x.is_current ? 'Archivieren' : 'Wieder aktiv'}</button>
              <button class="btn btn--ghost btn--small btn--danger" data-act="admin-del-round" data-id="${x.id}">Löschen</button>
            </span></li>`,
            )
            .join('')}
        </ul>
        <p class="hint">Aktive Gruppen sehen alle in der Familie. Sind mehrere aktiv, wählt man beim Öffnen die passende. Archivierte bleiben zum Nachschauen über „Gruppe“ ganz unten.</p>`
          : '<p class="muted">Diese Familie hat noch keine Gruppe. Leg unten die erste an.</p>'
      }
    </div></section>`;

  const editBox = r
    ? `
    <section class="paper"><div class="paper__inner">
      <h2>${esc(r.title)} bearbeiten</h2>
      <form data-form="admin-round" data-id="${r.id}" class="stack">
        <div class="grid2">
          <label class="field"><span>Name der Gruppe</span><input name="title" value="${esc(r.title)}" maxlength="80"></label>
          <label class="field"><span>Jahr</span><input name="year" type="number" value="${r.year}"></label>
          <label class="field"><span>Termin (Bescherung, Geburtstag …)</span><input name="exchange_date" type="date" value="${esc(r.exchange_date || '')}"></label>
          <span></span>
          <label class="field"><span>Budget von (€)</span><input name="budget_min" type="number" min="0" value="${r.budget_min ?? ''}"></label>
          <label class="field"><span>Budget bis (€)</span><input name="budget_max" type="number" min="0" value="${r.budget_max ?? ''}"></label>
        </div>
        <fieldset class="field"><legend>Wer macht mit?</legend>${memberChecks(new Set(S.data.members))}</fieldset>
        <div><button class="btn btn--primary" type="submit">Gruppe speichern</button></div>
      </form>
    </div></section>`
    : '';

  const newBox = `
    <section class="paper"><div class="paper__inner">
      <h2>Neue Gruppe anlegen</h2>
      <p class="muted">Zum Beispiel fürs Wichteln, für Weihnachten oder einen Geburtstag. Liegt der Termin zwischen 1. Dezember und 6. Januar, sieht die Liste weihnachtlich aus. Ältere Gruppen bleiben erhalten.</p>
      <form data-form="admin-new-round" class="stack">
        <div class="grid2">
          <label class="field"><span>Name der Gruppe</span><input name="title" maxlength="80" placeholder="z. B. Weihnachten ${esc(fam.name)} ${String(thisYear).slice(2)}" required></label>
          <label class="field"><span>Jahr</span><input name="year" type="number" value="${thisYear}" required></label>
          <label class="field"><span>Termin (Bescherung, Geburtstag …)</span><input name="exchange_date" type="date"></label>
          <span></span>
          <label class="field"><span>Budget von (€)</span><input name="budget_min" type="number" min="0"></label>
          <label class="field"><span>Budget bis (€)</span><input name="budget_max" type="number" min="0"></label>
        </div>
        <fieldset class="field"><legend>Wer macht mit?</legend>${memberChecks(new Set(famPeople.map((p) => p.id)))}</fieldset>
        ${
          S.data.rounds.length
            ? `<label class="field"><span>Wunschzettel übernehmen aus</span>
            <select name="copy"><option value="">Nein, alle fangen leer an</option>
              ${S.data.rounds.map((x) => `<option value="${x.id}">${esc(roundLabel(x))}</option>`).join('')}
            </select></label>`
            : '<input type="hidden" name="copy" value="">'
        }
        <div><button class="btn btn--primary" type="submit">Gruppe anlegen</button></div>
      </form>
    </div></section>`;

  const peopleBox = `
    <section class="paper"><div class="paper__inner">
      <h2>Personen der Familie ${esc(fam.name)}</h2>
      <ul class="people-admin">
        ${famPeople
          .map(
            (p) => `
          <li><form data-form="admin-person" data-id="${p.id}" class="person-row person-row--pin">
            <input name="name" value="${esc(p.name)}" maxlength="40" aria-label="Name">
            <label class="pin-field"><span>Code</span><input name="pin" value="${esc(pinOf(p.id).pin || '')}" placeholder="noch frei" inputmode="numeric" maxlength="4" pattern="[0-9]{4}" aria-label="Code von ${esc(p.name)}"></label>
            ${colorSelect(`color-${p.id}`, p.color)}
            <span class="pin-status">${pinOf(p.id).pin ? `Code festgelegt${pinOf(p.id).pin_set_at ? ` am ${esc(fmtDay(pinOf(p.id).pin_set_at))}` : ''} · <button class="linklike" type="button" data-act="admin-reset-pin" data-id="${p.id}">Zurücksetzen</button>` : 'Hat noch keinen Code, legt ihn beim ersten Antippen selbst fest'}</span>
            ${pinOf(p.id).pin_reveals ? `<span class="pin-note">Hat „Code vergessen“ ${pinOf(p.id).pin_reveals}× benutzt, zuletzt ${esc(fmtDay(pinOf(p.id).pin_revealed_at))}</span>` : ''}
            <span class="person-row__actions">
              <button class="btn btn--ghost btn--small" type="submit">Speichern</button>
              <button class="btn btn--ghost btn--small btn--danger" type="button" data-act="admin-del-person" data-id="${p.id}">Entfernen</button>
            </span>
          </form></li>`,
          )
          .join('')}
      </ul>
      <form data-form="admin-add-person" class="person-row person-row--new">
        <input name="name" maxlength="40" placeholder="Neue Person" aria-label="Name der neuen Person" required>
        ${colorSelect('color-new', PALETTE[famPeople.length % PALETTE.length])}
        <span class="person-row__actions"><button class="btn btn--primary btn--small" type="submit">Hinzufügen</button></span>
        ${r && r.is_current ? `<label class="check person-row__join"><input type="checkbox" name="join" value="${r.id}" checked> macht bei ${esc(r.title)} mit</label>` : ''}
      </form>
      <p class="hint">Wer in mehreren Familien ist (wie Eric und Dana), ist dieselbe Person: „Gut zu wissen“ gilt überall, der Wunschzettel ist pro Gruppe eigen.</p>
    </div></section>`;

  return `
  ${topbar()}
  <main id="main" class="admin">
    <div class="admin__head">
      <h1>Verwaltung</h1>
      <button class="btn btn--ghost btn--small" data-act="admin-logout">Abmelden</button>
    </div>
    ${famTabs}
    ${groupsBox}
    ${editBox}
    ${newBox}
    ${peopleBox}
    ${familiesBox}
    ${testLink}
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
  if (TEST && (S.needAdmin || !S.adminKey)) {
    app.innerHTML = viewTestLogin();
    applyTheme();
    document.title = 'Test – Wunschliste';
    return;
  }
  if (!S.data) return;
  const r = route();
  let html;
  if (r.view === 'admin') html = viewAdmin();
  else if (!family()) html = viewFamilyPicker();
  else if (!round()) html = viewNoGroup();
  else if (needGroupChoice()) html = viewGroupPicker();
  else if (S.pinFor) html = viewPin();
  else if (!S.me) html = viewPicker();
  else if (r.view === 'person') html = viewPerson(r.id);
  else html = viewHome();
  app.innerHTML = html;
  applyTheme();
  document.title = `${TEST ? 'Test – ' : ''}${r.view === 'person' && person(r.id) ? `${person(r.id).name} – ` : ''}Wunschliste`;
  if (S.firstPaint) requestAnimationFrame(() => setTimeout(() => (S.firstPaint = false), 50));
}

function applyTheme() {
  const x = isXmas();
  document.body.classList.toggle('theme-xmas', x);
  document.body.classList.toggle('theme-plain', !x);
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = x ? '#123B2F' : '#1E2B3C';
}

function busyTyping() {
  const a = document.activeElement;
  return Boolean(S.pinFor || S.draft || S.editing || S.sheet.open || S.tour || (a && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName)));
}

async function refresh({ quiet = false } = {}) {
  if (TEST && !S.adminKey) return render();
  try {
    await load();
  } catch (e) {
    if (!quiet && !S.needAdmin) toast(e.message, 'is-error');
    if (!S.data && !S.needAdmin) S.error = e.message;
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
  async 'pick-family'(el) {
    setFamily(parseInt(el.dataset.id, 10));
    S.draft = null; S.editing = null;
    await refresh();
    resetBrowse();
    if (location.hash && location.hash !== '#/') location.hash = '#/';
    render();
  },
  async 'switch-family'() {
    setFamily(null);
    S.draft = null; S.editing = null;
    if (S.sheet.open) closeSheet();
    if (location.hash && location.hash !== '#/' && !location.hash.startsWith('#/admin')) location.hash = '#/';
    await refresh();
  },
  async 'admin-family'(el) {
    setFamily(parseInt(el.dataset.id, 10));
    await refresh();
    resetBrowse();
  },
  async pick(el) {
    const id = parseInt(el.dataset.id, 10);
    if (id === S.viewer) return afterLogin();
    S.pinFor = id;
    S.forgot = 0;
    S.pinFirst = '';
    render();
    const inp = $('#pin');
    if (inp) inp.focus();
  },
  'pin-back'() { S.pinFor = null; S.forgot = 0; S.pinFirst = ''; render(); },
  async 'admin-reset-pin'(el) {
    const p = person(parseInt(el.dataset.id, 10));
    if (!confirm(`Code von ${p.name} zurücksetzen? ${p.name} legt beim nächsten Antippen einen neuen fest. Auf allen Geräten muss ${p.name} sich dann neu anmelden.`)) return;
    await adminCall(`/api/admin/people/${p.id}`, { method: 'PATCH', body: { reset_pin: true } }, `Code von ${p.name} ist zurückgesetzt`);
  },
  async forgot() {
    const p = person(S.pinFor);
    if (S.forgot < 3) {
      S.forgot += 1;
      const b = $('[data-act="forgot"]');
      if (b) { b.textContent = forgotLabel(p); b.classList.add('is-asking'); b.focus(); }
      return;
    }
    try {
      const res = await api(`/api/people/${p.id}/forgot`, { method: 'POST' });
      S.forgot = 4;
      render();
      const msg = $('.pin__reveal');
      if (msg) msg.innerHTML = `Dein Code ist <strong>${esc(res.pin)}</strong>. Merk ihn dir gut!`;
      const inp = $('#pin');
      if (inp) { inp.value = res.pin; inp.focus(); }
    } catch (e) { toast(e.message, 'is-error'); }
  },
  'sheet-open'(el) { openSheet(el); },
  tour() { startTour(); },
  async buy(el) {
    const it = S.data.items.find((i) => i.id === parseInt(el.dataset.id, 10));
    const p = person(it.person_id);
    if (!confirm(`Hast du „${it.title || 'diese Idee'}“ gekauft?\n\n${p.name} sieht das nicht. Alle anderen sehen es, damit niemand dasselbe kauft.`)) return;
    try {
      await api(`/api/items/${it.id}/purchase`, { method: 'POST' });
      toast(`Als gekauft markiert. ${p.name} sieht das nicht.`);
    } catch (e) { toast(e.message, 'is-error'); }
    await refresh();
  },
  async unbuy(el) {
    try {
      await api(`/api/items/${el.dataset.id}/purchase`, { method: 'DELETE' });
      toast('Markierung entfernt');
    } catch (e) { toast(e.message, 'is-error'); }
    await refresh();
  },
  'tour-next'() { tourGo(1); },
  'tour-back'() { tourGo(-1); },
  'tour-close'() { endTour(); },
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
    if (choice && choice.outcome === 'accepted') toast('Die Wunschliste wird installiert');
    render();
  },
  async copy(el) {
    try { await navigator.clipboard.writeText(el.dataset.text); toast('Kopiert'); }
    catch { toast('Kopieren ging nicht. Bitte von Hand markieren.', 'is-error'); }
  },
  switch() {
    logout();
    S.pinFor = null;
    S.draft = null;
    S.editing = null;
    location.hash = '#/';
    render();
  },
  reload() { refresh(); },
  async round(el) {
    setGroup(parseInt(el.dataset.id, 10) || null);
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
    const fam = family();
    if (!confirm(`${p.name} aus der Familie ${fam.name} entfernen? Die Wunschzettel von ${p.name} in allen Gruppen dieser Familie werden dabei gelöscht.`)) return;
    const res = await adminCall(`/api/admin/people/${p.id}?family=${fam.id}`, { method: 'DELETE' }, `${p.name} ist nicht mehr in der Familie ${fam.name}`);
    if (res && res.deleted && S.viewer === p.id) logout();
  },
  async 'admin-toggle-round'(el) {
    const r = S.data.rounds.find((x) => x.id === parseInt(el.dataset.id, 10));
    await adminCall(`/api/admin/rounds/${r.id}`, { method: 'PATCH', body: { is_current: !r.is_current } }, r.is_current ? `${r.title} ist archiviert` : `${r.title} ist wieder aktiv`);
  },
  async 'admin-del-round'(el) {
    const r = S.data.rounds.find((x) => x.id === parseInt(el.dataset.id, 10));
    if (!confirm(`${r.title} mit allen Wunschzetteln endgültig löschen?`)) return;
    if (S.viewRound === r.id) setGroup(null);
    await adminCall(`/api/admin/rounds/${r.id}`, { method: 'DELETE' }, `${r.title} gelöscht`);
  },
  async 'admin-del-family'(el) {
    const f = S.data.families.find((x) => x.id === parseInt(el.dataset.id, 10));
    if (!confirm(`Familie ${f.name} löschen?`)) return;
    const res = await adminCall(`/api/admin/families/${f.id}`, { method: 'DELETE' }, `Familie ${f.name} gelöscht`);
    if (res && S.family === f.id) { setFamily(null); await refresh(); }
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

function forgotLabel(p) {
  return ['Code vergessen?', `Bist du wirklich ${p.name}?`, 'Ganz sicher?', 'Kein Schummeln?'][S.forgot] || 'Code vergessen?';
}

function afterLogin() {
  S.pinFor = null;
  S.forgot = 0;
  S.pinFirst = '';
  if (sessionStorage.getItem(SHARE_KEY)) return processShare();
  if (location.hash !== `#/p/${S.me}`) location.hash = `#/p/${S.me}`;
  else render();
}

const forms = {
  async 'pin-login'(f) {
    const pin = f.pin.value.replace(/\D/g, '');
    if (pin.length !== 4) return f.pin.focus();
    const setup = !person(S.pinFor).has_pin;
    if (setup && !S.pinFirst) {
      // Erst einmal eingeben, dann zur Sicherheit wiederholen
      S.pinFirst = pin;
      render();
      $('#pin').focus();
      return;
    }
    if (setup && pin !== S.pinFirst) {
      S.pinFirst = '';
      render();
      const nf = $('[data-form="pin-login"]');
      nf.classList.add('is-wrong');
      toast('Die beiden Codes waren nicht gleich. Bitte noch mal von vorn.', 'is-error');
      $('#pin').focus();
      return;
    }
    const btn = f.querySelector('[type="submit"]');
    btn.disabled = true;
    try {
      const body = setup ? { person_id: S.pinFor, new_pin: pin } : { person_id: S.pinFor, pin };
      const res = await api('/api/login', { method: 'POST', body });
      setToken(res.token);
      await load();
      if (res.created) toast('Dein Code ist gespeichert. Merk ihn dir gut!');
      afterLogin();
    } catch (e) {
      if (setup || e.status === 409) {
        // Code wurde inzwischen festgelegt (oder zurückgesetzt): Ansicht neu laden
        S.pinFirst = '';
        await load().catch(() => {});
        render();
        toast(e.message, 'is-error');
        return;
      }
      btn.disabled = false;
      f.pin.value = '';
      f.classList.remove('is-wrong'); void f.offsetWidth; f.classList.add('is-wrong');
      toast(e.message, 'is-error');
      f.pin.focus();
    }
  },
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
      S.needAdmin = false;
      store.set(KEYS.admin, S.adminKey);
      await refresh();
    } catch (e) { toast(e.message, 'is-error'); }
  },
  async 'admin-round'(f) {
    const body = {
      title: f.title.value,
      exchange_date: f.exchange_date.value,
      budget_min: f.budget_min.value,
      budget_max: f.budget_max.value,
      year: f.year.value,
      member_ids: [...f.querySelectorAll('[name="member"]:checked')].map((c) => parseInt(c.value, 10)),
    };
    await adminCall(`/api/admin/rounds/${f.dataset.id}`, { method: 'PATCH', body }, 'Gruppe gespeichert');
    resetBrowse();
  },
  async 'admin-person'(f) {
    const id = f.dataset.id;
    const color = (f.querySelector(`[name="color-${id}"]:checked`) || {}).value;
    const body = { name: f.name.value, color };
    const pin = f.pin.value.trim();
    if (pin && pin !== (pinOf(parseInt(id, 10)).pin || '')) body.pin = pin;
    await adminCall(`/api/admin/people/${id}`, { method: 'PATCH', body }, 'Gespeichert');
  },
  async 'admin-add-person'(f) {
    const color = (f.querySelector('[name="color-new"]:checked') || {}).value;
    const join = f.join && f.join.checked ? parseInt(f.join.value, 10) : null;
    const name = f.name.value.trim();
    try {
      const res = await api('/api/admin/people', { method: 'POST', admin: true, body: { name, color, family_id: family().id, join_round_id: join } });
      toast(res.existed ? `${res.name} gab es schon und ist jetzt auch in der Familie ${family().name}` : `${res.name} ist dabei`);
      await refresh();
    } catch (e) { if (e.status === 401) { S.adminOk = false; render(); } toast(e.message, 'is-error'); }
  },
  async 'admin-new-round'(f) {
    const title = f.title.value.trim();
    if (!title) return f.title.focus();
    const res = await adminCall(
      '/api/admin/rounds',
      {
        method: 'POST',
        body: {
          family_id: family().id,
          title,
          year: parseInt(f.year.value, 10),
          exchange_date: f.exchange_date.value,
          budget_min: f.budget_min.value,
          budget_max: f.budget_max.value,
          member_ids: [...f.querySelectorAll('[name="member"]:checked')].map((c) => parseInt(c.value, 10)),
          copy_items_from: parseInt(f.copy.value, 10) || null,
        },
      },
      `${title} ist angelegt`,
    );
    if (res) { setGroup(res.id); await refresh(); resetBrowse(); }
  },
  async 'admin-family'(f) {
    await adminCall(`/api/admin/families/${f.dataset.id}`, { method: 'PATCH', body: { name: f.name.value } }, 'Gespeichert');
  },
  async 'admin-add-family'(f) {
    const res = await adminCall('/api/admin/families', { method: 'POST', body: { name: f.name.value } }, `Familie ${f.name.value.trim()} ist angelegt`);
    if (res) { setFamily(res.id); await refresh(); }
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

// ---------- Kleine Anleitung (Rentier bzw. Geschenk) ----------

function tourSteps() {
  if (!S.me) {
    return [
      { sel: '.garland', title: 'Wer bist du?', text: `Jede${isXmas() ? ' Kugel' : 'r Kreis'} ist eine Person aus der Familie. Tipp auf deinen Namen und gib deinen Code ein.` },
      { sel: '.helper', title: 'Danach geht es weiter', text: 'Wenn du angemeldet bist, drück noch einmal auf mich. Dann zeige ich dir den Rest.' },
    ];
  }
  const me = person(S.me);
  return [
    { sel: '.garland', title: 'Das ist die Familie', text: `Jede${isXmas() ? ' Kugel' : 'r Kreis'} ist eine Person. Dein${isXmas() ? 'e Kugel' : ' Kreis'} ist mit „du“ markiert, ${esc(me ? me.name : '')}.` },
    { sel: '.finder', title: 'Wünsche finden', text: 'Schreib hier hinein, was du dir wünschst, zum Beispiel „Tee“. Dann tippst du auf „Suchen“.' },
    {
      sel: '.finder',
      title: 'Auf die Liste setzen',
      text: 'Dann erscheinen Bilder von passenden Artikeln. Gefällt dir einer, tippst du darunter auf diesen Knopf:',
      demo: '<span class="tour__demo">Auf meine Liste</span><span class="tour__demo-hint">Fertig! Mehr ist es nicht.</span>',
    },
    { sel: '.add', title: 'Etwas aus einem anderen Laden?', text: 'Kopier im Laden den Link. Dann tippst du hier auf „Kopierten Link einfügen“. Du kannst auch eine Idee ohne Link aufschreiben.' },
    { sel: '#my-list', title: 'Dein Wunschzettel', text: 'Hier steht alles, was du dir wünschst. Mit dem Stern ☆ markierst du deinen größten Wunsch. Mit „Löschen“ nimmst du etwas wieder herunter.' },
    { sel: '.about', title: 'Gut zu wissen', text: 'Schreib hier Größen und Vorlieben auf, zum Beispiel deine Schuhgröße. Danach auf „Speichern“ tippen.' },
    { sel: '.garland', title: 'Geschenk für jemand anderen', text: `Tipp oben auf ${isXmas() ? 'die Kugel' : 'den Namen'} der Person, die du beschenkst. Hast du etwas von ihrem Zettel gekauft, tipp dort auf „Hab ich gekauft“. Die Person sieht das nicht, alle anderen schon. So kauft niemand doppelt.` },
    { sel: '.helper', title: 'Das war’s!', text: `Wenn du wieder Hilfe brauchst, drück einfach auf mich. ${isXmas() ? 'Frohe Weihnachten!' : 'Viel Spaß beim Wünschen!'}` },
  ];
}

const tourReduce = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

function startTour() {
  if (S.sheet.open) closeSheet();
  const r = route();
  if (S.me && (r.view !== 'person' || r.id !== S.me)) {
    location.hash = `#/p/${S.me}`;
  }
  setTimeout(() => {
    const steps = tourSteps().filter((st) => document.querySelector(st.sel));
    if (!steps.length) return;
    S.tour = { steps, i: 0 };
    let root = $('#tour-root');
    if (!root) {
      root = document.createElement('div');
      root.id = 'tour-root';
      document.body.appendChild(root);
    }
    showTourStep();
  }, 60);
}

function endTour() {
  S.tour = null;
  const root = $('#tour-root');
  if (root) root.innerHTML = '';
  window.removeEventListener('resize', placeTour);
  window.removeEventListener('scroll', placeTour, true);
  const h = $('.helper');
  if (h) h.focus({ preventScroll: true });
}

function tourGo(d) {
  if (!S.tour) return;
  const next = S.tour.i + d;
  if (next >= S.tour.steps.length) return endTour();
  if (next < 0) return;
  S.tour.i = next;
  showTourStep();
}

function showTourStep() {
  const { steps, i } = S.tour;
  const st = steps[i];
  const last = i === steps.length - 1;
  $('#tour-root').innerHTML = `
    <div class="tour" role="dialog" aria-modal="true" aria-labelledby="tour-title" aria-describedby="tour-text">
      <div class="tour__block"></div>
      <div class="tour__spot" aria-hidden="true"></div>
      <div class="tour__bubble">
        <div class="tour__top">${helperSvg()}<span class="tour__count">Schritt ${i + 1} von ${steps.length}</span></div>
        <h2 id="tour-title">${st.title}</h2>
        <p id="tour-text">${st.text}</p>
        ${st.demo || ''}
        <div class="tour__btns">
          ${i > 0 ? '<button class="btn btn--ghost tour__btn" type="button" data-act="tour-back">Zurück</button>' : ''}
          <button class="btn btn--primary tour__btn" type="button" data-act="tour-next">${last ? 'Fertig' : 'Weiter'}</button>
        </div>
        ${last ? '' : '<button class="tour__close" type="button" data-act="tour-close">Anleitung beenden</button>'}
      </div>
    </div>`;
  const target = document.querySelector(st.sel);
  if (target) {
    // Ziel oben ins Bild holen, die Sprechblase steht dann unten daneben
    const r = target.getBoundingClientRect();
    const bh = $('.tour__bubble').offsetHeight;
    const free = window.innerHeight - bh - 48;
    const offset = r.height <= free ? 24 : Math.max(24, (window.innerHeight - r.height) / 2);
    window.scrollTo({ top: window.scrollY + r.top - offset, behavior: tourReduce() ? 'auto' : 'smooth' });
  }
  placeTour();
  setTimeout(placeTour, tourReduce() ? 0 : 420);
  window.addEventListener('resize', placeTour);
  window.addEventListener('scroll', placeTour, true);
  $('[data-act="tour-next"]').focus({ preventScroll: true });
}

function placeTour() {
  if (!S.tour) return;
  const st = S.tour.steps[S.tour.i];
  const target = document.querySelector(st.sel);
  const spot = $('.tour__spot');
  const bubble = $('.tour__bubble');
  if (!spot || !bubble) return;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  if (!target) { spot.style.opacity = '0'; return; }
  const r = target.getBoundingClientRect();
  const pad = 8;
  const top = Math.max(r.top - pad, 6);
  const left = Math.max(r.left - pad, 6);
  const bottom = Math.min(r.bottom + pad, vh - 6);
  const right = Math.min(r.right + pad, vw - 6);
  Object.assign(spot.style, { opacity: '1', top: `${top}px`, left: `${left}px`, width: `${Math.max(right - left, 0)}px`, height: `${Math.max(bottom - top, 0)}px` });
  // Sprechblase dorthin, wo Platz ist
  const bh = bubble.offsetHeight;
  const spaceBelow = vh - bottom;
  const spaceAbove = top;
  bubble.classList.toggle('is-top', spaceBelow < bh + 24 && spaceAbove > spaceBelow);
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
  if (t.id === 'pin') {
    t.value = t.value.replace(/\D/g, '').slice(0, 4);
    if (t.value.length === 4) t.form.requestSubmit();
  }
  // Neue Gruppe: Bescherungsdatum wandert mit dem Jahr mit
  if (t.name === 'year' && t.form && t.form.dataset.form === 'admin-new-round' && /^\d{4}$/.test(t.value)) {
    const d = t.form.exchange_date;
    if (d.value) d.value = `${t.value}${d.value.slice(4)}`;
  }
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
    if (S.tour) { endTour(); return; }
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
  if (S.tour) endTour();
  S.draft = null;
  S.editing = null;
  if (route().view === 'admin' && S.adminOk) refresh({ quiet: true });
  render();
  window.scrollTo(0, 0);
});

// Änderungen der anderen regelmäßig abholen
setInterval(() => { if (!document.hidden && !busyTyping()) refresh({ quiet: true }); }, 45000);
document.addEventListener('visibilitychange', () => { if (!document.hidden && !busyTyping()) refresh({ quiet: true }); });

// ---------- Start ----------

(async function start() {
  captureShare();
  if (!TEST && 'serviceWorker' in navigator && location.protocol === 'https:') {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    S.installPrompt = e;
    if (S.shareHelp) render();
  });
  try {
    if (S.adminKey) {
      try { await api('/api/admin/check', { method: 'POST', admin: true }); S.adminOk = true; } catch { S.adminOk = false; }
    }
    if (!TEST || S.adminOk) {
      await load();
      resetBrowse();
    } else {
      S.needAdmin = true;
    }
  } catch (e) {
    if (!S.needAdmin) S.error = e.message;
  }
  render();
  processShare();
})();
