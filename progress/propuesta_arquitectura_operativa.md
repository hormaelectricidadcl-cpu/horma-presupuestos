# Backlog operativo — lead a obra a factura a garantía

> **Este archivo es el respaldo completo de todo lo conversado sobre hacia dónde va la app** (no solo el presupuestador — el control de clientes, obras, materiales, y cómo esto alimenta Power BI y las campañas de Ads). Escrito para que cualquier sesión de Claude (o Alexandra) lo pueda leer solo, sin tener que reconstruir el razonamiento desde el chat. Actualizado 25/08/2026.
>
> No confundir con `decisiones.md` (cosas ya resueltas y verificadas contra Supabase) — acá hay trabajo hecho, trabajo diseñado pero no construido, y trabajo solo propuesto. Cada ítem dice cuál es. Cuando algo pase a "hecho y verificado", se mueve a `decisiones.md`.

## Principios que gobiernan todo lo de abajo (no re-litigar sin razón nueva)

1. **Nada de texto libre donde debería haber una referencia real (FK).** Esta app va a alimentar dashboards de Power BI — `obra`/`cliente` como texto suelto no se puede agregar bien. Todo lo nuevo usa IDs reales.
2. **No hacer que Gustavo cambie de herramienta.** Usa el presupuestador simple (materiales + mano de obra, sin itemizar) — cualquier feature que dependa de desglose por ítem tiene que sacarlo con IA de lo que él ya escribe, no pedirle que aprenda el itemizado.
3. **Reusar antes que inventar.** Ya existe: subida de archivos a Supabase Storage (bucket `audio-notas`), una IA que convierte texto libre en ítems estructurados (`/api/parse.js`, OpenAI `gpt-4.1-mini`), y login real de Supabase Auth (usado hoy solo en `PresupuestoEtapas.tsx`). Todo lo nuevo de acá abajo se apoya en estas tres piezas en vez de traer herramientas nuevas.
4. **Pensar en quién más va a usar esto.** Se viene una persona nueva (no Gustavo, no Alexandra) con su propio login — todo lo que se construya tiene que quedar claro para alguien que no conoce el negocio de memoria.

---

## Ya hecho (esta sesión, 24-25/08/2026)

- **Rebrand completo**: Horma Servicios → Horma Electricidad, logo nuevo, datos de transferencia en ambos PDFs. Commiteado y pusheado (`fedc0ec`).
- **Reglas de precios de Gustavo documentadas**, fuera de este repo: `E:\HORMA CONSTRUCCION\casos-presupuestos\reglas-precios-gustavo.md` (tabla de precios, gastos operacionales 10%, regla de fallas con descuento) + 8 plantillas de presupuesto con precio pre-calculado + 2 casos reales de referencia.
- **"Irazú" renombrado a "Admin"** en toda la interfaz visible (no se tocaron identificadores internos ni rutas).
- **Dos tipos de pendiente nuevos**: `seguimiento` (recordatorio para volver a escribirle a un lead) y `pedido_material` (para cuando falta algo en obra).
- **"Links de Drive" reemplazado por subida real de archivo** (Supabase Storage) en los formularios de crear/editar pendiente — resuelve el problema de Gustavo con el selector de cuenta de Google en iPhone.
- **Tabla `clientes` diseñada** (`sql/clientes.sql`) — con RUT/correo/comuna (pedido de Gustavo) y campo `archivado`. **✅ Confirmado ejecutado (sesión 25/08, vía MCP `supabase-horma` read-only: la tabla existe con su policy `anon full access`, coincide exacto con el SQL del repo)** — el botón "Archivar" en Admin ya funciona de verdad.
- **Botón "Archivar cliente" + toggle "Ver archivados"** en la pestaña Clientes de Admin — el propósito NO es gestionar clientes viejos, es sacarlos de la vista activa para que la lista sirva para análisis retrospectivo (qué se hizo, para mejorar), no para seguimiento operativo.
- **Presupuesto simple**: no deja descargar el PDF sin nombre y dirección del cliente, y genera un ID de referencia automático (`HRM-XXXXX`) que se imprime en el PDF. **Esto es client-side únicamente** — el ID no se guarda en ningún lado todavía (ver "Guardar presupuestos" abajo, es el siguiente paso obligatorio).

