import { useState, useEffect } from 'react'
import { generatePDFEtapas } from '../utils/pdfGeneratorEtapas'
import type { Etapa } from '../utils/pdfGeneratorEtapas'
import { supabase } from '../lib/supabase'

interface Client {
  name: string
  telefono: string
  email: string
  address: string
}

const FASES_DEFAULT: Etapa[] = [
  { numero: '1.0', nombre: 'Preparación y Empalme',        items: [], totalMO: 0, totalMAT: 0, total: 0 },
  { numero: '2.0', nombre: 'Canalización y Alimentación',  items: [], totalMO: 0, totalMAT: 0, total: 0 },
  { numero: '3.0', nombre: 'Instalaciones y Protecciones', items: [], totalMO: 0, totalMAT: 0, total: 0 },
  { numero: '4.0', nombre: 'Seguridad y Normativa',        items: [], totalMO: 0, totalMAT: 0, total: 0 },
]

const FASE_COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#8b5cf6', '#ef4444']

const fmt = (n: number) => Math.round(n).toLocaleString('es-CL')

const thS: React.CSSProperties = {
  padding: '6px 10px',
  fontSize: 10,
  fontWeight: 700,
  color: '#615e5b',
  textTransform: 'uppercase',
  letterSpacing: '0.04em',
  whiteSpace: 'nowrap',
  background: '#f5f5f3',
  borderBottom: '1px solid #e8e8e6',
}

const tdS: React.CSSProperties = {
  padding: '7px 10px',
  fontSize: 12,
  color: '#1a1a1a',
  borderTop: '1px solid #f0f0ee',
}

const JSON_PLACEHOLDER = `{
  "cliente": "Patricio Valdés",
  "direccion": "Las Condes, Santiago",
  "gastos_generales_porcentaje": 10,
  "items": [
    {
      "tipo": "mano_de_obra",
      "cantidad": 75,
      "descripcion": "Reemplazo de cable de centros eléctricos",
      "precio_unitario": 13000
    },
    {
      "tipo": "materiales",
      "cantidad": 50,
      "descripcion": "Cable 2.5mm",
      "precio_unitario": 800
    }
  ]
}`

// ── Login screen ─────────────────────────────────────────────────────────────

