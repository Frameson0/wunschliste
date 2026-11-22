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

async function loadRound(env, roundId) {
  if (roundId) {
    const r = await env.DB.prepare('SELECT * FROM rounds WHERE id = ?').bind(roundId).first();
    if (!r) fail(404, 'Diese Runde gibt es nicht.');
    return r;
  }
  return (
    (await env.DB.prepare('SELECT * FROM rounds WHERE is_current = 1 ORDER BY id DESC LIMIT 1').first()) ||
    (await env.DB.prepare('SELECT * FROM rounds ORDER BY year DESC, id DESC LIMIT 1').first())
  );
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
  if (!round.is_current) fail(403, 'Frühere Jahre sind nur noch zum Anschauen da.');
}

async function state(env, roundId) {
  const round = await loadRound(env, roundId);
  const [rounds, people, members, items] = await env.DB.batch([
    env.DB.prepare(
      'SELECT id, title, year, budget_min, budget_max, exchange_date, is_current FROM rounds ORDER BY year DESC, id DESC',
    ),
    env.DB.prepare('SELECT id, name, color, about FROM people ORDER BY id'),
    env.DB.prepare('SELECT person_id FROM round_members WHERE round_id = ?').bind(round ? round.id : 0),
    env.DB.prepare('SELECT * FROM items WHERE round_id = ? ORDER BY favorite DESC, created_at DESC, id DESC').bind(
      round ? round.id : 0,
    ),
  ]);
  return {
    round: round || null,
    rounds: rounds.results,
    people: people.results,
    members: members.results.map((m) => m.person_id),
    items: items.results,
    features: { amazonSearch: searchConfigured(env) },
  };
}

// ---------- Routen ----------

