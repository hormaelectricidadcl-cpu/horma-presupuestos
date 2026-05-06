import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { generatePDF } from '../utils/pdfGenerator'
import type { Pendiente, NuevoPendiente, TipoPendiente, ItemPresupuesto, AccionPendiente, Destinatario } from '../types'

const ADMIN_PASSWORD = import.meta.env.VITE_ADMIN_PASSWORD as string

const TIPO_LABELS: Record<TipoPendiente, string> = {
  confirmar_visita: 'Confirmar visita',
  revisar_fotos: 'Revisar fotos',
  presupuesto: 'Ingresar presupuesto',
  otro: 'Otro',
  emitir_boleta: 'Emitir boleta',
  emitir_factura: 'Emitir factura',
  cobro: 'Cobro pendiente',
}

const TIPOS_GUSTAVO: TipoPendiente[] = ['confirmar_visita', 'revisar_fotos', 'presupuesto', 'otro']
const TIPOS_IRAZU: TipoPendiente[] = ['emitir_boleta', 'emitir_factura', 'cobro', 'otro']

const ACCION_LABELS: Record<string, string> = {
  recordatorio: 'Recordatorio enviado',
  items_generados: 'Ítems generados con IA',
  pdf_generado: 'PDF generado',
  visita_agendada: 'Visita agendada en Calendar',
}

const ACCION_EMOJI: Record<string, string> = {
  recordatorio: '📲',
  items_generados: '✨',
  pdf_generado: '📄',
  visita_agendada: '📅',
}

function formatDeadline(iso: string): { text: string; cls: string } {
  const diff = new Date(iso).getTime() - Date.now()
  if (diff < 0) {
    const abs = Math.abs(diff)
    const d = Math.floor(abs / 86400000)
    const h = Math.floor((abs % 86400000) / 3600000)
    const m = Math.floor((abs % 3600000) / 60000)
    const text = d > 0 ? `Venció hace ${d} día${d !== 1 ? 's' : ''} ${h}h` : `Venció hace ${h}h ${m}m`
    return { text, cls: 'deadline-over' }
  }
  if (diff < 2 * 3600000) {
    const h = Math.floor(diff / 3600000)
    const m = Math.floor((diff % 3600000) / 60000)
    return { text: `Vence en ${h}h ${m}m`, cls: 'deadline-warn' }
  }
  if (diff < 24 * 3600000) {
    const h = Math.floor(diff / 3600000)
    return { text: `Vence en ${h}h`, cls: 'deadline-warn' }
  }
  const d = Math.floor(diff / 86400000)
  return { text: `Vence en ${d} día${d !== 1 ? 's' : ''}`, cls: 'deadline-ok' }
}

function formatItemsResumen(items: ItemPresupuesto[]): string {
  if (!items?.length) return '—'
  const total = items.reduce((s, i) => s + i.cantidad * i.precioUnitario, 0)
  const mat = items.filter(i => i.categoria === 'MATERIALES').length
  const mo = items.filter(i => i.categoria === 'MANO DE OBRA').length
  return `${items.length} ítems (${mat} mat / ${mo} MO) — $${total.toLocaleString('es-CL')}`
}

function calendarLink(p: Pendiente): string {
  const title = encodeURIComponent(`Visita - ${p.cliente_nombre}`)
  const parts = [p.descripcion, p.direccion].filter(Boolean)
  const details = encodeURIComponent(parts.join('\n') || '')
  const location = encodeURIComponent(p.direccion || '')
  let dates = ''
  if (p.fecha_trabajo) {
    const start = new Date(p.fecha_trabajo)
    const end = new Date(start.getTime() + 60 * 60 * 1000)
    const fmt = (d: Date) => d.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z'
    dates = `&dates=${fmt(start)}/${fmt(end)}`
  }
  return `https://calendar.google.com/calendar/r/eventedit?text=${title}&details=${details}&location=${location}${dates}`
}

function fmtFecha(iso: string) {
  return new Date(iso).toLocaleString('es-CL', {
    timeZone: 'America/Santiago',
    day: '2-digit', month: '2-digit', year: '2-digit',
    hour: '2-digit', minute: '2-digit',
  })
}

function fmtHaceQuanto(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const m = Math.floor(diff / 60000)
  if (m < 1) return 'hace un momento'
  if (m < 60) return `hace ${m} min`
  const h = Math.floor(m / 60)
  if (h < 24) return `hace ${h}h`
  const d = Math.floor(h / 24)
  return `hace ${d} día${d !== 1 ? 's' : ''}`
}

/* ─── Auth gate ─────────────────────────────────────── */
function LoginForm({ onLogin }: { onLogin: () => void }) {
  const [pwd, setPwd] = useState('')
  const [err, setErr] = useState(false)

  function submit(e: React.FormEvent) {
    e.preventDefault()
    if (pwd === ADMIN_PASSWORD) {
      localStorage.setItem('horma_admin', pwd)
      onLogin()
    } else {
      setErr(true)
      setPwd('')
    }
  }

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg)' }}>
      <div style={{ background: 'var(--white)', borderRadius: 'var(--radius)', padding: '2.5rem 2rem', width: '100%', maxWidth: 360, boxShadow: 'var(--shadow-md)' }}>
        <div style={{ textAlign: 'center', marginBottom: '2rem' }}>
          <div style={{ width: 52, height: 52, background: 'var(--primary)', borderRadius: 14, display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 1rem', fontSize: 24, fontWeight: 800, color: '#fff' }}>H</div>
          <h1 style={{ fontSize: 20, fontWeight: 700 }}>Horma — Pendientes</h1>
          <p style={{ color: 'var(--muted)', fontSize: 14, marginTop: 4 }}>Acceso de administrador</p>
        </div>
        <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <div className="field">
            <label>Contraseña</label>
            <input type="password" value={pwd} onChange={e => { setPwd(e.target.value); setErr(false) }} placeholder="••••••••" autoFocus />
            {err && <span style={{ color: 'var(--danger)', fontSize: 13 }}>Contraseña incorrecta</span>}
          </div>
          <button type="submit" className="btn btn-primary" style={{ width: '100%', padding: '12px' }}>Entrar</button>
        </form>
      </div>
    </div>
  )
}

/* ─── Tareas por cliente ────────────────────────────── */
interface TareaCliente { id: string; texto: string; hecho: boolean }