function LoginScreen({ onLogin }: { onLogin: (email: string, password: string) => Promise<string | null> }) {
  const [email, setEmail]       = useState('')
  const [password, setPassword] = useState('')
  const [error, setError]       = useState('')
  const [loading, setLoading]   = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')
    const err = await onLogin(email, password)
    if (err) setError(err)
    setLoading(false)
  }

  return (
    <div style={{
      minHeight: '100vh', background: 'var(--bg)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem',
    }}>
      <div className="card" style={{ width: '100%', maxWidth: 380, padding: '2rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: '1.75rem' }}>
          <div style={{
            width: 44, height: 44, background: '#615e5b', borderRadius: 12,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontWeight: 800, color: '#fff', fontSize: 20, flexShrink: 0,
          }}>H</div>
          <div>
            <p style={{ fontWeight: 800, fontSize: 16, color: '#1a1a1a', lineHeight: 1.2 }}>Presupuestador</p>
            <p style={{ fontSize: 12, color: '#615e5b' }}>Horma Electricidad</p>
          </div>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="field" style={{ marginBottom: 12 }}>
            <label>Email</label>
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="tu@email.com"
              required
              autoFocus
            />
          </div>
          <div className="field" style={{ marginBottom: 16 }}>
            <label>Contraseña</label>
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="••••••••"
              required
            />
          </div>
          {error && (
            <p style={{ color: 'var(--danger)', fontSize: 13, marginBottom: 12 }}>{error}</p>
          )}
          <button
            type="submit"
            className="btn btn-primary"
            disabled={loading}
            style={{ width: '100%', fontWeight: 700, fontSize: 15 }}
          >
            {loading ? 'Ingresando...' : 'Ingresar'}
          </button>
        </form>
      </div>
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function PresupuestoEtapas() {
  // Auth
  const [session, setSession]   = useState<any>(null)
  const [authLoading, setAuthLoading] = useState(true)

  // Presupuesto state
  const [client, setClient]         = useState<Client>({ name: '', telefono: '', email: '', address: '' })
  const [texto, setTexto]           = useState('')
  const [jsonInput, setJsonInput]   = useState('')
  const [inputMode, setInputMode]   = useState<'texto' | 'json'>('texto')
  const [etapas, setEtapas]         = useState<Etapa[]>(FASES_DEFAULT)
  const [procesado, setProcesado]   = useState(false)
  const [totalNeto, setTotalNeto]   = useState<number | null>(null)
  const [loading, setLoading]       = useState(false)
  const [error, setError]           = useState('')
  const [ggPct, setGgPct]           = useState(0)
  const [guardado, setGuardado]     = useState<string | null>(null)

  const grandMO  = etapas.reduce((s, e) => s + e.totalMO,  0)
  const grandMAT = etapas.reduce((s, e) => s + e.totalMAT, 0)
  const ggBase   = grandMO + grandMAT
  const ggAmount = Math.round(ggBase * ggPct / 100)
  const subtotal = ggBase + ggAmount
  const iva      = Math.round(subtotal * 0.19)
  const total    = subtotal + iva

  // Auth init
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session)
      setAuthLoading(false)
    })
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session)
    })
    return () => subscription.unsubscribe()
  }, [])

  async function handleLogin(email: string, password: string): Promise<string | null> {
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) return 'Email o contraseña incorrectos.'
    return null
  }

  async function handleLogout() {
    await supabase.auth.signOut()
  }

  // Procesar texto plano con IA
  async function procesar() {
    if (!texto.trim()) { setError('Pegá el texto del presupuesto de Gustavo.'); return }
    setLoading(true)
    setError('')
    try {
      const res  = await fetch('/api/parse-etapas', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ texto }),
      })
      const data = await res.json()
      if (!res.ok || !data.etapas) throw new Error(data.error || 'Error al procesar')
      setEtapas(data.etapas)
      setTotalNeto(data.totalNeto ?? null)
      setProcesado(true)
      setGuardado(null)
    } catch (e) {
      setError(String(e))
    } finally {
      setLoading(false)
    }
  }

  // Procesar JSON estructurado
  async function procesarJSON() {
    let parsed: any
    try {
      parsed = JSON.parse(jsonInput)
    } catch {
      setError('JSON inválido. Verifica el formato.')
      return
    }
    if (!Array.isArray(parsed.items) || parsed.items.length === 0) {
      setError('El JSON debe tener un array "items" con al menos un ítem.')
      return
    }
    setLoading(true)
    setError('')
    try {
      // Pre-cargar datos del cliente desde el JSON
      if (parsed.cliente)   setClient(c => ({ ...c, name:    parsed.cliente }))
      if (parsed.direccion) setClient(c => ({ ...c, address: parsed.direccion }))
      if (typeof parsed.gastos_generales_porcentaje === 'number') {
        setGgPct(Math.max(0, Math.min(100, parsed.gastos_generales_porcentaje)))
      }

      const res  = await fetch('/api/parse-json', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(parsed),
      })
      const data = await res.json()
      if (!res.ok || !data.etapas) throw new Error(data.error || 'Error al procesar')
      setEtapas(data.etapas)
      setTotalNeto(data.totalNeto ?? null)
      setProcesado(true)
      setGuardado(null)
    } catch (e) {
      setError(String(e))
    } finally {
      setLoading(false)
    }
  }

  function limpiar() {
    setEtapas(FASES_DEFAULT)
    setProcesado(false)
    setTotalNeto(null)
    setGgPct(0)
    setGuardado(null)
  }

  async function generarPDF() {
    if (!client.name.trim()) { alert('Ingresa el nombre del cliente antes de generar el PDF.'); return }
    if (ggBase === 0) { alert('Procesa el texto con IA antes de generar el PDF.'); return }
    const referencia = `HRM-${Date.now().toString(36).toUpperCase()}`
    await generatePDFEtapas(client, etapas, { pct: ggPct, amount: ggAmount }, referencia)

    // Guardar en Supabase
    if (session?.user?.id) {
      const clientePayload: { nombre: string; telefono?: string; email?: string } = { nombre: client.name.trim() }
      if (client.telefono?.trim()) clientePayload.telefono = client.telefono.trim()
      if (client.email?.trim()) clientePayload.email = client.email.trim()
      const { data: cliente } = await supabase
        .from('clientes')
        .upsert(clientePayload, { onConflict: 'nombre' })
        .select('id')
        .single()

      const { error: dbErr } = await supabase.from('presupuestos').insert({
        user_id:          session.user.id,
        cliente_id:       cliente?.id ?? null,
        cliente_nombre:   client.name,
        cliente_telefono: client.telefono,
        cliente_email:    client.email,
        cliente_direccion: client.address,
        estado: 'enviado',
        referencia,
        etapas,
        gg_pct:    ggPct,
        gg_amount: ggAmount,
        subtotal,
        iva,
        total,
      })
      if (!dbErr) setGuardado(referencia)
    }
  }

  // ── Render ──────────────────────────────────────────────────────────────────

  if (authLoading) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg)' }}>
        <p style={{ color: '#615e5b', fontSize: 14 }}>Cargando...</p>
      </div>
    )
  }

  if (!session) {
    return <LoginScreen onLogin={handleLogin} />
  }

  return (
    <div className="pendientes" style={{ background: 'var(--bg)', minHeight: '100vh' }}>
      <div style={{ maxWidth: 820, margin: '0 auto', padding: '1.5rem 1rem 3rem' }}>

        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: '1.5rem' }}>
          <div style={{
            width: 44, height: 44, background: '#615e5b', borderRadius: 12,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontWeight: 800, color: '#fff', fontSize: 20, flexShrink: 0,
          }}>H</div>
          <div>
            <h1 style={{ fontSize: 18, fontWeight: 800, lineHeight: 1.2, color: '#1a1a1a' }}>Presupuesto Itemizado por Etapas</h1>
            <p style={{ fontSize: 13, color: '#615e5b', fontWeight: 500 }}>Horma Electricidad — Estándar de Ingeniería</p>
          </div>
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 10, alignItems: 'center' }}>
            <span style={{ fontSize: 12, color: '#93918e' }}>{session.user.email}</span>
            <button
              onClick={handleLogout}
              style={{ fontSize: 12, color: '#615e5b', background: 'none', border: '1px solid var(--border)', borderRadius: 6, padding: '4px 10px', cursor: 'pointer' }}
            >
              Salir
            </button>
            <a href="/admin" style={{ fontSize: 13, color: '#615e5b', textDecoration: 'none', fontWeight: 600 }}>← Admin</a>
          </div>
        </div>

        {/* Client form */}
        <div className="card" style={{ padding: '1.25rem', marginBottom: '1.25rem' }}>
          <p style={{ fontSize: 11, fontWeight: 700, color: '#615e5b', marginBottom: 12, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
            Datos del cliente
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div className="field">
              <label>Nombre *</label>
              <input value={client.name}     onChange={e => setClient(c => ({ ...c, name:     e.target.value }))} placeholder="Ej: Patricio Valdés" />
            </div>
            <div className="field">
              <label>Teléfono</label>
              <input value={client.telefono} onChange={e => setClient(c => ({ ...c, telefono: e.target.value }))} placeholder="+56 9 1234 5678" />
            </div>
            <div className="field">
              <label>Email</label>
              <input type="email" value={client.email} onChange={e => setClient(c => ({ ...c, email: e.target.value }))} placeholder="cliente@email.com" />
            </div>
            <div className="field">
              <label>Dirección</label>
              <input value={client.address}  onChange={e => setClient(c => ({ ...c, address:  e.target.value }))} placeholder="Las Condes, Santiago" />
            </div>
          </div>
        </div>

        {/* Input card — tabs Texto / JSON */}
        <div className="card" style={{ padding: '1.25rem', marginBottom: '1.25rem' }}>

          {/* Tab selector */}
          <div style={{ display: 'flex', gap: 4, marginBottom: 14, borderBottom: '1px solid var(--border)', paddingBottom: 0 }}>
            {(['texto', 'json'] as const).map(mode => (
              <button
                key={mode}
                onClick={() => { setInputMode(mode); setError('') }}
                style={{
                  fontSize: 13, fontWeight: 700, padding: '6px 16px',
                  border: 'none', borderBottom: inputMode === mode ? '2px solid #e69a21' : '2px solid transparent',
                  background: 'none', cursor: 'pointer',
                  color: inputMode === mode ? '#e69a21' : '#93918e',
                  marginBottom: -1,
                }}
              >
                {mode === 'texto' ? 'Texto plano' : 'JSON / API'}
              </button>
            ))}
          </div>

          {inputMode === 'texto' ? (
            <>
              <p style={{ fontSize: 11, fontWeight: 700, color: '#615e5b', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                Texto del presupuesto (formato Gustavo)
              </p>
              <textarea
                value={texto}
                onChange={e => {
                  setTexto(e.target.value)
                  if (procesado) limpiar()
                }}
                placeholder={`Mano de obra\n75 Reemplazo de cable de centros eléctricos 13.000\nInstalación de tablero de distribución 100.000\n\nMateriales:\n50 ml Cable 2.5mm 800\nTablero de distribución con accesorios 120.000\n...`}
                rows={9}
                style={{ width: '100%', fontSize: 13, fontFamily: 'monospace', resize: 'vertical', lineHeight: 1.6 }}
              />
              {error && <p style={{ color: 'var(--danger)', fontSize: 13, marginTop: 6 }}>{error}</p>}
              {totalNeto !== null && (
                <div style={{
                  marginTop: 10, padding: '8px 14px', borderRadius: 8,
                  background: '#f0fdf4', border: '1.5px solid #22c55e',
                  display: 'flex', alignItems: 'center', gap: 8,
                }}>
                  <span style={{ fontSize: 16 }}>✓</span>
                  <span style={{ fontSize: 13, fontWeight: 700, color: '#15803d' }}>
                    Total detectado por IA: ${fmt(totalNeto)}
                  </span>
                </div>
              )}
              <button
                className="btn btn-primary"
                onClick={procesar}
                disabled={loading}
                style={{ marginTop: 12, fontWeight: 700, fontSize: 15 }}
              >
                {loading ? '⏳ Procesando con IA...' : '✨ Agrupar en etapas con IA'}
              </button>
            </>
          ) : (
            <>
              <p style={{ fontSize: 11, fontWeight: 700, color: '#615e5b', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                Entrada JSON estructurada
              </p>
              <p style={{ fontSize: 12, color: '#93918e', marginBottom: 8 }}>
                Compatible con Make.com, Zapier y cualquier webhook. Los campos <code>cliente</code>, <code>direccion</code> y <code>gastos_generales_porcentaje</code> se aplican automáticamente.
              </p>
              <textarea
                value={jsonInput}
                onChange={e => {
                  setJsonInput(e.target.value)
                  if (procesado) limpiar()
                }}
                placeholder={JSON_PLACEHOLDER}
                rows={14}
                style={{ width: '100%', fontSize: 12, fontFamily: 'monospace', resize: 'vertical', lineHeight: 1.6 }}
              />
              {error && <p style={{ color: 'var(--danger)', fontSize: 13, marginTop: 6 }}>{error}</p>}
              {totalNeto !== null && (
                <div style={{
                  marginTop: 10, padding: '8px 14px', borderRadius: 8,
                  background: '#f0fdf4', border: '1.5px solid #22c55e',
                  display: 'flex', alignItems: 'center', gap: 8,
                }}>
                  <span style={{ fontSize: 16 }}>✓</span>
                  <span style={{ fontSize: 13, fontWeight: 700, color: '#15803d' }}>
                    Total detectado: ${fmt(totalNeto)}
                  </span>
                </div>
              )}
              <button
                className="btn btn-primary"
                onClick={procesarJSON}
                disabled={loading}
                style={{ marginTop: 12, fontWeight: 700, fontSize: 15 }}
              >
                {loading ? '⏳ Clasificando con IA...' : '⚙️ Procesar JSON y clasificar fases'}
              </button>
            </>
          )}
        </div>

        {/* Phase cards */}
        <div style={{ marginBottom: '1.25rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
            <p style={{ fontSize: 11, fontWeight: 700, color: '#615e5b', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
              Etapas de obra
              {procesado && <span style={{ marginLeft: 8, color: '#16a34a', fontWeight: 700, fontSize: 11 }}>✓ IA procesó los datos</span>}
            </p>
            {procesado && (
              <button
                onClick={limpiar}
                style={{ background: 'none', border: 'none', fontSize: 12, color: '#615e5b', cursor: 'pointer', fontWeight: 600 }}
              >↺ Limpiar</button>
            )}
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {etapas.map((etapa, idx) => {
              const color  = FASE_COLORS[idx]
              const activa = etapa.items.length > 0
              return (
                <div key={etapa.numero} className="card" style={{
                  padding: 0, overflow: 'hidden',
                  border: `2px solid ${activa ? color + '35' : 'var(--border)'}`,
                }}>
                  <div style={{
                    padding: '10px 14px',
                    background: activa ? color + '0d' : '#fafaf9',
                    borderBottom: activa ? `1px solid ${color}20` : '1px solid var(--border)',
                    display: 'flex', alignItems: 'center', gap: 10,
                  }}>
                    <span style={{
                      width: 34, height: 34, borderRadius: 8, flexShrink: 0,
                      background: activa ? color : '#d4d4d2',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      color: '#fff', fontWeight: 800, fontSize: 11,
                    }}>{etapa.numero}</span>
                    <span style={{ fontWeight: 700, fontSize: 13, color: activa ? '#1a1a1a' : '#b0b0ac' }}>
                      {etapa.nombre}
                    </span>
                    {activa ? (
                      <div style={{ marginLeft: 'auto', display: 'flex', gap: 18, fontSize: 12 }}>
                        <span style={{ color: '#615e5b' }}>
                          MO: <strong style={{ color: '#1d4ed8' }}>${fmt(etapa.totalMO)}</strong>
                        </span>
                        <span style={{ color: '#615e5b' }}>
                          MAT: <strong style={{ color: '#15803d' }}>${fmt(etapa.totalMAT)}</strong>
                        </span>
                        <span style={{ color: color, fontWeight: 800, fontSize: 13 }}>
                          ${fmt(etapa.total)}
                        </span>
                      </div>
                    ) : (
                      <span style={{ marginLeft: 'auto', fontSize: 12, color: '#ccc' }}>Sin ítems</span>
                    )}
                  </div>

                  {activa && (
                    <div style={{ overflowX: 'auto' }}>
                      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                        <thead>
                          <tr>
                            <th style={{ ...thS, width: 44, textAlign: 'center' }}>N°</th>
                            <th style={{ ...thS, textAlign: 'left' }}>Descripción / Concepto</th>
                            <th style={{ ...thS, width: 54, textAlign: 'center' }}>Cant.</th>
                            <th style={{ ...thS, width: 96, textAlign: 'right' }}>P. Unitario</th>
                            <th style={{ ...thS, width: 46, textAlign: 'center' }}>Tipo</th>
                            <th style={{ ...thS, width: 100, textAlign: 'right' }}>Total</th>
                          </tr>
                        </thead>
                        <tbody>
                          {etapa.items.map((item, i) => (
                            <tr key={i} style={{ background: i % 2 === 0 ? '#fff' : '#fafaf8' }}>
                              <td style={{ ...tdS, textAlign: 'center', color: '#93918e', fontSize: 11 }}>{item.subNumero}</td>
                              <td style={{ ...tdS }}>{item.descripcion}</td>
                              <td style={{ ...tdS, textAlign: 'center', color: '#615e5b', fontWeight: 600 }}>{item.cantidad}</td>
                              <td style={{ ...tdS, textAlign: 'right', color: '#615e5b' }}>${fmt(item.precioUnitario)}</td>
                              <td style={{ ...tdS, textAlign: 'center' }}>
                                <span style={{
                                  fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 4,
                                  background: item.tipo === 'MO' ? '#dbeafe' : '#dcfce7',
                                  color:      item.tipo === 'MO' ? '#1d4ed8' : '#15803d',
                                }}>{item.tipo}</span>
                              </td>
                              <td style={{ ...tdS, textAlign: 'right', fontWeight: 700 }}>${fmt(item.total)}</td>
                            </tr>
                          ))}
                        </tbody>
                        {etapa.items.length > 1 && (
                          <tfoot>
                            <tr style={{ background: '#f0efed' }}>
                              <td colSpan={4} style={{ ...tdS, fontSize: 11, fontWeight: 700, color: '#615e5b', textAlign: 'right' }}>
                                Subtotal {etapa.numero}
                              </td>
                              <td style={{ ...tdS, textAlign: 'center' }} />
                              <td style={{ ...tdS, textAlign: 'right', fontWeight: 800, color: color }}>${fmt(etapa.total)}</td>
                            </tr>
                          </tfoot>
                        )}
                      </table>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>

        {/* Gastos Generales selector */}
        {procesado && (
          <div className="card" style={{ padding: '1.25rem', marginBottom: '1.25rem' }}>
            <p style={{ fontSize: 11, fontWeight: 700, color: '#615e5b', marginBottom: 12, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
              Gastos Generales y Logística
            </p>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 10 }}>
              {[0, 5, 7, 10, 12, 15].map(pct => (
                <button
                  key={pct}
                  onClick={() => setGgPct(pct)}
                  style={{
                    fontSize: 13, padding: '6px 14px', borderRadius: 8, fontWeight: 700, cursor: 'pointer',
                    border: ggPct === pct ? '2px solid #e69a21' : '2px solid var(--border)',
                    background: ggPct === pct ? '#fef9ee' : 'var(--white)',
                    color: ggPct === pct ? '#e69a21' : '#615e5b',
                  }}
                >
                  {pct === 0 ? 'Sin GG' : `${pct}%`}
                </button>
              ))}
              <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <input
                  type="number"
                  min={0}
                  max={100}
                  step={0.5}
                  value={ggPct === 0 ? '' : ggPct}
                  onChange={e => setGgPct(Math.max(0, Math.min(100, Number(e.target.value) || 0)))}
                  placeholder="Otro"
                  style={{ width: 72, fontSize: 13, padding: '6px 10px', borderRadius: 8, border: '2px solid var(--border)', textAlign: 'center' }}
                />
                <span style={{ fontSize: 13, color: '#615e5b', fontWeight: 600 }}>%</span>
              </div>
            </div>
            {ggAmount > 0 && (
              <div style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                padding: '8px 12px', borderRadius: 8, background: '#fef9ee', border: '1px solid #e69a21',
                fontSize: 13,
              }}>
                <span style={{ color: '#615e5b' }}>${fmt(ggBase)} × {ggPct}%</span>
                <strong style={{ color: '#e69a21', fontSize: 15 }}>${fmt(ggAmount)}</strong>
              </div>
            )}
          </div>
        )}

        {/* Grand totals */}
        <div className="card" style={{ padding: '1.25rem', marginBottom: '1.25rem' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginBottom: 14 }}>
            <div style={{ textAlign: 'center', padding: '10px 0' }}>
              <p style={{ fontSize: 11, color: '#615e5b', fontWeight: 600, marginBottom: 4 }}>Subtotal Mano de Obra</p>
              <p style={{ fontSize: 18, fontWeight: 800, color: '#1d4ed8' }}>${fmt(grandMO)}</p>
            </div>
            <div style={{ textAlign: 'center', padding: '10px 0', borderLeft: '1px solid var(--border)', borderRight: '1px solid var(--border)' }}>
              <p style={{ fontSize: 11, color: '#615e5b', fontWeight: 600, marginBottom: 4 }}>Subtotal Materiales</p>
              <p style={{ fontSize: 18, fontWeight: 800, color: '#15803d' }}>${fmt(grandMAT)}</p>
            </div>
            <div style={{ textAlign: 'center', padding: '10px 0' }}>
              <p style={{ fontSize: 11, color: '#615e5b', fontWeight: 600, marginBottom: 4 }}>Subtotal Neto</p>
              <p style={{ fontSize: 18, fontWeight: 800, color: '#1a1a1a' }}>${fmt(ggBase)}</p>
            </div>
          </div>
          {ggAmount > 0 && (
            <div style={{
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              padding: '8px 14px', borderRadius: 8, background: '#f5f5f3',
              border: '1px solid var(--border)', marginBottom: 10, fontSize: 13,
            }}>
              <span style={{ color: '#615e5b' }}>Gastos Generales ({ggPct}%)</span>
              <strong style={{ color: '#1a1a1a' }}>${fmt(ggAmount)}</strong>
            </div>
          )}
          <div style={{
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            padding: '12px 16px', borderRadius: 10,
            background: '#fef9ee', border: '2px solid #e69a21', marginBottom: 14,
          }}>
            <span style={{ fontSize: 13, color: '#615e5b' }}>
              IVA (19%): <strong style={{ color: '#1a1a1a' }}>${fmt(iva)}</strong>
            </span>
            <div style={{ textAlign: 'right' }}>
              <p style={{ fontSize: 11, color: '#615e5b', fontWeight: 600 }}>TOTAL CON IVA</p>
              <p style={{ fontSize: 24, fontWeight: 800, color: '#e69a21', lineHeight: 1.1 }}>${fmt(total)}</p>
            </div>
          </div>
          <button
            className="btn btn-lg"
            onClick={generarPDF}
            style={{
              width: '100%', fontWeight: 800, fontSize: 16,
              background: '#615e5b', color: '#fff', border: 'none',
              borderBottom: '4px solid #e69a21', borderRadius: 10,
            }}
          >
            📄 Generar PDF — Presupuesto Itemizado
          </button>
          {guardado && (
            <p style={{ textAlign: 'center', fontSize: 12, color: '#15803d', marginTop: 8, fontWeight: 600 }}>
              ✓ Guardado en el historial — Ref: {guardado}
            </p>
          )}
        </div>

        <p style={{ textAlign: 'center', fontSize: 12, color: '#93918e' }}>
          Procesá el texto o JSON con IA para ver el desglose ítem a ítem antes de generar el PDF.
        </p>
      </div>
    </div>
  )
}
