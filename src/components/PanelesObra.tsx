import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import type { ReporteTrabajadorDia, ReporteCompraDia, ReporteCobroDia, ReporteSubcontratoDia, Trabajador, CuentaPorCobrar, AbonoCuenta, GastoFijo, GastoVariable } from '../types'

// Componentes y cálculos compartidos entre el panel de Admin (Alexandra) y el
// panel de Gustavo — antes vivían duplicados letra por letra en Admin.tsx y
// Gustavo.tsx. Cualquier cambio acá se refleja en los dos paneles a la vez.

export function fmtMoney(n: number) {
  const rounded = Math.round(n)
  return `${rounded < 0 ? '-' : ''}$${Math.abs(rounded).toLocaleString('es-CL')}`
}

export function StatTile({ label, valor, tono = 'neutral' }: { label: string; valor: string; tono?: 'neutral' | 'positivo' | 'negativo' | 'alerta' }) {
  const color = tono === 'positivo' ? 'var(--success)' : tono === 'negativo' ? 'var(--danger)' : tono === 'alerta' ? 'var(--warning)' : 'var(--secondary)'
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

/* ─── Presupuesto editable ──────────────────────────── */
export function EditablePresupuesto({ valor, onGuardar }: { valor: number | null; onGuardar: (monto: number | null) => void }) {
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

/* ─── Cliente de obra editable ──────────────────────── */
export function EditableCliente({ valor, onGuardar }: { valor: string | null; onGuardar: (cliente: string | null) => void }) {
  const [editando, setEditando] = useState(false)
  const [texto, setTexto] = useState(valor || '')

  if (!editando) {
    return (
      <span>
        Cliente: <strong>{valor || 'sin asignar'}</strong>{' '}
        <button
          onClick={() => { setTexto(valor || ''); setEditando(true) }}
          style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 12, color: 'var(--primary)', fontWeight: 600, padding: 0 }}
        >
          ✎ editar
        </button>
      </span>
    )
  }

  function guardar() {
    onGuardar(texto.trim() || null)
    setEditando(false)
  }

  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
      Cliente:
      <input
        type="text"
        autoFocus
        value={texto}
        onChange={e => setTexto(e.target.value)}
        onBlur={guardar}
        onKeyDown={e => { if (e.key === 'Enter') guardar(); if (e.key === 'Escape') setEditando(false) }}
        style={{ width: 160, fontSize: 13, padding: '2px 6px' }}
      />
    </span>
  )
}

