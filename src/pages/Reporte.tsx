import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'

const REPORTE_TOKEN = import.meta.env.VITE_REPORTE_TOKEN as string

const TRABAJADORES = ['Alejandro', 'Fabriel', 'Henry', 'Manuel', 'Misael', 'Samuel']
const OBRA_LIMACHE = 'Ohiggins 126 Limache'
// Respaldo por si falla la carga desde Supabase (tabla `obras`, fuente real de la lista).
const OBRAS_FALLBACK = [
  OBRA_LIMACHE,
  'Doctora Eloísa (dirección 5843)',
  'Doctora Eloísa - Obra 1 (dirección 5860)',
  'Luis Carrera 2700',
  'Renato Sanchez',
]

// El viático solo corresponde a la obra de Limache (los equipos en Santiago no lo reciben).
function viaticoPorObra(obra: string) {
  return obra === OBRA_LIMACHE
}

interface TrabajadorState {
  presente: boolean
  obra: string
  fraccionJornada: number
  viatico: boolean
  adelanto: string
  tipoPago: 'adelanto' | 'pago_semanal'
}

interface CompraRow {
  id?: string
  descripcion: string
  monto: string
  obra: string
  pagadoPor: string
  reembolsado: boolean
}

interface CobroRow {
  id?: string
  obra: string
  cliente: string
  monto: string
}

interface SubcontratoRow {
  id?: string
  obra: string
  subcontrato: string
  monto: string
}

interface TrabajoPuntualRow {
  id?: string
  descripcion: string
  direccion: string
  trabajador: string
}

const DEFAULT_TRABAJADOR: TrabajadorState = {
  presente: true,
  obra: '',
  fraccionJornada: 1,
  viatico: true,
  adelanto: '',
  tipoPago: 'adelanto',
}

function todayISO() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Santiago' }).format(new Date())
}

function defaultTrabajadores(): Record<string, TrabajadorState> {
  const base: Record<string, TrabajadorState> = {}
  for (const nombre of TRABAJADORES) base[nombre] = { ...DEFAULT_TRABAJADOR }
  return base
}

/* ─── Reporte page ──────────────────────────────────── */
interface Props {
  token: string | null
  embedded?: boolean
}

