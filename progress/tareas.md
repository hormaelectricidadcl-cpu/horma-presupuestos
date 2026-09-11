# Tareas pendientes
> Estados: 🔲 pendiente · 🔄 en progreso · ✅ hecho (mover a estado_actual.md como resumen y borrar de acá cuando se confirme)
> Contexto del rediseño grande del 20/08 → ver decisiones.md. Sesión del 02-03/09 (orden de clientes en 5 fases, caso real de Alexis) → ver estado_actual.md, ya cerrada y sin pendientes bloqueantes.

---

# PLAN PARA LA PRÓXIMA SESIÓN — armado el 11/09/2026, actualizado el mismo día tras confirmar con Gustavo
que las compras van con factura y los subcontratistas no facturan ni boletean

> Todo del 09 al 11/09 (los primeros 10 commits, hasta `ce16915`) está en producción y verificado.
> Esto es lo que sigue, en el orden en que conviene hacerlo. El porqué de cada punto está en `decisiones.md`.
> **Nada de este bloque se ejecutó todavía** -- es plan puro, para la próxima sesión.

## BLOQUE 0 — Datos, sin código. No depende de mí y son minutos
Son los que hacen que los números de la app dejen de mentir.

1. **Pedirle a Gustavo los PDF de los presupuestos que hizo desde el teléfono antes del arreglo.**
   Él dijo: "he creado bastantes desde aquí, pero no aparecen todos... yo me los envío yo mismo". La app
   tiene 9 presupuestos en total, así que hay plata ya cotizada que no está en ningún sistema. Se suben con
   Mis presupuestos → "+ Cargar presupuesto externo", y si alguno es adicional de una obra, se engancha ahí
   mismo. Cuanto más pase el tiempo, menos va a recordar cuáles eran.
2. **Cargar el contrato de Cristian** en "Pasaje rinconada 8948" (Detalle → Subcontratistas). Hasta que esté,
   su saldo y su margen no reflejan lo que se le debe. Ojo: si Horma compra los materiales, ese monto es
   **solo su mano de obra** — las compras van aparte y contarlas dos veces empeora la obra.
3. **Ponerle precio a los 2 materiales viejos** del catálogo ("Filtro para Ale", "Cable 2.5"). Sin precio, al
   entregarlos no le suman costo a ninguna obra y el margen sale inflado. Stock ya lo avisa.
4. **Borrar los datos de prueba:** cliente "Gustavo prueba borrar" + sus 2 presupuestos, la obra "Gustavo
   prueba" (marcada con IVA), y los 3 clientes de prueba pendientes desde el 08/09.
5. **Categoría en los ítems de las tres obras grandes** (O'Higgins, Camino turístico, Geronimo — 66 ítems
   entrados como PDF externo, sin categoría). Mientras no la tengan, su avance mezcla trabajo y materiales.
   Hay un selector por ítem en Avance de obra.

## BLOQUE 1 — LA CORRECCIÓN FISCAL: costos en NETO, y REVERTIR el +19% de bodega de ayer
Ver `decisiones.md` 2026-09-11 (revisado) para el detalle completo y los números verificados. Resumen:

Gustavo confirmó que **todas las compras de materiales van con factura** (el IVA se recupera, no es costo
real) y que **los subcontratistas no facturan ni boletean** (su pago sí es costo completo, sin ajuste).

Eso significa que el arreglo de ayer ("sumarle 19% al material que sale de bodega") quedó al revés: igualaba
la bodega hacia arriba, hacia el bruto de las compras directas, cuando el bruto era el número equivocado.
Hay que:

