-- La otra mitad de los adicionales, y la que Gustavo explicó primero (conversación 04/09):
-- "se colocaron cuatro, están hechos tres, pero se agregaron dos más". Hoy el ítem de la
-- obra sigue diciendo 4, así que el avance se calcula contra una cantidad que ya no es la
-- real: marcar los 6 hechos es imposible, y el porcentaje miente.
--
-- Mismo criterio que ya se usó con el presupuesto y con las cuentas por cobrar: **lo
-- original no se toca**. `cantidad` queda como se presupuestó y los adicionales se suman
-- aparte, así siempre se puede ver "4 presupuestados + 2 adicionales = 6". Si se editara
-- `cantidad` directo se perdería la línea base y nadie podría responder después cuánto
-- creció la obra respecto de lo vendido.
--
-- Solo afecta la pantalla de avance: el dinero de un adicional sigue entrando por su
-- presupuesto de adicionales y su cuenta por cobrar, no por acá.

alter table obra_items
  add column if not exists cantidad_adicional numeric not null default 0;

comment on column obra_items.cantidad_adicional is
  'Cantidad que se sumó DESPUÉS de presupuestar (adicionales de obra). La cantidad total a ejecutar es cantidad + cantidad_adicional; `cantidad` nunca se edita para no perder la línea base.';
