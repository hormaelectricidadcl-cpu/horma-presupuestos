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
| 2.3 | Presupuesto obligatorio antes de que exista una obra (gate — no se crea obra sin presupuesto asociado) | **✅ Hecho y verificado 25/08/2026** — cierra el hueco de "se pierde información" que motivó todo esto |
| 2.4 | Obras: estado ampliado (en curso → terminada en terreno → facturada → en garantía → cerrada) + `fecha_inicio` + `fecha_fin` + `garantia_hasta` | **✅ Hecho y verificado 25/08/2026** — resuelve la confusión real que vivieron Alexandra y Gustavo con "Luz" apareciendo donde no debía |

### Detalle de 2.3 y 2.4 (sesión 25/08/2026, hechas juntas — ambas tocan la creación/estado de `obras`)

**2.2 se saltó por decisión de Alexandra** (confirmado en conversación): depende de una tabla que no existe todavía (`obra_items`, Nivel 3) — se retoma junto con 3.2, cuando la IA tenga dónde escribir el desglose y se pueda verificar de verdad.

**2.3 — gate con salida de emergencia** (Alexandra eligió esta opción, no el gate estricto que pedía la tarea original): "Nueva obra" ahora exige elegir un presupuesto con estado `'aceptado'` de una lista (autocompleta cliente y monto desde ahí, vincula por `presupuesto_id` real, y marca ese presupuesto como `'convertido'`). Hay un link secundario "Crear sin presupuesto (excepción)" que vuelve al formulario libre de siempre, con una confirmación explícita antes de guardar — para no bloquear un día con apuro real si todavía no hay ningún presupuesto marcado Aceptado. `sql/20260825_obras_presupuesto_id.sql`: agrega `presupuesto_id` nullable (las 6 obras viejas quedan sin vincular, no se puede adivinar cuál les corresponde).

**2.4 — estado ampliado sin duplicar fuente de verdad:** en vez de agregar `estado_obra` AL LADO del `activa` booleano de siempre (que se podrían desincronizar), `activa` se convirtió en columna **generada** por Postgres a partir de `estado_obra` (`activa = (estado_obra = 'en_curso')`). Todo el código viejo que ya leía `.activa` (el dropdown de obras en Reporte Diario, que solo debe ofrecer obras en curso; el split de pestañas En curso/Culminadas) sigue funcionando sin ningún cambio — nunca puede quedar desincronizado porque Postgres lo calcula solo. `sql/20260825_obras_estado_ampliado.sql`: agrega `estado_obra` (5 valores) + `fecha_inicio`/`fecha_fin`/`garantia_hasta`, backfillea las 3 obras que hoy tienen `activa=false` (Doctora Eloísa 5843, Luz 2979, Renato Sanchez) a `'cerrada'` — el bucket más genérico, porque no hay forma de saber desde acá si cada una es más específicamente "facturada" o "en garantía" sin preguntar. **Pendiente que Alexandra revise esas 3 y las ajuste a su estado real** si `'cerrada'` no es exacto, ahora que hay un selector con las 5 opciones en cada tarjeta de obra.

- Card de cada obra: el botón binario "Marcar como culminada"/"Reactivar" se reemplazó por un `<select>` con los 5 estados; se agregaron 3 campos de fecha (Inicio/Fin/Garantía hasta) compactos debajo del nombre.
- `tsc --noEmit` limpio, `init.sh` en verde. Probado en navegador (Gustavo → Obras) antes de correr las migraciones: carga sin errores, el selector de 5 estados ya aparece (todas por default en "En curso" hasta que exista la columna real), "Culminadas (3)" sigue coincidiendo con las 3 obras que ya tenían `activa=false` — nada se rompió.
- **Alexandra corrió las dos migraciones. Verificado de punta a punta 25/08/2026** (con un presupuesto y una obra de prueba, borrados después): se creó una obra real desde un presupuesto marcado "Aceptado" — `cliente`/`presupuesto_total`/`presupuesto_id` quedaron resueltos exactos desde el presupuesto, y ese presupuesto pasó a `estado='convertido'` automáticamente. Se cambió el estado de esa obra a "En garantía" desde el selector — `activa` se recalculó sola a `false` (columna generada, nunca hay que tocarla a mano). Datos de prueba eliminados sin dejar rastro.
- **Extras pedidos por Alexandra después de ver la pestaña en producción (25/08):** botón "Detalle" (modal con datos de contacto + desglose real, ítems o etapas según el tipo, fetch on-demand para no cargar la lista completa) y botón "Borrar" (con confirmación, en la tarjeta y en el detalle). Ambos verificados de punta a punta (Detalle con el presupuesto real de Gustavo Castillo; Borrar con un registro de prueba, confirmado que desapareció de Supabase). De paso se encontraron 4 presupuestos duplicados de "Patricio" ($1.504.041 cada uno, de mayo — 2 con espacio de más en el nombre) — no se tocaron, **Alexandra los puede borrar ella misma ahora con el botón nuevo** si confirma que son basura.
| 2.5 | **Galería de fotos/videos por obra en la web app** (propuesta de Alexandra, 25/08) — reemplaza tener que abrir Google Drive para ver el material de una obra. | **✅ Hecho y verificado 25/08/2026** — Toda la "vida de la obra" (fotos de avance, videos) queda dentro de la app, sin depender de que alguien encuentre la carpeta correcta en Drive |