/* ─── Cuentas por cobrar ─────────────────────────────── */
export function PanelCuentasPorCobrar() {
  const [cuentas, setCuentas] = useState<CuentaPorCobrar[]>([])
  const [abonos, setAbonos] = useState<AbonoCuenta[]>([])
  const [obrasDisponibles, setObrasDisponibles] = useState<string[]>([])
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

  useEffect(() => {
    supabase.from('obras').select('nombre').eq('activa', true).order('nombre').then(({ data }) => {
      if (data) setObrasDisponibles(data.map((o: { nombre: string }) => o.nombre))
    })
  }, [])

  async function crearCuenta() {
    if (!nuevaCuenta.pagador.trim() || !nuevaCuenta.concepto.trim() || !nuevaCuenta.total_presupuesto.trim()) {
      alert('Completa quién paga, el concepto y el presupuesto total.')
      return
    }
    const monto = Number(nuevaCuenta.total_presupuesto)
    if (!Number.isFinite(monto) || monto <= 0) {
      alert('El presupuesto total tiene que ser un número mayor a cero.')
      return
    }
    const { error } = await supabase.from('cuentas_por_cobrar').insert({
      pagador: nuevaCuenta.pagador.trim(),
      concepto: nuevaCuenta.concepto.trim(),
      obra: nuevaCuenta.obra.trim() || null,
      total_presupuesto: monto,
    })
    if (error) {
      alert('No se pudo guardar la cuenta. Intenta de nuevo.')
      return
    }
    setNuevaCuenta({ pagador: '', concepto: '', obra: '', total_presupuesto: '' })
    setMostrarForm(false)
    cargar()
  }

  async function eliminarCuenta(id: string) {
    if (!window.confirm('¿Seguro que quieres eliminar esta cuenta y todos sus abonos?')) return
    const { error } = await supabase.from('cuentas_por_cobrar').delete().eq('id', id)
    if (error) {
      alert('No se pudo eliminar la cuenta. Intenta de nuevo.')
      return
    }
    cargar()
  }

  async function agregarAbono(cuentaId: string) {
    const datos = nuevoAbono[cuentaId] || { fecha: '', monto: '' }
    if (!datos.fecha.trim() || !datos.monto.trim()) {
      alert('Completa la fecha y el monto del abono.')
      return
    }
    const monto = Number(datos.monto)
    if (!Number.isFinite(monto) || monto <= 0) {
      alert('El monto del abono tiene que ser un número mayor a cero.')
      return
    }
    const { error } = await supabase.from('abonos_cuenta').insert({ cuenta_id: cuentaId, fecha: datos.fecha, monto })
    if (error) {
      alert('No se pudo guardar el abono. Intenta de nuevo.')
      return
    }
    setNuevoAbono(prev => ({ ...prev, [cuentaId]: { fecha: '', monto: '' } }))
    cargar()
  }

  async function eliminarAbono(id: string) {
    if (!window.confirm('¿Seguro que quieres quitar este abono?')) return
    const { error } = await supabase.from('abonos_cuenta').delete().eq('id', id)
    if (error) {
      alert('No se pudo quitar el abono. Intenta de nuevo.')
      return
    }
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
              <select value={nuevaCuenta.obra} onChange={e => setNuevaCuenta(p => ({ ...p, obra: e.target.value }))}>
                <option value="">Sin obra asociada</option>
                {obrasDisponibles.map(o => <option key={o} value={o}>{o}</option>)}
              </select>
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

/* ─── Estado de resultados ───────────────────────────── */
function mesActualISO() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

function todayISOResultados() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Santiago' }).format(new Date())
}

export function PanelEstadoResultados() {
  const [mes, setMes] = useState(mesActualISO())
  const [obraFiltro, setObraFiltro] = useState('')
  const [diarios, setDiarios] = useState<ReporteTrabajadorDia[]>([])
  const [compras, setCompras] = useState<ReporteCompraDia[]>([])
  const [cobros, setCobros] = useState<ReporteCobroDia[]>([])
  const [subcontratos, setSubcontratos] = useState<ReporteSubcontratoDia[]>([])
  const [cuentas, setCuentas] = useState<CuentaPorCobrar[]>([])
  const [abonos, setAbonos] = useState<AbonoCuenta[]>([])
  const [tarifas, setTarifas] = useState<Trabajador[]>([])
  const [gastosFijos, setGastosFijos] = useState<GastoFijo[]>([])
  const [gastosVariables, setGastosVariables] = useState<GastoVariable[]>([])
  const [loading, setLoading] = useState(true)
  const [mostrarGestionGastos, setMostrarGestionGastos] = useState(false)
  const [mostrarGestionGastosVariables, setMostrarGestionGastosVariables] = useState(false)
  const [nuevoGastoFijo, setNuevoGastoFijo] = useState({ concepto: '', categoria: '', monto_mensual: '', vigente_desde: mesActualISO() })
  const [nuevoGastoVariable, setNuevoGastoVariable] = useState({ fecha: todayISOResultados(), categoria: '', descripcion: '', monto: '' })

  useEffect(() => {
    (async () => {
      const [{ data: d }, { data: c }, { data: co }, { data: s }, { data: cu }, { data: ab }, { data: t }, { data: gf }, { data: gv }] = await Promise.all([
        supabase.from('reportes_diarios').select('*'),
        supabase.from('reportes_compras').select('*'),
        supabase.from('reportes_cobros').select('*'),
        supabase.from('reportes_subcontratos').select('*'),
        supabase.from('cuentas_por_cobrar').select('*'),
        supabase.from('abonos_cuenta').select('*'),
        supabase.from('trabajadores').select('*'),
        supabase.from('gastos_fijos').select('*'),
        supabase.from('gastos_variables').select('*'),
      ])
      setDiarios((d as ReporteTrabajadorDia[]) || [])
      setCompras((c as ReporteCompraDia[]) || [])
      setCobros((co as ReporteCobroDia[]) || [])
      setSubcontratos((s as ReporteSubcontratoDia[]) || [])
      setCuentas((cu as CuentaPorCobrar[]) || [])
      setAbonos((ab as AbonoCuenta[]) || [])
      setTarifas((t as Trabajador[]) || [])
      setGastosFijos((gf as GastoFijo[]) || [])
      setGastosVariables((gv as GastoVariable[]) || [])
      setLoading(false)
    })()
  }, [])

  async function recargarGastosFijos() {
    const { data } = await supabase.from('gastos_fijos').select('*')
    setGastosFijos((data as GastoFijo[]) || [])
  }

  async function crearGastoFijo() {
    if (!nuevoGastoFijo.concepto.trim()) {
      alert('Completa el concepto del gasto fijo.')
      return
    }
    const monto = Number(nuevoGastoFijo.monto_mensual)
    if (!Number.isFinite(monto) || monto <= 0) {
      alert('El monto mensual tiene que ser un número mayor a cero.')
      return
    }
    const { error } = await supabase.from('gastos_fijos').insert({
      concepto: nuevoGastoFijo.concepto.trim(),
      categoria: nuevoGastoFijo.categoria.trim() || null,
      monto_mensual: monto,
      activo: true,
      vigente_desde: nuevoGastoFijo.vigente_desde ? `${nuevoGastoFijo.vigente_desde}-01` : null,
    })
    if (error) {
      alert('No se pudo guardar el gasto fijo. Intenta de nuevo.')
      return
    }
    setNuevoGastoFijo({ concepto: '', categoria: '', monto_mensual: '', vigente_desde: mesActualISO() })
    recargarGastosFijos()
  }

  async function toggleActivoGastoFijo(id: string, activo: boolean) {
    const { error } = await supabase.from('gastos_fijos').update({ activo }).eq('id', id)
    if (error) {
      alert('No se pudo actualizar el gasto fijo. Intenta de nuevo.')
      return
    }
    recargarGastosFijos()
  }

  async function recargarGastosVariables() {
    const { data } = await supabase.from('gastos_variables').select('*')
    setGastosVariables((data as GastoVariable[]) || [])
  }

  async function crearGastoVariable() {
    if (!nuevoGastoVariable.fecha.trim() || !nuevoGastoVariable.descripcion.trim()) {
      alert('Completa la fecha y la descripción del gasto.')
      return
    }
    const monto = Number(nuevoGastoVariable.monto)
    if (!Number.isFinite(monto) || monto <= 0) {
      alert('El monto tiene que ser un número mayor a cero.')
      return
    }
    const { error } = await supabase.from('gastos_variables').insert({
      fecha: nuevoGastoVariable.fecha,
      categoria: nuevoGastoVariable.categoria.trim() || null,
      descripcion: nuevoGastoVariable.descripcion.trim(),
      monto,
    })
    if (error) {
      alert('No se pudo guardar el gasto variable. Intenta de nuevo.')
      return
    }
    setNuevoGastoVariable({ fecha: todayISOResultados(), categoria: '', descripcion: '', monto: '' })
    recargarGastosVariables()
  }

  async function eliminarGastoVariable(id: string) {
    if (!window.confirm('¿Seguro que quieres eliminar este gasto?')) return
    const { error } = await supabase.from('gastos_variables').delete().eq('id', id)
    if (error) {
      alert('No se pudo eliminar el gasto. Intenta de nuevo.')
      return
    }
    recargarGastosVariables()
  }

  if (loading) return <div className="spinner" />

  const obras = Array.from(new Set([
    ...diarios.filter(d => d.obra).map(d => d.obra as string),
    ...compras.filter(c => c.obra).map(c => c.obra as string),
    ...cobros.filter(c => c.obra).map(c => c.obra as string),
    ...subcontratos.filter(s => s.obra).map(s => s.obra as string),
  ])).sort()

  const delMes = (fecha: string) => fecha.startsWith(mes)
  const deLaObra = <T extends { obra?: string | null }>(items: T[]) => obraFiltro ? items.filter(i => i.obra === obraFiltro) : items

  const cobrosFiltrados = deLaObra(cobros).filter(c => delMes(c.fecha))
  const ingresosCobros = cobrosFiltrados.reduce((s, c) => s + c.monto, 0)

  const cuentaIdsDeLaObra = obraFiltro ? new Set(cuentas.filter(c => c.obra === obraFiltro).map(c => c.id)) : null
  const abonosFiltrados = abonos.filter(a => delMes(a.fecha) && (!cuentaIdsDeLaObra || cuentaIdsDeLaObra.has(a.cuenta_id)))
  const ingresosAbonos = abonosFiltrados.reduce((s, a) => s + a.monto, 0)
  const ingresos = ingresosCobros + ingresosAbonos

  const costoManoDeObra = deLaObra(diarios).filter(d => d.presente && delMes(d.fecha)).reduce((sum, d) => {
    const t = tarifas.find(x => x.nombre === d.trabajador)
    return sum + d.fraccion_jornada * (t?.tarifa_diaria || 0) + (d.viatico ? (t?.viatico_diario || 0) : 0)
  }, 0)

  const costoMateriales = deLaObra(compras).filter(c => delMes(c.fecha)).reduce((s, c) => s + c.monto, 0)
  const utilidadBruta = ingresos - costoManoDeObra - costoMateriales

  const gastosFijosTotal = obraFiltro ? 0 : gastosFijos.filter(g => g.activo && (!g.vigente_desde || g.vigente_desde.slice(0, 7) <= mes)).reduce((s, g) => s + g.monto_mensual, 0)
  const gastosVariablesTotal = obraFiltro ? 0 : gastosVariables.filter(g => delMes(g.fecha)).reduce((s, g) => s + g.monto, 0)
  const pagosSubcontratistas = deLaObra(subcontratos).filter(s => delMes(s.fecha)).reduce((s, x) => s + x.monto, 0)

  const resultado = utilidadBruta - gastosFijosTotal - gastosVariablesTotal - pagosSubcontratistas

  return (
    <div>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 20 }}>
        <div className="field" style={{ maxWidth: 220 }}>
          <label>Mes</label>
          <input type="month" value={mes} onChange={e => setMes(e.target.value)} />
        </div>
        <div className="field" style={{ maxWidth: 280 }}>
          <label>Obra</label>
          <select value={obraFiltro} onChange={e => setObraFiltro(e.target.value)}>
            <option value="">Todas las obras (consolidado)</option>
            {obras.map(o => <option key={o} value={o}>{o}</option>)}
          </select>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 20 }}>
        <StatTile label="Ingresos del mes" valor={fmtMoney(ingresos)} tono="positivo" />
        <StatTile label="Costo mano de obra" valor={fmtMoney(costoManoDeObra)} />
        <StatTile label="Costo materiales" valor={fmtMoney(costoMateriales)} />
        <StatTile label="Utilidad bruta operativa" valor={fmtMoney(utilidadBruta)} tono={utilidadBruta >= 0 ? 'positivo' : 'negativo'} />
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 20 }}>
        <StatTile label="Gastos fijos" valor={obraFiltro ? 'No aplica' : fmtMoney(gastosFijosTotal)} tono={obraFiltro ? 'alerta' : 'neutral'} />
        <StatTile label="Gastos variables" valor={obraFiltro ? 'No aplica' : fmtMoney(gastosVariablesTotal)} tono={obraFiltro ? 'alerta' : 'neutral'} />
        <StatTile label="Pagos a subcontratistas" valor={fmtMoney(pagosSubcontratistas)} />
      </div>

      <div style={{ marginBottom: 20 }}>
        <button className="btn btn-secondary" onClick={() => setMostrarGestionGastos(x => !x)} style={{ fontSize: 12 }}>
          {mostrarGestionGastos ? 'Ocultar gastos fijos' : 'Gestionar gastos fijos'}
        </button>

        {mostrarGestionGastos && (
          <div className="card" style={{ padding: 16, marginTop: 10 }}>
            {gastosFijos.length === 0 ? (
              <p style={{ color: 'var(--muted)', fontSize: 13, marginBottom: 12 }}>Sin gastos fijos registrados todavía.</p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 16 }}>
                {gastosFijos.map(g => (
                  <div key={g.id} style={{ display: 'flex', alignItems: 'center', gap: 10, background: 'var(--bg)', borderRadius: 8, padding: '8px 12px', fontSize: 13, opacity: g.activo ? 1 : 0.5 }}>
                    <span style={{ flex: 1 }}>{g.concepto}{g.categoria ? ` · ${g.categoria}` : ''}</span>
                    <span style={{ color: 'var(--muted)', fontSize: 12 }}>{g.vigente_desde ? `desde ${g.vigente_desde.slice(0, 7)}` : 'desde siempre'}</span>
                    <span style={{ fontWeight: 700 }}>{fmtMoney(g.monto_mensual)}</span>
                    <button onClick={() => toggleActivoGastoFijo(g.id, !g.activo)} className="btn btn-ghost" style={{ fontSize: 11, padding: '3px 8px' }}>
                      {g.activo ? 'Desactivar' : 'Reactivar'}
                    </button>
                  </div>
                ))}
              </div>
            )}

            <p style={{ fontSize: 12, fontWeight: 700, color: 'var(--secondary)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 8 }}>Nuevo gasto fijo</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div className="field">
                <label>Concepto</label>
                <input type="text" placeholder="Ej: Sueldo fijo Fabriel" value={nuevoGastoFijo.concepto} onChange={e => setNuevoGastoFijo(p => ({ ...p, concepto: e.target.value }))} />
              </div>
              <div className="field">
                <label>Categoría (opcional)</label>
                <input type="text" placeholder="Ej: Sueldo" value={nuevoGastoFijo.categoria} onChange={e => setNuevoGastoFijo(p => ({ ...p, categoria: e.target.value }))} />
              </div>
              <div className="field">
                <label>Monto mensual</label>
                <input type="number" min="0" placeholder="Monto en pesos" value={nuevoGastoFijo.monto_mensual} onChange={e => setNuevoGastoFijo(p => ({ ...p, monto_mensual: e.target.value }))} />
              </div>
              <div className="field">
                <label>Rige desde (opcional)</label>
                <input type="month" value={nuevoGastoFijo.vigente_desde} onChange={e => setNuevoGastoFijo(p => ({ ...p, vigente_desde: e.target.value }))} />
                <span style={{ fontSize: 11, color: 'var(--muted)' }}>Si lo dejas vacío, el gasto va a contar en todos los meses, incluidos los anteriores a hoy.</span>
              </div>
              <button className="btn btn-primary" onClick={crearGastoFijo}>Guardar gasto fijo</button>
            </div>
          </div>
        )}
      </div>

      <div style={{ marginBottom: 20 }}>
        <button className="btn btn-secondary" onClick={() => setMostrarGestionGastosVariables(x => !x)} style={{ fontSize: 12 }}>
          {mostrarGestionGastosVariables ? 'Ocultar gastos variables' : 'Gestionar gastos variables'}
        </button>

        {mostrarGestionGastosVariables && (
          <div className="card" style={{ padding: 16, marginTop: 10 }}>
            {gastosVariables.filter(g => delMes(g.fecha)).length === 0 ? (
              <p style={{ color: 'var(--muted)', fontSize: 13, marginBottom: 12 }}>Sin gastos variables registrados este mes.</p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 16 }}>
                {gastosVariables.filter(g => delMes(g.fecha)).sort((a, b) => b.fecha.localeCompare(a.fecha)).map(g => (
                  <div key={g.id} style={{ display: 'flex', alignItems: 'center', gap: 10, background: 'var(--bg)', borderRadius: 8, padding: '8px 12px', fontSize: 13 }}>
                    <span style={{ color: 'var(--muted)', fontSize: 12, width: 78, flexShrink: 0 }}>{g.fecha.split('-').reverse().join('/')}</span>
                    <span style={{ flex: 1 }}>{g.descripcion}{g.categoria ? ` · ${g.categoria}` : ''}</span>
                    <span style={{ fontWeight: 700 }}>{fmtMoney(g.monto)}</span>
                    <button onClick={() => eliminarGastoVariable(g.id)} className="btn btn-ghost" style={{ fontSize: 11, padding: '3px 8px' }}>Eliminar</button>
                  </div>
                ))}
              </div>
            )}

            <p style={{ fontSize: 12, fontWeight: 700, color: 'var(--secondary)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 8 }}>Nuevo gasto variable</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div className="field">
                <label>Fecha</label>
                <input type="date" value={nuevoGastoVariable.fecha} onChange={e => setNuevoGastoVariable(p => ({ ...p, fecha: e.target.value }))} />
              </div>
              <div className="field">
                <label>Descripción</label>
                <input type="text" placeholder="Ej: Impuestos julio" value={nuevoGastoVariable.descripcion} onChange={e => setNuevoGastoVariable(p => ({ ...p, descripcion: e.target.value }))} />
              </div>
              <div className="field">
                <label>Categoría (opcional)</label>
                <input type="text" placeholder="Ej: Impuestos" value={nuevoGastoVariable.categoria} onChange={e => setNuevoGastoVariable(p => ({ ...p, categoria: e.target.value }))} />
              </div>
              <div className="field">
                <label>Monto</label>
                <input type="number" min="0" placeholder="Monto en pesos" value={nuevoGastoVariable.monto} onChange={e => setNuevoGastoVariable(p => ({ ...p, monto: e.target.value }))} />
              </div>
              <button className="btn btn-primary" onClick={crearGastoVariable}>Guardar gasto variable</button>
            </div>
          </div>
        )}
      </div>

      <div className="card" style={{ padding: '20px 24px', borderTop: `4px solid ${resultado >= 0 ? 'var(--success)' : 'var(--danger)'}` }}>
        <p className="font-display" style={{ fontSize: 12, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.6px', marginBottom: 6 }}>
          {obraFiltro ? `Utilidad operativa (sin gastos generales) — ${obraFiltro}` : 'Resultado del mes'}
        </p>
        <p className="font-display" style={{ fontSize: 32, fontWeight: 700, color: resultado >= 0 ? 'var(--success)' : 'var(--danger)', fontVariantNumeric: 'tabular-nums' }}>
          {fmtMoney(resultado)}
        </p>
      </div>

      <p style={{ fontSize: 12, color: 'var(--muted)', marginTop: 16 }}>
        Ingresos = cobros registrados + abonos de cuentas por cobrar del mes. Costo mano de obra, materiales, gastos variables y pagos a subcontratistas son en base caja (lo que pasó ese mes). Gastos fijos es el monto mensual completo, sin importar el día en que caiga.
        {obraFiltro && ' Al ver una obra específica, los gastos fijos y variables no se incluyen porque son de toda la empresa, no de una obra en particular — para verlos, selecciona "Todas las obras".'}
      </p>
    </div>
  )
}

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

  // vista === 'dia': cada fecha es su propio período
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
  { titulo: 'Por reembolsar', texto: 'Compras que un trabajador pagó con su propia plata y que la empresa todavía le tiene que devolver.' },
]

