-- Migración para tarea 2.6 de progress/propuesta_arquitectura_operativa.md:
-- calendario compartido de disponibilidad, para que Gustavo, Alexandra y quien esté
-- trabajando puedan ver/confirmar horas ocupadas y no agendar una visita técnica encima de
-- algo que ya estaba agendado.
--
-- Versión liviana a propósito (decisión ya conversada): `persona` es un nombre de una lista
-- fija (Gustavo, Alexandra, los trabajadores de siempre), no una cuenta con login real -- eso
-- queda para 4.1 (login real por persona), no bloquea el problema real de la doble agenda
-- detrás de una feature más grande.
--
-- Pegar en Supabase → SQL Editor → Run.

create table eventos_calendario (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  fecha date not null,
  hora_inicio time not null,
  hora_fin time not null,
  persona text not null,
  titulo text not null,
  cliente_nombre text,
  direccion text,
  notas text,
  check (hora_fin > hora_inicio)
);

alter table eventos_calendario enable row level security;

-- Mismo modelo de confianza que el resto de la app: el token/password de cada panel es el
-- control de acceso real, no RLS.
create policy "anon full access" on eventos_calendario for all to anon using (true) with check (true);
