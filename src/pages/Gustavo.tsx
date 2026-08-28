import { useState, useEffect, useRef } from 'react'
import { supabase } from '../lib/supabase'
import Reporte from './Reporte'
import Presupuesto from './Presupuesto'
import PresupuestoEtapas from './PresupuestoEtapas'
import { PanelEstadoResultados, PanelPagoSemanal, PanelHistorialPagos, PanelTrabajadores, PanelObras, PanelPresupuestos, PanelCalendario, PanelStock, PanelBoletas, PanelFacturas, PanelClientes, PanelIdeasContenido } from '../components/PanelesObra'
import { NotasRapidas } from '../components/NotasRapidas'
import { NavIcon, type NavIconName } from '../components/NavIcon'
import { GaleriaArchivos } from '../components/GaleriaArchivos'
import { HiloPendiente } from '../components/HiloPendiente'
import type { Pendiente, TipoPendiente } from '../types'

const GUSTAVO_TOKEN = import.meta.env.VITE_GUSTAVO_TOKEN as string
const REPORTE_TOKEN = import.meta.env.VITE_REPORTE_TOKEN as string
const PRESUPUESTO_TOKEN = import.meta.env.VITE_PRESUPUESTO_TOKEN as string

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
          background: 'var(--surface-alt)', borderRadius: 10, padding: '10px 12px',
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
        <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#2E7D46" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" style={{ margin: '0 auto 10px' }}>
          <circle cx="12" cy="12" r="9" /><path d="M8.3 12.4l2.5 2.5 4.6-5.2" />
        </svg>
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
    <div className="card" style={{ marginBottom: 16 }}>
      {/* ── Always-visible header ── */}
      <div style={{ padding: '18px 16px 14px' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8, marginBottom: 10 }}>
          <div>
            <h2 style={{ fontSize: 22, fontStyle: 'italic', lineHeight: 1.2 }}>{p.cliente_nombre}</h2>
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
          <div style={{ marginBottom: 8, padding: '12px 14px', background: 'var(--surface-alt)', borderRadius: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 5 }}>
              <span style={{ width: 5, height: 5, borderRadius: '50%', background: 'var(--secondary)', display: 'inline-block' }} />
              <span className="font-display" style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Cliente</span>
            </div>
            <p style={{ fontSize: 14, lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>{p.mensaje_cliente}</p>
          </div>
        )}

        {/* Instrucción de Alexandra */}
        {p.descripcion && (
          <div style={{ marginBottom: 8, padding: '12px 14px', background: 'var(--surface-alt)', borderRadius: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 5 }}>
              <span style={{ width: 5, height: 5, borderRadius: '50%', background: 'var(--primary)', display: 'inline-block' }} />
              <span className="font-display" style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Alexandra</span>
            </div>
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
              display: 'flex', alignItems: 'center', gap: 10,
              padding: '11px 14px', border: '1px solid var(--border)',
              borderRadius: 12, textDecoration: 'none', color: 'var(--text)',
              fontSize: 13.5, fontWeight: 600,
            }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#14213D" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
              <path d="M12 21s7-6.4 7-11.5A7 7 0 105 9.5C5 14.6 12 21 12 21z" /><circle cx="12" cy="9.5" r="2.4" />
            </svg>
            {p.direccion}
            <span className="font-display" style={{ marginLeft: 'auto', fontSize: 11, fontWeight: 700, color: 'var(--muted)' }}>Maps</span>
          </a>
        )}
      </div>

      {/* ── Tab nav ── */}
      <div style={{ display: 'flex', borderTop: '1px solid var(--border)', borderBottom: '1px solid var(--border)', background: 'var(--surface-alt)' }}>
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
                    background: grabando ? '#fff5f5' : 'var(--surface-alt)',
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

/* ─── Gustavo page ──────────────────────────────────── */
interface Props {
  token: string | null
}

