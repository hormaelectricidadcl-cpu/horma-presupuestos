-- Gastos variables cargados desde el Reporte Diario (11/09/2026)
--
-- Por qué: la regla que decidió Alexandra es que Gustavo elija el destino UNA vez, donde
-- carga, y la app se encargue del resto: a una obra concreta, a stock (compró materiales
-- para varias), o gasto de la empresa (no es material de obra). Hasta hoy el tercer caso
-- solo se podía cargar desde Estado de Resultados, que es justo donde Gustavo no entra
-- ("es lo que más uso, yo estoy cargando toda vaina ahí" sobre el Reporte Diario).
--
-- El resultado de esa falta se ve en los datos: combustible cargado como compra de
-- O'Higgins ($92.100) y a la vez como gasto variable ($85.000 el 08/09, $85.000 el 05/09,
-- $77.014 el 10/08), y peajes como compra de obra mientras el Tag va como gasto variable.
-- El mismo gasto en dos lados.

-- Comprobante de la boleta, igual que ya lo tienen las compras. El Reporte Diario sube la
-- foto y la IA completa descripción y monto con la función que ya existe (parse-factura),
-- así que un gasto variable cargado desde ahí llega con su respaldo.
alter table gastos_variables add column if not exists foto_boleta_url text;

-- De dónde vino la fila. Es lo que hace seguro el borrar-y-reinsertar del Reporte Diario:
-- al guardar un día se borran SOLO los gastos con origen = 'reporte_diario' de esa fecha.
-- Sin esta marca, guardar el reporte borraría los gastos que Alexandra carga a mano desde
-- Estado de Resultados con la misma fecha.
alter table gastos_variables add column if not exists origen text;

comment on column gastos_variables.origen is
  'Dónde se cargó la fila: ''reporte_diario'' o NULL (a mano, desde Estado de Resultados). El Reporte Diario solo borra y reescribe las suyas.';

create index if not exists gastos_variables_fecha_origen_idx
  on gastos_variables (fecha, origen);
