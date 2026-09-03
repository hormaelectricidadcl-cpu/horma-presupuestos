-- Fase 4 del "orden" (03/09/2026): darle a "Boleta" el mismo tratamiento que ya tiene
-- "Factura" (subir archivo al marcar respondido, leer con IA, guardar en el historial
-- del cliente) sin duplicar toda la tabla/UI -- una boleta y una factura son el mismo
-- concepto (comprobante emitido a un cliente), solo cambia el tipo de documento.
alter table cliente_facturas add column if not exists tipo text not null default 'factura';
