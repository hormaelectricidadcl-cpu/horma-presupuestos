-- Pedido de Gustavo (conversación del 04/09/2026, notas de Alexandra del 07/09):
-- "cuando tengamos la obra, nosotros vamos a marcar: esta obra, ese precio, ¿es con IVA
-- o es sin IVA?". Sirve para dos cosas: dejar registrado cómo se pactó, y saber cuánta
-- plata de esa obra no es de ellos y hay que transferir a la cuenta de IVA.
--
-- No cambia ningún cálculo existente: el saldo, lo abonado y lo por abonar quedan igual.
-- Lo único que hace la marca es que aparezca una tarjeta con el IVA de lo presupuestado.
--
-- El presupuesto de una obra ya viene con IVA incluido (subtotal → +GG% → neto → +19%),
-- verificado contra los presupuestos reales HRM-MTN1YJRT y HRM-MTM3YB3N: el IVA guardado
-- coincide exacto con total × 19/119. Por eso la app calcula el IVA desde el total y no
-- se guarda ningún monto acá -- si el presupuesto cambia, el IVA se recalcula solo.
--
-- Arranca en false para todas las obras existentes: hay que marcarlas a mano, una por una,
-- porque cuál se pactó con IVA y cuál no es un dato que solo tienen Gustavo y Alexandra.

alter table obras add column if not exists con_iva boolean not null default false;

comment on column obras.con_iva is
  'El precio pactado de esta obra incluye IVA. Solo afecta la tarjeta "IVA a apartar" en el panel de Obras; no entra en ningún otro cálculo.';
