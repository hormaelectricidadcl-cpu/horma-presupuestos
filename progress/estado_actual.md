# Estado actual — Horma App
> Actualizar al terminar cada sesión de trabajo en este proyecto

## Última actualización: 14/08/2026

## Estado
Live en Cloudflare Pages (horma-presupuestos.pages.dev) — el `netlify.toml`/`netlify/functions` sigue en el repo pero el deploy real está en Cloudflare Pages, ojo con eso en sesiones futuras.
No se tocó `/api/parse` ni el modo IA de `ItemForm.tsx` — siguen en uso activo para presupuestos.

## Sesión 14/08/2026 — Reporte Diario de obra + puente a Google Sheets

- **Pantalla nueva `/reporte?t=TOKEN`** (`src/pages/Reporte.tsx`), mismo patrón de auth que `/g` y `/i`. Gustavo carga asistencia/obra/viático/adelanto por trabajador, compras, cobros, subcontratos y trabajos puntuales — reemplaza la interpretación manual de WhatsApp. Token: `VITE_REPORTE_TOKEN` (local `.env` y Cloudflare Pages).
- **Tablas nuevas en Supabase** (`sql/reportes_diarios.sql`, `sql/subcontratos_y_trabajos_puntuales.sql`): `reportes_diarios`, `reportes_compras`, `reportes_cobros`, `reportes_subcontratos`, `reportes_trabajos_puntuales`. RLS abierto a `anon`, mismo modelo de confianza que `pendientes` (el control de acceso lo hace el token de la URL).
- **Regla de negocio importante:** el viático solo corresponde a la obra de Limache (Ohiggins 126) — los equipos en obras de Santiago no lo reciben. Implementado en `Reporte.tsx` (`viaticoPorObra`, se autocompleta al elegir la obra, pero queda editable por si hay excepciones).
- **Bug real corregido:** el checkbox de "Viático"/"Ausente hoy" no mostraba feedback visual al tocarlo (el reset global `.pendientes input { appearance: none }` en `styles.css` afectaba también a los checkboxes). Se agregó una regla específica para `input[type="checkbox"]` que restaura la apariencia nativa — esto también destraba los checkboxes de `Admin.tsx` que ya usaban `accentColor` sin efecto visible.
- **Puente automático a Google Sheets construido:** `functions/api/sync-horas.js` (Cloudflare Pages Function). Cuando Gustavo guarda el Reporte Diario, además de Supabase, escribe automáticamente en la hoja "Horas" de "Control de Obra - Horma" (upsert por fecha+trabajador, respeta las fórmulas de tarifa/viático existentes). Probado de punta a punta con datos de prueba, funcionando en producción.
  - Autenticación con **cuenta de servicio de Google** (`horma-sheets-sync@horma-hermes.iam.gserviceaccount.com`), no login personal — evita el problema de tokens que caducan cada 7 días (causa raíz de un bloqueo real esta sesión: el token OAuth de `D:\HORMA LAPTOP\horma_sistema\horma hermes\google_token.json` había expirado por estar la app de Google en modo "Testing").
  - Variables de entorno nuevas en Cloudflare Pages: `GOOGLE_SERVICE_ACCOUNT_JSON` (contenido completo del JSON de la cuenta de servicio) y `CONTROL_OBRA_SHEET_ID`.
  - JWT firmado con Web Crypto API (compatible con el runtime de Cloudflare Pages Functions, sin `crypto` de Node).
  - Alcance actual: solo la hoja "Horas". Compras/cobros/subcontratos capturados en la app **todavía no** se sincronizan a "Gasto en Materiales"/"Cobrado"/"Subcontratos" — pendiente si se necesita.
- **Backfill manual de datos reales:** se completaron miércoles 12/8 a viernes 14/8 en Supabase y en la hoja "Horas" (Gustavo no había usado la pantalla el miércoles, y el checkbox roto de viático dejó el viernes con viático en falso para todos — corregido).
- **Hallazgo pendiente de resolver (no bloqueante):** el nombre de obra "Doctora Eloísa - Obra 1" no es idéntico entre la app (`(dirección 5860)`) y la hoja "Obras"/"Horas" (`(dirección pendiente) — CONFIRMAR CON GUSTAVO`) — no rompe los cálculos (las fórmulas de Horas buscan por trabajador, no por obra), pero convendría unificarlo antes de confiar en hojas que sí agrupan por obra (ej. "Rentabilidad por Obra").
- **Hallazgo aparte, sin resolver:** `GUSTAVO_WHATSAPP`/`ALEXANDRA_WHATSAPP` en `.env` apuntan al teléfono viejo de la sociedad anterior (9 5143 9958) — puede ser el celular personal real de Gustavo (uso interno, no público) o un descuido; no se tocó, queda flag para confirmar con Alexandra.

## Cómo alimenta el flywheel
Demuestra capacidad técnica full-stack → credibilidad ante agencias España

## Próxima acción
- Unificar el nombre de "Doctora Eloísa - Obra 1" entre la app y la Google Sheet.
- Evaluar si se necesita sincronizar compras/cobros/subcontratos a sus hojas correspondientes.
- Confirmar con Alexandra si el teléfono viejo en `GUSTAVO_WHATSAPP`/`ALEXANDRA_WHATSAPP` sigue vigente.
