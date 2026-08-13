-- Reporte Diario de Obra — nueva funcionalidad, aditiva.
-- No toca la tabla `pendientes` ni /api/parse.
-- Pegar completo en Supabase → SQL Editor → Run.

create table if not exists reportes_diarios (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  fecha date not null,
  trabajador text not null,
  presente boolean not null default true,
  obra text,
  fraccion_jornada numeric not null default 1,
  viatico boolean not null default false,
  adelanto_monto numeric,
  unique (fecha, trabajador)
);

create table if not exists reportes_compras (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  fecha date not null,
  descripcion text not null,
  monto numeric not null,
  obra text
);

create table if not exists reportes_cobros (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  fecha date not null,
  obra text,
  cliente text not null,
  monto numeric not null
);

alter table reportes_diarios enable row level security;
alter table reportes_compras enable row level security;
alter table reportes_cobros enable row level security;

-- Mismo modelo de confianza que el resto de la app: el control de acceso lo hace
-- el token en la URL (/reporte?t=...), no Supabase Auth — igual que ya está
-- abierto `pendientes` para que Gustavo/Irazú puedan leer/escribir con la anon key.
create policy "anon full access" on reportes_diarios for all to anon using (true) with check (true);
create policy "anon full access" on reportes_compras for all to anon using (true) with check (true);
create policy "anon full access" on reportes_cobros for all to anon using (true) with check (true);
