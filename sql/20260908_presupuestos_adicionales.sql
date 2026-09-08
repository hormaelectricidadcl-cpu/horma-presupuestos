-- Adicionales de obra. Pedido de Gustavo en la conversación del 04/09, con el detalle de
-- cómo trabaja: el ítem del presupuesto dice 4, se hicieron 3 y aparecieron 2 más, así que
-- ahora son 6. Él quiere partir del mismo presupuesto, agregar las líneas "Adicional"
-- debajo del ítem que corresponde (y las que no existían al final), y mandarle al cliente
-- un presupuesto nuevo con todo.
--
-- CÓMO SE MODELA, y por qué así (ver decisiones.md 2026-09-08):
-- El presupuesto original NUNCA se toca ni se reemplaza. Es el criterio de los sistemas de
-- job costing: el original queda como línea base y los adicionales son documentos aparte,
-- con su propio estado y monto. Se muestra original + adicionales aprobados = vigente.
-- Después de los primeros días de obra, comparar contra el original da números equivocados,
-- y en una discusión con el cliente lo que vale es el registro fechado de cada cambio.
--
-- Un adicional es entonces un presupuesto más, con `origen_id` apuntando al presupuesto del
-- que nació. Con eso:
--   * se reusa todo lo que ya existe: ítems, PDF con la marca, estados, Mis presupuestos;
--   * el histórico sale solo -- cada adicional tiene su fecha, su referencia y su estado;
--   * la obra encuentra sus adicionales por el presupuesto original al que está vinculada.
--
-- Ojo, a propósito: la PLATA de un adicional sigue entrando por `cuentas_por_cobrar`, que
-- es como Alexandra y Gustavo ya lo hacen a mano (Luis Carrera tiene tres cuentas: original,
-- materiales y "adicional a evaluar"). No se crea un segundo camino para el dinero -- esta
-- columna es solo el DOCUMENTO.

alter table presupuestos
  add column if not exists origen_id uuid references presupuestos(id) on delete set null;

comment on column presupuestos.origen_id is
  'Presupuesto del que nació este. Si está lleno, este presupuesto es un ADICIONAL del original; el original nunca se modifica.';

create index if not exists idx_presupuestos_origen on presupuestos(origen_id);
