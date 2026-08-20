# Decisiones ya tomadas — no re-litigar
> Cada entrada: qué se decidió, por qué, y fecha. Si algo cambia, se agrega una entrada nueva con la fecha del cambio — no se borra la vieja.

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