function TareasCliente({ clienteNombre }: { clienteNombre: string }) {
  const [tareas, setTareas] = useState<TareaCliente[]>([])
  const [input, setInput] = useState('')

  useEffect(() => {
    supabase.from('tareas_clientes').select('*').eq('cliente_nombre', clienteNombre).order('created_at')
      .then(({ data }) => setTareas((data as TareaCliente[]) || []))
  }, [clienteNombre])

  async function agregar() {
    const texto = input.trim()
    if (!texto) return
    const { data } = await supabase.from('tareas_clientes').insert({ cliente_nombre: clienteNombre, texto, hecho: false }).select().single()
    if (data) setTareas(prev => [...prev, data as TareaCliente])
    setInput('')
  }

  async function toggleHecho(t: TareaCliente) {
    await supabase.from('tareas_clientes').update({ hecho: !t.hecho }).eq('id', t.id)
    setTareas(prev => prev.map(x => x.id === t.id ? { ...x, hecho: !x.hecho } : x))
  }

  async function eliminar(id: string) {
    await supabase.from('tareas_clientes').delete().eq('id', id)
    setTareas(prev => prev.filter(x => x.id !== id))
  }

  return (
    <div style={{ borderTop: '1px solid var(--border)', paddingTop: '1rem', marginTop: '1rem' }}>
      <p style={{ fontSize: 13, fontWeight: 700, color: 'var(--secondary)', marginBottom: 10, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
        📋 Mis tareas para este cliente
      </p>
      <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
        <input
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && agregar()}
          placeholder="Ej: Enviar monto de boleta el viernes..."
          style={{ flex: 1, padding: '8px 12px', borderRadius: 8, border: '1.5px solid var(--border)', fontSize: 13, background: 'var(--white)' }}
        />
        <button className="btn btn-primary" onClick={agregar} style={{ padding: '8px 16px', fontSize: 14, fontWeight: 700 }}>+</button>
      </div>
      {tareas.length === 0 ? (
        <p style={{ fontSize: 12, color: 'var(--muted)' }}>Sin tareas para este cliente.</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
          {tareas.map(t => (
            <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 10px', background: t.hecho ? 'transparent' : 'var(--white)', borderRadius: 8, border: '1px solid var(--border)', opacity: t.hecho ? 0.5 : 1 }}>
              <input type="checkbox" checked={t.hecho} onChange={() => toggleHecho(t)} style={{ width: 15, height: 15, accentColor: 'var(--primary)', cursor: 'pointer', flexShrink: 0 }} />
              <span style={{ flex: 1, fontSize: 13, textDecoration: t.hecho ? 'line-through' : 'none' }}>{t.texto}</span>
              <button onClick={() => eliminar(t.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 14, color: 'var(--muted)', lineHeight: 1, padding: '0 2px', flexShrink: 0 }}>✕</button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

/* ─── Historial modal ───────────────────────────────── */
function HistorialModal({
  cliente,
  todos,
  onClose,
  onSeguimiento,
  onPedirBoleta,
}: {
  cliente: string
  todos: Pendiente[]
  onClose: () => void
  onSeguimiento: (nombre: string) => void
  onPedirBoleta: (nombre: string) => void
}) {
  const historial = todos
    .filter(p => p.cliente_nombre === cliente)
    .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())

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
        {/* Header */}
        <div style={{
          padding: '1.25rem 1.5rem', borderBottom: '1px solid var(--border)',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0,
        }}>
          <div>
            <h2 style={{ fontSize: 17, fontWeight: 800 }}>👤 {cliente}</h2>
            <p style={{ fontSize: 13, color: 'var(--muted)', marginTop: 2 }}>
              {historial.length} interacción{historial.length !== 1 ? 'es' : ''} registradas
            </p>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 22, cursor: 'pointer', color: 'var(--muted)', lineHeight: 1 }}>✕</button>
        </div>

        {/* Timeline */}
        <div style={{ overflowY: 'auto', padding: '1.25rem 1.5rem', flex: 1 }}>
          {historial.length === 0 ? (
            <p style={{ color: 'var(--muted)', textAlign: 'center', padding: '2rem' }}>Sin historial registrado.</p>
          ) : (
            <div style={{ position: 'relative' }}>
              {/* vertical line */}
              <div style={{ position: 'absolute', left: 15, top: 8, bottom: 8, width: 2, background: 'var(--border)' }} />

              {historial.map((p, idx) => {
                const isLast = idx === historial.length - 1
                return (
                  <div key={p.id} style={{ position: 'relative', paddingLeft: 44, marginBottom: isLast ? 0 : 24 }}>
                    {/* dot */}
                    <div style={{
                      position: 'absolute', left: 7, top: 4,
                      width: 18, height: 18, borderRadius: '50%',
                      background: p.estado === 'respondido' ? 'var(--success)' : 'var(--primary)',
                      border: '3px solid var(--white)',
                      boxShadow: '0 0 0 2px ' + (p.estado === 'respondido' ? 'var(--success)' : 'var(--primary)'),
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: 8, color: '#fff',
                    }}>
                      {p.estado === 'respondido' ? '✓' : '•'}
                    </div>

                    <div style={{ background: 'var(--bg)', borderRadius: 'var(--radius-sm)', padding: '12px 14px' }}>
                      {/* meta */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 6 }}>
                        <span style={{ fontSize: 11, color: 'var(--muted)' }}>{fmtFecha(p.created_at)}</span>
                        <span className={`badge badge-${p.tipo === 'confirmar_visita' ? 'visita' : p.tipo === 'presupuesto' ? 'presupuesto' : p.tipo === 'revisar_fotos' ? 'fotos' : 'otro'}`} style={{ fontSize: 11 }}>
                          {TIPO_LABELS[p.tipo]}
                        </span>
                        {p.estado === 'respondido' && (
                          <span className="badge badge-respondido" style={{ fontSize: 11 }}>Respondido</span>
                        )}
                      </div>

                      {/* description */}
                      {p.descripcion && (
                        <p style={{ fontSize: 13, color: 'var(--secondary)', lineHeight: 1.5, marginBottom: 6, whiteSpace: 'pre-wrap' }}>
                          {p.descripcion}
                        </p>
                      )}

                      {p.mensaje_cliente && (
                        <p style={{ fontSize: 13, color: '#0284c7', lineHeight: 1.5, marginBottom: 6, whiteSpace: 'pre-wrap' }}>
                          💬 {p.mensaje_cliente}
                        </p>
                      )}

                      {p.direccion && (
                        <a
                          href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(p.direccion)}`}
                          target="_blank" rel="noreferrer"
                          style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 12, color: '#059669', fontWeight: 600, marginBottom: 6, textDecoration: 'none' }}
                        >
                          📍 {p.direccion}
                        </a>
                      )}

                      {p.drive_links?.length > 0 && (
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 6 }}>
                          {p.drive_links.map((link, i) => (
                            <a
                              key={i}
                              href={link}
                              target="_blank"
                              rel="noreferrer"
                              className="btn btn-secondary"
                              style={{ fontSize: 12, padding: '4px 10px' }}
                            >
                              📁 Archivo {p.drive_links.length > 1 ? i + 1 : ''}
                            </a>
                          ))}
                        </div>
                      )}

                      {/* response */}
                      {p.estado === 'respondido' && p.respuesta && (
                        <div style={{ borderTop: '1px solid var(--border)', paddingTop: 8, marginTop: p.descripcion ? 0 : 0 }}>
                          <p style={{ fontSize: 11, fontWeight: 700, color: 'var(--success)', marginBottom: 4 }}>
                            ✓ {p.destinatario === 'irazu' ? 'Irazú' : 'Gustavo'} respondió — {p.respondido_at ? fmtFecha(p.respondido_at) : ''}
                          </p>
                          <p style={{ fontSize: 13, lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>{p.respuesta}</p>
                        </div>
                      )}

                      {p.estado === 'respondido' && p.audio_url && (
                        <div style={{ marginTop: 8 }}>
                          {p.destinatario === 'irazu' ? (
                            <>
                              <p style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 6 }}>📎 Archivo adjunto</p>
                              {/\.(jpe?g|png|gif|webp|bmp)(\?|$)/i.test(p.audio_url) ? (
                                <img src={p.audio_url} alt="Archivo" style={{ width: '100%', borderRadius: 6, marginBottom: 6 }} />
                              ) : null}
                              <a href={p.audio_url} target="_blank" rel="noreferrer" style={{ fontSize: 12, color: '#0891b2' }}>
                                Abrir archivo →
                              </a>
                            </>
                          ) : (
                            <>
                              <p style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 4 }}>🎙️ Nota de voz</p>
                              <audio controls src={p.audio_url} style={{ width: '100%', height: 36 }} />
                            </>
                          )}
                        </div>
                      )}

                      {/* items summary */}
                      {p.items?.length > 0 && (
                        <p style={{ fontSize: 12, color: 'var(--muted)', marginTop: 6 }}>
                          📋 {formatItemsResumen(p.items)}
                        </p>
                      )}

                      {/* acciones */}
                      {p.acciones && p.acciones.length > 0 && (
                        <div style={{ marginTop: 6, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                          {p.acciones.map((a, i) => (
                            <span key={i} style={{ fontSize: 11, color: 'var(--muted)' }} title={ACCION_LABELS[a.tipo]}>
                              {ACCION_EMOJI[a.tipo]} {fmtFecha(a.timestamp)}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* Client tasks */}
        <div style={{ padding: '0 1.5rem', flexShrink: 0 }}>
          <TareasCliente clienteNombre={cliente} />
        </div>

        {/* Footer */}
        <div style={{ padding: '1rem 1.5rem', borderTop: '1px solid var(--border)', flexShrink: 0, display: 'flex', gap: 10 }}>
          <button
            className="btn btn-secondary"
            style={{ flex: 1, fontWeight: 600, fontSize: 14 }}
            onClick={() => { onPedirBoleta(cliente); onClose() }}
          >
            🧾 Pedir boleta a Irazú
          </button>
          <button
            className="btn btn-primary"
            style={{ flex: 1, fontWeight: 700, fontSize: 14 }}
            onClick={() => { onSeguimiento(cliente); onClose() }}
          >
            + Nuevo pendiente
          </button>
        </div>
      </div>
    </div>
  )
}

/* ─── Create form ───────────────────────────────────── */
interface FormState {
  cliente_nombre: string
  tipo: TipoPendiente
  descripcion: string
  mensaje_cliente: string
  fecha_limite: string
  fecha_trabajo: string
  direccion: string
  drive_links: string[]
  destinatario: Destinatario
}

function emptyForm(clienteInicial = '', destinatarioInicial: Destinatario = 'gustavo', tipoInicial: TipoPendiente = 'confirmar_visita'): FormState {
  const now = new Date()
  now.setHours(now.getHours() + 4)
  return {
    cliente_nombre: clienteInicial,
    tipo: tipoInicial,
    descripcion: '',
    mensaje_cliente: '',
    fecha_limite: now.toISOString().slice(0, 16),
    fecha_trabajo: '',
    direccion: '',
    drive_links: [''],
    destinatario: destinatarioInicial,
  }
}

function CrearForm({
  onCreated,
  onCancel,
  clienteInicial = '',
  destinatarioInicial = 'gustavo',
  tipoInicial = 'confirmar_visita',
}: {
  onCreated: () => void
  onCancel: () => void
  clienteInicial?: string
  destinatarioInicial?: Destinatario
  tipoInicial?: TipoPendiente
}) {
  const [form, setForm] = useState<FormState>(() => emptyForm(clienteInicial, destinatarioInicial, tipoInicial))
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState('')

  function setField<K extends keyof FormState>(k: K, v: FormState[K]) {
    setForm(f => ({ ...f, [k]: v }))
  }

  function setLink(i: number, v: string) {
    setForm(f => {
      const links = [...f.drive_links]
      links[i] = v
      return { ...f, drive_links: links }
    })
  }

  function addLink() { setForm(f => ({ ...f, drive_links: [...f.drive_links, ''] })) }
  function removeLink(i: number) {
    setForm(f => ({ ...f, drive_links: f.drive_links.filter((_, j) => j !== i) }))
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!form.cliente_nombre.trim() || !form.fecha_limite) return
    setSaving(true)
    setMsg('')

    const payload: NuevoPendiente = {
      cliente_nombre: form.cliente_nombre.trim(),
      tipo: form.tipo,
      descripcion: form.descripcion.trim(),
      mensaje_cliente: form.mensaje_cliente.trim(),
      fecha_limite: new Date(form.fecha_limite).toISOString(),
      fecha_trabajo: form.fecha_trabajo ? new Date(form.fecha_trabajo).toISOString() : null,
      direccion: form.direccion.trim() || null,
      drive_links: form.drive_links.filter(l => l.trim()),
      destinatario: form.destinatario,
    }

    const { error } = await supabase.from('pendientes').insert(payload)
    if (error) {
      setMsg('Error al guardar: ' + error.message)
      setSaving(false)
      return
    }

    fetch('/api/notificar', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        clienteNombre: payload.cliente_nombre,
        tipo: payload.tipo,
        fechaLimite: payload.fecha_limite,
      }),
    }).catch(() => {})

    setSaving(false)
    onCreated()
  }

  return (
    <div style={{ background: 'var(--white)', borderRadius: 'var(--radius)', padding: '1.5rem', boxShadow: 'var(--shadow-md)', marginBottom: '1.5rem', border: '2px solid var(--primary)' }}>
      <h3 style={{ marginBottom: '1.25rem', fontSize: 16, fontWeight: 700 }}>
        {clienteInicial ? `Nuevo pendiente — ${clienteInicial}` : 'Nuevo pendiente'}
      </h3>
      <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
        {/* Destinatario selector */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 4 }}>
          {(['gustavo', 'irazu'] as Destinatario[]).map(d => (
            <button
              key={d}
              type="button"
              onClick={() => {
                setField('destinatario', d)
                setField('tipo', d === 'gustavo' ? 'confirmar_visita' : 'emitir_boleta')
              }}
              style={{
                flex: 1, padding: '9px', borderRadius: 8, cursor: 'pointer', fontSize: 14, fontWeight: 600,
                border: `2px solid ${form.destinatario === d ? 'var(--primary)' : 'var(--border)'}`,
                background: form.destinatario === d ? '#eff6ff' : 'var(--white)',
                color: form.destinatario === d ? 'var(--primary)' : 'var(--muted)',
              }}
            >
              {d === 'gustavo' ? '🔧 Gustavo' : '🧾 Irazú'}
            </button>
          ))}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
          <div className="field">
            <label>Cliente</label>
            <input
              value={form.cliente_nombre}
              onChange={e => setField('cliente_nombre', e.target.value)}
              placeholder="Nombre del cliente"
              required
            />
          </div>
          <div className="field">
            <label>Tipo de acción</label>
            <select value={form.tipo} onChange={e => setField('tipo', e.target.value as TipoPendiente)}>
              {(form.destinatario === 'gustavo' ? TIPOS_GUSTAVO : TIPOS_IRAZU).map(k => (
                <option key={k} value={k}>{TIPO_LABELS[k]}</option>
              ))}
            </select>
          </div>
        </div>

        <div className="field">
          <label>📝 Mensaje del cliente (lo que te dijo)</label>
          <textarea value={form.mensaje_cliente} onChange={e => setField('mensaje_cliente', e.target.value)} placeholder="Ej: 'Hola, necesito cambiar el tablero, hay chispas y se va la luz seguido...'" rows={3} />
        </div>

        <div className="field">
          <label>🔧 Tu instrucción para {form.destinatario === 'gustavo' ? 'Gustavo' : 'Irazú'}</label>
          <textarea value={form.descripcion} onChange={e => setField('descripcion', e.target.value)} placeholder={form.destinatario === 'gustavo' ? 'Ej: Ir a revisar el tablero y confirmar si necesita reemplazo completo...' : 'Ej: Emitir boleta por instalación de tablero, monto $85.000...'} rows={3} />
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
          <div className="field">
            <label>Fecha límite (responder antes de)</label>
            <input type="datetime-local" value={form.fecha_limite} onChange={e => setField('fecha_limite', e.target.value)} required />
          </div>
          {form.tipo === 'confirmar_visita' && (
            <div className="field">
              <label>Fecha del trabajo 🔨</label>
              <input type="datetime-local" value={form.fecha_trabajo} onChange={e => setField('fecha_trabajo', e.target.value)} />
            </div>
          )}
        </div>

        {form.tipo === 'confirmar_visita' && (
          <div className="field">
            <label>Dirección 📍</label>
            <input value={form.direccion} onChange={e => setField('direccion', e.target.value)} placeholder="Ej: Juan Montalvo 75, Las Condes" />
          </div>
        )}

        <div className="field">
          <label>Links de Drive (fotos / docs)</label>
          {form.drive_links.map((link, i) => (
            <div key={i} style={{ display: 'flex', gap: 8, marginBottom: 6 }}>
              <input value={link} onChange={e => setLink(i, e.target.value)} placeholder="https://drive.google.com/..." style={{ flex: 1 }} />
              {form.drive_links.length > 1 && (
                <button type="button" className="btn btn-ghost" onClick={() => removeLink(i)} style={{ padding: '8px 12px', flexShrink: 0 }}>×</button>
              )}
            </div>
          ))}
          <button type="button" className="btn btn-secondary" onClick={addLink} style={{ alignSelf: 'flex-start', fontSize: 13, padding: '6px 14px' }}>
            + Agregar link
          </button>
        </div>

        {msg && <p style={{ color: 'var(--danger)', fontSize: 13 }}>{msg}</p>}

        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <button type="button" className="btn btn-secondary" onClick={onCancel}>Cancelar</button>
          <button type="submit" className="btn btn-primary" disabled={saving}>
            {saving ? 'Guardando...' : '✓ Crear pendiente'}
          </button>
        </div>
      </form>
    </div>
  )
}

/* ─── Edit form (inline) ────────────────────────────── */
interface EditState {
  tipo: TipoPendiente
  descripcion: string
  mensaje_cliente: string
  respuesta: string
  fecha_limite: string
  fecha_trabajo: string
  direccion: string
  drive_links: string[]
}

function EditForm({ p, onSaved, onCancel }: { p: Pendiente; onSaved: () => void; onCancel: () => void }) {
  const [form, setForm] = useState<EditState>({
    tipo: p.tipo,
    descripcion: p.descripcion || '',
    mensaje_cliente: p.mensaje_cliente || '',
    respuesta: p.respuesta || '',
    fecha_limite: new Date(p.fecha_limite).toISOString().slice(0, 16),
    fecha_trabajo: p.fecha_trabajo ? new Date(p.fecha_trabajo).toISOString().slice(0, 16) : '',
    direccion: p.direccion || '',
    drive_links: p.drive_links?.length > 0 ? p.drive_links : [''],
  })
  const [saving, setSaving] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    await supabase.from('pendientes').update({
      tipo: form.tipo,
      descripcion: form.descripcion.trim(),
      mensaje_cliente: form.mensaje_cliente.trim() || null,
      respuesta: form.respuesta.trim() || null,
      fecha_limite: new Date(form.fecha_limite).toISOString(),
      fecha_trabajo: form.fecha_trabajo ? new Date(form.fecha_trabajo).toISOString() : null,
      direccion: form.direccion.trim() || null,
      drive_links: form.drive_links.filter(l => l.trim()),
    }).eq('id', p.id)
    setSaving(false)
    onSaved()
  }

  return (
    <form onSubmit={submit} style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 10, padding: '14px', background: 'var(--bg)', borderRadius: 'var(--radius-sm)' }}>
      <p style={{ fontSize: 13, fontWeight: 700, color: 'var(--secondary)', marginBottom: 2 }}>Editar pendiente</p>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        <div className="field">
          <label>Tipo</label>
          <select value={form.tipo} onChange={e => setForm(f => ({ ...f, tipo: e.target.value as TipoPendiente }))}>
            {(Object.entries(TIPO_LABELS) as [TipoPendiente, string][]).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </select>
        </div>
        <div className="field">
          <label>Fecha límite</label>
          <input type="datetime-local" value={form.fecha_limite} onChange={e => setForm(f => ({ ...f, fecha_limite: e.target.value }))} required />
        </div>
      </div>
      {form.tipo === 'confirmar_visita' && (
        <>
          <div className="field">
            <label>Fecha del trabajo 🔨</label>
            <input type="datetime-local" value={form.fecha_trabajo} onChange={e => setForm(f => ({ ...f, fecha_trabajo: e.target.value }))} />
          </div>
          <div className="field">
            <label>Dirección 📍</label>
            <input value={form.direccion} onChange={e => setForm(f => ({ ...f, direccion: e.target.value }))} placeholder="Ej: Juan Montalvo 75, Las Condes" />
          </div>
        </>
      )}
      <div className="field">
        <label>📝 Mensaje del cliente</label>
        <textarea value={form.mensaje_cliente} onChange={e => setForm(f => ({ ...f, mensaje_cliente: e.target.value }))} rows={2} placeholder="Lo que dijo el cliente..." />
      </div>
      <div className="field">
        <label>🔧 Tu instrucción</label>
        <textarea value={form.descripcion} onChange={e => setForm(f => ({ ...f, descripcion: e.target.value }))} rows={2} placeholder="Contexto / instrucción..." />
      </div>
      <div className="field">
        <label>📎 Links de Drive</label>
        {form.drive_links.map((link, i) => (
          <div key={i} style={{ display: 'flex', gap: 8, marginBottom: 6 }}>
            <input
              value={link}
              onChange={e => {
                const links = [...form.drive_links]
                links[i] = e.target.value
                setForm(f => ({ ...f, drive_links: links }))
              }}
              placeholder="https://drive.google.com/..."
              style={{ flex: 1 }}
            />
            {form.drive_links.length > 1 && (
              <button type="button" className="btn btn-ghost" onClick={() => setForm(f => ({ ...f, drive_links: f.drive_links.filter((_, j) => j !== i) }))} style={{ padding: '8px 12px', flexShrink: 0 }}>×</button>
            )}
          </div>
        ))}
        <button type="button" className="btn btn-secondary" onClick={() => setForm(f => ({ ...f, drive_links: [...f.drive_links, ''] }))} style={{ fontSize: 13, padding: '6px 14px' }}>
          + Agregar link
        </button>
      </div>
      {p.estado === 'respondido' && (
        <div className="field">
          <label>✏️ Respuesta de {p.destinatario === 'irazu' ? 'Irazú' : 'Gustavo'} (editable)</label>
          <textarea value={form.respuesta} onChange={e => setForm(f => ({ ...f, respuesta: e.target.value }))} rows={4} style={{ fontFamily: 'inherit' }} />
        </div>
      )}
      <div style={{ display: 'flex', gap: 8 }}>
        <button type="submit" className="btn btn-primary" disabled={saving} style={{ fontSize: 13, padding: '7px 16px' }}>
          {saving ? 'Guardando...' : '✓ Guardar'}
        </button>
        <button type="button" className="btn btn-secondary" onClick={onCancel} style={{ fontSize: 13, padding: '7px 14px' }}>
          Cancelar
        </button>
      </div>
    </form>
  )
}

/* ─── Pendiente card ────────────────────────────────── */
function PendienteCard({
  p,
  onUpdate,
  onVerHistorial,
  onSeguimiento,
  revisado = false,
  onToggleRevisado,
}: {
  p: Pendiente
  onUpdate: () => void
  onVerHistorial: (nombre: string) => void
  onSeguimiento: (nombre: string) => void
  revisado?: boolean
  onToggleRevisado?: () => void
}) {
  const [expanded, setExpanded] = useState(false)
  const [editing, setEditing] = useState(false)
  const [sending, setSending] = useState(false)
  const [aiItems, setAiItems] = useState<ItemPresupuesto[] | null>(null)
  const [aiLoading, setAiLoading] = useState(false)

  const dl = formatDeadline(p.fecha_limite)
  const respondido = p.estado === 'respondido'

  const estadoBadge = {
    pendiente: 'badge badge-pendiente',
    recordatorio_enviado: 'badge badge-recordatorio',
    respondido: 'badge badge-respondido',
  }[p.estado]

  const tipoBadge = ({
    confirmar_visita: 'badge badge-visita',
    revisar_fotos: 'badge badge-fotos',
    presupuesto: 'badge badge-presupuesto',
    otro: 'badge badge-otro',
    emitir_boleta: 'badge badge-otro',
    emitir_factura: 'badge badge-otro',
    cobro: 'badge badge-otro',
  } as Record<TipoPendiente, string>)[p.tipo]

  async function registrarAccion(tipo: AccionPendiente['tipo']) {
    const nueva: AccionPendiente = { tipo, timestamp: new Date().toISOString() }
    const actuales = [...(p.acciones || []), nueva]
    await supabase.from('pendientes').update({ acciones: actuales }).eq('id', p.id)
  }

  async function marcarRespondido() {
    await supabase.from('pendientes').update({
      estado: 'respondido',
      respondido_at: new Date().toISOString(),
      respuesta: '(Marcado manualmente por Alexandra)',
    }).eq('id', p.id)
    onUpdate()
  }

  async function enviarRecordatorio() {
    setSending(true)
    await fetch('/api/notificar', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clienteNombre: p.cliente_nombre, tipo: p.tipo, fechaLimite: p.fecha_limite }),
    })
    await supabase.from('pendientes').update({
      estado: 'recordatorio_enviado',
      recordatorio_enviado_at: new Date().toISOString(),
    }).eq('id', p.id)
    await registrarAccion('recordatorio')
    setSending(false)
    onUpdate()
  }

  async function eliminar() {
    if (!confirm(`¿Eliminar pendiente de ${p.cliente_nombre}?`)) return
    await supabase.from('pendientes').delete().eq('id', p.id)
    onUpdate()
  }

  async function generarItemsIA() {
    if (!p.respuesta) return
    setAiLoading(true)
    try {
      const res = await fetch('/api/parse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ texto: p.respuesta }),
      })
      const data = await res.json()
      if (!res.ok || !Array.isArray(data.items) || data.items.length === 0) {
        alert('La IA no pudo generar ítems. Revisa el texto de la respuesta.')
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
      await supabase.from('pendientes').update({ items: generados }).eq('id', p.id)
      await registrarAccion('items_generados')
      setAiItems(generados)
      onUpdate()
    } catch {
      alert('Error al contactar la IA. Intenta de nuevo.')
    } finally {
      setAiLoading(false)
    }
  }

  const borderColor = respondido
    ? (revisado ? '#6ee7b7' : 'var(--success)')
    : new Date(p.fecha_limite) < new Date() ? 'var(--danger)' : 'var(--primary)'

  const itemsActivos = aiItems ?? (p.items?.length > 0 ? p.items : null)

  return (
    <div className="card" style={{ borderLeft: `4px solid ${borderColor}`, marginBottom: 12, opacity: revisado ? 0.6 : 1, transition: 'opacity 0.2s' }}>
      <div
        onClick={() => { if (!editing) setExpanded(x => !x) }}
        style={{ padding: '14px 16px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 12 }}
      >
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 4 }}>
            <span style={{ fontWeight: 700, fontSize: 15 }}>{p.cliente_nombre}</span>
            <span className={tipoBadge}>{TIPO_LABELS[p.tipo]}</span>
            <span className={estadoBadge}>{
              p.estado === 'pendiente' ? 'Pendiente' :
              p.estado === 'recordatorio_enviado' ? 'Recordatorio enviado' : 'Respondido'
            }</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            {/* Solo mostrar deadline si NO está respondido */}
            {!respondido && (
              <span className={dl.cls} style={{ fontSize: 13 }}>{dl.text}</span>
            )}
            {respondido && p.respondido_at && (
              <span style={{ fontSize: 12, color: 'var(--success)', fontWeight: 600 }}>
                ✓ Respondió {fmtHaceQuanto(p.respondido_at)}
              </span>
            )}
            {p.acciones && p.acciones.length > 0 && (
              <span style={{ fontSize: 12, color: 'var(--muted)', display: 'flex', gap: 2 }}>
                {p.acciones.map((a, i) => (
                  <span key={i} title={ACCION_LABELS[a.tipo]}>{ACCION_EMOJI[a.tipo] || '•'}</span>
                ))}
              </span>
            )}
          </div>
        </div>
        {respondido && (
          <button
            onClick={e => { e.stopPropagation(); onToggleRevisado?.() }}
            style={{
              padding: '4px 10px', borderRadius: 20, fontSize: 12, fontWeight: 700,
              border: `1.5px solid ${revisado ? 'var(--success)' : 'var(--border)'}`,
              background: revisado ? '#dcfce7' : 'var(--bg)',
              color: revisado ? 'var(--success)' : 'var(--muted)',
              cursor: 'pointer', flexShrink: 0, whiteSpace: 'nowrap',
            }}
          >
            {revisado ? '✓ Listo' : '· Por revisar'}
          </button>
        )}
        <span style={{ color: 'var(--muted)', fontSize: 18, flexShrink: 0 }}>{expanded ? '▲' : '▼'}</span>
      </div>

      {expanded && (
        <div style={{ padding: '0 16px 16px', borderTop: '1px solid var(--border)' }}>

          {editing ? (
            <EditForm
              p={p}
              onSaved={() => { setEditing(false); onUpdate() }}
              onCancel={() => setEditing(false)}
            />
          ) : (
            <>
              {(p.fecha_trabajo || p.direccion) && (
                <div style={{ marginTop: 12, background: '#fff8e1', border: '1px solid #ffe082', borderRadius: 'var(--radius-sm)', padding: '10px 14px', display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                  <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                    <span style={{ fontSize: 18, marginTop: 2 }}>🔨</span>
                    <div>
                      {p.fecha_trabajo && (
                        <p style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)' }}>
                          {new Date(p.fecha_trabajo).toLocaleString('es-CL', {
                            timeZone: 'America/Santiago',
                            weekday: 'long', day: 'numeric', month: 'long',
                            hour: '2-digit', minute: '2-digit',
                          })}
                        </p>
                      )}
                      {p.direccion && (
                        <p style={{ fontSize: 13, color: 'var(--secondary)', marginTop: 2 }}>📍 {p.direccion}</p>
                      )}
                    </div>
                  </div>
                  <a
                    href={calendarLink(p)}
                    target="_blank"
                    rel="noreferrer"
                    onClick={() => registrarAccion('visita_agendada').then(onUpdate)}
                    className="btn btn-secondary"
                    style={{ fontSize: 12, padding: '6px 12px', flexShrink: 0 }}
                  >
                    📅 Agendar en Calendar
                  </a>
                </div>
              )}

              {p.mensaje_cliente && (
                <div style={{ marginTop: 12, padding: '10px 12px', background: '#f0f9ff', borderRadius: 8, borderLeft: '3px solid #38bdf8' }}>
                  <p style={{ fontSize: 11, fontWeight: 700, color: '#0284c7', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Cliente</p>
                  <p style={{ fontSize: 14, lineHeight: 1.6, color: 'var(--text)', whiteSpace: 'pre-wrap' }}>{p.mensaje_cliente}</p>
                </div>
              )}

              {p.descripcion && (
                <div style={{ marginTop: 8, padding: '10px 12px', background: '#fefce8', borderRadius: 8, borderLeft: '3px solid #eab308' }}>
                  <p style={{ fontSize: 11, fontWeight: 700, color: '#854d0e', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Alexandra</p>
                  <p style={{ fontSize: 14, lineHeight: 1.6, color: 'var(--text)', whiteSpace: 'pre-wrap' }}>{p.descripcion}</p>
                </div>
              )}

              {p.drive_links?.length > 0 && (
                <div style={{ marginTop: 12, display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                  {p.drive_links.map((link, i) => (
                    <a key={i} href={link} target="_blank" rel="noreferrer" className="btn btn-secondary" style={{ fontSize: 13, padding: '6px 12px' }}>
                      📎 Archivo {i + 1}
                    </a>
                  ))}
                </div>
              )}

              {/* Respondido section */}
              {respondido && (
                <div style={{ marginTop: 12, background: 'var(--success-bg)', borderRadius: 'var(--radius-sm)', padding: '12px 14px' }}>
                  <p style={{ fontSize: 13, fontWeight: 600, color: 'var(--success)', marginBottom: 6 }}>
                    ✓ Respondido {p.respondido_at ? fmtFecha(p.respondido_at) : ''}
                  </p>

                  {p.respuesta && (
                    <p style={{ fontSize: 14, color: 'var(--text)', lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>{p.respuesta}</p>
                  )}

                  {p.audio_url && (
                    <div style={{ marginTop: 10 }}>
                      {p.destinatario === 'irazu' ? (
                        <>
                          <p style={{ fontSize: 12, fontWeight: 600, color: 'var(--muted)', marginBottom: 8 }}>📎 Archivo adjunto de Irazú</p>
                          {/\.(jpe?g|png|gif|webp|bmp)(\?|$)/i.test(p.audio_url) ? (
                            <>
                              <img src={p.audio_url} alt="Archivo adjunto" style={{ width: '100%', borderRadius: 8, marginBottom: 8, display: 'block' }} />
                              <a href={p.audio_url} target="_blank" rel="noreferrer" className="btn btn-secondary" style={{ fontSize: 13, padding: '6px 14px' }}>
                                ⬇️ Abrir / descargar imagen
                              </a>
                            </>
                          ) : (
                            <a href={p.audio_url} target="_blank" rel="noreferrer" className="btn btn-secondary" style={{ fontSize: 13, padding: '6px 14px' }}>
                              📄 Abrir / descargar archivo
                            </a>
                          )}
                        </>
                      ) : (
                        <>
                          <p style={{ fontSize: 12, fontWeight: 600, color: 'var(--muted)', marginBottom: 4 }}>🎙️ Nota de voz de Gustavo</p>
                          <audio controls src={p.audio_url} style={{ width: '100%' }} />
                        </>
                      )}
                    </div>
                  )}

                  {/* Presupuesto items */}
                  {p.tipo === 'presupuesto' && (
                    <div style={{ marginTop: 10 }}>
                      {itemsActivos ? (
                        <>
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8, flexWrap: 'wrap', gap: 8 }}>
                            <p style={{ fontSize: 13, fontWeight: 600 }}>{formatItemsResumen(itemsActivos)}</p>
                            <div style={{ display: 'flex', gap: 8 }}>
                              {aiItems && (
                                <button className="btn btn-secondary" style={{ fontSize: 12, padding: '5px 10px' }} onClick={() => setAiItems(null)}>
                                  ✕ Descartar
                                </button>
                              )}
                              <button
                                className="btn btn-primary"
                                style={{ fontSize: 13, padding: '7px 14px' }}
                                onClick={() => {
                                  generatePDF(
                                    { name: p.cliente_nombre, rut: '', email: '', address: '' },
                                    itemsActivos.map((it, i) => ({
                                      id: i, categoria: it.categoria,
                                      description: it.descripcion, price: it.precioUnitario,
                                      quantity: it.cantidad, total: it.cantidad * it.precioUnitario,
                                    })),
                                    10
                                  )
                                  registrarAccion('pdf_generado').then(onUpdate)
                                }}
                              >
                                📄 Generar PDF
                              </button>
                            </div>
                          </div>
                          <table style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse' }}>
                            <thead>
                              <tr style={{ background: 'var(--bg)' }}>
                                {['Categoría', 'Descripción', 'Cant.', 'P. Unit.', 'Total'].map(h => (
                                  <th key={h} style={{ padding: '6px 10px', textAlign: 'left', fontWeight: 600, color: 'var(--secondary)' }}>{h}</th>
                                ))}
                              </tr>
                            </thead>
                            <tbody>
                              {itemsActivos.map((item, i) => (
                                <tr key={i} style={{ borderTop: '1px solid var(--border)' }}>
                                  <td style={{ padding: '6px 10px' }}>
                                    <span className={`badge ${item.categoria === 'MATERIALES' ? 'badge-visita' : 'badge-fotos'}`} style={{ fontSize: 11 }}>
                                      {item.categoria === 'MATERIALES' ? 'MAT' : 'MO'}
                                    </span>
                                  </td>
                                  <td style={{ padding: '6px 10px' }}>{item.descripcion}</td>
                                  <td style={{ padding: '6px 10px' }}>{item.cantidad}</td>
                                  <td style={{ padding: '6px 10px' }}>${item.precioUnitario.toLocaleString('es-CL')}</td>
                                  <td style={{ padding: '6px 10px', fontWeight: 600 }}>${(item.cantidad * item.precioUnitario).toLocaleString('es-CL')}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </>
                      ) : p.respuesta ? (
                        <button
                          className="btn btn-secondary"
                          style={{ fontSize: 13, padding: '7px 14px', marginTop: 4 }}
                          onClick={generarItemsIA}
                          disabled={aiLoading}
                        >
                          {aiLoading ? '⏳ Generando...' : '✨ Generar ítems con IA'}
                        </button>
                      ) : null}
                    </div>
                  )}
                </div>
              )}

              {/* Action history */}
              {p.acciones && p.acciones.length > 0 && (
                <div style={{ marginTop: 12, paddingTop: 10, borderTop: '1px solid var(--border)' }}>
                  <p style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 6 }}>
                    Acciones realizadas
                  </p>
                  {p.acciones.map((a, i) => (
                    <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, marginBottom: 3 }}>
                      <span>{ACCION_EMOJI[a.tipo] || '•'}</span>
                      <span style={{ color: 'var(--secondary)' }}>{ACCION_LABELS[a.tipo] || a.tipo}</span>
                      <span style={{ color: 'var(--muted)', marginLeft: 'auto' }}>{fmtFecha(a.timestamp)}</span>
                    </div>
                  ))}
                </div>
              )}

              {/* Action buttons */}
              <div style={{ marginTop: 14, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {!respondido && (
                  <>
                    <button className="btn btn-secondary" onClick={enviarRecordatorio} disabled={sending} style={{ fontSize: 13, padding: '7px 14px' }}>
                      {sending ? '...' : '📲 Recordatorio'}
                    </button>
                    <button className="btn btn-secondary" onClick={marcarRespondido} style={{ fontSize: 13, padding: '7px 14px', color: 'var(--success)' }}>
                      ✓ Marcar respondido
                    </button>
                  </>
                )}
                {/* Historial y seguimiento */}
                <button
                  className="btn btn-secondary"
                  onClick={() => onVerHistorial(p.cliente_nombre)}
                  style={{ fontSize: 13, padding: '7px 14px' }}
                >
                  🕐 Ver historial
                </button>
                <button
                  className="btn btn-secondary"
                  onClick={() => onSeguimiento(p.cliente_nombre)}
                  style={{ fontSize: 13, padding: '7px 14px', color: 'var(--primary)', fontWeight: 600 }}
                >
                  + Seguimiento
                </button>
                <button className="btn btn-secondary" onClick={() => setEditing(true)} style={{ fontSize: 13, padding: '7px 14px' }}>
                  ✏️ Editar
                </button>
                <button className="btn btn-danger" onClick={eliminar} style={{ fontSize: 13, padding: '7px 14px', marginLeft: 'auto' }}>
                  Eliminar
                </button>
              </div>
            </>
          )}

          <p style={{ fontSize: 11, color: 'var(--muted)', marginTop: 10 }}>
            Creado {fmtFecha(p.created_at)}
          </p>
        </div>
      )}
    </div>
  )
}

/* ─── Notas rápidas ─────────────────────────────────── */
interface Nota { id: string; texto: string; hecho: boolean }

function NotasRapidas() {
  const [notas, setNotas] = useState<Nota[]>([])
  const [input, setInput] = useState('')

  useEffect(() => {
    supabase.from('notas_rapidas').select('*').order('created_at')
      .then(({ data }) => setNotas((data as Nota[]) || []))
  }, [])

  async function agregar() {
    const texto = input.trim()
    if (!texto) return
    const { data } = await supabase.from('notas_rapidas').insert({ texto, hecho: false }).select().single()
    if (data) setNotas(prev => [...prev, data as Nota])
    setInput('')
  }

  async function toggleHecho(n: Nota) {
    await supabase.from('notas_rapidas').update({ hecho: !n.hecho }).eq('id', n.id)
    setNotas(prev => prev.map(x => x.id === n.id ? { ...x, hecho: !x.hecho } : x))
  }

  async function eliminar(id: string) {
    await supabase.from('notas_rapidas').delete().eq('id', id)
    setNotas(prev => prev.filter(x => x.id !== id))
  }

  async function limpiarCompletadas() {
    const ids = notas.filter(n => n.hecho).map(n => n.id)
    if (ids.length) await supabase.from('notas_rapidas').delete().in('id', ids)
    setNotas(prev => prev.filter(n => !n.hecho))
  }

  const pendientes = notas.filter(n => !n.hecho)
  const hechas = notas.filter(n => n.hecho)

  return (
    <div className="card" style={{ marginBottom: '1.25rem', padding: '1rem 1.25rem' }}>
      <h3 style={{ fontSize: 13, fontWeight: 700, marginBottom: 10, color: 'var(--secondary)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
        📌 Mis notas
      </h3>
      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        <input
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && agregar()}
          placeholder="Escribí una nota y presioná Enter..."
          style={{ flex: 1, padding: '9px 12px', borderRadius: 8, border: '1.5px solid var(--border)', fontSize: 14, background: 'var(--white)' }}
        />
        <button className="btn btn-primary" onClick={agregar} style={{ padding: '9px 18px', fontSize: 15, fontWeight: 700 }}>+</button>
      </div>
      {notas.length === 0 ? (
        <p style={{ fontSize: 13, color: 'var(--muted)', textAlign: 'center', padding: '4px 0 2px' }}>Ninguna nota por ahora.</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
          {pendientes.map(nota => (
            <div key={nota.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', background: 'var(--white)', borderRadius: 8, border: '1px solid var(--border)' }}>
              <input type="checkbox" checked={false} onChange={() => toggleHecho(nota)} style={{ width: 16, height: 16, flexShrink: 0, accentColor: 'var(--primary)', cursor: 'pointer' }} />
              <span style={{ flex: 1, fontSize: 14, lineHeight: 1.4 }}>{nota.texto}</span>
              <button onClick={() => eliminar(nota.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 15, color: 'var(--muted)', lineHeight: 1, padding: '0 2px', flexShrink: 0 }}>✕</button>
            </div>
          ))}
          {hechas.length > 0 && (
            <div style={{ borderTop: '1px solid var(--border)', paddingTop: 6, marginTop: 3 }}>
              {hechas.map(nota => (
                <div key={nota.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 10px', opacity: 0.5 }}>
                  <input type="checkbox" checked={true} onChange={() => toggleHecho(nota)} style={{ width: 16, height: 16, flexShrink: 0, accentColor: 'var(--primary)', cursor: 'pointer' }} />
                  <span style={{ flex: 1, fontSize: 13, textDecoration: 'line-through', color: 'var(--muted)' }}>{nota.texto}</span>
                  <button onClick={() => eliminar(nota.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 14, color: 'var(--muted)', lineHeight: 1, padding: '0 2px' }}>✕</button>
                </div>
              ))}
              <button onClick={limpiarCompletadas} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 12, color: 'var(--muted)', padding: '4px 10px', width: '100%', textAlign: 'right' }}>
                Limpiar completadas
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

/* ─── Admin page ────────────────────────────────────── */
export default function Admin() {
  const [authed, setAuthed] = useState(false)
  const [pendientes, setPendientes] = useState<Pendiente[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [clienteInicial, setClienteInicial] = useState('')
  const [formInit, setFormInit] = useState<{ destinatario: Destinatario; tipo: TipoPendiente }>({ destinatario: 'gustavo', tipo: 'confirmar_visita' })
  const [tab, setTab] = useState<'activos' | 'respondidos_gustavo' | 'respondidos_irazu' | 'clientes'>('activos')
  const [historialCliente, setHistorialCliente] = useState<string | null>(null)

  useEffect(() => {
    const saved = localStorage.getItem('horma_admin')
    if (saved === ADMIN_PASSWORD) setAuthed(true)
  }, [])

  const loadPendientes = useCallback(async (showSpinner = false) => {
    if (showSpinner) setLoading(true)
    const { data } = await supabase
      .from('pendientes')
      .select('*')
      .order('fecha_limite', { ascending: true })
    setPendientes((data as Pendiente[]) || [])
    if (showSpinner) setLoading(false)
  }, [])

  useEffect(() => {
    if (!authed) return
    loadPendientes(true)
    const interval = setInterval(() => loadPendientes(false), 60000)
    return () => clearInterval(interval)
  }, [authed, loadPendientes])

  function abrirSeguimiento(nombre: string) {
    setClienteInicial(nombre)
    setFormInit({ destinatario: 'gustavo', tipo: 'confirmar_visita' })
    setShowForm(true)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  function pedirBoleta(nombre: string) {
    setClienteInicial(nombre)
    setFormInit({ destinatario: 'irazu', tipo: 'emitir_boleta' })
    setShowForm(true)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  async function toggleRevisado(p: Pendiente) {
    await supabase.from('pendientes').update({ revisado_admin: !(p.revisado_admin ?? false) }).eq('id', p.id)
    loadPendientes()
  }

  if (!authed) return <div className="pendientes"><LoginForm onLogin={() => setAuthed(true)} /></div>

  const activos = pendientes.filter(p => p.estado !== 'respondido')
  const respondidos = pendientes
    .filter(p => p.estado === 'respondido')
    .sort((a, b) => new Date(b.respondido_at ?? b.created_at).getTime() - new Date(a.respondido_at ?? a.created_at).getTime())
  const vencidos = activos.filter(p => new Date(p.fecha_limite) < new Date())
  const respondidosGustavo = respondidos.filter(p => !p.destinatario || p.destinatario === 'gustavo')
  const respondidosIrazu = respondidos.filter(p => p.destinatario === 'irazu')
  const activosGustavo = activos.filter(p => !p.destinatario || p.destinatario === 'gustavo')
  const activosIrazu = activos.filter(p => p.destinatario === 'irazu')

  const clienteGroups = activos.reduce<Record<string, Pendiente[]>>((acc, p) => {
    if (!acc[p.cliente_nombre]) acc[p.cliente_nombre] = []
    acc[p.cliente_nombre].push(p)
    return acc
  }, {})

  function renderRespondidos(lista: Pendiente[]) {
    if (lista.length === 0) return (
      <p style={{ textAlign: 'center', padding: '3rem', color: 'var(--muted)' }}>Sin respondidos aquí.</p>
    )
    const grupos = lista.reduce<Record<string, Pendiente[]>>((acc, p) => {
      if (!acc[p.cliente_nombre]) acc[p.cliente_nombre] = []
      acc[p.cliente_nombre].push(p)
      return acc
    }, {})
    return Object.entries(grupos).map(([cliente, items]) => (
      <div key={cliente}>
        {items.length > 1 && (
          <div style={{
            display: 'flex', alignItems: 'center', gap: 8,
            padding: '7px 12px', marginBottom: 6,
            background: '#f0f4ff', border: '1px solid #c7d2fe',
            borderRadius: 8, fontSize: 13, fontWeight: 700, color: '#3730a3',
          }}>
            <span>🔗</span>
            <span>{cliente}</span>
            <span style={{ fontWeight: 400, color: 'var(--muted)' }}>— {items.length} pendientes relacionados</span>
            <button
              onClick={() => setHistorialCliente(cliente)}
              style={{ marginLeft: 'auto', background: 'none', border: 'none', cursor: 'pointer', fontSize: 12, color: '#3730a3', fontWeight: 600, padding: '2px 6px' }}
            >Ver historial →</button>
          </div>
        )}
        <div style={items.length > 1 ? { paddingLeft: 12, borderLeft: '3px solid #c7d2fe', marginBottom: 16 } : {}}>
          {items.map(p => (
            <PendienteCard
              key={p.id}
              p={p}
              onUpdate={loadPendientes}
              onVerHistorial={setHistorialCliente}
              onSeguimiento={abrirSeguimiento}
              revisado={p.revisado_admin ?? false}
              onToggleRevisado={() => toggleRevisado(p)}
            />
          ))}
        </div>
      </div>
    ))
  }

  const clientesSummary = Object.entries(
    pendientes.reduce<Record<string, Pendiente[]>>((acc, p) => {
      if (!acc[p.cliente_nombre]) acc[p.cliente_nombre] = []
      acc[p.cliente_nombre].push(p)
      return acc
    }, {})
  ).map(([nombre, items]) => {
    const activos = items.filter(p => p.estado !== 'respondido')
    const vencidos = activos.filter(p => new Date(p.fecha_limite) < new Date())
    const last = items.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())[0]
    return { nombre, total: items.length, activos: activos.length, vencidos: vencidos.length, ultimaInteraccion: last.created_at }
  }).sort((a, b) => new Date(b.ultimaInteraccion).getTime() - new Date(a.ultimaInteraccion).getTime())

  const gustavoToken = import.meta.env.VITE_GUSTAVO_TOKEN as string
  const irazuToken = import.meta.env.VITE_IRAZU_TOKEN as string

  return (
    <div className="pendientes" style={{ background: 'var(--bg)', minHeight: '100vh' }}>

      {/* Nav bar */}
      <div style={{
        position: 'sticky', top: 0, zIndex: 100,
        background: 'var(--white)', borderBottom: '1px solid var(--border)',
        padding: '0 1rem',
        display: 'flex', alignItems: 'center', gap: 4,
        boxShadow: '0 1px 4px rgba(0,0,0,0.06)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 8px 10px 0', marginRight: 8, borderRight: '1px solid var(--border)' }}>
          <div style={{ width: 28, height: 28, background: 'var(--primary)', borderRadius: 7, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, color: '#fff', fontSize: 14 }}>H</div>
          <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>Horma</span>
        </div>
        {[
          { label: '📋 Admin', href: '/admin', active: true, color: 'var(--primary)' },
          { label: '🔧 Gustavo', href: `/g?t=${gustavoToken}`, active: false, color: '#0284c7' },
          { label: '🧾 Irazú', href: `/i?t=${irazuToken}`, active: false, color: '#0891b2' },
          { label: '📊 Presupuesto', href: '/', active: false, color: '#059669' },
          { label: '📋 Itemizado', href: '/itemizado', active: false, color: '#e69a21' },
        ].map(item => (
          <a
            key={item.label}
            href={item.href}
            target={item.active ? undefined : '_blank'}
            rel="noreferrer"
            style={{
              padding: '10px 12px', fontSize: 13, fontWeight: item.active ? 700 : 500,
              color: item.active ? item.color : 'var(--muted)',
              textDecoration: 'none', borderBottom: `2px solid ${item.active ? item.color : 'transparent'}`,
              whiteSpace: 'nowrap',
            }}
          >
            {item.label}
          </a>
        ))}
      </div>

    <div style={{ maxWidth: 860, margin: '0 auto', padding: '1.5rem 1rem' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.5rem', flexWrap: 'wrap', gap: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ width: 40, height: 40, background: 'var(--primary)', borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, color: '#fff', fontSize: 18 }}>H</div>
          <div>
            <h1 style={{ fontSize: 20, fontWeight: 800, lineHeight: 1.2 }}>Pendientes</h1>
            <p style={{ fontSize: 13, color: 'var(--muted)' }}>Horma Electricidad</p>
          </div>
        </div>
        <button className="btn btn-primary" onClick={() => { setClienteInicial(''); setShowForm(x => !x) }}>
          {showForm ? '✕ Cancelar' : '+ Nuevo pendiente'}
        </button>
      </div>

      {/* Stats */}
      <div style={{ display: 'flex', gap: 12, marginBottom: '1.25rem', flexWrap: 'wrap' }}>
        <div className="card" onClick={() => setTab('activos')} style={{ padding: '10px 16px', display: 'flex', gap: 10, alignItems: 'center', cursor: 'pointer', borderLeft: tab === 'activos' ? '3px solid var(--primary)' : undefined }}>
          <span style={{ fontSize: 22, fontWeight: 800, color: 'var(--primary)' }}>{activos.length}</span>
          <div>
            <p style={{ fontSize: 12, fontWeight: 700, color: 'var(--primary)' }}>Activos</p>
            {vencidos.length > 0 && <p style={{ fontSize: 11, color: 'var(--danger)' }}>{vencidos.length} vencido{vencidos.length !== 1 ? 's' : ''}</p>}
          </div>
        </div>
        <div className="card" onClick={() => setTab('respondidos_gustavo')} style={{ padding: '10px 16px', display: 'flex', gap: 10, alignItems: 'center', cursor: 'pointer', borderLeft: tab === 'respondidos_gustavo' ? '3px solid #0284c7' : undefined }}>
          <span style={{ fontSize: 22, fontWeight: 800, color: '#0284c7' }}>{respondidosGustavo.length}</span>
          <div>
            <p style={{ fontSize: 12, fontWeight: 700, color: '#0284c7' }}>🔧 Gustavo</p>
            <p style={{ fontSize: 11, color: 'var(--muted)' }}>respondidos</p>
            {activosGustavo.length > 0 && (
              <p style={{ fontSize: 11, color: 'var(--primary)', fontWeight: 600 }}>
                {activosGustavo.length} activo{activosGustavo.length !== 1 ? 's' : ''}
              </p>
            )}
          </div>
        </div>
        <div className="card" onClick={() => setTab('respondidos_irazu')} style={{ padding: '10px 16px', display: 'flex', gap: 10, alignItems: 'center', cursor: 'pointer', borderLeft: tab === 'respondidos_irazu' ? '3px solid #0891b2' : undefined }}>
          <span style={{ fontSize: 22, fontWeight: 800, color: '#0891b2' }}>{respondidosIrazu.length}</span>
          <div>
            <p style={{ fontSize: 12, fontWeight: 700, color: '#0891b2' }}>🧾 Irazú</p>
            <p style={{ fontSize: 11, color: 'var(--muted)' }}>respondidos</p>
            {activosIrazu.length > 0 && (
              <p style={{ fontSize: 11, color: '#0891b2', fontWeight: 600 }}>
                {activosIrazu.length} activo{activosIrazu.length !== 1 ? 's' : ''}
              </p>
            )}
          </div>
        </div>
      </div>

      {/* Quick notes */}
      <NotasRapidas />

      {/* Create form */}
      {showForm && (
        <CrearForm
          clienteInicial={clienteInicial}
          destinatarioInicial={formInit.destinatario}
          tipoInicial={formInit.tipo}
          onCreated={() => { setShowForm(false); setClienteInicial(''); loadPendientes() }}
          onCancel={() => { setShowForm(false); setClienteInicial('') }}
        />
      )}

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 0, marginBottom: '1rem', borderBottom: '2px solid var(--border)' }}>
        {([
          ['activos', `Activos (${activos.length})`, 'var(--primary)'],
          ['respondidos_gustavo', `🔧 Gustavo (${respondidosGustavo.length})`, '#0284c7'],
          ['respondidos_irazu', `🧾 Irazú (${respondidosIrazu.length})`, '#0891b2'],
          ['clientes', `👥 Clientes (${clientesSummary.length})`, '#7c3aed'],
        ] as const).map(([k, label, color]) => (
          <button
            key={k}
            onClick={() => setTab(k)}
            style={{
              padding: '8px 14px', border: 'none', background: 'none', cursor: 'pointer',
              fontSize: 13, fontWeight: tab === k ? 700 : 500,
              color: tab === k ? color : 'var(--muted)',
              borderBottom: `2px solid ${tab === k ? color : 'transparent'}`,
              marginBottom: -2, whiteSpace: 'nowrap',
            }}
          >{label}</button>
        ))}
      </div>

      {/* List */}
      {loading ? (
        <div className="spinner" />
      ) : tab === 'activos' ? (
        activos.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '3rem', color: 'var(--muted)' }}>
            <div style={{ fontSize: 40, marginBottom: 12 }}>✅</div>
            <p style={{ fontWeight: 600 }}>Sin pendientes activos</p>
            <p style={{ fontSize: 14, marginTop: 6 }}>Crea uno con el botón de arriba.</p>
          </div>
        ) : (
          Object.entries(clienteGroups).map(([cliente, items]) => (
            <div key={cliente}>
              {items.length > 1 && (
                <div style={{
                  display: 'flex', alignItems: 'center', gap: 8,
                  padding: '7px 12px', marginBottom: 6,
                  background: '#f0f4ff', border: '1px solid #c7d2fe',
                  borderRadius: 8, fontSize: 13, fontWeight: 700, color: '#3730a3',
                }}>
                  <span>🔗</span>
                  <span>{cliente}</span>
                  <span style={{ fontWeight: 400, color: 'var(--muted)' }}>— {items.length} pendientes relacionados</span>
                  <button
                    onClick={() => setHistorialCliente(cliente)}
                    style={{ marginLeft: 'auto', background: 'none', border: 'none', cursor: 'pointer', fontSize: 12, color: '#3730a3', fontWeight: 600, padding: '2px 6px' }}
                  >Ver historial →</button>
                </div>
              )}
              <div style={items.length > 1 ? { paddingLeft: 12, borderLeft: '3px solid #c7d2fe', marginBottom: 16 } : {}}>
                {items.map(p => (
                  <PendienteCard
                    key={p.id}
                    p={p}
                    onUpdate={loadPendientes}
                    onVerHistorial={setHistorialCliente}
                    onSeguimiento={abrirSeguimiento}
                  />
                ))}
              </div>
            </div>
          ))
        )
      ) : tab === 'respondidos_gustavo' ? (
        renderRespondidos(respondidosGustavo)
      ) : tab === 'respondidos_irazu' ? (
        renderRespondidos(respondidosIrazu)
      ) : clientesSummary.length === 0 ? (
        <p style={{ textAlign: 'center', padding: '3rem', color: 'var(--muted)' }}>Sin clientes registrados aún.</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {clientesSummary.map(c => (
            <div
              key={c.nombre}
              className="card"
              style={{ padding: '14px 16px', display: 'flex', alignItems: 'center', gap: 14, borderLeft: `4px solid ${c.vencidos > 0 ? 'var(--danger)' : c.activos > 0 ? 'var(--primary)' : 'var(--success)'}` }}
            >
              {/* Avatar */}
              <div style={{
                width: 40, height: 40, borderRadius: '50%', flexShrink: 0,
                background: c.vencidos > 0 ? '#fee2e2' : c.activos > 0 ? '#eff6ff' : '#f0fdf4',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 18, fontWeight: 800,
                color: c.vencidos > 0 ? 'var(--danger)' : c.activos > 0 ? 'var(--primary)' : 'var(--success)',
              }}>
                {c.nombre.charAt(0).toUpperCase()}
              </div>

              {/* Info */}
              <div style={{ flex: 1, minWidth: 0 }}>
                <p style={{ fontWeight: 700, fontSize: 15, marginBottom: 3 }}>{c.nombre}</p>
                <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 12, color: 'var(--muted)' }}>
                    {c.total} interacción{c.total !== 1 ? 'es' : ''}
                  </span>
                  {c.activos > 0 && (
                    <span style={{ fontSize: 12, fontWeight: 600, color: c.vencidos > 0 ? 'var(--danger)' : 'var(--primary)' }}>
                      {c.vencidos > 0 ? `⚠ ${c.vencidos} vencido${c.vencidos !== 1 ? 's' : ''}` : `● ${c.activos} activo${c.activos !== 1 ? 's' : ''}`}
                    </span>
                  )}
                  {c.activos === 0 && (
                    <span style={{ fontSize: 12, color: 'var(--success)', fontWeight: 600 }}>✓ Al día</span>
                  )}
                  <span style={{ fontSize: 12, color: 'var(--muted)' }}>
                    Última: {fmtFecha(c.ultimaInteraccion)}
                  </span>
                </div>
              </div>

              {/* Actions */}
              <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
                <button
                  className="btn btn-secondary"
                  onClick={() => setHistorialCliente(c.nombre)}
                  style={{ fontSize: 12, padding: '6px 12px' }}
                >
                  🕐 Historial
                </button>
                <button
                  className="btn btn-primary"
                  onClick={() => abrirSeguimiento(c.nombre)}
                  style={{ fontSize: 12, padding: '6px 12px' }}
                >
                  + Pendiente
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <p style={{ textAlign: 'center', fontSize: 12, color: 'var(--muted)', marginTop: 24 }}>
        Actualización automática cada 60 segundos
      </p>
    </div>

    {/* Historial modal */}
    {historialCliente && (
      <HistorialModal
        cliente={historialCliente}
        todos={pendientes}
        onClose={() => setHistorialCliente(null)}
        onSeguimiento={abrirSeguimiento}
        onPedirBoleta={pedirBoleta}
      />
    )}
    </div>
  )
}
