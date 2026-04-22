import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { generatePDF } from '../utils/pdfGenerator'
import type { Pendiente, NuevoPendiente, TipoPendiente, ItemPresupuesto, AccionPendiente } from '../types'

const ADMIN_PASSWORD = import.meta.env.VITE_ADMIN_PASSWORD as string

const TIPO_LABELS: Record<TipoPendiente, string> = {
  confirmar_visita: 'Confirmar visita',
  revisar_fotos: 'Revisar fotos',
  presupuesto: 'Ingresar presupuesto',
  otro: 'Otro',
}

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
  const h = Math.floor(Math.abs(diff) / 3600000)
  const m = Math.floor((Math.abs(diff) % 3600000) / 60000)
  if (diff < 0) return { text: `Venció hace ${h}h ${m}m`, cls: 'deadline-over' }
  if (diff < 2 * 3600000) return { text: `Vence en ${h}h ${m}m`, cls: 'deadline-warn' }
  if (diff < 24 * 3600000) return { text: `Vence en ${h}h`, cls: 'deadline-warn' }
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

/* ─── Historial modal ───────────────────────────────── */
function HistorialModal({
  cliente,
  todos,
  onClose,
  onSeguimiento,
}: {
  cliente: string
  todos: Pendiente[]
  onClose: () => void
  onSeguimiento: (nombre: string) => void
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
                        <p style={{ fontSize: 13, color: 'var(--secondary)', lineHeight: 1.5, marginBottom: p.estado === 'respondido' ? 8 : 0 }}>
                          {p.descripcion}
                        </p>
                      )}

                      {/* response */}
                      {p.estado === 'respondido' && p.respuesta && (
                        <div style={{ borderTop: '1px solid var(--border)', paddingTop: 8, marginTop: p.descripcion ? 0 : 0 }}>
                          <p style={{ fontSize: 11, fontWeight: 700, color: 'var(--success)', marginBottom: 4 }}>
                            ✓ Gustavo respondió — {p.respondido_at ? fmtFecha(p.respondido_at) : ''}
                          </p>
                          <p style={{ fontSize: 13, lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>{p.respuesta}</p>
                        </div>
                      )}

                      {p.estado === 'respondido' && p.audio_url && (
                        <div style={{ marginTop: 8 }}>
                          <p style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 4 }}>🎙️ Nota de voz</p>
                          <audio controls src={p.audio_url} style={{ width: '100%', height: 36 }} />
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

        {/* Footer */}
        <div style={{ padding: '1rem 1.5rem', borderTop: '1px solid var(--border)', flexShrink: 0 }}>
          <button
            className="btn btn-primary"
            style={{ width: '100%', fontWeight: 700 }}
            onClick={() => { onSeguimiento(cliente); onClose() }}
          >
            + Crear nuevo pendiente para {cliente}
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
  fecha_limite: string
  fecha_trabajo: string
  direccion: string
  drive_links: string[]
}

function emptyForm(clienteInicial = ''): FormState {
  const now = new Date()
  now.setHours(now.getHours() + 4)
  return {
    cliente_nombre: clienteInicial,
    tipo: 'confirmar_visita',
    descripcion: '',
    fecha_limite: now.toISOString().slice(0, 16),
    fecha_trabajo: '',
    direccion: '',
    drive_links: [''],
  }
}

function CrearForm({
  onCreated,
  onCancel,
  clienteInicial = '',
}: {
  onCreated: () => void
  onCancel: () => void
  clienteInicial?: string
}) {
  const [form, setForm] = useState<FormState>(() => emptyForm(clienteInicial))
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
      fecha_limite: new Date(form.fecha_limite).toISOString(),
      fecha_trabajo: form.fecha_trabajo ? new Date(form.fecha_trabajo).toISOString() : null,
      direccion: form.direccion.trim() || null,
      drive_links: form.drive_links.filter(l => l.trim()),
    }

    const { error } = await supabase.from('pendientes').insert(payload)
    if (error) {
      setMsg('Error al guardar: ' + error.message)
      setSaving(false)
      return
    }

    fetch('/.netlify/functions/notificar', {
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
              {(Object.entries(TIPO_LABELS) as [TipoPendiente, string][]).map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </select>
          </div>
        </div>

        <div className="field">
          <label>Contexto / descripción</label>
          <textarea value={form.descripcion} onChange={e => setField('descripcion', e.target.value)} placeholder="Describe qué necesitas de Gustavo..." rows={3} />
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
  fecha_limite: string
  fecha_trabajo: string
  direccion: string
}

function EditForm({ p, onSaved, onCancel }: { p: Pendiente; onSaved: () => void; onCancel: () => void }) {
  const [form, setForm] = useState<EditState>({
    tipo: p.tipo,
    descripcion: p.descripcion || '',
    fecha_limite: new Date(p.fecha_limite).toISOString().slice(0, 16),
    fecha_trabajo: p.fecha_trabajo ? new Date(p.fecha_trabajo).toISOString().slice(0, 16) : '',
    direccion: p.direccion || '',
  })
  const [saving, setSaving] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    await supabase.from('pendientes').update({
      tipo: form.tipo,
      descripcion: form.descripcion.trim(),
      fecha_limite: new Date(form.fecha_limite).toISOString(),
      fecha_trabajo: form.fecha_trabajo ? new Date(form.fecha_trabajo).toISOString() : null,
      direccion: form.direccion.trim() || null,
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
        <label>Descripción</label>
        <textarea value={form.descripcion} onChange={e => setForm(f => ({ ...f, descripcion: e.target.value }))} rows={2} placeholder="Contexto para Gustavo..." />
      </div>
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
}: {
  p: Pendiente
  onUpdate: () => void
  onVerHistorial: (nombre: string) => void
  onSeguimiento: (nombre: string) => void
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

  const tipoBadge = {
    confirmar_visita: 'badge badge-visita',
    revisar_fotos: 'badge badge-fotos',
    presupuesto: 'badge badge-presupuesto',
    otro: 'badge badge-otro',
  }[p.tipo]

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
    await fetch('/.netlify/functions/notificar', {
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
      const res = await fetch('/.netlify/functions/parse', {
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

  const borderColor = respondido ? 'var(--success)' :
    new Date(p.fecha_limite) < new Date() ? 'var(--danger)' : 'var(--primary)'

  const itemsActivos = aiItems ?? (p.items?.length > 0 ? p.items : null)

  return (
    <div className="card" style={{ borderLeft: `4px solid ${borderColor}`, marginBottom: 12 }}>
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
              <span style={{ fontSize: 12, color: 'var(--success)' }}>
                ✓ {fmtFecha(p.respondido_at)}
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

              {p.descripcion && (
                <p style={{ marginTop: 12, fontSize: 14, lineHeight: 1.6, color: 'var(--secondary)' }}>{p.descripcion}</p>
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
                      <p style={{ fontSize: 12, fontWeight: 600, color: 'var(--muted)', marginBottom: 4 }}>🎙️ Nota de voz de Gustavo</p>
                      <audio controls src={p.audio_url} style={{ width: '100%' }} />
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
interface Nota {
  id: string
  texto: string
  hecho: boolean
}

function NotasRapidas() {
  const [notas, setNotas] = useState<Nota[]>(() => {
    try { return JSON.parse(localStorage.getItem('horma_notas') || '[]') }
    catch { return [] }
  })
  const [input, setInput] = useState('')

  function guardar(nuevas: Nota[]) {
    setNotas(nuevas)
    localStorage.setItem('horma_notas', JSON.stringify(nuevas))
  }

  function agregar() {
    const texto = input.trim()
    if (!texto) return
    guardar([...notas, { id: Date.now().toString(), texto, hecho: false }])
    setInput('')
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
              <input type="checkbox" checked={false} onChange={() => guardar(notas.map(n => n.id === nota.id ? { ...n, hecho: true } : n))} style={{ width: 16, height: 16, flexShrink: 0, accentColor: 'var(--primary)', cursor: 'pointer' }} />
              <span style={{ flex: 1, fontSize: 14, lineHeight: 1.4 }}>{nota.texto}</span>
              <button onClick={() => guardar(notas.filter(n => n.id !== nota.id))} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 15, color: 'var(--muted)', lineHeight: 1, padding: '0 2px', flexShrink: 0 }}>✕</button>
            </div>
          ))}
          {hechas.length > 0 && (
            <div style={{ borderTop: '1px solid var(--border)', paddingTop: 6, marginTop: 3 }}>
              {hechas.map(nota => (
                <div key={nota.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 10px', opacity: 0.5 }}>
                  <input type="checkbox" checked={true} onChange={() => guardar(notas.map(n => n.id === nota.id ? { ...n, hecho: false } : n))} style={{ width: 16, height: 16, flexShrink: 0, accentColor: 'var(--primary)', cursor: 'pointer' }} />
                  <span style={{ flex: 1, fontSize: 13, textDecoration: 'line-through', color: 'var(--muted)' }}>{nota.texto}</span>
                  <button onClick={() => guardar(notas.filter(n => n.id !== nota.id))} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 14, color: 'var(--muted)', lineHeight: 1, padding: '0 2px' }}>✕</button>
                </div>
              ))}
              <button onClick={() => guardar(notas.filter(n => !n.hecho))} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 12, color: 'var(--muted)', padding: '4px 10px', width: '100%', textAlign: 'right' }}>
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
  const [tab, setTab] = useState<'activos' | 'respondidos'>('activos')
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
    setShowForm(true)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  if (!authed) return <div className="pendientes"><LoginForm onLogin={() => setAuthed(true)} /></div>

  const activos = pendientes.filter(p => p.estado !== 'respondido')
  const respondidos = pendientes.filter(p => p.estado === 'respondido')
  const vencidos = activos.filter(p => new Date(p.fecha_limite) < new Date())
  const displayed = tab === 'activos' ? activos : respondidos

  // Group by client name — preserves deadline sort order within each group
  const clienteGroups = displayed.reduce<Record<string, Pendiente[]>>((acc, p) => {
    if (!acc[p.cliente_nombre]) acc[p.cliente_nombre] = []
    acc[p.cliente_nombre].push(p)
    return acc
  }, {})

  return (
    <div className="pendientes" style={{ background: 'var(--bg)', minHeight: '100vh' }}>
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
      {activos.length > 0 && (
        <div style={{ display: 'flex', gap: 12, marginBottom: '1.25rem', flexWrap: 'wrap' }}>
          <div className="card" style={{ padding: '10px 16px', display: 'flex', gap: 10, alignItems: 'center' }}>
            <span style={{ fontSize: 22, fontWeight: 800, color: 'var(--primary)' }}>{activos.length}</span>
            <span style={{ fontSize: 13, color: 'var(--muted)' }}>activo{activos.length !== 1 ? 's' : ''}</span>
          </div>
          {vencidos.length > 0 && (
            <div className="card" style={{ padding: '10px 16px', display: 'flex', gap: 10, alignItems: 'center', borderLeft: '3px solid var(--danger)' }}>
              <span style={{ fontSize: 22, fontWeight: 800, color: 'var(--danger)' }}>{vencidos.length}</span>
              <span style={{ fontSize: 13, color: 'var(--muted)' }}>vencido{vencidos.length !== 1 ? 's' : ''}</span>
            </div>
          )}
          <div className="card" style={{ padding: '10px 16px', display: 'flex', gap: 10, alignItems: 'center' }}>
            <span style={{ fontSize: 22, fontWeight: 800, color: 'var(--success)' }}>{respondidos.length}</span>
            <span style={{ fontSize: 13, color: 'var(--muted)' }}>respondido{respondidos.length !== 1 ? 's' : ''}</span>
          </div>
        </div>
      )}

      {/* Quick notes */}
      <NotasRapidas />

      {/* Create form */}
      {showForm && (
        <CrearForm
          clienteInicial={clienteInicial}
          onCreated={() => { setShowForm(false); setClienteInicial(''); loadPendientes() }}
          onCancel={() => { setShowForm(false); setClienteInicial('') }}
        />
      )}

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 4, marginBottom: '1rem', borderBottom: '2px solid var(--border)', paddingBottom: 0 }}>
        {([['activos', `Activos (${activos.length})`], ['respondidos', `Respondidos (${respondidos.length})`]] as const).map(([k, label]) => (
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
          >
            {label}
          </button>
        ))}
      </div>

      {/* List grouped by client */}
      {loading ? (
        <div className="spinner" />
      ) : displayed.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '3rem', color: 'var(--muted)' }}>
          {tab === 'activos' ? (
            <>
              <div style={{ fontSize: 40, marginBottom: 12 }}>✅</div>
              <p style={{ fontWeight: 600 }}>Sin pendientes activos</p>
              <p style={{ fontSize: 14, marginTop: 6 }}>Crea uno con el botón de arriba.</p>
            </>
          ) : (
            <p>Aún no hay pendientes respondidos.</p>
          )}
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
                >
                  Ver historial →
                </button>
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
      />
    )}
    </div>
  )
}
