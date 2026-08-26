-- Adelantos a trabajadores con comprobante (pedido de Alexandra, ver
-- progress/tareas.md 26/08 y el plan steady-purring-spring.md):
-- hoy no hay dónde cargar un adelanto en efectivo/transferencia con su comprobante,
-- ni una forma de ver cuánto se le ha adelantado a alguien contra lo que le queda por
-- cobrar -- especialmente relevante para Fabriel, que cobra sueldo mensual fijo
-- (en `gastos_fijos`) en vez de tarifa diaria semanal como el resto.
--
-- Cómo resta según el tipo de trabajador (ver PanelPagoSemanal / PanelHistorialPagos):
-- si es semanal, sus adelantos de esa semana restan del Neto de esa fila; si es sueldo
-- fijo (Fabriel hoy), sus adelantos NO tocan la fila semanal -- se acumulan y se
-- muestran contra su sueldo mensual en el historial de pagos.
--
-- Se guarda por nombre de trabajador (texto), mismo criterio que el resto de esta app.
--
-- Pegar en Supabase → SQL Editor → Run.

create table adelantos_trabajador (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  trabajador text not null,
  fecha date not null,
  monto numeric not null,
  comprobante_url text,
  nota text
);

alter table adelantos_trabajador enable row level security;

-- Mismo modelo de confianza que el resto de la app: el token de cada panel es el control de
-- acceso real, no RLS.
create policy "anon full access" on adelantos_trabajador for all to anon using (true) with check (true);