---

## Nivel 0 — bloqueadores, antes que cualquier otra cosa

### 0.1 Correr `sql/clientes.sql` en Supabase — ✅ hecho (confirmado 25/08)
Alexandra ya lo corrió. Confirmado vía MCP: la tabla `clientes` existe con la policy `anon full access`, esquema idéntico al SQL del repo.

### 0.2 Verificar el esquema real de la tabla `presupuestos` — ✅ hecho 25/08/2026
Confirmado vía MCP `supabase-horma` (solo lectura): la tabla existe con las columnas que ya usaba `PresupuestoEtapas.tsx` (`user_id` nullable a nivel de columna, `cliente_nombre`, `cliente_telefono`, `cliente_email`, `cliente_direccion`, `etapas` jsonb, `gg_pct`, `gg_amount`, `subtotal`, `iva`, `total`). **Hallazgo clave: las políticas RLS solo cubren el rol `authenticated`** (INSERT con `auth.uid() = user_id`, SELECT abierto) — no hay ninguna policy para `anon`. Como el presupuesto simple (`Presupuesto.tsx`) no usa Supabase Auth (solo el token de la URL, ver 0.3), un insert desde ahí es bloqueado por RLS tal como estaba el esquema. Resuelto en 1.1 (ver abajo) siguiendo el mismo patrón "anon full access" que ya usan `pendientes`/`obras`/`reportes_*`/`clientes`.

### 0.3 Decidir la seguridad de la ruta `/` (presupuesto simple) — ✅ hecho 25/08/2026
Protegida con el mismo patrón token-en-URL que `/g`/`/reporte` (`VITE_PRESUPUESTO_TOKEN`, pantalla "Link inválido" si no coincide). Verificado en navegador con Playwright. Detalle en `estado_actual.md` sesión 25/08. **Pendiente que solo puede hacer Alexandra:** cargar `VITE_PRESUPUESTO_TOKEN` en Cloudflare Pages y repartir el link nuevo con `?t=...`.

---

## Nivel 1 — Fase 1 original, la base de todo

| # | Qué | Estado | Depende de |
|---|---|---|---|
| 1.1 | Presupuesto simple guarda en Supabase (tabla `presupuestos`) con `cliente_id` real | **✅ Hecho y verificado 25/08/2026** | 0.1, 0.2, 0.3 |
| 1.2 | Trabajos que Gustavo hace solo (`reportes_trabajos_puntuales`) — agregar campo `monto` y que se sume a Estado de Resultados | **✅ Hecho y verificado 25/08/2026** — migración confirmada vía MCP | — |
| 1.3 | Gustavo puede registrar sus propias cosas pendientes sin pasar por Admin | **✅ Hecho y verificado 25/08/2026** — diseño resuelto distinto al título original, ver detalle abajo | — |
| 1.4 | `cliente_id` real (FK) en `pendientes` para todo registro nuevo de acá en adelante — sin migrar el historial viejo (eso es un paso aparte, más delicado) | **✅ Hecho y verificado 25/08/2026** | 0.1 |

