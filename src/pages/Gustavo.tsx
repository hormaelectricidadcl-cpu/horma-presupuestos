import { useState, useEffect, useRef, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import type { Pendiente, TipoPendiente, ReporteTrabajadorDia, ReporteCompraDia, ReporteCobroDia, ReporteSubcontratoDia, Obra, Trabajador, CuentaPorCobrar, AbonoCuenta } from '../types'

const GUSTAVO_TOKEN = import.meta.env.VITE_GUSTAVO_TOKEN as string

const TIPO_LABELS: Record<TipoPendiente, string> = {
  confirmar_visita: 'Confirmar visita',
  revisar_fotos: 'Revisar fotos',
  presupuesto: 'Ingresar presupuesto',
  otro: 'Revisar',
  emitir_boleta: 'Emitir boleta',
  emitir_factura: 'Emitir factura',
  cobro: 'Cobro pendiente',
}

const TIPO_EMOJI: Record<TipoPendiente, string> = {
  confirmar_visita: '',
  revisar_fotos: '',
  presupuesto: '',
  otro: '',
  emitir_boleta: '',
  emitir_factura: '',
  cobro: '',
}

const PLACEHOLDER: Record<TipoPendiente, string> = {
  confirmar_visita: 'Ej: Confirmado para el martes 15 a las 10am',
  revisar_fotos: 'Ej: El tablero necesita reemplazo del diferencial, hay que cambiar 2 breakers...',
  presupuesto: 'Ej: Tablero nuevo 80k, cableado 3 circuitos 15k c/u, instalación diferencial 25k, mano de obra 40k...',
  otro: 'Escribe aquí tu respuesta...',
  emitir_boleta: 'Escribe aquí tu respuesta...',
  emitir_factura: 'Escribe aquí tu respuesta...',
  cobro: 'Escribe aquí tu respuesta...',
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

function formatTimer(s: number) {
  const m = Math.floor(s / 60)
  const sec = s % 60
  return `${m}:${sec.toString().padStart(2, '0')}`
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

function fmtFecha(iso: string) {
  return new Date(iso).toLocaleString('es-CL', {
    timeZone: 'America/Santiago',
    day: '2-digit', month: '2-digit', year: '2-digit',
    hour: '2-digit', minute: '2-digit',
  })
}

/* ─── Historial inline ──────────────────────────────── */
function HistorialCliente({ clienteNombre, excluirId }: { clienteNombre: string; excluirId: string }) {
  const [historial, setHistorial] = useState<Pendiente[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    supabase
      .from('pendientes')
      .select('*')
      .eq('cliente_nombre', clienteNombre)
      .neq('id', excluirId)
      .order('created_at', { ascending: false })
      .then(({ data }) => {
        setHistorial((data as Pendiente[]) || [])
        setLoading(false)
      })
  }, [clienteNombre, excluirId])

  if (loading) return <div style={{ textAlign: 'center', padding: '8px 0' }}><div className="spinner" style={{ width: 20, height: 20, margin: '0 auto' }} /></div>

  if (historial.length === 0) return (
    <p style={{ fontSize: 13, color: 'var(--muted)', textAlign: 'center', padding: '8px 0' }}>
      Primera vez que aparece este cliente.
    </p>
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {historial.map(h => (
        <div key={h.id} style={{
          background: 'var(--bg)', borderRadius: 10, padding: '10px 12px',
          borderLeft: `3px solid ${h.estado === 'respondido' ? 'var(--success)' : 'var(--primary)'}`,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: h.estado === 'respondido' ? 'var(--success)' : 'var(--primary)' }}>
              {h.estado === 'respondido' ? '✓' : '⏳'} {TIPO_LABELS_SHORT[h.tipo]}
            </span>
            <span style={{ fontSize: 11, color: 'var(--muted)' }}>{fmtFecha(h.created_at)}</span>
          </div>
          {h.descripcion && (
            <p style={{ fontSize: 13, color: 'var(--secondary)', lineHeight: 1.5, marginBottom: 4 }}>
              {h.descripcion}
            </p>
          )}
          {h.mensaje_cliente && (
            <p style={{ fontSize: 13, color: '#0284c7', lineHeight: 1.5, marginBottom: 4 }}>
              {h.mensaje_cliente}
            </p>
          )}
          {h.direccion && (
            <a
              href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(h.direccion)}`}
              target="_blank" rel="noreferrer"
              style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 12, color: '#059669', fontWeight: 600, marginBottom: 4, textDecoration: 'none' }}
            >
              {h.direccion}
            </a>
          )}
          {h.drive_links && h.drive_links.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 4 }}>
              {h.drive_links.map((link, i) => (
                <a key={i} href={link} target="_blank" rel="noreferrer"
                  style={{ fontSize: 12, color: '#1565c0', fontWeight: 600 }}>
                  Archivo {h.drive_links.length > 1 ? i + 1 : ''}
                </a>
              ))}
            </div>
          )}
          {h.respuesta && (
            <div style={{ borderTop: '1px solid var(--border)', paddingTop: 6, marginTop: 4 }}>
              <p style={{ fontSize: 11, fontWeight: 700, color: 'var(--success)', marginBottom: 3 }}>
                {h.destinatario === 'irazu' ? 'Irazú respondió:' : 'Tu respuesta:'}
              </p>
              <p style={{ fontSize: 13, lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>{h.respuesta}</p>
            </div>
          )}
          {h.audio_url && (
            <div style={{ marginTop: 6 }}>
              {h.destinatario === 'irazu' ? (
                <>
                  <p style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 4 }}>Archivo de Irazú</p>
                  {/\.(jpe?g|png|gif|webp)(\?|$)/i.test(h.audio_url) && (
                    <img src={h.audio_url} alt="Archivo" style={{ width: '100%', borderRadius: 8, marginBottom: 6 }} />
                  )}
                  <a href={h.audio_url} target="_blank" rel="noreferrer" style={{ fontSize: 13, color: '#0891b2', fontWeight: 600 }}>
                    Abrir archivo →
                  </a>
                </>
              ) : (
                <>
                  <p style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 3 }}>Nota de voz</p>
                  <audio controls src={h.audio_url} style={{ width: '100%', height: 36 }} />
                </>
              )}
            </div>
          )}
        </div>
      ))}
    </div>
  )
}

/* ─── Pendiente card ────────────────────────────────── */
function PendienteCardGustavo({ p, onRespondido }: { p: Pendiente; onRespondido: () => void }) {
  const [cardTab, setCardTab] = useState<'responder' | 'historial' | 'archivos'>('responder')
  const [respuesta, setRespuesta] = useState('')
  const [nota, setNota] = useState('')
  const [saving, setSaving] = useState(false)
  const [done, setDone] = useState(false)

  const [grabando, setGrabando] = useState(false)
  const [segundos, setSegundos] = useState(0)
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null)
  const [audioPreviewUrl, setAudioPreviewUrl] = useState<string | null>(null)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const dl = formatDeadlineShort(p.fecha_limite)

  async function iniciarGrabacion() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const mimeType = MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : 'audio/mp4'
      const mr = new MediaRecorder(stream, { mimeType })
      mediaRecorderRef.current = mr
      chunksRef.current = []
      mr.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data) }
      mr.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: mimeType })
        setAudioBlob(blob)
        setAudioPreviewUrl(URL.createObjectURL(blob))
        stream.getTracks().forEach(t => t.stop())
      }
      mr.start()
      setGrabando(true)
      setSegundos(0)
      timerRef.current = setInterval(() => setSegundos(s => s + 1), 1000)
    } catch {
      alert('No se pudo acceder al micrófono. Verifica los permisos en tu navegador.')
    }
  }

  function detenerGrabacion() {
    if (timerRef.current) clearInterval(timerRef.current)
    mediaRecorderRef.current?.stop()
    setGrabando(false)
  }

  function descartarAudio() {
    if (audioPreviewUrl) URL.revokeObjectURL(audioPreviewUrl)
    setAudioBlob(null)
    setAudioPreviewUrl(null)
    setSegundos(0)
  }

  async function enviar() {
    const texto = [respuesta.trim(), nota.trim()].filter(Boolean).join('\n\n')
    if (!texto && !audioBlob) {
      alert('Escribe una respuesta o grabá una nota de voz antes de enviar.')
      return
    }
    setSaving(true)

    let savedAudioUrl: string | null = null
    if (audioBlob) {
      const ext = audioBlob.type.includes('mp4') ? 'mp4' : 'webm'
      const filename = `${p.id}-${Date.now()}.${ext}`
      const { data: uploadData, error: uploadErr } = await supabase.storage
        .from('audio-notas')
        .upload(filename, audioBlob, { contentType: audioBlob.type })
      if (!uploadErr && uploadData) {
        const { data: urlData } = supabase.storage.from('audio-notas').getPublicUrl(uploadData.path)
        savedAudioUrl = urlData.publicUrl
      }
    }

    const updatePayload: Record<string, unknown> = {
      estado: 'respondido',
      respondido_at: new Date().toISOString(),
      respuesta: texto || '(Solo nota de voz)',
    }
    if (savedAudioUrl) updatePayload.audio_url = savedAudioUrl

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
        respuesta: texto || '(Nota de voz)',
        destinatario: 'gustavo',
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

  const mapsUrl = p.direccion
    ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(p.direccion)}`
    : null

  const CARD_TABS = [
    { key: 'responder' as const, label: '✓ Responder' },
    { key: 'historial' as const, label: 'Historial' },
    { key: 'archivos' as const, label: `Archivos${p.drive_links?.length ? ` (${p.drive_links.length})` : ''}` },
  ]

  return (
    <div className="card" style={{
      marginBottom: 16,
      borderTop: `4px solid ${dl.urgent ? 'var(--danger)' : 'var(--primary)'}`,
    }}>
      {/* ── Always-visible header ── */}
      <div style={{ padding: '18px 16px 14px' }}>
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
          <div style={{ marginBottom: 8, padding: '10px 12px', background: '#f0f9ff', borderRadius: 8, borderLeft: '3px solid #38bdf8' }}>
            <p style={{ fontSize: 11, fontWeight: 700, color: '#0284c7', marginBottom: 3, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Cliente</p>
            <p style={{ fontSize: 14, lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>{p.mensaje_cliente}</p>
          </div>
        )}

        {/* Instrucción de Alexandra */}
        {p.descripcion && (
          <div style={{ marginBottom: 8, padding: '10px 12px', background: '#fefce8', borderRadius: 8, borderLeft: '3px solid #eab308' }}>
            <p style={{ fontSize: 11, fontWeight: 700, color: '#854d0e', marginBottom: 3, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Alexandra</p>
            <p style={{ fontSize: 14, lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>{p.descripcion}</p>
          </div>
        )}

        {/* Dirección — always visible */}
        {mapsUrl && (
          <a
            href={mapsUrl}
            target="_blank"
            rel="noreferrer"
            style={{
              display: 'flex', alignItems: 'center', gap: 8,
              padding: '9px 12px', background: '#f0fdf4',
              borderRadius: 8, borderLeft: '3px solid #22c55e',
              textDecoration: 'none', color: '#15803d',
              fontSize: 14, fontWeight: 600,
            }}
          >
            <span style={{ fontSize: 18 }}></span>
            {p.direccion}
            <span style={{ marginLeft: 'auto', fontSize: 12, opacity: 0.7 }}>Ver en Maps →</span>
          </a>
        )}
      </div>

      {/* ── Tab nav ── */}
      <div style={{ display: 'flex', borderTop: '1px solid var(--border)', borderBottom: '1px solid var(--border)', background: 'var(--bg)' }}>
        {CARD_TABS.map(t => (
          <button
            key={t.key}
            type="button"
            onClick={() => setCardTab(t.key)}
            style={{
              flex: 1, padding: '10px 4px',
              border: 'none', background: 'none', cursor: 'pointer',
              fontSize: 12, fontWeight: cardTab === t.key ? 700 : 500,
              color: cardTab === t.key ? 'var(--primary)' : 'var(--muted)',
              borderBottom: `2px solid ${cardTab === t.key ? 'var(--primary)' : 'transparent'}`,
              transition: 'all 0.12s',
            }}
          >{t.label}</button>
        ))}
      </div>

      {/* ── Tab content ── */}
      <div style={{ padding: '16px 16px 18px' }}>

        {/* Responder tab */}
        {cardTab === 'responder' && (
          <div>
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
            <div style={{ marginBottom: 18, paddingTop: 14, borderTop: '1px solid var(--border)' }}>
              <p style={{ fontSize: 13, fontWeight: 600, color: 'var(--secondary)', marginBottom: 10 }}>
                O grabá una nota de voz
              </p>
              {!audioPreviewUrl ? (
                <button
                  type="button"
                  onClick={grabando ? detenerGrabacion : iniciarGrabacion}
                  style={{
                    width: '100%', padding: '16px', borderRadius: 12,
                    border: `2px solid ${grabando ? 'var(--danger)' : 'var(--border)'}`,
                    background: grabando ? '#fff5f5' : 'var(--bg)',
                    fontSize: 16, fontWeight: 700,
                    color: grabando ? 'var(--danger)' : 'var(--secondary)',
                    cursor: 'pointer',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12,
                    transition: 'all 0.15s',
                  }}
                >
                  <span style={{ fontSize: 26 }}>{grabando ? '⏹️' : ''}</span>
                  {grabando ? `Grabando ${formatTimer(segundos)} — Toca para detener` : 'Grabar nota de voz'}
                </button>
              ) : (
                <div>
                  <audio controls src={audioPreviewUrl} style={{ width: '100%', marginBottom: 8 }} />
                  <p style={{ fontSize: 13, color: 'var(--success)', textAlign: 'center', marginBottom: 8 }}>
                    ✓ Nota de voz lista — se enviará junto con tu respuesta
                  </p>
                  <button type="button" onClick={descartarAudio} className="btn btn-secondary" style={{ fontSize: 13, width: '100%' }}>
                    ✕ Descartar y grabar de nuevo
                  </button>
                </div>
              )}
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
        )}

        {/* Historial tab */}
        {cardTab === 'historial' && (
          <HistorialCliente clienteNombre={p.cliente_nombre} excluirId={p.id} />
        )}

        {/* Archivos tab */}
        {cardTab === 'archivos' && (
          p.drive_links?.length > 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {p.drive_links.map((link, i) => (
                <a
                  key={i}
                  href={link}
                  target="_blank"
                  rel="noreferrer"
                  style={{
                    display: 'flex', alignItems: 'center', gap: 10,
                    padding: '14px 16px', background: '#e3f2fd',
                    borderRadius: 10, color: '#1565c0',
                    fontWeight: 600, fontSize: 15, textDecoration: 'none',
                  }}
                >
                  <span style={{ fontSize: 22 }}></span>
                  Ver archivo {p.drive_links.length > 1 ? i + 1 : ''}
                  <span style={{ marginLeft: 'auto', fontSize: 13, opacity: 0.7 }}>Abrir →</span>
                </a>
              ))}
            </div>
          ) : (
            <p style={{ fontSize: 14, color: 'var(--muted)', textAlign: 'center', padding: '1.5rem 0' }}>
              Sin archivos adjuntos en este pendiente.
            </p>
          )
        )}
      </div>
    </div>
  )
}

/* ─── Panel de clientes ─────────────────────────────── */
function PanelClientes() {
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
        <h2 style={{ fontSize: 18, fontWeight: 800, marginBottom: 16 }}>{seleccionado}</h2>

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
                    background: h.estado === 'respondido' ? 'var(--success)' : esIrazu ? '#0891b2' : 'var(--primary)',
                    border: '3px solid var(--white)', fontSize: 8, color: '#fff',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}>
                    {h.estado === 'respondido' ? '✓' : '•'}
                  </div>
                  <div style={{ background: 'var(--white)', borderRadius: 12, padding: '12px 14px', boxShadow: '0 1px 4px rgba(0,0,0,0.06)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6, flexWrap: 'wrap' }}>
                      <span style={{
                        fontSize: 12, fontWeight: 700, padding: '2px 8px', borderRadius: 20,
                        color: esIrazu ? '#0891b2' : 'var(--primary)',
                        background: esIrazu ? '#ecfeff' : '#eff6ff',
                      }}>
                        {esIrazu ? '' : ''}{TIPO_LABELS[h.tipo]}
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
                        {h.mensaje_cliente}
                      </p>
                    )}
                    {h.direccion && (
                      <a
                        href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(h.direccion)}`}
                        target="_blank" rel="noreferrer"
                        style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 12, color: '#059669', fontWeight: 600, marginBottom: 6, textDecoration: 'none' }}
                      >
                        {h.direccion}
                      </a>
                    )}
                    {h.drive_links && h.drive_links.length > 0 && (
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 6 }}>
                        {h.drive_links.map((link, i) => (
                          <a key={i} href={link} target="_blank" rel="noreferrer"
                            style={{ fontSize: 12, color: '#1565c0', fontWeight: 600, padding: '3px 8px', background: '#e3f2fd', borderRadius: 6, textDecoration: 'none' }}>
                            Archivo {h.drive_links.length > 1 ? i + 1 : ''}
                          </a>
                        ))}
                      </div>
                    )}

                    {h.respuesta && (
                      <div style={{ borderTop: '1px solid var(--border)', paddingTop: 6, marginTop: 4 }}>
                        <p style={{ fontSize: 11, fontWeight: 700, color: 'var(--success)', marginBottom: 3 }}>
                          {esIrazu ? 'Irazú respondió:' : 'Tu respuesta:'}
                        </p>
                        <p style={{ fontSize: 13, lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>{h.respuesta}</p>
                      </div>
                    )}

                    {h.audio_url && (
                      <div style={{ marginTop: 8 }}>
                        {esIrazu ? (
                          <>
                            <p style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 6 }}>Archivo adjunto</p>
                            {/\.(jpe?g|png|gif|webp)(\?|$)/i.test(h.audio_url) && (
                              <img src={h.audio_url} alt="Boleta" style={{ width: '100%', borderRadius: 8, marginBottom: 6 }} />
                            )}
                            <a href={h.audio_url} target="_blank" rel="noreferrer" style={{ fontSize: 13, color: '#0891b2', fontWeight: 600 }}>
                              Abrir archivo →
                            </a>
                          </>
                        ) : (
                          <>
                            <p style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 3 }}>Nota de voz</p>
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
              <span>{nombre}</span>
              <span style={{ fontSize: 14, color: 'var(--muted)' }}>→</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

/* ─── Presupuesto editable ──────────────────────────── */
function fmtMoney(n: number) {
  const rounded = Math.round(n)
  return `${rounded < 0 ? '-' : ''}$${Math.abs(rounded).toLocaleString('es-CL')}`
}

/* ─── Cuentas por cobrar ─────────────────────────────── */
function PanelCuentasPorCobrar() {
  const [cuentas, setCuentas] = useState<CuentaPorCobrar[]>([])
  const [abonos, setAbonos] = useState<AbonoCuenta[]>([])
  const [loading, setLoading] = useState(true)
  const [mostrarForm, setMostrarForm] = useState(false)
  const [nuevaCuenta, setNuevaCuenta] = useState({ pagador: '', concepto: '', obra: '', total_presupuesto: '' })
  const [nuevoAbono, setNuevoAbono] = useState<Record<string, { fecha: string; monto: string }>>({})

  const cargar = useCallback(async () => {
    const [{ data: c }, { data: a }] = await Promise.all([
      supabase.from('cuentas_por_cobrar').select('*').order('created_at', { ascending: false }),
      supabase.from('abonos_cuenta').select('*'),
    ])
    setCuentas((c as CuentaPorCobrar[]) || [])
    setAbonos((a as AbonoCuenta[]) || [])
    setLoading(false)
  }, [])

  useEffect(() => { cargar() }, [cargar])

  async function crearCuenta() {
    if (!nuevaCuenta.pagador.trim() || !nuevaCuenta.concepto.trim() || !nuevaCuenta.total_presupuesto.trim()) {
      alert('Completa quién paga, el concepto y el presupuesto total.')
      return
    }
    await supabase.from('cuentas_por_cobrar').insert({
      pagador: nuevaCuenta.pagador.trim(),
      concepto: nuevaCuenta.concepto.trim(),
      obra: nuevaCuenta.obra.trim() || null,
      total_presupuesto: Number(nuevaCuenta.total_presupuesto),
    })
    setNuevaCuenta({ pagador: '', concepto: '', obra: '', total_presupuesto: '' })
    setMostrarForm(false)
    cargar()
  }

  async function eliminarCuenta(id: string) {
    if (!window.confirm('¿Seguro que quieres eliminar esta cuenta y todos sus abonos?')) return
    await supabase.from('cuentas_por_cobrar').delete().eq('id', id)
    cargar()
  }

  async function agregarAbono(cuentaId: string) {
    const datos = nuevoAbono[cuentaId] || { fecha: '', monto: '' }
    if (!datos.fecha.trim() || !datos.monto.trim()) {
      alert('Completa la fecha y el monto del abono.')
      return
    }
    await supabase.from('abonos_cuenta').insert({ cuenta_id: cuentaId, fecha: datos.fecha, monto: Number(datos.monto) })
    setNuevoAbono(prev => ({ ...prev, [cuentaId]: { fecha: '', monto: '' } }))
    cargar()
  }

  async function eliminarAbono(id: string) {
    if (!window.confirm('¿Seguro que quieres quitar este abono?')) return
    await supabase.from('abonos_cuenta').delete().eq('id', id)
    cargar()
  }

  if (loading) return <div className="spinner" />

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 14 }}>
        <button className="btn btn-primary" onClick={() => setMostrarForm(x => !x)}>
          {mostrarForm ? 'Cancelar' : '+ Nueva cuenta'}
        </button>
      </div>

      {mostrarForm && (
        <div className="card" style={{ padding: 16, marginBottom: 20 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div className="field">
              <label>¿Quién paga?</label>
              <input type="text" placeholder="Ej: Ignacio" value={nuevaCuenta.pagador} onChange={e => setNuevaCuenta(p => ({ ...p, pagador: e.target.value }))} />
            </div>
            <div className="field">
              <label>Concepto</label>
              <input type="text" placeholder="Ej: Doctora Eloísa dirección 5860" value={nuevaCuenta.concepto} onChange={e => setNuevaCuenta(p => ({ ...p, concepto: e.target.value }))} />
            </div>
            <div className="field">
              <label>Obra relacionada (opcional)</label>
              <input type="text" placeholder="Ej: Ohiggins 126 Limache" value={nuevaCuenta.obra} onChange={e => setNuevaCuenta(p => ({ ...p, obra: e.target.value }))} />
            </div>
            <div className="field">
              <label>Presupuesto total</label>
              <input type="number" min="0" placeholder="Monto en pesos" value={nuevaCuenta.total_presupuesto} onChange={e => setNuevaCuenta(p => ({ ...p, total_presupuesto: e.target.value }))} />
            </div>
            <button className="btn btn-primary" onClick={crearCuenta}>Guardar cuenta</button>
          </div>
        </div>
      )}

      {cuentas.length === 0 ? (
        <p style={{ textAlign: 'center', padding: '3rem', color: 'var(--muted)' }}>Sin cuentas registradas todavía.</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {cuentas.map(c => {
            const abonosCuenta = abonos.filter(a => a.cuenta_id === c.id).sort((a, b) => b.fecha.localeCompare(a.fecha))
            const totalAbonado = abonosCuenta.reduce((s, a) => s + a.monto, 0)
            const restante = c.total_presupuesto - totalAbonado
            const datosNuevo = nuevoAbono[c.id] || { fecha: '', monto: '' }
            return (
              <div key={c.id} className="card" style={{ padding: 16 }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10, marginBottom: 10 }}>
                  <div>
                    <p className="font-serif" style={{ fontSize: 18, marginBottom: 2, color: 'var(--secondary)' }}>{c.concepto}</p>
                    <span className="font-display" style={{ fontSize: 12, color: 'var(--muted)' }}>{c.pagador}{c.obra ? ` › ${c.obra}` : ''}</span>
                  </div>
                  <button className="btn btn-ghost" onClick={() => eliminarCuenta(c.id)} style={{ fontSize: 12, flexShrink: 0 }}>Eliminar cuenta</button>
                </div>

                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 14 }}>
                  <StatTile label="Presupuesto total" valor={fmtMoney(c.total_presupuesto)} />
                  <StatTile label="Abonado" valor={fmtMoney(totalAbonado)} tono="positivo" />
                  <StatTile label="Restante" valor={fmtMoney(restante)} tono={restante > 0 ? 'negativo' : 'positivo'} />
                </div>

                <p style={{ fontSize: 12, fontWeight: 700, color: 'var(--secondary)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 8 }}>Abonos</p>
                {abonosCuenta.length === 0 ? (
                  <p style={{ color: 'var(--muted)', fontSize: 13, marginBottom: 12 }}>Sin abonos registrados.</p>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 12 }}>
                    {abonosCuenta.map(a => (
                      <div key={a.id} style={{ display: 'flex', alignItems: 'center', gap: 10, background: 'var(--bg)', borderRadius: 8, padding: '8px 12px', fontSize: 13 }}>
                        <span style={{ color: 'var(--muted)', fontSize: 12, width: 78, flexShrink: 0 }}>{a.fecha.split('-').reverse().join('/')}</span>
                        <span style={{ flex: 1, fontWeight: 700, color: 'var(--success)' }}>{fmtMoney(a.monto)}</span>
                        <button onClick={() => eliminarAbono(a.id)} className="btn btn-ghost" style={{ fontSize: 11, padding: '3px 8px' }}>Quitar</button>
                      </div>
                    ))}
                  </div>
                )}

                <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' }}>
                  <div className="field" style={{ flex: 1, minWidth: 130 }}>
                    <label>Fecha del abono</label>
                    <input type="date" value={datosNuevo.fecha} onChange={e => setNuevoAbono(prev => ({ ...prev, [c.id]: { ...datosNuevo, fecha: e.target.value } }))} />
                  </div>
                  <div className="field" style={{ flex: 1, minWidth: 130 }}>
                    <label>Monto del abono</label>
                    <input type="number" min="0" placeholder="Monto en pesos" value={datosNuevo.monto} onChange={e => setNuevoAbono(prev => ({ ...prev, [c.id]: { ...datosNuevo, monto: e.target.value } }))} />
                  </div>
                  <button className="btn btn-secondary" onClick={() => agregarAbono(c.id)} style={{ flexShrink: 0 }}>+ Agregar abono</button>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

function StatTile({ label, valor, tono = 'neutral' }: { label: string; valor: string; tono?: 'neutral' | 'positivo' | 'negativo' }) {
  const color = tono === 'positivo' ? 'var(--success)' : tono === 'negativo' ? 'var(--danger)' : 'var(--secondary)'
  return (
    <div style={{ padding: '10px 12px', background: 'var(--bg)', borderRadius: 8, minWidth: 100 }}>
      <p className="font-display" style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.6px', marginBottom: 4 }}>
        {label}
      </p>
      <p className="font-display" style={{ fontSize: 20, fontWeight: 700, color, fontVariantNumeric: 'tabular-nums', lineHeight: 1 }}>
        {valor}
      </p>
    </div>
  )
}

function EditablePresupuesto({ valor, onGuardar }: { valor: number | null; onGuardar: (monto: number | null) => void }) {
  const [editando, setEditando] = useState(false)
  const [texto, setTexto] = useState(valor != null ? String(valor) : '')

  if (!editando) {
    return (
      <span>
        Presupuesto: <strong>{valor != null ? fmtMoney(valor) : 'sin definir'}</strong>{' '}
        <button
          onClick={() => { setTexto(valor != null ? String(valor) : ''); setEditando(true) }}
          style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 12, color: 'var(--primary)', fontWeight: 600, padding: 0 }}
        >
          ✎ editar
        </button>
      </span>
    )
  }

  function guardar() {
    const n = texto.trim() ? Number(texto) : null
    onGuardar(n)
    setEditando(false)
  }

  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
      Presupuesto:
      <input
        type="number"
        min="0"
        autoFocus
        value={texto}
        onChange={e => setTexto(e.target.value)}
        onBlur={guardar}
        onKeyDown={e => { if (e.key === 'Enter') guardar(); if (e.key === 'Escape') setEditando(false) }}
        style={{ width: 120, fontSize: 13, padding: '2px 6px' }}
      />
    </span>
  )
}

/* ─── Historial de obra (modal), agrupado por período ── */
type VistaPeriodo = 'dia' | 'semana' | 'quincena' | 'mes'

const MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre']
const MESES_CORTOS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']

function parseFecha(fecha: string): Date {
  const [y, m, d] = fecha.split('-').map(Number)
  return new Date(y, m - 1, d)
}

function hoySinHora(): Date {
  const n = new Date()
  return new Date(n.getFullYear(), n.getMonth(), n.getDate())
}

function getPeriodo(fecha: string, vista: VistaPeriodo): { key: string; label: string; enCurso: boolean } {
  const date = parseFecha(fecha)
  const today = hoySinHora()

  if (vista === 'mes') {
    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
    const label = `${MESES[date.getMonth()]} ${date.getFullYear()}`
    const enCurso = date.getFullYear() === today.getFullYear() && date.getMonth() === today.getMonth()
    return { key, label, enCurso }
  }

  if (vista === 'quincena') {
    const q = date.getDate() <= 15 ? 1 : 2
    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-Q${q}`
    const startD = q === 1 ? 1 : 16
    const endD = q === 1 ? 15 : new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate()
    const label = `${startD}-${endD} ${MESES_CORTOS[date.getMonth()]} ${date.getFullYear()}`
    const todayQ = today.getDate() <= 15 ? 1 : 2
    const enCurso = date.getFullYear() === today.getFullYear() && date.getMonth() === today.getMonth() && q === todayQ
    return { key, label, enCurso }
  }

  if (vista === 'semana') {
    const dow = (date.getDay() + 6) % 7
    const monday = new Date(date); monday.setDate(date.getDate() - dow)
    const sunday = new Date(monday); sunday.setDate(monday.getDate() + 6)
    const key = `${monday.getFullYear()}-${String(monday.getMonth() + 1).padStart(2, '0')}-${String(monday.getDate()).padStart(2, '0')}`
    const label = monday.getMonth() === sunday.getMonth()
      ? `${monday.getDate()}-${sunday.getDate()} ${MESES_CORTOS[monday.getMonth()]} ${monday.getFullYear()}`
      : `${monday.getDate()} ${MESES_CORTOS[monday.getMonth()]} - ${sunday.getDate()} ${MESES_CORTOS[sunday.getMonth()]} ${sunday.getFullYear()}`
    const todayDow = (today.getDay() + 6) % 7
    const todayMonday = new Date(today); todayMonday.setDate(today.getDate() - todayDow)
    // La semana de trabajo es de lunes a viernes: si hoy es sábado o domingo,
    // la semana ya cerró aunque el domingo del rango todavía no haya llegado.
    const enCurso = todayDow <= 4 && monday.getTime() === todayMonday.getTime()
    return { key, label, enCurso }
  }

  return { key: fecha, label: fecha.split('-').reverse().join('/'), enCurso: fecha === `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}` }
}

const GUIA_OBRAS_PASOS = [
  { titulo: 'Mano de obra', texto: 'Lo que cuesta el trabajo de los trabajadores en esta obra: días trabajados × su tarifa diaria, más el viático de los días que corresponda.' },
  { titulo: 'Compras', texto: 'Materiales y otros gastos que la empresa pagó directamente para esta obra.' },
  { titulo: 'Subcontratos', texto: 'Lo pagado a subcontratistas externos, como un pintor, que no son parte del equipo fijo.' },
  { titulo: 'Adelantos', texto: 'Plata adelantada a un trabajador a cuenta de lo que se le debe. No es su pago completo de la semana.' },
  { titulo: 'Pagos semana', texto: 'La liquidación semanal completa que ya se le pagó a un trabajador.' },
  { titulo: 'Cobrado', texto: 'Lo que el cliente ya pagó por esta obra.' },
  { titulo: 'Saldo', texto: 'Cobrado menos todo lo gastado (mano de obra, compras, subcontratos, adelantos y pagos de semana). En rojo significa que la obra todavía no se paga sola.' },
  { titulo: 'Falta pagar a trabajadores', texto: 'Lo que se les debe en mano de obra, descontando lo que ya se les adelantó o pagó esta semana.' },
  { titulo: 'Por reembolsar', texto: 'Compras que un trabajador pagó con su propia plata y que la empresa todavía le tiene que devolver.' },
]

function GuiaObras({ onClose }: { onClose: () => void }) {
  const [paso, setPaso] = useState(0)
  const total = GUIA_OBRAS_PASOS.length
  const item = GUIA_OBRAS_PASOS[paso]

  return (
    <div
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1100, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}
    >
      <div style={{ background: 'var(--white)', borderRadius: 16, width: '100%', maxWidth: 400, padding: '1.5rem', boxShadow: '0 8px 40px rgba(0,0,0,0.25)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
          <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
            Paso {paso + 1} de {total}
          </span>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 20, cursor: 'pointer', color: 'var(--muted)', lineHeight: 1 }}>✕</button>
        </div>

        <div style={{ display: 'flex', gap: 4, marginBottom: 18 }}>
          {GUIA_OBRAS_PASOS.map((_, i) => (
            <div key={i} style={{ flex: 1, height: 4, borderRadius: 2, background: i <= paso ? 'var(--primary)' : 'var(--border)' }} />
          ))}
        </div>

        <h3 style={{ fontSize: 19, fontWeight: 800, color: 'var(--secondary)', marginBottom: 10 }}>{item.titulo}</h3>
        <p style={{ fontSize: 14, color: 'var(--text)', lineHeight: 1.5, marginBottom: 24 }}>{item.texto}</p>

        <div style={{ display: 'flex', gap: 10 }}>
          {paso > 0 && (
            <button className="btn btn-secondary" onClick={() => setPaso(p => p - 1)} style={{ flex: 1 }}>Atrás</button>
          )}
          {paso < total - 1 ? (
            <button className="btn btn-primary" onClick={() => setPaso(p => p + 1)} style={{ flex: 1 }}>Siguiente</button>
          ) : (
            <button className="btn btn-primary" onClick={onClose} style={{ flex: 1 }}>Listo, entendido</button>
          )}
        </div>
      </div>
    </div>
  )
}

function calcManoDeObra(diarios: ReporteTrabajadorDia[], tarifas: Trabajador[]): number {
  return diarios.reduce((sum, d) => {
    const tarifa = tarifas.find(t => t.nombre === d.trabajador)
    const base = d.fraccion_jornada * (tarifa?.tarifa_diaria || 0)
    const viaticoMonto = d.viatico ? (tarifa?.viatico_diario || 0) : 0
    return sum + base + viaticoMonto
  }, 0)
}

interface PeriodoAgrupado {
  key: string
  label: string
  enCurso: boolean
  diarios: ReporteTrabajadorDia[]
  compras: ReporteCompraDia[]
  cobros: ReporteCobroDia[]
  subcontratos: ReporteSubcontratoDia[]
}

function agruparPorPeriodo(
  vista: VistaPeriodo,
  diarios: ReporteTrabajadorDia[],
  compras: ReporteCompraDia[],
  cobros: ReporteCobroDia[],
  subcontratos: ReporteSubcontratoDia[]
): PeriodoAgrupado[] {
  const mapa = new Map<string, PeriodoAgrupado>()

  function celda(fecha: string): PeriodoAgrupado {
    const { key, label, enCurso } = getPeriodo(fecha, vista)
    if (!mapa.has(key)) mapa.set(key, { key, label, enCurso, diarios: [], compras: [], cobros: [], subcontratos: [] })
    return mapa.get(key)!
  }

  for (const item of diarios) celda(item.fecha).diarios.push(item)
  for (const item of compras) celda(item.fecha).compras.push(item)
  for (const item of cobros) celda(item.fecha).cobros.push(item)
  for (const item of subcontratos) celda(item.fecha).subcontratos.push(item)

  return Array.from(mapa.values()).sort((a, b) => b.key.localeCompare(a.key))
}

function DetalleObraContenido({ diariosObra, comprasObra, cobrosObra, subcontratosObra, tarifas, onMarcarReembolsado }: {
  diariosObra: ReporteTrabajadorDia[]
  comprasObra: ReporteCompraDia[]
  cobrosObra: ReporteCobroDia[]
  subcontratosObra: ReporteSubcontratoDia[]
  tarifas: Trabajador[]
  onMarcarReembolsado?: (compraId: string, reembolsado: boolean) => void
}) {
  const manoDeObra = calcManoDeObra(diariosObra, tarifas)
  const gastoCompras = comprasObra.reduce((s, c) => s + c.monto, 0)
  const gastoSubcontratos = subcontratosObra.reduce((s, c) => s + c.monto, 0)
  const cobrado = cobrosObra.reduce((s, c) => s + c.monto, 0)
  const pagosTrabajadores = diariosObra.filter(d => d.adelanto_monto).sort((a, b) => b.fecha.localeCompare(a.fecha))
  const totalPagadoTrabajadores = pagosTrabajadores.reduce((s, d) => s + (d.adelanto_monto || 0), 0)
  const faltaPagarPeriodo = manoDeObra - totalPagadoTrabajadores

  return (
    <>
      <div style={{ display: 'flex', gap: 16, marginBottom: 18, fontSize: 13, flexWrap: 'wrap' }}>
        {manoDeObra > 0 && <span><strong>Mano de obra:</strong> {fmtMoney(manoDeObra)}</span>}
        {manoDeObra > 0 && <span><strong>Pagado a trabajadores:</strong> {fmtMoney(totalPagadoTrabajadores)}</span>}
        {faltaPagarPeriodo !== 0 && (
          <span style={{ color: faltaPagarPeriodo > 0 ? 'var(--warning)' : 'var(--success)' }}><strong>Falta pagar:</strong> {fmtMoney(faltaPagarPeriodo)}</span>
        )}
        {gastoCompras > 0 && <span><strong>Compras:</strong> {fmtMoney(gastoCompras)}</span>}
        {gastoSubcontratos > 0 && <span><strong>Subcontratos:</strong> {fmtMoney(gastoSubcontratos)}</span>}
        {cobrado > 0 && <span style={{ color: 'var(--success)' }}><strong>Cobrado:</strong> {fmtMoney(cobrado)}</span>}
      </div>

      {diariosObra.length > 0 && (
        <>
          <h3 style={{ fontSize: 13, fontWeight: 700, color: 'var(--secondary)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.5px' }}>Trabajadores por día</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 20 }}>
            {diariosObra.map(d => (
              <div key={d.id} style={{ display: 'flex', alignItems: 'center', gap: 10, background: 'var(--bg)', borderRadius: 8, padding: '8px 12px', fontSize: 13 }}>
                <span style={{ color: 'var(--muted)', fontSize: 12, width: 78, flexShrink: 0 }}>{d.fecha.split('-').reverse().join('/')}</span>
                <span style={{ fontWeight: 600, flex: 1 }}>{d.trabajador}</span>
                <span style={{ color: 'var(--muted)' }}>{d.fraccion_jornada === 1 ? 'Día completo' : 'Medio día'}</span>
                {d.viatico && <span style={{ fontSize: 11, color: 'var(--primary)', fontWeight: 600 }}>Viático</span>}
              </div>
            ))}
          </div>
        </>
      )}

      {pagosTrabajadores.length > 0 && (
        <>
          <h3 style={{ fontSize: 13, fontWeight: 700, color: 'var(--secondary)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.5px' }}>Pagos a trabajadores</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 20 }}>
            {pagosTrabajadores.map(d => (
              <div key={d.id} style={{ display: 'flex', alignItems: 'center', gap: 10, background: 'var(--bg)', borderRadius: 8, padding: '8px 12px', fontSize: 13 }}>
                <span style={{ color: 'var(--muted)', fontSize: 12, width: 78, flexShrink: 0 }}>{d.fecha.split('-').reverse().join('/')}</span>
                <span style={{ fontWeight: 600, flex: 1 }}>{d.trabajador}</span>
                <span style={{ fontSize: 11, fontWeight: 600, color: d.tipo_pago === 'pago_semanal' ? 'var(--success)' : 'var(--warning)' }}>
                  {d.tipo_pago === 'pago_semanal' ? 'Pago semana' : 'Adelanto'}
                </span>
                <span style={{ fontWeight: 700, color: 'var(--danger)' }}>{fmtMoney(d.adelanto_monto || 0)}</span>
              </div>
            ))}
          </div>
        </>
      )}

      {comprasObra.length > 0 && (
        <>
          <h3 style={{ fontSize: 13, fontWeight: 700, color: 'var(--secondary)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.5px' }}>Compras</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 20 }}>
            {comprasObra.map(c => (
              <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 10, background: 'var(--bg)', borderRadius: 8, padding: '8px 12px', fontSize: 13, flexWrap: 'wrap' }}>
                <span style={{ color: 'var(--muted)', fontSize: 12, width: 78, flexShrink: 0 }}>{c.fecha.split('-').reverse().join('/')}</span>
                <span style={{ flex: 1 }}>{c.descripcion}</span>
                {c.pagado_por && (
                  <span style={{ fontSize: 11, fontWeight: 600, color: c.reembolsado ? 'var(--success)' : 'var(--warning)' }}>
                    {c.reembolsado ? `Reembolsado a ${c.pagado_por}` : `Pagó ${c.pagado_por} — sin reembolsar`}
                  </span>
                )}
                <span style={{ fontWeight: 700, color: 'var(--danger)' }}>{fmtMoney(c.monto)}</span>
                {c.pagado_por && onMarcarReembolsado && (
                  <button
                    onClick={() => onMarcarReembolsado(c.id, !c.reembolsado)}
                    className="btn btn-secondary"
                    style={{ fontSize: 11, padding: '3px 8px' }}
                  >
                    {c.reembolsado ? 'Deshacer' : 'Marcar reembolsado'}
                  </button>
                )}
              </div>
            ))}
          </div>
        </>
      )}

      {subcontratosObra.length > 0 && (
        <>
          <h3 style={{ fontSize: 13, fontWeight: 700, color: 'var(--secondary)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.5px' }}>Subcontratos</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 20 }}>
            {subcontratosObra.map(s => (
              <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 10, background: 'var(--bg)', borderRadius: 8, padding: '8px 12px', fontSize: 13 }}>
                <span style={{ color: 'var(--muted)', fontSize: 12, width: 78, flexShrink: 0 }}>{s.fecha.split('-').reverse().join('/')}</span>
                <span style={{ flex: 1 }}>{s.subcontrato}</span>
                <span style={{ fontWeight: 700, color: 'var(--danger)' }}>{fmtMoney(s.monto)}</span>
              </div>
            ))}
          </div>
        </>
      )}

      {cobrosObra.length > 0 && (
        <>
          <h3 style={{ fontSize: 13, fontWeight: 700, color: 'var(--secondary)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.5px' }}>Cobros</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {cobrosObra.map(c => (
              <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 10, background: 'var(--bg)', borderRadius: 8, padding: '8px 12px', fontSize: 13 }}>
                <span style={{ color: 'var(--muted)', fontSize: 12, width: 78, flexShrink: 0 }}>{c.fecha.split('-').reverse().join('/')}</span>
                <span style={{ flex: 1 }}>{c.cliente}</span>
                <span style={{ fontWeight: 700, color: 'var(--success)' }}>{fmtMoney(c.monto)}</span>
              </div>
            ))}
          </div>
        </>
      )}

      {diariosObra.length === 0 && pagosTrabajadores.length === 0 && comprasObra.length === 0 && subcontratosObra.length === 0 && cobrosObra.length === 0 && (
        <p style={{ color: 'var(--muted)', fontSize: 13 }}>Sin registros en este período.</p>
      )}
    </>
  )
}

