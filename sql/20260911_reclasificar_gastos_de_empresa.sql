-- Reclasificación: lo que no es costo de una obra sale del costo de la obra (11/09/2026)
--
-- Decidido con Alexandra el 11/09. Su criterio textual: "ohiggins es una obra que se inició
-- antes de este sistema, el sistema se está creando para hacer las cosas de la manera
-- correcta... haz el cambio que es el correcto de hacer como lo hacen los grandes".
--
-- POR QUÉ, en una línea: un costo se le carga a una obra solo si esa obra lo consumió. Un
-- trompo, una cortadora de cerámica o el combustible de la camioneta sirven a todas las
-- obras y siguen existiendo cuando la obra termina, así que cargárselos enteros a la que
-- estaba abierta ese día hace dos cosas malas a la vez: hunde el margen de esa obra y deja
-- a las otras viéndose mejor de lo que son. Es la división estándar de job costing: costo
-- directo a la obra, gasto operativo a la empresa.
--
-- El caso concreto que lo destapó: el combustible estaba cargado como compra de O'Higgins
-- ($92.100) Y como gasto variable de la empresa ($85.000 el 08/09, $85.000 el 05/09,
-- $77.014 el 10/08). El mismo gasto en dos lados, según por dónde se hubiera entrado.
--
-- QUÉ NO SE MUEVE, a propósito: "Recolección de escombros" ($60.000) y "Excavación y retiro
-- de escombros" ($350.000) SÍ son de O'Higgins -- son un servicio contratado para ese
-- terreno, no un gasto de la empresa. Lo mismo la arena, las canaletas y la pintura.
--
-- IMPACTO, calculado contra los datos del 11/09:
--   * Salen $753.258 de costo de obra -> $673.260 de O'Higgins y $79.998 de Doctora Eloísa 1.
--   * El margen de O'Higgins sube de $29.302.911 a $29.868.675 (la diferencia es el neto de
--     esos $673.260, porque el margen ya cuenta las compras sin IVA).
--   * Esa plata NO desaparece: pasa a gastos variables y se descuenta del resultado de la
--     empresa en Estado de Resultados, que es donde corresponde.
--
-- Ninguna de las 9 filas tiene desglose de ítems ni foto de boleta ni pagador cargado
-- (verificado antes de escribir esto), así que no se pierde nada al moverlas.
--
-- CORRER UNA SOLA VEZ. Después de correrlo, la consulta de verificación del final tiene que
-- devolver 0 filas en `reportes_compras` y 9 en `gastos_variables`.

begin;

insert into gastos_variables (fecha, descripcion, monto, categoria, origen)
select c.fecha,
       c.descripcion,
       c.monto,
       case
         when c.descripcion ilike '%peaje%' then 'Transporte'
         when c.descripcion ilike '%combustible%' then 'Combustible'
         else 'Herramientas'
       end,
       'reclasificado_2026_09_11'
from reportes_compras c
where c.id in (
  '62e4435e-37ea-4b7f-8263-445a06bba5ea',  -- 11/08 Trompo (mezcladora)        $250.000  O'Higgins
  'e6058307-2a4f-466d-88b7-7d26a32245ec',  -- 18/08 Peaje                        $6.100  O'Higgins
  '4efee39a-b71e-46fa-b519-53b62233c6aa',  -- 19/08 Herramientas                $79.998  Doctora Eloísa 1
  '867f9588-da6d-485d-99a0-156e4651d082',  -- 20/08 Caucho de repuesto          $40.000  O'Higgins
  '2bcba37d-90a6-4ccf-a9ce-6ba8f1fc5e96',  -- 21/08 Herramientas                $92.870  O'Higgins
  'fcb9d900-1773-4260-afa0-a23b41824a8f',  -- 22/08 Combustible                 $92.100  O'Higgins
  '41dc88d5-d29a-4691-863f-2f35b5eb6c0a',  -- 28/08 Cortadora de cerámica      $179.990  O'Higgins
  '30baa51c-97bb-4e19-a96a-854f6ee1416c',  -- 03/09 Peaje                        $6.100  O'Higgins
  'e743da18-cf36-46bb-8886-5f2780edf28d'   -- 05/09 Peaje                        $6.100  O'Higgins
);

delete from reportes_compras
where id in (
  '62e4435e-37ea-4b7f-8263-445a06bba5ea',
  'e6058307-2a4f-466d-88b7-7d26a32245ec',
  '4efee39a-b71e-46fa-b519-53b62233c6aa',
  '867f9588-da6d-485d-99a0-156e4651d082',
  '2bcba37d-90a6-4ccf-a9ce-6ba8f1fc5e96',
  'fcb9d900-1773-4260-afa0-a23b41824a8f',
  '41dc88d5-d29a-4691-863f-2f35b5eb6c0a',
  '30baa51c-97bb-4e19-a96a-854f6ee1416c',
  'e743da18-cf36-46bb-8886-5f2780edf28d'
);

commit;

-- Verificación. Esperado: compras_que_quedan = 0, gastos_creados = 9, monto_movido = 753258.
-- select
--   (select count(*) from reportes_compras where id in ('62e4435e-37ea-4b7f-8263-445a06bba5ea','e6058307-2a4f-466d-88b7-7d26a32245ec','4efee39a-b71e-46fa-b519-53b62233c6aa','867f9588-da6d-485d-99a0-156e4651d082','2bcba37d-90a6-4ccf-a9ce-6ba8f1fc5e96','fcb9d900-1773-4260-afa0-a23b41824a8f','41dc88d5-d29a-4691-863f-2f35b5eb6c0a','30baa51c-97bb-4e19-a96a-854f6ee1416c','e743da18-cf36-46bb-8886-5f2780edf28d')) as compras_que_quedan,
--   (select count(*) from gastos_variables where origen = 'reclasificado_2026_09_11') as gastos_creados,
--   (select sum(monto) from gastos_variables where origen = 'reclasificado_2026_09_11') as monto_movido;
