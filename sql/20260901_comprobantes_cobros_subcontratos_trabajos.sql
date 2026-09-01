-- Permite subir una captura (comprobante/foto) en Cobros del día, Subcontratos y
-- Trabajo puntual del Reporte Diario -- mismo criterio que ya existía para la foto
-- de boleta de Compras (20260825_compras_foto_boleta.sql) y el comprobante de
-- abonos (20260825_abonos_comprobante.sql). Solo guarda el archivo, sin lectura por IA.
--
-- Pegar en Supabase → SQL Editor → Run.

alter table reportes_cobros add column if not exists comprobante_url text;
alter table reportes_subcontratos add column if not exists comprobante_url text;
alter table reportes_trabajos_puntuales add column if not exists comprobante_url text;
