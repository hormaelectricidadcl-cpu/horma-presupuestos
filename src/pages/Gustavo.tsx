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

/* ─── Pendiente card for Gustavo ────────────────────── */
function PendienteCardGustavo({ p, onRespondido }: { p: Pendiente; onRespondido: () => void }) {
  const [respuesta, setRespuesta] = useState('')
  const [nota, setNota] = useState('')
  const [items, setItems] = useState<ItemPresupuesto[]>([])
  const [aiText, setAiText] = useState('')
  const [aiLoading, setAiLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [done, setDone] = useState(false)

  const dl = formatDeadlineShort(p.fecha_limite)

  async function generarConIA() {
    if (!aiText.trim()) {
      alert('Pega primero el texto del trabajo o mensaje del cliente.')
      return
    }
    setAiLoading(true)
    try {
      const res = await fetch('/.netlify/functions/parse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ texto: aiText }),
      })
      const data = await res.json()
      if (!res.ok || !Array.isArray(data.items) || data.items.length === 0) {
        alert('La IA no pudo generar ítems. Revisa el texto o usa el modo manual.')
        return
      }
      const generados: ItemPresupuesto[] = data.items.map((it: {
        categoria: string; descripcion: string; cantidad: number; precioUnitario: number
      }) => ({
        categoria: it.categoria?.toUpperCase() === 'MANO DE OBRA' ? 'MANO DE OBRA' : 'MATERIALES',
        descripcion: it.descripcion || '',
        cantidad: Number(it.cantidad) || 1,
        precioUnitario: Number(it.precioUnitario) || 0,
      }))
      setItems(generados)
      setAiText('')
    } catch {
      alert('Error al contactar la IA. Intenta de nuevo.')
    } finally {
      setAiLoading(false)
    }
  }

  async function enviar() {
    setSaving(true)

    const isPresupuesto = p.tipo === 'presupuesto'
    const itemsValidos = items.filter(i => i.descripcion.trim() && i.precioUnitario > 0)

    if (isPresupuesto && itemsValidos.length === 0 && !respuesta.trim()) {
      alert('Escribe una respuesta o genera los ítems con IA antes de enviar.')
      setSaving(false)
      return
    }

    if (!isPresupuesto && !respuesta.trim() && !nota.trim()) {
      alert('Escribe una respuesta antes de enviar.')
      setSaving(false)
      return
    }

    const update: Partial<Pendiente> = {
      estado: 'respondido',
      respondido_at: new Date().toISOString(),
    }

    if (isPresupuesto) {
      if (itemsValidos.length > 0) update.items = itemsValidos
      update.respuesta = respuesta.trim() || (itemsValidos.length > 0 ? `${itemsValidos.length} ítems ingresados` : '')
    } else {
      const partes = [respuesta.trim(), nota.trim()].filter(Boolean)
      update.respuesta = partes.join('\n\n')
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
              {/* Free text — for simple answers like "agenda a tal hora" */}
              <div className="field" style={{ marginBottom: 14 }}>
                <label>Respuesta (opcional)</label>
                <textarea
                  value={respuesta}
                  onChange={e => setRespuesta(e.target.value)}
                  placeholder="Ej: Agendalo para el jueves, hay que revisar primero el tablero..."
                  rows={3}
                  style={{ fontSize: 15 }}
                />
              </div>

              {/* IA section */}
              <div style={{ background: 'var(--bg)', borderRadius: 'var(--radius-sm)', padding: '12px 14px', marginBottom: 14 }}>
                <p style={{ fontWeight: 700, fontSize: 14, marginBottom: 8 }}>✨ Generar ítems con IA</p>
                <p style={{ fontSize: 13, color: 'var(--secondary)', marginBottom: 10, lineHeight: 1.5 }}>
                  Pega el texto del cliente o tus notas. La IA arma los ítems del presupuesto.
                </p>
                <textarea
                  value={aiText}
                  onChange={e => setAiText(e.target.value)}
                  placeholder="Tablero eléctrico 50.000 - Cableado 3 circuitos - Instalación diferencial..."
                  rows={4}
                  style={{ fontSize: 15, marginBottom: 10, width: '100%' }}
                />
                <button
                  type="button"
                  className="btn btn-primary btn-lg"
                  onClick={generarConIA}
                  disabled={aiLoading}
                  style={{ fontSize: 15, marginBottom: items.length > 0 ? 10 : 0 }}
                >
                  {aiLoading ? '⏳ Generando...' : '✨ Generar ítems'}
                </button>

                {/* Items preview after IA generation */}
                {items.length > 0 && (
                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                      <p style={{ fontSize: 13, fontWeight: 700, color: 'var(--success)' }}>
                        ✓ {items.length} ítems listos
                      </p>
                      <button
                        type="button"
                        onClick={() => setItems([])}
                        style={{ background: 'none', border: 'none', fontSize: 12, color: 'var(--muted)', cursor: 'pointer', fontFamily: 'inherit' }}
                      >
                        Borrar y regenerar
                      </button>
                    </div>
                    {items.map((it, i) => (
                      <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderTop: '1px solid var(--border)', fontSize: 13 }}>
                        <span>
                          <span style={{
                            display: 'inline-block', fontSize: 10, fontWeight: 700, padding: '2px 6px', borderRadius: 10, marginRight: 6,
                            background: it.categoria === 'MATERIALES' ? '#e3f2fd' : '#f3e5f5',
                            color: it.categoria === 'MATERIALES' ? '#1565c0' : '#6a1b9a',
                          }}>
                            {it.categoria === 'MATERIALES' ? 'MAT' : 'MO'}
                          </span>
                          {it.descripcion}
                        </span>
                        <span style={{ fontWeight: 600, flexShrink: 0, marginLeft: 8 }}>
                          ${(it.cantidad * it.precioUnitario).toLocaleString('es-CL')}
                        </span>
                      </div>
                    ))}
                    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', marginTop: 4, borderTop: '2px solid var(--primary)', fontWeight: 700, fontSize: 14 }}>
                      <span>Total sin IVA</span>
                      <span style={{ color: 'var(--primary)' }}>
                        ${items.reduce((s, it) => s + it.cantidad * it.precioUnitario, 0).toLocaleString('es-CL')}
                      </span>
                    </div>
                  </div>
                )}
              </div>
            </>
          ) : (
            <>
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
              <div className="field" style={{ marginBottom: 14 }}>
                <label>Nota adicional (opcional)</label>
                <textarea
                  value={nota}
                  onChange={e => setNota(e.target.value)}
                  placeholder="Algo más que quieras agregar..."
                  rows={2}
                  style={{ fontSize: 15 }}
                />
              </div>
            </>
          )}

          <button
            className="btn btn-primary btn-lg"
            onClick={enviar}
            disabled={saving}
            style={{ fontSize: 17, fontWeight: 800 }}
          >
            {saving ? 'Enviando...' : p.tipo === 'presupuesto' ? '✓ Enviar' : '✓ Enviar respuesta'}
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
      <div className="pendientes" style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '2rem', textAlign: 'center' }}>
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
    </div>
  )
}
