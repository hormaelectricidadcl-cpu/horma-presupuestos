-- Idea de Gustavo (08/09/2026): "cuando voy al taller del auto, la factura que me entregan
-- no es desglosada, dice 'factura del presupuesto tal'. Eso ayudaría a hacer más rápido las
-- facturas y tendría un orden en la relación factura-presupuesto".
--
-- Lo que se toma de esa idea es el VÍNCULO, que es lo que hoy no existe: una factura cargada
-- no sabe de qué presupuesto salió, así que no hay forma de responder "¿este presupuesto ya
-- está facturado?" ni "¿qué falta facturar?". Con esta columna, la factura queda pegada a su
-- presupuesto y las dos pantallas lo pueden mostrar.
--
-- (Sobre poner solo "según presupuesto X" como descripción en la factura misma: el SII pide
--  que el detalle sea suficientemente preciso, así que eso es tema del contador, no de la
--  app. La factura electrónica tiene un campo de Referencia propio para el número de
--  presupuesto, que es donde corresponde ponerlo.)
--
-- Nullable a propósito: hay facturas que no nacen de un presupuesto guardado (un trabajo
-- puntual, algo cargado antes de que existiera el presupuestador), y las que ya están
-- cargadas quedan sin vínculo hasta que alguien lo complete a mano.

alter table cliente_facturas
  add column if not exists presupuesto_id uuid references presupuestos(id) on delete set null;

comment on column cliente_facturas.presupuesto_id is
  'Presupuesto que esta factura/boleta está cobrando. Nullable: no toda factura nace de un presupuesto guardado.';

create index if not exists idx_cliente_facturas_presupuesto on cliente_facturas(presupuesto_id);
