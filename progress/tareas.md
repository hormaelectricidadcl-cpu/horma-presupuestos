# Tareas pendientes

## ✅ "Convertir en obra" desde la ficha del cliente, 03/09/2026
A pedido de Alexandra usando el caso real de Alexis (obra nueva, ya depositó $350k): faltaba poder convertir un presupuesto aceptado en obra directo desde la ficha del cliente (antes solo se podía desde "Mis presupuestos"). Reusa `copiarItemsAObra` (función compartida, sin duplicar lógica de negocio) — solo agrega el botón + formulario inline en `PanelClientes`. **Probado de punta a punta con cliente/presupuesto/obra de prueba reales, creados y borrados sin dejar rastro:** confirmé en Supabase que la obra quedó con el `cliente_id` correcto heredado del presupuesto. `tsc` limpio.


## 🔲 Correr migración `sql/20260903_cliente_facturas_tipo.sql` — Fase 4 (parte 2), 03/09/2026
Cierra el gap E de la auditoría del 02/09: "Boleta" ahora tiene el mismo tratamiento que "Factura" (subir archivo, leer con IA vía `/api/parse-factura-emitida`, guardar en el historial del cliente) — se reusó la tabla `cliente_facturas` agregando una columna `tipo` ('factura'/'boleta') en vez de duplicar toda la tabla/UI. La ficha de cliente ahora dice "Facturas y boletas emitidas" con un badge por fila. **Falta correr la migración** (agrega la columna `tipo`, default 'factura' para no romper las filas ya cargadas). `tsc` limpio.

## ✅ Fase 4 (parte 1) del "orden" — fecha de agenda estructurada para Gustavo, 03/09/2026
Cerraba el gap C de la auditoría del 02/09: Gustavo no tenía forma de cargar una fecha real al confirmar una visita, solo texto libre que Alexandra tenía que leer y copiar a mano al campo `fecha_trabajo` para que "Agendar en Calendar" funcionara. Ahora, en un pendiente tipo "Confirmar visita", su panel (`/g`) muestra un campo "¿Cuándo se agenda?" (datetime-local) que al enviar la respuesta guarda `fecha_trabajo` directo — mismo criterio que ya usaba Admin.tsx para crear/editar pendientes. **Probado de punta a punta con un pendiente de prueba real** (creado y borrado sin dejar rastro): completé la fecha en el panel de Gustavo, confirmé en Supabase que `fecha_trabajo` quedó exacta (15:30 hora Chile = 18:30 UTC, coincide). `tsc` limpio.


## ✅ Fase 3 del "orden" — ficha del cliente como panel central, 03/09/2026
La ficha de cliente (Clientes → nombre) ahora muestra, cruzado por `cliente_id` real (no por nombre en texto), todo lo del cliente en un solo lugar: **Presupuestos** (fecha/estado/total), **Obra(s)** (nombre/estado/presupuesto), **Cuentas por cobrar** (concepto/obra/presupuesto/abonado/resta, sumando `abonos_cuenta`), y "Facturas emitidas" (de la Fase de facturas del 02/09) — todo de solo lectura, sin duplicar los botones de editar/borrar que ya existen en sus pestañas propias (Obras, Cuentas por cobrar, Mis presupuestos), a propósito para no mantener dos lugares con la misma lógica de guardado. **Probado en Vite local contra Constructora PSG (cliente real, con datos reales en las 3 tablas)** — 2 obras y 6 cuentas por cobrar aparecieron bien, y los 6 montos (presupuesto/abonado) se verificaron exactos contra una consulta SQL directa a `cuentas_por_cobrar`+`abonos_cuenta`. `tsc` limpio.

**Nota real encontrada de paso, no es un bug:** una de las cuentas de Constructora PSG ("Doctora Eloísa Días 5860") es sobre la misma dirección que la obra "Doctora Eloísa - Obra 1 (dirección 5860)", pero esa obra tiene como cliente a "Eloísa Díaz", no a Constructora PSG — son dos clientes reales distintos cruzándose en la misma dirección (probablemente Ignacio/Constructora PSG como contratista general pagando por trabajo en la propiedad de Eloísa Díaz). No se tocó nada de esto, solo queda documentado para que no sorprenda al verlo en la ficha.