### Detalle de 1.4 (sesión 25/08/2026)
- `sql/pendientes_cliente_id.sql` escrito (solo `alter table ... add column cliente_id uuid references clientes(id)` — `pendientes` ya tenía `anon full access`, no hace falta tocar RLS). **Falta que Alexandra lo corra.**
- `Admin.tsx` (`CrearForm.submit`, el único lugar del código que hace `insert` en `pendientes`): antes de guardar, hace upsert de `clientes` por nombre (mismo patrón que 1.1, sin pisar RUT/email si ya existen) y guarda `cliente_id` junto al `cliente_nombre` de siempre — el texto no se saca, sigue siendo la fuente de verdad para todo lo viejo.
- Sin migrar el historial: los pendientes ya cargados se quedan con `cliente_id = null`, tal como dice el plan original.
- **Alexandra corrió `sql/pendientes_cliente_id.sql`. Verificado 25/08/2026** — como Admin.tsx no se puede probar en navegador (login vía Cloudflare Function), se simuló el flujo exacto del código (mismo canal: upsert de `clientes` por nombre + insert en `pendientes` con `cliente_id`, usando la anon key real) contra Supabase. Dato de prueba borrado después.
- **Bug real encontrado durante esa simulación, sin relación con 1.4:** el `insert` falló por un constraint viejo — `pendientes_tipo_check` en la base de datos nunca se actualizó cuando se agregaron los tipos `seguimiento` y `pedido_material` al código esta misma sesión (ver "Ya hecho" arriba). Hoy, crear un pendiente de "Pedido de material" o "Seguimiento" falla en producción. Confirmado que nadie lo pisó todavía (el último pendiente real en la tabla es de mayo, antes de que existieran esos tipos). Fix en `sql/20260825_pendientes_tipo_constraint_fix.sql` — **falta que Alexandra lo corra.**
- **Alexandra corrió el fix del constraint. Verificado de punta a punta 25/08/2026:** constraint confirmado con los 9 tipos vía MCP; se repitió la simulación completa (mismo canal que usa `Admin.tsx`) con `tipo='pedido_material'` — el caso que estaba roto — y esta vez pasó limpio: cliente creado, `cliente_id` resuelto y vinculado, pendiente insertado. Datos de prueba borrados en el mismo script.
- `tsc --noEmit` limpio, `init.sh` en verde.
- **1.4 cerrado del todo. Nivel 1 completo.**

### Detalle de 1.3 (sesión 25/08/2026)
- **Decisión de diseño, tomada en conversación con Alexandra (no era obvia, por eso el ítem original decía "sin diseñar"):** en vez de meter esto dentro del sistema de "pendientes" (que es para tareas donde una persona le pide algo a la OTRA y espera respuesta — Gustavo solo ve pendientes con `destinatario='gustavo'`, cosas que Alexandra le asignó), se reusó `notas_rapidas` — una tabla y componente que ya existían, pero solo para Alexandra en `/admin` (checklist personal: escribís, tachás cuando está hecho). Encaja mejor con el caso real descrito: "si es Gustavo el que tiene que comprarlo, que sea un pendiente para él mismo así no se le olvida" — eso es exactamente un checklist autoasignado, no un pedido formal a otra persona. Si en un caso puntual sí hace falta que Alexandra actúe activamente, el sistema de pendientes normal (destinatario='irazu') sigue ahí — las dos herramientas conviven, cada una para su caso.
- **"Los chicos" (Samuel y demás trabajadores) — fuera de este alcance por ahora.** Hoy solo Gustavo tiene su propio panel con token (`/g`); el resto de los trabajadores son solo nombres en la tabla `trabajadores` (para pago semanal/reportes), sin ningún acceso propio a la app. Darles una bandeja propia de notas/pendientes requiere login real por persona — eso ya está en el backlog como 4.1, no se adelantó acá.
- `src/components/NotasRapidas.tsx` nuevo (extraído de Admin.tsx, parametrizado por `autor: 'alexandra'|'gustavo'`) — mismo patrón que ya se usó con `PanelObras` (decisiones.md 2026-08-20: no duplicar, compartir). Admin.tsx usa `<NotasRapidas autor="alexandra" />` (comportamiento sin cambios para ella); Gustavo.tsx suma una pestaña nueva "Mis notas" con `<NotasRapidas autor="gustavo" />`.
- `sql/notas_rapidas_gustavo.sql`: agrega columna `autor` (default `'alexandra'`, correcto porque hasta ahora la tabla solo la usaba ella) y, de paso, **cierra un hueco de seguridad real que había quedado marcado sin resolver**: la tabla no tenía RLS habilitado en absoluto (hallazgo del advisor de Supabase, ver sesión anterior) — se agregó `enable row level security` + policy `anon full access`, mismo patrón que el resto de la app.
- **Alexandra corrió `sql/notas_rapidas_gustavo.sql`. Verificado 25/08/2026:**
  - Esquema confirmado vía MCP: columna `autor` presente, RLS habilitado, policy `anon full access` activa.
  - Probado en navegador con Playwright (dev server local, token real de Gustavo): pestaña "Mis notas" → se escribió una nota de prueba, apareció al instante, se marcó como hecha — sin errores en consola.
  - Fila confirmada en Supabase: `autor='gustavo'`, `hecho=true`, coincide exacto con lo hecho en pantalla. Dato de prueba borrado después (vía la anon key de la app, mismo canal que usa el frontend — el MCP es de solo lectura).
  - Admin.tsx (`autor='alexandra'`) no se pudo probar en vivo (login pasa por una Cloudflare Function, límite ya conocido de este proyecto) — pero es el mismo componente compartido, ya verificado del lado de Gustavo, y el filtro `eq('autor', autor)` es la misma lógica probada.
