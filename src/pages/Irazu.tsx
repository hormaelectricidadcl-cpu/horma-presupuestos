import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import type { Pendiente, TipoPendiente } from '../types'

const IRAZU_TOKEN = import.meta.env.VITE_IRAZU_TOKEN as string

const TIPO_LABELS: Record<TipoPendiente, string> = {
  confirmar_visita: 'Confirmar visita',
  revisar_fotos: 'Revisar fotos',
  presupuesto: 'Presupuesto',
  otro: 'Otro',
  emitir_boleta: 'Emitir boleta',
  emitir_factura: 'Emitir factura',
  cobro: 'Cobro pendiente',
}

const TIPO_EMOJI: Record<TipoPendiente, string> = {
  confirmar_visita: '📅',
  revisar_fotos: '📸',
  presupuesto: '📋',
  otro: '📌',
  emitir_boleta: '🧾',
  emitir_factura: '📄',
  cobro: '💰',
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

/* ─── Card de pendiente ─────────────────────────────── */
function IrazuCard({ p, onRespondido }: { p: Pendiente; onRespondido: () => void }) {
  const [respuesta, setRespuesta] = useState('')
  const [saving, setSaving] = useState(false)
  const [done, setDone] = useState(false)

  const dl = formatDeadlineShort(p.fecha_limite)

  async function enviar() {
    const texto = respuesta.trim()
    if (!texto) {
      alert('Escribe una respuesta antes de enviar.')
      return
    }
    setSaving(true)
    const { error } = await supabase.from('pendientes').update({
      estado: 'respondido',
      respondido_at: new Date().toISOString(),
      respuesta: texto,
    }).eq('id', p.id)

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
      borderTop: `4px solid ${dl.urgent ? 'var(--danger)' : '#8b5cf6'}`,
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
            fontSize: 12, fontWeight: 700,
            color: dl.urgent ? 'var(--danger)' : 'var(--muted)',
            textAlign: 'right', flexShrink: 0, marginTop: 4,
          }}>{dl.text}</span>
        </div>

        {/* Mensaje del cliente */}
        {p.mensaje_cliente && (
          <div style={{ marginBottom: 10, padding: '10px 12px', background: '#f0f9ff', borderRadius: 8, borderLeft: '3px solid #38bdf8' }}>
            <p style={{ fontSize: 11, fontWeight: 700, color: '#0284c7', marginBottom: 3, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Cliente</p>
            <p style={{ fontSize: 14, lineHeight: 1.5 }}>{p.mensaje_cliente}</p>
          </div>
        )}

        {/* Instrucción de Alexandra */}
        {p.descripcion && (
          <div style={{ marginBottom: 14, padding: '10px 12px', background: '#fefce8', borderRadius: 8, borderLeft: '3px solid #eab308' }}>
            <p style={{ fontSize: 11, fontWeight: 700, color: '#854d0e', marginBottom: 3, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Alexandra</p>
            <p style={{ fontSize: 14, lineHeight: 1.5 }}>{p.descripcion}</p>
          </div>
        )}
      </div>

      {/* Response section */}
      <div style={{ padding: '0 16px 18px' }}>
        <div style={{ borderTop: '1px solid var(--border)', paddingTop: 16 }}>
          <div className="field" style={{ marginBottom: 14 }}>
            <label>Tu respuesta</label>
            <textarea
              value={respuesta}
              onChange={e => setRespuesta(e.target.value)}
              placeholder="Ej: Boleta N°12345 emitida por $85.000, enviada al correo del cliente..."
              rows={4}
              style={{ fontSize: 16 }}
            />
          </div>

          <button
            className="btn btn-primary btn-lg"
            onClick={enviar}
            disabled={saving}
            style={{ fontSize: 17, fontWeight: 800, background: '#7c3aed', borderColor: '#7c3aed' }}
          >
            {saving ? 'Enviando...' : '✓ Enviar respuesta'}
          </button>
        </div>
      </div>
    </div>
  )
}

/* ─── Irazú page ────────────────────────────────────── */
interface Props {
  token: string | null
}

export default function Irazu({ token }: Props) {
  const [pendientes, setPendientes] = useState<Pendiente[]>([])
  const [loading, setLoading] = useState(true)

  const tokenValido = token === IRAZU_TOKEN

  const loadPendientes = async () => {
    setLoading(true)
    const { data } = await supabase
      .from('pendientes')
      .select('*')
      .eq('destinatario', 'irazu')
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
      <div className="pendientes" style={{
        minHeight: '100vh',
        display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center',
        padding: '2rem', textAlign: 'center',
      }}>
        <div style={{ fontSize: 48, marginBottom: 16 }}>🔒</div>
        <h2 style={{ fontWeight: 700, marginBottom: 8 }}>Link inválido</h2>
        <p style={{ color: 'var(--muted)', fontSize: 15 }}>Pídele a Alexandra que te mande el link.</p>
      </div>
    )
  }

  return (
    <div className="pendientes">
      <div style={{ maxWidth: 500, margin: '0 auto', padding: '1.25rem 14px 3rem' }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: '1.5rem' }}>
          <div style={{
            width: 44, height: 44,
            background: '#7c3aed', borderRadius: 12,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontWeight: 800, color: '#fff', fontSize: 20, flexShrink: 0,
          }}>I</div>
          <div>
            <h1 style={{ fontSize: 18, fontWeight: 800, lineHeight: 1.2 }}>Hola Irazú</h1>
            {!loading && (
              <p style={{ fontSize: 13, color: 'var(--muted)' }}>
                {pendientes.length === 0
                  ? 'Sin pendientes'
                  : `${pendientes.length} pendiente${pendientes.length !== 1 ? 's' : ''} para resolver`}
              </p>
            )}
          </div>
        </div>

        {loading ? (
          <div className="spinner" />
        ) : pendientes.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '4rem 1rem' }}>
            <div style={{ fontSize: 64, marginBottom: 16 }}>✅</div>
            <h2 style={{ fontWeight: 800, fontSize: 22, marginBottom: 8 }}>Todo al día</h2>
            <p style={{ color: 'var(--muted)', fontSize: 16 }}>No tienes pendientes por resolver.</p>
          </div>
        ) : (
          pendientes.map(p => (
            <IrazuCard key={p.id} p={p} onRespondido={loadPendientes} />
          ))
        )}
      </div>
    </div>
  )
}