export function GuiaObras({ onClose }: { onClose: () => void }) {
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

/* ─── Pago semanal a trabajadores (todas las obras) ──── */
export function PanelPagoSemanal() {
  const [diarios, setDiarios] = useState<ReporteTrabajadorDia[]>([])
  const [tarifas, setTarifas] = useState<Trabajador[]>([])
  const [loading, setLoading] = useState(true)
  const [semanaKey, setSemanaKey] = useState('')

  const cargar = useCallback(async () => {
    const [{ data: d }, { data: t }] = await Promise.all([
      supabase.from('reportes_diarios').select('*'),
      supabase.from('trabajadores').select('*'),
    ])
    setDiarios((d as ReporteTrabajadorDia[]) || [])
    setTarifas((t as Trabajador[]) || [])
    setLoading(false)
  }, [])

  useEffect(() => { cargar() }, [cargar])

  // Refresco automático mientras la pestaña está abierta, para que se vea
  // actualizado a medida que Gustavo va cargando el reporte diario.
  useEffect(() => {
    const id = setInterval(cargar, 20000)
    return () => clearInterval(id)
  }, [cargar])

  if (loading) return <div className="spinner" />

  const semanas = agruparPorPeriodo('semana', diarios, [], [], [])
  if (semanas.length === 0) {
    return <p style={{ color: 'var(--muted)', fontSize: 14 }}>Todavía no hay reportes diarios cargados.</p>
  }
  const semana = semanas.find(s => s.key === semanaKey) || semanas.find(s => s.enCurso) || semanas[0]

  const filas = tarifas
    .map(t => {
      const diasPresentes = semana.diarios.filter(d => d.trabajador === t.nombre && d.presente)
      const dias = diasPresentes.reduce((s, d) => s + d.fraccion_jornada, 0)
      const sueldoFijo = t.tarifa_diaria === 0
      const ganado = sueldoFijo ? 0 : diasPresentes.reduce((s, d) => s + d.fraccion_jornada * t.tarifa_diaria, 0)
      const viatico = diasPresentes.reduce((s, d) => s + (d.viatico ? t.viatico_diario : 0), 0)
      return { trabajador: t.nombre, sueldoFijo, dias, ganado, viatico, total: ganado + viatico }
    })
    .filter(f => f.dias > 0)

  const totalSemana = filas.reduce((s, f) => s + f.total, 0)
  const haySueldoFijo = filas.some(f => f.sueldoFijo)

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, fontWeight: 600, color: 'var(--secondary)' }}>
          Semana:
          <select
            value={semana.key}
            onChange={e => setSemanaKey(e.target.value)}
            style={{
              width: 'auto', padding: '6px 10px', fontSize: 13, fontWeight: 600, borderRadius: 6,
              border: '1.5px solid var(--primary)', background: 'var(--white)', color: 'var(--secondary)',
              cursor: 'pointer', appearance: 'auto',
            }}
          >
            {semanas.map(s => (
              <option key={s.key} value={s.key}>{s.label}{s.enCurso ? ' (en curso)' : ''}</option>
            ))}
          </select>
        </label>
        <button
          onClick={cargar}
          style={{ padding: '6px 10px', fontSize: 12, fontWeight: 600, borderRadius: 6, border: '1px solid var(--border)', background: 'var(--white)', cursor: 'pointer', color: 'var(--muted)' }}
        >↻ Actualizar</button>
      </div>

      <div style={{ marginBottom: 18 }}>
        <StatTile label="Total a pagar esa semana" valor={fmtMoney(totalSemana)} tono="alerta" />
      </div>

      {filas.length === 0 ? (
        <p style={{ color: 'var(--muted)', fontSize: 14 }}>Nadie tiene actividad reportada esa semana.</p>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ borderBottom: '2px solid var(--border)' }}>
                <th style={{ textAlign: 'left', padding: '8px 10px', color: 'var(--muted)', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.5px' }}>Nombre</th>
                <th style={{ textAlign: 'right', padding: '8px 10px', color: 'var(--muted)', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.5px' }}>Días</th>
                <th style={{ textAlign: 'right', padding: '8px 10px', color: 'var(--muted)', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.5px' }}>Ganado</th>
                <th style={{ textAlign: 'right', padding: '8px 10px', color: 'var(--muted)', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.5px' }}>Viático</th>
                <th style={{ textAlign: 'right', padding: '8px 10px', color: 'var(--muted)', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.5px' }}>Total</th>
              </tr>
            </thead>
            <tbody>
              {filas.map(f => (
                <tr key={f.trabajador} style={{ borderBottom: '1px solid var(--border)' }}>
                  <td style={{ padding: '10px', fontWeight: 700 }}>
                    {f.trabajador}
                    {f.sueldoFijo && (
                      <span style={{ marginLeft: 8, fontSize: 10, fontWeight: 600, color: 'var(--muted)', background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 4, padding: '2px 6px' }}>
                        Sueldo fijo
                      </span>
                    )}
                  </td>
                  <td style={{ padding: '10px', textAlign: 'right' }}>{f.dias}</td>
                  <td style={{ padding: '10px', textAlign: 'right' }}>{f.sueldoFijo ? '—' : fmtMoney(f.ganado)}</td>
                  <td style={{ padding: '10px', textAlign: 'right' }}>{f.viatico > 0 ? fmtMoney(f.viatico) : '—'}</td>
                  <td style={{ padding: '10px', textAlign: 'right', fontWeight: 700, color: 'var(--secondary)' }}>{fmtMoney(f.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {haySueldoFijo && (
        <p style={{ fontSize: 12, color: 'var(--muted)', marginTop: 14 }}>
          Los trabajadores marcados "Sueldo fijo" tienen mensualidad fija (ver Gastos Fijos en Estado de Resultados) — acá solo se refleja su viático de esa semana, no un cálculo por día.
        </p>
      )}
    </div>
  )
}

/* ─── Bloque de contenido de un período (reutilizable) ── */
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

/* ─── Fila de período colapsable ─────────────────────── */
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

export function HistorialObraModal({
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