- `tsc --noEmit` limpio, `init.sh` en verde.
- **1.3 cerrado del todo. Nivel 1 completo salvo 1.4.**

### Detalle de 1.2 (sesión 25/08/2026)
- `sql/trabajos_puntuales_monto.sql` escrito (agrega `monto numeric` nullable a `reportes_trabajos_puntuales` — la tabla ya tenía `anon full access`, no hace falta tocar RLS). **Falta que Alexandra lo corra.**
- `Reporte.tsx`: nuevo campo "Monto cobrado (opcional)" en el formulario de trabajo puntual, se guarda junto al resto.
- `PanelEstadoResultados` (`PanelesObra.tsx`): suma `reportes_trabajos_puntuales.monto` del mes a `Ingresos del mes`. Como esta tabla no tiene `obra` asociada (son trabajos sueltos), solo se cuenta en la vista consolidada — igual que gastos fijos/variables, se excluye cuando se filtra por una obra específica.
- `tsc --noEmit` limpio, `init.sh` en verde.
- **Hallazgo real al revisar los datos:** ya existe 1 fila real (21/08/2026, Friburgo 5007 Lo Barnechea) cuya descripción dice literalmente "Trabajo hecho facturado y pagado Total 91.630" — hoy ese ingreso NO aparece en Estado de Resultados porque no existía el campo `monto`. Después de correr la migración, esa fila sigue en `monto = null` (no se inventó el número solo porque aparece en el texto) — **pendiente que Alexandra confirme el monto y lo cargue** (editando esa fila en Supabase o recargando el Reporte Diario del 21/08 con el monto en el campo nuevo) para que los $91.630 entren al cálculo de agosto.

### Detalle de 1.1 (sesión 25/08/2026)
- `sql/presupuestos_migracion.sql` escrito (mismo flujo que `clientes.sql`: Alexandra lo pega en el SQL Editor de Supabase). Agrega `cliente_id` (FK a `clientes`), `referencia` (el ID `HRM-XXXXX` que ya se generaba solo client-side), `items` jsonb (forma plana, distinta de `etapas` que usa el flujo con login) y `tipo` (`'simple'|'etapas'`, para que 2.1 pueda listar los dos juntos) — más la policy `anon full access`, igual patrón que el resto de la app.
- `Presupuesto.tsx` ya hace el guardado: al generar el PDF, hace upsert de `clientes` por nombre (sin pisar RUT/email existentes si el campo viene vacío) e inserta en `presupuestos` con `tipo: 'simple'`. Guardado en Supabase es best-effort — si falla, no bloquea el PDF (mismo patrón que `PresupuestoEtapas.tsx`), solo lo deja en consola.
- **Alexandra corrió `sql/presupuestos_migracion.sql`. Verificado end-to-end 25/08/2026:**
  - Esquema confirmado vía MCP (solo lectura): columnas `cliente_id`/`referencia`/`items`/`tipo` y policy `anon full access` presentes.
  - Probado en navegador con Playwright (dev server local, token real, cliente/ítem de prueba): PDF generado bien, sin error en consola.
  - Fila confirmada en Supabase: `cliente_id` resuelto y vinculado a un `clientes.nombre` real (el upsert funcionó), `items` jsonb con el ítem cargado, `referencia`/`subtotal`/`iva`/`total` correctos, `tipo='simple'`.
  - Datos de prueba (`ZZZ Test Migracion 25-08`) borrados después de verificar, vía la anon key de la propia app (el MCP es de solo lectura, no puede hacer DELETE) — no queda basura de test en producción.
