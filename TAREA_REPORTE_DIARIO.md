# Tarea: Reporte Diario de Obra — nueva funcionalidad

## Contexto (por qué)
Horma Electricidad usa esta app (`horma-presupuestos-v2`) para presupuestos. Aparte, existe un
Control de Obra en Google Sheets (hojas: Horas, Gasto en Materiales, Cobrado, Rentabilidad por Obra,
Cuánto pagar chicos, etc. — spreadsheet "Control de Obra - Horma",
ID `1vh1h4nU9g7gFWpdqLDw8NJcwvSiDryfbmzEqidmckOM`) que se actualiza hoy a mano, interpretando mensajes
de WhatsApp de Gustavo (dueño/técnico) que llegan en texto libre y ambiguo (ej. "Henrri 5 días 4 días
de viaticos" sin decir qué día faltó exactamente). Eso generó varios errores de interpretación
durante esta primera semana de uso.

Se decidió: en vez de seguir parseando WhatsApp a mano, construir una pantalla nueva DENTRO de esta
app donde Gustavo reporte el día con campos estructurados (no texto libre), para eliminar la
ambigüedad de raíz. Gustavo ya tiene el link/token de esta app guardado — no es una herramienta nueva
que aprender.

## ⚠️ NO TOCAR
El endpoint `/api/parse` y el modo "IA" de `src/components/ItemForm.tsx` están en uso activo para
generar presupuestos (el negocio los usa hoy en producción). Cualquier cambio para esta tarea debe
ser aditivo — nueva tabla, nuevo componente, nueva ruta — sin modificar ese flujo existente.

## Qué construir: pantalla "Reporte diario"
Nueva ruta (ej. `/reporte?t=TOKEN`, mismo patrón de auth por token compartido en la URL que ya usan
`/g` (Gustavo) y `/i` (Irazú) — ver `src/pages/Gustavo.tsx` e `Irazu.tsx`) donde Gustavo, una vez al
día, reporta con campos reales (no cuadros de texto libre):

- **Trabajadores**: lista fija con checkbox "ausente hoy" (default: todos presentes, coincide con el
  protocolo ya acordado — Gustavo solo avisa ausencias). Roster conocido: Alejandro, Fabriel, Henry,
  Manuel, Misael, Samuel.
- **Obra por trabajador** (o por grupo, ej. "equipo Limache" vs "equipo Santiago"): dropdown con las
  obras activas. Obras conocidas hoy: Ohiggins 126 Limache, Doctora Eloísa (dirección 5843), Doctora
  Eloísa - Obra 1 (dirección 5860), Luisi Carrera, Renato Sanches.
- **Compras del día**: sección repetible (descripción del material/ítem + monto + obra a la que
  corresponde). Importante: siempre pedir descripción, no solo el monto (varias compras ya
  registradas quedaron sin detalle porque Gustavo solo mandó el número).
- **Cobros del día**: sección repetible (obra, cliente, monto).
- **Caso especial ya conocido — Fabriel**: tiene sueldo fijo mensual + bono (no tarifa diaria), su
  reporte solo debe capturar asistencia + viático, nunca inventar un monto de "sueldo del día" para él.
- **Adelantos/pagos a trabajadores**: campo opcional para registrar cuando se le paga algo a alguien
  ese día (adelanto o pago de semana).

## Modelo de datos sugerido
Nueva tabla en Supabase, ej. `reportes_diarios` — **NO reutilizar la tabla `pendientes`** (es de otro
dominio, tareas de presupuesto/cobranza). Estructura sugerida: una fila por trabajador por día
(fecha, trabajador, obra, presente bool, fracción de jornada, adelanto_pagado), más una tabla o
columna JSON separada para compras del día (descripción, monto, obra) y otra para cobros del día
(obra, cliente, monto).

## Paso aparte (no bloquea construir la pantalla): sincronizar a Google Sheets
Los datos que Gustavo cargue acá eventualmente deben reflejarse en la hoja "Horas" (y las demás) de
la Google Sheet "Control de Obra - Horma" mencionada arriba. Eso es un puente técnico aparte —
opciones a evaluar cuando se llegue a esa etapa: Google Apps Script leyendo Supabase por API, un
webhook desde Supabase, o un script intermedio. No es necesario resolverlo para construir la pantalla.

## Patrones reutilizables del código existente
- `src/pages/Gustavo.tsx`: tarjetas grandes, fallback de nota de voz (MediaRecorder → Supabase
  Storage `audio-notas`) — buen patrón de UX para que sea fácil de usar desde el celular en la obra.
- Auth simple por token en la URL (`VITE_GUSTAVO_TOKEN` / `VITE_IRAZU_TOKEN` en env vars) — reusar el
  mismo mecanismo para la ruta nueva, no hace falta login real.
- `src/components/ItemForm.tsx` tiene un patrón de "modo manual" con inputs discretos (no texto
  libre) que sirve de referencia visual, aunque los campos concretos son distintos (categoría/precio
  de presupuesto vs. trabajador/obra/compra de reporte diario).

## Mensaje para iniciar la próxima conversación
Lee `TAREA_REPORTE_DIARIO.md` en esta carpeta (`horma-presupuestos-v2`) y ayúdame a construir la
pantalla de Reporte Diario que describe ahí. No toques `/api/parse` ni el modo IA de `ItemForm.tsx`
— están en uso activo para presupuestos.
