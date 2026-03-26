import React from 'react';

interface Item {
  id: number;
  categoria: string;
  description: string;
  price: number;
  quantity: number;
  total: number;
}

interface SummaryProps {
  items: Item[];
}

// Helper para comparar categorías sin importar mayúsculas/minúsculas
const isMaterialOrManoObra = (categoria: string): boolean => {
  const cat = categoria?.toUpperCase() || '';
  return cat === 'MATERIALES' || cat === 'MANO DE OBRA';
};

const Summary: React.FC<SummaryProps> = ({ items }) => {
  const porcentajeGastos = 10; // Assuming 10% as default
  const tieneRetencion = false; // Assuming no retencion as default

  const subtotal = items
    .filter(item => isMaterialOrManoObra(item.categoria))
    .reduce((sum, item) => sum + item.price * item.quantity, 0);

  const gastosGenerales = subtotal * (porcentajeGastos / 100);
  const neto = subtotal + gastosGenerales;
  const iva = neto * 0.19;
  const total = neto + iva;
  const retencion = tieneRetencion ? total * 0.145 : 0;
  const totalLiquido = total - retencion;

  return (
    <div className="summary">
      <h2>Resumen de Totales</h2>
      <p>Subtotal: <span>$ {Math.round(subtotal).toLocaleString('es-CL')}</span></p>
      <p>Gastos Generales ({porcentajeGastos}%): <span>$ {Math.round(gastosGenerales).toLocaleString('es-CL')}</span></p>
      <p>Neto: <span>$ {Math.round(neto).toLocaleString('es-CL')}</span></p>
      <p>IVA (19%): <span>$ {Math.round(iva).toLocaleString('es-CL')}</span></p>
      <p>Total: <span>$ {Math.round(total).toLocaleString('es-CL')}</span></p>
      {tieneRetencion && <p>Retención (14.5%): <span>$ {Math.round(retencion).toLocaleString('es-CL')}</span></p>}
      <p><strong>Total Líquido: <span>$ {Math.round(totalLiquido).toLocaleString('es-CL')}</span></strong></p>
    </div>
  );
};

export default Summary;