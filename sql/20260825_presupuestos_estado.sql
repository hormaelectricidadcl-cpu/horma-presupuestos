-- Migración para tarea 2.1 de progress/propuesta_arquitectura_operativa.md:
-- pestaña "Mis presupuestos" en el panel de Gustavo, con estado (borrador -> enviado ->
-- aceptado -> convertido en obra).
--
-- Default 'borrador' a nivel de columna (por si en el futuro se guarda un presupuesto antes de
-- generarlo, ej. autosave) -- pero el código de la app pasa a poner 'enviado' explícitamente al
-- guardar, porque hoy un presupuesto solo se guarda en Supabase EN EL MOMENTO de generar el PDF
-- (no existe un guardado previo/borrador todavía) -- generar el PDF, en la práctica, ya es
-- "listo para mandarle al cliente".
--
-- Pegar en Supabase → SQL Editor → Run.

alter table presupuestos add column if not exists estado text not null default 'borrador'
  check (estado in ('borrador', 'enviado', 'aceptado', 'convertido'));
