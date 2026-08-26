-- Comprobantes de pago semanal (pedido de Alexandra, ver progress/tareas.md 26/08):
-- cada fila de trabajador en "Pago semanal" puede subir la captura del comprobante bancario.
-- La IA (functions/api/parse-comprobante.js) lee el monto de la captura y se compara contra
-- el monto ya calculado por la app -- si no coinciden se avisa con un badge, sin bloquear el
-- guardado (decisión ya tomada con Alexandra).
--
-- Se guarda por nombre de trabajador (texto), no por FK -- mismo criterio que ya usa
-- `reportes_diarios.trabajador` y que ya usa `PanelPagoSemanal` para cruzar por nombre.
--
-- Pegar en Supabase → SQL Editor → Run.

create table pago_semanal_comprobantes (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  trabajador text not null,
  semana_key text not null,
  captura_url text not null,
  monto_leido numeric,
  monto_calculado numeric
);

alter table pago_semanal_comprobantes enable row level security;

-- Mismo modelo de confianza que el resto de la app: el token de cada panel es el control de
-- acceso real, no RLS.
create policy "anon full access" on pago_semanal_comprobantes for all to anon using (true) with check (true);
