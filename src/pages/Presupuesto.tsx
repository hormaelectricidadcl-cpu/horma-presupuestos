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
  // Referencia del último presupuesto que se guardó bien. Se muestra en la página en vez de
  // en un alert porque en el teléfono la descarga del PDF puede llevarse la pestaña por
  // delante y un alert no se alcanzaría a ver.
  const [guardadoRef, setGuardadoRef] = useState<string | null>(null);
  // Adicionales (08/09/2026): si el link trae "desde_presupuesto", esto se convierte en el
  // presupuesto de adicionales de ese original. El original queda intacto y solo se muestra
  // como referencia -- lo que se guarde acá es un presupuesto NUEVO que lo apunta con
  // origen_id, y lleva SOLO lo que se agregó.
  const [origenId, setOrigenId] = useState<string | null>(null);
  const [origenReferencia, setOrigenReferencia] = useState<string | null>(null);
  // El original se guarda aparte, de SOLO LECTURA: el adicional arranca vacío y solo lleva
  // lo que cambió. Si arrancara con la copia entera, un renglón olvidado le cobra de nuevo
  // al cliente algo que ya estaba presupuestado -- ver decisiones.md 2026-09-08.
  const [origenItems, setOrigenItems] = useState<Item[]>([]);
  const [origenTotal, setOrigenTotal] = useState<number | null>(null);
  // Los presupuestos externos (PDF del cliente) y los de etapas no tienen ítems simples que
  // listar, pero SÍ pueden tener adicionales -- es el caso de Nicole/O'Higgins. Se guarda el
  // tipo para explicar por qué no hay lista que consultar, en vez de bloquear el flujo.
  const [origenTipo, setOrigenTipo] = useState<'simple' | 'etapas' | 'externo' | null>(null);
  // Cuántos MÁS se hicieron de cada línea del original, por índice de la lista de consulta.
  const [cantidadDesdeOriginal, setCantidadDesdeOriginal] = useState<Record<number, string>>({});

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

  // Copia editable de un presupuesto existente, para armar el de adicionales.
  useEffect(() => {
    const presupuestoId = new URLSearchParams(window.location.search).get('desde_presupuesto');
    if (!presupuestoId) return;
    supabase
      .from('presupuestos')
      .select('id, referencia, cliente_id, cliente_nombre, cliente_email, cliente_direccion, gg_pct, items, tipo, total')
      .eq('id', presupuestoId)
      .single()
      .then(({ data }) => {
        if (!data) return;
        // Antes acá se cortaba si el original no era "simple". Eso dejaba sin forma de cargar
        // adicionales a las obras que entraron por PDF externo (Nicole/O'Higgins) o por
        // etapas, que son justo las obras grandes donde más adicionales aparecen. Ahora el
        // vínculo se arma igual: lo único que cambia es que no hay lista de ítems para
        // consultar, porque el original no la tiene.
        setOrigenTipo(data.tipo as 'simple' | 'etapas' | 'externo');
        setOrigenId(data.id);
        setOrigenReferencia(data.referencia || null);
        setOrigenTotal(data.total ?? null);
        setClienteIdPrefill(data.cliente_id || null);
        setClientData(prev => ({
          ...prev,
          name: data.cliente_nombre || prev.name,
          email: data.cliente_email || prev.email,
          address: data.cliente_direccion || prev.address,
        }));
        if (data.gg_pct != null) setOverheadPercentage(data.gg_pct);
        // Se guardan para MOSTRARLOS, no para cargarlos: el adicional empieza vacío.
        setOrigenItems((data.items || []) as Item[]);

        // Los presupuestos que entraron como PDF externo no tienen dirección guardada
        // (Nicole, Marcelo, Francisca: las tres en null), así que el adicional quedaba sin
        // dirección y el presupuestador la exige para generar el PDF -- frenaba ahí sin
        // explicar por qué. La obra que nació de ese presupuesto sí la tiene: su nombre ES
        // la dirección ("Ohiggins 126 Limache"). Se usa esa como respaldo.
        if (!data.cliente_direccion) {
          supabase
            .from('obras').select('nombre').eq('presupuesto_id', data.id).maybeSingle()
            .then(({ data: obra }) => {
              if (obra?.nombre) setClientData(prev => (prev.address ? prev : { ...prev, address: obra.nombre }));
            });
        }
      });
  }, []);

  // Trae una línea del original al adicional. La cantidad se escribe al lado del botón: son
  // cuántos MÁS se hicieron (el caso de Gustavo del "4 que pasó a 6": pone 2).
  //
  // 11/09: antes esto forzaba cantidad 1 y cada clic agregaba una línea nueva. Para 10
  // centros había que apretar diez veces y quedaban diez renglones iguales en el PDF del
  // cliente -- lo reportaron con "Red desagüe", que salió dos veces en vez de una por dos.
  // Ahora, si la línea ya está en el adicional, se le suma la cantidad en vez de duplicarla.
  const agregarDesdeOriginal = (item: Item, cantidad: number) => {
    const cant = Number.isFinite(cantidad) && cantidad > 0 ? cantidad : 1;
    const descripcion = /^adicional/i.test(item.description) ? item.description : `Adicional — ${item.description}`;
    const yaEsta = items.find(x => x.description === descripcion && x.price === item.price);
    if (yaEsta) {
      const nuevaCantidad = yaEsta.quantity + cant;
      setItems(items.map(x => x.id === yaEsta.id
        ? { ...x, quantity: nuevaCantidad, total: nuevaCantidad * x.price }
        : x));
      return;
    }
    addItem({
      categoria: item.categoria,
      description: descripcion,
      price: item.price,
      quantity: cant,
      total: item.price * cant,
    });
  };

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
      // Baranda: un adicional que suma tanto como el original casi siempre significa que se
      // cargó de nuevo todo el trabajo ya presupuestado, no lo que se agregó. Vale la pena
      // frenar antes de mandarle eso a un cliente.
      if (origenId && origenTotal != null && total >= origenTotal) {
        const seguir = window.confirm(
          `Ojo: este adicional suma $${total.toLocaleString('es-CL')} y el presupuesto original era de $${origenTotal.toLocaleString('es-CL')}.\n\n` +
          'Un adicional debería llevar solo lo que se agregó, no el trabajo que ya estaba presupuestado (eso ya se cobró).\n\n' +
          '¿Seguro que está bien y querés generarlo igual?'
        );
        if (!seguir) return;
      }

      const referencia = `HRM-${Date.now().toString(36).toUpperCase()}`;

      // PRIMERO guardar, DESPUÉS el PDF. El orden importa y no es cosmético.
      //
      // Al revés (como estaba hasta el 09/09/2026) se perdió un presupuesto real: el
      // HRM-MTSTS0UU que Gustavo hizo desde el iPhone el 08/09 a las 12:29. `doc.save()`
      // de jsPDF clickea un <a download href="blob:..."> y en iOS eso le entrega la página
      // al visor de PDF; el insert a Supabase todavía estaba en vuelo y se murió con la
      // página. En los logs de Supabase no llegó ni el preflight. El PDF salió, se lo
      // mandó al cliente, y en "Mis presupuestos" no quedó nada -- y como la página se fue
      // antes del alert, tampoco vio ningún error. Ver progress/decisiones.md 2026-09-09.
      //
      // Con este orden el riesgo se da vuelta hacia el lado barato: si algo falla ahora,
      // falla el PDF (que se puede volver a bajar cuando sea desde el detalle del
      // presupuesto), no el registro de la plata.
      const guardadoOk = await guardarPresupuesto(referencia);
      if (!guardadoOk) {
        const generarIgual = window.confirm(
          `No se pudo guardar el presupuesto (Ref: ${referencia}). Suele ser la conexión.\n\n` +
          'Si generas el PDF igual, se lo vas a mandar al cliente sin que quede registrado en "Mis presupuestos" — y después nadie se acuerda de cargarlo.\n\n' +
          'Aceptar: generar el PDF igual.\nCancelar: no generarlo y volver a intentar en un momento.'
        );
        if (!generarIgual) return;
      }

      generatePDF(clientData, items, overheadPercentage, referencia, origenId ? (origenReferencia || 'original') : undefined);
      // El aviso de que salió bien va en la página, no en un alert: en el teléfono la
      // descarga del PDF puede llevarse la pestaña por delante y un alert posterior no
      // se llegaría a ver nunca. Esto queda escrito y se puede volver a mirar.
      setGuardadoRef(guardadoOk ? referencia : null);
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

      const base = {
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
      };

      // Si esto salió de "Crear adicionales", queda apuntando al original -- que no se toca
      // nunca, este es un documento nuevo. Si la migración de adicionales todavía no está
      // corrida, la columna no existe y el insert falla ENTERO: en ese caso se guarda sin el
      // vínculo antes que perder el presupuesto, y se avisa para poder engancharlo después.
      if (origenId) {
        const { error: errConOrigen } = await supabase.from('presupuestos').insert({ ...base, origen_id: origenId });
        if (!errConOrigen) return true;
        const { error: errSinOrigen } = await supabase.from('presupuestos').insert(base);
        if (errSinOrigen) throw errSinOrigen;
        alert('El presupuesto se guardó, pero no quedó vinculado como adicional del original. Falta correr la migración sql/20260908_presupuestos_adicionales.sql — avisale a Alexandra.');
        return true;
      }

      const { error: presupuestoErr } = await supabase.from('presupuestos').insert(base);
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

      {guardadoRef && (
        <div className="card" style={{ padding: '10px 14px', marginBottom: 16, background: '#f0fdf4', borderLeft: '3px solid #16a34a', color: '#166534' }}>
          <p style={{ fontSize: 13, fontWeight: 700, marginBottom: 4 }}>
            Guardado en “Mis presupuestos” — Ref: {guardadoRef}
          </p>
          <p style={{ fontSize: 12.5, lineHeight: 1.5 }}>
            Ya quedó registrado, aunque el PDF no se haya alcanzado a descargar. Esta pestaña es
            aparte de la del panel: para verlo, vuelve a la pestaña donde tenías Admin o el panel de
            Gustavo y recarga.
          </p>
        </div>
      )}

      {pendienteOrigenNombre && (
        <div className="card" style={{ padding: '10px 14px', marginBottom: 16, background: '#f0fdf4', borderLeft: '3px solid #16a34a' }}>
          <p style={{ fontSize: 13, color: '#166534', fontWeight: 600 }}>
            ✓ Ítems y cliente cargados desde el pendiente de {pendienteOrigenNombre} — revisa antes de generar el PDF.
          </p>
        </div>
      )}

      {origenId && (
        <>
          <div className="card" style={{ padding: '10px 14px', marginBottom: 16, background: '#fef3c7', borderLeft: '3px solid #b45309', color: '#1f2937' }}>
            <p style={{ fontSize: 13, fontWeight: 700, marginBottom: 4 }}>
              Adicional al presupuesto {origenReferencia || 'original'}
            </p>
            <p style={{ fontSize: 12.5, lineHeight: 1.5 }}>
              Acá va <strong>solo lo que se agregó</strong>, no el trabajo que ya estaba presupuestado — eso ya
              se lo cobraste. El original queda intacto.{' '}
              {origenTipo === 'simple' ? (
                <>
                  Se ve abajo para consultarlo: si de un ítem se hicieron más, toca{' '}
                  <strong>“+ Agregar”</strong> en esa línea y pon cuántos <strong>más</strong>.
                  Lo que no estaba en el original, agrégalo con IA, catálogo o a mano.
                </>
              ) : (
                <>
                  Este original no tiene ítems cargados en la app, así que las líneas del adicional
                  se cargan con IA, catálogo o a mano.
                </>
              )}
            </p>
          </div>

          <div className="card" style={{ padding: '12px 14px', marginBottom: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 10, flexWrap: 'wrap', marginBottom: 10 }}>
              <h2 style={{ fontSize: 14, margin: 0 }}>Presupuesto original — solo para consultar</h2>
              {origenTotal != null && (
                <span style={{ fontSize: 12, color: '#6b7280' }}>Total original: ${origenTotal.toLocaleString('es-CL')}</span>
              )}
            </div>
            {origenItems.length === 0 ? (
              <p style={{ fontSize: 12.5, color: '#6b7280' }}>
                {origenTipo === 'externo'
                  ? 'El original es un PDF externo del cliente, así que no hay ítems que consultar acá. El adicional se carga desde cero.'
                  : origenTipo === 'etapas'
                    ? 'El original está armado por etapas, así que no hay ítems sueltos que consultar acá. El adicional se carga desde cero.'
                    : 'El original no tiene ítems cargados.'}
              </p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 260, overflowY: 'auto' }}>
                {origenItems.map((it, i) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 12.5, padding: '5px 0', borderBottom: '1px solid #e5e7eb' }}>
                    <span style={{ flex: 1, minWidth: 0 }}>
                      <span style={{ color: '#9ca3af', fontSize: 11 }}>{it.categoria}</span><br />
                      {it.description} <span style={{ color: '#6b7280' }}>× {it.quantity}</span>
                    </span>
                    <span style={{ whiteSpace: 'nowrap', color: '#6b7280' }}>${it.price.toLocaleString('es-CL')} c/u</span>
                    <input
                      type="number"
                      min="1"
                      value={cantidadDesdeOriginal[i] ?? '1'}
                      onChange={e => setCantidadDesdeOriginal(prev => ({ ...prev, [i]: e.target.value }))}
                      title="Cuántos MÁS se hicieron de esta línea"
                      style={{ flexShrink: 0, width: 58, padding: '3px 6px', fontSize: 12, textAlign: 'center' }}
                    />
                    <button
                      type="button"
                      onClick={() => {
                        agregarDesdeOriginal(it, Number(cantidadDesdeOriginal[i] ?? '1'));
                        setCantidadDesdeOriginal(prev => ({ ...prev, [i]: '1' }));
                      }}
                      style={{ flexShrink: 0, border: '1px solid #c1440e', background: 'transparent', color: '#c1440e', borderRadius: 6, padding: '3px 10px', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}
                    >
                      + Agregar
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
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
