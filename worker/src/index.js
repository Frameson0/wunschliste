import { fetchPreview } from './preview.js';
import { amazonSearch, searchConfigured, SearchUnavailable } from './amazon.js';

// ---------- Hilfsfunktionen ----------

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-Admin-Key',
  'Access-Control-Max-Age': '86400',
};

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...CORS },
  });

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
const fail = (status, message) => {
  throw new HttpError(status, message);
};

const str = (v, max = 500) => String(v ?? '').trim().slice(0, max);
const intOrNull = (v) => {
  if (v === '' || v == null) return null;
  const n = parseInt(v, 10);
  return Number.isFinite(n) && n >= 0 ? n : null;
};
const isColor = (c) => /^#[0-9a-f]{6}$/i.test(c || '');
const safeUrl = (u) => {
  const s = str(u, 2000);
  if (!s) return '';
  try {
    const p = new URL(s);
    return /^https?:$/.test(p.protocol) ? p.toString() : '';
  } catch {
    return '';
  }
};

async function body(request) {
  try {
    return await request.json();
  } catch {
    return {};
  }
}

async function sha256(text) {
  return crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
}

async function requireAdmin(request, env) {
  const given = request.headers.get('X-Admin-Key') || '';
  if (!env.ADMIN_PASSWORD) fail(500, 'Das Admin-Passwort ist noch nicht eingerichtet (Secret ADMIN_PASSWORD fehlt).');
  const [a, b] = await Promise.all([sha256(given), sha256(env.ADMIN_PASSWORD)]);
  if (!crypto.subtle.timingSafeEqual(a, b)) fail(401, 'Falsches Admin-Passwort.');
}

// ---------- Datenzugriff ----------

const ROUND_COLS = 'id, family_id, title, year, budget_min, budget_max, exchange_date, is_current';

async function loadRound(env, roundId) {
  if (!roundId) fail(400, 'Es fehlt die Gruppe.');
  const r = await env.DB.prepare('SELECT * FROM rounds WHERE id = ?').bind(roundId).first();
  if (!r) fail(404, 'Diese Gruppe gibt es nicht.');
  return r;
}

async function getItem(env, id) {
  const item = await env.DB.prepare(
    'SELECT items.*, rounds.is_current FROM items JOIN rounds ON rounds.id = items.round_id WHERE items.id = ?',
  )
    .bind(id)
    .first();
  if (!item) fail(404, 'Diese Idee gibt es nicht mehr.');
  return item;
}

function assertEditable(round) {
  if (!round.is_current) fail(403, 'Diese Gruppe ist archiviert und nur noch zum Anschauen da.');
}

async function isMember(env, roundId, personId) {
  return Boolean(
    await env.DB.prepare('SELECT 1 FROM round_members WHERE round_id = ? AND person_id = ?').bind(roundId, personId).first(),
  );
}

async function state(env, { familyId, roundId, viewerId }) {
  const features = { amazonSearch: searchConfigured(env), test: Boolean(env.TEST_MODE) };
  const families = (await env.DB.prepare('SELECT id, name FROM families ORDER BY sort, id').all()).results;
  const family = families.find((f) => f.id === familyId) || (families.length === 1 ? families[0] : null);
  if (!family) {
    return { families, family: null, rounds: [], round: null, people: [], family_people: [], members: [], items: [], features };
  }
  const rounds = (
    await env.DB.prepare(`SELECT ${ROUND_COLS} FROM rounds WHERE family_id = ? ORDER BY year DESC, id DESC`).bind(family.id).all()
  ).results;
  const round = rounds.find((r) => r.id === roundId) || rounds.find((r) => r.is_current) || rounds[0] || null;
  const rid = round ? round.id : 0;
  const [people, familyPeople, members, items] = await env.DB.batch([
    env.DB.prepare(
      `SELECT id, name, color, about FROM people
       WHERE id IN (SELECT person_id FROM family_members WHERE family_id = ?)
          OR id IN (SELECT person_id FROM round_members WHERE round_id = ?)
       ORDER BY id`,
    ).bind(family.id, rid),
    env.DB.prepare('SELECT person_id FROM family_members WHERE family_id = ?').bind(family.id),
    env.DB.prepare('SELECT person_id FROM round_members WHERE round_id = ?').bind(rid),
    env.DB.prepare('SELECT * FROM items WHERE round_id = ? ORDER BY favorite DESC, created_at DESC, id DESC').bind(rid),
  ]);
  return {
    families,
    family,
    rounds,
    round,
    people: people.results,
    family_people: familyPeople.results.map((m) => m.person_id),
    members: members.results.map((m) => m.person_id),
    // Kauf-Markierungen auf dem eigenen Wunschzettel nie an die beschenkte Person schicken
    items: items.results.map((it) =>
      viewerId && it.person_id === viewerId ? { ...it, purchased_by: null, purchased_at: null } : it,
    ),
    features,
  };
}