export default function Gustavo({ token }: Props) {
  const [pendientes, setPendientes] = useState<Pendiente[]>([])
  const [loading, setLoading] = useState(true)
  type SeccionGustavo = 'pendientes' | 'notas' | 'presupuestos' | 'reporte' | 'clientes' | 'obras' | 'calendario' | 'stock' | 'pagos' | 'historial_pagos' | 'trabajadores' | 'resultados' | 'boletas' | 'facturas' | 'presupuestador' | 'ideas'
  const [seccion, setSeccion] = useState<SeccionGustavo | null>(null)
  const [modoPresupuestador, setModoPresupuestador] = useState<'simple' | 'etapas'>('simple')

  const tokenValido = token === GUSTAVO_TOKEN

  const SECCIONES: { key: SeccionGustavo; label: string; icon: NavIconName; destacado?: boolean }[] = [
    { key: 'pendientes', label: 'Mis tareas', icon: 'tareas' },
    { key: 'reporte', label: 'Reporte diario', icon: 'reporte' },
    { key: 'calendario', label: 'Calendario', icon: 'calendario' },
    { key: 'obras', label: 'Obras', icon: 'obras' },
    { key: 'pagos', label: 'Pago semanal', icon: 'pago' },
    { key: 'historial_pagos', label: 'Historial de pagos', icon: 'historial' },
    { key: 'trabajadores', label: 'Trabajadores', icon: 'trabajadores' },
    { key: 'boletas', label: 'Boletas', icon: 'boletas' },
    { key: 'facturas', label: 'Facturas', icon: 'facturas' },
    { key: 'presupuestos', label: 'Mis presupuestos', icon: 'presupuestos' },
    { key: 'presupuestador', label: 'Hacer presupuesto', icon: 'presupuestador', destacado: true },
    { key: 'ideas', label: 'Ideas de contenido', icon: 'ideas' },
    { key: 'notas', label: 'Mis notas', icon: 'notas' },
    { key: 'clientes', label: 'Clientes', icon: 'clientes' },
    { key: 'stock', label: 'Stock', icon: 'stock' },
    { key: 'resultados', label: 'Estado de resultados', icon: 'resultados' },
  ]
  const seccionActual = SECCIONES.find(s => s.key === seccion)

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
        <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#FBFAF7" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" style={{ marginBottom: 16 }}>
          <rect x="5" y="11" width="14" height="10" rx="2" /><path d="M8 11V7a4 4 0 018 0v4" />
        </svg>
        <h2 style={{ fontWeight: 700, marginBottom: 8 }}>Link inválido</h2>
        <p style={{ color: 'var(--muted-inverse)', fontSize: 15 }}>Pídele a Alexandra que te mande el link por WhatsApp.</p>
      </div>
    )
  }

  return (
    <div className="pendientes">
      <div style={{ maxWidth: 500, margin: '0 auto', padding: '1.25rem 14px 3rem' }}>
        {/* Header */}
        <div style={{ padding: '10px 2px 24px', marginBottom: '1.25rem' }}>
          <p className="font-display" style={{ fontSize: 11, fontWeight: 700, color: 'var(--primary)', textTransform: 'uppercase', letterSpacing: '0.16em', marginBottom: 8 }}>Horma Grup</p>
          <h1 style={{ fontSize: 32, fontStyle: 'italic', color: 'var(--text-inverse)', marginBottom: 6, lineHeight: 1.1 }}>Hola, Gustavo</h1>
          {!loading && seccion === null && (
            <p style={{ fontSize: 13, color: 'var(--muted-inverse)', marginBottom: 18 }}>
              {pendientes.length === 0 ? 'Sin pendientes' : `${pendientes.length} pendiente${pendientes.length !== 1 ? 's' : ''} para responder`}
            </p>
          )}
          <div style={{ height: 1, background: 'var(--border-inverse)' }} />
        </div>

        {seccion === null ? (
          /* Home: grilla de cards */
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 10 }}>
            {SECCIONES.map(s => {
              const badge = s.key === 'pendientes' ? pendientes.length : 0
              return (
                <button
                  key={s.key}
                  onClick={() => setSeccion(s.key)}
                  className="card"
                  style={{
                    position: 'relative', padding: '18px 16px', border: 'none', cursor: 'pointer',
                    display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 16,
                    textAlign: 'left', background: s.destacado ? 'var(--primary)' : 'var(--surface)',
                  }}
                >
                  {badge > 0 && (
                    <span style={{
                      position: 'absolute', top: 14, right: 14, minWidth: 19, height: 19, borderRadius: 10,
                      background: 'var(--primary)', color: '#fff', fontSize: 11, fontWeight: 700,
                      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 5px',
                    }}>{badge}</span>
                  )}
                  <NavIcon name={s.icon} color={s.destacado ? '#FBFAF7' : '#14213D'} />
                  <span style={{ fontSize: 13.5, fontWeight: 700, color: s.destacado ? '#FBFAF7' : 'var(--text)' }}>{s.label}</span>
                </button>
              )
            })}
          </div>
        ) : (
          <div>
            {/* Volver */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: '1.1rem' }}>
              <button
                onClick={() => setSeccion(null)}
                style={{ background: 'none', border: '1px solid var(--border-inverse)', borderRadius: 20, padding: '7px 13px', cursor: 'pointer', fontSize: 12, fontWeight: 700, color: 'var(--muted-inverse)' }}
              >← Volver</button>
              <h2 className="font-display" style={{ fontSize: 12, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--primary)' }}>{seccionActual?.label}</h2>
            </div>

            {seccion === 'notas' ? (
              <NotasRapidas autor="gustavo" />
            ) : seccion === 'boletas' ? (
              <PanelBoletas />
            ) : seccion === 'facturas' ? (
              <PanelFacturas />
            ) : seccion === 'presupuestador' ? (
              <div>
                <div style={{ display: 'flex', gap: 4, marginBottom: 14 }}>
                  {(['simple', 'etapas'] as const).map(m => (
                    <button
                      key={m}
                      onClick={() => setModoPresupuestador(m)}
                      style={{
                        padding: '6px 14px', borderRadius: 6, cursor: 'pointer', fontSize: 13, fontWeight: 700,
                        border: `1.5px solid ${modoPresupuestador === m ? 'var(--primary)' : 'var(--border)'}`,
                        background: modoPresupuestador === m ? 'var(--primary)' : 'var(--white)',
                        color: modoPresupuestador === m ? '#fff' : 'var(--muted)',
                      }}
                    >
                      {m === 'simple' ? 'Simple' : 'Por etapas'}
                    </button>
                  ))}
                </div>
                {modoPresupuestador === 'simple' ? (
                  <Presupuesto token={PRESUPUESTO_TOKEN} onVolver={() => setSeccion(null)} />
                ) : (
                  <PresupuestoEtapas embedded onVolver={() => setSeccion(null)} />
                )}
              </div>
            ) : seccion === 'presupuestos' ? (
              <PanelPresupuestos />
            ) : seccion === 'reporte' ? (
              <Reporte token={REPORTE_TOKEN} embedded />
            ) : seccion === 'clientes' ? (
              <PanelClientes />
            ) : seccion === 'obras' ? (
              <PanelObras />
            ) : seccion === 'calendario' ? (
              <PanelCalendario />
            ) : seccion === 'stock' ? (
              <PanelStock />
            ) : seccion === 'pagos' ? (
              <PanelPagoSemanal />
            ) : seccion === 'historial_pagos' ? (
              <PanelHistorialPagos />
            ) : seccion === 'trabajadores' ? (
              <PanelTrabajadores />
            ) : seccion === 'resultados' ? (
              <PanelEstadoResultados />
            ) : seccion === 'ideas' ? (
              <PanelIdeasContenido soloLectura />
            ) : loading ? (
              <div className="spinner" />
            ) : pendientes.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '4rem 1rem' }}>
                <svg width="52" height="52" viewBox="0 0 24 24" fill="none" stroke="#2E7D46" strokeWidth={1.4} strokeLinecap="round" strokeLinejoin="round" style={{ margin: '0 auto 16px' }}>
                  <circle cx="12" cy="12" r="9" /><path d="M8.3 12.4l2.5 2.5 4.6-5.2" />
                </svg>
                <h2 style={{ fontWeight: 800, fontSize: 22, marginBottom: 8 }}>Todo listo</h2>
                <p style={{ color: 'var(--muted-inverse)', fontSize: 16 }}>No tienes pendientes por responder.</p>
              </div>
            ) : (
              pendientes.map(p => (
                <PendienteCardGustavo key={p.id} p={p} onRespondido={loadPendientes} />
              ))
            )}
          </div>
        )}
      </div>
    </div>
  )
}