## ✅ Fase 2 del "orden" — ítems del pendiente pasan directo a "Hacer presupuesto", 03/09/2026
Cerraba el gap A/B de la auditoría del 02/09: los ítems que la IA genera en el hilo de un pendiente (`generarItemsIA`, Admin.tsx) quedaban atrapados ahí, sin forma de pasar a un presupuesto real sin retipearlos. Ahora la tarjeta del pendiente tiene un botón nuevo "Usar en presupuesto →" (junto al viejo "Generar PDF", que se mantiene igual) que abre `Presupuesto.tsx` con `?desde_pendiente=<id>` — esa página, al cargar, trae los ítems y el nombre/dirección del cliente desde Supabase y los precarga en el formulario, con un aviso verde visible ("Ítems y cliente cargados desde el pendiente de X — revisa antes de generar el PDF"). Al guardar, usa el `cliente_id` real del pendiente en vez de re-resolverlo por nombre (evita el riesgo de duplicar cliente por una diferencia de tipeo, mismo problema de Patricia Marambio/Mga Abogados). **Probado en Vite local con un caso real (pendiente de Carlos Jara, 6 ítems reales) — cargó perfecto, sin errores de consola, nombre y los 6 ítems con categoría/cantidad/precio correctos.** `tsc` limpio. No se pudo probar el botón nuevo dentro de la tarjeta en Admin.tsx en vivo (login no corre en Vite local), pero apunta al mismo patrón de URL ya verificado a mano.


## ✅ Migración `sql/20260903_cliente_id_obras_cuentas.sql` corrida y verificada — Fase 1 del "orden", 03/09/2026
Alexandra pidió una limpieza de fondo: hoy `presupuestos`→`obras`→`cuentas_por_cobrar`→`facturas` solo se cruzan por el NOMBRE del cliente escrito como texto libre, sin ningún ID real — mismo problema de raíz que causó el caso Patricia Marambio/Mga Abogados. Fase 1 (de un plan en 4 fases, ver `decisiones.md` 2026-09-02/03): agrega `cliente_id` real a `obras` y `cuentas_por_cobrar`, y arregla el punto exacto donde se perdía (la conversión presupuesto→obra ya tenía `cliente_id` disponible pero solo copiaba el nombre — corregido en `PanelesObra.tsx`, dos caminos de conversión). Además se crearon los 4 clientes que faltaban en `clientes` (Constructora PSG, Eloísa Díaz, Cristian M, Nicole — la "puerta Gustavo", boca a boca, nunca tenía fichas propias) y se confirmó con Alexandra que "Ignacio" = "Constructora PSG" (misma persona). **Corrida por Alexandra y verificada contra Supabase real el mismo 03/09: las 7 obras y las 8 cuentas por cobrar quedaron con `cliente_id` correcto** (confirmado con un join `obras`/`cuentas_por_cobrar` → `clientes` mostrando el nombre real vía el ID, no solo el texto libre). `tsc` limpio. Fase 1 cerrada — sigue la Fase 2 (ver `decisiones.md`) cuando Alexandra confirme.

> Estados: 🔲 pendiente · 🔄 en progreso · ✅ hecho (mover a estado_actual.md como resumen y borrar de acá cuando se confirme)
> Contexto del rediseño grande del 20/08 → ver decisiones.md.

## ✅ Borrar pendiente duplicado de Patricia Marambio (emitir_factura) — resuelto antes del 02/09/2026
Confirmado contra Supabase el 02/09: ya solo queda 1 pendiente `emitir_factura` para Patricia Marambio (`c90334af...`, con el monto). El duplicado sin monto (`2fa1c38f...`) ya no existe — se resolvió entre sesiones.

## 🔲 Correr migración `sql/20260902_cliente_facturas.sql` — nueva tabla, 02/09/2026
Construido: al marcar "Respondido" un pendiente de tipo "Emitir factura" (Admin → Activos), ahora pide monto + archivo de la factura emitida y lo guarda en `cliente_facturas`, visible después en la sección nueva "Facturas emitidas" de la ficha del cliente. La pestaña "Facturas" existente (por obra, Facturado vs Cobrado) no se tocó — sigue siendo algo aparte, a propósito. **Falta correr la migración en el SQL Editor de Supabase antes de que esto funcione en producción.** El flujo de subida de archivo (Cloudflare/Admin.tsx) no se pudo probar en vivo desde acá por el límite de siempre (login vía Cloudflare Function) — sí se probó la sección "Facturas emitidas" de la ficha de cliente contra el panel de Gustavo (Vite local), vacía y sin romper nada.

