-- Tabla clientes — primer paso real de la Fase 1 de progress/propuesta_arquitectura_operativa.md.
-- Alcance deliberadamente chico: resuelve "archivar clientes viejos de la interfaz" (pedido de
-- Alexandra, 24/08/2026) y guarda los datos de facturación que pidió Gustavo (RUT, correo) — NO
-- migra todavía `obras`/`presupuestos`/`pendientes` a usar cliente_id como foreign key real, eso
-- es un paso aparte, más delicado, que hay que hacer con cuidado contra los datos reales.
--
-- Por ahora el cruce con `pendientes.cliente_nombre` es por texto exacto (nombre), no por FK --
-- es una solución transicional, no la arquitectura final. Un cliente nuevo no necesita fila acá
-- hasta que alguien lo archive o le cargue RUT/correo — se crea al vuelo (upsert) desde la app.
-- Pegar en Supabase → SQL Editor → Run.

create table if not exists clientes (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  nombre text not null unique,
  telefono text,
  email text,
  rut text,
  comuna text,
  archivado boolean not null default false,
  archivado_at timestamptz
);

alter table clientes enable row level security;

-- Mismo modelo de confianza que el resto de la app: el control de acceso lo hace el token/password
-- de cada panel, no Supabase Auth.
create policy "anon full access" on clientes for all to anon using (true) with check (true);
