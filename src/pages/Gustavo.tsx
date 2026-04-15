import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import type { Pendiente, ItemPresupuesto, TipoPendiente } from '../types'

const GUSTAVO_TOKEN = import.meta.env.VITE_GUSTAVO_TOKEN as string

const TIPO_LABELS: Record<TipoPendiente, string> = {
  confirmar_visita: 'Confirmar visita',
  revisar_fotos: 'Revisar fotos',
  presupuesto: 'Ingresar presupuesto',
  otro: 'Revisar',
}

const TIPO_EMOJI: Record<TipoPendiente, string> = {
  confirmar_visita: '📅',
  revisar_fotos: '📸',
  presupuesto: '📋',
  otro: '📌',
}

function formatDeadlineShort(iso: string): { text: string; urgent: boolean } {
  const diff = new Date(iso).getTime() - Date.now()
  if (diff < 0) return { text: 'Venció', urgent: true }
  const h = Math.floor(diff / 3600000)
  if (h < 1) return { text: 'Vence en menos de 1h', urgent: true }
  if (h < 24) return { text: `Vence en ${h}h`, urgent: h < 4 }
  const d = Math.floor(diff / 86400000)
  return { text: `Vence en ${d} día${d !== 1 ? 's' : ''}`, urgent: false }
}

/* ─── Items form (for presupuesto type) ─────────────── */
function emptyItem(): ItemPresupuesto {
  return { categoria: 'MATERIALES', descripcion: '', cantidad: 1, precioUnitario: 0 }
}

function ItemsForm({
  items,
  onChange,
}: {
  items: ItemPresupuesto[]
  onChange: (items: ItemPresupuesto[]) => void
}) {
  function update(i: number, field: keyof ItemPresupuesto, value: string | number) {
    const next = items.map((item, j) => j === i ? { ...item, [field]: value } : item)
    onChange(next)
  }

  function toggleCategoria(i: number) {
    update(i, 'categoria', items[i].categoria === 'MATERIALES' ? 'MANO DE OBRA' : 'MATERIALES')
  }

  function addItem() { onChange([...items, emptyItem()]) }

  function removeItem(i: number) { onChange(items.filter((_, j) => j !== i)) }

  const total = items.reduce((s, it) => s + it.cantidad * it.precioUnitario, 0)

  return (
    <div style={{ marginTop: 16 }}>
      {items.map((item, i) => (
        <div key={i} style={{
          background: 'var(--bg)',
          borderRadius: 'var(--radius-sm)',
          padding: '12px 14px',
          marginBottom: 10,
          position: 'relative',
          border: '1px solid var(--border)',
        }}>
          {/* Delete button */}
          <button
            type="button"
            onClick={() => removeItem(i)}
            style={{
              position: 'absolute', top: 10, right: 10,
              background: 'none', border: 'none', fontSize: 18,
              color: 'var(--muted)', cursor: 'pointer', lineHeight: 1,
              padding: '2px 6px',
            }}
          >×</button>

          {/* Category toggle */}
          <button
            type="button"
            onClick={() => toggleCategoria(i)}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              padding: '6px 12px',
              borderRadius: 20,
              border: 'none',
              cursor: 'pointer',
              fontWeight: 700,
              fontSize: 12,
              marginBottom: 10,
              ...(item.categoria === 'MATERIALES'
                ? { background: '#e3f2fd', color: '#1565c0' }
                : { background: '#f3e5f5', color: '#6a1b9a' }),
            }}
          >
            {item.categoria === 'MATERIALES' ? '🔩 MATERIALES' : '👷 MANO DE OBRA'}
            <span style={{ fontSize: 10, opacity: 0.7 }}>↔ cambiar</span>
          </button>

          {/* Description */}
          <input
            type="text"
            value={item.descripcion}
            onChange={e => update(i, 'descripcion', e.target.value)}
            placeholder="Descripción del ítem"
            style={{ marginBottom: 10, fontSize: 16 }}
          />

          {/* Cantidad + Precio */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div className="field">
              <label>Cantidad</label>
              <input
                type="number"
                inputMode="numeric"
                min="1"
                value={item.cantidad || ''}
                onChange={e => update(i, 'cantidad', parseInt(e.target.value) || 0)}
                style={{ fontSize: 16 }}
              />
            </div>
            <div className="field">
              <label>Precio unitario ($)</label>
              <input
                type="number"
                inputMode="numeric"
                min="0"
                step="100"
                value={item.precioUnitario || ''}
                onChange={e => update(i, 'precioUnitario', parseInt(e.target.value) || 0)}
                placeholder="0"
                style={{ fontSize: 16 }}
              />
            </div>
          </div>

          {item.cantidad > 0 && item.precioUnitario > 0 && (
            <p style={{ marginTop: 8, fontSize: 13, color: 'var(--secondary)', fontWeight: 600 }}>
              Subtotal: ${(item.cantidad * item.precioUnitario).toLocaleString('es-CL')}
            </p>
          )}
        </div>
      ))}

      <button
        type="button"
        className="btn btn-secondary"
        onClick={addItem}
        style={{ width: '100%', marginBottom: 12, fontSize: 15, padding: '12px' }}
      >
        + Agregar ítem
      </button>

      {items.length > 0 && total > 0 && (
        <div style={{
          background: 'var(--white)',
          border: '2px solid var(--primary)',
          borderRadius: 'var(--radius-sm)',
          padding: '10px 14px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 8,
        }}>
          <span style={{ fontWeight: 600, color: 'var(--secondary)' }}>Total sin IVA</span>
          <span style={{ fontWeight: 800, fontSize: 18, color: 'var(--primary)' }}>
            ${total.toLocaleString('es-CL')}
          </span>
        </div>
      )}
    </div>
  )
}

