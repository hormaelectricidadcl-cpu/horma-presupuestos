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

## Sesión 20/08/2026 (continuación) — Rediseño de raíz, merge de pestañas, terminología, confianza en los datos

**Esta fue la parte más importante de la sesión — no parches, sino la causa raíz.** Alexandra notó que llevábamos ~2 horas en bucle arreglando síntomas del mismo problema y pidió explícitamente parar y rediseñar. Detalle completo del razonamiento en `decisiones.md` — acá el resumen de lo que quedó hecho:

- **"Falta por cobrar" dejó de mostrar dos números distintos en dos pestañas** (bug encontrado por Alexandra: Cuentas por cobrar y Obras daban cifras diferentes para la misma obra). Se agregó "Falta por cobrar" a la tarjeta de Obras, calculado exactamente igual que en Cuentas por cobrar.
- **Rediseño real de la causa raíz**: dos caminos independientes para cargar "el cliente pagó" (`obras.presupuesto_total`+`reportes_cobros` automático vs `cuentas_por_cobrar`+`abonos_cuenta` manual) sin ningún cruce entre ellos. Sin acceso a DDL desde acá (la API REST de Supabase no crea tablas), se migró Ohiggins y Luz 2979 al sistema manual (ya el más flexible) en vez de crear un esquema nuevo. `Reporte.tsx` ahora enruta cobros nuevos automático a la cuenta correcta cuando la obra tiene una sola cuenta, con aviso de posible duplicado antes de guardar (probado en vivo).
- **Se encontró y corrigió un cobro duplicado real de $2.000.000 en Luis Carrera 2700** — el mismo pago cargado dos veces (una como `reportes_cobros`, otra como 2 abonos de $1M) en la misma sesión de carga del 15/08. Verificado y corregido.
- **"Presupuesto" de una obra con cuentas ahora suma esas cuentas** en vez de usar un campo suelto que podía quedar desactualizado (pasó con Luis Carrera: mostraba $2.722.500 al lado de "Falta por cobrar $1.815.000" — contradictorio; el presupuesto real era $4.831.150).
- **Merge de "Obras" + "Cuentas por cobrar" en una sola pestaña** (pedido explícito de Alexandra: dos pestañas mostrando resúmenes de la misma obra confundía aunque los números coincidieran). `PanelCuentasPorCobrar` se eliminó del todo. El manejo de cuentas/abonos vive ahora dentro de "Detalle" de cada obra (soporta más de una cuenta por obra — Luis Carrera tiene 3). Cuentas sin obra (ej. "Visita Técnica") quedan en una sección aparte al final, no pestaña propia.
- **Terminología unificada a "Facturado"**: para Gustavo, cobrado/facturado/abonado son la misma cosa (plata que le dieron). "Cobrado"→"Facturado", "Falta por cobrar"→"Por facturar", "Abonado"/"Restante" en las cuentas también. Se eliminó la sección "Facturación formal" (tabla `facturas`) de Detalle porque competía con el mismo número usando la misma palabra para dos cosas distintas — los datos siguen en Supabase, solo se sacó de la interfaz.
- **Tarjeta de Obras reordenada como una historia** (pedido de Alexandra): Presupuesto → Facturado → Por facturar → Mano de obra → Compras → Subcontratos → Adelantos → Pagos semana → Saldo. "Presupuesto" ahora también es una card, no solo texto.
- **Ohiggins: se confirmó que el 5º cobro ($9.458.056, "Alejandra", 18/08) era duplicado** — Alexandra ya lo había avisado y, al no procesarse a tiempo, lo borró ella misma. Quedó documentada la lección: no dar una instrucción puntual por resuelta investigando algo parecido sin confirmar que es lo mismo.
- **Luz 2979: se migró su factura vieja ($4.733.671, tabla `facturas`) a abono real** — quedó huérfana al sacar la sección de Facturación formal. Verificado antes: Ohiggins tenía la misma plata en dos lados (no se tocó, migrarla habría duplicado); Luz 2979 no, era plata real sin cargar.
- **Conversación larga sobre seguridad de los datos** (Alexandra preguntó si esto es seguro, si necesita mantener Google Sheets, si puede ver todo en Supabase directo). Quedó claro: todo vive en Supabase (la app es solo una ventana), Sheets es un espejo de un solo sentido no un respaldo, Supabase tiene Table Editor para ver todo sin pasar por la app ni por mí, Power BI podría conectarse directo a Postgres como alternativa a Sheets. **Pendiente sin confirmar: si el proyecto tiene el plan Pro de Supabase con backups automáticos activados** — se ofreció revisarlo, no se llegó a hacer.

## Pendiente / hallazgo sin resolver
- **Confirmar el plan de Supabase (Free vs Pro) y si los backups automáticos están activos** — conversación de esta sesión, no verificado todavía. Prioridad alta dado que esto maneja plata real.
- No confirmado en vivo que `sync-compras.js`/`sync-cobros.js`/`sync-subcontratos.js` funcionen en producción — probar con una carga real y revisar la planilla.
- Falta el presupuesto real de "Doctora Eloísa (dirección 5843)" — pedírselo a Gustavo/Alexandra y cargarlo (recién ahí se puede migrar al sistema unificado).
- Anomalías de Google Sheets reportadas por Alexandra — pendientes de pasar y revisar en una sesión aparte (distinta fuente de verdad, distinta forma de verificar).
- Evaluar si Alexandra quiere una conexión de Power BI directa a Supabase (se lo ofrecí, sin decidir todavía).

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
