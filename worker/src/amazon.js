// Amazon-Suche über Drittanbieter.
// 1. SerpApi (engine=amazon), Gratis: 250 Suchen/Monat
// 2. amazonscraperapi.com als Fallback, Gratis: 1.000 Anfragen/Monat
// Ergebnisse werden 24 h in D1 zwischengespeichert.

const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const DOMAIN = 'amazon.de';

const SORTS = {
  relevance: { serp: 'relevanceblender', asa: 'best_match' },
  price_asc: { serp: 'price-asc-rank', asa: 'price_asc' },
  price_desc: { serp: 'price-desc-rank', asa: 'price_desc' },
  rating: { serp: 'review-rank', asa: 'avg_customer_review' },
};

export class SearchUnavailable extends Error {}

const euro = (n) =>
  typeof n === 'number' && isFinite(n) && n > 0
    ? new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' }).format(n)
    : '';

function toNumber(v) {
  if (typeof v === 'number') return v;
  if (v == null) return null;
  const s = String(v).replace(/[^\d.,]/g, '');
  if (!s) return null;
  // "1.299,99" -> 1299.99 ; "24,99" -> 24.99 ; "24.99" -> 24.99
  const norm = /,\d{1,2}$/.test(s) ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  const n = parseFloat(norm);
  return isFinite(n) ? n : null;
}

function cleanImage(src) {
  if (!src) return '';
  // Amazon-Thumbnails in etwas größerer Auflösung anfordern
  return String(src).replace(/\._[A-Z0-9_,]+_\.(jpg|png|webp)$/i, '._AC_SL400_.$1');
}

function normalize(list) {
  const seen = new Set();
  const out = [];
  for (const r of list) {
    if (!r.asin || seen.has(r.asin)) continue;
    seen.add(r.asin);
    out.push({
      asin: r.asin,
      title: String(r.title || '').trim().slice(0, 300),
      image: cleanImage(r.image),
      price_value: r.price_value ?? null,
      price: euro(r.price_value),
      rating: r.rating ? Math.round(Number(r.rating) * 10) / 10 : null,
      reviews: r.reviews ? Number(r.reviews) : null,
      url: `https://www.${DOMAIN}/dp/${r.asin}`,
    });
  }
  return out;
}

async function viaSerpApi(key, args) {
  try {
    return await serpApiCall(key, args, true);
  } catch (e) {
    // Falls SerpApi den Preis-Filter (rh) nicht annimmt: ohne Filter, wir filtern danach selbst
    if (args.min != null || args.max != null) return serpApiCall(key, args, false);
    throw e;
  }
}

async function serpApiCall(key, { q, page, sort, min, max }, withPrice) {
  const u = new URL('https://serpapi.com/search.json');
  u.searchParams.set('engine', 'amazon');
  u.searchParams.set('amazon_domain', DOMAIN);
  u.searchParams.set('language', 'de_DE');
  u.searchParams.set('k', q);
  u.searchParams.set('page', String(page));
  u.searchParams.set('s', SORTS[sort].serp);
  if (withPrice && (min != null || max != null)) u.searchParams.set('rh', `p_36:${min != null ? min * 100 : ''}-${max != null ? max * 100 : ''}`);
  u.searchParams.set('api_key', key);
  const res = await fetch(u, { headers: { accept: 'application/json' } });
  const j = await res.json().catch(() => ({}));
  if (!res.ok || j.error) {
    // "Your account has run out of searches" o. Ä. -> Fallback probieren
    throw new Error(`SerpApi: ${j.error || res.status}`);
  }
  const list = (j.organic_results || []).map((r) => ({
    asin: r.asin,
    title: r.title,
    image: r.thumbnail,
    price_value: toNumber(r.extracted_price ?? r.price),
    rating: r.rating,
    reviews: r.reviews,
  }));
  return { items: normalize(list), hasMore: Boolean(j.serpapi_pagination && j.serpapi_pagination.next) || list.length >= 16 };
}

async function viaAmazonScraper(key, { q, page, sort }) {
  const u = new URL('https://api.amazonscraperapi.com/api/v1/amazon/search');
  u.searchParams.set('query', q);
  u.searchParams.set('domain', 'de');
  u.searchParams.set('sort_by', SORTS[sort].asa);
  u.searchParams.set('start_page', String(page));
  u.searchParams.set('api_key', key);
  const res = await fetch(u, { headers: { accept: 'application/json' } });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`amazonscraperapi: ${j.error || j.message || res.status}`);
  const list = (j.products || []).map((r) => ({
    asin: r.asin,
    title: r.title,
    image: r.image,
    price_value: toNumber(r.price),
    rating: r.rating,
    reviews: r.reviews_count,
  }));
  return { items: normalize(list), hasMore: list.length >= 16 };
}

export function searchConfigured(env) {
  return Boolean(env.SERPAPI_KEY || env.AMAZONSCRAPER_KEY || env.SEARCH_MOCK);
}

