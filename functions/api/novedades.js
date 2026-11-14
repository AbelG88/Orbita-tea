// Órbita TEA · /api/novedades
// Cloudflare Pages Function: junta novedades sobre autismo de fuentes confiables
// y las devuelve como JSON. Se cachea 3 horas para no pedirle de más a las fuentes.
//
// Para agregar o sacar una fuente RSS, editar la lista FEEDS.

const FEEDS = [
  { fuente: 'The Transmitter', url: 'https://www.thetransmitter.org/feed/', filtro: /autis/i },
  { fuente: 'ScienceDaily', url: 'https://www.sciencedaily.com/rss/mind_brain/autism.xml' },
  { fuente: 'Autismo España', url: 'https://autismo.org.es/feed/' },
];

// Revisiones sistemáticas recientes con "autism" en el título.
const EUROPE_PMC =
  'https://www.ebi.ac.uk/europepmc/webservices/rest/search?format=json&pageSize=8&resultType=lite&query=' +
  encodeURIComponent('(TITLE:autism OR TITLE:autistic) AND PUB_TYPE:"systematic review" sort_date:y');

const POR_FUENTE = 5;
const TOTAL = 12;
const CACHE_SEG = 3 * 60 * 60;

function limpiar(s) {
  return (s || '')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/\s+/g, ' ')
    .trim();
}

function campo(bloque, nombre) {
  const m = bloque.match(new RegExp('<' + nombre + '[^>]*>([\\s\\S]*?)</' + nombre + '>', 'i'));
  return m ? limpiar(m[1]) : '';
}

async function leerRSS(feed) {
  const r = await fetch(feed.url, {
    headers: { 'User-Agent': 'OrbitaTEA/1.0 (+novedades)', Accept: 'application/rss+xml, application/xml, text/xml' },
    cf: { cacheTtl: CACHE_SEG, cacheEverything: true },
  });
  if (!r.ok) throw new Error(feed.fuente + ' ' + r.status);
  const xml = await r.text();
  const items = [];
  for (const m of xml.matchAll(/<item[\s>][\s\S]*?<\/item>/gi)) {
    const b = m[0];
    const titulo = campo(b, 'title');
    const url = campo(b, 'link');
    const fecha = campo(b, 'pubDate') || campo(b, 'dc:date');
    if (!titulo || !/^https:\/\//.test(url)) continue;
    if (feed.filtro && !feed.filtro.test(titulo + ' ' + campo(b, 'description'))) continue;
    items.push({ titulo, url, fecha: new Date(fecha).toISOString(), fuente: feed.fuente });
    if (items.length >= POR_FUENTE) break;
  }
  return items;
}

async function leerEuropePMC() {
  const r = await fetch(EUROPE_PMC, { cf: { cacheTtl: CACHE_SEG, cacheEverything: true } });
  if (!r.ok) throw new Error('Europe PMC ' + r.status);
  const d = await r.json();
  const lista = (d.resultList && d.resultList.result) || [];
  return lista
    .filter((x) => x.title && x.id && x.source)
    .slice(0, POR_FUENTE)
    .map((x) => ({
      titulo: limpiar(x.title).replace(/\.$/, ''),
      url: 'https://europepmc.org/article/' + x.source + '/' + x.id,
      fecha: new Date(x.firstPublicationDate || x.pubYear + '-01-01').toISOString(),
      fuente: 'Revisión sistemática · ' + (x.journalTitle || 'Europe PMC'),
    }));
}

export async function onRequestGet() {
  const tareas = [leerEuropePMC(), ...FEEDS.map(leerRSS)];
  const res = await Promise.allSettled(tareas);
  const items = [];
  const errores = [];
  for (const r of res) {
    if (r.status === 'fulfilled') items.push(...r.value);
    else errores.push(String(r.reason && r.reason.message ? r.reason.message : r.reason));
  }
  items.sort((a, b) => (a.fecha < b.fecha ? 1 : -1));
  return new Response(JSON.stringify({ actualizado: new Date().toISOString(), items: items.slice(0, TOTAL), errores }), {
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'public, max-age=' + CACHE_SEG,
    },
  });
}
