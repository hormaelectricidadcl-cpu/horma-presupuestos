-- Bodega con vales de entrega. Sale de la conversación con Gustavo del 09/09.
--
-- El problema: Gustavo compra materiales en bloque, muchas veces para varias obras en una
-- sola boleta, y no va a hacer una factura por obra en la caja del proveedor ("nooh, mucho
-- trabajo"). Con el modelo de hoy -- donde una compra pertenece a UNA obra
-- (`reportes_compras.obra`) -- eso obliga a elegir una obra al momento de pagar, que es
-- justo cuando todavía no se sabe.
--
-- La salida es separar la COMPRA de la ASIGNACIÓN: se compra a bodega sin obra, y la obra
-- se decide después, cuando el material sale de la oficina. Ese momento posterior es
-- exactamente el que Gustavo quiere controlar: el subcontratista pasa por la oficina y se
-- lleva lo de su obra con un vale. Y de paso deja medido, sin tener que discutirlo,
-- cuánto se compró de más: comprado − entregado = lo que quedó en bodega.
--
-- Buena parte ya existía y nadie la usaba (2 compras de 39 marcadas como "Stock", 2
-- materiales, CERO salidas). Lo que faltaba es lo de acá.

-- 1. A quién se le entregó. Sin esto no hay vale que Cristian o Fabriel puedan reconocer;
--    el movimiento sabía a qué obra fue, pero no en manos de quién salió.
alter table movimientos_stock
  add column if not exists receptor text;

comment on column movimientos_stock.receptor is
  'A quién se le entregó el material (subcontratista o trabajador). Solo en movimientos de salida; es lo que convierte el movimiento en un vale de entrega.';

-- 2. Precio al que se movió, guardado EN EL MOVIMIENTO y no solo en el material.
--    A propósito histórico: si el costo se leyera del catálogo, una compra nueva más cara
--    reescribiría hacia atrás lo que costó una obra ya cerrada. Acá cada salida queda
--    valorizada con el precio que tenía cuando salió, y no se mueve nunca más.
alter table movimientos_stock
  add column if not exists precio_unitario numeric;

comment on column movimientos_stock.precio_unitario is
  'Precio unitario con el que se valorizó este movimiento, congelado al momento de ocurrir. El costo de materiales que una obra recibe desde bodega es la suma de cantidad * precio_unitario de sus salidas.';

-- 3. Último precio conocido del material, para proponerlo al entregar y para poder mostrar
--    cuánta plata hay parada en la bodega. Es una referencia que se pisa con cada compra
--    nueva -- el dato que manda para el costo de una obra es el del movimiento, no este.
alter table materiales
  add column if not exists precio_unitario numeric;

comment on column materiales.precio_unitario is
  'Último precio unitario conocido (de la última compra o del inventario manual). Sirve para proponer un valor al entregar y para valorizar el stock; el costo real de cada salida queda congelado en movimientos_stock.precio_unitario.';

-- OJO al orden de adopción, que no es negociable: hasta que la app cuente las salidas de
-- bodega como costo de la obra, una compra marcada como "Stock" no le suma costo a NINGUNA
-- obra. Si Gustavo empezara a comprar todo a bodega antes de eso, el costo de materiales
-- desaparecería de las obras y el margen se vería mejor de lo que es -- justo al revés de
-- lo que se busca. El código de esta misma entrega ya cuenta las salidas; esta nota queda
-- para que no se separe una cosa de la otra si algún día se revierte.
--
-- Marcha atrás:
--   alter table movimientos_stock drop column if exists receptor;
--   alter table movimientos_stock drop column if exists precio_unitario;
--   alter table materiales drop column if exists precio_unitario;
