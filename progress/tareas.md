# Tareas pendientes
> Ver decisiones.md 2026-08-20 "Rediseño: cuentas_por_cobrar pasa a ser la única fuente" para el contexto completo de las dos tareas de abajo.

## ✅ Merge visual de las pestañas "Obras" y "Cuentas por cobrar" en una sola
Hecho 2026-08-20: "Cuentas por cobrar" ya no existe como pestaña separada. `PanelObras` absorbió todo — el manejo de cuentas/abonos vive dentro de "Detalle" de cada obra (soporta más de una cuenta por obra), y las cuentas sin obra ("Visita Técnica") quedan en una sección "Otros cobros (sin obra)" al final de la pestaña Obras. Verificado en vivo.

## 🔲 Migrar Doctora Eloísa (5843) al sistema unificado cuando tenga presupuesto
Sigue en el camino viejo (`reportes_cobros`) porque no tiene `presupuesto_total` definido — no se puede crear su cuenta sin inventar el monto. Apenas alguien confirme el presupuesto real, migrar igual que se hizo con Ohiggins/Luz 2979 (crear cuenta, pasar el cobro de $233.750 a abono, verificar suma, borrar la fila vieja).
> Estados: 🔲 pendiente · 🔄 en progreso · ✅ hecho (mover a estado_actual.md como resumen y borrar de acá cuando se confirme)

## 🔲 Verificar en producción el sync nuevo a Google Sheets
`sync-compras.js` / `sync-cobros.js` / `sync-subcontratos.js` (2026-08-20) no se pudieron probar en local (sin wrangler/pages dev). Falta: que alguien cargue un reporte diario real después del deploy y confirme en la planilla "Control de Obra - Horma" que las filas nuevas aparecieron bien (incluida la fila espejo en "Asignación Materiales" para compras).

## ✅ Portar a Admin.tsx las funciones de obras que solo estaban en Gustavo.tsx
Hecho 2026-08-20: `PanelObras` se extrajo a `PanelesObra.tsx` como componente compartido, Admin.tsx ya no tiene su propia copia embebida.

## 🔲 Falta el presupuesto real de "Doctora Eloísa (dirección 5843)"
Está "sin definir" en el sistema — no se puede inventar el número, hay que pedírselo a Gustavo/Alexandra y cargarlo con el botón "✎ editar" en la pestaña Obras.

## 🔲 Seguridad Supabase — RLS deshabilitado
7 tablas sin RLS. `notas_rapidas` y `tareas_clientes` SÍ son de esta app — activar RLS con política `anon` `using(true)` es seguro y bajo riesgo (no cambia el nivel real de exposición). Las 5 tablas `seo_*` NO son de esta app (comparten la misma base de datos con otra herramienta de Alexandra) — necesitan que ella decida qué hacer antes de tocarlas. Ver memoria `project_horma_app_stakes` para el detalle completo y el SQL de remediación.

## 🔲 Confirmar teléfono en variables de entorno
`GUSTAVO_WHATSAPP`/`ALEXANDRA_WHATSAPP` en `.env` apuntan al teléfono viejo de la sociedad anterior (9 5143 9958) — puede ser el celular personal real de Gustavo (uso interno) o un descuido. Sin confirmar desde el 14/08.

## 🔲 Unificar nombre de "Doctora Eloísa - Obra 1"
No es idéntico entre la app (`dirección 5860`) y la hoja "Obras"/"Horas" de Sheets (`dirección pendiente`). No rompe cálculos hoy (las fórmulas de Horas buscan por trabajador, no por obra) pero conviene unificar antes de confiar en hojas que sí agrupan por obra.
