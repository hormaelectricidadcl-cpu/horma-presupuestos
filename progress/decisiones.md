# Decisiones ya tomadas — no re-litigar
> Cada entrada: qué se decidió, por qué, y fecha. Si algo cambia, se agrega una entrada nueva con la fecha del cambio — no se borra la vieja.

## 2026-09-02/03 — Plan de "orden" en 4 fases: cliente_id como eje real, dos puertas de entrada conviven
Alexandra pidió orden de fondo después de encontrar el caso Patricia Marambio/Mga Abogados: presupuestos, obras, cuentas por cobrar y facturas hoy solo se cruzan por el NOMBRE del cliente escrito como texto libre, nunca por su `clientes.id` real — cada pantalla es una isla. Confirmó que hay DOS puertas de entrada legítimas y que no hace falta forzarlas a ser iguales: (1) la suya, marketing → pendiente con caso+fotos → chat con Gustavo → presupuesto; (2) la de Gustavo, boca a boca → directo a "Hacer presupuesto" sin pasar por un pendiente. Las dos ya convergen en la tabla `presupuestos` — ese es el punto de unificación real, no hace falta unificar la superficie.

Plan acordado, fase por fase (no re-litigar el orden sin volver a hablarlo):
1. **Fase 1 (en curso, 03/09):** `cliente_id` real en `obras` y `cuentas_por_cobrar` (antes solo `obras.cliente`/`cuentas_por_cobrar.pagador` en texto libre) + arreglar la conversión presupuesto→obra para que copie el `cliente_id` que el presupuesto ya tenía (se perdía justo ahí). Confirmado con Alexandra que **"Ignacio" (cuentas por cobrar) es la misma persona que "Constructora PSG" (obras)** — mismo cliente, dos nombres distintos por escribirse a mano en momentos distintos.
2. Fase 2: que los ítems que genera la IA en el hilo de un pendiente pasen con un botón directo a "Hacer presupuesto" ya precargados (hoy hay que retipearlos a mano, ver auditoría de flujo del 02/09).
3. Fase 3: la ficha del cliente (donde ya vive "Facturas emitidas") como panel central real — presupuesto/obra/cobros cruzados ahí por `cliente_id`.
4. Fase 4: fecha de agenda estructurada para que Gustavo la cargue directo (hoy solo la escribe como texto y Alexandra la copia a mano), y darle a "Boleta" el mismo tratamiento que ya tiene "Factura" (subir archivo, historial en la ficha del cliente).

Cada fase se cierra y se verifica contra Supabase real antes de arrancar la siguiente.

## 2026-09-01 — Procedimiento para "mover" un adelanto de sueldo fijo de un mes a otro
Caso real: Fabriel pidió que su adelanto de $100.000 (cargado 14/08) se descontara de
septiembre en vez de agosto, porque en agosto tuvo que pagar varias cosas. El sistema
agrupa cada adelanto por el mes de su `fecha` (no por cuándo se cargó) -- no existe un
campo para "editar" la fecha de un adelanto ya cargado. El procedimiento correcto es:
borrar el adelanto viejo (botón "✕" en la ficha del trabajador, dentro de la card del mes
correspondiente) y cargar uno nuevo con la fecha correcta desde Pago Semanal → trabajador
→ "+ Adelanto". Alexandra ya lo hizo una vez con este caso real, verificado con
comprobante subido y "✓ Coincide".

## 2026-09-01 — Comprobante del pago mensual de sueldo fijo usa una clave sintética
Para que Fabriel (y cualquier sueldo fijo futuro) pueda subir el comprobante de su pago
mensual grande (no solo los pedacitos de viático semanal), se reusó `ComprobanteCelda`
con `semana_key = "mensual-2026-08"` en vez de una semana real -- confirmado antes de
hacerlo que nada en el código parsea `pago_semanal_comprobantes.semana_key` como fecha
real (solo se usa como clave opaca de comparación). Si en el futuro alguien agrega lógica
que sí espere una fecha real ahí, tener esto en cuenta.

## 2026-09-01 — Pendientes viejos se archivan, no se borran (mismo patrón que trabajadores/clientes)
La pestaña "Gustavo" en Admin (pendientes ya respondidos) mezclaba ~35 clientes de hace
meses, todos ya marcados "Listo", con el único cliente activo real. Se agregó columna
`archivado` en `pendientes` (sql/20260901_pendientes_archivado.sql) siguiendo el mismo
criterio ya usado para trabajadores/clientes: nunca borrar el historial real, solo
sacarlo de la vista por defecto con un toggle "Ver archivados". Botón masivo "Archivar
todos los 'Listo'" para no tener que archivar cliente por cliente en una limpieza grande
-- usa `revisado_admin` (ya existía) como criterio de "ya terminado con este cliente".

