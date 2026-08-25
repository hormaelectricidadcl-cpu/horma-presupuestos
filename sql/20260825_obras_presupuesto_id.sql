-- Migración para tarea 2.3 de progress/propuesta_arquitectura_operativa.md:
-- gate "no se crea obra sin presupuesto asociado" -- toda obra nueva queda vinculada a un
-- presupuesto real (FK), en vez de repetir cliente/monto sueltos a mano.
--
-- Nullable a propósito: las 6 obras que ya existen no tienen presupuesto vinculado y no se
-- puede inventar cuál les corresponde -- se quedan con presupuesto_id = null, tal como decía
-- el principio de no migrar el historial viejo. El gate solo aplica para obras nuevas de acá
-- en adelante (se hace cumplir en la app, no con un NOT NULL -- eso rompería las 6 filas viejas).
--
-- Pegar en Supabase → SQL Editor → Run.

alter table obras add column if not exists presupuesto_id uuid references presupuestos(id);
