-- Backfill necesario para que la ficha de cliente (sql/20260826_clientes_facturacion.sql)
-- no "pierda" clientes reales al pasar la fuente de la lista de `pendientes.cliente_nombre`
-- a la tabla `clientes` directamente.
--
-- Hallazgo real durante la construcción (26/08, verificado contra Supabase real):
-- `clientes` hoy prácticamente no tiene filas reales -- solo se llena cuando alguien pasa
-- por el presupuesto simple/por etapas o por el flujo de "+Pendiente" de Admin. En cambio
-- `pendientes.cliente_nombre` tiene 31 nombres de clientes reales distintos, ninguno con fila
-- en `clientes`. Si el nuevo panel de Clientes lee solo de `clientes` sin este backfill,
-- esos 31 clientes reales desaparecerían de la lista de un día para otro -- no es lo que
-- Alexandra pidió (pidió que apareciera CUALQUIER cliente, no menos que antes).
--
-- Este backfill es solo-agregar (`on conflict do nothing`), no toca ninguna fila existente
-- de `clientes` ni de `pendientes`. Correr DESPUÉS de sql/20260826_clientes_facturacion.sql
-- (aunque no depende de esas columnas nuevas, mantiene el orden lógico del cambio).
--
-- Pegar en Supabase → SQL Editor → Run.

insert into clientes (nombre)
select distinct cliente_nombre
from pendientes
where cliente_nombre is not null and trim(cliente_nombre) <> ''
on conflict (nombre) do nothing;
