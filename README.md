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
