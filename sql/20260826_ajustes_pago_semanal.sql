-- Ajustes manuales por fila de "Pago semanal" (pedido de Alexandra, ver
-- progress/tareas.md 26/08 y el plan steady-purring-spring.md):
-- casos reales que el cálculo automático no puede resolver con una regla fija --
-- Fabriel trabajó un sábado y cobró $50.000 + $10.000 viático (la app solo le calcula
-- viático, es sueldo fijo); Henry y Alejandro cobraron menos una semana por una
-- corrección de la semana anterior. En vez de programar reglas frágiles para cada
-- caso, se resuelve con un ajuste manual (monto + motivo) por fila de trabajador/semana.
--
-- Se guarda por nombre de trabajador (texto) + semana_key, mismo criterio que ya usa
-- `pago_semanal_comprobantes` y que ya usa `PanelPagoSemanal` para cruzar por nombre.
--
-- Pegar en Supabase → SQL Editor → Run.

create table ajustes_pago_semanal (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  trabajador text not null,
  semana_key text not null,
  monto numeric not null, -- positivo o negativo
  motivo text not null
);

alter table ajustes_pago_semanal enable row level security;

-- Mismo modelo de confianza que el resto de la app: el token de cada panel es el control de
-- acceso real, no RLS.
create policy "anon full access" on ajustes_pago_semanal for all to anon using (true) with check (true);
