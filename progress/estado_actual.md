# Estado actual — Horma App
> Actualizar al terminar cada sesión de trabajo en este proyecto

## Última actualización: 20/08/2026

## Sesión 20/08/2026 — Pago semanal, Cuentas por cobrar unificadas, sync Sheets ampliado

- **Refactor grande de la sesión del 18/08 (12+ commits) por fin committeado y pusheado** — llevaba 2 días solo en el disco local. Causa del bloqueo de push: Windows tenía 3 cuentas de GitHub cacheadas y usaba por defecto la incorrecta (`alexandra-albarracin`, sin permiso); se resolvió apuntando el remote a `hormaelectricidadcl-cpu` explícitamente.
- **Pestaña nueva "Pago semanal"** (`PanelPagoSemanal` en `PanelesObra.tsx`, en Admin y Gustavo): tabla Nombre/Días/Ganado/Viático/Total por trabajador, cruzando todas las obras, con selector de semana y auto-refresco cada 20s. Fabriel (sueldo fijo, sin tarifa diaria) se marca aparte, solo se le calcula viático. Verificado contra Supabase con datos reales.
- **Cuentas por cobrar dividida en Pendientes/Cobradas** (calculado, no manual — se autocorrige si se agrega o quita un abono). Verificado: las 2 pendientes reales (Doctora Eloísa 5860 $450.000, Luis Carrera $1.815.000) coinciden exacto con lo que Gustavo reportó por WhatsApp el 17/08.
- **Cuentas por cobrar unificada con las obras de presupuesto fijo**: Ohiggins 126 Limache y Luz 2979 se rastreaban solo en la pestaña Obras (nunca tuvieron una cuenta manual cargada) — ahora también aparecen ahí, de solo lectura, sin duplicar.
- **Reconciliación completa contra el WhatsApp de Gustavo del 17/08**: todo lo que dijo ya estaba correctamente cargado en Supabase — no había ningún dato faltante, el problema era solo de visibilidad (dos sistemas de cuentas por cobrar separados que no se mostraban juntos).
- **Sync a Google Sheets ampliado más allá de "Horas"**: 3 funciones nuevas (`sync-compras.js`, `sync-cobros.js`, `sync-subcontratos.js`, mismo patrón que `sync-horas.js`), todas solo-agregar (nunca borran/pisan filas — la planilla tiene entradas manuales viejas con columnas completadas a mano). `sync-compras.js` escribe en dos hojas a la vez (`Gasto en Materiales` + `Asignación Materiales`) porque la columna "Sobrante" de la primera depende de una fila espejo en la segunda vía SUMIF por Factura N° — sin eso, cualquier compra nueva se vería como material sin asignar. **No se pudo probar en vivo** (no hay wrangler/pages dev, solo vite) — pendiente que alguien cargue un reporte real y confirme que la fila aparece en la planilla.
- **Backfill manual ya hecho esta sesión** (vía MCP de Google Sheets, verificado): 4 compras (14–19/08) y 5 cobros de Ohiggins (17–18/08) que faltaban en la planilla desde antes de que existieran las funciones de sync.
- **Arnés del proyecto construido** (antes solo existía `CLAUDE.md` desactualizado + `estado_actual.md`): `CLAUDE.md` reescrito con las reglas reales (verificación, límites conocidos, dinero real), `progress/decisiones.md` y `progress/tareas.md` nuevos, `agents/estratega.md`/`constructor.md`/`revisor.md` nuevos (adaptados de `E:\ALEXANDRA TRABAJO`, con la regla extra de verificar contra Supabase antes de aprobar cualquier cambio de dinero), `init.sh` nuevo — probado en vivo, corre `tsc --noEmit` de verdad además de chequear que los archivos existan. Exit code 0 confirmado.
- **8 anomalías reportadas por Alexandra en la pestaña Obras, todas revisadas contra Supabase y resueltas:**
  1. Bug real y el más serio de la tanda: **"Cobrado"/"Saldo" de una obra ignoraba la plata cargada vía el sistema manual de cuentas_por_cobrar.** Doctora Eloísa 5860 mostraba Cobrado $0 / Saldo -$753.528 cuando en realidad hay $7.050.000 cobrados y el saldo real es +$6.296.472. Corregido y verificado exacto.
  2. **`PanelObras` estaba duplicado** — versión completa en Gustavo.tsx, versión vieja/recortada embebida en Admin.tsx (sin Nueva obra/editar cliente/facturado). Se extrajo a `PanelesObra.tsx` compartido — cierra el pendiente abierto desde el 18/08.
  3. **Obras "En curso"/"Culminadas" nuevo** (reutiliza `obras.activa`, ver decisiones.md) con botón para marcar/reactivar. Solo se marcó Renato Sanchez como culminada (confirmado $0 pendiente); Luis Carrera 2700 sigue en curso porque su cuenta real todavía debe $1.815.000 — la premisa de que "ya se pagó completo" no coincidía con los datos, quedó aclarado.
  4. Cuentas por cobrar (obras): agregado Facturado/Por facturar, y ya no filtra por `activa` (una obra culminada puede seguir debiendo plata).
  5. Estado de Resultados: el selector de obra no leía la tabla `obras` ni `cuentas_por_cobrar`, le faltaban Renato Sanchez y Luz 2979. Corregido.
  6. Guía "¿Cómo se lee esto?": se agregaron los pasos de Facturado/Por facturar (faltaban) y se aclaró que Saldo es posición de caja, no lo mismo que "cuánto falta que pague el cliente".
  7. **Sin resolver, no es un bug:** a "Doctora Eloísa (dirección 5843)" le falta cargar su presupuesto total real — no se puede inventar el número, pendiente pedírselo a Gustavo.
  - Todo verificado en vivo contra Supabase (panel de Gustavo) antes de subir, `init.sh` corrido, tsc limpio.

## Pendiente / hallazgo sin resolver
- No confirmado en vivo que `sync-compras.js`/`sync-cobros.js`/`sync-subcontratos.js` funcionen en producción — probar con una carga real y revisar la planilla.
- Falta el presupuesto real de "Doctora Eloísa (dirección 5843)" — pedírselo a Gustavo/Alexandra y cargarlo.
- Anomalías de Google Sheets reportadas por Alexandra — pendientes de pasar y revisar en una sesión aparte (distinta fuente de verdad, distinta forma de verificar).

## Sesión anterior — 14/08/2026

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