/* ─── Pendiente card for Gustavo ────────────────────── */
function PendienteCardGustavo({ p, onRespondido }: { p: Pendiente; onRespondido: () => void }) {
  const [respuesta, setRespuesta] = useState('')
  const [items, setItems] = useState<ItemPresupuesto[]>([emptyItem()])
  const [saving, setSaving] = useState(false)
  const [done, setDone] = useState(false)

  const dl = formatDeadlineShort(p.fecha_limite)

  async function enviar() {
    setSaving(true)

    const isPresupuesto = p.tipo === 'presupuesto'
    const itemsValidos = items.filter(i => i.descripcion.trim() && i.precioUnitario > 0)

    if (isPresupuesto && itemsValidos.length === 0) {
      alert('Agrega al menos un ítem con descripción y precio.')
      setSaving(false)
      return
    }

    const update: Partial<Pendiente> = {
      estado: 'respondido',
      respondido_at: new Date().toISOString(),
    }

    if (isPresupuesto) {
      update.items = itemsValidos
      update.respuesta = `${itemsValidos.length} ítems ingresados`
    } else {
      if (!respuesta.trim()) {
        alert('Escribe una respuesta antes de enviar.')
        setSaving(false)
        return
      }
      update.respuesta = respuesta.trim()
    }

    const { error } = await supabase.from('pendientes').update(update).eq('id', p.id)
    if (error) {
      alert('Error al guardar. Intenta de nuevo.')
      setSaving(false)
      return
    }

    setDone(true)
    setSaving(false)
    setTimeout(onRespondido, 800)
  }

  if (done) {
    return (
      <div className="card" style={{ marginBottom: 16, textAlign: 'center', padding: '2.5rem 1rem' }}>
        <div style={{ fontSize: 48, marginBottom: 8 }}>✅</div>
        <p style={{ fontWeight: 700, fontSize: 16 }}>¡Enviado!</p>
      </div>
    )
  }

  return (
    <div className="card" style={{
      marginBottom: 16,
      borderTop: `4px solid ${dl.urgent ? 'var(--danger)' : 'var(--primary)'}`,
    }}>
      <div style={{ padding: '18px 16px 0' }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8, marginBottom: 10 }}>
          <div>
            <h2 style={{ fontSize: 22, fontWeight: 800, lineHeight: 1.2 }}>{p.cliente_nombre}</h2>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6 }}>
              <span style={{ fontSize: 18 }}>{TIPO_EMOJI[p.tipo]}</span>
              <span style={{ fontWeight: 600, color: 'var(--secondary)', fontSize: 15 }}>{TIPO_LABELS[p.tipo]}</span>
            </div>
          </div>
          <span style={{
            fontSize: 12,
            fontWeight: 700,
            color: dl.urgent ? 'var(--danger)' : 'var(--muted)',
            textAlign: 'right',
            flexShrink: 0,
            marginTop: 4,
          }}>{dl.text}</span>
        </div>

        {/* Description */}
        {p.descripcion && (
          <p style={{ fontSize: 15, lineHeight: 1.6, color: 'var(--secondary)', marginBottom: 14, padding: '10px 12px', background: 'var(--bg)', borderRadius: 'var(--radius-sm)' }}>
            {p.descripcion}
          </p>
        )}

        {/* Drive links */}
        {p.drive_links?.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 14 }}>
            {p.drive_links.map((link, i) => (
              <a
                key={i}
                href={link}
                target="_blank"
                rel="noreferrer"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  padding: '12px 14px',
                  background: '#e3f2fd',
                  borderRadius: 'var(--radius-sm)',
                  color: '#1565c0',
                  fontWeight: 600,
                  fontSize: 15,
                  textDecoration: 'none',
                }}
              >
                <span style={{ fontSize: 20 }}>📁</span>
                Ver archivo {p.drive_links.length > 1 ? i + 1 : ''}
              </a>
            ))}
          </div>
        )}
      </div>

      {/* Response section */}
      <div style={{ padding: '0 16px 18px' }}>
        <div style={{ borderTop: '1px solid var(--border)', paddingTop: 16 }}>
          {p.tipo === 'presupuesto' ? (
            <>
              <p style={{ fontWeight: 600, fontSize: 14, color: 'var(--secondary)', marginBottom: 4 }}>
                Ingresa los ítems del presupuesto:
              </p>
              <ItemsForm items={items} onChange={setItems} />
            </>
          ) : (
            <div className="field" style={{ marginBottom: 14 }}>
              <label>Tu respuesta</label>
              <textarea
                value={respuesta}
                onChange={e => setRespuesta(e.target.value)}
                placeholder={
                  p.tipo === 'confirmar_visita' ? 'Ej: Confirmado para el martes 15 a las 10am' :
                  p.tipo === 'revisar_fotos' ? 'Ej: El tablero necesita reemplazo del diferencial...' :
                  'Escribe aquí...'
                }
                rows={4}
                style={{ fontSize: 16 }}
              />
            </div>
          )}

          <button
            className="btn btn-primary btn-lg"
            onClick={enviar}
            disabled={saving}
            style={{ fontSize: 17, fontWeight: 800 }}
          >
            {saving ? 'Enviando...' : p.tipo === 'presupuesto' ? '✓ Enviar ítems' : '✓ Enviar respuesta'}
          </button>
        </div>
      </div>
    </div>
  )
}

