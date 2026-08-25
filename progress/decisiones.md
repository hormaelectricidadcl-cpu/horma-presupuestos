# Decisiones ya tomadas — no re-litigar
> Cada entrada: qué se decidió, por qué, y fecha. Si algo cambia, se agrega una entrada nueva con la fecha del cambio — no se borra la vieja.

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