### Detalle de 2.5 (sesión 25/08/2026)
- Tabla nueva `obra_media` (`sql/20260825_obra_media.sql`): `obra_id` (FK a `obras`, `on delete cascade`), `url`, `tipo` (`'foto'|'video'|'documento'`, inferido del mimetype al subir), `descripcion`, `subido_por`. RLS `anon full access`, mismo patrón de siempre.
- **Reusa el bucket de Storage que ya existe (`audio-notas`)** en vez de pedirle a Alexandra que cree uno nuevo — mismo patrón ya usado para subir archivos a pendientes. El nombre quedó desactualizado (ya no es solo audio/notas), pero renombrarlo no es bloqueante, se puede hacer después.
- Componente nuevo `GaleriaObra`, dentro del modal "Detalle" de cada obra (arriba de todo, antes de Cuentas por cobrar) — visible en Gustavo y Admin porque `HistorialObraModal` ya es compartido. Subir archivo (foto/video/PDF), ver en grilla (fotos con miniatura, videos/documentos con ícono, clic abre el archivo real), borrar con confirmación.
- Alcance: **solo por obra**, no por cliente — la mayoría de las fotos de avance son de trabajo en una obra específica, y así evita la pregunta de qué hacer con fotos de un cliente con varias obras. Si hace falta una galería a nivel cliente después, se puede agregar aparte.
- **No se conectó a Reporte Diario todavía** (subir una foto directo desde el reporte del día, sin pasar por "Detalle" de la obra) — quedó fuera de este alcance para no sobreconstruir sin que lo pidieran; es un fast-follow fácil si Gustavo lo necesita en el día a día.
- **Alexandra corrió `sql/20260825_obra_media.sql`. Verificado 25/08/2026:** se subió un archivo de prueba a la galería de una obra de prueba (creada para este mismo test) — apareció al instante en la grilla, la fila real en `obra_media` coincide (tipo `'foto'`, URL real del bucket `audio-notas`). Al borrar la obra de prueba, el archivo de `obra_media` se borró solo (por el `on delete cascade` de la migración) — confirmado en Supabase. `tsc --noEmit` limpio, `init.sh` en verde.
| 2.6 | **Calendario compartido de disponibilidad** (propuesta de Alexandra, 25/08) — Gustavo, Alexandra y quien esté trabajando pueden ver/confirmar horas ocupadas para no agendar una visita técnica encima de algo ya agendado. | **✅ Hecho y verificado 25/08/2026** — Hoy no hay ninguna forma de chequear disponibilidad antes de agendar — riesgo real de pisar una visita con otra |

