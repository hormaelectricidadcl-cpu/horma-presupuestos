import React, { useState } from 'react';
// import { supabase } from '../lib/supabase'; // DESACTIVADO - Sin base de datos por ahora

// Interface del catálogo comentado - requiere base de datos
/*
interface Service {
  identificación: number;
  SKU?: string;
  sku?: string;
  servicio: string;
  precio: number;
  categoria: string;
  notas?: string;
  creado_en?: string;
}
*/

interface Item {
  categoria: string;
  description: string;
  price: number;
  quantity: number;
  total: number;
  servicio_sku?: string;
}

interface ItemFormProps {
  addItem: (item: Item) => void;
}

const ItemForm: React.FC<ItemFormProps> = ({ addItem }) => {
  const [mode, setMode] = useState<'manual' | 'catalog' | 'ai'>('manual');
  const [categoria, setCategoria] = useState('MATERIALES');
  // Variables del catálogo comentadas - catálogo deshabilitado sin BD
  // const [services] = useState<Service[]>([]);
  // const [selectedService, setSelectedService] = useState('');
  // const [searchTerm, setSearchTerm] = useState('');
  const [price, setPrice] = useState(0);
  const [quantity, setQuantity] = useState(1);
  const [description, setDescription] = useState('');
  const [aiText, setAiText] = useState('');
  const [isProcessingAI, setIsProcessingAI] = useState(false);

  // useEffect commented out - Catálogo requiere base de datos
  // TODO: Cuando se conecte una base de datos, cargar servicios desde allí
  /*
  useEffect(() => {
    const loadServices = async () => {
      const { data, error } = await supabase
        .from('servicios')
        .select('*')
        .order('servicio');

      if (error) {
        console.error('Error loading services:', error);
        return;
      }

      setServices(data || []);
    };

    loadServices();
  }, []);
  */

  // filteredServices comentado - catálogo deshabilitado sin BD
  /*
  const filteredServices = services.filter((service) => {
    return (
      service.categoria?.toUpperCase() === categoria &&
      (searchTerm === '' ||
        service.servicio.toLowerCase().includes(searchTerm.toLowerCase()))
    );
  });
  */

  const handleManualSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    if (!description.trim()) {
      alert('Ingresa una descripción');
      return;
    }

    if (price <= 0) {
      alert('El precio debe ser mayor a 0');
      return;
    }

    if (quantity <= 0) {
      alert('La cantidad debe ser mayor a 0');
      return;
    }

    addItem({
      categoria,
      description: description.trim(),
      price: Number(price),
      quantity: Number(quantity),
      total: Number(price) * Number(quantity)
    });

    setDescription('');
    setPrice(0);
    setQuantity(1);
  };

  // Funciones del catálogo comentadas - requieren base de datos
  /*
  const handleCatalogSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    const service = services.find((s) => (s.SKU || s.sku) === selectedService);

    if (!service) {
      alert('Debes seleccionar un servicio válido del catálogo');
      return;
    }

    if (service.precio <= 0) {
      alert('El servicio seleccionado no tiene un precio válido');
      return;
    }

    if (quantity <= 0) {
      alert('La cantidad debe ser mayor a 0');
      return;
    }

    addItem({
      categoria: service.categoria?.toUpperCase() || 'MATERIALES',
      description: service.servicio,
      price: Number(service.precio),
      quantity: Number(quantity),
      total: Number(service.precio) * Number(quantity),
      servicio_sku: service.SKU || service.sku
    });

    setSelectedService('');
    setSearchTerm('');
    setPrice(0);
    setQuantity(1);
  };

  const handleServiceSearch = (e: React.ChangeEvent<HTMLInputElement>) => {
    const inputValue = e.target.value.trim();
    setSearchTerm(inputValue);

    const matchedService = filteredServices.find(
      (service) =>
        service.servicio.trim().toLowerCase() === inputValue.toLowerCase()
    );

    if (matchedService) {
      const skuValue = matchedService.SKU || matchedService.sku || '';
      setSelectedService(skuValue);
      setPrice(Number(matchedService.precio) || 0);
    } else {
      setSelectedService('');
      setPrice(0);
    }
  };
  */

  const procesarIA = async () => {
    if (!aiText.trim()) {
      alert('Pega primero el detalle del trabajo o presupuesto');
      return;
    }

    try {
      setIsProcessingAI(true);

      const res = await fetch('/.netlify/functions/parse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ texto: aiText })
      });

      const data = await res.json();

      if (!res.ok) {
        console.error('Error backend IA:', data);
        alert(data?.error || 'Error procesando IA');
        return;
      }

      const items = data.items;

      if (!Array.isArray(items) || items.length === 0) {
        console.error('Respuesta IA inválida:', data);
        alert('La IA no devolvió ítems válidos');
        return;
      }

      items.forEach((item: {
        categoria: string;
        descripcion: string;
        cantidad: number;
        precioUnitario: number;
      }) => {
        const categoriaNormalizada =
          item.categoria?.toUpperCase() === 'MANO DE OBRA'
            ? 'MANO DE OBRA'
            : item.categoria?.toUpperCase() === 'GASTOS GENERALES'
              ? 'GASTOS GENERALES'
              : 'MATERIALES';

        const precio = Number(item.precioUnitario) || 0;
        const cantidad = Number(item.cantidad) || 1;

        addItem({
          categoria: categoriaNormalizada,
          description: (item.descripcion || '').trim(),
          price: precio,
          quantity: cantidad,
          total: precio * cantidad
        });
      });

      setAiText('');
    } catch (error) {
      console.error('Error procesando IA:', error);
      alert('Error procesando IA');
    } finally {
      setIsProcessingAI(false);
    }
  };

  return (
    <div className="item-form">
      <h2>Agregar artículo</h2>

      <div style={{ display: 'flex', marginBottom: '15px', borderBottom: '1px solid #ccc' }}>
        <button
          type="button"
          onClick={() => setMode('manual')}
          style={{
            flex: 1,
            padding: '8px',
            backgroundColor: mode === 'manual' ? '#e69a21' : '#f5f5f5',
            color: mode === 'manual' ? 'white' : 'black',
            border: 'none',
            cursor: 'pointer',
            fontWeight: mode === 'manual' ? 'bold' : 'normal'
          }}
        >
          Manual
        </button>

        <button
          type="button"
          onClick={() => setMode('catalog')}
          style={{
            flex: 1,
            padding: '8px',
            backgroundColor: mode === 'catalog' ? '#e69a21' : '#f5f5f5',
            color: mode === 'catalog' ? 'white' : 'black',
            border: 'none',
            cursor: 'pointer',
            fontWeight: mode === 'catalog' ? 'bold' : 'normal'
          }}
        >
          Catálogo
        </button>

        <button
          type="button"
          onClick={() => setMode('ai')}
          style={{
            flex: 1,
            padding: '8px',
            backgroundColor: mode === 'ai' ? '#e69a21' : '#f5f5f5',
            color: mode === 'ai' ? 'white' : 'black',
            border: 'none',
            cursor: 'pointer',
            fontWeight: mode === 'ai' ? 'bold' : 'normal'
          }}
        >
          IA
        </button>
      </div>

      {mode === 'manual' && (
        <form onSubmit={handleManualSubmit}>
          <select value={categoria} onChange={(e) => setCategoria(e.target.value)}>
            <option value="MATERIALES">MATERIALES</option>
            <option value="MANO DE OBRA">MANO DE OBRA</option>
            <option value="GASTOS GENERALES">GASTOS GENERALES</option>
          </select>

          <input
            type="text"
            placeholder="Descripción"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            required
          />

          <input
            type="number"
            placeholder="Precio unitario"
            value={price}
            onChange={(e) => setPrice(Number(e.target.value))}
            min="0"
            step="1"
            required
          />

          <input
            type="number"
            placeholder="Cantidad"
            value={quantity}
            onChange={(e) => setQuantity(Number(e.target.value))}
            min="1"
            required
          />

          <button type="submit">+ Agregar</button>
        </form>
      )}

      {mode === 'catalog' && (
        <div style={{ padding: '15px', textAlign: 'center', color: '#666' }}>
          <p>📋 <strong>Catálogo deshabilitado</strong></p>
          <p style={{ fontSize: '12px' }}>
            El catálogo de servicios requiere conexión a base de datos.<br />
            Usa el modo <strong>Manual</strong> o <strong>IA</strong> para agregar items.
          </p>
          {/* El código del catálogo está comentado esperando reconexión a BD */}
          {/*
          <form onSubmit={handleCatalogSubmit}>
            <select
              value={categoria}
              onChange={(e) => {
                setCategoria(e.target.value);
                setSelectedService('');
                setSearchTerm('');
                setPrice(0);
              }}
            >
              <option value="MATERIALES">MATERIALES</option>
              <option value="MANO DE OBRA">MANO DE OBRA</option>
              <option value="GASTOS GENERALES">GASTOS GENERALES</option>
            </select>

            <input
              type="text"
              placeholder="Seleccionar servicio..."
              value={searchTerm}
              onChange={handleServiceSearch}
              list="services-datalist"
              required
            />

            <datalist id="services-datalist">
              {filteredServices.map((service) => (
                <option
                  key={service.SKU || service.sku || service.identificación}
                  value={service.servicio}
                />
              ))}
            </datalist>

            {price > 0 && (
              <div
                style={{
                  padding: '8px',
                  backgroundColor: '#f0f0f0',
                  borderRadius: '4px',
                  margin: '5px 0'
                }}
              >
                Precio: ${price.toLocaleString('es-CL')}
              </div>
            )}

            <input
              type="number"
              placeholder="Cantidad"
              value={quantity}
              onChange={(e) => setQuantity(Number(e.target.value))}
              min="1"
              required
            />

            <button type="submit">+ Agregar</button>
          </form>
          */}
        </div>
      )}

      {mode === 'ai' && (
        <div style={{ padding: '20px' }}>
          <p style={{ marginBottom: '8px', fontWeight: 'bold' }}>
            Generar ítems con IA
          </p>

          <textarea
            value={aiText}
            onChange={(e) => setAiText(e.target.value)}
            style={{
              width: '100%',
              minHeight: '140px',
              padding: '12px',
              resize: 'vertical',
              boxSizing: 'border-box'
            }}
            placeholder="Pega aquí el detalle del trabajo o presupuesto"
          />

          <button
            type="button"
            onClick={procesarIA}
            disabled={isProcessingAI}
            style={{
              marginTop: '10px',
              width: '100%',
              padding: '12px',
              backgroundColor: '#e69a21',
              color: 'white',
              border: 'none',
              cursor: isProcessingAI ? 'not-allowed' : 'pointer',
              opacity: isProcessingAI ? 0.7 : 1
            }}
          >
            {isProcessingAI ? 'Procesando...' : 'Generar con IA'}
          </button>
        </div>
      )}
    </div>
  );
};

export default ItemForm;