// ---------- Routen ----------

async function route(request, env, url) {
  const parts = url.pathname.replace(/\/+$/, '').split('/').filter(Boolean); // ["api", ...]
  if (parts[0] !== 'api') fail(404, 'Nicht gefunden.');
  const [, a, b, c] = parts;
  const m = request.method;
  const q = (k) => intOrNull(url.searchParams.get(k));

  // Testversion: alles nur mit Admin-Passwort
  if (env.TEST_MODE) {
    try {
      await requireAdmin(request, env);
    } catch (e) {
      if (e instanceof HttpError && e.status === 401) {
        throw Object.assign(new HttpError(401, 'Die Testversion ist nur mit dem Admin-Passwort zugänglich.'), { extra: { admin_required: true } });
      }
      throw e;
    }
  }

  // Alles auf einmal laden
  if (m === 'GET' && a === 'state') {
    return json(await state(env, { familyId: q('family'), roundId: q('round'), viewerId: q('viewer') }));
  }

  // Link-Vorschau
  if (m === 'GET' && a === 'preview') {
    const target = url.searchParams.get('url');
    if (!target) fail(400, 'Es fehlt der Link.');
    try {
      return json(await fetchPreview(target, env));
    } catch (e) {
      fail(400, e.message);
    }
  }

  // Amazon-Suche im Tool
  if (m === 'GET' && a === 'search') {
    const p = Object.fromEntries(url.searchParams);
    try {
      return json(await amazonSearch(env, p));
    } catch (e) {
      if (e instanceof SearchUnavailable) return json({ error: e.message, unavailable: true, details: e.details || [] }, 503);
      fail(400, e.message);
    }
  }

  // Idee anlegen
  if (m === 'POST' && a === 'items' && !b) {
    const d = await body(request);
    const round = await loadRound(env, intOrNull(d.round_id));
    assertEditable(round);
    const personId = intOrNull(d.person_id);
    if (!(await isMember(env, round.id, personId))) fail(400, 'Diese Person macht in dieser Gruppe nicht mit.');

    let fields = {
      url: safeUrl(d.url),
      title: str(d.title, 300),
      image: safeUrl(d.image),
      price: str(d.price, 40),
      site: str(d.site, 80),
    };
    if (fields.url && !fields.title && !fields.image) {
      try {
        const p = await fetchPreview(fields.url, env);
        fields = { url: p.url, title: p.title, image: p.image, price: p.price, site: p.site };
      } catch {
        /* Dann eben ohne Vorschau */
      }
    }
    const comment = str(d.comment, 1000);
    if (!fields.url && !fields.title && !comment) fail(400, 'Trag einen Link oder eine Beschreibung ein.');

    const row = await env.DB.prepare(
      `INSERT INTO items (round_id, person_id, url, title, image, price, site, comment, favorite)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING *`,
    )
      .bind(round.id, personId, fields.url, fields.title, fields.image, fields.price, fields.site, comment, d.favorite ? 1 : 0)
      .first();
    return json(row, 201);
  }

  // Als gekauft markieren / Markierung entfernen
  if (a === 'items' && b && c === 'purchase' && (m === 'POST' || m === 'DELETE')) {
    const item = await getItem(env, intOrNull(b));
    assertEditable(item);
    if (m === 'POST') {
      const d = await body(request);
      const buyer = intOrNull(d.person_id);
      if (!buyer) fail(400, 'Bitte zuerst oben deinen Namen wählen.');
      if (buyer === item.person_id) fail(400, 'Deine eigenen Wünsche kannst du nicht als gekauft markieren.');
      if (!(await isMember(env, item.round_id, buyer))) fail(400, 'Du machst in dieser Gruppe nicht mit.');
      if (item.purchased_by && item.purchased_by !== buyer) {
        const who = await env.DB.prepare('SELECT name FROM people WHERE id = ?').bind(item.purchased_by).first();
        fail(409, `${who ? who.name : 'Jemand'} hat das schon gekauft.`);
      }
      await env.DB.prepare("UPDATE items SET purchased_by = ?, purchased_at = datetime('now') WHERE id = ?").bind(buyer, item.id).run();
    } else {
      await env.DB.prepare('UPDATE items SET purchased_by = NULL, purchased_at = NULL WHERE id = ?').bind(item.id).run();
    }
    return json({ ok: true });
  }

  // Idee ändern / löschen / Vorschau neu laden
  if (a === 'items' && b) {
    const id = intOrNull(b);
    const item = await getItem(env, id);
    assertEditable(item);

    if (m === 'DELETE' && !c) {
      await env.DB.prepare('DELETE FROM items WHERE id = ?').bind(id).run();
      return json({ ok: true });
    }

    if (m === 'POST' && c === 'refresh') {
      if (!item.url) fail(400, 'Diese Idee hat keinen Link.');
      const p = await fetchPreview(item.url, env);
      const row = await env.DB.prepare(
        `UPDATE items SET title = ?, image = ?, price = ?, site = ?, updated_at = datetime('now') WHERE id = ? RETURNING *`,
      )
        .bind(p.title || item.title, p.image || item.image, p.price || item.price, p.site || item.site, id)
        .first();
      return json({ ...row, purchased_by: null, purchased_at: null });
    }

    if (m === 'PATCH' && !c) {
      const d = await body(request);
      const next = {
        url: 'url' in d ? safeUrl(d.url) : item.url,
        title: 'title' in d ? str(d.title, 300) : item.title,
        image: 'image' in d ? safeUrl(d.image) : item.image,
        price: 'price' in d ? str(d.price, 40) : item.price,
        site: 'site' in d ? str(d.site, 80) : item.site,
        comment: 'comment' in d ? str(d.comment, 1000) : item.comment,
        favorite: 'favorite' in d ? (d.favorite ? 1 : 0) : item.favorite,
      };
      const row = await env.DB.prepare(
        `UPDATE items SET url = ?, title = ?, image = ?, price = ?, site = ?, comment = ?, favorite = ?,
         updated_at = datetime('now') WHERE id = ? RETURNING *`,
      )
        .bind(next.url, next.title, next.image, next.price, next.site, next.comment, next.favorite, id)
        .first();
      return json({ ...row, purchased_by: null, purchased_at: null });
    }
  }

  // "Gut zu wissen" einer Person (darf jede*r für sich selbst pflegen)
  if (m === 'PATCH' && a === 'people' && b && !c) {
    const d = await body(request);
    const row = await env.DB.prepare('UPDATE people SET about = ? WHERE id = ? RETURNING id, name, color, about')
      .bind(str(d.about, 2000), intOrNull(b))
      .first();
    if (!row) fail(404, 'Diese Person gibt es nicht.');
    return json(row);
  }

  // ---------- Admin ----------
  if (a === 'admin') {
    await requireAdmin(request, env);

    if (m === 'POST' && b === 'check') return json({ ok: true, test: Boolean(env.TEST_MODE) });

    // Familien
    if (b === 'families') {
      if (m === 'POST' && !c) {
        const d = await body(request);
        const name = str(d.name, 40);
        if (!name) fail(400, 'Bitte einen Namen für die Familie eingeben.');
        try {
          return json(
            await env.DB.prepare(
              'INSERT INTO families (name, sort) VALUES (?, (SELECT COALESCE(MAX(sort), 0) + 1 FROM families)) RETURNING id, name',
            )
              .bind(name)
              .first(),
            201,
          );
        } catch {
          fail(409, `Die Familie ${name} gibt es schon.`);
        }
      }
      const id = intOrNull(c);
      if (m === 'PATCH' && id) {
        const d = await body(request);
        const name = str(d.name, 40);
        if (!name) fail(400, 'Der Name darf nicht leer sein.');
        try {
          const row = await env.DB.prepare('UPDATE families SET name = ? WHERE id = ? RETURNING id, name').bind(name, id).first();
          if (!row) fail(404, 'Diese Familie gibt es nicht.');
          return json(row);
        } catch (e) {
          if (e instanceof HttpError) throw e;
          fail(409, `Die Familie ${name} gibt es schon.`);
        }
      }
      if (m === 'DELETE' && id) {
        const n = await env.DB.prepare('SELECT COUNT(*) AS n FROM rounds WHERE family_id = ?').bind(id).first();
        if (n.n > 0) fail(400, 'Lösch zuerst alle Gruppen dieser Familie.');
        await env.DB.batch([
          env.DB.prepare('DELETE FROM family_members WHERE family_id = ?').bind(id),
          env.DB.prepare('DELETE FROM families WHERE id = ?').bind(id),
        ]);
        return json({ ok: true });
      }
    }

    // Personen
    if (b === 'people') {
      if (m === 'POST' && !c) {
        const d = await body(request);
        const name = str(d.name, 40);
        const familyId = intOrNull(d.family_id);
        if (!name) fail(400, 'Bitte einen Namen eingeben.');
        if (!familyId) fail(400, 'Es fehlt die Familie.');
        const color = isColor(d.color) ? d.color : '#C42F45';
        // Gibt es die Person schon (z. B. aus der anderen Familie)? Dann nur verknüpfen.
        let person = await env.DB.prepare('SELECT id, name, color, about FROM people WHERE name = ? COLLATE NOCASE').bind(name).first();
        const existed = Boolean(person);
        if (!person) {
          person = await env.DB.prepare('INSERT INTO people (name, color) VALUES (?, ?) RETURNING id, name, color, about')
            .bind(name, color)
            .first();
        }
        const stmts = [
          env.DB.prepare('INSERT OR IGNORE INTO family_members (family_id, person_id) VALUES (?, ?)').bind(familyId, person.id),
        ];
        const joinRound = intOrNull(d.join_round_id);
        if (joinRound) {
          stmts.push(
            env.DB.prepare(
              'INSERT OR IGNORE INTO round_members (round_id, person_id) SELECT id, ? FROM rounds WHERE id = ? AND family_id = ?',
            ).bind(person.id, joinRound, familyId),
          );
        }
        await env.DB.batch(stmts);
        return json({ ...person, existed }, 201);
      }
      const id = intOrNull(c);
      if (m === 'PATCH' && id) {
        const d = await body(request);
        const cur = await env.DB.prepare('SELECT * FROM people WHERE id = ?').bind(id).first();
        if (!cur) fail(404, 'Diese Person gibt es nicht.');
        const name = 'name' in d ? str(d.name, 40) : cur.name;
        if (!name) fail(400, 'Der Name darf nicht leer sein.');
        const color = isColor(d.color) ? d.color : cur.color;
        try {
          return json(
            await env.DB.prepare('UPDATE people SET name = ?, color = ? WHERE id = ? RETURNING id, name, color, about')
              .bind(name, color, id)
              .first(),
          );
        } catch {
          fail(409, `${name} gibt es schon.`);
        }
      }
      // Aus einer Familie entfernen. Ist die Person danach in keiner Familie mehr, wird sie ganz gelöscht.
      if (m === 'DELETE' && id) {
        const familyId = q('family');
        if (!familyId) fail(400, 'Es fehlt die Familie.');
        await env.DB.batch([
          env.DB.prepare('DELETE FROM items WHERE person_id = ? AND round_id IN (SELECT id FROM rounds WHERE family_id = ?)').bind(id, familyId),
          env.DB.prepare('DELETE FROM round_members WHERE person_id = ? AND round_id IN (SELECT id FROM rounds WHERE family_id = ?)').bind(id, familyId),
          env.DB.prepare('DELETE FROM family_members WHERE person_id = ? AND family_id = ?').bind(id, familyId),
        ]);
        const rest = await env.DB.prepare('SELECT COUNT(*) AS n FROM family_members WHERE person_id = ?').bind(id).first();
        if (rest.n === 0) {
          await env.DB.batch([
            env.DB.prepare('DELETE FROM items WHERE person_id = ?').bind(id),
            env.DB.prepare('UPDATE items SET purchased_by = NULL, purchased_at = NULL WHERE purchased_by = ?').bind(id),
            env.DB.prepare('DELETE FROM round_members WHERE person_id = ?').bind(id),
            env.DB.prepare('DELETE FROM people WHERE id = ?').bind(id),
          ]);
        }
        return json({ ok: true, deleted: rest.n === 0 });
      }
    }

    // Gruppen (Tabelle rounds)
    if (b === 'rounds') {
      if (m === 'POST' && !c) {
        const d = await body(request);
        const familyId = intOrNull(d.family_id);
        const fam = familyId && (await env.DB.prepare('SELECT id FROM families WHERE id = ?').bind(familyId).first());
        if (!fam) fail(400, 'Bitte eine Familie wählen.');
        const year = intOrNull(d.year) || new Date().getFullYear();
        const title = str(d.title, 80);
        if (!title) fail(400, 'Bitte einen Namen für die Gruppe eingeben.');
        const memberIds = Array.isArray(d.member_ids) ? d.member_ids.map(intOrNull).filter(Boolean) : [];
        const round = await env.DB.prepare(
          `INSERT INTO rounds (family_id, title, year, budget_min, budget_max, exchange_date, is_current)
           VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING ${ROUND_COLS}`,
        )
          .bind(familyId, title, year, intOrNull(d.budget_min), intOrNull(d.budget_max), str(d.exchange_date, 10) || null, d.active === false ? 0 : 1)
          .first();
        const stmts = memberIds.map((pid) =>
          env.DB.prepare('INSERT OR IGNORE INTO round_members (round_id, person_id) VALUES (?, ?)').bind(round.id, pid),
        );
        const copyFrom = intOrNull(d.copy_items_from);
        if (copyFrom && memberIds.length) {
          stmts.push(
            env.DB.prepare(
              `INSERT INTO items (round_id, person_id, url, title, image, price, site, comment, favorite)
               SELECT ?, person_id, url, title, image, price, site, comment, favorite FROM items
               WHERE round_id = ? AND person_id IN (${memberIds.map(() => '?').join(',')})`,
            ).bind(round.id, copyFrom, ...memberIds),
          );
        }
        if (stmts.length) await env.DB.batch(stmts);
        return json(round, 201);
      }

      const id = intOrNull(c);
      if (m === 'PATCH' && id) {
        const d = await body(request);
        const cur = await env.DB.prepare('SELECT * FROM rounds WHERE id = ?').bind(id).first();
        if (!cur) fail(404, 'Diese Gruppe gibt es nicht.');
        const stmts = [
          env.DB.prepare(
            'UPDATE rounds SET title = ?, year = ?, budget_min = ?, budget_max = ?, exchange_date = ?, is_current = ? WHERE id = ?',
          ).bind(
            'title' in d ? str(d.title, 80) || cur.title : cur.title,
            'year' in d ? intOrNull(d.year) || cur.year : cur.year,
            'budget_min' in d ? intOrNull(d.budget_min) : cur.budget_min,
            'budget_max' in d ? intOrNull(d.budget_max) : cur.budget_max,
            'exchange_date' in d ? str(d.exchange_date, 10) || null : cur.exchange_date,
            'is_current' in d ? (d.is_current ? 1 : 0) : cur.is_current,
            id,
          ),
        ];
        if (Array.isArray(d.member_ids)) {
          const ids = d.member_ids.map(intOrNull).filter(Boolean);
          stmts.push(env.DB.prepare('DELETE FROM round_members WHERE round_id = ?').bind(id));
          ids.forEach((pid) =>
            stmts.push(env.DB.prepare('INSERT INTO round_members (round_id, person_id) VALUES (?, ?)').bind(id, pid)),
          );
        }
        await env.DB.batch(stmts);
        return json(await env.DB.prepare(`SELECT ${ROUND_COLS} FROM rounds WHERE id = ?`).bind(id).first());
      }
      if (m === 'DELETE' && id) {
        await env.DB.batch([
          env.DB.prepare('DELETE FROM items WHERE round_id = ?').bind(id),
          env.DB.prepare('DELETE FROM round_members WHERE round_id = ?').bind(id),
          env.DB.prepare('DELETE FROM rounds WHERE id = ?').bind(id),
        ]);
        return json({ ok: true });
      }
    }
  }

  fail(404, 'Nicht gefunden.');
}

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
    const url = new URL(request.url);
    if (url.pathname === '/' || url.pathname === '') {
      return json({ ok: true, hinweis: 'Das ist die Wichtel-API. Die Seite selbst liegt auf GitHub Pages.', test: Boolean(env.TEST_MODE) });
    }
    try {
      return await route(request, env, url);
    } catch (e) {
      if (e instanceof HttpError) return json({ error: e.message, ...(e.extra || {}) }, e.status);
      console.error(e);
      return json({ error: 'Da ist etwas schiefgelaufen. Bitte gleich noch mal versuchen.' }, 500);
    }
  },
};
