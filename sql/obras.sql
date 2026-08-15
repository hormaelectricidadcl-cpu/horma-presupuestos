-- Tabla maestra de obras: fuente única de verdad para nombres de obra,
-- cliente y presupuesto total. El Reporte Diario deja de tener la lista
-- de obras escrita a mano en el código — la lee de acá.

create table if not exists obras (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  nombre text not null unique,
  cliente text,
  presupuesto_total numeric,
  activa boolean not null default true
);

alter table obras enable row level security;
create policy "anon full access" on obras for all to anon using (true) with check (true);

insert into obras (nombre, cliente) values
  ('Ohiggins 126 Limache', null),
  ('Doctora Eloísa (dirección 5843)', 'Doctora Eloísa'),
  ('Doctora Eloísa - Obra 1 (dirección 5860)', 'Constructora Altos Robles (Ignacio)'),
  ('Luisi Carrera', 'Constructora Altos Robles (Ignacio)'),
  ('Renato Sanches', 'Constructora Altos Robles (Ignacio)')
on conflict (nombre) do nothing;
