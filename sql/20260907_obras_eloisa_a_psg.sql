-- Corrección de datos pedida por Alexandra (07/09/2026):
-- "Doctora Eloísa Díaz es una dirección, y es una obra que es de Constructora PSG.
--  Todas esas deberían estar en el desplegable de Constructora PSG."
--
-- Situación actual, verificada antes de escribir esto:
--   * Las 6 cuentas por cobrar de Ignacio YA están bien, todas con cliente_id de
--     Constructora PSG -- incluida "Doctora Eloísa Días 5860" por $7.500.000.
--   * Pero las dos OBRAS "Doctora Eloísa" figuran con cliente_id de una ficha llamada
--     "Eloísa Díaz", que no es una clienta: es la dirección donde se hizo el trabajo.
--   * Por eso la plata de esas obras se veía repartida en dos fichas distintas, y en la
--     ficha de Constructora PSG aparecía una cuenta cuya obra decía ser de otra clienta.
--
-- Esto solo cambia a quién pertenecen esas dos obras. No toca montos, ni cobros, ni
-- compras, ni asistencia: los reportes se cruzan por el NOMBRE de la obra, que no cambia.

update obras
set cliente_id = (select id from clientes where nombre = 'Constructora PSG'),
    cliente = 'Constructora PSG'
where nombre in (
  'Doctora Eloísa - Obra 1 (dirección 5860)',
  'Doctora Eloísa (dirección 5843)'
);

-- Comprobación: las dos obras tienen que quedar bajo Constructora PSG.
select o.nombre, o.cliente, c.nombre as ficha_del_cliente
from obras o left join clientes c on c.id = o.cliente_id
where o.nombre like 'Doctora Eloísa%';

-- OPCIONAL, correr solo si la comprobación de arriba salió bien.
-- Después del update, la ficha "Eloísa Díaz" queda sin ninguna obra, presupuesto,
-- cuenta ni factura asociada -- era una dirección cargada como si fuera una clienta.
-- Descomentar para borrarla:
--
-- delete from clientes
-- where nombre = 'Eloísa Díaz'
--   and not exists (select 1 from obras where cliente_id = clientes.id)
--   and not exists (select 1 from presupuestos where cliente_id = clientes.id)
--   and not exists (select 1 from cuentas_por_cobrar where cliente_id = clientes.id)
--   and not exists (select 1 from cliente_facturas where cliente_id = clientes.id);
