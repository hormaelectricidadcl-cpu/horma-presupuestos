-- Ampliación del Reporte Diario: subcontratos y trabajos puntuales.
-- Aditivo, no toca las tablas existentes (reportes_diarios, reportes_compras, reportes_cobros, pendientes).
-- Pegar en Supabase → SQL Editor → Run.

create table if not exists reportes_subcontratos (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  fecha date not null,
  obra text,
  subcontrato text not null,
  monto numeric not null
);

create table if not exists reportes_trabajos_puntuales (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  fecha date not null,
  descripcion text not null,
  direccion text,
  trabajador text
);

alter table reportes_subcontratos enable row level security;
alter table reportes_trabajos_puntuales enable row level security;

create policy "anon full access" on reportes_subcontratos for all to anon using (true) with check (true);
create policy "anon full access" on reportes_trabajos_puntuales for all to anon using (true) with check (true);
