-- Tabla de tarifas por trabajador (para calcular el costo real de mano de
-- obra por obra, hoy solo vivía en la Google Sheet, no en la app).
create table if not exists trabajadores (
  id uuid primary key default gen_random_uuid(),
  nombre text not null unique,
  tarifa_diaria numeric not null default 0,
  viatico_diario numeric not null default 0
);

alter table trabajadores enable row level security;
create policy "anon full access" on trabajadores for all to anon using (true) with check (true);

insert into trabajadores (nombre, tarifa_diaria, viatico_diario) values
  ('Alejandro', 30000, 10000),
  ('Fabriel', 0, 10000),
  ('Henry', 50000, 10000),
  ('Manuel', 35000, 10000),
  ('Misael', 35000, 0),
  ('Samuel', 30000, 0)
on conflict (nombre) do nothing;

-- Distinguir un adelanto real (a cuenta de lo que falta pagar) de un pago
-- semanal completo (liquidación de la semana) — hoy se guardaban ambos en
-- el mismo campo "adelanto_monto" sin diferenciarse, lo que hacía confuso
-- saber cuánto quedaba pendiente si alguien pedía un adelanto real a mitad
-- de semana.
alter table reportes_diarios add column if not exists tipo_pago text not null default 'adelanto' check (tipo_pago in ('adelanto', 'pago_semanal'));