### Detalle de 2.6 (sesión 25/08/2026)
- `sql/20260825_eventos_calendario.sql`: tabla `eventos_calendario` nueva (`fecha`, `hora_inicio`, `hora_fin`, `persona`, `titulo`, `cliente_nombre`, `direccion`, `notas`). RLS `anon full access`, mismo patrón de siempre.
- **Versión liviana, como se había recomendado:** `persona` es un nombre de una lista fija (Gustavo, Alexandra, más los mismos trabajadores que ya se usan en Reporte Diario) en vez de una cuenta con login real — eso queda para 4.1, no bloquea el problema real de la doble agenda.
- Componente nuevo compartido `PanelCalendario`: lista de próximos eventos agrupados por día, formulario rápido "+ Agendar" (fecha, hora inicio/fin, persona, título, cliente y dirección opcionales, notas). **Detección de conflictos:** antes de guardar, revisa si esa misma persona ya tiene algo agendado ese día que se superponga en horario — si hay choque, avisa con el detalle y pide confirmación explícita antes de guardar igual (mismo patrón que el aviso de posible cobro duplicado, ver `decisiones.md` 2026-08-20).
- Pestaña "Calendario" agregada en Gustavo (`/g`) y Admin — visible para ambos, que es el punto central de la tarea (coordinar entre los dos).
- **Alexandra corrió `sql/20260825_eventos_calendario.sql`. Verificado de punta a punta 25/08/2026** (con eventos de prueba, borrados después, sin dejar rastro): se agendó un evento para Gustavo 09:00–10:00, y al intentar agendar otro superpuesto (09:30–10:30) para la misma persona, apareció el aviso exacto con el detalle del choque ("Gustavo ya tiene algo agendado ese día a esa hora: 09:00–10:00 (...)"); al confirmar igual, el segundo evento se guardó también. Ambos visibles en la lista, agrupados por día, con horario/título/persona.
- `tsc --noEmit` limpio, `init.sh` en verde. **2.6 cerrado del todo. Nivel 2 completo.**

### Visión ampliada de Alexandra, 25/08/2026 — al ver la app en producción

Todavía sin construir, escrito acá para no perder el hilo (viene de una sola conversación larga, se agrupa por tema). Idea general que los une: **"un cliente debe vivir organizado toda su vida dentro de su creación"** — presupuesto → pago → factura → obra → garantía, todo cruzado y consultable desde un solo lugar, en vez de que Gustavo tenga que salir de la app a buscar algo en Drive o en su teléfono.

| # | Qué | Detalle |
|---|---|---|
| 2.7 | **Media a nivel CLIENTE (no solo obra)** | Distinto de 2.5: son las fotos/videos que el cliente le manda a Gustavo por WhatsApp *antes* de que exista una obra — hoy viven en el teléfono de Gustavo o en Drive, y armar el presupuesto requiere que él salga de la app, entre a la cuenta de Drive correcta (engorroso en iPhone) y vuelva. La idea es que esas fotos vivan junto al pendiente/conversación de ese cliente, con el contexto (lo que el cliente escribió), para que Gustavo arme el presupuesto sin salir de la app. |
| 2.8 | **Galería navegable para archivos ya adjuntos a un pendiente** | Hoy los archivos subidos a un pendiente (`drive_links`) se muestran como una lista de texto ("Archivo 1", "Archivo 2"...) — cada uno hay que abrirlo aparte. Cambiar a una vista tipo galería (miniaturas, pasar de una foto a la siguiente sin volver atrás) — aplica tanto para lo que el cliente manda (ver 2.7) como para lo que Alexandra le sube a Gustavo al crear un pendiente. |
| 2.9 | **`referencia` (ID) en presupuestos por etapas** | **Código listo 25/08/2026, sin migración (la columna ya existía desde 1.1)** — El presupuesto simple ya genera un ID `HRM-XXXXX` (desde antes de esta sesión) y lo guarda (1.1); el presupuesto por etapas (`PresupuestoEtapas.tsx`) nunca lo tuvo — sus filas en "Mis presupuestos" no mostraban referencia. |
| 2.10 | **Varias interacciones por pendiente, no pregunta→respuesta única** | **Código listo 25/08/2026, bloqueado en Alexandra corriendo `sql/20260825_pendiente_mensajes.sql`** — Alexandra confirmó que lo quiere como un hilo tipo chat. |
| 2.11 | **Botón "Convertir en obra" desde la tarjeta del presupuesto** | **✅ Hecho y verificado 25/08/2026** — El flujo ya existía (2.3: "Nueva obra" deja elegir un presupuesto aceptado); esto agrega el atajo directo desde la propia tarjeta del presupuesto. |
| 2.12 | **Comprobante de pago adjunto a cada abono** | **Código listo 25/08/2026, bloqueado en Alexandra corriendo `sql/20260825_abonos_comprobante.sql`** — cierra el círculo de "toda la plata de un cliente, con su comprobante, en un solo lugar". |
| 2.13 | **Nuevo tipo de pendiente "Solicitud de garantía"** | **Código listo 25/08/2026, bloqueado en Alexandra corriendo `sql/20260825_pendientes_solicitud_garantia.sql`** — se conecta con `estado_obra='en_garantia'` (2.4). |
| 2.14 | **"Agregar compra" solo ofrece obras reales — falta "Stock" y "Trabajo puntual"** (pedido de Alexandra, 25/08, al usar Reporte Diario) | El desplegable "Obra" de una compra solo lista obras activas — una compra de material para tener a mano (stock) o para un trabajo chico sin obra formal no tiene dónde ir hoy. Alexandra ya anticipó correctamente que el catálogo de stock real y que la IA lea la foto de la boleta son Nivel 3 (3.1/3.3) — este ítem es solo la categorización mínima, para que la compra quede etiquetada bien mientras tanto. |

