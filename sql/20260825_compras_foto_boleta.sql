-- Migración para tarea 3.1 de progress/propuesta_arquitectura_operativa.md, paso 1:
-- IA que lee la foto de la boleta y completa descripción + monto de una compra.
--
-- De paso, se guarda la URL de la foto en la propia compra -- mismo principio que el
-- comprobante de pago de los abonos (2.12): una compra con su respaldo fotográfico real, no
-- solo el monto tipeado a mano.
--
-- Pegar en Supabase → SQL Editor → Run.

alter table reportes_compras add column if not exists foto_boleta_url text;