**De paso, mientras se armaba esto, se encontró y corrigió un problema real de datos (verificado y arreglado contra Supabase, no solo detectado):** el bloque "CLIENTE" con RUT/razón social/giro/dirección que se ve en la tarjeta de "Emitir factura" de Patricia Marambio nunca estuvo guardado en su ficha real — era solo texto suelto del mensaje del pendiente. Además existía una segunda ficha de cliente duplicada y vacía, "Mga abogados ltda" (creada el mismo 02/09, sin ningún historial). Con el ok de Alexandra: se copiaron esos datos fiscales a la ficha real de Patricia Marambio (confirmado en Supabase), se borró la ficha duplicada vacía, y se la desarchivó (había quedado archivada como cliente pese a tener un pendiente real sin resolver — no relacionado con la migración de "Archivar todos los 'Listo'" del 01/09, que es sobre `pendientes`, no sobre `clientes`).

## 🔲 Borrar cobro real de $700 (error de tipeo), obra Camino turístico 11474, 01/09/2026
`reportes_cobros` id `456af00b-cbd6-433d-94f5-5358d62441d0`, fecha 29/08/2026, cliente "Francisca", monto $700 — le faltaban tres ceros (debía ser $700.000). Gustavo ya cargó el monto correcto como fila nueva el 01/09, pero la fila mala nunca se borró, así que "Facturado" en esa obra queda $700 de más. Se puede borrar desde Reporte Diario → fecha 29/08/2026 → Cobros del día → "✕ Quitar". Sin confirmar/ejecutar todavía.

## 🔲 Probar en producción: Archivar todos los "Listo" (Admin → Gustavo), 01/09/2026
Feature nueva construida hoy (migración `sql/20260901_pendientes_archivado.sql`, ya corrida) para sacar ~35 clientes viejos de la vista "Gustavo" sin borrar nada. No se pudo probar en vivo desde acá (Admin.tsx no corre en Vite local). Confirmar que el botón funciona y que Patricia Marambio (el único activo real) no queda archivada por error.

## 🔲 Archivar a Alejandro — confirmado 28/08/2026 que ya no trabaja con Horma
Gustavo confirmó que Alejandro ya no trabaja con ellos. Se ofreció archivarlo desde la card de Trabajadores (botón "Archivar" ya existe, mismo criterio que otros trabajadores que dejaron de estar activos — su historial de pagos pasado no se toca, solo deja de aparecer en la asistencia diaria). Quedó sin hacer al cierre de la sesión del 28/08 — confirmar con Alexandra si ya lo hizo ella o si hace falta hacerlo.

## 🔴 URGENTE — Seguridad de fondo, conversación iniciada 28/08/2026 (ver `estado_actual.md` para el detalle completo)
Alexandra preguntó directamente si "con Supabase estamos seguros" es cierto. Verificado en vivo, no de memoria: casi todas las tablas del negocio tienen política RLS `"anon full access"` (lectura/escritura total para cualquiera con la clave pública del proyecto, sin login real). No es que la plataforma sea insegura — es que la configuración actual de esta app no tiene una barrera real más allá de que nadie busque la clave. Orden acordado para resolver, sin tocar nada todavía salvo lo que ya se cerró:
1. **Confirmar backups automáticos de Supabase — RESUELTO (28/08/2026), y la respuesta es mala: NO hay backups.** Alexandra confirmó en el dashboard que el proyecto está en plan **Free** (spend cap activado, sin tarjeta cargada) — el plan Free de Supabase no incluye ningún backup automático (ni diario, ni point-in-time recovery, eso arranca en Pro). Si algo se borra/corrompe hoy, no hay forma de recuperarlo. **Decisión tomada: pasan a plan Pro el 2 de septiembre de 2026**, cuando les paguen a ellos — resuelve backups (diarios, 7 días) y storage (100 GB en vez de 1 GB). Hasta esa fecha, el riesgo de "sin red de contención" sigue activo — extremar cuidado con cualquier operación destructiva contra Supabase hasta entonces.
2. **Cerrar el `list` público del bucket `audio-notas`** (mantener la lectura pública de un archivo puntual, que la app necesita) — propuesto, todavía sin hacer, esperando el ok de Alexandra.
3. Conversación aparte sobre reemplazar "anon full access" por control de acceso real — cambio de fondo, no se toca sin plan y sin hablarlo primero con Alexandra/Gustavo.

