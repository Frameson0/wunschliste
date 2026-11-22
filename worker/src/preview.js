// Holt Titel, Bild und Preis zu einem Produktlink.
// Reihenfolge: JSON-LD (Produktdaten) -> Shop-spezifisch (Amazon) -> OpenGraph/Meta -> <title>
// Wenn der Shop uns blockt, wird microlink.io als Ausweichlösung gefragt.

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

const ENTITIES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  auml: 'ä', ouml: 'ö', uuml: 'ü', Auml: 'Ä', Ouml: 'Ö', Uuml: 'Ü', szlig: 'ß',
  euro: '€', ndash: '–', mdash: '—', hellip: '…', laquo: '«', raquo: '»',
  bdquo: '„', ldquo: '“', rdquo: '”', lsquo: '‘', rsquo: '’', times: '×', reg: '®', trade: '™', copy: '©',
};

export function decodeEntities(str = '') {
  return str
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => safeChar(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => safeChar(parseInt(d, 10)))
    .replace(/&([a-z]+);/gi, (m, n) => (n in ENTITIES ? ENTITIES[n] : m));
}
function safeChar(code) {
  try { return String.fromCodePoint(code); } catch { return ''; }
}
const clean = (s) => decodeEntities(String(s || '')).replace(/\s+/g, ' ').trim();

export function normalizeUrl(raw) {
  let s = String(raw || '').trim();
  // Aus geteiltem Text ("Schau mal: https://...") nur den Link nehmen
  const m = s.match(/https?:\/\/\S+/i);
  if (m) s = m[0];
  else if (/^[\w.-]+\.[a-z]{2,}(\/|$)/i.test(s)) s = 'https://' + s;
  let u;
  try { u = new URL(s); } catch { return null; }
  if (!/^https?:$/.test(u.protocol)) return null;
  // Amazon-Links auf die kurze Produktadresse kürzen
  if (/(^|\.)amazon\.[a-z.]+$/i.test(u.hostname)) {
    const asin = u.pathname.match(/\/(?:dp|gp\/product|gp\/aw\/d|exec\/obidos\/asin)\/([A-Z0-9]{10})/i);
    if (asin) return `https://${u.hostname}/dp/${asin[1].toUpperCase()}`;
  }
  return u.toString();
}

function siteName(url) {
  try {
    const host = new URL(url).hostname.replace(/^www\./, '').replace(/^m\./, '');
    if (/amazon\./.test(host) || /^amzn\./.test(host)) return 'Amazon';
    if (/etsy\.com$/.test(host)) return 'Etsy';
    return host;
  } catch { return ''; }
}

function absolutize(src, base) {
  if (!src) return '';
  try { return new URL(clean(src), base).toString(); } catch { return ''; }
}

function formatPrice(amount, currency) {
  const n = typeof amount === 'number' ? amount : parseFloat(String(amount).replace(/[^\d.,]/g, '').replace(/\.(?=\d{3}\b)/g, '').replace(',', '.'));
  if (!isFinite(n) || n <= 0) return '';
  try {
    return new Intl.NumberFormat('de-DE', { style: 'currency', currency: currency || 'EUR' }).format(n);
  } catch {
    return `${n.toFixed(2).replace('.', ',')} ${currency || '€'}`;
  }
}

function parseMeta(html) {
  const meta = {};
  const tagRe = /<meta\s+[^>]*>/gi;
  const attrRe = /([a-zA-Z_:.-]+)\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'>]+))/g;
  let tag;
  while ((tag = tagRe.exec(html))) {
    const attrs = {};
    let a;
    attrRe.lastIndex = 0;
    while ((a = attrRe.exec(tag[0]))) attrs[a[1].toLowerCase()] = a[3] ?? a[4] ?? a[5] ?? '';
    const key = (attrs.property || attrs.name || attrs.itemprop || '').toLowerCase();
    if (key && attrs.content != null && !(key in meta)) meta[key] = attrs.content;
  }
  return meta;
}

function findProductLd(html) {
  const re = /<script[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  const found = [];
  const walk = (node) => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) return node.forEach(walk);
    const t = node['@type'];
    const types = Array.isArray(t) ? t : [t];
    if (types.some((x) => /^(Product|ProductGroup|IndividualProduct)$/i.test(String(x)))) found.push(node);
    if (node['@graph']) walk(node['@graph']);
  };
  while ((m = re.exec(html))) {
    try { walk(JSON.parse(m[1].trim())); } catch { /* kaputtes JSON-LD ignorieren */ }
  }
  const p = found[0];
  if (!p) return {};
  let image = p.image;
  if (Array.isArray(image)) image = image[0];
  if (image && typeof image === 'object') image = image.url || image.contentUrl;
  let offers = p.offers;
  if (Array.isArray(offers)) offers = offers[0];
  if (offers && offers.offers) offers = Array.isArray(offers.offers) ? offers.offers[0] : offers.offers;
  const amount = offers ? offers.price ?? offers.lowPrice : undefined;
  return {
    title: p.name,
    image,
    price: amount != null ? formatPrice(amount, offers.priceCurrency) : '',
  };
}

