# Tareas pendientes
> Estados: 🔲 pendiente · 🔄 en progreso · ✅ hecho (mover a estado_actual.md como resumen y borrar de acá cuando se confirme)
> Contexto del rediseño grande del 20/08 → ver decisiones.md. Sesión del 02-03/09 (orden de clientes en 5 fases, caso real de Alexis) → ver estado_actual.md, ya cerrada y sin pendientes bloqueantes.

---

# PLAN PARA LA PRÓXIMA SESIÓN — armado el 11/09/2026

> Todo lo del 09 al 11/09 está en producción y verificado. Esto es lo que sigue, en orden.
> El porqué de cada decisión está en `decisiones.md`, entradas 2026-09-09 y 2026-09-11.

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

## BLOQUE 1 — Lo primero a construir: PDF consolidado del vigente
Un PDF que muestre **presupuesto original + adicionales = total vigente**.

Es lo que Gustavo pidió y no tuvo respuesta: "en vez de 14 son 17... eso que se sumaron, ¿cómo se los muestro
al cliente?". Hoy el PDF de un adicional lleva solo el adicional, así que para cobrarlo hay que explicarle al
cliente de palabra cómo se llegó al total. **Es lo único que bloquea cobrar un adicional sin discusión.**
Los datos ya están: original, adicionales enganchados por `origen_id`, y sus ítems.

## BLOQUE 2 — Lo que hace que Gustavo cargue las compras
**Compras pagadas por Gustavo y su reembolso.**

Lo pidió él mismo y el mecanismo se impone solo: "si yo hago unas compras y yo no cargo, entonces no me van a
transferir". Su ejemplo: gastó $2.100.000 con su tarjeta de crédito y le transfieren eso.

Existe a medias: `reportes_compras` ya tiene quién pagó y si fue reembolsada, y hay tarjeta "Por reembolsar".
Pero **de 44 compras, 43 figuran como de la empresa** y solo 1 tiene pagador (Fabriel). Falta que sea fácil
marcarlo al cargar, y una vista de cuánto se le debe a Gustavo esta semana.

## BLOQUE 3 — Necesita una decisión ANTES de construir
**Gastos variables desde el Reporte Diario, con lectura por IA.**

Pedido de Gustavo: hoy solo se cargan desde el Estado de Resultados y él vive en el Reporte Diario ("es lo
que más uso, yo estoy cargando toda vaina ahí"). El criterio es correcto: la herramienta va donde está el
hábito.

**Pero primero hay que decidir la regla de qué va dónde**, porque la confusión ya existe: Combustible, Peaje,
Herramientas, Trompo y Cortadora de cerámica están cargados como **compras contra una obra**, mientras
`gastos_variables` tiene su propia categoría "Combustible". Si se agrega el botón sin resolver esto, quedan
dos botones al lado que hacen cosas parecidas y se elige mal.

La regla ya existe escrita en la ayuda del Estado de Resultados ("los gastos fijos y variables son de toda la
empresa, no de una obra"), solo que no se ve donde se carga.

Además necesita **migración** (`gastos_variables` no tiene campo para el comprobante) y una **función de
Cloudflare nueva** para leer la boleta, que **no se puede probar en local** — queda sin verificar hasta
producción.

*Arreglo barato que se puede hacer ya, sin decidir nada: poner esa frase de la regla donde se carga una
compra, para frenar que sigan entrando peajes como materiales de obra.*

## DECISIONES ABIERTAS (no son tareas, son preguntas a responder)

- **¿Las compras se hacen con factura o con boleta?** Determina si el IVA de compra se recupera. Hoy la app
  no lo distingue, y el margen compara **venta neta contra costos con IVA**. Es una asimetría real, anotada a
  propósito el 11/09 y sin resolver. Si un día el margen parece bajo, viene de acá.
- **¿Qué hacer con los materiales duplicados por nombre?** Ya hay dos brocas iguales de proveedores distintos
  ("BROCA SDS PLUS 4P 6 X 210MM HEMIC" y "BROCA SDS PLUS 6 X 260 KAVE"). Gustavo lo anticipó: "vamos a tener
  1.500 tipos de cables cuando usamos 10". El catálogo se llena con el nombre literal de la boleta.
- **¿Qué quiso decir Gustavo con "no quiero que salga WhatsApp, web"?** Abierta desde el 08/09. Podría cambiar
  la prioridad de mandar presupuestos por correo.

## ANOTADO, SIN PRIORIDAD (no construir salvo que se pida)

Barra de avance por adicional · bitácora de cambios por obra y por cliente · poder **modificar** un adicional
(hoy solo se borra) · catálogo de servicios en el presupuestador (el código está comentado esperando
reconexión a BD) · aviso en "+ Agregar cuenta", que le reemplaza el presupuesto a una obra que va por el campo
(Alexis, Camino turístico y Geronimo) · "Crear adicionales" también en el detalle de la obra · correo al
cliente desde la ficha (**0 de 43 clientes tienen correo cargado** — capturar correos antes de construir el
envío).

> **Límite que puso Alexandra el 11/09 y conviene respetar:** "no podemos sumar tantas vainas tampoco
> nosotros... si las opciones son infinitas, la gente va a pensar infinitamente". De unos 18 pedidos se
> construyeron 8. El resto está acá a propósito, sin construir.

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
