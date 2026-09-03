# Tareas pendientes
> Estados: 🔲 pendiente · 🔄 en progreso · ✅ hecho (mover a estado_actual.md como resumen y borrar de acá cuando se confirme)
> Contexto del rediseño grande del 20/08 → ver decisiones.md. Sesión del 02-03/09 (orden de clientes en 5 fases, caso real de Alexis) → ver estado_actual.md, ya cerrada y sin pendientes bloqueantes.

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