## 🔲 Storage de Supabase — plan Free, 1 GB de límite, confirmado 28/08/2026
Confirmado contra Supabase real: bucket `audio-notas` ya tenía 119 MB / 84 archivos antes de que Fabriel/Misael empezaran a subir fotos seguido desde `/obra-fotos`. En plan Free (1 GB), el proyecto entero puede quedar sin responder o en modo solo-lectura si se llena — no es solo "se pierden las fotos nuevas". Se resuelve solo al pasar a Pro (100 GB) el 2/09 — ver punto 1 de arriba, no hace falta nada más hasta esa fecha salvo estar atento.

**Pedido de Alexandra para cuando una obra se cierre y el contenido ya esté documentado:** poder descargar todas las fotos/videos de esa obra de una sola vez (a un pendrive) y después borrarlas de Supabase para liberar espacio — no quiere hacerlo foto por foto con el botón "Descargar" actual. **Sin construir todavía**, dos cosas a resolver antes de poder hacerlo:
- **Descarga masiva ("todo en un zip"):** hoy no existe, solo descarga individual por foto en "Banco de contenido". Se puede armar del lado del cliente (juntar las URLs de la obra y empaquetarlas), sin necesitar una Cloudflare Function nueva.
- **Borrado masivo — bloqueado hoy a propósito:** confirmado contra Supabase real (`pg_policies` de `storage.objects`) que el bucket `audio-notas` **solo tiene políticas de `SELECT` e `INSERT` para `anon`, no `DELETE`** — ni la app ni nadie puede borrar archivos del bucket con la clave que usa el frontend hoy. Para que el borrado funcione haría falta agregar una política `DELETE` para `anon` (mismo patrón "anon full access" que ya usa el resto de la app) — pero eso agranda justo el hueco de seguridad del punto 1 de arriba (cualquiera con la clave podría borrar todo el banco de contenido, no solo Alexandra). **Antes de construir esto, decidir con Alexandra:** ¿el borrado se hace desde el panel de Admin/Gustavo con confirmación explícita (aceptable incluso con "anon full access", mismo criterio que ya se usa para borrar obras/clientes), o conviene esperar a la conversación grande de "control de acceso real" (punto 3 de seguridad) antes de sumar una acción destructiva nueva sobre Storage?

Ya no hace falta el ítem viejo "Confirmar plan de Supabase (backups automáticos)" por separado — queda reemplazado por el punto 1 de arriba. El ítem de RLS deshabilitado en `notas_rapidas`/`tareas_clientes`/`seo_*` sigue aparte más abajo — es un hallazgo distinto (tablas con RLS completamente apagado, no el patrón "anon full access" de este bloque).

## 🔲 Avance de obra (carta Gantt) — seguimiento pendiente, 28/08/2026
Funcionalidad grande construida en la sesión del 28/08 (detalle completo en `estado_actual.md`, sección "Sesión 28/08/2026 (continuación 2)"). Pendiente real:
- ~~Correr `sql/20260828_obra_avance_registros.sql`~~ — **hecho (28/08/2026)**, Alexandra la corrió y se verificó el trigger de punta a punta contra Supabase real (insert/delete de prueba: 0→12→0). Pusheado a `main` (`c93036c`).
- **Correr `sql/20260828_trabajadores_obra_asignada.sql`** — sin esto, asignar obra a Fabriel/Misael desde Trabajadores falla (degradado bien, no rompe nada).
- Confirmar con más casos reales que la IA de "presupuesto externo" lee bien el desglose de ítems (solo se probó con un PDF, salió perfecto — falta ver si es consistente).
- Probar la vista semanal tipo Gantt con una obra real que tenga fases con fecha de inicio y fin cargadas de punta a punta (solo se probó con datos puntuales).
- Confirmar en producción que el rediseño de Admin.tsx (fondo oscuro, íconos) se ve bien — nunca se pudo probar en vivo por el login de Cloudflare.
- Borrar a mano (opcional) el registro huérfano en `clientes` ("Familia Rojas Test2") de una prueba de esta sesión.

