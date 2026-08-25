import { useState, useEffect, useRef } from 'react'
import { supabase } from '../lib/supabase'
import Reporte from './Reporte'
import { PanelEstadoResultados, PanelPagoSemanal, PanelObras, PanelPresupuestos, PanelCalendario, PanelStock } from '../components/PanelesObra'
import { NotasRapidas } from '../components/NotasRapidas'
import { GaleriaArchivos } from '../components/GaleriaArchivos'
import { HiloPendiente } from '../components/HiloPendiente'
import type { Pendiente, TipoPendiente } from '../types'

const GUSTAVO_TOKEN = import.meta.env.VITE_GUSTAVO_TOKEN as string
const REPORTE_TOKEN = import.meta.env.VITE_REPORTE_TOKEN as string

const TIPO_LABELS: Record<TipoPendiente, string> = {
  confirmar_visita: 'Confirmar visita',
  revisar_fotos: 'Revisar fotos',
  presupuesto: 'Ingresar presupuesto',
  otro: 'Revisar',
  emitir_boleta: 'Emitir boleta',
  emitir_factura: 'Emitir factura',
  cobro: 'Cobro pendiente',
  seguimiento: 'Seguimiento',
  pedido_material: 'Pedido de material',
  solicitud_garantia: 'Solicitud de garantía',
}

const TIPO_EMOJI: Record<TipoPendiente, string> = {
  confirmar_visita: '',
  revisar_fotos: '',
  presupuesto: '',
  otro: '',
  emitir_boleta: '',
  emitir_factura: '',
  cobro: '',
  seguimiento: '',
  pedido_material: '',
  solicitud_garantia: '',
}

const PLACEHOLDER: Record<TipoPendiente, string> = {
  confirmar_visita: 'Ej: Confirmado para el martes 15 a las 10am',
  revisar_fotos: 'Ej: El tablero necesita reemplazo del diferencial, hay que cambiar 2 breakers...',
  presupuesto: 'Ej: Tablero nuevo 80k, cableado 3 circuitos 15k c/u, instalación diferencial 25k, mano de obra 40k...',
  otro: 'Escribe aquí tu respuesta...',
  emitir_boleta: 'Escribe aquí tu respuesta...',
  emitir_factura: 'Escribe aquí tu respuesta...',
  cobro: 'Escribe aquí tu respuesta...',
  seguimiento: 'Escribe aquí tu respuesta...',
  pedido_material: 'Ej: Faltan 20m de cable 2.5mm y 3 cajas octogonales para el jueves',
  solicitud_garantia: 'Ej: Se revisó el tablero, era un breaker suelto, ya quedó solucionado',
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
  seguimiento: 'Seguimiento',
  pedido_material: 'Material',
  solicitud_garantia: 'Garantía',
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
          <GaleriaArchivos urls={h.drive_links} />
          {h.respuesta && (
            <div style={{ borderTop: '1px solid var(--border)', paddingTop: 6, marginTop: 4 }}>
              <p style={{ fontSize: 11, fontWeight: 700, color: 'var(--success)', marginBottom: 3 }}>
                {h.destinatario === 'irazu' ? 'Admin respondió:' : 'Tu respuesta:'}
              </p>
              <p style={{ fontSize: 13, lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>{h.respuesta}</p>
            </div>
          )}
          {h.audio_url && (
            <div style={{ marginTop: 6 }}>
              {h.destinatario === 'irazu' ? (
                <>
                  <p style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 4 }}>Archivo de Admin</p>
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
  const [cardTab, setCardTab] = useState<'responder' | 'hilo' | 'historial' | 'archivos'>('responder')
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
    { key: 'hilo' as const, label: 'Hilo' },
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

        {/* Hilo tab */}
        {cardTab === 'hilo' && (
          <HiloPendiente pendienteId={p.id} autor="gustavo" respuestaLegado={p.respuesta} />
        )}

        {/* Historial tab */}
        {cardTab === 'historial' && (
          <HistorialCliente clienteNombre={p.cliente_nombre} excluirId={p.id} />
        )}

        {/* Archivos tab */}
        {cardTab === 'archivos' && (
          p.drive_links?.length > 0 ? (
            <GaleriaArchivos urls={p.drive_links} />
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
    Promise.all([
      supabase.from('pendientes').select('cliente_nombre').order('cliente_nombre'),
      supabase.from('clientes').select('nombre').eq('archivado', true),
    ]).then(([{ data }, { data: archivadosData }]) => {
      const archivados = new Set((archivadosData || []).map((c: { nombre: string }) => c.nombre))
      const unique = [...new Set((data || []).map((d: { cliente_nombre: string }) => d.cliente_nombre))]
        .filter(nombre => !archivados.has(nombre))
        .sort()
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
                    <GaleriaArchivos urls={h.drive_links} />

                    {h.respuesta && (
                      <div style={{ borderTop: '1px solid var(--border)', paddingTop: 6, marginTop: 4 }}>
                        <p style={{ fontSize: 11, fontWeight: 700, color: 'var(--success)', marginBottom: 3 }}>
                          {esIrazu ? 'Admin respondió:' : 'Tu respuesta:'}
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

/* ─── Gustavo page ──────────────────────────────────── */
interface Props {
  token: string | null
}

export default function Gustavo({ token }: Props) {
  const [pendientes, setPendientes] = useState<Pendiente[]>([])
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<'pendientes' | 'notas' | 'presupuestos' | 'reporte' | 'clientes' | 'obras' | 'calendario' | 'stock' | 'pagos' | 'resultados'>('pendientes')

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
        <div style={{ display: 'flex', gap: 4, marginBottom: '1.25rem', borderBottom: '2px solid var(--border)', paddingBottom: 0, overflowX: 'auto', WebkitOverflowScrolling: 'touch' }}>
          {([['pendientes', 'Mis tareas'], ['notas', 'Mis notas'], ['presupuestos', 'Mis presupuestos'], ['reporte', 'Reporte diario'], ['clientes', 'Clientes'], ['obras', 'Obras'], ['calendario', 'Calendario'], ['stock', 'Stock'], ['pagos', 'Pago semanal'], ['resultados', 'Estado de resultados']] as const).map(([k, label]) => (
            <button
              key={k}
              onClick={() => setTab(k)}
              style={{
                padding: '8px 16px', border: 'none', background: 'none', cursor: 'pointer',
                fontSize: 14, fontWeight: tab === k ? 700 : 500,
                color: tab === k ? 'var(--primary)' : 'var(--muted)',
                borderBottom: `2px solid ${tab === k ? 'var(--primary)' : 'transparent'}`,
                marginBottom: -2, whiteSpace: 'nowrap', flexShrink: 0,
              }}
            >{label}</button>
          ))}
        </div>

        {tab === 'notas' ? (
          <NotasRapidas autor="gustavo" />
        ) : tab === 'presupuestos' ? (
          <PanelPresupuestos />
        ) : tab === 'reporte' ? (
          <Reporte token={REPORTE_TOKEN} embedded />
        ) : tab === 'clientes' ? (
          <PanelClientes />
        ) : tab === 'obras' ? (
          <PanelObras />
        ) : tab === 'calendario' ? (
          <PanelCalendario />
        ) : tab === 'stock' ? (
          <PanelStock />
        ) : tab === 'pagos' ? (
          <PanelPagoSemanal />
        ) : tab === 'resultados' ? (
          <PanelEstadoResultados />
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
