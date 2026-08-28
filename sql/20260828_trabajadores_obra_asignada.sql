-- Restringe el link de /obra-fotos (Fabriel, Misael) a la obra que cada uno tenga
-- asignada, en vez de mostrarles un desplegable con TODAS las obras en curso.
-- Se asigna desde la card de Trabajadores. Si un trabajador no tiene obra asignada
-- (null), su link sigue mostrando el desplegable de todas -- no se rompe nada para los
-- que todavía no se hayan configurado.
--
-- Pegar en Supabase → SQL Editor → Run.

alter table trabajadores add column if not exists obra_asignada_id uuid references obras(id) on delete set null;
