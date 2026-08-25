-- Migración para tarea 1.4 de progress/propuesta_arquitectura_operativa.md:
-- FK real a `clientes` en `pendientes`, para todo registro nuevo de acá en adelante.
-- No se migra el historial viejo (`cliente_nombre` como texto) -- es un paso aparte, más
-- delicado, que hay que hacer con cuidado contra los datos reales (ver principios de
-- propuesta_arquitectura_operativa.md).
--
-- Pegar en Supabase → SQL Editor → Run.

alter table pendientes add column if not exists cliente_id uuid references clientes(id);
