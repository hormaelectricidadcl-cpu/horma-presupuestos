import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { generatePDF } from '../utils/pdfGenerator'
import type { Pendiente, NuevoPendiente, TipoPendiente, ItemPresupuesto } from '../types'

const ADMIN_PASSWORD = import.meta.env.VITE_ADMIN_PASSWORD as string

const TIPO_LABELS: Record<TipoPendiente, string> = {
  confirmar_visita: 'Confirmar visita',
  revisar_fotos: 'Revisar fotos',
  presupuesto: 'Ingresar presupuesto',
  otro: 'Otro',
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

/* ─── Create form ───────────────────────────────────── */
interface FormState {
  cliente_nombre: string
  tipo: TipoPendiente
  descripcion: string
  fecha_limite: string
  drive_links: string[]
}

function emptyForm(): FormState {
  const now = new Date()
  now.setHours(now.getHours() + 4)
  return {
    cliente_nombre: '',
    tipo: 'confirmar_visita',
    descripcion: '',
    fecha_limite: now.toISOString().slice(0, 16),
    drive_links: [''],
  }
}

function CrearForm({ onCreated, onCancel }: { onCreated: () => void; onCancel: () => void }) {
  const [form, setForm] = useState<FormState>(emptyForm)
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
      drive_links: form.drive_links.filter(l => l.trim()),
    }

    const { error } = await supabase.from('pendientes').insert(payload)
    if (error) {
      setMsg('Error al guardar: ' + error.message)
      setSaving(false)
      return
    }

    // Notify Gustavo via WhatsApp (non-blocking)
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
      <h3 style={{ marginBottom: '1.25rem', fontSize: 16, fontWeight: 700 }}>Nuevo pendiente</h3>
      <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
          <div className="field">
            <label>Cliente</label>
            <input value={form.cliente_nombre} onChange={e => setField('cliente_nombre', e.target.value)} placeholder="Nombre del cliente" required />
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

        <div className="field">
          <label>Fecha límite</label>
          <input type="datetime-local" value={form.fecha_limite} onChange={e => setField('fecha_limite', e.target.value)} required />
        </div>

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

/* ─── Pendiente card ────────────────────────────────── */
function PendienteCard({ p, onUpdate }: { p: Pendiente; onUpdate: () => void }) {
  const [expanded, setExpanded] = useState(false)
  const [sending, setSending] = useState(false)

  const dl = formatDeadline(p.fecha_limite)

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
      body: JSON.stringify({
        clienteNombre: p.cliente_nombre,
        tipo: p.tipo,
        fechaLimite: p.fecha_limite,
      }),
    })
    await supabase.from('pendientes').update({
      estado: 'recordatorio_enviado',
      recordatorio_enviado_at: new Date().toISOString(),
    }).eq('id', p.id)
    setSending(false)
    onUpdate()
  }

  async function eliminar() {
    if (!confirm(`¿Eliminar pendiente de ${p.cliente_nombre}?`)) return
    await supabase.from('pendientes').delete().eq('id', p.id)
    onUpdate()
  }

  const borderColor = p.estado === 'respondido' ? 'var(--success)' :
    new Date(p.fecha_limite) < new Date() ? 'var(--danger)' : 'var(--primary)'

  return (
    <div className="card" style={{ borderLeft: `4px solid ${borderColor}`, marginBottom: 12 }}>
      <div
        onClick={() => setExpanded(x => !x)}
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
          <span className={dl.cls} style={{ fontSize: 13 }}>{dl.text}</span>
        </div>
        <span style={{ color: 'var(--muted)', fontSize: 18, flexShrink: 0 }}>{expanded ? '▲' : '▼'}</span>
      </div>

      {expanded && (
        <div style={{ padding: '0 16px 16px', borderTop: '1px solid var(--border)' }}>
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

          {p.estado === 'respondido' && (
            <div style={{ marginTop: 12, background: 'var(--success-bg)', borderRadius: 'var(--radius-sm)', padding: '10px 14px' }}>
              <p style={{ fontSize: 13, fontWeight: 600, color: 'var(--success)', marginBottom: 4 }}>
                ✓ Respondido {p.respondido_at ? new Date(p.respondido_at).toLocaleString('es-CL', { timeZone: 'America/Santiago' }) : ''}
              </p>
              {p.respuesta && <p style={{ fontSize: 14, color: 'var(--text)' }}>{p.respuesta}</p>}
              {p.items?.length > 0 && (
                <div style={{ marginTop: 8 }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8, flexWrap: 'wrap', gap: 8 }}>
                    <p style={{ fontSize: 13, fontWeight: 600 }}>{formatItemsResumen(p.items)}</p>
                    <button
                      className="btn btn-primary"
                      style={{ fontSize: 13, padding: '7px 14px' }}
                      onClick={() => generatePDF(
                        { name: p.cliente_nombre, rut: '', email: '', address: '' },
                        p.items.map((it, i) => ({
                          id: i,
                          categoria: it.categoria,
                          description: it.descripcion,
                          price: it.precioUnitario,
                          quantity: it.cantidad,
                          total: it.cantidad * it.precioUnitario,
                        })),
                        10
                      )}
                    >
                      📄 Generar PDF
                    </button>
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
                      {p.items.map((item, i) => (
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
                </div>
              )}
            </div>
          )}

          <div style={{ marginTop: 14, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {p.estado !== 'respondido' && (
              <>
                <button className="btn btn-secondary" onClick={enviarRecordatorio} disabled={sending} style={{ fontSize: 13, padding: '7px 14px' }}>
                  {sending ? '...' : '📲 Recordatorio'}
                </button>
                <button className="btn btn-secondary" onClick={marcarRespondido} style={{ fontSize: 13, padding: '7px 14px', color: 'var(--success)' }}>
                  ✓ Marcar respondido
                </button>
              </>
            )}
            <button className="btn btn-danger" onClick={eliminar} style={{ fontSize: 13, padding: '7px 14px', marginLeft: 'auto' }}>
              Eliminar
            </button>
          </div>

          <p style={{ fontSize: 11, color: 'var(--muted)', marginTop: 10 }}>
            Creado {new Date(p.created_at).toLocaleString('es-CL', { timeZone: 'America/Santiago' })}
          </p>
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
  const [tab, setTab] = useState<'activos' | 'respondidos'>('activos')

  useEffect(() => {
    const saved = localStorage.getItem('horma_admin')
    if (saved === ADMIN_PASSWORD) setAuthed(true)
  }, [])

  const loadPendientes = useCallback(async () => {
    setLoading(true)
    const { data } = await supabase
      .from('pendientes')
      .select('*')
      .order('fecha_limite', { ascending: true })
    setPendientes((data as Pendiente[]) || [])
    setLoading(false)
  }, [])

  useEffect(() => {
    if (!authed) return
    loadPendientes()
    const interval = setInterval(loadPendientes, 30000)
    return () => clearInterval(interval)
  }, [authed, loadPendientes])

  if (!authed) return <div className="pendientes"><LoginForm onLogin={() => setAuthed(true)} /></div>

  const activos = pendientes.filter(p => p.estado !== 'respondido')
  const respondidos = pendientes.filter(p => p.estado === 'respondido')
  const vencidos = activos.filter(p => new Date(p.fecha_limite) < new Date())
  const displayed = tab === 'activos' ? activos : respondidos

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
        <button className="btn btn-primary" onClick={() => setShowForm(x => !x)}>
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

      {/* Create form */}
      {showForm && (
        <CrearForm
          onCreated={() => { setShowForm(false); loadPendientes() }}
          onCancel={() => setShowForm(false)}
        />
      )}

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 4, marginBottom: '1rem', borderBottom: '2px solid var(--border)', paddingBottom: 0 }}>
        {([['activos', `Activos (${activos.length})`], ['respondidos', `Respondidos (${respondidos.length})`]] as const).map(([k, label]) => (
          <button
            key={k}
            onClick={() => setTab(k)}
            style={{
              padding: '8px 16px',
              border: 'none',
              background: 'none',
              cursor: 'pointer',
              fontSize: 14,
              fontWeight: tab === k ? 700 : 500,
              color: tab === k ? 'var(--primary)' : 'var(--muted)',
              borderBottom: `2px solid ${tab === k ? 'var(--primary)' : 'transparent'}`,
              marginBottom: -2,
            }}
          >
            {label}
          </button>
        ))}
      </div>

      {/* List */}
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
        displayed.map(p => <PendienteCard key={p.id} p={p} onUpdate={loadPendientes} />)
      )}

      <p style={{ textAlign: 'center', fontSize: 12, color: 'var(--muted)', marginTop: 24 }}>
        Actualización automática cada 30 segundos
      </p>
    </div>
    </div>
  )
}
