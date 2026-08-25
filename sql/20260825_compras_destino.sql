-- Pedido de Alexandra (25/08): el desplegable de "Agregar compra" en Reporte Diario solo
-- ofrece obras reales -- Gustavo necesita poder categorizar una compra como "Stock" (material
-- comprado para tener a mano, sin obra todavía) o "Trabajo puntual" (algo chico sin presupuesto
-- ni obra formal), en vez de dejarla sin ninguna etiqueta.
--
-- Alcance: solo esto -- categorizar la compra. El catálogo de stock real (cantidades,
-- movimientos) y que la IA lea la foto de la boleta son tareas más grandes de Nivel 3
-- (3.1/3.3 en propuesta_arquitectura_operativa.md), no se construyen acá.
--
-- `destino` nullable y separado de `obra` a propósito: `obra` sigue significando exactamente
-- lo mismo que siempre (una obra real o nada), así no se rompe ningún cálculo que ya agrupa o
-- filtra compras por obra. `destino` solo se usa para explicar POR QUÉ una compra no tiene obra
-- cuando es a propósito (no un olvido).
--
-- Pegar en Supabase → SQL Editor → Run.

alter table reportes_compras add column if not exists destino text
  check (destino in ('stock', 'trabajo_puntual'));
