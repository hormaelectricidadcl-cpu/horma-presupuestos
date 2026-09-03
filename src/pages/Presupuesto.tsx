import React, { useState, useMemo, useEffect } from 'react';
import { generatePDF } from '../utils/pdfGenerator';
import { calculateTotals } from '../utils/calculationUtils';
import type { Item } from '../utils/calculationUtils';
import ItemForm from '../components/ItemForm';
import { supabase } from '../lib/supabase';
import '../App.css';

interface Client {
  name: string;
  rut: string;
  email: string;
  address: string;
}

const PRESUPUESTO_TOKEN = import.meta.env.VITE_PRESUPUESTO_TOKEN as string;

interface Props {
  token: string | null;
  onVolver?: () => void;
}

const Presupuesto: React.FC<Props> = ({ token, onVolver }) => {
  const [items, setItems] = useState<Item[]>([]);
  const [clientData, setClientData] = useState<Client>({ name: '', rut: '', email: '', address: '' });
  const [overheadPercentage, setOverheadPercentage] = useState(10);
  const [clienteIdPrefill, setClienteIdPrefill] = useState<string | null>(null);
  const [pendienteOrigenNombre, setPendienteOrigenNombre] = useState<string | null>(null);

  // Fase 2 del "orden" (03/09/2026): si el link trae "desde_pendiente", los ítems que ya
  // generó la IA en el hilo de ese pendiente (Admin -> "Generar ítems con IA") se cargan
  // solos acá en vez de retipearlos a mano -- y el cliente queda ligado por su cliente_id
  // real, no solo por el nombre.
  useEffect(() => {
    const pendienteId = new URLSearchParams(window.location.search).get('desde_pendiente');
    if (!pendienteId) return;
    supabase
      .from('pendientes')
      .select('cliente_nombre, cliente_id, direccion, items')
      .eq('id', pendienteId)
      .single()
      .then(({ data }) => {
        if (!data) return;
        setClientData(prev => ({ ...prev, name: data.cliente_nombre || prev.name, address: data.direccion || prev.address }));
        setClienteIdPrefill(data.cliente_id || null);
        setPendienteOrigenNombre(data.cliente_nombre || null);
        const itemsPendiente = (data.items || []) as { categoria: string; descripcion: string; cantidad: number; precioUnitario: number }[];
        if (itemsPendiente.length > 0) {
          setItems(itemsPendiente.map((it, i) => ({
            id: Date.now() + i,
            categoria: it.categoria,
            description: it.descripcion,
            quantity: it.cantidad,
            price: it.precioUnitario,
            total: it.cantidad * it.precioUnitario,
          })));
        }
      });
  }, []);

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
      if (!clientData.name.trim() || !clientData.address.trim()) {
        alert('Rellena los datos del cliente (nombre y dirección) antes de generar el PDF');
        return;
      }
      const referencia = `HRM-${Date.now().toString(36).toUpperCase()}`;
      generatePDF(clientData, items, overheadPercentage, referencia);
      const guardadoOk = await guardarPresupuesto(referencia);
      if (guardadoOk) {
        alert(`✓ PDF generado y guardado — Ref: ${referencia}\n\nYa está disponible en "Mis presupuestos" (esta pestaña es independiente de esa vista, así que no viaja sola ahí -- ciérrala y volvé a la pestaña donde tenías Admin/Gustavo para verlo).`);
      } else {
        alert(`El PDF se generó (Ref: ${referencia}), pero no se pudo guardar en Mis presupuestos. Avísale a Alexandra o intenta de nuevo.`);
      }
    } catch (error) {
      console.error('Error in handleGeneratePDF:', error);
      alert('Error al generar el PDF');
    }
  };

  const guardarPresupuesto = async (referencia: string): Promise<boolean> => {
    try {
      let clienteId = clienteIdPrefill;
      if (!clienteId) {
        const clientePayload: { nombre: string; rut?: string; email?: string } = { nombre: clientData.name.trim() };
        if (clientData.rut.trim()) clientePayload.rut = clientData.rut.trim();
        if (clientData.email.trim()) clientePayload.email = clientData.email.trim();

        const { data: cliente, error: clienteErr } = await supabase
          .from('clientes')
          .upsert(clientePayload, { onConflict: 'nombre' })
          .select('id')
          .single();
        if (clienteErr) throw clienteErr;
        clienteId = cliente?.id ?? null;
      }

      const { error: presupuestoErr } = await supabase.from('presupuestos').insert({
        cliente_id: clienteId,
        cliente_nombre: clientData.name.trim(),
        cliente_email: clientData.email.trim() || null,
        cliente_direccion: clientData.address.trim(),
        tipo: 'simple',
        estado: 'enviado',
        items,
        referencia,
        gg_pct: overheadPercentage,
        gg_amount: gastosGenerales,
        subtotal,
        iva,
        total,
      });
      if (presupuestoErr) throw presupuestoErr;
      return true;
    } catch (error) {
      console.error('Error al guardar presupuesto en Supabase:', error);
      return false;
    }
  };

  const handleClientChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setClientData({ ...clientData, [name]: value });
  };

  if (token !== PRESUPUESTO_TOKEN) {
    return (
      <div className="pendientes" style={{
        minHeight: '100vh',
        display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center',
        padding: '2rem', textAlign: 'center',
      }}>
        <div style={{ fontSize: 48, marginBottom: 16 }}>🔒</div>
        <h2 style={{ fontWeight: 700, marginBottom: 8 }}>Link inválido</h2>
        <p style={{ color: 'var(--muted)', fontSize: 15 }}>Pídele a Alexandra que te mande el link por WhatsApp.</p>
      </div>
    );
  }

  return (
    <div className="app">
      <header className="app-header">
        <span className="eyebrow">Presupuesto</span>
        <h1>Horma Grup</h1>
      </header>

      {pendienteOrigenNombre && (
        <div className="card" style={{ padding: '10px 14px', marginBottom: 16, background: '#f0fdf4', borderLeft: '3px solid #16a34a' }}>
          <p style={{ fontSize: 13, color: '#166534', fontWeight: 600 }}>
            ✓ Ítems y cliente cargados desde el pendiente de {pendienteOrigenNombre} — revisa antes de generar el PDF.
          </p>
        </div>
      )}

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
          <input type="text" name="name" placeholder="Nombre *" value={clientData.name} onChange={handleClientChange} />
          <input type="text" name="rut" placeholder="RUT (opcional)" value={clientData.rut} onChange={handleClientChange} />
          <input type="email" name="email" placeholder="Email (opcional)" value={clientData.email} onChange={handleClientChange} />
          <input type="text" name="address" placeholder="Dirección *" value={clientData.address} onChange={handleClientChange} />
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

      {onVolver && (
        <button
          type="button"
          onClick={onVolver}
          style={{
            display: 'block', width: '100%', marginTop: 14, padding: '10px',
            background: 'none', border: '1px solid var(--border-inverse, rgba(251,250,247,0.14))', borderRadius: 'var(--radius-sm, 10px)',
            color: 'var(--muted-inverse, rgba(251,250,247,0.55))', fontSize: 13, fontWeight: 600, cursor: 'pointer',
          }}
        >
          ← Volver
        </button>
      )}
    </div>
  );
};

export default Presupuesto;
