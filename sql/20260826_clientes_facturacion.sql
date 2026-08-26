-- Ficha de cliente para facturación + marketing (pedido de Alexandra, ver progress/tareas.md 26/08):
-- hoy `clientes` solo tiene datos de contacto -- se agregan campos de facturación (para emitir
-- boletas/facturas reales) y de marketing (cómo llegó el cliente, notas libres).
-- Todas nullable, sin default -- no rompe ningún insert/upsert existente que no las mande.
--
-- Pegar en Supabase → SQL Editor → Run.

alter table clientes
  add column razon_social text,
  add column giro text,
  add column direccion_fiscal text,
  add column origen text,
  add column notas text;