/* ─── Gustavo page ──────────────────────────────────── */
interface Props {
  token: string | null
}

export default function Gustavo({ token }: Props) {
  const [pendientes, setPendientes] = useState<Pendiente[]>([])
  const [loading, setLoading] = useState(true)

  const tokenValido = token === GUSTAVO_TOKEN

  const loadPendientes = async () => {
    setLoading(true)
    const { data } = await supabase
      .from('pendientes')
      .select('*')
      .neq('estado', 'respondido')
      .order('fecha_limite', { ascending: true })
    setPendientes((data as Pendiente[]) || [])
    setLoading(false)
  }

  useEffect(() => {
    if (!tokenValido) return
    loadPendientes()
  }, [tokenValido])

  if (!tokenValido) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '2rem', textAlign: 'center' }}>
        <div style={{ fontSize: 48, marginBottom: 16 }}>🔒</div>
        <h2 style={{ fontWeight: 700, marginBottom: 8 }}>Link inválido</h2>
        <p style={{ color: 'var(--muted)', fontSize: 15 }}>Pídele a Alexandra que te mande el link por WhatsApp.</p>
      </div>
    )
  }

  return (
    <div style={{ maxWidth: 500, margin: '0 auto', padding: '1.25rem 14px 3rem' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: '1.5rem' }}>
        <div style={{ width: 44, height: 44, background: 'var(--primary)', borderRadius: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, color: '#fff', fontSize: 20, flexShrink: 0 }}>H</div>
        <div>
          <h1 style={{ fontSize: 18, fontWeight: 800, lineHeight: 1.2 }}>Hola Gustavo</h1>
          {!loading && (
            <p style={{ fontSize: 13, color: 'var(--muted)' }}>
              {pendientes.length === 0 ? 'Sin pendientes' : `${pendientes.length} pendiente${pendientes.length !== 1 ? 's' : ''} para responder`}
            </p>
          )}
        </div>
      </div>

      {loading ? (
        <div className="spinner" />
      ) : pendientes.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '4rem 1rem' }}>
          <div style={{ fontSize: 64, marginBottom: 16 }}>✅</div>
          <h2 style={{ fontWeight: 800, fontSize: 22, marginBottom: 8 }}>Todo listo</h2>
          <p style={{ color: 'var(--muted)', fontSize: 16 }}>No tienes pendientes por responder.</p>
        </div>
      ) : (
        pendientes.map(p => (
          <PendienteCardGustavo key={p.id} p={p} onRespondido={loadPendientes} />
        ))
      )}
    </div>
  )
}