**Alexandra eligió empezar por 2.7+2.8 juntas (25/08/2026) — construidas.**

### Detalle de 2.7 + 2.8 (sesión 25/08/2026)
- No hizo falta tabla nueva: el mecanismo real ("fotos/videos que manda el cliente, junto al pendiente/conversación") ya existía (`pendientes.drive_links`, y el `mensaje_cliente` ya se mostraba arriba) — el hueco real era de presentación: los archivos se mostraban como una lista de texto plano "Archivo 1, Archivo 2..." que había que abrir uno por uno.
- Componente nuevo compartido `GaleriaArchivos` (`src/components/GaleriaArchivos.tsx`): miniaturas en fila, clic abre un visor a pantalla completa con flechas para pasar de una a la siguiente (izquierda/derecha) y contador. Reemplazó los 5 lugares donde se listaban `drive_links` como texto (Gustavo.tsx ×3, Admin.tsx ×2) — `Irazu.tsx` quedó igual porque ya no está en uso (ruta desactivada).
- **Caso real encontrado al probar con los datos de "Rolando | Recoleta" (tu captura):** esos 5 archivos son links de Google Drive pegados a mano (de antes de que existiera la subida real), no imágenes servidas por la app — una URL de Drive no se puede usar directo como `<img src>`. Se agregó soporte especial: detecta un link de Drive y pide la miniatura pública que Drive expone para archivos compartidos, usándola tanto en la fila de miniaturas como en el visor grande.
- **Límite real, no un bug:** el endpoint de miniaturas de Google a veces falla o se vuelve más lento si se le pide el mismo archivo muchas veces seguidas (lo viví probándolo) — cuando eso pasa, esa foto puntual cae a un ícono genérico en vez de la miniatura, pero el link "Ver original en Drive" siempre queda disponible como respaldo, nunca rompe la pantalla. **Los archivos subidos de acá en adelante a través de la propia app (Supabase Storage, no Drive) no tienen este problema — se ven siempre.**
- `tsc --noEmit` limpio, `init.sh` en verde. Probado en navegador contra el pendiente real de "Rolando | Recoleta": miniaturas visibles, visor abre con navegación entre las 5, "Ver original en Drive" funcionando. No requiere ninguna migración SQL — no se tocó ningún dato, solo la forma en que se muestra lo que ya existía.

### Detalle de 2.9 (sesión 25/08/2026)
- `PresupuestoEtapas.tsx` ahora genera el mismo formato de referencia (`HRM-XXXXX`) que ya usaba el presupuesto simple, la imprime en el PDF (mismo lugar/estilo que el otro flujo: gris, debajo de la fecha) y la guarda en `presupuestos.referencia` al guardar. No hizo falta migración — la columna ya existía desde 1.1, es compartida por los dos tipos.
- De paso, el mensaje "Guardado en el historial" ahora muestra la referencia real, no solo un check genérico.
- `tsc --noEmit` limpio, `init.sh` en verde. **No se pudo probar en navegador**: `/itemizado` (la ruta de este flujo) exige login real de Supabase Auth, y no hay credenciales disponibles acá — es el mismo límite que ya existe para Admin.tsx, documentado en `CLAUDE.md`. El cambio replica exactamente el patrón ya verificado en `Presupuesto.tsx` (mismo formato de ID, mismo lugar en el PDF, mismo campo de Supabase), pero **falta que alguien con acceso a `/itemizado` (Gustavo o Alexandra) lo pruebe una vez real** antes de darlo por cerrado del todo.

### Detalle de 2.11 (sesión 25/08/2026)
- Sin tabla ni columna nueva — reusa `obras.presupuesto_id`/`presupuestos.estado`, ya construidos en 2.3. Botón "Convertir en obra" visible solo en presupuestos con estado "Aceptado", tanto en la tarjeta de la lista como en el modal de Detalle. Al hacer clic, se abre un formulario chico inline pidiendo solo el nombre de la obra (precompletado con la dirección del cliente si existe, editable) — el resto (cliente, monto, vínculo al presupuesto) se resuelve solo desde el presupuesto, igual que en "Nueva obra".
- Probado en navegador con un presupuesto de prueba marcado "Aceptado" (borrado después, sin dejar rastro): el precompletado tomó la dirección correcta, la obra se creó con `cliente`/`presupuesto_total`/`presupuesto_id` exactos, y el presupuesto quedó en `estado='convertido'` — verificado en Supabase.
- `tsc --noEmit` limpio, `init.sh` en verde. **2.11 cerrado del todo.**