- `tsc --noEmit` limpio, `init.sh` en verde.
- **1.1 cerrado del todo.** Nivel 1 sigue con 1.2, 1.3, 1.4 pendientes.

---

## Nivel 2 — con la base ya puesta

| # | Qué | Por qué importa |
|---|---|---|
| 2.1 | Pestaña "Mis presupuestos" en el panel de Gustavo (`/g`) — lista buscable por cliente, con estado (borrador → enviado → aceptado → convertido en obra) | **✅ Hecho y verificado 25/08/2026** — Gustavo hoy busca en la galería del teléfono; esto es la puerta de entrada a todo lo que sigue |
| 2.2 | IA que lee el presupuesto de Gustavo (reusa `/api/parse.js`) y de ahí saca el desglose por ítem | Destraba 3.2 (Carta Gantt) sin que Gustavo cambie de herramienta |
| 2.3 | Presupuesto obligatorio antes de que exista una obra (gate — no se crea obra sin presupuesto asociado) | **Código listo, bloqueado en Alexandra corriendo `sql/20260825_obras_presupuesto_id.sql`** — cierra el hueco de "se pierde información" que motivó todo esto |
| 2.4 | Obras: estado ampliado (en curso → terminada en terreno → facturada → en garantía → cerrada) + `fecha_inicio` + `fecha_fin` + `garantia_hasta` | **Código listo, bloqueado en Alexandra corriendo `sql/20260825_obras_estado_ampliado.sql`** — resuelve la confusión real que vivieron Alexandra y Gustavo con "Luz" apareciendo donde no debía |

### Detalle de 2.3 y 2.4 (sesión 25/08/2026, hechas juntas — ambas tocan la creación/estado de `obras`)

**2.2 se saltó por decisión de Alexandra** (confirmado en conversación): depende de una tabla que no existe todavía (`obra_items`, Nivel 3) — se retoma junto con 3.2, cuando la IA tenga dónde escribir el desglose y se pueda verificar de verdad.

**2.3 — gate con salida de emergencia** (Alexandra eligió esta opción, no el gate estricto que pedía la tarea original): "Nueva obra" ahora exige elegir un presupuesto con estado `'aceptado'` de una lista (autocompleta cliente y monto desde ahí, vincula por `presupuesto_id` real, y marca ese presupuesto como `'convertido'`). Hay un link secundario "Crear sin presupuesto (excepción)" que vuelve al formulario libre de siempre, con una confirmación explícita antes de guardar — para no bloquear un día con apuro real si todavía no hay ningún presupuesto marcado Aceptado. `sql/20260825_obras_presupuesto_id.sql`: agrega `presupuesto_id` nullable (las 6 obras viejas quedan sin vincular, no se puede adivinar cuál les corresponde).

