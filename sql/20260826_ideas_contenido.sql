-- Tabla nueva para "Ideas de contenido": Alexandra carga ideas ya pensadas (hook, formato,
-- tema) porque Gustavo sabe crear contenido pero no pensarlo para clientes finales -- él las ve
-- en su panel y solo puede marcarlas como hechas, no crear/editar/borrar.
--
-- Mismo patrón "anon full access" de siempre: el token/password de cada panel es el control de
-- acceso real, no RLS.
--
-- Pegar en Supabase → SQL Editor → Run.

create table if not exists ideas_contenido (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  titulo text not null,
  hook text,
  formato text,
  tema text,
  estado text not null default 'pendiente' check (estado in ('pendiente', 'hecho'))
);

alter table ideas_contenido enable row level security;

create policy "anon full access" on ideas_contenido for all to anon using (true) with check (true);
