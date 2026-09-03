-- Fase 1 del orden pedido por Alexandra (02/09/2026): hoy `obras.cliente` y
-- `cuentas_por_cobrar.pagador` son texto libre -- el mismo cliente puede vivir con
-- nombres levemente distintos en cada tabla, sin ninguna forma de cruzarlos de verdad
-- (fue justo el problema real que apareció con Patricia Marambio / "Mga abogados ltda").
-- Esto agrega la columna real `cliente_id` (nullable, no rompe nada existente) y
-- rellena lo que ya se puede resolver por coincidencia exacta de nombre -- sin tocar
-- ni borrar el texto libre, que sigue existiendo como hasta ahora.

alter table obras add column if not exists cliente_id uuid references clientes(id);
alter table cuentas_por_cobrar add column if not exists cliente_id uuid references clientes(id);

update obras o
set cliente_id = c.id
from clientes c
where o.cliente_id is null
  and o.cliente is not null
  and lower(trim(o.cliente)) = lower(trim(c.nombre));

update cuentas_por_cobrar cc
set cliente_id = c.id
from clientes c
where cc.cliente_id is null
  and lower(trim(cc.pagador)) = lower(trim(c.nombre));

-- Excepción confirmada por Alexandra (02/09/2026): "Ignacio" en cuentas_por_cobrar es la
-- misma persona/cliente que "Constructora PSG" -- el nombre no calza exacto así que no lo
-- agarra el backfill genérico de arriba.
update cuentas_por_cobrar cc
set cliente_id = c.id
from clientes c
where cc.cliente_id is null
  and cc.pagador = 'Ignacio'
  and c.nombre = 'Constructora PSG';