## ✅ Lote de 11 puntos — pruebas reales de Alexandra y Gustavo, 27/08/2026
Los 11 puntos quedaron construidos y verificados el 27/08/2026 (detalle completo de causa raíz y verificación en `estado_actual.md`, sección "Sesión 27/08/2026"). **Commiteado y pusheado a `main` (`75888db`).** `sql/20260827_trabajadores_activo.sql` ya corrida por Alexandra el mismo día. Pendiente real que queda:
- Probar Archivar/Reactivar en la card de Trabajadores con un trabajador real (la migración ya está corrida, agregar ya se había probado antes).
- Confirmar en producción que la IA lee bien el monto de comprobantes de abono y de presupuestos externos (Cloudflare Functions, no probables en local) — especialmente el caso PDF del presupuesto externo, que usa un tipo de contenido (`input_file`) distinto al de las boletas y no se pudo verificar contra la API real de OpenAI.
- Confirmar en un iPhone real que el PDF ahora se puede seleccionar en "Cargar presupuesto externo".
- Convertir de nuevo el presupuesto real de "Gustavo Castillo" en obra (quedó a propósito sin tocar, ver `estado_actual.md`).

Resuelto en la misma conversación, sin código: (11) los links de Fabriel/Misael son los que ya estaban anotados en la sesión del 26/08 — `https://horma-presupuestos.pages.dev/obra-fotos?t=55165640daf27c94` (Fabriel) y `...?t=55cecd957fcf3736` (Misael). Si no funcionan, falta confirmar que las variables `VITE_FABRIEL_TOKEN`/`VITE_MISAEL_TOKEN` estén cargadas en Cloudflare Pages con redeploy hecho (mismo bug que ya pasó una vez con `VITE_PRESUPUESTO_TOKEN`).

## 🔲 Verificar en producción el sync nuevo a Google Sheets
`sync-compras.js` / `sync-cobros.js` / `sync-subcontratos.js` (creadas 20/08) no se pudieron probar en local (sin wrangler/pages dev). Falta: que alguien cargue un reporte diario real después del deploy y confirme en la planilla "Control de Obra - Horma" que las filas nuevas aparecieron bien (incluida la fila espejo en "Asignación Materiales" para compras).

## 🔲 Falta el presupuesto real de "Doctora Eloísa (dirección 5843)"
Está "sin definir" en el sistema — no se puede inventar el número, hay que pedírselo a Gustavo/Alexandra y cargarlo con el botón "✎ editar" en la pestaña Obras. Una vez cargado, migrarla al sistema unificado de cuentas (igual que se hizo con Ohiggins/Luz 2979: crear cuenta, pasar el cobro de $233.750 a abono, verificar suma, borrar la fila vieja de `reportes_cobros`).

## 🔲 Seguridad Supabase — RLS deshabilitado
7 tablas sin RLS. `notas_rapidas` y `tareas_clientes` SÍ son de esta app — activar RLS con política `anon` `using(true)` es seguro y bajo riesgo (no cambia el nivel real de exposición). Las 5 tablas `seo_*` NO son de esta app (comparten la misma base de datos con otra herramienta de Alexandra) — necesitan que ella decida qué hacer antes de tocarlas. Ver memoria `project_horma_app_stakes` para el detalle completo y el SQL de remediación.

## 🔲 Confirmar teléfono en variables de entorno
`GUSTAVO_WHATSAPP`/`ALEXANDRA_WHATSAPP` en `.env` apuntan al teléfono viejo de la sociedad anterior (9 5143 9958) — puede ser el celular personal real de Gustavo (uso interno) o un descuido. Sin confirmar desde el 14/08.

## 🔲 Unificar nombre de "Doctora Eloísa - Obra 1"
No es idéntico entre la app (`dirección 5860`) y la hoja "Obras"/"Horas" de Sheets (`dirección pendiente`). No rompe cálculos hoy (las fórmulas de Horas buscan por trabajador, no por obra) pero conviene unificar antes de confiar en hojas que sí agrupan por obra.

## 🔲 Anomalías de Google Sheets (Alexandra las va a pasar en otra sesión)
Distinta fuente de verdad, distinta forma de verificar — se decidió tratarlas aparte de las anomalías de Supabase/la app que se resolvieron el 20/08.

## 🔲 (Opcional, sin decidir) Conexión de Power BI directa a Supabase
Se conversó el 20/08 como alternativa a Google Sheets — Power BI puede conectarse directo a Postgres en modo lectura, sin el riesgo de "dos copias que se desincronizan" que tuvo el sync a Sheets. Ofrecido, no decidido.
