# Tareas pendientes
> Estados: 🔲 pendiente · 🔄 en progreso · ✅ hecho (mover a estado_actual.md como resumen y borrar de acá cuando se confirme)

## 🔲 Verificar en producción el sync nuevo a Google Sheets
`sync-compras.js` / `sync-cobros.js` / `sync-subcontratos.js` (2026-08-20) no se pudieron probar en local (sin wrangler/pages dev). Falta: que alguien cargue un reporte diario real después del deploy y confirme en la planilla "Control de Obra - Horma" que las filas nuevas aparecieron bien (incluida la fila espejo en "Asignación Materiales" para compras).

## 🔲 Portar a Admin.tsx las funciones de obras que solo están en Gustavo.tsx
Crear obra nueva, editar cliente de una obra, tracking de facturado — viven en `PanelObras` dentro de `Gustavo.tsx`, no en el módulo compartido `PanelesObra.tsx`, porque en `Admin.tsx` la sección de obras está embebida en el componente gigante `Admin()` en vez de ser un componente aislado. Pendiente desde 2026-08-18.

## 🔲 Seguridad Supabase — RLS deshabilitado
7 tablas sin RLS. `notas_rapidas` y `tareas_clientes` SÍ son de esta app — activar RLS con política `anon` `using(true)` es seguro y bajo riesgo (no cambia el nivel real de exposición). Las 5 tablas `seo_*` NO son de esta app (comparten la misma base de datos con otra herramienta de Alexandra) — necesitan que ella decida qué hacer antes de tocarlas. Ver memoria `project_horma_app_stakes` para el detalle completo y el SQL de remediación.

## 🔲 Confirmar teléfono en variables de entorno
`GUSTAVO_WHATSAPP`/`ALEXANDRA_WHATSAPP` en `.env` apuntan al teléfono viejo de la sociedad anterior (9 5143 9958) — puede ser el celular personal real de Gustavo (uso interno) o un descuido. Sin confirmar desde el 14/08.

## 🔲 Unificar nombre de "Doctora Eloísa - Obra 1"
No es idéntico entre la app (`dirección 5860`) y la hoja "Obras"/"Horas" de Sheets (`dirección pendiente`). No rompe cálculos hoy (las fórmulas de Horas buscan por trabajador, no por obra) pero conviene unificar antes de confiar en hojas que sí agrupan por obra.
