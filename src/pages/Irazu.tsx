import { useState, useEffect, useRef } from 'react'
import { supabase } from '../lib/supabase'
import type { Pendiente, TipoPendiente } from '../types'

const IRAZU_TOKEN = import.meta.env.VITE_IRAZU_TOKEN as string
const COLOR = '#0891b2'

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
  const [archivo, setArchivo] = useState<File | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const dl = formatDeadlineShort(p.fecha_limite)

  async function enviar() {
    const texto = respuesta.trim()
    if (!texto && !archivo) {
      alert('Escribe una respuesta o adjunta un archivo antes de enviar.')
      return
    }
    setSaving(true)

    // Upload file if selected
    let archivoUrl: string | null = null
    if (archivo) {
      const ext = archivo.name.split('.').pop() || 'bin'
      const filename = `irazu-${p.id}-${Date.now()}.${ext}`
      const { data: uploadData, error: uploadErr } = await supabase.storage
        .from('audio-notas')
        .upload(filename, archivo, { contentType: archivo.type })
      if (!uploadErr && uploadData) {
        const { data: urlData } = supabase.storage.from('audio-notas').getPublicUrl(uploadData.path)
        archivoUrl = urlData.publicUrl
      }
    }

    const updatePayload: Record<string, unknown> = {
      estado: 'respondido',
      respondido_at: new Date().toISOString(),
      respuesta: texto || '(Solo archivo adjunto)',
    }
    if (archivoUrl) updatePayload.audio_url = archivoUrl

    const { error } = await supabase.from('pendientes').update(updatePayload).eq('id', p.id)

    if (error) {
      alert('Error al guardar. Intenta de nuevo.')
      setSaving(false)
      return
    }

    fetch('/api/notificar-respuesta', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        clienteNombre: p.cliente_nombre,
        tipo: p.tipo,
        respuesta: texto || '(Archivo adjunto)',
        destinatario: 'irazu',
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
    <div className="card" style={{ marginBottom: 16, borderTop: `4px solid ${dl.urgent ? 'var(--danger)' : COLOR}` }}>
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
          <span style={{ fontSize: 12, fontWeight: 700, color: dl.urgent ? 'var(--danger)' : 'var(--muted)', textAlign: 'right', flexShrink: 0, marginTop: 4 }}>
            {dl.text}
          </span>
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

        {/* Links */}
        {p.drive_links?.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 14 }}>
            {p.drive_links.map((link, i) => (
              <a key={i} href={link} target="_blank" rel="noreferrer" style={{
                display: 'flex', alignItems: 'center', gap: 10,
                padding: '12px 14px', background: '#e0f2fe',
                borderRadius: 'var(--radius-sm)', color: COLOR,
                fontWeight: 600, fontSize: 15, textDecoration: 'none',
              }}>
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
              placeholder="Ej: Boleta N°12345 emitida por $85.000, enviada al correo del cliente..."
              rows={4}
              style={{ fontSize: 16 }}
            />
          </div>

          {/* File attachment */}
          <div style={{ marginBottom: 18, paddingTop: 14, borderTop: '1px solid var(--border)' }}>
            <p style={{ fontSize: 13, fontWeight: 600, color: 'var(--secondary)', marginBottom: 10 }}>
              Adjuntar archivo (boleta, factura, comprobante)
            </p>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*,.pdf"
              style={{ display: 'none' }}
              onChange={e => setArchivo(e.target.files?.[0] || null)}
            />
            {!archivo ? (
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                style={{
                  width: '100%', padding: '14px',
                  borderRadius: 12, border: '2px dashed var(--border)',
                  background: 'var(--bg)', fontSize: 15, fontWeight: 600,
                  color: 'var(--secondary)', cursor: 'pointer',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
                }}
              >
                <span style={{ fontSize: 22 }}>📎</span>
                Seleccionar archivo
              </button>
            ) : (
              <div style={{ padding: '12px 14px', background: '#ecfdf5', borderRadius: 10, border: '1px solid #6ee7b7', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span style={{ fontSize: 20 }}>{archivo.type.includes('pdf') ? '📄' : '🖼️'}</span>
                  <div>
                    <p style={{ fontSize: 13, fontWeight: 600, color: 'var(--success)' }}>{archivo.name}</p>
                    <p style={{ fontSize: 11, color: 'var(--muted)' }}>{(archivo.size / 1024).toFixed(0)} KB</p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => { setArchivo(null); if (fileInputRef.current) fileInputRef.current.value = '' }}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 18, color: 'var(--muted)' }}
                >✕</button>
              </div>
            )}
          </div>

          <button
            className="btn btn-primary btn-lg"
            onClick={enviar}
            disabled={saving}
            style={{ fontSize: 17, fontWeight: 800, background: COLOR, borderColor: COLOR }}
          >
            {saving ? 'Enviando...' : '✓ Enviar respuesta'}
          </button>
        </div>
      </div>
    </div>
  )
}

function fmtFecha(iso: string) {
  return new Date(iso).toLocaleString('es-CL', {
    timeZone: 'America/Santiago',
    day: '2-digit', month: '2-digit', year: '2-digit',
    hour: '2-digit', minute: '2-digit',
  })
}

const TIPO_LABELS_SHORT: Record<TipoPendiente, string> = {
  confirmar_visita: 'Visita',
  revisar_fotos: 'Fotos',
  presupuesto: 'Presupuesto',
  otro: 'Otro',
  emitir_boleta: 'Boleta',
  emitir_factura: 'Factura',
  cobro: 'Cobro',
}

/* ─── Panel de clientes (Irazú) ─────────────────────── */
function PanelClientesIrazu() {
  const [clientes, setClientes] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [seleccionado, setSeleccionado] = useState<string | null>(null)
  const [historial, setHistorial] = useState<Pendiente[]>([])
  const [loadingH, setLoadingH] = useState(false)

  useEffect(() => {
    supabase
      .from('pendientes')
      .select('cliente_nombre')
      .order('cliente_nombre')
      .then(({ data }) => {
        const unique = [...new Set((data || []).map((d: { cliente_nombre: string }) => d.cliente_nombre))].sort()
        setClientes(unique)
        setLoading(false)
      })
  }, [])

  async function verCliente(nombre: string) {
    setSeleccionado(nombre)
    setLoadingH(true)
    const { data } = await supabase
      .from('pendientes')
      .select('*')
      .eq('cliente_nombre', nombre)
      .order('created_at', { ascending: true })
    setHistorial((data as Pendiente[]) || [])
    setLoadingH(false)
  }

  if (seleccionado) {
    return (
      <div>
        <button
          onClick={() => setSeleccionado(null)}
          style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'none', border: 'none', cursor: 'pointer', fontSize: 14, fontWeight: 600, color: 'var(--secondary)', marginBottom: 16, padding: 0 }}
        >
          ← Volver a clientes
        </button>
        <h2 style={{ fontSize: 18, fontWeight: 800, marginBottom: 16 }}>👤 {seleccionado}</h2>

        {loadingH ? (
          <div className="spinner" />
        ) : historial.length === 0 ? (
          <p style={{ color: 'var(--muted)', textAlign: 'center', padding: '2rem 0' }}>Sin historial.</p>
        ) : (
          <div style={{ position: 'relative' }}>
            <div style={{ position: 'absolute', left: 11, top: 8, bottom: 8, width: 2, background: 'var(--border)' }} />
            {historial.map((h, idx) => {
              const esIrazu = h.destinatario === 'irazu'
              const isLast = idx === historial.length - 1
              return (
                <div key={h.id} style={{ position: 'relative', paddingLeft: 36, marginBottom: isLast ? 0 : 20 }}>
                  <div style={{
                    position: 'absolute', left: 3, top: 4,
                    width: 18, height: 18, borderRadius: '50%',
                    background: h.estado === 'respondido' ? 'var(--success)' : esIrazu ? COLOR : 'var(--primary)',
                    border: '3px solid var(--white)', fontSize: 8, color: '#fff',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}>
                    {h.estado === 'respondido' ? '✓' : '•'}
                  </div>
                  <div style={{ background: 'var(--white)', borderRadius: 12, padding: '12px 14px', boxShadow: '0 1px 4px rgba(0,0,0,0.06)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
                      <span style={{
                        fontSize: 12, fontWeight: 700, padding: '2px 8px', borderRadius: 20,
                        color: esIrazu ? COLOR : 'var(--primary)',
                        background: esIrazu ? '#ecfeff' : '#eff6ff',
                      }}>
                        {esIrazu ? '🧾 ' : '🔧 '}{TIPO_LABELS_SHORT[h.tipo]}
                      </span>
                      <span style={{ fontSize: 11, color: 'var(--muted)' }}>{fmtFecha(h.created_at)}</span>
                      {h.estado === 'respondido' && <span style={{ fontSize: 11, color: 'var(--success)', fontWeight: 600 }}>✓ Respondido</span>}
                    </div>

                    {h.descripcion && (
                      <p style={{ fontSize: 13, color: 'var(--secondary)', lineHeight: 1.5, marginBottom: 4, whiteSpace: 'pre-wrap' }}>
                        {h.descripcion}
                      </p>
                    )}
                    {h.mensaje_cliente && (
                      <p style={{ fontSize: 13, color: '#0284c7', lineHeight: 1.5, marginBottom: 4, whiteSpace: 'pre-wrap' }}>
                        💬 {h.mensaje_cliente}
                      </p>
                    )}
                    {h.direccion && (
                      <a
                        href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(h.direccion)}`}
                        target="_blank" rel="noreferrer"
                        style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 12, color: '#059669', fontWeight: 600, marginBottom: 6, textDecoration: 'none' }}
                      >
                        📍 {h.direccion}
                      </a>
                    )}
                    {h.drive_links && h.drive_links.length > 0 && (
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 6 }}>
                        {h.drive_links.map((link, i) => (
                          <a key={i} href={link} target="_blank" rel="noreferrer"
                            style={{ fontSize: 12, color: '#1565c0', fontWeight: 600, padding: '3px 8px', background: '#e3f2fd', borderRadius: 6, textDecoration: 'none' }}>
                            📁 Archivo {h.drive_links.length > 1 ? i + 1 : ''}
                          </a>
                        ))}
                      </div>
                    )}

                    {h.respuesta && (
                      <div style={{ borderTop: '1px solid var(--border)', paddingTop: 6, marginTop: 4 }}>
                        <p style={{ fontSize: 11, fontWeight: 700, color: 'var(--success)', marginBottom: 3 }}>
                          {esIrazu ? 'Irazú respondió:' : 'Gustavo respondió:'}
                        </p>
                        <p style={{ fontSize: 13, lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>{h.respuesta}</p>
                      </div>
                    )}
                    {h.audio_url && (
                      <div style={{ marginTop: 8 }}>
                        {esIrazu ? (
                          <>
                            <p style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 6 }}>📎 Archivo adjunto</p>
                            {/\.(jpe?g|png|gif|webp)(\?|$)/i.test(h.audio_url) && (
                              <img src={h.audio_url} alt="Boleta" style={{ width: '100%', borderRadius: 8, marginBottom: 6 }} />
                            )}
                            <a href={h.audio_url} target="_blank" rel="noreferrer" style={{ fontSize: 13, color: COLOR, fontWeight: 600 }}>
                              Abrir archivo →
                            </a>
                          </>
                        ) : (
                          <>
                            <p style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 3 }}>🎙️ Nota de voz</p>
                            <audio controls src={h.audio_url} style={{ width: '100%', height: 36 }} />
                          </>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    )
  }

  return (
    <div>
      {loading ? (
        <div className="spinner" />
      ) : clientes.length === 0 ? (
        <p style={{ color: 'var(--muted)', textAlign: 'center', padding: '2rem 0' }}>Aún no hay clientes registrados.</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {clientes.map(nombre => (
            <button
              key={nombre}
              onClick={() => verCliente(nombre)}
              style={{
                width: '100%', padding: '14px 16px',
                borderRadius: 12, border: '1.5px solid var(--border)',
                background: 'var(--white)', fontSize: 15, fontWeight: 600,
                color: 'var(--text)', cursor: 'pointer', textAlign: 'left',
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              }}
            >
              <span>👤 {nombre}</span>
              <span style={{ fontSize: 14, color: 'var(--muted)' }}>→</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

/* ─── Irazú page ────────────────────────────────────── */
interface Props { token: string | null }

export default function Irazu({ token }: Props) {
  const [pendientes, setPendientes] = useState<Pendiente[]>([])
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<'pendientes' | 'clientes'>('pendientes')

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
      <div className="pendientes" style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '2rem', textAlign: 'center' }}>
        <div style={{ fontSize: 48, marginBottom: 16 }}>🔒</div>
        <h2 style={{ fontWeight: 700, marginBottom: 8 }}>Link inválido</h2>
        <p style={{ color: 'var(--muted)', fontSize: 15 }}>Pídele a Alexandra que te mande el link.</p>
      </div>
    )
  }

  return (
    <div className="pendientes">
      <div style={{ maxWidth: 500, margin: '0 auto', padding: '1.25rem 14px 3rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: '1.5rem' }}>
          <div style={{ width: 44, height: 44, background: COLOR, borderRadius: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, color: '#fff', fontSize: 20, flexShrink: 0 }}>I</div>
          <div>
            <h1 style={{ fontSize: 18, fontWeight: 800, lineHeight: 1.2 }}>Hola Irazú</h1>
            {!loading && tab === 'pendientes' && (
              <p style={{ fontSize: 13, color: 'var(--muted)' }}>
                {pendientes.length === 0 ? 'Sin pendientes' : `${pendientes.length} pendiente${pendientes.length !== 1 ? 's' : ''} para resolver`}
              </p>
            )}
          </div>
        </div>

        {/* Tabs */}
        <div style={{ display: 'flex', gap: 4, marginBottom: '1.25rem', borderBottom: '2px solid var(--border)', paddingBottom: 0 }}>
          {([['pendientes', '📋 Mis tareas'], ['clientes', '👥 Clientes']] as const).map(([k, label]) => (
            <button
              key={k}
              onClick={() => setTab(k)}
              style={{
                padding: '8px 16px', border: 'none', background: 'none', cursor: 'pointer',
                fontSize: 14, fontWeight: tab === k ? 700 : 500,
                color: tab === k ? COLOR : 'var(--muted)',
                borderBottom: `2px solid ${tab === k ? COLOR : 'transparent'}`,
                marginBottom: -2,
              }}
            >{label}</button>
          ))}
        </div>

        {tab === 'clientes' ? (
          <PanelClientesIrazu />
        ) : loading ? (
          <div className="spinner" />
        ) : pendientes.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '4rem 1rem' }}>
            <div style={{ fontSize: 64, marginBottom: 16 }}>✅</div>
            <h2 style={{ fontWeight: 800, fontSize: 22, marginBottom: 8 }}>Todo al día</h2>
            <p style={{ color: 'var(--muted)', fontSize: 16 }}>No tienes pendientes por resolver.</p>
          </div>
        ) : (
          pendientes.map(p => <IrazuCard key={p.id} p={p} onRespondido={loadPendientes} />)
        )}
      </div>
    </div>
  )
}