async function route(request, env, url) {
  const parts = url.pathname.replace(/\/+$/, '').split('/').filter(Boolean); // ["api", ...]
  if (parts[0] !== 'api') fail(404, 'Nicht gefunden.');
  const [, a, b, c] = parts;
  const m = request.method;

  // Alles auf einmal laden
  if (m === 'GET' && a === 'state') {
    return json(await state(env, intOrNull(url.searchParams.get('round'))));
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
      if (e instanceof SearchUnavailable) return json({ error: e.message, unavailable: true }, 503);
      fail(400, e.message);
    }
  }

  // Idee anlegen
  if (m === 'POST' && a === 'items' && !b) {
    const d = await body(request);
    const round = await loadRound(env, intOrNull(d.round_id));
    assertEditable(round);
    const personId = intOrNull(d.person_id);
    const member = await env.DB.prepare('SELECT 1 FROM round_members WHERE round_id = ? AND person_id = ?')
      .bind(round.id, personId)
      .first();
    if (!member) fail(400, 'Diese Person macht in dieser Runde nicht mit.');

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
      return json(row);
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
      return json(row);
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

    if (m === 'POST' && b === 'check') return json({ ok: true });

    // Personen
    if (b === 'people') {
      if (m === 'POST' && !c) {
        const d = await body(request);
        const name = str(d.name, 40);
        if (!name) fail(400, 'Bitte einen Namen eingeben.');
        const color = isColor(d.color) ? d.color : '#C42F45';
        let person;
        try {
          person = await env.DB.prepare('INSERT INTO people (name, color) VALUES (?, ?) RETURNING id, name, color, about')
            .bind(name, color)
            .first();
        } catch {
          fail(409, `${name} gibt es schon.`);
        }
        // Neue Personen machen in der aktuellen Runde direkt mit
        const round = await loadRound(env, null);
        if (round && d.join_current !== false) {
          await env.DB.prepare('INSERT OR IGNORE INTO round_members (round_id, person_id) VALUES (?, ?)')
            .bind(round.id, person.id)
            .run();
        }
        return json(person, 201);
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
      if (m === 'DELETE' && id) {
        await env.DB.batch([
          env.DB.prepare('DELETE FROM items WHERE person_id = ?').bind(id),
          env.DB.prepare('DELETE FROM round_members WHERE person_id = ?').bind(id),
          env.DB.prepare('DELETE FROM people WHERE id = ?').bind(id),
        ]);
        return json({ ok: true });
      }
    }

    // Runden
    if (b === 'rounds') {
      if (m === 'POST' && !c) {
        const d = await body(request);
        const year = intOrNull(d.year) || new Date().getFullYear();
        const title = str(d.title, 80) || `Weihnachten ${year}`;
        const memberIds = Array.isArray(d.member_ids) ? d.member_ids.map(intOrNull).filter(Boolean) : [];
        const makeCurrent = d.make_current !== false;
        if (makeCurrent) await env.DB.prepare('UPDATE rounds SET is_current = 0').run();
        const round = await env.DB.prepare(
          `INSERT INTO rounds (title, year, budget_min, budget_max, exchange_date, is_current)
           VALUES (?, ?, ?, ?, ?, ?) RETURNING *`,
        )
          .bind(title, year, intOrNull(d.budget_min), intOrNull(d.budget_max), str(d.exchange_date, 10) || null, makeCurrent ? 1 : 0)
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
        if (!cur) fail(404, 'Diese Runde gibt es nicht.');
        const stmts = [];
        if (d.is_current) stmts.push(env.DB.prepare('UPDATE rounds SET is_current = 0'));
        stmts.push(
          env.DB.prepare(
            'UPDATE rounds SET title = ?, year = ?, budget_min = ?, budget_max = ?, exchange_date = ?, is_current = ? WHERE id = ?',
          ).bind(
            'title' in d ? str(d.title, 80) || cur.title : cur.title,
            'year' in d ? intOrNull(d.year) || cur.year : cur.year,
            'budget_min' in d ? intOrNull(d.budget_min) : cur.budget_min,
            'budget_max' in d ? intOrNull(d.budget_max) : cur.budget_max,
            'exchange_date' in d ? str(d.exchange_date, 10) || null : cur.exchange_date,
            d.is_current ? 1 : cur.is_current,
            id,
          ),
        );
        if (Array.isArray(d.member_ids)) {
          const ids = d.member_ids.map(intOrNull).filter(Boolean);
          stmts.push(env.DB.prepare('DELETE FROM round_members WHERE round_id = ?').bind(id));
          ids.forEach((pid) =>
            stmts.push(env.DB.prepare('INSERT INTO round_members (round_id, person_id) VALUES (?, ?)').bind(id, pid)),
          );
        }
        await env.DB.batch(stmts);
        return json(await env.DB.prepare('SELECT * FROM rounds WHERE id = ?').bind(id).first());
      }
      if (m === 'DELETE' && id) {
        const count = await env.DB.prepare('SELECT COUNT(*) AS n FROM rounds').first();
        if (count.n <= 1) fail(400, 'Die letzte Runde kann nicht gelöscht werden.');
        await env.DB.batch([
          env.DB.prepare('DELETE FROM items WHERE round_id = ?').bind(id),
          env.DB.prepare('DELETE FROM round_members WHERE round_id = ?').bind(id),
          env.DB.prepare('DELETE FROM rounds WHERE id = ?').bind(id),
        ]);
        // Sicherstellen, dass es weiterhin eine aktuelle Runde gibt
        await env.DB.prepare(
          `UPDATE rounds SET is_current = 1 WHERE id = (SELECT id FROM rounds ORDER BY year DESC, id DESC LIMIT 1)
           AND NOT EXISTS (SELECT 1 FROM rounds WHERE is_current = 1)`,
        ).run();
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
      return json({ ok: true, hinweis: 'Das ist die Wichtel-API. Die Seite selbst liegt auf GitHub Pages.' });
    }
    try {
      return await route(request, env, url);
    } catch (e) {
      if (e instanceof HttpError) return json({ error: e.message }, e.status);
      console.error(e);
      return json({ error: 'Da ist etwas schiefgelaufen. Bitte gleich noch mal versuchen.' }, 500);
    }
  },
};
