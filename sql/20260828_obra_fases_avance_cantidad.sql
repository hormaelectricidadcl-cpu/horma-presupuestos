-- Segunda vuelta de "Avance de obra", después de conversar con Alexandra sobre cómo
-- funciona una carta Gantt de verdad (Procore como referencia real del rubro):
--
-- 1. `obra_items.completado` (booleano, hecho/no hecho) no sirve para "12 de 50 centros
--    eléctricos instalados" -- se reemplaza por `cantidad_completada` (numérica, parcial).
-- 2. `obra_fases` nueva: una fila por fase de la obra (no por ítem -- decisión tomada con
--    Alexandra: agendar fase por fase, no ítem por ítem), con fecha de inicio/fin -- eso
--    es lo que se dibuja como barra en la vista semanal.
--
-- Mismo patrón "anon full access" de siempre.
--
-- Pegar en Supabase → SQL Editor → Run.

-- Se agrega la columna nueva y se rellena DESDE completado antes de borrarlo, para no
-- perder el avance que ya se haya cargado con el checkbox de la versión anterior
-- (confirmado el 28/08: "Alexandra prueba 10" ya tenía 22 ítems marcados completado=true).
alter table obra_items add column if not exists cantidad_completada numeric not null default 0;
update obra_items set cantidad_completada = cantidad where completado = true and cantidad_completada = 0;
alter table obra_items drop column if exists completado;

create table if not exists obra_fases (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  obra_id uuid not null references obras(id) on delete cascade,
  nombre text not null,
  orden integer not null default 0,
  fecha_inicio date,
  fecha_fin date,
  unique (obra_id, nombre)
);

alter table obra_fases enable row level security;

create policy "anon full access" on obra_fases for all to anon using (true) with check (true);