**2.4 — estado ampliado sin duplicar fuente de verdad:** en vez de agregar `estado_obra` AL LADO del `activa` booleano de siempre (que se podrían desincronizar), `activa` se convirtió en columna **generada** por Postgres a partir de `estado_obra` (`activa = (estado_obra = 'en_curso')`). Todo el código viejo que ya leía `.activa` (el dropdown de obras en Reporte Diario, que solo debe ofrecer obras en curso; el split de pestañas En curso/Culminadas) sigue funcionando sin ningún cambio — nunca puede quedar desincronizado porque Postgres lo calcula solo. `sql/20260825_obras_estado_ampliado.sql`: agrega `estado_obra` (5 valores) + `fecha_inicio`/`fecha_fin`/`garantia_hasta`, backfillea las 3 obras que hoy tienen `activa=false` (Doctora Eloísa 5843, Luz 2979, Renato Sanchez) a `'cerrada'` — el bucket más genérico, porque no hay forma de saber desde acá si cada una es más específicamente "facturada" o "en garantía" sin preguntar. **Pendiente que Alexandra revise esas 3 y las ajuste a su estado real** si `'cerrada'` no es exacto, ahora que hay un selector con las 5 opciones en cada tarjeta de obra.

- Card de cada obra: el botón binario "Marcar como culminada"/"Reactivar" se reemplazó por un `<select>` con los 5 estados; se agregaron 3 campos de fecha (Inicio/Fin/Garantía hasta) compactos debajo del nombre.
- `tsc --noEmit` limpio, `init.sh` en verde. Probado en navegador (Gustavo → Obras) antes de correr las migraciones: carga sin errores, el selector de 5 estados ya aparece (todas por default en "En curso" hasta que exista la columna real), "Culminadas (3)" sigue coincidiendo con las 3 obras que ya tenían `activa=false` — nada se rompió.
- **Falta correr las dos migraciones y volver a probar** (crear una obra real desde un presupuesto aceptado, cambiar el estado de una obra existente, cargar una fecha) para verificar de punta a punta.
| 2.5 | **Galería de fotos/videos por obra/cliente en la web app** (propuesta de Alexandra, 25/08) — reemplaza tener que abrir Google Drive para ver el material de una obra. Reusa el mismo patrón ya construido (Supabase Storage, subida real de archivo) que ya reemplazó "Links de Drive" en pendientes — acá vinculado a `obra_id`/`cliente_id` en vez de a un pendiente puntual. Bajo esfuerzo, casi una extensión de algo que ya existe | Toda la "vida del cliente" (fotos de avance, boletas, videos) queda dentro de la app, sin depender de que alguien encuentre la carpeta correcta en Drive |
| 2.6 | **Calendario compartido de disponibilidad** (propuesta de Alexandra, 25/08) — Gustavo, Alexandra y quien esté trabajando pueden ver/confirmar horas ocupadas para no agendar una visita técnica encima de algo ya agendado. Recomendación: arrancar con una versión liviana (elegir el nombre de una lista, mismo modelo de confianza por token que ya usa el resto de la app) en vez de esperar el login real por persona (4.1) — evita bloquear el problema real (doble agenda) detrás de una feature más grande. Se puede migrar a cuentas reales cuando 4.1 se construya | Hoy no hay ninguna forma de chequear disponibilidad antes de agendar — riesgo real de pisar una visita con otra |

---

