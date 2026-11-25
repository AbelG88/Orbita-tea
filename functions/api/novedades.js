// Órbita TEA · /api/novedades
// Junta novedades sobre autismo de fuentes confiables, arma título + copete,
// traduce al español lo que viene en inglés (Workers AI, binding "AI") y lo devuelve como JSON.
// El resultado se guarda 3 horas en KV (binding "FEEDBACK") para no recalcular en cada visita.
// Para agregar o sacar una fuente RSS, editar la lista FEEDS.

const FEEDS = [
  { fuente: 'The Transmitter', url: 'https://www.thetransmitter.org/feed/', lang: 'en', filtro: /autis/i },
  { fuente: 'ScienceDaily', url: 'https://www.sciencedaily.com/rss/mind_brain/autism.xml', lang: 'en', filtro: /autis/i },
  { fuente: 'Autismo España', url: 'https://autismo.org.es/feed/', lang: 'es' },
  { fuente: 'News-Medical', url: 'https://www.news-medical.net/tag/feed/Autism.aspx', lang: 'en' },
  { fuente: 'Autism Research (revista)', url: 'https://onlinelibrary.wiley.com/feed/19393806/most-recent', lang: 'en' },
];

// Revisiones sistemáticas recientes con "autism" en el título (trae el resumen).
const EUROPE_PMC =
  'https://www.ebi.ac.uk/europepmc/webservices/rest/search?format=json&pageSize=6&resultType=core&query=' +
  encodeURIComponent('(TITLE:autism OR TITLE:autistic) AND PUB_TYPE:"systematic review" sort_date:y');

// Estudios originales recientes de acceso abierto (ensayos y trabajos con resumen).
const EUROPE_PMC_ESTUDIOS =
  'https://www.ebi.ac.uk/europepmc/webservices/rest/search?format=json&pageSize=8&resultType=core&query=' +
  encodeURIComponent('(TITLE:autism OR TITLE:autistic) AND OPEN_ACCESS:y AND HAS_ABSTRACT:y AND (PUB_TYPE:"randomized controlled trial" OR PUB_TYPE:"clinical trial" OR PUB_TYPE:"journal article") sort_date:y');

const POR_FUENTE = 5;
const MAX_POR_FUENTE = 3; // para que una sola fuente no ocupe todo el carrusel
const TOTAL = 12;
const CACHE_SEG = 3 * 60 * 60;
const COPETE_MAX = 220;
const MODELO = '@cf/meta/m2m100-1.2b';