function PeriodoRow({ periodo, tarifas, onMarcarReembolsado }: { periodo: PeriodoAgrupado; tarifas: Trabajador[]; onMarcarReembolsado?: (compraId: string, reembolsado: boolean) => void }) {
  const [abierto, setAbierto] = useState(false)
  const trabajadores = Array.from(new Set(periodo.diarios.map(d => d.trabajador)))
  const manoDeObra = calcManoDeObra(periodo.diarios, tarifas)
  const gastoCompras = periodo.compras.reduce((s, c) => s + c.monto, 0)
  const gastoSubcontratos = periodo.subcontratos.reduce((s, c) => s + c.monto, 0)
  const cobrado = periodo.cobros.reduce((s, c) => s + c.monto, 0)

  return (
    <div style={{ marginBottom: 10, border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden' }}>
      <button
        onClick={() => setAbierto(a => !a)}
        style={{
          width: '100%', display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px',
          background: periodo.enCurso ? '#fff8f0' : 'var(--bg)', border: 'none', cursor: 'pointer', textAlign: 'left',
        }}
      >
        <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--secondary)' }}>{periodo.label}</span>
        {periodo.enCurso && (
          <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--primary)', background: '#fdf2ea', padding: '2px 6px', borderRadius: 20, textTransform: 'uppercase', letterSpacing: '0.4px' }}>
            En curso
          </span>
        )}
        <span style={{ marginLeft: 'auto', display: 'flex', gap: 12, fontSize: 12, color: 'var(--muted)', flexWrap: 'wrap' }}>
          {trabajadores.length > 0 && <span>{trabajadores.length} trabajador{trabajadores.length !== 1 ? 'es' : ''}</span>}
          {manoDeObra > 0 && <span style={{ color: 'var(--danger)', fontWeight: 600 }}>Mano de obra {fmtMoney(manoDeObra)}</span>}
          {gastoCompras > 0 && <span style={{ color: 'var(--danger)', fontWeight: 600 }}>Compras {fmtMoney(gastoCompras)}</span>}
          {gastoSubcontratos > 0 && <span style={{ color: 'var(--danger)', fontWeight: 600 }}>Subcontratos {fmtMoney(gastoSubcontratos)}</span>}
          {cobrado > 0 && <span style={{ color: 'var(--success)', fontWeight: 600 }}>Cobrado {fmtMoney(cobrado)}</span>}
        </span>
        <span style={{ color: 'var(--muted)', fontSize: 12, flexShrink: 0 }}>{abierto ? '▲' : '▼'}</span>
      </button>
      {abierto && (
        <div style={{ padding: '14px 12px' }}>
          <DetalleObraContenido
            diariosObra={periodo.diarios}
            comprasObra={periodo.compras}
            cobrosObra={periodo.cobros}
            subcontratosObra={periodo.subcontratos}
            tarifas={tarifas}
            onMarcarReembolsado={onMarcarReembolsado}
          />
        </div>
      )}
    </div>
  )
}