### Detalle de 2.13 (sesión 25/08/2026)
- `solicitud_garantia` agregado a `TipoPendiente` — esta vez, a diferencia de la última, **el constraint de la base de datos se actualiza en la misma migración** que el tipo en el código (`sql/20260825_pendientes_solicitud_garantia.sql`), justamente para no repetir el bug real que pasó el 25/08 con `seguimiento`/`pedido_material` (ver `decisiones.md`). **Falta que Alexandra lo corra.**
- Agregado al desplegable de tipo cuando el destinatario es Gustavo (`TIPOS_GUSTAVO` en `Admin.tsx`) — Alexandra registra el reclamo del cliente, Gustavo es quien va a revisar qué se dañó.
- `Irazu.tsx` (código deshabilitado, ruta `/i` no está en uso) también se actualizó — no por necesidad funcional, sino porque comparte el tipo `TipoPendiente` y dejaba de compilar si no se completaba.
- `tsc --noEmit` limpio, `init.sh` en verde. **Falta correr la migración y confirmar con un insert real** (mismo tipo de verificación que se hizo la última vez con `pedido_material`, para no repetir el error de darlo por bueno sin probarlo).

### Detalle de 2.12 (sesión 25/08/2026)
- `sql/20260825_abonos_comprobante.sql`: agrega `comprobante_url` (nullable) a `abonos_cuenta`. **Falta que Alexandra lo corra.**
- Formulario de "Agregar abono" (`CuentaMiniCard` en `PanelesObra.tsx`, usado tanto en Obras como en el Detalle de cada obra) suma un botón "+ Comprobante" — sube la imagen/PDF al mismo bucket de Storage que ya usa el resto de la app, antes de guardar el abono. Cada abono ya cargado muestra un link "Ver comprobante" cuando tiene uno.
- Probado en navegador con una cuenta de prueba (borrada después): la subida del archivo funcionó de inmediato (no depende de la migración, es solo Storage); guardar el abono falló con el aviso esperado ("No se pudo guardar el abono") porque `comprobante_url` no existe todavía — comportamiento correcto, sin romper la pantalla.
- `tsc --noEmit` limpio, `init.sh` en verde.

### Detalle de 2.10 (sesión 25/08/2026)
- `sql/20260825_pendiente_mensajes.sql`: tabla nueva `pendiente_mensajes` (`pendiente_id` FK con `on delete cascade`, `autor` `'gustavo'|'irazu'`, `texto`). **Falta que Alexandra lo corra.**
- **Decisión de diseño importante:** no se tocó `pendientes.respuesta`/`estado` (el mecanismo de "respuesta final" + "marcar resuelto" que ya usan Gustavo y Admin todos los días) — el hilo es un agregado aparte, para el ida y vuelta que pasa *antes* de esa respuesta final. Menor riesgo de romper el flujo diario ya en uso que rediseñar el mecanismo existente.
- Componente nuevo compartido `HiloPendiente` (`src/components/HiloPendiente.tsx`): mensajes estilo chat (burbujas a la derecha para "mis" mensajes, izquierda para el otro lado), input + botón "Responder" que suma un mensaje sin cerrar el pendiente. Si el pendiente ya tenía una `respuesta` vieja (de antes de que existiera el hilo) y todavía no tiene mensajes nuevos, se muestra como el primer mensaje de solo lectura — no se pierde el historial viejo.
- Agregado como pestaña nueva "Hilo" en la tarjeta de pendiente activo de Gustavo (`PendienteCardGustavo`), y como sección persistente en la tarjeta de Admin (`PendienteCard`).
- **Alcance: solo en las tarjetas de pendiente ACTIVO**, no en las vistas de historial de cliente de solo lectura (`HistorialCliente`/`PanelClientes` en Gustavo.tsx, `HistorialModal` en Admin.tsx) — se puede sumar ahí después si hace falta, quedó fuera para no tocar más superficie de la necesaria.
- `tsc --noEmit` limpio, `init.sh` en verde. Probado en navegador (Gustavo, pendiente de prueba con destinatario='gustavo', borrado después): pestaña "Hilo" carga sin errores que rompan la pantalla, muestra "Sin mensajes todavía" (falla silenciosa esperada porque la tabla no existe aún). **Falta correr la migración y probar mandando un mensaje real de punta a punta.**