1. **Revertir el ×19% del vale de bodega** (`guardarVale` en `PanelesObra.tsx`, y su preview "neto + IVA =
   subtotal"). El material vuelve a valorizarse a su precio neto tal cual está en el catálogo.
2. **Dividir por 1,19 las compras directas** (`gastoCompras`) al calcular `saldo` y `margen` en
   `calcularResumenObras`. `gastoSubcontratos` **no cambia** — ahí el monto completo ya es el costo real.
3. **Separar "cuánto salió del banco" de "cuánto costó de verdad".** La tarjeta "Compras" debería seguir
   mostrando el bruto (para cuadrar caja); margen y saldo usan el neto por dentro. Decidir en la ejecución si
   se muestran los dos números o uno con una nota, como ya se hace con "IVA a apartar".
4. **Agregar una explicación visible en la app** — pedido explícito de Alexandra: "definitivamente tenemos
   que meter la parte fiscal y contable". Un texto breve cerca del margen: los materiales se cuentan sin IVA
   porque se recuperan vía factura; los subcontratistas se cuentan completos porque no facturan. Mismo
   patrón que la ayuda que ya existe para "IVA a apartar" y el tour de Avance de obra.
5. **Verificar contra Supabase, obra por obra**, como todo lo de plata. Ya está precalculado el impacto sobre
   los datos del 11/09 (antes de cargar nada nuevo): el margen sube en las 5 obras activas, **+$817.221** en
   total — O'Higgins +$415.325, Camino turístico +$266.161, Pasaje rinconada +$97.684, Geronimo Alderete
   +$38.051, Luis Carrera +$0. Esta plata no es nueva: ya la ganaron: la app la estaba contando como gastada.

**Riesgo a revisar antes de aplicar:** se confirmó que las compras RECIENTES llevan IVA en el monto (razón
monto/desglose = 1,19 casi exacta). No se revisó compra por compra las más viejas. Vale una pasada rápida
por las 44 antes de aplicar el cambio, o aplicarlo y corregir la que aparezca rara.

## BLOQUE 2 — PDF consolidado del vigente
Un PDF que muestre **presupuesto original + adicionales = total vigente**.

Es lo que Gustavo pidió y no tuvo respuesta: "en vez de 14 son 17... eso que se sumaron, ¿cómo se los muestro
al cliente?". Hoy el PDF de un adicional lleva solo el adicional, así que para cobrarlo hay que explicarle al
cliente de palabra cómo se llegó al total. **Es lo único que bloquea cobrar un adicional sin discusión.**
Los datos ya están: original, adicionales enganchados por `origen_id`, y sus ítems.

## BLOQUE 3 — Compras pagadas por Gustavo y su reembolso
Lo pidió él mismo y el mecanismo se impone solo: "si yo hago unas compras y yo no cargo, entonces no me van a
transferir". Su ejemplo: gastó $2.100.000 con su tarjeta de crédito y le transfieren eso.

Existe a medias: `reportes_compras` ya tiene quién pagó y si fue reembolsada, y hay tarjeta "Por reembolsar".
Pero **de 44 compras, 43 figuran como de la empresa** y solo 1 tiene pagador (Fabriel). Falta que sea fácil
marcarlo al cargar, y una vista de cuánto se le debe a Gustavo esta semana.

## BLOQUE 4 — Gastos variables desde el Reporte Diario, con lectura por IA
Necesita una decisión ANTES de construir. Pedido de Gustavo: hoy solo se cargan desde el Estado de
Resultados y él vive en el Reporte Diario ("es lo que más uso, yo estoy cargando toda vaina ahí"). El
criterio es correcto: la herramienta va donde está el hábito.

**Pero primero hay que decidir la regla de qué va dónde**, porque la confusión ya existe: Combustible, Peaje,
Herramientas, Trompo y Cortadora de cerámica están cargados como **compras contra una obra**, mientras
`gastos_variables` tiene su propia categoría "Combustible". Si se agrega el botón sin resolver esto, quedan
dos botones al lado que hacen cosas parecidas y se elige mal. La regla ya existe escrita en la ayuda del
Estado de Resultados ("los gastos fijos y variables son de toda la empresa, no de una obra"), solo que no se
ve donde se carga.

Lo que hay que construir, una vez decidida la regla:
- **Sección en el Reporte Diario**, igual que Compras o Subcontratos — trabajo conocido, mismo patrón.
- **Migración chica**: `gastos_variables` no tiene campo para el comprobante. Agregarlo, como ya lo tienen
  las compras.
- **Lector por IA**: hay patrón (`parse-comprobante.js` ya lee monto y fecha de un comprobante de
  transferencia), pero una boleta de bencina no es lo mismo y necesita su propio prompt.
- **Ojo**: las Cloudflare Functions no se pueden probar en local en este proyecto — la función nueva queda
  sin verificar hasta que alguien la use en producción. Decirlo explícito al entregar, no asumir que
  "probablemente funciona".

*Arreglo barato que se puede hacer ya, sin decidir nada: poner esa frase de la regla donde se carga una
compra, para frenar que sigan entrando peajes como materiales de obra.*

## BLOQUE 5 — Bitácora de cambios por obra y por cliente
Idea de Alexandra (10/09), pensada para cuando haya más volumen: una línea de tiempo por obra/cliente que
diga qué cambió y cuándo (se sumó un adicional, se cargó un subcontrato, se marcó con IVA), con clic para ir
a ese momento. Hoy el único rastro de un cambio es que el número cambió, sin decir cuándo ni por qué —
encontrado varias veces esta semana (el pago mal cargado a Gabriel, el objetivo del 25% que se sacó).

## BLOQUE 6 — Barra de avance por adicional
Pedido de Gustavo: "de los adicionales se te van tachando, pero debería aparecer... el avance del presupuesto
adicional". Hoy el avance del trabajo mezcla original y adicionales en un solo porcentaje. Los ítems ya están
agrupados por fase ("Adicional HRM-..."), así que el dato existe — falta mostrar la barra por grupo. Barato.

## DECISIONES ABIERTAS (no son tareas, son preguntas a responder)

- **¿Qué hacer con los materiales duplicados por nombre?** Ya hay dos brocas iguales de proveedores distintos
  ("BROCA SDS PLUS 4P 6 X 210MM HEMIC" y "BROCA SDS PLUS 6 X 260 KAVE"). Gustavo lo anticipó: "vamos a tener
  1.500 tipos de cables cuando usamos 10". El catálogo se llena con el nombre literal de la boleta.
- **¿Qué quiso decir Gustavo con "no quiero que salga WhatsApp, web"?** Abierta desde el 08/09. Podría cambiar
  la prioridad de mandar presupuestos por correo.
- ~~¿Las compras son con factura o con boleta?~~ **RESUELTA el 11/09: con factura, siempre.** Ver Bloque 1.
- ~~¿Los subcontratistas facturan?~~ **RESUELTA el 11/09: no, ni factura ni boleta, por ahora.** Su costo no
  se ajusta.

## ANOTADO, SIN PRIORIDAD (no construir salvo que se pida)

Poder **modificar** un adicional (hoy solo se borra) · catálogo de servicios en el presupuestador (el código
está comentado esperando reconexión a BD) · aviso en "+ Agregar cuenta", que le reemplaza el presupuesto a
una obra que va por el campo (Alexis, Camino turístico y Geronimo) · "Crear adicionales" también en el
detalle de la obra · correo al cliente desde la ficha (**0 de 43 clientes tienen correo cargado** — capturar
correos antes de construir el envío).

> **Límite que puso Alexandra el 11/09 y conviene respetar:** "no podemos sumar tantas vainas tampoco
> nosotros... si las opciones son infinitas, la gente va a pensar infinitamente". De unos 20 pedidos se
> construyeron 8 hasta ahora. El resto está acá a propósito, sin construir hasta que se pida.

---

# PENDIENTES ANTERIORES (siguen abiertos)

## 🔲 Borrar cobro real de $700 (error de tipeo), obra Camino turístico 11474, 01/09/2026
`reportes_cobros` id `456af00b-cbd6-433d-94f5-5358d62441d0`, fecha 29/08/2026, cliente "Francisca", monto $700 — le faltaban tres ceros (debía ser $700.000). Gustavo ya cargó el monto correcto como fila nueva el 01/09, pero la fila mala nunca se borró, así que "Facturado" en esa obra queda $700 de más. Se puede borrar desde Reporte Diario → fecha 29/08/2026 → Cobros del día → "✕ Quitar". Sin confirmar/ejecutar todavía.

## 🔲 Probar en producción: Archivar todos los "Listo" (Admin → Gustavo), 01/09/2026
Feature nueva construida (migración `sql/20260901_pendientes_archivado.sql`, ya corrida) para sacar ~35 clientes viejos de la vista "Gustavo" sin borrar nada. No se pudo probar en vivo desde acá (Admin.tsx no corre en Vite local). Confirmar que el botón funciona y que Patricia Marambio no queda archivada por error.

## 🔲 Archivar a Alejandro — confirmado 28/08/2026 que ya no trabaja con Horma
Gustavo confirmó que Alejandro ya no trabaja con ellos. Se ofreció archivarlo desde la card de Trabajadores (botón "Archivar" ya existe). Confirmar con Alexandra si ya lo hizo ella o si hace falta hacerlo.

## 🔴 URGENTE — Seguridad de fondo, conversación iniciada 28/08/2026 (ver `estado_actual.md` para el detalle completo)
Alexandra preguntó directamente si "con Supabase estamos seguros" es cierto. Verificado en vivo: casi todas las tablas del negocio tienen política RLS `"anon full access"` (lectura/escritura total para cualquiera con la clave pública del proyecto, sin login real). No es que la plataforma sea insegura — es que la configuración actual de esta app no tiene una barrera real más allá de que nadie busque la clave. Orden acordado para resolver:
1. **Backups — RESUELTO.** Supabase pasó a plan Pro el 31/08, backups diarios activos. Storage (fotos/comprobantes) sigue sin backup — cuidado ahí.
2. **Cerrar el `list` público del bucket `audio-notas`** (mantener la lectura pública de un archivo puntual) — propuesto, todavía sin hacer.
3. Conversación aparte sobre reemplazar "anon full access" por control de acceso real — cambio de fondo, no se toca sin plan y sin hablarlo primero con Alexandra/Gustavo.

## 🔲 Descarga/borrado masivo de fotos por obra cerrada
Pedido de Alexandra: bajar todas las fotos/videos de una obra de una vez y después borrarlas de Supabase para liberar espacio. Descarga masiva se puede armar del lado del cliente sin problema. **Borrado masivo bloqueado a propósito:** el bucket `audio-notas` solo tiene políticas `SELECT`/`INSERT` para `anon`, no `DELETE` — agregarla agranda el hueco de seguridad del punto anterior. Antes de construir esto, decidir con Alexandra el modelo de acceso.

## 🔲 Avance de obra (carta Gantt) — seguimiento pendiente, 28/08/2026
- Confirmar con más casos reales que la IA de "presupuesto externo" lee bien el desglose de ítems (solo un caso probado hasta ahora).
- Probar la vista semanal tipo Gantt con una obra real que tenga fases con fecha de inicio y fin cargadas de punta a punta.
- Confirmar en producción que el rediseño de Admin.tsx se ve bien (nunca probado en vivo por el login de Cloudflare).
- Borrar a mano (opcional) el registro huérfano en `clientes` ("Familia Rojas Test2").

## 🔲 Verificar en producción el sync a Google Sheets
`sync-compras.js` / `sync-cobros.js` / `sync-subcontratos.js` no se pudieron probar en local (sin wrangler/pages dev). Falta confirmar en la planilla "Control de Obra - Horma" que las filas nuevas aparecen bien.

## 🔲 Falta el presupuesto real de "Doctora Eloísa (dirección 5843)"
Está "sin definir" en el sistema — pedírselo a Gustavo/Alexandra y cargarlo con "✎ editar" en Obras. Una vez cargado, migrarla al sistema unificado de cuentas.

## 🔲 Seguridad Supabase — RLS deshabilitado
7 tablas sin RLS. `notas_rapidas` y `tareas_clientes` SÍ son de esta app — activar RLS con política `anon` `using(true)` es seguro y bajo riesgo. Las 5 tablas `seo_*` NO son de esta app — necesitan que Alexandra decida antes de tocarlas.

## 🔲 Confirmar teléfono en variables de entorno
`GUSTAVO_WHATSAPP`/`ALEXANDRA_WHATSAPP` en `.env` apuntan al teléfono viejo de la sociedad anterior. Sin confirmar desde el 14/08.

## 🔲 Unificar nombre de "Doctora Eloísa - Obra 1"
No es idéntico entre la app (`dirección 5860`) y Sheets (`dirección pendiente`). No rompe cálculos hoy, conviene unificar antes de confiar en hojas que agrupan por obra.

## 🔲 Anomalías de Google Sheets
Distinta fuente de verdad — Alexandra las va a pasar en otra sesión.

## 🔲 (Opcional, sin decidir) Conexión de Power BI directa a Supabase
Alternativa a Google Sheets, sin el riesgo de "dos copias que se desincronizan". Ofrecido, no decidido.
