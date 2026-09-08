-- Pregunta de Alexandra (08/09/2026): "¿y qué pasa si el trabajador está asignado a más de
-- una obra?". Hoy `trabajadores.obra_asignada_id` guarda UNA sola, así que el link de
-- /obra-fotos queda fijo a esa obra o, si está vacío, le muestra todas las que están en
-- curso. No hay punto medio, y Misael y Samuel se mueven entre obras.
--
-- Esta tabla permite asignar varias. Reglas de lectura, en este orden:
--   1. Si el trabajador tiene filas acá, ve exactamente esas obras.
--   2. Si no tiene ninguna pero sí `obra_asignada_id`, sigue viendo esa (no se rompe nada
--      de lo ya cargado).
--   3. Si no tiene ni una cosa ni la otra, ve todas las obras en curso, como hasta ahora.
--
-- `obra_asignada_id` se deja donde está: no se borra ni se migra a la fuerza. Cuando alguien
-- asigne obras desde la pantalla nueva, esta tabla pasa a mandar para ese trabajador.

create table if not exists trabajador_obras (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  trabajador_id uuid not null references trabajadores(id) on delete cascade,
  obra_id uuid not null references obras(id) on delete cascade,
  unique (trabajador_id, obra_id)
);

create index if not exists idx_trabajador_obras_trabajador on trabajador_obras(trabajador_id);

alter table trabajador_obras enable row level security;

-- Mismo patrón que el resto de las tablas del negocio en este proyecto. Ojo: sigue abierta
-- la conversación de fondo sobre reemplazar esto por control de acceso real (ver
-- progress/estado_actual.md, punto de seguridad del 28/08).
drop policy if exists "anon full access" on trabajador_obras;
create policy "anon full access" on trabajador_obras for all using (true) with check (true);