## 2026-09-01 — Bug sistémico: fondo claro sin color de texto explícito queda invisible
Encontrado 4 veces en la misma sesión (modal de Detalle de obra, detalle de presupuesto,
historial de cliente en Admin, formulario de Nuevo/Editar pendiente): la app define
`color: var(--text-inverse)` (texto claro) a nivel de `.app`/`.pendientes` porque el
fondo por defecto es navy oscuro. Cualquier contenedor nuevo con fondo blanco/claro
(`var(--white)`, `var(--surface)`) que NO defina su propio `color: var(--text)` hereda
ese texto claro y queda invisible sobre su propio fondo claro. Causó al menos un
problema real (Alexandra cargó un pendiente duplicado porque no veía lo que tipeaba).
**Regla para no repetir esto:** cualquier `<div>`/`<form>` nuevo con `background: 'var(--white)'`
o `'var(--surface)'` tiene que llevar también `color: 'var(--text)'` explícito en el
mismo style, sin excepción -- no alcanza con que los textos internos lo tengan cada uno
por separado.

## 2026-08-31 — Regla de negocio: el sábado no lleva viático
Encontrado revisando por qué Henry y Manuel no cuadraban con lo transferido esa semana: a los dos les
faltaban $10.000 exactos cada uno (un viático) contra el neto calculado. Alexandra confirmó la causa: los
sábados trabajados NO llevan viático (a diferencia de lunes a viernes), y el Reporte Diario de esa semana
los había cargado con `viatico=true` igual que cualquier otro día. Corregido en Supabase (`viatico=false`
para Henry y Manuel, 29/08/2026) — con eso los 5 trabajadores de la semana 24-30/08 cuadraron exacto
contra las transferencias reales.

**Nada se cambió en el código todavía.** El formulario de Reporte Diario (`Reporte.tsx`) no sabe de esta
regla — el checkbox "Sin viático hoy" queda en el valor que haya dejado el día anterior, así que si un
sábado se carga sin sacarlo a mano, va a volver a pasar. Pendiente decidir con Alexandra/Gustavo si vale
la pena que el formulario desmarque viático automáticamente cuando la fecha elegida es sábado (o domingo),
o si prefieren seguir haciéndolo a mano y solo tener presente la regla.

