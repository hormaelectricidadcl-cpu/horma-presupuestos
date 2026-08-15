-- Cuentas por cobrar: reemplaza la hoja de Excel donde Ignacio (u otro pagador)
-- tenía un "Total Presupuesto" y varios "Abono 1..5" a mano por cada concepto.
-- Editable desde la app: crear cuenta, agregar/quitar abonos, eliminar cuenta —
-- para que Gustavo no dependa de una planilla más.
create table if not exists cuentas_por_cobrar (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  pagador text not null,
  concepto text not null,
  obra text,
  total_presupuesto numeric not null,
  activa boolean not null default true
);

create table if not exists abonos_cuenta (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  cuenta_id uuid not null references cuentas_por_cobrar(id) on delete cascade,
  fecha date not null,
  monto numeric not null
);

-- Gastos fijos (sueldo de Fabriel, etc.) y variables (combustible, software, etc.)
-- + el contrato TOTAL de cada subcontratista (no solo lo pagado hasta ahora) —
-- necesarios para calcular el Estado de Resultados mensual y la rentabilidad
-- real por obra.
create table if not exists gastos_fijos (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  concepto text not null,
  categoria text,
  monto_mensual numeric not null,
  activo boolean not null default true,
  observaciones text
);

create table if not exists gastos_variables (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  fecha date not null,
  categoria text,
  descripcion text,
  monto numeric not null
);

create table if not exists subcontratos_master (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  subcontratista text not null,
  obra text,
  trabajo text,
  total_contrato numeric not null
);

alter table cuentas_por_cobrar enable row level security;
alter table abonos_cuenta enable row level security;
alter table gastos_fijos enable row level security;
alter table gastos_variables enable row level security;
alter table subcontratos_master enable row level security;

create policy "anon full access" on cuentas_por_cobrar for all to anon using (true) with check (true);
create policy "anon full access" on abonos_cuenta for all to anon using (true) with check (true);
create policy "anon full access" on gastos_fijos for all to anon using (true) with check (true);
create policy "anon full access" on gastos_variables for all to anon using (true) with check (true);
create policy "anon full access" on subcontratos_master for all to anon using (true) with check (true);
