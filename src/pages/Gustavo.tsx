import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import type { Pendiente, TipoPendiente } from '../types'

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

const PLACEHOLDER: Record<TipoPendiente, string> = {
  confirmar_visita: 'Ej: Confirmado para el martes 15 a las 10am',
  revisar_fotos: 'Ej: El tablero necesita reemplazo del diferencial, hay que cambiar 2 breakers...',
  presupuesto: 'Ej: Tablero nuevo 80k, cableado 3 circuitos 15k c/u, instalación diferencial 25k, mano de obra 40k...',
  otro: 'Escribe aquí tu respuesta...',
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

/* ─── Pendiente card ────────────────────────────────── */
function PendienteCardGustavo({ p, onRespondido }: { p: Pendiente; onRespondido: () => void }) {
  const [respuesta, setRespuesta] = useState('')
  const [nota, setNota] = useState('')
  const [saving, setSaving] = useState(false)
  const [done, setDone] = useState(false)

  const dl = formatDeadlineShort(p.fecha_limite)

  async function enviar() {
    const texto = [respuesta.trim(), nota.trim()].filter(Boolean).join('\n\n')
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

    // Notificar a Alexandra (sin bloquear)
    fetch('/.netlify/functions/notificar-respuesta', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        clienteNombre: p.cliente_nombre,
        tipo: p.tipo,
        respuesta: texto,
      }),
    }).catch(() => {})

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
          <p style={{
            fontSize: 15,
            lineHeight: 1.6,
            color: 'var(--secondary)',
            marginBottom: 14,
            padding: '10px 12px',
            background: 'var(--bg)',
            borderRadius: 'var(--radius-sm)',
          }}>
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
          <div className="field" style={{ marginBottom: 14 }}>
            <label>Tu respuesta</label>
            <textarea
              value={respuesta}
              onChange={e => setRespuesta(e.target.value)}
              placeholder={PLACEHOLDER[p.tipo]}
              rows={p.tipo === 'presupuesto' ? 5 : 4}
              style={{ fontSize: 16 }}
            />
          </div>

          <div className="field" style={{ marginBottom: 16 }}>
            <label>Nota adicional (opcional)</label>
            <textarea
              value={nota}
              onChange={e => setNota(e.target.value)}
              placeholder="Algo más que quieras agregar..."
              rows={2}
              style={{ fontSize: 15 }}
            />
          </div>

          <button
            className="btn btn-primary btn-lg"
            onClick={enviar}
            disabled={saving}
            style={{ fontSize: 17, fontWeight: 800 }}
          >
            {saving ? 'Enviando...' : '✓ Enviar respuesta'}
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
      <div className="pendientes" style={{
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '2rem',
        textAlign: 'center',
      }}>
        <div style={{ fontSize: 48, marginBottom: 16 }}>🔒</div>
        <h2 style={{ fontWeight: 700, marginBottom: 8 }}>Link inválido</h2>
        <p style={{ color: 'var(--muted)', fontSize: 15 }}>Pídele a Alexandra que te mande el link por WhatsApp.</p>
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
            background: 'var(--primary)',
            borderRadius: 12,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontWeight: 800, color: '#fff', fontSize: 20, flexShrink: 0,
          }}>H</div>
          <div>
            <h1 style={{ fontSize: 18, fontWeight: 800, lineHeight: 1.2 }}>Hola Gustavo</h1>
            {!loading && (
              <p style={{ fontSize: 13, color: 'var(--muted)' }}>
                {pendientes.length === 0
                  ? 'Sin pendientes'
                  : `${pendientes.length} pendiente${pendientes.length !== 1 ? 's' : ''} para responder`}
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
    </div>
  )
}