export default function Reporte({ token, embedded = false }: Props) {
  const tokenValido = token === REPORTE_TOKEN

  const [fecha, setFecha] = useState(todayISO())
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [trabajadores, setTrabajadores] = useState<Record<string, TrabajadorState>>(defaultTrabajadores())
  const [obras, setObras] = useState<string[]>(OBRAS_FALLBACK)
  const [obraGeneral, setObraGeneral] = useState('')
  const [compras, setCompras] = useState<CompraRow[]>([])
  const [cobros, setCobros] = useState<CobroRow[]>([])
  const [subcontratos, setSubcontratos] = useState<SubcontratoRow[]>([])
  const [trabajosPuntuales, setTrabajosPuntuales] = useState<TrabajoPuntualRow[]>([])

  const cargarDia = useCallback(async (f: string) => {
    setLoading(true)
    setError(null)
    const [{ data: dia }, { data: compr }, { data: cobr }, { data: subc }, { data: punt }] = await Promise.all([
      supabase.from('reportes_diarios').select('*').eq('fecha', f),
      supabase.from('reportes_compras').select('*').eq('fecha', f).order('created_at'),
      supabase.from('reportes_cobros').select('*').eq('fecha', f).order('created_at'),
      supabase.from('reportes_subcontratos').select('*').eq('fecha', f).order('created_at'),
      supabase.from('reportes_trabajos_puntuales').select('*').eq('fecha', f).order('created_at'),
    ])

    const base = defaultTrabajadores()
    for (const row of dia || []) {
      if (base[row.trabajador]) {
        base[row.trabajador] = {
          presente: row.presente,
          obra: row.obra || '',
          fraccionJornada: row.fraccion_jornada ?? 1,
          viatico: row.viatico ?? false,
          adelanto: row.adelanto_monto != null ? String(row.adelanto_monto) : '',
          tipoPago: row.tipo_pago === 'pago_semanal' ? 'pago_semanal' : 'adelanto',
        }
      }
    }
    setTrabajadores(base)
    setCompras((compr || []).map((c: { id: string; descripcion: string; monto: number; obra: string | null; pagado_por: string | null; reembolsado: boolean | null }) => ({
      id: c.id, descripcion: c.descripcion, monto: String(c.monto), obra: c.obra || '', pagadoPor: c.pagado_por || '', reembolsado: c.reembolsado ?? false,
    })))
    setCobros((cobr || []).map((c: { id: string; obra: string | null; cliente: string; monto: number }) => ({
      id: c.id, obra: c.obra || '', cliente: c.cliente, monto: String(c.monto),
    })))
    setSubcontratos((subc || []).map((s: { id: string; obra: string | null; subcontrato: string; monto: number }) => ({
      id: s.id, obra: s.obra || '', subcontrato: s.subcontrato, monto: String(s.monto),
    })))
    setTrabajosPuntuales((punt || []).map((p: { id: string; descripcion: string; direccion: string | null; trabajador: string | null }) => ({
      id: p.id, descripcion: p.descripcion, direccion: p.direccion || '', trabajador: p.trabajador || '',
    })))
    setLoading(false)
  }, [])

  useEffect(() => {
    if (!tokenValido) return
    cargarDia(fecha)
  }, [tokenValido, fecha, cargarDia])

  useEffect(() => {
    if (!tokenValido) return
    supabase.from('obras').select('nombre').eq('activa', true).order('nombre').then(({ data }) => {
      if (data && data.length) setObras(data.map((o: { nombre: string }) => o.nombre))
    })
  }, [tokenValido])

  function actualizarTrabajador(nombre: string, patch: Partial<TrabajadorState>) {
    setTrabajadores(prev => ({ ...prev, [nombre]: { ...prev[nombre], ...patch } }))
  }

  function aplicarObraATodos() {
    if (!obraGeneral) return
    setTrabajadores(prev => {
      const next = { ...prev }
      for (const nombre of TRABAJADORES) {
        if (next[nombre].presente) next[nombre] = { ...next[nombre], obra: obraGeneral, viatico: viaticoPorObra(obraGeneral) }
      }
      return next
    })
  }

  function agregarCompra() {
    setCompras(prev => [...prev, { descripcion: '', monto: '', obra: '', pagadoPor: '', reembolsado: false }])
  }
  function actualizarCompra(idx: number, patch: Partial<CompraRow>) {
    setCompras(prev => prev.map((c, i) => (i === idx ? { ...c, ...patch } : c)))
  }
  function quitarCompra(idx: number) {
    if (!window.confirm('¿Seguro que quieres quitar esta compra?')) return
    setCompras(prev => prev.filter((_, i) => i !== idx))
  }

  function agregarCobro() {
    setCobros(prev => [...prev, { obra: '', cliente: '', monto: '' }])
  }
  function actualizarCobro(idx: number, patch: Partial<CobroRow>) {
    setCobros(prev => prev.map((c, i) => (i === idx ? { ...c, ...patch } : c)))
  }
  function quitarCobro(idx: number) {
    if (!window.confirm('¿Seguro que quieres quitar este cobro?')) return
    setCobros(prev => prev.filter((_, i) => i !== idx))
  }

  function agregarSubcontrato() {
    setSubcontratos(prev => [...prev, { obra: '', subcontrato: '', monto: '' }])
  }
  function actualizarSubcontrato(idx: number, patch: Partial<SubcontratoRow>) {
    setSubcontratos(prev => prev.map((s, i) => (i === idx ? { ...s, ...patch } : s)))
  }
  function quitarSubcontrato(idx: number) {
    if (!window.confirm('¿Seguro que quieres quitar este subcontrato?')) return
    setSubcontratos(prev => prev.filter((_, i) => i !== idx))
  }

  function agregarTrabajoPuntual() {
    setTrabajosPuntuales(prev => [...prev, { descripcion: '', direccion: '', trabajador: '' }])
  }
  function actualizarTrabajoPuntual(idx: number, patch: Partial<TrabajoPuntualRow>) {
    setTrabajosPuntuales(prev => prev.map((p, i) => (i === idx ? { ...p, ...patch } : p)))
  }
  function quitarTrabajoPuntual(idx: number) {
    if (!window.confirm('¿Seguro que quieres quitar este trabajo puntual?')) return
    setTrabajosPuntuales(prev => prev.filter((_, i) => i !== idx))
  }

  async function enviarReporte() {
    setError(null)

    const filasDiarias = TRABAJADORES.map(nombre => {
      const t = trabajadores[nombre]
      return {
        fecha,
        trabajador: nombre,
        presente: t.presente,
        obra: t.presente ? (t.obra || null) : null,
        fraccion_jornada: t.presente ? t.fraccionJornada : 0,
        viatico: t.presente ? t.viatico : false,
        adelanto_monto: t.adelanto.trim() ? Number(t.adelanto) : null,
        tipo_pago: t.tipoPago,
      }
    })

    if (filasDiarias.some(f => f.presente && !f.obra)) {
      alert('Falta indicar la obra de algún trabajador presente.')
      return
    }

    if (filasDiarias.some(f => f.adelanto_monto !== null && (!Number.isFinite(f.adelanto_monto) || f.adelanto_monto <= 0))) {
      alert('El monto pagado hoy de algún trabajador no es válido.')
      return
    }

    const montoInvalido = (m: string) => { const n = Number(m); return !Number.isFinite(n) || n <= 0 }

    const comprasValidas = compras.filter(c => c.descripcion.trim() || c.monto.trim())
    if (comprasValidas.some(c => !c.descripcion.trim() || !c.monto.trim())) {
      alert('Cada compra necesita descripción y monto.')
      return
    }
    if (comprasValidas.some(c => montoInvalido(c.monto))) {
      alert('El monto de alguna compra no es válido.')
      return
    }

    const cobrosValidos = cobros.filter(c => c.cliente.trim() || c.monto.trim())
    if (cobrosValidos.some(c => !c.cliente.trim() || !c.monto.trim())) {
      alert('Cada cobro necesita cliente y monto.')
      return
    }
    if (cobrosValidos.some(c => montoInvalido(c.monto))) {
      alert('El monto de algún cobro no es válido.')
      return
    }

    const subcontratosValidos = subcontratos.filter(s => s.subcontrato.trim() || s.monto.trim())
    if (subcontratosValidos.some(s => !s.subcontrato.trim() || !s.monto.trim())) {
      alert('Cada subcontrato necesita nombre y monto.')
      return
    }
    if (subcontratosValidos.some(s => montoInvalido(s.monto))) {
      alert('El monto de algún subcontrato no es válido.')
      return
    }

    const trabajosValidos = trabajosPuntuales.filter(p => p.descripcion.trim() || p.direccion.trim())
    if (trabajosValidos.some(p => !p.descripcion.trim())) {
      alert('Cada trabajo puntual necesita descripción.')
      return
    }

    setSaving(true)

    const { error: e1 } = await supabase
      .from('reportes_diarios')
      .upsert(filasDiarias, { onConflict: 'fecha,trabajador' })
    if (e1) {
      setError('Error al guardar la asistencia. Intenta de nuevo.')
      setSaving(false)
      return
    }

    await supabase.from('reportes_compras').delete().eq('fecha', fecha)
    if (comprasValidas.length) {
      const { error: e2 } = await supabase.from('reportes_compras').insert(
        comprasValidas.map(c => ({ fecha, descripcion: c.descripcion.trim(), monto: Number(c.monto), obra: c.obra || null, pagado_por: c.pagadoPor || null, reembolsado: c.reembolsado }))
      )
      if (e2) {
        setError('Error al guardar las compras. Intenta de nuevo.')
        setSaving(false)
        return
      }
    }

    await supabase.from('reportes_cobros').delete().eq('fecha', fecha)
    if (cobrosValidos.length) {
      const { error: e3 } = await supabase.from('reportes_cobros').insert(
        cobrosValidos.map(c => ({ fecha, obra: c.obra || null, cliente: c.cliente.trim(), monto: Number(c.monto) }))
      )
      if (e3) {
        setError('Error al guardar los cobros. Intenta de nuevo.')
        setSaving(false)
        return
      }
    }

    await supabase.from('reportes_subcontratos').delete().eq('fecha', fecha)
    if (subcontratosValidos.length) {
      const { error: e4 } = await supabase.from('reportes_subcontratos').insert(
        subcontratosValidos.map(s => ({ fecha, obra: s.obra || null, subcontrato: s.subcontrato.trim(), monto: Number(s.monto) }))
      )
      if (e4) {
        setError('Error al guardar los subcontratos. Intenta de nuevo.')
        setSaving(false)
        return
      }
    }

    await supabase.from('reportes_trabajos_puntuales').delete().eq('fecha', fecha)
    if (trabajosValidos.length) {
      const { error: e5 } = await supabase.from('reportes_trabajos_puntuales').insert(
        trabajosValidos.map(p => ({ fecha, descripcion: p.descripcion.trim(), direccion: p.direccion.trim() || null, trabajador: p.trabajador || null }))
      )
      if (e5) {
        setError('Error al guardar los trabajos puntuales. Intenta de nuevo.')
        setSaving(false)
        return
      }
    }

    for (const endpoint of ['/api/sync-horas', '/api/sync-compras', '/api/sync-cobros', '/api/sync-subcontratos']) {
      fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fecha }),
      }).catch(() => {})
    }

    setSaving(false)
    setSaved(true)
    setTimeout(() => setSaved(false), 2500)
    cargarDia(fecha)
  }

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
    <div className={embedded ? undefined : 'pendientes'}>
      <div style={{ maxWidth: 560, margin: '0 auto', padding: embedded ? 0 : '1.25rem 14px 4rem' }}>
        {/* Header */}
        {!embedded && (
          <div style={{
            background: 'var(--secondary)', borderRadius: 16, padding: '18px 20px', marginBottom: '1.25rem',
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
              <h1 style={{ fontSize: 18, fontWeight: 800, lineHeight: 1.2, color: '#fff' }}>Reporte diario</h1>
              <p style={{ fontSize: 13, color: 'rgba(255,255,255,0.7)' }}>Cuéntanos cómo fue el día de obra</p>
            </div>
          </div>
        )}

        {/* Fecha */}
        <div className="field" style={{ marginBottom: 20 }}>
          <label>Fecha</label>
          <input type="date" value={fecha} onChange={e => setFecha(e.target.value)} style={{ fontSize: 16 }} />
        </div>

        {loading ? (
          <div className="spinner" />
        ) : (
          <>
            {/* Obra general */}
            <div className="card" style={{ padding: 16, marginBottom: 20 }}>
              <p style={{ fontSize: 13, fontWeight: 700, color: 'var(--secondary)', marginBottom: 10, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                Obra del equipo (opcional)
              </p>
              <div style={{ display: 'flex', gap: 8 }}>
                <select value={obraGeneral} onChange={e => setObraGeneral(e.target.value)} style={{ flex: 1 }}>
                  <option value="">Selecciona una obra...</option>
                  {obras.map(o => <option key={o} value={o}>{o}</option>)}
                </select>
                <button type="button" className="btn btn-secondary" onClick={aplicarObraATodos} disabled={!obraGeneral}>
                  Aplicar a todos
                </button>
              </div>
            </div>

            {/* Trabajadores */}
            <h2 style={{ fontSize: 15, fontWeight: 800, marginBottom: 10 }}>Trabajadores</h2>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 24 }}>
              {TRABAJADORES.map(nombre => {
                const t = trabajadores[nombre]
                const esFabriel = nombre === 'Fabriel'
                return (
                  <div key={nombre} className="card" style={{ padding: 14 }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: t.presente ? 12 : 0 }}>
                      <span style={{ fontSize: 16, fontWeight: 700 }}>{nombre}</span>
                      <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, fontWeight: 600, color: t.presente ? 'var(--muted)' : 'var(--danger)', textTransform: 'none', letterSpacing: 0, cursor: 'pointer' }}>
                        <input
                          type="checkbox"
                          checked={!t.presente}
                          onChange={e => actualizarTrabajador(nombre, { presente: !e.target.checked })}
                          style={{ width: 18, height: 18, accentColor: 'var(--danger)', cursor: 'pointer' }}
                        />
                        Ausente hoy
                      </label>
                    </div>

                    {t.presente && (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                        {esFabriel && (
                          <p style={{ fontSize: 12, color: 'var(--muted)', background: 'var(--bg)', padding: '6px 10px', borderRadius: 8 }}>
                            Fabriel tiene sueldo fijo mensual + bono. Aquí solo registra asistencia y viático, no ingreses un monto de sueldo del día.
                          </p>
                        )}
                        <div className="field">
                          <label>Obra</label>
                          <select
                            value={t.obra}
                            onChange={e => actualizarTrabajador(nombre, { obra: e.target.value, viatico: viaticoPorObra(e.target.value) })}
                          >
                            <option value="">Selecciona una obra...</option>
                            {obras.map(o => <option key={o} value={o}>{o}</option>)}
                          </select>
                        </div>
                        <div style={{ display: 'flex', gap: 10 }}>
                          <div className="field" style={{ flex: 1 }}>
                            <label>Jornada</label>
                            <select
                              value={t.fraccionJornada}
                              onChange={e => actualizarTrabajador(nombre, { fraccionJornada: Number(e.target.value) })}
                            >
                              <option value={1}>Día completo</option>
                              <option value={0.5}>Medio día</option>
                            </select>
                          </div>
                          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, fontWeight: 600, color: t.viatico ? 'var(--text)' : 'var(--danger)', paddingTop: 22, cursor: 'pointer' }}>
                            <input
                              type="checkbox"
                              checked={!t.viatico}
                              onChange={e => actualizarTrabajador(nombre, { viatico: !e.target.checked })}
                              style={{ width: 18, height: 18, accentColor: 'var(--danger)', cursor: 'pointer' }}
                            />
                            Sin viático hoy
                          </label>
                        </div>
                        <div className="field">
                          <label>Monto pagado hoy (opcional)</label>
                          <input
                            type="number"
                            min="0"
                            placeholder="Monto en pesos"
                            value={t.adelanto}
                            onChange={e => actualizarTrabajador(nombre, { adelanto: e.target.value })}
                          />
                        </div>
                        {t.adelanto.trim() && (
                          <div className="field">
                            <label>¿Qué es este monto?</label>
                            <select
                              value={t.tipoPago}
                              onChange={e => actualizarTrabajador(nombre, { tipoPago: e.target.value as 'adelanto' | 'pago_semanal' })}
                            >
                              <option value="adelanto">Adelanto (a cuenta de lo que falta pagar)</option>
                              <option value="pago_semanal">Pago semanal completo (liquidación de la semana)</option>
                            </select>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>

            {/* Compras del día */}
            <h2 style={{ fontSize: 15, fontWeight: 800, marginBottom: 10 }}>Compras del día</h2>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 12 }}>
              {compras.map((c, idx) => (
                <div key={idx} className="card" style={{ padding: 14 }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    <div className="field">
                      <label>Descripción</label>
                      <input
                        type="text"
                        placeholder="Qué se compró"
                        value={c.descripcion}
                        onChange={e => actualizarCompra(idx, { descripcion: e.target.value })}
                      />
                    </div>
                    <div style={{ display: 'flex', gap: 10 }}>
                      <div className="field" style={{ flex: 1 }}>
                        <label>Monto</label>
                        <input
                          type="number"
                          min="0"
                          placeholder="Monto en pesos"
                          value={c.monto}
                          onChange={e => actualizarCompra(idx, { monto: e.target.value })}
                        />
                      </div>
                      <div className="field" style={{ flex: 1 }}>
                        <label>Obra</label>
                        <select value={c.obra} onChange={e => actualizarCompra(idx, { obra: e.target.value })}>
                          <option value="">Selecciona...</option>
                          {obras.map(o => <option key={o} value={o}>{o}</option>)}
                        </select>
                      </div>
                    </div>
                    <div className="field">
                      <label>¿Quién pagó?</label>
                      <select value={c.pagadoPor} onChange={e => actualizarCompra(idx, { pagadoPor: e.target.value })}>
                        <option value="">Caja de la empresa</option>
                        {TRABAJADORES.map(n => <option key={n} value={n}>{n} (con su propia plata — hay que reembolsarle)</option>)}
                      </select>
                    </div>
                    <button type="button" className="btn btn-ghost" onClick={() => quitarCompra(idx)} style={{ alignSelf: 'flex-end', fontSize: 13 }}>
                      ✕ Quitar
                    </button>
                  </div>
                </div>
              ))}
            </div>
            <button type="button" className="btn btn-secondary" onClick={agregarCompra} style={{ width: '100%', marginBottom: 24 }}>
              + Agregar compra
            </button>

            {/* Cobros del día */}
            <h2 style={{ fontSize: 15, fontWeight: 800, marginBottom: 10 }}>Cobros del día</h2>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 12 }}>
              {cobros.map((c, idx) => (
                <div key={idx} className="card" style={{ padding: 14 }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    <div className="field">
                      <label>Cliente</label>
                      <input
                        type="text"
                        placeholder="Nombre del cliente"
                        value={c.cliente}
                        onChange={e => actualizarCobro(idx, { cliente: e.target.value })}
                      />
                    </div>
                    <div style={{ display: 'flex', gap: 10 }}>
                      <div className="field" style={{ flex: 1 }}>
                        <label>Monto</label>
                        <input
                          type="number"
                          min="0"
                          placeholder="Monto en pesos"
                          value={c.monto}
                          onChange={e => actualizarCobro(idx, { monto: e.target.value })}
                        />
                      </div>
                      <div className="field" style={{ flex: 1 }}>
                        <label>Obra</label>
                        <select value={c.obra} onChange={e => actualizarCobro(idx, { obra: e.target.value })}>
                          <option value="">Selecciona...</option>
                          {obras.map(o => <option key={o} value={o}>{o}</option>)}
                        </select>
                      </div>
                    </div>
                    <button type="button" className="btn btn-ghost" onClick={() => quitarCobro(idx)} style={{ alignSelf: 'flex-end', fontSize: 13 }}>
                      ✕ Quitar
                    </button>
                  </div>
                </div>
              ))}
            </div>
            <button type="button" className="btn btn-secondary" onClick={agregarCobro} style={{ width: '100%', marginBottom: 28 }}>
              + Agregar cobro
            </button>

            {/* Subcontratos */}
            <h2 style={{ fontSize: 15, fontWeight: 800, marginBottom: 10 }}>Subcontratos</h2>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 12 }}>
              {subcontratos.map((s, idx) => (
                <div key={idx} className="card" style={{ padding: 14 }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    <div className="field">
                      <label>Subcontrato</label>
                      <input
                        type="text"
                        placeholder="Ej: Pintura"
                        value={s.subcontrato}
                        onChange={e => actualizarSubcontrato(idx, { subcontrato: e.target.value })}
                      />
                    </div>
                    <div style={{ display: 'flex', gap: 10 }}>
                      <div className="field" style={{ flex: 1 }}>
                        <label>Monto</label>
                        <input
                          type="number"
                          min="0"
                          placeholder="Monto en pesos"
                          value={s.monto}
                          onChange={e => actualizarSubcontrato(idx, { monto: e.target.value })}
                        />
                      </div>
                      <div className="field" style={{ flex: 1 }}>
                        <label>Obra</label>
                        <select value={s.obra} onChange={e => actualizarSubcontrato(idx, { obra: e.target.value })}>
                          <option value="">Selecciona...</option>
                          {obras.map(o => <option key={o} value={o}>{o}</option>)}
                        </select>
                      </div>
                    </div>
                    <button type="button" className="btn btn-ghost" onClick={() => quitarSubcontrato(idx)} style={{ alignSelf: 'flex-end', fontSize: 13 }}>
                      ✕ Quitar
                    </button>
                  </div>
                </div>
              ))}
            </div>
            <button type="button" className="btn btn-secondary" onClick={agregarSubcontrato} style={{ width: '100%', marginBottom: 28 }}>
              + Agregar subcontrato
            </button>

            {/* Trabajo puntual / visita técnica */}
            <h2 style={{ fontSize: 15, fontWeight: 800, marginBottom: 4 }}>Trabajo puntual o visita técnica</h2>
            <p style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 10 }}>
              Para trabajos nuevos que no son ninguna de las obras de la lista.
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 12 }}>
              {trabajosPuntuales.map((p, idx) => (
                <div key={idx} className="card" style={{ padding: 14 }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    <div className="field">
                      <label>Descripción</label>
                      <input
                        type="text"
                        placeholder="Ej: Visita técnica cotización tablero"
                        value={p.descripcion}
                        onChange={e => actualizarTrabajoPuntual(idx, { descripcion: e.target.value })}
                      />
                    </div>
                    <div className="field">
                      <label>Dirección</label>
                      <input
                        type="text"
                        placeholder="Dirección o referencia del lugar"
                        value={p.direccion}
                        onChange={e => actualizarTrabajoPuntual(idx, { direccion: e.target.value })}
                      />
                    </div>
                    <div className="field">
                      <label>Quién lo hizo (opcional)</label>
                      <select value={p.trabajador} onChange={e => actualizarTrabajoPuntual(idx, { trabajador: e.target.value })}>
                        <option value="">Selecciona...</option>
                        {TRABAJADORES.map(n => <option key={n} value={n}>{n}</option>)}
                      </select>
                    </div>
                    <button type="button" className="btn btn-ghost" onClick={() => quitarTrabajoPuntual(idx)} style={{ alignSelf: 'flex-end', fontSize: 13 }}>
                      ✕ Quitar
                    </button>
                  </div>
                </div>
              ))}
            </div>
            <button type="button" className="btn btn-secondary" onClick={agregarTrabajoPuntual} style={{ width: '100%', marginBottom: 28 }}>
              + Agregar trabajo puntual
            </button>

            {error && (
              <p style={{ color: 'var(--danger)', fontSize: 14, fontWeight: 600, marginBottom: 12, textAlign: 'center' }}>{error}</p>
            )}

            <button
              className="btn btn-primary btn-lg"
              onClick={enviarReporte}
              disabled={saving}
              style={{ fontSize: 17, fontWeight: 800 }}
            >
              {saving ? 'Guardando...' : saved ? '✓ Guardado' : 'Guardar reporte del día'}
            </button>
          </>
        )}
      </div>
    </div>
  )
}