function HistorialObraModal({
  obra,
  diarios,
  compras,
  cobros,
  subcontratos,
  tarifas,
  onClose,
  onMarcarReembolsado,
}: {
  obra: string
  diarios: ReporteTrabajadorDia[]
  compras: ReporteCompraDia[]
  cobros: ReporteCobroDia[]
  subcontratos: ReporteSubcontratoDia[]
  tarifas: Trabajador[]
  onClose: () => void
  onMarcarReembolsado?: (compraId: string, reembolsado: boolean) => void
}) {
  const [vista, setVista] = useState<VistaPeriodo>('semana')
  const diariosObra = diarios.filter(d => d.obra === obra && d.presente).sort((a, b) => b.fecha.localeCompare(a.fecha))
  const comprasObra = compras.filter(c => c.obra === obra).sort((a, b) => b.fecha.localeCompare(a.fecha))
  const cobrosObra = cobros.filter(c => c.obra === obra).sort((a, b) => b.fecha.localeCompare(a.fecha))
  const subcontratosObra = subcontratos.filter(s => s.obra === obra).sort((a, b) => b.fecha.localeCompare(a.fecha))
  const periodos = agruparPorPeriodo(vista, diariosObra, comprasObra, cobrosObra, subcontratosObra)

  return (
    <div
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)',
        zIndex: 1000, display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
      }}
    >
      <div style={{
        background: 'var(--white)', borderRadius: '16px 16px 0 0',
        width: '100%', maxWidth: 860, maxHeight: '85vh',
        display: 'flex', flexDirection: 'column',
        boxShadow: '0 -4px 32px rgba(0,0,0,0.15)',
      }}>
        <div style={{
          padding: '1.25rem 1.5rem', borderBottom: '1px solid var(--border)',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0,
        }}>
          <div>
            <h2 style={{ fontSize: 17, fontWeight: 800 }}>{obra}</h2>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 22, cursor: 'pointer', color: 'var(--muted)', lineHeight: 1 }}>✕</button>
        </div>

        <div style={{ padding: '12px 1.5rem', borderBottom: '1px solid var(--border)', flexShrink: 0, display: 'flex', alignItems: 'center', gap: 10 }}>
          <label style={{ fontSize: 12, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.4px' }}>Agrupar por</label>
          <select value={vista} onChange={e => setVista(e.target.value as VistaPeriodo)} style={{ fontSize: 13, padding: '5px 10px', width: 'auto' }}>
            <option value="dia">Día a día</option>
            <option value="semana">Semana</option>
            <option value="quincena">Quincena</option>
            <option value="mes">Mes</option>
          </select>
        </div>

        <div style={{ overflowY: 'auto', padding: '1.25rem 1.5rem', flex: 1 }}>
          {vista === 'dia' ? (
            <DetalleObraContenido
              diariosObra={diariosObra}
              comprasObra={comprasObra}
              cobrosObra={cobrosObra}
              subcontratosObra={subcontratosObra}
              tarifas={tarifas}
              onMarcarReembolsado={onMarcarReembolsado}
            />
          ) : periodos.length === 0 ? (
            <p style={{ color: 'var(--muted)', fontSize: 13, textAlign: 'center', padding: '2rem 0' }}>Sin registros todavía.</p>
          ) : (
            periodos.map(p => <PeriodoRow key={p.key} periodo={p} tarifas={tarifas} onMarcarReembolsado={onMarcarReembolsado} />)
          )}
        </div>
      </div>
    </div>
  )
}

