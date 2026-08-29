# Tareas pendientes
> Estados: 🔲 pendiente · 🔄 en progreso · ✅ hecho (mover a estado_actual.md como resumen y borrar de acá cuando se confirme)
> Contexto del rediseño grande del 20/08 → ver decisiones.md.

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
