# Decisiones ya tomadas — no re-litigar
> Cada entrada: qué se decidió, por qué, y fecha. Si algo cambia, se agrega una entrada nueva con la fecha del cambio — no se borra la vieja.

## 2026-08-20 — Cobro duplicado de $2.000.000 en Luis Carrera 2700, corregido
Al agregar "cobradoManual" (sumar reportes_cobros + abonos de cuentas manuales) se generó un doble conteo real: el pago de Ignacio del 5/08 estaba cargado DOS VECES — una vez como cobro de $2.000.000 en `reportes_cobros` (creado 18:53 del 15/08) y otra vez como dos abonos de $1.000.000 en la cuenta manual "Presupuesto original Luis Carrera" (creados 19:21 del 15/08, 28 min después, misma sesión de carga). Se borró la fila de `reportes_cobros` (quedan los 2 abonos manuales, que coinciden con el detalle que dio Gustavo). Cobrado real de esa obra: $3.016.150, no $5.016.150. **Se revisó el resto del sistema cruzando fecha+obra entre `reportes_cobros` y `abonos_cuenta` — este fue el único caso.**

**Lección para cualquier fix futuro que sume dos fuentes de la misma métrica:** antes de sumarlas, cruzar por fecha+obra+monto para descartar que sea el mismo pago cargado dos veces por error humano — no asumir que fuentes distintas son plata distinta.

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
