-- "Avance de obra": ítems copiados del presupuesto (simple o por etapas) al momento de
-- convertir el presupuesto en obra. Cada ítem se puede marcar como completado desde la
-- pestaña Obras, para llevar avance real contra lo presupuestado -- primer paso hacia
-- algo tipo carta Gantt más adelante, sin comprometerse a esa parte todavía.
--
-- Los presupuestos "externos" (PDF/foto subida, sin detalle línea por línea) no generan
-- ítems -- la obra queda igual, simplemente sin esta card.
--
-- Mismo patrón "anon full access" de siempre: el token/password de cada panel es el
-- control de acceso real, no RLS.
--
-- Pegar en Supabase → SQL Editor → Run.

create table if not exists obra_items (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  obra_id uuid not null references obras(id) on delete cascade,
  fase text,              -- nombre de la etapa si el presupuesto era "por etapas"; null si era "simple"
  descripcion text not null,
  categoria text,          -- categoria del item simple, o "MO"/"MAT" si venía de etapas
  cantidad numeric not null default 1,
  precio_unitario numeric not null default 0,
  total numeric not null default 0,
  completado boolean not null default false,
  orden integer not null default 0
);

alter table obra_items enable row level security;

create policy "anon full access" on obra_items for all to anon using (true) with check (true);