### Detalle de 2.1 (sesión 25/08/2026)
- `sql/20260825_presupuestos_estado.sql` — agrega `estado` a `presupuestos` (`'borrador'|'enviado'|'aceptado'|'convertido'`, default `'borrador'`). **Falta que Alexandra lo corra.**
- Los dos flujos que guardan presupuestos (`Presupuesto.tsx` y `PresupuestoEtapas.tsx`) ahora ponen `estado: 'enviado'` explícitamente al guardar — hoy un presupuesto solo se guarda en el momento de generar el PDF (no hay borrador previo), así que "generado" ya equivale a "listo para el cliente".
- **De paso, `PresupuestoEtapas.tsx` (el flujo con login) ahora también resuelve `cliente_id`** vía el mismo upsert de `clientes` que ya se usaba en `Presupuesto.tsx` desde 1.1 — no estaba cubierto por esa tarea porque es un flujo aparte, pero es el mismo principio (FK real, no texto suelto) y ya se estaba tocando esa misma función para el estado.
- Componente nuevo compartido `PanelPresupuestos` en `PanelesObra.tsx`: lista todos los presupuestos (ambos tipos), buscable por nombre de cliente, cada uno con un selector para cambiar su estado manualmente. Pestaña "Mis presupuestos" agregada tanto en Gustavo (`/g`) como en Admin (por visibilidad — Alexandra también necesita verlos, mismo criterio que Obras/Pago semanal/Estado de resultados).
- **Alexandra corrió `sql/20260825_presupuestos_estado.sql`. Verificado 25/08/2026:** columna `estado` confirmada vía MCP; probado en navegador (Gustavo → "Mis presupuestos") — aparecen los presupuestos reales ya guardados (Gustavo Castillo, Patricio Zamora, etc.) con cliente, fecha, tipo, monto y el selector de estado, todos en `'borrador'` (correcto: son filas viejas, no se les forzó `'enviado'` retroactivo). Sin errores en consola. No se tocó ningún dato real durante la prueba.
- `tsc --noEmit` limpio, `init.sh` en verde. **2.1 cerrado del todo.**

## Nivel 3 — la parte más transformadora

| # | Qué | Depende de |
|---|---|---|
| 3.1 | Material con foto + IA: nueva función `/api/parse-factura.js` (mismo patrón que `parse.js`, pero lee una imagen en vez de texto) — Gustavo sube la foto de la boleta desde "Compras del día" (Reporte Diario) y se auto-completa material/cantidad/monto | Subida de archivos (ya existe) |
| 3.2 | Desglose por ítem (`obra_items`) + avance diario (`avances_diarios`) + barra de progreso semanal, junto a Pago Semanal | 2.2 |
| 3.3 | Stock de materiales real: catálogo + movimientos (compra_obra / compra_stock / uso / sobrante_a_stock) | 3.1 en parte |
| 3.4 | Alerta proactiva de material faltante (cruza `obra_items` contra stock, avisa antes de que frene el trabajo) | 3.2 + 3.3 |

---

## Nivel 4 — para escalar con más gente y más volumen

| # | Qué | Notas |
|---|---|---|
| 4.1 | Login real (Supabase Auth) para cualquier persona nueva del equipo, no token compartido | Ya existe el patrón en `PresupuestoEtapas.tsx` — replicar, no inventar. De regalo: trazabilidad real de "quién cargó qué" |
| 4.2 | Campo `origen`/`fuente` del lead en `clientes` (recomendación de Gustavo / Google Ads / Meta Ads / orgánico) | Para poder ordenar de dónde viene cada cliente |
| 4.3 | Cerrar el loop con Ads/Meta: cruzar qué campaña generó qué obra rentable, no solo clics | Requiere trabajo del lado del sitio (`E:\HORMA CONSTRUCCION`, ya tiene tracking de conversiones) — conversación aparte, no es solo esta app |
| 4.4 | Reconectar `facturas` a la UI (existe con datos reales, sin interfaz desde el 20/08/2026) | — |
| 4.5 | Backup de `E:\HORMA CONSTRUCCION\casos-presupuestos\` — hoy vive solo en disco local, sin git ni Supabase | Riesgo real si se pierde el disco |

---

## Cosas ya resueltas en la conversación, no re-litigar

- Gastos operacionales = 10% por defecto, siempre — ver `reglas-precios-gustavo.md`.
- El desglose por ítem NO requiere que Gustavo use el presupuestador itemizado (se resuelve con IA leyendo su presupuesto simple).
- Archivar un cliente es para análisis retrospectivo, no gestión activa.
- No migrar de golpe el historial viejo de `cliente_nombre` (texto) a `cliente_id` — solo lo nuevo de acá en adelante.
- No sumar un CRM externo — extender lo que ya hay en Supabase.