function limpiar(s) {
  return (s || '')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'").replace(/&nbsp;/g, ' ')
    .replace(/&#8217;/g, '’').replace(/&#8230;|&hellip;/g, '…')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/\s+/g, ' ')
    .trim();
}

function copete(texto) {
  let t = limpiar(texto).replace(/\s*(The post|Read more|Continue reading).*$/i, '').trim();
  if (t.length <= COPETE_MAX) return t;
  const corte = t.slice(0, COPETE_MAX);
  const punto = Math.max(corte.lastIndexOf('. '), corte.lastIndexOf('? '));
  return punto > 80 ? corte.slice(0, punto + 1) : corte.replace(/\s+\S*$/, '') + '…';
}

function campo(bloque, nombre) {
  const m = bloque.match(new RegExp('<' + nombre + '[^>]*>([\\s\\S]*?)</' + nombre + '>', 'i'));
  return m ? m[1] : '';
}

function fechaISO(s) {
  const d = new Date(limpiar(s));
  return isNaN(d) ? '' : d.toISOString();
}

async function leerRSS(feed) {
  const r = await fetch(feed.url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; OrbitaTEA/1.0)', Accept: 'application/rss+xml, application/xml, text/xml, */*' },
    cf: { cacheTtl: CACHE_SEG, cacheEverything: true },
  });
  if (!r.ok) throw new Error(feed.fuente + ' ' + r.status);
  const xml = await r.text();
  const items = [];
  for (const m of xml.matchAll(/<item[\s>][\s\S]*?<\/item>/gi)) {
    const b = m[0];
    const titulo = limpiar(campo(b, 'title'));
    const url = limpiar(campo(b, 'link'));
    const desc = campo(b, 'description') || campo(b, 'content:encoded');
    if (!titulo || !/^https:\/\//.test(url)) continue;
    if (feed.filtro && !feed.filtro.test(titulo + ' ' + desc)) continue;
    items.push({
      titulo, copete: copete(desc), url,
      fecha: fechaISO(campo(b, 'pubDate') || campo(b, 'dc:date')),
      fuente: feed.fuente, lang: feed.lang,
    });
    if (items.length >= POR_FUENTE) break;
  }
  return items;
}

async function leerEuropePMC(url = EUROPE_PMC, etiqueta = 'Revisión sistemática') {
  const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; OrbitaTEA/1.0)', Accept: 'application/json' }, cf: { cacheTtl: CACHE_SEG, cacheEverything: true } });
  if (!r.ok) throw new Error('Europe PMC ' + r.status);
  const d = await r.json();
  const lista = (d.resultList && d.resultList.result) || [];
  return lista
    .filter((x) => x.title && x.id && x.source)
    .slice(0, POR_FUENTE)
    .map((x) => ({
      titulo: limpiar(x.title).replace(/\.$/, ''),
      copete: copete(x.abstractText || ''),
      url: 'https://europepmc.org/article/' + x.source + '/' + x.id,
      fecha: fechaISO(x.firstPublicationDate || (x.pubYear ? x.pubYear + '-01-01' : '')),
      fuente: etiqueta + ' · ' + (x.journalTitle || (x.journalInfo && x.journalInfo.journal && x.journalInfo.journal.title) || 'Europe PMC'),
      lang: 'en',
    }));
}

async function sha(texto) {
  const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(texto));
  return [...new Uint8Array(b)].slice(0, 10).map((x) => x.toString(16).padStart(2, '0')).join('');
}

// Traduce un texto en->es; usa KV como caché para no repetir. Si falla, devuelve null.
async function traducir(texto, env) {
  if (!texto || !env.AI) return null;
  const clave = 'tr:' + (await sha(texto));
  if (env.FEEDBACK) {
    const guardado = await env.FEEDBACK.get(clave);
    if (guardado) return guardado;
  }
  try {
    const r = await env.AI.run(MODELO, { text: texto, source_lang: 'english', target_lang: 'spanish' });
    const t = r && r.translated_text ? String(r.translated_text).trim() : '';
    if (!t) return null;
    if (env.FEEDBACK) await env.FEEDBACK.put(clave, t, { expirationTtl: 60 * 60 * 24 * 60 });
    return t;
  } catch {
    return null;
  }
}

async function armar(env) {
  const res = await Promise.allSettled([leerEuropePMC(), leerEuropePMC(EUROPE_PMC_ESTUDIOS, 'Estudio'), ...FEEDS.map(leerRSS)]);
  let items = [];
  const errores = [];
  for (const r of res) {
    if (r.status === 'fulfilled') items.push(...r.value);
    else errores.push(String(r.reason && r.reason.message ? r.reason.message : r.reason));
  }
  const ahora = new Date().toISOString();
  items = items.filter((it) => !it.fecha || it.fecha <= ahora); // descarta fechas futuras (publicación electrónica anticipada)
  items.sort((a, b) => (a.fecha < b.fecha ? 1 : -1));
  const cuenta = {};
  items = items.filter((it) => {
    const k = it.fuente.split(' · ')[0];
    cuenta[k] = (cuenta[k] || 0) + 1;
    return cuenta[k] <= MAX_POR_FUENTE;
  }).slice(0, TOTAL);

  await Promise.all(
    items.map(async (it) => {
      if (it.lang === 'es') return;
      const [t, c] = await Promise.all([traducir(it.titulo, env), traducir(it.copete, env)]);
      if (t) { it.tituloOriginal = it.titulo; it.titulo = t; it.traducido = true; }
      if (c) { it.copete = c; it.traducido = true; }
    })
  );
  return { actualizado: new Date().toISOString(), items, errores, traduccion: !!env.AI };
}

export async function onRequestGet({ env }) {
  const CLAVE = 'cache:novedades';
  let data = null;
  if (env.FEEDBACK) {
    const g = await env.FEEDBACK.get(CLAVE, 'json');
    if (g && Date.now() - new Date(g.actualizado).getTime() < CACHE_SEG * 1000 && g.items && g.items.length) data = g;
  }
  if (!data) {
    data = await armar(env);
    if (env.FEEDBACK && data.items.length) await env.FEEDBACK.put(CLAVE, JSON.stringify(data), { expirationTtl: CACHE_SEG * 4 });
  }
  return new Response(JSON.stringify(data), {
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'public, max-age=600' },
  });
}
