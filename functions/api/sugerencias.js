// Órbita TEA · /api/sugerencias
// POST: recibe una sugerencia/crítica de una app y la guarda en Cloudflare KV (binding FEEDBACK).
// GET ?t=<ADMIN_TOKEN>: lista lo recibido (solo para el dueño del sitio).

const APPS = ['gurises', 'mangiamo', 'nappy', 'tranquera', 'consultorio', 'comunicacion', 'sitio'];
const TIPOS = ['sugerencia', 'critica', 'problema'];
const MAX_MSG = 2000;
const MAX_CONTACTO = 120;
const LIMITE_HORA = 5;

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });

async function hash(texto) {
  const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(texto));
  return [...new Uint8Array(b)].slice(0, 8).map((x) => x.toString(16).padStart(2, '0')).join('');
}

export async function onRequestPost({ request, env }) {
  if (!env.FEEDBACK) return json({ ok: false, error: 'sin_almacenamiento' }, 503);

  let d;
  try { d = await request.json(); } catch { return json({ ok: false, error: 'formato' }, 400); }

  // Campo trampa para bots: si viene lleno, fingimos éxito y descartamos.
  if (d.web) return json({ ok: true });

  const app = String(d.app || '');
  const tipo = String(d.tipo || '');
  const mensaje = String(d.mensaje || '').trim();
  const contacto = String(d.contacto || '').trim().slice(0, MAX_CONTACTO);
  if (!APPS.includes(app) || !TIPOS.includes(tipo)) return json({ ok: false, error: 'datos' }, 400);
  if (mensaje.length < 5) return json({ ok: false, error: 'corto' }, 400);
  if (mensaje.length > MAX_MSG) return json({ ok: false, error: 'largo' }, 400);

  // Límite simple por IP (se guarda solo un hash, no la IP).
  const ip = request.headers.get('CF-Connecting-IP') || 'x';
  const clave = 'rl:' + (await hash(ip)) + ':' + new Date().toISOString().slice(0, 13);
  const usados = parseInt((await env.FEEDBACK.get(clave)) || '0', 10);
  if (usados >= LIMITE_HORA) return json({ ok: false, error: 'limite' }, 429);
  await env.FEEDBACK.put(clave, String(usados + 1), { expirationTtl: 7200 });

  const ahora = new Date().toISOString();
  const id = 's:' + ahora + ':' + crypto.randomUUID().slice(0, 6);
  await env.FEEDBACK.put(id, JSON.stringify({ fecha: ahora, app, tipo, mensaje, contacto }));
  return json({ ok: true });
}

export async function onRequestGet({ request, env }) {
  const t = new URL(request.url).searchParams.get('t');
  if (!env.ADMIN_TOKEN || !t || t !== env.ADMIN_TOKEN || !env.FEEDBACK) return json({ ok: false }, 404);
  const lista = await env.FEEDBACK.list({ prefix: 's:', limit: 1000 });
  const items = await Promise.all(lista.keys.map(async (k) => JSON.parse(await env.FEEDBACK.get(k.name))));
  items.sort((a, b) => (a.fecha < b.fecha ? 1 : -1));
  return json({ total: items.length, items });
}
