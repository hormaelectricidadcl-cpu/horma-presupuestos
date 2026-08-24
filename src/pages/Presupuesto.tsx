import React, { useState, useMemo } from 'react';
import { generatePDF } from '../utils/pdfGenerator';
import { calculateTotals } from '../utils/calculationUtils';
import type { Item } from '../utils/calculationUtils';
import ItemForm from '../components/ItemForm';
import '../App.css';

interface Client {
  name: string;
  rut: string;
  email: string;
  address: string;
}

const Presupuesto: React.FC = () => {
  const [items, setItems] = useState<Item[]>([]);
  const [clientData, setClientData] = useState<Client>({ name: '', rut: '', email: '', address: '' });
  const [overheadPercentage, setOverheadPercentage] = useState(10);

  const { subtotal, gastosGenerales, neto, iva, total } = useMemo(() => {
    return calculateTotals(items, overheadPercentage);
  }, [items, overheadPercentage]);

  const addItem = (item: Omit<Item, 'id'>) => {
    const newItem = { ...item, id: Date.now() };
    setItems(prevItems => [...prevItems, newItem]);
  };

  const removeItem = (id: number) => {
    setItems(items.filter(item => item.id !== id));
  };

  const handleGeneratePDF = async () => {
    try {
      if (items.length === 0) {
        alert('Agrega al menos un item antes de generar el PDF');
        return;
      }
      generatePDF(clientData, items, overheadPercentage);
      alert('PDF generado correctamente');
    } catch (error) {
      console.error('Error in handleGeneratePDF:', error);
      alert('Error al generar el PDF');
    }
  };

  const handleClientChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setClientData({ ...clientData, [name]: value });
  };

  return (
    <div className="app">
      <header className="app-header">
        <span className="eyebrow">Presupuesto</span>
        <h1>Horma Electricidad</h1>
      </header>

      <div className="card config-section">
        <h2>Configuración</h2>
        <label className="range-label">
          <span>Gastos generales</span>
          <span className="range-value">{overheadPercentage}%</span>
          <input
            type="range"
            min="0"
            max="50"
            value={overheadPercentage}
            onChange={(e) => setOverheadPercentage(Number(e.target.value))}
          />
        </label>
      </div>

      <div className="card client-form">
        <h2>Datos del cliente</h2>
        <div className="field-grid">
          <input type="text" name="name" placeholder="Nombre" value={clientData.name} onChange={handleClientChange} />
          <input type="text" name="rut" placeholder="RUT" value={clientData.rut} onChange={handleClientChange} />
          <input type="email" name="email" placeholder="Email" value={clientData.email} onChange={handleClientChange} />
          <input type="text" name="address" placeholder="Dirección" value={clientData.address} onChange={handleClientChange} />
        </div>
      </div>

      <ItemForm addItem={addItem} />

      <div className="card item-list">
        <h2>Items agregados</h2>
        {items.length === 0 ? (
          <p className="empty-state">No hay items agregados todavía.</p>
        ) : (
          <ul>
            {items.map((item) => (
              <li key={item.id}>
                <div className="item-info">
                  <span className="item-desc">{item.description}</span>
                  <span className="item-meta">{item.categoria} · ${item.price.toLocaleString('es-CL')} × {item.quantity} = ${item.total.toLocaleString('es-CL')}</span>
                </div>
                <button className="btn-icon-remove" onClick={() => removeItem(item.id)}>Eliminar</button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="card summary">
        <h2>Resumen</h2>
        <div className="summary-row"><span>Subtotal</span><span>${subtotal.toLocaleString('es-CL')}</span></div>
        <div className="summary-row"><span>Gastos generales ({overheadPercentage}%)</span><span>${gastosGenerales.toLocaleString('es-CL')}</span></div>
        <div className="summary-row"><span>Neto</span><span>${neto.toLocaleString('es-CL')}</span></div>
        <div className="summary-row"><span>IVA (19%)</span><span>${iva.toLocaleString('es-CL')}</span></div>
        <div className="summary-row summary-total"><span>Total</span><span>${total.toLocaleString('es-CL')}</span></div>
      </div>

      <button className="btn-generate" onClick={handleGeneratePDF}>
        Generar PDF
      </button>
    </div>
  );
};

export default Presupuesto;
