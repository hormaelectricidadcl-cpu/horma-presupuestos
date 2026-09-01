-- Permite archivar un cliente en la pestaña "Gustavo" (pendientes ya respondidos) para
-- sacarlo de la vista sin borrar nada -- Alexandra pidió esto al ver clientes de hace
-- 4 meses (Rolando, Patricio, etc.) mezclados con el único activo real (Patricia
-- Marambio). Mismo patrón ya usado para trabajadores/clientes (archivado, no borrado).
--
-- Pegar en Supabase → SQL Editor → Run.

alter table pendientes add column if not exists archivado boolean default false;