## 2026-08-31 — Supabase pasó a plan Pro (antes de lo planeado)
Estaba anotado para el 2/09/2026 (cuando les paguen); Alexandra lo adelantó al 31/08 después de la
conversación de seguridad del 28/08, para tener backups automáticos cuanto antes. Confirmado por
Alexandra viendo el dashboard de Supabase (no verificable por MCP, que es solo lectura y no expone plan/
billing). Resuelve el punto más urgente de los tres de la conversación de seguridad ("¿un error o ataque
es recuperable?") — backups diarios con 7 días de retención, más el proyecto ya no se pausa por
inactividad. **Quedan sin tocar los otros dos puntos de esa conversación:** el bucket `audio-notas`
permite `list` público, y casi todas las tablas de negocio siguen con política `"anon full access"` (sin
login/token real). **CONFIRMADO el mismo 31/08:** Database → Backups muestra backups diarios desde el 26/08, el más
reciente del mismo día (31 ago 04:27 UTC) — funcionando sin intervención. **Ojo con una limitación real,
visible en esa misma pantalla:** los backups son solo de la base de datos (tablas), NO incluyen Storage
(fotos de obra, comprobantes, boletas, PDFs del bucket `audio-notas`) — restaurar un backup no recupera
un archivo borrado del bucket. Para plata/datos están cubiertos; para archivos adjuntos, sigue sin haber
red de contención más allá de no borrar nada del bucket sin cuidado.

## 2026-08-28 — Reporte Diario: NO vaciar el formulario tras guardar; compras ya guardadas se colapsan en su lugar
Alexandra pidió que, tras "Guardar reporte del día", el formulario quedara en blanco (como cualquier
formulario normal), para poder cargar varias boletas de compra seguidas sin confusión sobre si ya había
guardado o no. Se implementó así primero, pero se encontró un bug real antes de que causara daño en
producción: el guardado de compras/cobros/subcontratos/trabajos puntuales/uso de stock funciona
borrando TODO lo de esa fecha y reinsertando solo lo que hay en el formulario en ese momento — con el
formulario vacío, un segundo guardado el mismo día borraba lo guardado en el primero.

**Decisión final:** se revirtió el "formulario en blanco". En su lugar, cada compra que ya tiene `id`
(ya guardada) se muestra colapsada como una tarjeta chica ("✓ descripción — monto" + botón "Editar") en
vez del formulario completo — se colapsan solas al cargar el día (carga inicial o después de guardar).
"+ Agregar compra" siempre abre una fila nueva en blanco sin tocar las demás. Esto da la sensación de
"pantalla limpia, lista para lo próximo" que pedía Alexandra, sin tocar el mecanismo de guardado
(borrar-y-reinsertar) que ya está probado. Además, al guardar, la pantalla sube sola arriba de todo y
muestra un cartel verde grande de confirmación (7 segundos) — el cartel chico de antes, pegado cerca del
botón, no se notaba lo suficiente en el uso real.

**Por qué no se hizo el "formulario en blanco" bien (cambiando el guardado a upsert real por fila) en el
momento:** era un cambio más grande y riesgoso para hacer sobre la marcha en una sesión donde ya había
pasado un incidente real de escritura accidental (ver `feedback_interceptar_red_antes_de_probar_guardar`
en memoria) — se priorizó la solución más segura y suficiente sobre la más "ideal". Si en el futuro se
quiere reintentar el formulario en blanco de verdad, el prerrequisito técnico es cambiar compras/cobros/
subcontratos/trabajos puntuales/uso de stock de "borrar todo y reinsertar" a upsert real (insertar solo
lo nuevo, actualizar solo lo existente, borrar solo lo que se saca explícitamente con "Quitar" — de forma
inmediata, no a reconciliar al guardar).

**Regla para el futuro:** cuando la solución "correcta" a un pedido de UX requiere tocar un mecanismo de
guardado de datos financieros ya probado, y hay presión de tiempo o ya hubo un incidente en la misma
sesión, preferir la solución de menor riesgo que satisface el pedido real (acá: "que se vea limpio") por
sobre la arquitectónicamente más pura (acá: "vaciar de verdad") — y dejar la más grande documentada como
prerrequisito explícito para cuando se pueda hacer con más cuidado.

## 2026-08-28 — Bitácora de avance diario reemplaza el UPDATE directo de cantidad_completada
Alexandra pidió (viendo la vista de campo) que el avance quede fechado por día y por trabajador, para
tres usos: detectar atraso real vs. planificado y su costo en sueldos pagados de más, respaldo para
renegociar con clientes, y eventualmente bonos por terminar antes de lo estimado. Pidió explícitamente
que los trabajadores (Fabriel/Misael) puedan cargar avance con fecha pero NUNCA vean comparaciones
planificado-vs-real ni plata — eso es exclusivo de Gustavo/Alexandra.

**Decisión:** tabla nueva `obra_avance_registros` (obra_id, item_id, fecha, cantidad_avanzada [delta],
trabajador, nota) — append-only, corrección solo vía Gustavo/Alexandra insertando un ajuste. `obra_items.
cantidad_completada` deja de escribirse directo desde el frontend: pasa a ser un campo cacheado, mantenido
por un trigger de Postgres a partir de la suma de la bitácora (mismo mecanismo ya usado en el proyecto para
`materiales.stock_actual` desde `movimientos_stock`) — así nunca puede desincronizarse del historial real.
Fase 1: solo días de atraso/adelanto por fase (derivado de la bitácora vs. fechas planificadas de
`obra_fases`/`obras`), visible solo en el panel de gestión. Fase 2 (costo en plata) y fase 3 (reglas de
bono) quedan pendientes de definir con Alexandra — no son solo decisiones técnicas.

**Regla para el futuro:** cuando el pedido es "necesito saber cuándo pasó algo, no solo el estado actual",
la respuesta es una bitácora append-only con un trigger que deriva el campo cacheado que ya lee la UI —
no reescribir toda la UI existente para leer un JOIN+SUM en cada render.

## 2026-08-27 — Eliminar un trabajador = archivar, nunca borrar la fila
Al construir la card de Trabajadores (agregar/eliminar), se detectó que `pago_semanal_comprobantes`, `ajustes_pago_semanal` y `adelantos_trabajador` guardan al trabajador por **nombre** (texto), no por FK a `trabajadores.id`. Borrar la fila de `trabajadores` lo hubiera sacado también del selector de "Historial de pagos" (que lista trabajadores desde esa tabla) — su historial de pagos habría quedado inalcanzable desde la UI, aunque los datos siguieran en Supabase.

**Decisión (confirmada con Alexandra antes de construir):** "eliminar" = archivar (columna `activo` en `trabajadores`, migración `sql/20260827_trabajadores_activo.sql`), nunca un `DELETE`. Un trabajador archivado desaparece de Reporte Diario y Pago semanal (activos), pero su historial sigue disponible — "Historial de pagos" lista todos los trabajadores sin filtrar por `activo`. De paso, la lista de trabajadores de Reporte Diario (antes una constante hardcodeada `TRABAJADORES` en `Reporte.tsx`) pasó a cargarse en tiempo real desde `trabajadores` filtrando `activo=true`, para que archivar a alguien realmente lo saque del uso diario y no solo del cálculo de pago.

**Regla para el futuro:** mismo criterio que ya existía para `clientes.archivado` — cuando un registro tiene historial financiero referenciado por nombre/texto en otras tablas (no por FK), "eliminar" desde la UI significa archivar (ocultar de las vistas activas), nunca un `DELETE` real.

## 2026-08-25 — Convención de nombres para `sql/*.sql`, de acá en adelante
Alexandra pidió un sistema de nombres para no perderse entre migraciones. Desde esta fecha en adelante:

- **Nombre del archivo:** `YYYYMMDD_descripcion_corta.sql` (fecha de cuando se escribió, no de cuando se corre). Ej: `20260825_pendientes_cliente_id.sql`.
- **Nombre de la consulta guardada en el SQL Editor de Supabase: el mismo nombre, sin `.sql`.** Así el archivo del repo y lo que aparece en Supabase quedan sincronizados con un solo nombre — no hay que llevar dos sistemas en la cabeza.
- Se eligió fecha en vez de número correlativo (`001_`, `002_`...) porque no requiere que nadie recuerde "en qué número íbamos" entre sesiones — la fecha es autoevidente y ya está siempre disponible.
- **No se renombraron los archivos viejos** (`clientes.sql`, `presupuestos_migracion.sql`, etc.) — ya fueron corridos, renombrarlos no cambia nada funcional, sería solo cosmético. La convención aplica de acá en adelante, no retroactivo.

## 2026-08-25 — "Gustavo puede anotar sus propias cosas" se resuelve con notas, no con pendientes
Al diseñar la tarea 1.3, la primera idea (que Gustavo cree sus propios "pendientes") no encajaba: el sistema de pendientes es para cuando una persona le pide algo a la OTRA y espera respuesta (Gustavo solo ve pendientes con `destinatario='gustavo'`, los que Alexandra le asigna). Alexandra planteó el caso real en la conversación: a veces es ella quien tiene que comprar el material, a veces es Gustavo mismo — y lo que describió para el segundo caso ("que sea un pendiente para él mismo así no se le olvida, y lo marca como hecho") es un checklist autoasignado, no un pedido formal.

**Decisión:** se reusó `notas_rapidas` (ya existía, solo para Alexandra en /admin) en vez de forzar un nuevo valor de `destinatario`. Ahora tiene columna `autor` (`'alexandra'|'gustavo'`) y Gustavo tiene su propia pestaña "Mis notas" en `/g`, mismo componente compartido. El sistema de pendientes sigue existiendo sin tocar, para cuando sí hace falta que la OTRA persona actúe.

**Regla para el futuro:** cuando alguien pide "que X pueda crear/marcar algo para sí mismo", primero preguntar si es un checklist personal (notas) o un pedido a otra persona (pendientes) — son modelos de datos distintos, no la misma tabla con un campo más.

**De paso:** se encontró (advisor de Supabase, sesión 25/08) que `notas_rapidas` no tenía RLS habilitado en absoluto — quedó expuesta sin ninguna restricción a la anon key desde que se creó. Se cerró en la misma migración (`sql/notas_rapidas_gustavo.sql`) con el patrón `anon full access` ya usado en el resto de la app.

## 2026-08-25 — `presupuestos` se abre a `anon` igual que el resto de la app, y se le agrega `tipo` para distinguir simple/etapas
Al verificar el esquema real de `presupuestos` (tarea 0.2), sus políticas RLS solo cubrían el rol `authenticated` (heredado de que `PresupuestoEtapas.tsx` es el único que la usaba, con login real). Para que el presupuesto simple (`Presupuesto.tsx`, sin login, protegido solo por el token de URL) también pueda guardar, se agregó una policy `anon full access` — mismo modelo de confianza que ya usan `pendientes`/`obras`/`reportes_*`/`clientes` (el control de acceso real lo hace el token, no RLS). No es un precedente nuevo, es consistencia con lo ya decidido.

Como el presupuesto simple usa una lista plana de ítems (`Item[]`) y no la estructura de `etapas` (fases de PresupuestoEtapas.tsx), se agregó una columna `items` jsonb separada en vez de forzar una sola forma de datos, más una columna `tipo` (`'simple'|'etapas'`) para que Nivel 2.1 ("Mis presupuestos") pueda listar y renderizar ambos sin adivinar. También se agregó `referencia` (el ID `HRM-XXXXX` que ya se generaba pero solo vivía client-side) y `cliente_id` (FK real a `clientes`, siguiendo el principio de la propuesta de no usar texto suelto donde debería haber una referencia).

Migración en `sql/presupuestos_migracion.sql`, sin correr todavía — pendiente que Alexandra la pegue en el SQL Editor de Supabase.

## 2026-08-22 — Auditoría del arnés (harness engineering) — subagents migrados, punto de entrada consolidado, primer hook
Auditoría contra el checklist de `E:\ALEXANDRA TRABAJO\metodologia\harness_engineering.md` (Parte 3). Este proyecto ya tenía buena base (`CLAUDE.md` corto, `progress/`, `init.sh`) — los cambios fueron puntuales, no una reconstrucción:
- **`agents/*.md` (texto plano, Claude Code no los auto-descubría) migrados a `.claude/agents/estratega-horma.md` / `constructor-horma.md` / `revisor-horma.md`** con frontmatter YAML real. Los archivos viejos en `agents/` quedan marcados como archivados, apuntando a la ubicación nueva. `CLAUDE.md` e `init.sh` actualizados para referenciar la ubicación real.
- **`SISTEMA.md` y `TAREA_REPORTE_DIARIO.md` (raíz) marcados como archivados**, no borrados: ambos describían trabajo ya completado (`SISTEMA.md` además contradecía a `CLAUDE.md` diciendo que el deploy es Netlify, cuando el real es Cloudflare Pages) y podían competir como "punto de entrada" con `progress/`. Cada uno ahora tiene un banner al inicio apuntando a `CLAUDE.md` y `progress/estado_actual.md`.
- **Primer hook real del proyecto**: `.claude/hooks/check_git_push_account.py` (`PreToolUse` sobre `Bash`, matchea `git push`). Convierte en chequeo determinístico la regla que ya está en `CLAUDE.md` como texto ("git push puede fallar con 403 por cuenta de GitHub cacheada equivocada" — pasó de verdad el 20/08, bloqueó 12+ commits 2 días). Avisa si el remote `origin` no incluye `hormaelectricidadcl-cpu`; **fail-open, nunca bloquea** (exit 0 siempre, probado a mano con JSON válido/inválido, comando con y sin `git push`, remote correcto e incorrecto).
- No se tocó nada de `src/`, `functions/`, `sql/`, ni el resto de `CLAUDE.md` (ya pasaba la prueba de la línea — 40 líneas, todo específico del proyecto) ni `progress/decisiones.md`/`tareas.md` previos.

## 2026-08-20 — Rediseño: `cuentas_por_cobrar` pasa a ser la única fuente para obras con presupuesto definido
Causa raíz de casi todos los bugs de plata de hoy: dos caminos independientes para cargar "el cliente pagó" (automático vía `obras.presupuesto_total`+`reportes_cobros`, manual vía `cuentas_por_cobrar`+`abonos_cuenta`), sin ningún cruce entre ellos — de ahí el cobro duplicado de Luis Carrera y los números que no coincidían entre pestañas.

**No se creó tabla nueva ni se cambió el esquema** — no hay acceso a DDL desde acá (la API REST de Supabase no ejecuta `CREATE TABLE`, solo CRUD sobre tablas existentes). En cambio, `cuentas_por_cobrar`+`abonos_cuenta` (que ya eran el modelo más flexible) pasan a ser la única fuente:
- Ohiggins 126 Limache y Luz 2979 se migraron: se les creó su cuenta, sus `reportes_cobros` se migraron a `abonos_cuenta` (verificado: suma antes = suma después, exacto) y se borraron las filas viejas.
- **`Reporte.tsx` (el formulario que usa Gustavo todos los días) ahora enruta un cobro nuevo automáticamente**: si la obra tiene exactamente UNA cuenta activa, el cobro se guarda ahí; si tiene 0 o varias (caso raro, solo Luis Carrera hoy con 3 cuentas), sigue cayendo en `reportes_cobros` como antes — no se adivina a cuál cuenta corresponde. Probado en vivo con datos reales (cobro de prueba, verificado en Supabase, borrado después).
- **Aviso de posible duplicado**: antes de guardar un cobro nuevo, se revisa si ya existe algo igual (misma obra, fecha, monto) en cualquiera de los dos sistemas — si sí, pide confirmación explícita antes de guardar. Probado en vivo: al repetir el mismo cobro de prueba, apareció el aviso y al cancelar no se duplicó nada.
- Al recargar un día ya guardado, los cobros que ya viven en una cuenta se muestran de solo lectura en el Reporte Diario, con una nota de que se corrigen desde Obras → Detalle (no se puede editar/borrar una cuenta desde ahí, para no arriesgar un borrado accidental sin el contexto completo).
- `sync-cobros.js` (sync a Google Sheets) actualizado para leer de los dos lugares — sin esto, la planilla hubiera dejado de actualizarse para las obras migradas sin que nadie se diera cuenta.

**Sigue pendiente (anotado en tareas.md):** obras sin presupuesto definido (ej. Doctora Eloísa 5843) se quedan en el camino viejo hasta que alguien les cargue un presupuesto — no se puede migrar sin inventar un número. El merge de las pestañas "Obras" y "Cuentas por cobrar" en una sola (pedido explícito de Alexandra) quedó pendiente para retomar — la base de datos ya está unificada, falta la unificación visual.

**Regla nueva, no re-litigar:** no crear más cuentas manuales sueltas para obras nuevas — toda obra nueva con presupuesto conocido debe crear su `cuentas_por_cobrar` desde el principio (o dejar que se cree automático la primera vez que se define un presupuesto), nunca dejar que conviva con `reportes_cobros` para la misma obra.

## 2026-08-20 — Cobro duplicado de $2.000.000 en Luis Carrera 2700, corregido
Al agregar "cobradoManual" (sumar reportes_cobros + abonos de cuentas manuales) se generó un doble conteo real: el pago de Ignacio del 5/08 estaba cargado DOS VECES — una vez como cobro de $2.000.000 en `reportes_cobros` (creado 18:53 del 15/08) y otra vez como dos abonos de $1.000.000 en la cuenta manual "Presupuesto original Luis Carrera" (creados 19:21 del 15/08, 28 min después, misma sesión de carga). Se borró la fila de `reportes_cobros` (quedan los 2 abonos manuales, que coinciden con el detalle que dio Gustavo). Cobrado real de esa obra: $3.016.150, no $5.016.150. **Se revisó el resto del sistema cruzando fecha+obra entre `reportes_cobros` y `abonos_cuenta` — este fue el único caso.**

**Lección para cualquier fix futuro que sume dos fuentes de la misma métrica:** antes de sumarlas, cruzar por fecha+obra+monto para descartar que sea el mismo pago cargado dos veces por error humano — no asumir que fuentes distintas son plata distinta.

## 2026-08-20 — Luz 2979: se migró su factura vieja ($4.733.671) a abono real
Al sacar la sección "Facturación formal" de la UI, la tabla `facturas` quedó sin usarse — pero tenía plata real de Luz 2979 ($4.733.671, 17/08) que nunca se había cargado como abono (a diferencia de Ohiggins, cuya factura vieja era la MISMA plata ya contada en sus abonos — esa no se tocó, migrarla habría duplicado). Verificado antes de migrar: Luz 2979 tenía $0 en abonos, la factura era la única plata reportada. Ahora: Facturado $4.733.671, Por facturar $6.978.616 — coincide con lo que Gustavo reportó.

## 2026-08-20 — Ohiggins: el 5º cobro ($9.458.056, "Alejandra", 18/08) era duplicado, lo borró Alexandra
Durante la migración de Ohiggins a `cuentas_por_cobrar` se migraron 5 abonos (suma $33.374.148). Alexandra ya había avisado que el pago de $9.458.056 del 18/08 (cliente "Alejandra", el que no estaba en el WhatsApp original de Gustavo de 4 pagos) era duplicado — Gustavo había confirmado que el restante real era $15.147.740, lo cual solo cuadra con los 4 pagos originales ($23.916.092 facturado). El aviso no se procesó a tiempo (se investigó otro posible duplicado, el $4.729.023 que aparece dos veces — ese SÍ es real, Gustavo lo reportó así dos veces) y Alexandra terminó borrando la fila ella misma desde la app. **Estado final correcto: Facturado $23.916.092, Por facturar $15.147.740 — no volver a agregar ese pago.**

**Lección:** cuando el usuario da una instrucción específica ("elimina X"), no dar la tarea por resuelta investigando algo parecido pero distinto sin confirmar que es lo mismo que pidieron — si hay ambigüedad sobre a qué se refiere exactamente, preguntar antes de cerrar el tema.

## 2026-08-20 — Merge: "Cuentas por cobrar" deja de ser pestaña, se absorbe en "Obras"
Con la base de datos ya unificada (ver entrada de arriba), tener dos pestañas mostrando resúmenes de la misma plata seguía confundiendo — aunque los números coincidieran, Alexandra tenía que cruzar dos lugares para confiar en uno. `PanelCuentasPorCobrar` se eliminó del todo (código muerto, no quedó ningún uso). Estructura final, un solo lugar:
- Pestaña "Obras" (En curso/Culminadas) — la tarjeta principal de cada obra ya tenía "Falta por cobrar" como número único.
- **Detalle de cada obra** ahora también lista sus cuentas por cobrar manuales (puede haber más de una — ej. Luis Carrera tiene 3), cada una con su propia edición de abonos, más el botón "+ Agregar cuenta" para sumar una nueva (ej. una futura negociación adicional).
- **Sección "Otros cobros (sin obra)"** al final de la pestaña Obras, para cuentas sin obra asociada (ej. "Visita Técnica") — no justifica una pestaña propia, son pocas y raras.
- Componente nuevo reusable `CuentaMiniCard` (en PanelesObra.tsx) para no duplicar el render de una cuenta en los dos lugares donde aparece.

## 2026-08-20 — Para Gustavo, "Facturado" = "Cobrado" — Facturado formal se mueve a Detalle
Facturado (tabla `facturas`) y Cobrado (`reportes_cobros` + cuentas manuales) son conceptos distintos en el sistema, pero Gustavo no los distingue — para él ambos significan "plata que me depositaron". Como no se actualizan al mismo tiempo (un cobro puede tardar en cargarse como factura formal), terminaban mostrando dos "cuánto falta" distintos en la misma tarjeta (ver regla de abajo). Se sacaron Facturado/Por facturar de la tarjeta principal de Obras — quedan solo dentro de "Detalle", para quien necesite el dato de facturación formal (Alexandra/contabilidad). La tarjeta principal solo muestra "Falta por cobrar".

## 2026-08-20 — Regla de diseño: nunca dos números distintos para la misma pregunta
Alexandra marcó esto como delicado y tiene razón: Gustavo no va a cruzar dos pestañas para reconciliar por qué "Obras" y "Cuentas por cobrar" mostraban plata distinta para la misma obra (Obras no incluía nada de lo pendiente en cuentas manuales). Se agregó "Falta por cobrar" a la tarjeta de Obras, calculado exactamente igual que "Pendiente" en Cuentas por cobrar. **Regla para cualquier feature futura de esta app:** si dos pantallas responden la misma pregunta de plata (cuánto deben, cuánto se pagó, etc.), tienen que mostrar el mismo número, calculado de la misma forma — nunca dos cifras "parecidas pero distintas" que obliguen a alguien a pensar cuál es la correcta.

## 2026-08-20 — Cuenta "Luis Carrera 2700" separada en dos (original + adicional)
Cuando se cargaron las cuentas manuales el 15/08, "Luis Carrera 2700" se cargó como UNA cuenta de $4.537.500 — pero Gustavo en realidad se refería a dos cosas distintas que él mismo mezcla al hablar: el **presupuesto original** ($2.722.500, ya pagado con los 3 abonos existentes) y un **presupuesto adicional "a evaluar"** ($1.815.000, propuesta nueva todavía en negociación, sin pagar). Los números cuadran exacto: 2.722.500 + 1.815.000 = 4.537.500. Se separó en dos cuentas reales: "Presupuesto original Luis Carrera" (cobrada) y "Luis Carrera - adicional (a evaluar)" (pendiente). Alexandra confirmó el desglose antes de escribir en Supabase. De paso, `obras.presupuesto_total` de "Luis Carrera 2700" quedó en $2.722.500 (el original) — cargado por Alexandra a mano vía el botón editar, no vía código.

## 2026-08-20 — `obras.activa` significa "en curso", no "activa en general"
El campo ya existía en la tabla `obras` pero nunca se tocaba (siempre `true`). Se decidió reutilizarlo con el significado "en curso" (`true`) vs "culminada" (`false`), en vez de agregar una columna nueva. Importante: NINGUNA vista que calcule plata pendiente de cobro debe filtrar por `activa` — una obra culminada puede seguir debiendo plata (por eso Cuentas por Cobrar y Estado de Resultados leen todas las obras, no solo las en curso). Los dropdowns operativos (Reporte Diario, nueva cuenta manual) sí filtran por `activa=true`, porque no tiene sentido cargar trabajo nuevo contra una obra ya terminada.

## 2026-08-20 — Cuentas por cobrar = manual + obras, combinadas sin duplicar
Hay dos formas de rastrear plata que deben los clientes: la tabla manual `cuentas_por_cobrar` (cargos sueltos, todos "pagador: Ignacio", cargados a mano el 15/08) y las obras con `presupuesto_total` fijo (Ohiggins 126 Limache, Luz 2979), que se rastrean solas vía `reportes_cobros` del Reporte Diario. Ohiggins y Luz 2979 nunca aparecían en "Cuentas por cobrar" porque nadie las cargó ahí a mano — no era un dato faltante, era que ese sistema nunca las incluyó.

**Decisión:** no migrar todo a un solo sistema. La pestaña "Cuentas por cobrar" ahora muestra ambos combinados — las cuentas manuales tal cual, más cualquier obra activa con `presupuesto_total` que todavía no tenga una cuenta manual cargada (evita duplicar). Pendiente = presupuesto_total − cobrado, mismo criterio que ya usa la pestaña Obras.

## 2026-08-20 — Sync a Google Sheets: solo agregar, nunca borrar/pisar
La planilla "Control de Obra - Horma" tiene filas cargadas a mano antes de que existiera esta app, con columnas (Proveedor, Detalle, factura) completadas con criterio humano que la app no captura. Cualquier sync automático (`sync-compras.js`, `sync-cobros.js`, `sync-subcontratos.js`) dedupe por fecha+monto y solo AGREGA filas nuevas — nunca borra ni sobrescribe una fila existente, aunque eso signifique que una edición posterior en Supabase pueda generar una fila duplicada en vez de actualizar la vieja. Se prefiere el duplicado visible (fácil de limpiar a mano) sobre el riesgo de destruir algo cargado con criterio.

## 2026-08-20 — "Gasto en Materiales" necesita una fila espejo en "Asignación Materiales"
La columna "Sobrante" de "Gasto en Materiales" es un SUMIF contra "Asignación Materiales" buscando por Factura N°. Si se agrega una compra nueva a "Gasto en Materiales" sin la fila espejo correspondiente en "Asignación Materiales", la fórmula muestra el monto completo como "sobrante" (como si fuera material sin asignar a ninguna obra), aunque en realidad esté totalmente asignado. `sync-compras.js` siempre escribe en ambas hojas a la vez por este motivo.

## 2026-08-18 — Estado de Resultados no filtra por `cuenta.activa`
Los abonos de `cuentas_por_cobrar` ya se cuentan como ingreso del mes sin importar si la cuenta está marcada activa o no — por eso separar "Cuentas por cobrar" en Pendientes/Cobradas (2026-08-20) no necesitó ningún cambio en Estado de Resultados.

## 2026-08-18 — Se descartó el acumulado histórico "falta pagar a trabajadores"
Sumaba mano de obra menos pagos de TODA la historia de una obra — podía salir negativo cuando un pago semanal reciente saldaba deuda de un período anterior, lo cual confundía más de lo que ayudaba. Se reemplazó por el desglose ya existente por período (dentro del historial de cada obra) y, el 2026-08-20, por la pestaña "Pago semanal" nueva — que es semanal y cruza obras, nunca un acumulado de todo el tiempo.