---

### Detalle de 2.1 (sesión 25/08/2026)
- `sql/20260825_presupuestos_estado.sql` — agrega `estado` a `presupuestos` (`'borrador'|'enviado'|'aceptado'|'convertido'`, default `'borrador'`). **Falta que Alexandra lo corra.**
- Los dos flujos que guardan presupuestos (`Presupuesto.tsx` y `PresupuestoEtapas.tsx`) ahora ponen `estado: 'enviado'` explícitamente al guardar — hoy un presupuesto solo se guarda en el momento de generar el PDF (no hay borrador previo), así que "generado" ya equivale a "listo para el cliente".
- **De paso, `PresupuestoEtapas.tsx` (el flujo con login) ahora también resuelve `cliente_id`** vía el mismo upsert de `clientes` que ya se usaba en `Presupuesto.tsx` desde 1.1 — no estaba cubierto por esa tarea porque es un flujo aparte, pero es el mismo principio (FK real, no texto suelto) y ya se estaba tocando esa misma función para el estado.
- Componente nuevo compartido `PanelPresupuestos` en `PanelesObra.tsx`: lista todos los presupuestos (ambos tipos), buscable por nombre de cliente, cada uno con un selector para cambiar su estado manualmente. Pestaña "Mis presupuestos" agregada tanto en Gustavo (`/g`) como en Admin (por visibilidad — Alexandra también necesita verlos, mismo criterio que Obras/Pago semanal/Estado de resultados).
- **Alexandra corrió `sql/20260825_presupuestos_estado.sql`. Verificado 25/08/2026:** columna `estado` confirmada vía MCP; probado en navegador (Gustavo → "Mis presupuestos") — aparecen los presupuestos reales ya guardados (Gustavo Castillo, Patricio Zamora, etc.) con cliente, fecha, tipo, monto y el selector de estado, todos en `'borrador'` (correcto: son filas viejas, no se les forzó `'enviado'` retroactivo). Sin errores en consola. No se tocó ningún dato real durante la prueba.
- `tsc --noEmit` limpio, `init.sh` en verde. **2.1 cerrado del todo.**

### Detalle de 2.14 (sesión 25/08/2026)
- `sql/20260825_compras_destino.sql`: agrega `destino` (nullable, `'stock'|'trabajo_puntual'`) a `reportes_compras`. **Falta que Alexandra lo corra.**
- **`obra` no se tocó** — sigue significando exactamente lo mismo que siempre (una obra real o nada), así ningún cálculo que agrupa/filtra compras por obra se ve afectado. `destino` solo se llena cuando `obra` queda vacío a propósito, para explicar por qué.
- El desplegable "Obra" del formulario de compras (`Reporte.tsx`) ahora suma dos opciones al final de la lista de obras reales: "📦 Stock (sin obra todavía)" y "🔧 Trabajo puntual (sin obra)". Elegir una limpia `obra` y guarda el `destino` correspondiente.
- **Alcance deliberadamente chico** — esto es solo la categorización. El catálogo de stock real (cantidades, movimientos de entrada/salida) y que la IA lea la foto de la boleta son Nivel 3 (3.1/3.3 abajo), Alexandra ya lo anticipó correctamente en la conversación — no se adelantó nada de eso acá.
- `tsc --noEmit` limpio, `init.sh` en verde. Probado en navegador antes de correr la migración: las dos opciones nuevas aparecen en el desplegable, sin errores en consola.

## Nivel 3 — la parte más transformadora

| # | Qué | Depende de |
|---|---|---|
| 3.1 | Material con foto + IA: nueva función `/api/parse-factura.js` (mismo patrón que `parse.js`, pero lee una imagen en vez de texto) — Gustavo sube la foto de la boleta desde "Compras del día" (Reporte Diario) y se auto-completa material/cantidad/monto | Subida de archivos (ya existe) |
| 3.2 | Desglose por ítem (`obra_items`) + avance diario (`avances_diarios`) + barra de progreso semanal, junto a Pago Semanal | 2.2 |
| 3.3 | Stock de materiales real: catálogo + movimientos (compra_obra / compra_stock / uso / sobrante_a_stock) — **2.14 ya deja la compra categorizada como `'stock'`, lista para que esto la consuma** | 3.1 en parte |
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
