-- Migración para tarea 3.1 de progress/propuesta_arquitectura_operativa.md, paso 2:
-- desglose por ítem de la boleta -- Alexandra probó el paso 1 con una boleta real y confirmó
-- que hacía falta esto: con varios materiales, la descripción los juntaba en una sola línea de
-- texto sin cantidades ni precios por ítem.
--
-- `reportes_compras` NO se toca (sigue siendo "una fila = una compra completa", el monto total
-- real de la boleta, para no afectar el Estado de Resultados) -- esto es una tabla aparte con
-- el detalle, que además deja la base lista para el paso 3 (stock real: catálogo +
-- movimientos, que va a leer estos ítems para saber qué materiales entraron).
--
-- Pegar en Supabase → SQL Editor → Run.

create table compra_items (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  compra_id uuid not null references reportes_compras(id) on delete cascade,
  descripcion text not null,
  cantidad numeric not null default 1,
  precio_unitario numeric not null
);

alter table compra_items enable row level security;

-- Mismo modelo de confianza que el resto de la app: el token/password de cada panel es el
-- control de acceso real, no RLS.
create policy "anon full access" on compra_items for all to anon using (true) with check (true);
