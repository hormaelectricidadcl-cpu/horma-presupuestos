-- Migración para tarea 1.1 de progress/propuesta_arquitectura_operativa.md:
-- que el presupuesto simple (`/`, sin login, protegido por token de URL) también guarde en
-- Supabase, igual que ya hace `PresupuestoEtapas.tsx` (con login).
--
-- Verificado contra el esquema real el 25/08/2026 (MCP supabase-horma, solo lectura):
-- `presupuestos` hoy solo tiene policies para el rol `authenticated` (INSERT con
-- auth.uid() = user_id, SELECT abierto). El presupuesto simple no tiene sesión de Supabase Auth
-- -- solo el token de la URL -- así que sin una policy nueva para `anon`, el insert falla por RLS.
-- Este script sigue el mismo modelo de confianza que el resto de la app (pendientes, obras,
-- reportes_*, clientes: "anon full access", el control de acceso real lo hace el token/password
-- de cada panel, no RLS) -- ver progress/decisiones.md.
--
-- Columnas nuevas:
--   cliente_id -- FK real a `clientes` (principio 1 de propuesta_arquitectura_operativa.md: nada
--                 de texto suelto donde debería haber una referencia real).
--   referencia -- el ID "HRM-XXXXX" que ya se genera y se imprime en el PDF, pero hasta ahora
--                 era client-side únicamente (no se guardaba en ningún lado).
--   items      -- jsonb con la lista plana de ítems del presupuesto simple (distinta forma de
--                 `etapas`, que es específico del flujo con login de PresupuestoEtapas.tsx).
--   tipo       -- 'simple' | 'etapas', para que Nivel 2.1 ("Mis presupuestos") pueda listar y
--                 renderizar los dos tipos sin adivinar la forma de los datos. Las 2 filas
--                 existentes (creadas por PresupuestoEtapas.tsx) quedan con el default 'etapas'.
--
-- Pegar en Supabase → SQL Editor → Run.

alter table presupuestos add column if not exists cliente_id uuid references clientes(id);
alter table presupuestos add column if not exists referencia text unique;
alter table presupuestos add column if not exists items jsonb;
alter table presupuestos add column if not exists tipo text not null default 'etapas'
  check (tipo in ('simple', 'etapas'));

create policy "anon full access" on presupuestos for all to anon using (true) with check (true);
