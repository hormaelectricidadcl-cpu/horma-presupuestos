-- Tracking de "facturado" por obra, separado de "cobrado" (reportes_cobros).
-- Facturado = plata que ya se emitió en factura, haya entrado o no todavía.
-- Cobrado = plata que efectivamente entró (puede haber entrado como abono
-- antes de facturarse, o después). "Por facturar" no se guarda: se calcula
-- como presupuesto_total de la obra menos la suma de facturas.
create table if not exists facturas (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  fecha date not null,
  obra text,
  monto numeric not null
);

alter table facturas enable row level security;
create policy "anon full access" on facturas for all to anon using (true) with check (true);
