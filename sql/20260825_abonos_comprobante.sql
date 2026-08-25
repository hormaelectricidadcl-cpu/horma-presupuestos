-- Migración para tarea 2.12 de progress/propuesta_arquitectura_operativa.md:
-- comprobante de pago (captura del depósito) adjunto a cada abono de una cuenta por cobrar --
-- hoy un abono es solo fecha + monto, sin nada que respalde que la plata realmente llegó.
--
-- Reusa el bucket de Storage que ya existe (`audio-notas`), mismo patrón que el resto de la
-- app -- no hace falta crear nada nuevo en Supabase aparte de esta columna.
--
-- Pegar en Supabase → SQL Editor → Run.

alter table abonos_cuenta add column if not exists comprobante_url text;