/* ─── Panel de obras ────────────────────────────────── */
function PanelObras() {
  const [diarios, setDiarios] = useState<ReporteTrabajadorDia[]>([])
  const [compras, setCompras] = useState<ReporteCompraDia[]>([])
  const [cobros, setCobros] = useState<ReporteCobroDia[]>([])
  const [subcontratos, setSubcontratos] = useState<ReporteSubcontratoDia[]>([])
  const [obrasMaestro, setObrasMaestro] = useState<Obra[]>([])
  const [trabajadoresTarifas, setTrabajadoresTarifas] = useState<Trabajador[]>([])
  const [loading, setLoading] = useState(true)
  const [historialObra, setHistorialObra] = useState<string | null>(null)
  const [mostrarGuia, setMostrarGuia] = useState(false)

  useEffect(() => {
    if (!localStorage.getItem('horma_guia_obras_vista')) {
      setMostrarGuia(true)
      localStorage.setItem('horma_guia_obras_vista', '1')
    }
  }, [])

  const cargar = useCallback(async () => {
    const [{ data: d }, { data: c }, { data: co }, { data: s }, { data: m }, { data: t }] = await Promise.all([
      supabase.from('reportes_diarios').select('*'),
      supabase.from('reportes_compras').select('*'),
      supabase.from('reportes_cobros').select('*'),
      supabase.from('reportes_subcontratos').select('*'),
      supabase.from('obras').select('*').order('nombre'),
      supabase.from('trabajadores').select('*'),
    ])
    setDiarios((d as ReporteTrabajadorDia[]) || [])
    setCompras((c as ReporteCompraDia[]) || [])
    setCobros((co as ReporteCobroDia[]) || [])
    setSubcontratos((s as ReporteSubcontratoDia[]) || [])
    setObrasMaestro((m as Obra[]) || [])
    setTrabajadoresTarifas((t as Trabajador[]) || [])
    setLoading(false)
  }, [])

  useEffect(() => { cargar() }, [cargar])

  async function guardarPresupuesto(obraId: string, monto: number | null) {
    await supabase.from('obras').update({ presupuesto_total: monto }).eq('id', obraId)
    cargar()
  }

  async function marcarReembolsado(compraId: string, reembolsado: boolean) {
    await supabase.from('reportes_compras').update({ reembolsado }).eq('id', compraId)
    cargar()
  }

  if (loading) return <div className="spinner" />

  const nombres = Array.from(new Set([
    ...obrasMaestro.map(o => o.nombre),
    ...diarios.filter(d => d.presente && d.obra).map(d => d.obra as string),
    ...compras.filter(c => c.obra).map(c => c.obra as string),
    ...cobros.filter(c => c.obra).map(c => c.obra as string),
    ...subcontratos.filter(s => s.obra).map(s => s.obra as string),
  ]))

  const resumen = nombres.map(obra => {
    const maestro = obrasMaestro.find(o => o.nombre === obra)
    const diariosObra = diarios.filter(d => d.obra === obra && d.presente)
    const comprasObra = compras.filter(c => c.obra === obra)
    const cobrosObra = cobros.filter(c => c.obra === obra)
    const subcontratosObra = subcontratos.filter(s => s.obra === obra)

    const gastoCompras = comprasObra.reduce((sum, c) => sum + c.monto, 0)
    const gastoSubcontratos = subcontratosObra.reduce((sum, s) => sum + s.monto, 0)
    const adelantos = diariosObra.filter(d => d.tipo_pago !== 'pago_semanal').reduce((sum, d) => sum + (d.adelanto_monto || 0), 0)
    const pagosSemanales = diariosObra.filter(d => d.tipo_pago === 'pago_semanal').reduce((sum, d) => sum + (d.adelanto_monto || 0), 0)
    const manoDeObra = diariosObra.reduce((sum, d) => {
      const tarifa = trabajadoresTarifas.find(t => t.nombre === d.trabajador)
      const base = d.fraccion_jornada * (tarifa?.tarifa_diaria || 0)
      const viaticoMonto = d.viatico ? (tarifa?.viatico_diario || 0) : 0
      return sum + base + viaticoMonto
    }, 0)
    const faltaPagarTrabajadores = manoDeObra - adelantos - pagosSemanales
    const porReembolsar = comprasObra.filter(c => c.pagado_por && !c.reembolsado).reduce((sum, c) => sum + c.monto, 0)
    const cobrado = cobrosObra.reduce((sum, c) => sum + c.monto, 0)
    const saldo = cobrado - gastoCompras - gastoSubcontratos - adelantos - pagosSemanales

    return { obra, obraId: maestro?.id, cliente: maestro?.cliente ?? null, presupuestoTotal: maestro?.presupuesto_total ?? null, gastoCompras, gastoSubcontratos, manoDeObra, adelantos, pagosSemanales, faltaPagarTrabajadores, porReembolsar, cobrado, saldo }
  })

  if (resumen.length === 0) return (
    <>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 14 }}>
        <button className="btn btn-secondary" onClick={() => setMostrarGuia(true)} style={{ fontSize: 13 }}>
          ¿Cómo se lee esto?
        </button>
      </div>
      {mostrarGuia && <GuiaObras onClose={() => setMostrarGuia(false)} />}
      <p style={{ color: 'var(--muted)', textAlign: 'center', padding: '2rem 0' }}>Sin obras registradas.</p>
    </>
  )

  const porCliente = Object.entries(
    resumen.reduce<Record<string, typeof resumen>>((acc, o) => {
      const key = o.cliente || 'Sin cliente asignado'
      if (!acc[key]) acc[key] = []
      acc[key].push(o)
      return acc
    }, {})
  ).sort(([a], [b]) => (a === 'Sin cliente asignado' ? 1 : b === 'Sin cliente asignado' ? -1 : a.localeCompare(b)))

  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 14 }}>
        <button className="btn btn-secondary" onClick={() => setMostrarGuia(true)} style={{ fontSize: 13 }}>
          ¿Cómo se lee esto?
        </button>
      </div>
      {mostrarGuia && <GuiaObras onClose={() => setMostrarGuia(false)} />}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {porCliente.map(([cliente, obras]) => (
        <div key={cliente}>
          <p className="font-display" style={{ fontSize: 12, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.8px', marginBottom: 8, paddingBottom: 6, borderBottom: '1px solid var(--border)' }}>
            {cliente}
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {obras.map(o => (
              <div key={o.obra} className="card" style={{ padding: '16px 18px', borderTop: `3px solid ${o.saldo >= 0 ? 'var(--success)' : 'var(--danger)'}` }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, marginBottom: 10 }}>
                  <p className="font-serif" style={{ fontSize: 21, flex: 1, color: 'var(--secondary)' }}>{o.obra}</p>
                  <button
                    className="btn btn-secondary"
                    onClick={() => setHistorialObra(o.obra)}
                    style={{ fontSize: 12, padding: '6px 12px', flexShrink: 0 }}
                  >
                    Detalle
                  </button>
                </div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
                  <StatTile label="Mano de obra" valor={fmtMoney(o.manoDeObra)} />
                  <StatTile label="Compras" valor={fmtMoney(o.gastoCompras)} />
                  <StatTile label="Subcontratos" valor={fmtMoney(o.gastoSubcontratos)} />
                  <StatTile label="Adelantos" valor={fmtMoney(o.adelantos)} />
                  <StatTile label="Pagos semana" valor={fmtMoney(o.pagosSemanales)} />
                  <StatTile label="Cobrado" valor={fmtMoney(o.cobrado)} tono="positivo" />
                  <StatTile label="Saldo" valor={fmtMoney(o.saldo)} tono={o.saldo >= 0 ? 'positivo' : 'negativo'} />
                </div>
                <div style={{ fontSize: 13, borderTop: '1px solid var(--border)', paddingTop: 10, display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {o.obraId ? (
                    <EditablePresupuesto valor={o.presupuestoTotal} onGuardar={monto => guardarPresupuesto(o.obraId as string, monto)} />
                  ) : (
                    <span style={{ color: 'var(--muted)' }}>Sin registro en la tabla de obras</span>
                  )}
                  {o.faltaPagarTrabajadores !== 0 && (
                    <span>
                      Falta pagar a trabajadores: <strong style={{ color: o.faltaPagarTrabajadores > 0 ? 'var(--warning)' : 'var(--success)' }}>{fmtMoney(o.faltaPagarTrabajadores)}</strong>
                    </span>
                  )}
                  {o.porReembolsar > 0 && (
                    <span>
                      Por reembolsar (compras que pagó un trabajador con su plata): <strong style={{ color: 'var(--warning)' }}>{fmtMoney(o.porReembolsar)}</strong>
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}

      {historialObra && (
        <HistorialObraModal
          obra={historialObra}
          diarios={diarios}
          compras={compras}
          cobros={cobros}
          subcontratos={subcontratos}
          tarifas={trabajadoresTarifas}
          onClose={() => setHistorialObra(null)}
          onMarcarReembolsado={marcarReembolsado}
        />
      )}
    </div>
    </>
  )
}

/* ─── Gustavo page ──────────────────────────────────── */
interface Props {
  token: string | null
}

export default function Gustavo({ token }: Props) {
  const [pendientes, setPendientes] = useState<Pendiente[]>([])
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<'pendientes' | 'clientes' | 'obras' | 'cuentas'>('pendientes')

  const tokenValido = token === GUSTAVO_TOKEN

  const loadPendientes = async () => {
    setLoading(true)
    const { data } = await supabase
      .from('pendientes')
      .select('*')
      .eq('destinatario', 'gustavo')
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
        <p style={{ color: 'var(--muted)', fontSize: 15 }}>Pídele a Alexandra que te mande el link por WhatsApp.</p>
      </div>
    )
  }

  return (
    <div className="pendientes">
      <div style={{ maxWidth: 500, margin: '0 auto', padding: '1.25rem 14px 3rem' }}>
        {/* Header */}
        <div style={{
          background: 'var(--secondary)', borderRadius: 16, padding: '18px 20px', marginBottom: '1.5rem',
          display: 'flex', alignItems: 'center', gap: 12,
        }}>
          <div style={{
            width: 44, height: 44,
            background: 'var(--primary)', borderRadius: 12,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontWeight: 800, color: '#fff', fontSize: 20, flexShrink: 0,
          }}>H</div>
          <div>
            <p className="font-display" style={{ fontSize: 11, fontWeight: 700, color: 'var(--primary)', textTransform: 'uppercase', letterSpacing: '0.8px', marginBottom: 2 }}>Horma Grup</p>
            <h1 style={{ fontSize: 18, fontWeight: 800, lineHeight: 1.2, color: '#fff' }}>Hola Gustavo</h1>
            {!loading && tab === 'pendientes' && (
              <p style={{ fontSize: 13, color: 'rgba(255,255,255,0.7)' }}>
                {pendientes.length === 0 ? 'Sin pendientes' : `${pendientes.length} pendiente${pendientes.length !== 1 ? 's' : ''} para responder`}
              </p>
            )}
          </div>
        </div>

        {/* Tabs */}
        <div style={{ display: 'flex', gap: 4, marginBottom: '1.25rem', borderBottom: '2px solid var(--border)', paddingBottom: 0 }}>
          {([['pendientes', 'Mis tareas'], ['clientes', 'Clientes'], ['obras', 'Obras'], ['cuentas', 'Cuentas por cobrar']] as const).map(([k, label]) => (
            <button
              key={k}
              onClick={() => setTab(k)}
              style={{
                padding: '8px 16px', border: 'none', background: 'none', cursor: 'pointer',
                fontSize: 14, fontWeight: tab === k ? 700 : 500,
                color: tab === k ? 'var(--primary)' : 'var(--muted)',
                borderBottom: `2px solid ${tab === k ? 'var(--primary)' : 'transparent'}`,
                marginBottom: -2,
              }}
            >{label}</button>
          ))}
        </div>

        {tab === 'clientes' ? (
          <PanelClientes />
        ) : tab === 'obras' ? (
          <PanelObras />
        ) : tab === 'cuentas' ? (
          <PanelCuentasPorCobrar />
        ) : loading ? (
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
