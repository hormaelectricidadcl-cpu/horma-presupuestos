// Helper para comparar categorías sin importar mayúsculas/minúsculas
export const isMaterialOrManoObra = (categoria: string): boolean => {
  const cat = categoria?.toUpperCase() || '';
  return cat === 'MATERIALES' || cat === 'MANO DE OBRA';
};

// Función reutilizable para calcular totales (usada por interfaz y PDF)
export interface Totals {
  subtotal: number;
  gastosGenerales: number;
  neto: number;
  iva: number;
  total: number;
}

export interface Item {
  id: number;
  categoria: string;
  description: string;
  price: number;
  quantity: number;
  total: number;
  servicio_sku?: string;
}

export const calculateTotals = (items: Item[], overheadPercentage: number): Totals => {
  const subtotal = items
    .filter(item => isMaterialOrManoObra(item.categoria))
    .reduce((sum, item) => sum + (item.price * item.quantity), 0);
  
  const gastosGenerales = subtotal * (overheadPercentage / 100);
  const neto = subtotal + gastosGenerales;
  const iva = neto * 0.19;
  const total = neto + iva;
  
  return { subtotal, gastosGenerales, neto, iva, total };
};
