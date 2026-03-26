import React, { useState, useMemo } from 'react';
import { generatePDF } from './utils/pdfGenerator';
import { calculateTotals } from './utils/calculationUtils';
import type { Item } from './utils/calculationUtils';
// import { supabase } from './lib/supabase'; // DESACTIVADO - Sin base de datos por ahora
import ItemForm from './components/ItemForm';
import './App.css';

interface Client {
  name: string;
  rut: string;
  email: string;
  address: string;
}

const App: React.FC = () => {
  const [items, setItems] = useState<Item[]>([]);
  const [clientData, setClientData] = useState<Client>({ name: '', rut: '', email: '', address: '' });
  const [overheadPercentage, setOverheadPercentage] = useState(10);

  // Usar función reutilizable para calcular totales
  const { subtotal, gastosGenerales, neto, iva, total } = useMemo(() => {
    return calculateTotals(items, overheadPercentage);
  }, [items, overheadPercentage]);

  const addItem = (item: Omit<Item, 'id'>) => {
    const newItem = { ...item, id: Date.now() };
    console.log('Adding item:', newItem);
    console.log('Item total:', newItem.total);
    setItems(prevItems => [...prevItems, newItem]);  // Usar función de actualización
  };

  const removeItem = (id: number) => {
    setItems(items.filter(item => item.id !== id));
  };

  const handleGeneratePDF = async () => {
    try {
      // MODO SIN BASE DE DATOS - Generar PDF directamente
      // TODO: Cuando se conecte una base de datos, agregar lógica de guardado aquí
      
      if (items.length === 0) {
        alert('Agrega al menos un item antes de generar el PDF');
        return;
      }

      console.log('Generando PDF directamente (sin guardar en BD)...');
      console.log('PDF data:', { clientData, items, subtotal, gastosGenerales, neto, iva, total, overheadPercentage });
      
      generatePDF(clientData, items, overheadPercentage);
      console.log('PDF generado exitosamente');

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
      <h1>PRESUPUESTO HORMA ELECTRICIDAD</h1>
      <div className="config-section">
        <h2>Configuración</h2>
        <label>
          Porcentaje Gastos Generales: {overheadPercentage}%
          <input
            type="range"
            min="0"
            max="50"
            value={overheadPercentage}
            onChange={(e) => setOverheadPercentage(Number(e.target.value))}
            style={{ marginLeft: '10px' }}
          />
        </label>
      </div>
      <div className="client-form">
        <h2>Datos del Cliente</h2>
        <input
          type="text"
          name="name"
          placeholder="Nombre"
          value={clientData.name}
          onChange={handleClientChange}
        />
        <input
          type="text"
          name="rut"
          placeholder="RUT"
          value={clientData.rut}
          onChange={handleClientChange}
        />
        <input
          type="email"
          name="email"
          placeholder="Email"
          value={clientData.email}
          onChange={handleClientChange}
        />
        <input
          type="text"
          name="address"
          placeholder="Dirección"
          value={clientData.address}
          onChange={handleClientChange}
        />
      </div>
      <ItemForm addItem={addItem} />
      <div className="item-list">
        <h2>Items Agregados</h2>
        {items.length === 0 ? (
          <p>No hay items agregados.</p>
        ) : (
          <ul>
            {items.map((item) => (
              <li key={item.id}>
                <span>{item.description}</span>
                <span>{item.categoria} | ${item.price.toLocaleString('es-CL')} × {item.quantity} = ${item.total.toLocaleString('es-CL')}</span>
                <button onClick={() => removeItem(item.id)}>Eliminar</button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <p>Subtotal: ${subtotal.toLocaleString('es-CL')}</p>
      <p>Gastos ({overheadPercentage}%): ${gastosGenerales.toLocaleString('es-CL')}</p>
      <p>Neto: ${neto.toLocaleString('es-CL')}</p>
      <p>IVA (19%): ${iva.toLocaleString('es-CL')}</p>
      <p>Total: ${total.toLocaleString('es-CL')}</p>
      <button
        onClick={handleGeneratePDF}
        style={{
          backgroundColor: '#e69a21',
          color: 'white',
          padding: '10px 20px',
          border: 'none',
          borderRadius: '4px',
          cursor: 'pointer',
          fontSize: '16px',
          fontWeight: 'bold',
          marginTop: '20px'
        }}
      >
        Generar PDF
      </button>
    </div>
  );
};

export default App;