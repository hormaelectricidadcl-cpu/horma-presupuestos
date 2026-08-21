# Tareas pendientes
> Estados: 🔲 pendiente · 🔄 en progreso · ✅ hecho (mover a estado_actual.md como resumen y borrar de acá cuando se confirme)
> Contexto del rediseño grande del 20/08 → ver decisiones.md.

## 🔲 Confirmar plan de Supabase (backups automáticos)
Conversación del 20/08: no está confirmado si el proyecto tiene el plan Pro de Supabase con backups automáticos activos. Dado que maneja plata real de nómina, prioridad alta — revisar en el dashboard de Supabase (Settings → Billing) y, si hace falta, subir de plan.

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
