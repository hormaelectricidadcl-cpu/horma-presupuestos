-- Presupuesto externo: uno hecho fuera de la app (PDF/foto), cargado a mano con
-- cliente + monto + estado + archivo, sin desglose de ítems/etapas.
--
-- Confirmado contra Supabase real (information_schema.columns + pg_constraint,
-- solo lectura) ANTES de escribir esto: el constraint CHECK de presupuestos.tipo
-- se llama efectivamente `presupuestos_tipo_check` (no se adivinó -- la sesión
-- pasada un nombre de constraint mal supuesto rompió `pendientes` en producción,
-- ver sql/20260825_pendientes_tipo_constraint_fix.sql).
--
-- Pegar en Supabase → SQL Editor → Run.

alter table presupuestos drop constraint presupuestos_tipo_check;

alter table presupuestos add constraint presupuestos_tipo_check
  check (tipo = ANY (ARRAY['simple'::text, 'etapas'::text, 'externo'::text]));

alter table presupuestos add column if not exists archivo_url text;