export async function amazonSearch(env, params) {
  const q = String(params.q || '').trim().slice(0, 120);
  if (!q) throw new Error('Bitte einen Suchbegriff eingeben.');
  const page = Math.min(Math.max(parseInt(params.page, 10) || 1, 1), 5);
  const sort = SORTS[params.sort] ? params.sort : 'relevance';
  const min = params.min != null && params.min !== '' && +params.min > 0 ? Math.floor(+params.min) : null;
  const max = params.max != null && params.max !== '' && +params.max > 0 ? Math.ceil(+params.max) : null;
  const args = { q, page, sort, min, max };

  const key = `amazon|${q.toLowerCase()}|${page}|${sort}|${min ?? ''}|${max ?? ''}`;
  const cached = await env.DB.prepare('SELECT data, created_at FROM search_cache WHERE key = ?').bind(key).first();
  if (cached && Date.now() - cached.created_at < CACHE_TTL_MS) {
    return { ...JSON.parse(cached.data), cached: true };
  }

  const providers = [];
  if (env.SEARCH_MOCK) providers.push(['mock', async () => mockSearch(args, env.SEARCH_MOCK)]);
  if (env.SERPAPI_KEY) providers.push(['serpapi', () => viaSerpApi(env.SERPAPI_KEY, args)]);
  if (env.AMAZONSCRAPER_KEY) providers.push(['amazonscraperapi', () => viaAmazonScraper(env.AMAZONSCRAPER_KEY, args)]);
  if (!providers.length) throw new SearchUnavailable('Die Amazon-Suche ist noch nicht eingerichtet.');

  let result = null;
  const errors = [];
  for (const [name, run] of providers) {
    try {
      result = { ...(await run()), source: name };
      break;
    } catch (e) {
      errors.push(e.message);
    }
  }
  if (!result) {
    console.error('Amazon-Suche fehlgeschlagen:', errors.join(' | '));
    const err = new SearchUnavailable('Die Amazon-Suche ist gerade nicht verfügbar, vermutlich ist das Gratis-Kontingent für diesen Monat aufgebraucht.');
    err.details = errors.map((m) => m.replace(/api_key=[^&\s]+/g, 'api_key=…').slice(0, 300));
    throw err;
  }

  // Preisfilter sicherheitshalber selbst anwenden (nicht jeder Dienst filtert)
  result.items = result.items.filter(
    (it) => it.price_value == null || ((min == null || it.price_value >= min) && (max == null || it.price_value <= max)),
  );

  const payload = { items: result.items, hasMore: result.hasMore, page, source: result.source };
  await env.DB.batch([
    env.DB.prepare('INSERT OR REPLACE INTO search_cache (key, data, created_at) VALUES (?, ?, ?)').bind(key, JSON.stringify(payload), Date.now()),
    env.DB.prepare('DELETE FROM search_cache WHERE created_at < ?').bind(Date.now() - CACHE_TTL_MS),
  ]);
  return payload;
}

// Vorschau für einen einzelnen Amazon-Artikel, wenn Amazon unseren Abruf blockt.
// Nutzt nur amazonscraperapi (größeres Gratis-Kontingent), Ergebnis wird ebenfalls gecacht.
export async function amazonProduct(env, asin) {
  if (!env.AMAZONSCRAPER_KEY || !/^[A-Z0-9]{10}$/.test(asin || '')) return null;
  const key = `product|${asin}`;
  const cached = await env.DB.prepare('SELECT data FROM search_cache WHERE key = ?').bind(key).first().catch(() => null);
  if (cached) return JSON.parse(cached.data);
  try {
    const u = new URL('https://api.amazonscraperapi.com/api/v1/amazon/product');
    u.searchParams.set('query', asin);
    u.searchParams.set('domain', 'de');
    u.searchParams.set('api_key', env.AMAZONSCRAPER_KEY);
    const res = await fetch(u, { headers: { accept: 'application/json' } });
    if (!res.ok) return null;
    const j = await res.json();
    const p = j.product || j.data || j;
    const images = p.images || p.image_urls || [];
    const out = {
      title: String(p.title || p.name || '').trim(),
      image: cleanImage(p.image || p.main_image || (Array.isArray(images) ? images[0] && (images[0].url || images[0]) : '') || ''),
      price: euro(toNumber(p.price ?? (p.pricing && p.pricing.price))),
    };
    if (out.title || out.image) {
      await env.DB.prepare('INSERT OR REPLACE INTO search_cache (key, data, created_at) VALUES (?, ?, ?)')
        .bind(key, JSON.stringify(out), Date.now())
        .run();
    }
    return out;
  } catch {
    return null;
  }
}

// Nur für lokales Testen (SEARCH_MOCK=<Bild-Basis-URL> in .dev.vars)
function mockSearch({ q, page }, base) {
  const pics = ['tea', 'book', 'socks', 'puzzle', 'mug', 'candle'];
  const list = Array.from({ length: 12 }, (_, i) => ({
    asin: `B0MOCK${String(page)}${String(i).padStart(3, '0')}`.slice(0, 10).padEnd(10, 'X'),
    title: `${q} – Beispielartikel ${(page - 1) * 12 + i + 1} mit einem etwas längeren Produkttitel, wie Amazon ihn mag`,
    image: `${base}/${pics[i % pics.length]}.svg`,
    price_value: 12 + ((i * 7) % 30) + 0.99,
    rating: 3.8 + (i % 12) / 10,
    reviews: 100 + i,
  }));
  return { items: normalize(list), hasMore: page < 3 };
}
