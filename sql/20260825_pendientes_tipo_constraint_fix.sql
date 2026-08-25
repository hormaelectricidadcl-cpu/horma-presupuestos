-- Fix de un bug real encontrado el 25/08/2026 al verificar la tarea 1.4: el constraint de
-- `pendientes.tipo` en la base de datos nunca se actualizó cuando se agregaron los tipos
-- 'seguimiento' y 'pedido_material' al código esta misma sesión (24-25/08, ver "Ya hecho" en
-- propuesta_arquitectura_operativa.md). Resultado: crear un pendiente de "Pedido de material" o
-- "Seguimiento" falla hoy en producción con un error de constraint -- confirmado con una
-- simulación directa contra Supabase (insert real, con tipo='seguimiento', rechazado).
--
-- No afectó a nadie todavía: el último pendiente real en la tabla es de mayo, antes de que
-- existieran estos dos tipos -- nadie llegó a intentar crear uno.
--
-- Pegar en Supabase → SQL Editor → Run.

alter table pendientes drop constraint pendientes_tipo_check;

alter table pendientes add constraint pendientes_tipo_check
  check (tipo = ANY (ARRAY[
    'confirmar_visita'::text, 'revisar_fotos'::text, 'presupuesto'::text, 'otro'::text,
    'emitir_boleta'::text, 'emitir_factura'::text, 'cobro'::text,
    'seguimiento'::text, 'pedido_material'::text
  ]));
