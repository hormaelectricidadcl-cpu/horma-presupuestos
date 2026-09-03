-- Registro de facturas realmente emitidas a un cliente (archivo + monto + fecha),
-- separado del pendiente que las recuerda (`pendientes` tipo emitir_factura) y de
-- `facturas` (tracking Facturado-vs-Cobrado por obra de construcción, sin tocar acá).
-- Se completa al marcar "Respondido" un pendiente de tipo emitir_factura.
create table if not exists cliente_facturas (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  cliente_id uuid references clientes(id),
  cliente_nombre text not null,
  pendiente_id uuid references pendientes(id),
  fecha date not null,
  monto numeric not null,
  archivo_url text
);

alter table cliente_facturas enable row level security;
create policy "anon full access" on cliente_facturas for all to anon using (true) with check (true);
