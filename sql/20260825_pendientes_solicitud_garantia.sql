-- Migración para tarea 2.13 de progress/propuesta_arquitectura_operativa.md:
-- nuevo tipo de pendiente "Solicitud de garantía", para cuando un cliente reporta que se le
-- dañó algo en una obra ya entregada -- se conecta con estado_obra='en_garantia' (2.4).
--
-- OJO: hay que actualizar el constraint de la base de datos a la vez que el tipo en el código
-- -- la última vez que se agregaron tipos nuevos (sesión 24-25/08) se actualizó el código pero
-- no el constraint, y crear un pendiente de esos tipos falló en producción hasta que se
-- encontró y arregló el 25/08 (ver decisiones.md). Esta migración lo hace bien desde el
-- principio.
--
-- Pegar en Supabase → SQL Editor → Run.

alter table pendientes drop constraint pendientes_tipo_check;

alter table pendientes add constraint pendientes_tipo_check
  check (tipo = ANY (ARRAY[
    'confirmar_visita'::text, 'revisar_fotos'::text, 'presupuesto'::text, 'otro'::text,
    'emitir_boleta'::text, 'emitir_factura'::text, 'cobro'::text,
    'seguimiento'::text, 'pedido_material'::text, 'solicitud_garantia'::text
  ]));
