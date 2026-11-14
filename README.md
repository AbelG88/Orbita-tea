# Órbita TEA

Sitio que reúne las apps hechas para familias con chicos con autismo (TEA), con novedades de fuentes confiables.

- `index.html`: el sitio completo (HTML, CSS y JS en un solo archivo).
- `functions/api/novedades.js`: Cloudflare Pages Function que junta las novedades (RSS + Europe PMC) y las cachea 3 horas. Las fuentes se editan en la lista `FEEDS`.

## Publicación

Cloudflare Pages conectado a este repo: cada cambio en `main` se publica solo.

- Framework preset: **None**
- Build command: *(vacío)*
- Build output directory: `/`

## Probar en local

```
npx wrangler pages dev .
```

## Sugerencias (formulario "Tu opinión")

`functions/api/sugerencias.js` guarda los mensajes en Cloudflare KV. Configuración, una sola vez:

1. Workers & Pages → KV → Create namespace (por ejemplo `orbita-feedback`).
2. Proyecto de Pages → Settings → Bindings → Add → KV namespace: variable `FEEDBACK`, el namespace recién creado.
3. Settings → Variables and Secrets → agregar el secreto `ADMIN_TOKEN` (una clave larga que inventes).
4. Redeploy.

Para leer lo recibido: `https://TU-SITIO.pages.dev/api/sugerencias?t=TU_ADMIN_TOKEN`.