function amazonExtract(html) {
  const out = {};
  const t = html.match(/id="productTitle"[^>]*>([\s\S]*?)<\/span>/i);
  if (t) out.title = t[1];
  const hires = html.match(/data-old-hires="(https:[^"]+)"/i);
  const dyn = html.match(/data-a-dynamic-image="\{&quot;(https:[^&]+)&quot;/i);
  const hiResJson = html.match(/"hiRes":"(https:[^"]+)"/);
  const landing = html.match(/id="landingImage"[^>]*src="(https:[^"]+)"/i);
  out.image = (hires && hires[1]) || (hiResJson && hiResJson[1]) || (dyn && dyn[1]) || (landing && landing[1]) || '';
  const price = html.match(/<span class="a-offscreen">\s*([^<]*\d[^<]*)<\/span>/i);
  if (price) out.price = clean(price[1]);
  return out;
}

function looksBlocked(html, status) {
  if (status === 403 || status === 429 || status === 503) return true;
  return /validateCaptcha|Robot Check|api-services-support@amazon|captcha-delivery|datadome/i.test(html.slice(0, 20000));
}

async function microlink(url) {
  try {
    const r = await fetch(`https://api.microlink.io/?url=${encodeURIComponent(url)}`, {
      headers: { accept: 'application/json' },
    });
    if (!r.ok) return {};
    const j = await r.json();
    if (j.status !== 'success' || !j.data) return {};
    return { title: j.data.title || '', image: (j.data.image && j.data.image.url) || '' };
  } catch {
    return {};
  }
}

export async function fetchPreview(rawUrl) {
  const url = normalizeUrl(rawUrl);
  if (!url) throw new Error('Das sieht nicht nach einem Link aus. Bitte die komplette Adresse mit https:// einfügen.');

  let result = { url, title: '', image: '', price: '', site: siteName(url) };
  let html = '';
  let status = 0;
  let finalUrl = url;

  try {
    const res = await fetch(url, {
      redirect: 'follow',
      headers: {
        'User-Agent': UA,
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'de-DE,de;q=0.9,en;q=0.7',
      },
      cf: { cacheTtl: 3600 },
    });
    status = res.status;
    finalUrl = res.url || url;
    const type = res.headers.get('content-type') || '';
    if (type.includes('image/')) {
      return { ...result, image: finalUrl };
    }
    html = await res.text();
  } catch {
    // Netzwerkfehler -> unten Fallback
  }

  // Kurzlinks (amzn.eu/d/...) nach der Weiterleitung sauber kürzen
  const normalizedFinal = normalizeUrl(finalUrl);
  if (normalizedFinal && normalizedFinal !== url && /amazon\./i.test(normalizedFinal)) {
    result.url = normalizedFinal;
    result.site = siteName(normalizedFinal);
  }

  const blocked = !html || looksBlocked(html, status);
  if (!blocked) {
    const ld = findProductLd(html);
    const meta = parseMeta(html);
    const amz = /amazon\./i.test(finalUrl) ? amazonExtract(html) : {};
    const titleTag = (html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1];

    result.title = clean(ld.title || amz.title || meta['og:title'] || meta['twitter:title'] || titleTag || '');
    result.image = absolutize(
      ld.image || amz.image || meta['og:image'] || meta['og:image:url'] || meta['og:image:secure_url'] || meta['twitter:image'] || meta['twitter:image:src'] || meta.image || '',
      finalUrl,
    );
    result.price =
      ld.price ||
      amz.price ||
      formatPrice(meta['product:price:amount'] || meta['og:price:amount'] || meta['price'] || '', meta['product:price:currency'] || meta['og:price:currency'] || meta['pricecurrency']);
    if (meta['og:site_name'] && !/amazon|etsy/i.test(result.site)) result.site = clean(meta['og:site_name']);
  }

  if (!result.title || !result.image) {
    const ml = await microlink(result.url);
    result.title = result.title || clean(ml.title);
    result.image = result.image || ml.image || '';
  }

  // Amazon hängt gern " : Amazon.de: Küche, Haushalt & Wohnen" an
  result.title = result.title.replace(/\s*[:|–-]\s*Amazon\.[a-z.]+.*$/i, '').replace(/^Amazon\.[a-z.]+\s*:\s*/i, '').slice(0, 300);
  result.complete = Boolean(result.title && result.image);
  return result;
}
