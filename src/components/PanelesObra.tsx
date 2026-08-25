import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import type { ReporteTrabajadorDia, ReporteCompraDia, ReporteCobroDia, ReporteSubcontratoDia, ReporteTrabajoPuntualDia, Trabajador, CuentaPorCobrar, AbonoCuenta, GastoFijo, GastoVariable, Obra, SubcontratoMaster, PresupuestoGuardado, PresupuestoDetalle, EstadoPresupuesto, EstadoObra, ObraMedia } from '../types'

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

/* ─── Obras (En curso / Culminadas) ──────────────────── */
const ESTADO_OBRA_LABELS: Record<EstadoObra, string> = {
  en_curso: 'En curso',
  terminada_terreno: 'Terminada en terreno',
  facturada: 'Facturada',
  en_garantia: 'En garantía',
  cerrada: 'Cerrada',
}

export function PanelObras() {
  const [diarios, setDiarios] = useState<ReporteTrabajadorDia[]>([])
  const [compras, setCompras] = useState<ReporteCompraDia[]>([])
  const [cobros, setCobros] = useState<ReporteCobroDia[]>([])
  const [subcontratos, setSubcontratos] = useState<ReporteSubcontratoDia[]>([])
  const [obrasMaestro, setObrasMaestro] = useState<Obra[]>([])
  const [trabajadoresTarifas, setTrabajadoresTarifas] = useState<Trabajador[]>([])
  const [subcontratosMaster, setSubcontratosMaster] = useState<SubcontratoMaster[]>([])
  const [cuentas, setCuentas] = useState<CuentaPorCobrar[]>([])
  const [abonos, setAbonos] = useState<AbonoCuenta[]>([])
  const [loading, setLoading] = useState(true)
  const [vista, setVista] = useState<'curso' | 'culminadas'>('curso')
  const [historialObra, setHistorialObra] = useState<string | null>(null)
  const [mostrarGuia, setMostrarGuia] = useState(false)
  const [mostrarNuevaObra, setMostrarNuevaObra] = useState(false)
  const [nuevaObra, setNuevaObra] = useState({ nombre: '', cliente: '', presupuesto_total: '', presupuesto_id: '' })
  const [modoExcepcion, setModoExcepcion] = useState(false)
  const [presupuestosAceptados, setPresupuestosAceptados] = useState<PresupuestoGuardado[]>([])
  const [mostrarNuevaCuentaSuelta, setMostrarNuevaCuentaSuelta] = useState(false)
  const [nuevaCuentaSuelta, setNuevaCuentaSuelta] = useState({ pagador: '', concepto: '', total_presupuesto: '' })

  useEffect(() => {
    if (!localStorage.getItem('horma_guia_obras_vista')) {
      setMostrarGuia(true)
      localStorage.setItem('horma_guia_obras_vista', '1')
    }
  }, [])

  const cargar = useCallback(async () => {
    const [{ data: d }, { data: c }, { data: co }, { data: s }, { data: m }, { data: t }, { data: sm }, { data: cu }, { data: ab }, { data: pa }] = await Promise.all([
      supabase.from('reportes_diarios').select('*'),
      supabase.from('reportes_compras').select('*'),
      supabase.from('reportes_cobros').select('*'),
      supabase.from('reportes_subcontratos').select('*'),
      supabase.from('obras').select('*').order('nombre'),
      supabase.from('trabajadores').select('*'),
      supabase.from('subcontratos_master').select('*'),
      supabase.from('cuentas_por_cobrar').select('*'),
      supabase.from('abonos_cuenta').select('*'),
      supabase.from('presupuestos')
        .select('id, created_at, cliente_id, cliente_nombre, cliente_telefono, cliente_email, cliente_direccion, referencia, tipo, estado, subtotal, iva, total')
        .eq('estado', 'aceptado')
        .order('created_at', { ascending: false }),
    ])
    setDiarios((d as ReporteTrabajadorDia[]) || [])
    setCompras((c as ReporteCompraDia[]) || [])
    setCobros((co as ReporteCobroDia[]) || [])
    setSubcontratos((s as ReporteSubcontratoDia[]) || [])
    setObrasMaestro((m as Obra[]) || [])
    setTrabajadoresTarifas((t as Trabajador[]) || [])
    setSubcontratosMaster((sm as SubcontratoMaster[]) || [])
    setCuentas((cu as CuentaPorCobrar[]) || [])
    setAbonos((ab as AbonoCuenta[]) || [])
    setPresupuestosAceptados((pa as PresupuestoGuardado[]) || [])
    setLoading(false)
  }, [])

  useEffect(() => { cargar() }, [cargar])

  async function guardarPresupuesto(obraId: string, monto: number | null) {
    await supabase.from('obras').update({ presupuesto_total: monto }).eq('id', obraId)
    cargar()
  }

  async function guardarCliente(obraId: string, cliente: string | null) {
    await supabase.from('obras').update({ cliente }).eq('id', obraId)
    cargar()
  }

  async function cambiarEstadoObra(obraId: string, estado_obra: EstadoObra) {
    await supabase.from('obras').update({ estado_obra }).eq('id', obraId)
    cargar()
  }

  async function guardarFechaObra(obraId: string, campo: 'fecha_inicio' | 'fecha_fin' | 'garantia_hasta', valor: string) {
    await supabase.from('obras').update({ [campo]: valor || null }).eq('id', obraId)
    cargar()
  }

  async function marcarReembolsado(compraId: string, reembolsado: boolean) {
    await supabase.from('reportes_compras').update({ reembolsado }).eq('id', compraId)
    cargar()
  }

  async function crearObra() {
    if (!nuevaObra.nombre.trim()) {
      alert('Completa el nombre de la obra.')
      return
    }

    if (!modoExcepcion) {
      // Camino normal (gate de la tarea 2.3): toda obra nueva nace de un presupuesto ya
      // aceptado, así el cliente y el monto no se vuelven a escribir a mano y quedan
      // vinculados de verdad -- ver decisiones.md 2026-08-25.
      if (!nuevaObra.presupuesto_id) {
        alert('Elegí el presupuesto aceptado del que nace esta obra.')
        return
      }
      const presupuesto = presupuestosAceptados.find(p => p.id === nuevaObra.presupuesto_id)
      if (!presupuesto) {
        alert('Ese presupuesto ya no está disponible (puede que otra obra ya lo haya usado). Recargá la lista.')
        return
      }
      const { error } = await supabase.from('obras').insert({
        nombre: nuevaObra.nombre.trim(),
        cliente: presupuesto.cliente_nombre,
        presupuesto_total: presupuesto.total,
        presupuesto_id: presupuesto.id,
      })
      if (error) {
        alert('No se pudo crear la obra. Puede que ya exista una con ese nombre.')
        return
      }
      await supabase.from('presupuestos').update({ estado: 'convertido' }).eq('id', presupuesto.id)
    } else {
      // Excepción: crear sin presupuesto vinculado -- confirmado por Alexandra el 25/08 como
      // salida de emergencia, para no quedar bloqueada un día con apuro real sin ningún
      // presupuesto marcado "Aceptado" todavía.
      let presupuestoManual: number | null = null
      if (nuevaObra.presupuesto_total.trim()) {
        presupuestoManual = Number(nuevaObra.presupuesto_total)
        if (!Number.isFinite(presupuestoManual) || presupuestoManual <= 0) {
          alert('El presupuesto total tiene que ser un número mayor a cero.')
          return
        }
      }
      if (!window.confirm('¿Seguro que querés crear esta obra SIN vincularla a un presupuesto? Es la excepción -- lo normal es elegir uno de la lista.')) return
      const { error } = await supabase.from('obras').insert({
        nombre: nuevaObra.nombre.trim(),
        cliente: nuevaObra.cliente.trim() || null,
        presupuesto_total: presupuestoManual,
      })
      if (error) {
        alert('No se pudo crear la obra. Puede que ya exista una con ese nombre.')
        return
      }
    }

    setNuevaObra({ nombre: '', cliente: '', presupuesto_total: '', presupuesto_id: '' })
    setModoExcepcion(false)
    setMostrarNuevaObra(false)
    cargar()
  }

  async function crearCuenta(pagador: string, concepto: string, obra: string | null, total: number) {
    const { error } = await supabase.from('cuentas_por_cobrar').insert({ pagador, concepto, obra, total_presupuesto: total })
    if (error) {
      alert('No se pudo guardar la cuenta. Intenta de nuevo.')
      return
    }
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

  async function agregarAbono(cuentaId: string, fecha: string, monto: number) {
    const { error } = await supabase.from('abonos_cuenta').insert({ cuenta_id: cuentaId, fecha, monto })
    if (error) {
      alert('No se pudo guardar el abono. Intenta de nuevo.')
      return
    }
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

  const nombres = Array.from(new Set([
    ...obrasMaestro.map(o => o.nombre),
    ...diarios.filter(d => d.presente && d.obra).map(d => d.obra as string),
    ...compras.filter(c => c.obra).map(c => c.obra as string),
    ...cobros.filter(c => c.obra).map(c => c.obra as string),
    ...subcontratos.filter(s => s.obra).map(s => s.obra as string),
    ...cuentas.filter(c => c.obra).map(c => c.obra as string),
  ]))

  const resumen = nombres.map(obra => {
    const maestro = obrasMaestro.find(o => o.nombre === obra)
    const diariosObra = diarios.filter(d => d.obra === obra && d.presente)
    const comprasObra = compras.filter(c => c.obra === obra)
    const cobrosObra = cobros.filter(c => c.obra === obra)
    const subcontratosObra = subcontratos.filter(s => s.obra === obra)
    // Plata cobrada por esta obra vía el sistema manual de cuentas por cobrar
    // (cuenta.obra === esta obra) — sin esto, obras como "Doctora Eloísa 5860"
    // muestran Cobrado $0 aunque ya se hayan recibido varios abonos, porque esos
    // abonos viven en abonos_cuenta, no en reportes_cobros.
    const cuentasObra = cuentas.filter(c => c.obra === obra)
    const cuentaIdsObra = new Set(cuentasObra.map(c => c.id))
    const cobradoManual = abonos.filter(a => cuentaIdsObra.has(a.cuenta_id)).reduce((sum, a) => sum + a.monto, 0)
    // Lo mismo que "Pendiente" en la pestaña Cuentas por cobrar, sumado — para
    // que Gustavo vea el mismo número acá sin tener que abrir otra pestaña y
    // hacer la cuenta él mismo. Si la obra tiene cuenta(s) manual(es), se suma
    // el restante de esas; si no, se usa presupuesto de la obra menos cobrado.
    const pendienteManual = cuentasObra.reduce((sum, c) => {
      const abonadoCuenta = abonos.filter(a => a.cuenta_id === c.id).reduce((s, a) => s + a.monto, 0)
      return sum + Math.max(c.total_presupuesto - abonadoCuenta, 0)
    }, 0)

    const gastoCompras = comprasObra.reduce((sum, c) => sum + c.monto, 0)
    const contratosObra = subcontratosMaster.filter(s => s.obra === obra)
    const gastoSubcontratos = contratosObra.length > 0
      ? contratosObra.reduce((sum, s) => sum + s.total_contrato, 0)
      : subcontratosObra.reduce((sum, s) => sum + s.monto, 0)
    const pagadoSubcontratos = subcontratosObra.reduce((sum, s) => sum + s.monto, 0)
    const adelantos = diariosObra.filter(d => d.tipo_pago !== 'pago_semanal').reduce((sum, d) => sum + (d.adelanto_monto || 0), 0)
    const pagosSemanales = diariosObra.filter(d => d.tipo_pago === 'pago_semanal').reduce((sum, d) => sum + (d.adelanto_monto || 0), 0)
    const manoDeObra = diariosObra.reduce((sum, d) => {
      const tarifa = trabajadoresTarifas.find(t => t.nombre === d.trabajador)
      const base = d.fraccion_jornada * (tarifa?.tarifa_diaria || 0)
      const viaticoMonto = d.viatico ? (tarifa?.viatico_diario || 0) : 0
      return sum + base + viaticoMonto
    }, 0)
    const porReembolsar = comprasObra.filter(c => c.pagado_por && !c.reembolsado).reduce((sum, c) => sum + c.monto, 0)
    const cobrado = cobrosObra.reduce((sum, c) => sum + c.monto, 0) + cobradoManual
    const saldo = cobrado - gastoCompras - pagadoSubcontratos - adelantos - pagosSemanales
    // Si la obra tiene cuenta(s) por cobrar, el presupuesto real es la SUMA de
    // esas cuentas — no el campo suelto de la obra, que puede quedar
    // desactualizado (ej. alguien lo edita a mano reflejando solo una parte,
    // como paso con Luis Carrera). Con cuenta(s), ese campo pasa a ser de solo
    // lectura — se edita cuenta por cuenta desde Cuentas por cobrar.
    const tieneCuentas = cuentasObra.length > 0
    const presupuestoTotal = tieneCuentas
      ? cuentasObra.reduce((sum, c) => sum + c.total_presupuesto, 0)
      : (maestro?.presupuesto_total ?? null)
    const activa = maestro?.activa ?? true
    const estadoObra = maestro?.estado_obra ?? 'en_curso'
    const faltaPorCobrar = tieneCuentas
      ? pendienteManual
      : (presupuestoTotal != null ? Math.max(presupuestoTotal - cobrado, 0) : null)

    return {
      obra, obraId: maestro?.id, activa, estadoObra,
      fechaInicio: maestro?.fecha_inicio ?? null, fechaFin: maestro?.fecha_fin ?? null, garantiaHasta: maestro?.garantia_hasta ?? null,
      tieneCuentas, cliente: maestro?.cliente ?? null, presupuestoTotal, gastoCompras, gastoSubcontratos, pagadoSubcontratos, manoDeObra, adelantos, pagosSemanales, porReembolsar, cobrado, cobradoManual, saldo, faltaPorCobrar,
    }
  })

  const enCurso = resumen.filter(o => o.activa)
  const culminadas = resumen.filter(o => !o.activa)
  const resumenVisible = vista === 'curso' ? enCurso : culminadas

  const obrasIdsConPresupuesto = new Set(obrasMaestro.filter(o => o.presupuesto_id).map(o => o.presupuesto_id))
  const presupuestosDisponibles = presupuestosAceptados.filter(p => !obrasIdsConPresupuesto.has(p.id))

  const formNuevaObra = (
    <div className="card" style={{ padding: 16, marginBottom: 20 }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div className="field">
          <label>Nombre de la obra</label>
          <input type="text" placeholder="Ej: Luz 2979" value={nuevaObra.nombre} onChange={e => setNuevaObra(p => ({ ...p, nombre: e.target.value }))} />
        </div>

        {!modoExcepcion ? (
          <>
            <div className="field">
              <label>Presupuesto aceptado</label>
              {presupuestosDisponibles.length === 0 ? (
                <p style={{ fontSize: 12, color: 'var(--muted)' }}>
                  No hay presupuestos marcados "Aceptado" todavía sin usar — marcá uno en "Mis presupuestos", o usá la excepción de abajo.
                </p>
              ) : (
                <select
                  value={nuevaObra.presupuesto_id}
                  onChange={e => {
                    const id = e.target.value
                    const p = presupuestosDisponibles.find(x => x.id === id)
                    setNuevaObra(prev => ({
                      ...prev,
                      presupuesto_id: id,
                      nombre: prev.nombre || p?.cliente_direccion || p?.cliente_nombre || '',
                    }))
                  }}
                >
                  <option value="">Selecciona...</option>
                  {presupuestosDisponibles.map(p => (
                    <option key={p.id} value={p.id}>
                      {p.cliente_nombre || 'Sin nombre'} — {fmtMoney(p.total || 0)}{p.referencia ? ` (${p.referencia})` : ''}
                    </option>
                  ))}
                </select>
              )}
            </div>
            <button
              type="button"
              onClick={() => setModoExcepcion(true)}
              style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 12, color: 'var(--muted)', textAlign: 'left', padding: 0 }}
            >
              Crear sin presupuesto (excepción) →
            </button>
          </>
        ) : (
          <>
            <p style={{ fontSize: 12, color: 'var(--muted)' }}>
              Excepción: esta obra no queda vinculada a ningún presupuesto real. Usalo solo si hace falta crearla ya y todavía no hay un presupuesto aceptado para elegir.
            </p>
            <div className="field">
              <label>Cliente (opcional)</label>
              <input type="text" placeholder="Ej: Cristian M" value={nuevaObra.cliente} onChange={e => setNuevaObra(p => ({ ...p, cliente: e.target.value }))} />
            </div>
            <div className="field">
              <label>Presupuesto total (opcional)</label>
              <input type="number" min="0" placeholder="Monto en pesos" value={nuevaObra.presupuesto_total} onChange={e => setNuevaObra(p => ({ ...p, presupuesto_total: e.target.value }))} />
            </div>
            <button
              type="button"
              onClick={() => setModoExcepcion(false)}
              style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 12, color: 'var(--muted)', textAlign: 'left', padding: 0 }}
            >
              ← Volver a elegir un presupuesto
            </button>
          </>
        )}

        <button className="btn btn-primary" onClick={crearObra}>Guardar obra</button>
      </div>
    </div>
  )

  const porCliente = Object.entries(
    resumenVisible.reduce<Record<string, typeof resumenVisible>>((acc, o) => {
      const key = o.cliente || 'Sin cliente asignado'
      if (!acc[key]) acc[key] = []
      acc[key].push(o)
      return acc
    }, {})
  ).sort(([a], [b]) => (a === 'Sin cliente asignado' ? 1 : b === 'Sin cliente asignado' ? -1 : a.localeCompare(b)))

  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14, flexWrap: 'wrap', gap: 10 }}>
        <div style={{ display: 'flex', gap: 6 }}>
          <button
            onClick={() => setVista('curso')}
            style={{
              padding: '6px 14px', fontSize: 13, fontWeight: 700, borderRadius: 20, cursor: 'pointer',
              border: `1.5px solid ${vista === 'curso' ? 'var(--primary)' : 'var(--border)'}`,
              background: vista === 'curso' ? 'var(--primary)' : 'var(--white)',
              color: vista === 'curso' ? '#fff' : 'var(--muted)',
            }}
          >En curso ({enCurso.length})</button>
          <button
            onClick={() => setVista('culminadas')}
            style={{
              padding: '6px 14px', fontSize: 13, fontWeight: 700, borderRadius: 20, cursor: 'pointer',
              border: `1.5px solid ${vista === 'culminadas' ? 'var(--success)' : 'var(--border)'}`,
              background: vista === 'culminadas' ? 'var(--success)' : 'var(--white)',
              color: vista === 'culminadas' ? '#fff' : 'var(--muted)',
            }}
          >Culminadas ({culminadas.length})</button>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button className="btn btn-secondary" onClick={() => setMostrarNuevaObra(x => !x)} style={{ fontSize: 13 }}>
            {mostrarNuevaObra ? 'Cancelar' : '+ Nueva obra'}
          </button>
          <button className="btn btn-secondary" onClick={() => setMostrarNuevaCuentaSuelta(x => !x)} style={{ fontSize: 13 }}>
            {mostrarNuevaCuentaSuelta ? 'Cancelar' : '+ Cobro suelto (sin obra)'}
          </button>
          <button className="btn btn-secondary" onClick={() => setMostrarGuia(true)} style={{ fontSize: 13 }}>
            ¿Cómo se lee esto?
          </button>
        </div>
      </div>

      {mostrarNuevaObra && formNuevaObra}
      {mostrarNuevaCuentaSuelta && (
        <div className="card" style={{ padding: 16, marginBottom: 20 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <p style={{ fontSize: 12, color: 'var(--muted)' }}>Para cobros que no corresponden a ninguna obra — ej. una visita técnica.</p>
            <div className="field">
              <label>¿Quién paga?</label>
              <input type="text" placeholder="Ej: Ignacio" value={nuevaCuentaSuelta.pagador} onChange={e => setNuevaCuentaSuelta(p => ({ ...p, pagador: e.target.value }))} />
            </div>
            <div className="field">
              <label>Concepto</label>
              <input type="text" placeholder="Ej: Visita técnica" value={nuevaCuentaSuelta.concepto} onChange={e => setNuevaCuentaSuelta(p => ({ ...p, concepto: e.target.value }))} />
            </div>
            <div className="field">
              <label>Monto</label>
              <input type="number" min="0" placeholder="Monto en pesos" value={nuevaCuentaSuelta.total_presupuesto} onChange={e => setNuevaCuentaSuelta(p => ({ ...p, total_presupuesto: e.target.value }))} />
            </div>
            <button
              className="btn btn-primary"
              onClick={() => {
                if (!nuevaCuentaSuelta.pagador.trim() || !nuevaCuentaSuelta.concepto.trim() || !nuevaCuentaSuelta.total_presupuesto.trim()) { alert('Completa quién paga, el concepto y el monto.'); return }
                const monto = Number(nuevaCuentaSuelta.total_presupuesto)
                if (!Number.isFinite(monto) || monto <= 0) { alert('El monto tiene que ser un número mayor a cero.'); return }
                crearCuenta(nuevaCuentaSuelta.pagador.trim(), nuevaCuentaSuelta.concepto.trim(), null, monto)
                setNuevaCuentaSuelta({ pagador: '', concepto: '', total_presupuesto: '' })
                setMostrarNuevaCuentaSuelta(false)
              }}
            >Guardar</button>
          </div>
        </div>
      )}
      {mostrarGuia && <GuiaObras onClose={() => setMostrarGuia(false)} />}

      {resumenVisible.length === 0 ? (
        <p style={{ color: 'var(--muted)', textAlign: 'center', padding: '2rem 0' }}>
          {vista === 'curso' ? 'Sin obras en curso.' : 'Todavía no hay obras marcadas como culminadas.'}
        </p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          {porCliente.map(([cliente, obras]) => (
            <div key={cliente}>
              <p className="font-display" style={{ fontSize: 12, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.8px', marginBottom: 8, paddingBottom: 6, borderBottom: '1px solid var(--border)' }}>
                {cliente}
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {obras.map(o => (
                  <div key={o.obra} className="card" style={{ padding: '16px 18px', borderTop: `3px solid ${o.saldo >= 0 ? 'var(--success)' : 'var(--danger)'}` }}>
                    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, marginBottom: 10, flexWrap: 'wrap' }}>
                      <p className="font-serif" style={{ fontSize: 21, flex: 1, color: 'var(--secondary)' }}>{o.obra}</p>
                      {o.obraId && (
                        <select
                          value={o.estadoObra}
                          onChange={e => cambiarEstadoObra(o.obraId as string, e.target.value as EstadoObra)}
                          style={{ fontSize: 12, padding: '5px 8px', width: 'auto', flexShrink: 0 }}
                        >
                          {(Object.entries(ESTADO_OBRA_LABELS) as [EstadoObra, string][]).map(([k, label]) => (
                            <option key={k} value={k}>{label}</option>
                          ))}
                        </select>
                      )}
                      <button
                        className="btn btn-secondary"
                        onClick={() => setHistorialObra(o.obra)}
                        style={{ fontSize: 12, padding: '6px 12px', flexShrink: 0 }}
                      >
                        Detalle
                      </button>
                    </div>
                    {o.obraId && (
                      <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginBottom: 12, fontSize: 12 }}>
                        <label style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--muted)' }}>
                          Inicio
                          <input type="date" value={o.fechaInicio || ''} onChange={e => guardarFechaObra(o.obraId as string, 'fecha_inicio', e.target.value)} style={{ fontSize: 12, padding: '3px 6px', width: 'auto' }} />
                        </label>
                        <label style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--muted)' }}>
                          Fin
                          <input type="date" value={o.fechaFin || ''} onChange={e => guardarFechaObra(o.obraId as string, 'fecha_fin', e.target.value)} style={{ fontSize: 12, padding: '3px 6px', width: 'auto' }} />
                        </label>
                        <label style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--muted)' }}>
                          Garantía hasta
                          <input type="date" value={o.garantiaHasta || ''} onChange={e => guardarFechaObra(o.obraId as string, 'garantia_hasta', e.target.value)} style={{ fontSize: 12, padding: '3px 6px', width: 'auto' }} />
                        </label>
                      </div>
                    )}
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
                      <StatTile label="Presupuesto" valor={o.presupuestoTotal != null ? fmtMoney(o.presupuestoTotal) : 'sin definir'} />
                      <StatTile label="Facturado" valor={fmtMoney(o.cobrado)} tono="positivo" />
                      <StatTile
                        label="Por facturar"
                        valor={o.faltaPorCobrar != null ? fmtMoney(o.faltaPorCobrar) : 'sin presupuesto'}
                        tono={o.faltaPorCobrar == null ? 'neutral' : o.faltaPorCobrar > 0 ? 'alerta' : 'positivo'}
                      />
                      <StatTile label="Mano de obra" valor={fmtMoney(o.manoDeObra)} />
                      <StatTile label="Compras" valor={fmtMoney(o.gastoCompras)} />
                      <StatTile label="Subcontratos" valor={fmtMoney(o.gastoSubcontratos)} />
                      <StatTile label="Adelantos" valor={fmtMoney(o.adelantos)} />
                      <StatTile label="Pagos semana" valor={fmtMoney(o.pagosSemanales)} />
                      <StatTile label="Saldo" valor={fmtMoney(o.saldo)} tono={o.saldo >= 0 ? 'positivo' : 'negativo'} />
                    </div>
                    <div style={{ fontSize: 13, borderTop: '1px solid var(--border)', paddingTop: 10, display: 'flex', flexDirection: 'column', gap: 6 }}>
                      {o.obraId ? (
                        <>
                          {o.tieneCuentas ? (
                            <span>
                              Presupuesto: <strong>{fmtMoney(o.presupuestoTotal as number)}</strong>{' '}
                              <span style={{ color: 'var(--muted)', fontSize: 12 }}>(suma de sus cuentas — se edita cuenta por cuenta en "Detalle")</span>
                            </span>
                          ) : (
                            <EditablePresupuesto valor={o.presupuestoTotal} onGuardar={monto => guardarPresupuesto(o.obraId as string, monto)} />
                          )}
                          <EditableCliente valor={o.cliente} onGuardar={cliente => guardarCliente(o.obraId as string, cliente)} />
                        </>
                      ) : (
                        <span style={{ color: 'var(--muted)' }}>Sin registro en la tabla de obras</span>
                      )}
                      {o.cobradoManual > 0 && (
                        <span>
                          De lo facturado, <strong style={{ color: 'var(--success)' }}>{fmtMoney(o.cobradoManual)}</strong> viene de la cuenta por cobrar manual (no del Reporte Diario).
                        </span>
                      )}
                      {o.gastoSubcontratos !== o.pagadoSubcontratos && (
                        <span>
                          Subcontratos: contrato completo {fmtMoney(o.gastoSubcontratos)}, pagado hasta ahora <strong style={{ color: 'var(--warning)' }}>{fmtMoney(o.pagadoSubcontratos)}</strong>
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
        </div>
      )}

      {(() => {
        const cuentasSinObra = cuentas.filter(c => !c.obra)
        if (cuentasSinObra.length === 0) return null
        return (
          <div style={{ marginTop: 28 }}>
            <p className="font-display" style={{ fontSize: 12, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.8px', marginBottom: 8, paddingBottom: 6, borderBottom: '1px solid var(--border)' }}>
              Otros cobros (sin obra)
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {cuentasSinObra.map(c => (
                <CuentaMiniCard key={c.id} cuenta={c} abonos={abonos} onAgregarAbono={agregarAbono} onEliminarAbono={eliminarAbono} onEliminarCuenta={eliminarCuenta} />
              ))}
            </div>
          </div>
        )
      })()}

      {historialObra && (
        <HistorialObraModal
          obra={historialObra}
          obraId={obrasMaestro.find(o => o.nombre === historialObra)?.id}
          diarios={diarios}
          compras={compras}
          cobros={cobros}
          subcontratos={subcontratos}
          tarifas={trabajadoresTarifas}
          onClose={() => setHistorialObra(null)}
          onMarcarReembolsado={marcarReembolsado}
          cuentasObra={cuentas.filter(c => c.obra === historialObra)}
          abonos={abonos}
          onAgregarAbono={agregarAbono}
          onEliminarAbono={eliminarAbono}
          onEliminarCuenta={eliminarCuenta}
          onCrearCuentaObra={(pagador, concepto, monto) => crearCuenta(pagador, concepto, historialObra, monto)}
        />
      )}
    </>
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
  const [trabajosPuntuales, setTrabajosPuntuales] = useState<ReporteTrabajoPuntualDia[]>([])
  const [cuentas, setCuentas] = useState<CuentaPorCobrar[]>([])
  const [abonos, setAbonos] = useState<AbonoCuenta[]>([])
  const [tarifas, setTarifas] = useState<Trabajador[]>([])
  const [gastosFijos, setGastosFijos] = useState<GastoFijo[]>([])
  const [gastosVariables, setGastosVariables] = useState<GastoVariable[]>([])
  const [obrasMaestro, setObrasMaestro] = useState<Obra[]>([])
  const [loading, setLoading] = useState(true)
  const [mostrarGestionGastos, setMostrarGestionGastos] = useState(false)
  const [mostrarGestionGastosVariables, setMostrarGestionGastosVariables] = useState(false)
  const [nuevoGastoFijo, setNuevoGastoFijo] = useState({ concepto: '', categoria: '', monto_mensual: '', vigente_desde: mesActualISO() })
  const [nuevoGastoVariable, setNuevoGastoVariable] = useState({ fecha: todayISOResultados(), categoria: '', descripcion: '', monto: '' })

  useEffect(() => {
    (async () => {
      const [{ data: d }, { data: c }, { data: co }, { data: s }, { data: tp }, { data: cu }, { data: ab }, { data: t }, { data: gf }, { data: gv }, { data: om }] = await Promise.all([
        supabase.from('reportes_diarios').select('*'),
        supabase.from('reportes_compras').select('*'),
        supabase.from('reportes_cobros').select('*'),
        supabase.from('reportes_subcontratos').select('*'),
        supabase.from('reportes_trabajos_puntuales').select('*'),
        supabase.from('cuentas_por_cobrar').select('*'),
        supabase.from('abonos_cuenta').select('*'),
        supabase.from('trabajadores').select('*'),
        supabase.from('gastos_fijos').select('*'),
        supabase.from('gastos_variables').select('*'),
        supabase.from('obras').select('*'),
      ])
      setDiarios((d as ReporteTrabajadorDia[]) || [])
      setCompras((c as ReporteCompraDia[]) || [])
      setCobros((co as ReporteCobroDia[]) || [])
      setSubcontratos((s as ReporteSubcontratoDia[]) || [])
      setTrabajosPuntuales((tp as ReporteTrabajoPuntualDia[]) || [])
      setCuentas((cu as CuentaPorCobrar[]) || [])
      setAbonos((ab as AbonoCuenta[]) || [])
      setTarifas((t as Trabajador[]) || [])
      setGastosFijos((gf as GastoFijo[]) || [])
      setGastosVariables((gv as GastoVariable[]) || [])
      setObrasMaestro((om as Obra[]) || [])
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
    ...obrasMaestro.map(o => o.nombre),
    ...cuentas.filter(c => c.obra).map(c => c.obra as string),
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

  // Los trabajos puntuales no tienen `obra` asociada (son trabajos sueltos, sin obra formal)
  // -- igual que gastos fijos/variables, solo se cuentan en el consolidado, no filtrados por obra.
  const trabajosPuntualesFiltrados = obraFiltro ? [] : trabajosPuntuales.filter(t => delMes(t.fecha))
  const ingresosTrabajosPuntuales = trabajosPuntualesFiltrados.reduce((s, t) => s + (t.monto || 0), 0)

  const ingresos = ingresosCobros + ingresosAbonos + ingresosTrabajosPuntuales

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
  { titulo: 'Cobrado', texto: 'Lo que el cliente ya pagó por esta obra hasta ahora — puede venir del Reporte Diario o de una cuenta por cobrar manual.' },
  { titulo: 'Falta por cobrar', texto: 'Cuánto le queda debiendo el cliente por esta obra, en total — suma todo lo pendiente de sus cuentas por cobrar (podés ver el detalle de cada una en "Detalle").' },
  { titulo: 'Saldo', texto: 'Cobrado menos todo lo gastado (mano de obra, compras, subcontratos, adelantos y pagos de semana). Es la plata en caja de la obra hoy, no cuánto falta que pague el cliente — para eso mira "Falta por cobrar".' },
  { titulo: 'Facturado', texto: 'El total que ya se le facturó formalmente al cliente por esta obra, sume o no coincida con lo cobrado (a veces se cobra antes de facturar, o se factura antes de cobrar).' },
  { titulo: 'Por facturar', texto: 'Presupuesto total menos lo facturado — cuánto le queda al cliente por facturarle en total. Dice "sin presupuesto" si la obra todavía no tiene un presupuesto total cargado.' },
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

/* ─── Tarjeta chica de una cuenta por cobrar (reusable) ── */
function CuentaMiniCard({ cuenta, abonos, onAgregarAbono, onEliminarAbono, onEliminarCuenta }: {
  cuenta: CuentaPorCobrar
  abonos: AbonoCuenta[]
  onAgregarAbono: (cuentaId: string, fecha: string, monto: number) => void
  onEliminarAbono: (id: string) => void
  onEliminarCuenta: (id: string) => void
}) {
  const [fecha, setFecha] = useState('')
  const [monto, setMonto] = useState('')
  const abonosCuenta = abonos.filter(a => a.cuenta_id === cuenta.id).sort((a, b) => b.fecha.localeCompare(a.fecha))
  const totalAbonado = abonosCuenta.reduce((s, a) => s + a.monto, 0)
  const restante = cuenta.total_presupuesto - totalAbonado

  return (
    <div className="card" style={{ padding: 16 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10, marginBottom: 10 }}>
        <div>
          <p className="font-serif" style={{ fontSize: 16, marginBottom: 2, color: 'var(--secondary)' }}>{cuenta.concepto}</p>
          <span className="font-display" style={{ fontSize: 12, color: 'var(--muted)' }}>{cuenta.pagador}</span>
        </div>
        <button className="btn btn-ghost" onClick={() => onEliminarCuenta(cuenta.id)} style={{ fontSize: 12, flexShrink: 0 }}>Eliminar cuenta</button>
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
        <StatTile label="Presupuesto" valor={fmtMoney(cuenta.total_presupuesto)} />
        <StatTile label="Facturado" valor={fmtMoney(totalAbonado)} tono="positivo" />
        <StatTile label="Por facturar" valor={fmtMoney(restante)} tono={restante > 0 ? 'negativo' : 'positivo'} />
      </div>
      {abonosCuenta.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 12 }}>
          {abonosCuenta.map(a => (
            <div key={a.id} style={{ display: 'flex', alignItems: 'center', gap: 10, background: 'var(--bg)', borderRadius: 8, padding: '8px 12px', fontSize: 13 }}>
              <span style={{ color: 'var(--muted)', fontSize: 12, width: 78, flexShrink: 0 }}>{a.fecha.split('-').reverse().join('/')}</span>
              <span style={{ flex: 1, fontWeight: 700, color: 'var(--success)' }}>{fmtMoney(a.monto)}</span>
              <button onClick={() => onEliminarAbono(a.id)} className="btn btn-ghost" style={{ fontSize: 11, padding: '3px 8px' }}>Quitar</button>
            </div>
          ))}
        </div>
      )}
      <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' }}>
        <div className="field" style={{ flex: 1, minWidth: 130 }}>
          <label>Fecha del abono</label>
          <input type="date" value={fecha} onChange={e => setFecha(e.target.value)} />
        </div>
        <div className="field" style={{ flex: 1, minWidth: 130 }}>
          <label>Monto del abono</label>
          <input type="number" min="0" placeholder="Monto en pesos" value={monto} onChange={e => setMonto(e.target.value)} />
        </div>
        <button
          className="btn btn-secondary"
          onClick={() => {
            const m = Number(monto)
            if (!fecha || !Number.isFinite(m) || m <= 0) { alert('Completa fecha y un monto válido.'); return }
            onAgregarAbono(cuenta.id, fecha, m)
            setFecha(''); setMonto('')
          }}
          style={{ flexShrink: 0 }}
        >+ Agregar abono</button>
      </div>
    </div>
  )
}

/* ─── Galería de fotos/videos por obra ──────────────── */
function GaleriaObra({ obraId }: { obraId: string }) {
  const [media, setMedia] = useState<ObraMedia[]>([])
  const [loading, setLoading] = useState(true)
  const [subiendo, setSubiendo] = useState(false)

  const cargar = useCallback(async () => {
    const { data } = await supabase.from('obra_media').select('*').eq('obra_id', obraId).order('created_at', { ascending: false })
    setMedia((data as ObraMedia[]) || [])
    setLoading(false)
  }, [obraId])

  useEffect(() => { cargar() }, [cargar])

  async function subirArchivo(e: React.ChangeEvent<HTMLInputElement>) {
    const archivo = e.target.files?.[0]
    e.target.value = ''
    if (!archivo) return
    setSubiendo(true)
    const ext = archivo.name.split('.').pop() || 'bin'
    const filename = `obra-${obraId}-${Date.now()}.${ext}`
    const { data, error } = await supabase.storage.from('audio-notas').upload(filename, archivo, { contentType: archivo.type })
    if (error) {
      alert('Error al subir el archivo: ' + error.message)
      setSubiendo(false)
      return
    }
    const { data: urlData } = supabase.storage.from('audio-notas').getPublicUrl(data.path)
    const tipo: ObraMedia['tipo'] = archivo.type.startsWith('image/') ? 'foto' : archivo.type.startsWith('video/') ? 'video' : 'documento'
    await supabase.from('obra_media').insert({ obra_id: obraId, url: urlData.publicUrl, tipo })
    setSubiendo(false)
    cargar()
  }

  async function eliminar(id: string) {
    if (!window.confirm('¿Seguro que querés borrar este archivo?')) return
    await supabase.from('obra_media').delete().eq('id', id)
    setMedia(prev => prev.filter(m => m.id !== id))
  }

  return (
    <div style={{ padding: '14px 1.5rem', borderBottom: '1px solid var(--border)', flexShrink: 0, maxHeight: '35vh', overflowY: 'auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
        <p style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
          Fotos y videos
        </p>
        <label className="btn btn-ghost" style={{ fontSize: 12, cursor: subiendo ? 'default' : 'pointer', opacity: subiendo ? 0.6 : 1 }}>
          {subiendo ? 'Subiendo...' : '+ Subir'}
          <input type="file" accept="image/*,video/*,.pdf" onChange={subirArchivo} disabled={subiendo} style={{ display: 'none' }} />
        </label>
      </div>
      {loading ? (
        <div className="spinner" />
      ) : media.length === 0 ? (
        <p style={{ fontSize: 12, color: 'var(--muted)' }}>Sin fotos ni videos todavía.</p>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(90px, 1fr))', gap: 8 }}>
          {media.map(m => (
            <div key={m.id} style={{ position: 'relative' }}>
              <a href={m.url} target="_blank" rel="noreferrer">
                {m.tipo === 'foto' ? (
                  <img src={m.url} alt="" style={{ width: '100%', height: 90, objectFit: 'cover', borderRadius: 8, border: '1px solid var(--border)' }} />
                ) : m.tipo === 'video' ? (
                  <div style={{ width: '100%', height: 90, borderRadius: 8, border: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg)', fontSize: 28 }}>🎬</div>
                ) : (
                  <div style={{ width: '100%', height: 90, borderRadius: 8, border: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg)', fontSize: 28 }}>📄</div>
                )}
              </a>
              <button
                onClick={() => eliminar(m.id)}
                style={{ position: 'absolute', top: 4, right: 4, background: 'rgba(0,0,0,0.6)', color: '#fff', border: 'none', borderRadius: '50%', width: 20, height: 20, fontSize: 12, cursor: 'pointer', lineHeight: 1 }}
              >✕</button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export function HistorialObraModal({
  obra,
  obraId,
  diarios,
  compras,
  cobros,
  subcontratos,
  tarifas,
  onClose,
  onMarcarReembolsado,
  cuentasObra,
  abonos,
  onAgregarAbono,
  onEliminarAbono,
  onEliminarCuenta,
  onCrearCuentaObra,
}: {
  obra: string
  obraId?: string
  diarios: ReporteTrabajadorDia[]
  compras: ReporteCompraDia[]
  cobros: ReporteCobroDia[]
  subcontratos: ReporteSubcontratoDia[]
  tarifas: Trabajador[]
  onClose: () => void
  onMarcarReembolsado?: (compraId: string, reembolsado: boolean) => void
  // Cuentas por cobrar manuales vinculadas a esta obra (puede haber más de
  // una — ej. "presupuesto original" + "adicional a evaluar").
  cuentasObra?: CuentaPorCobrar[]
  abonos?: AbonoCuenta[]
  onAgregarAbono?: (cuentaId: string, fecha: string, monto: number) => void
  onEliminarAbono?: (id: string) => void
  onEliminarCuenta?: (id: string) => void
  onCrearCuentaObra?: (pagador: string, concepto: string, monto: number) => void
}) {
  const [mostrarNuevaCuenta, setMostrarNuevaCuenta] = useState(false)
  const [nuevaCuenta, setNuevaCuenta] = useState({ pagador: '', concepto: '', total_presupuesto: '' })
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

        {obraId && <GaleriaObra obraId={obraId} />}

        {onAgregarAbono && onEliminarAbono && onEliminarCuenta && (
          <div style={{ padding: '14px 1.5rem', borderBottom: '1px solid var(--border)', flexShrink: 0, maxHeight: '40vh', overflowY: 'auto' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
              <p style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                Cuentas por cobrar de esta obra
              </p>
              {onCrearCuentaObra && (
                <button className="btn btn-ghost" onClick={() => setMostrarNuevaCuenta(x => !x)} style={{ fontSize: 12 }}>
                  {mostrarNuevaCuenta ? 'Cancelar' : '+ Agregar cuenta'}
                </button>
              )}
            </div>
            {mostrarNuevaCuenta && onCrearCuentaObra && (
              <div className="card" style={{ padding: 14, marginBottom: 10 }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <div className="field">
                    <label>¿Quién paga?</label>
                    <input type="text" placeholder="Ej: Ignacio" value={nuevaCuenta.pagador} onChange={e => setNuevaCuenta(p => ({ ...p, pagador: e.target.value }))} />
                  </div>
                  <div className="field">
                    <label>Concepto</label>
                    <input type="text" placeholder="Ej: Adicional a evaluar" value={nuevaCuenta.concepto} onChange={e => setNuevaCuenta(p => ({ ...p, concepto: e.target.value }))} />
                  </div>
                  <div className="field">
                    <label>Presupuesto de esta cuenta</label>
                    <input type="number" min="0" placeholder="Monto en pesos" value={nuevaCuenta.total_presupuesto} onChange={e => setNuevaCuenta(p => ({ ...p, total_presupuesto: e.target.value }))} />
                  </div>
                  <button
                    className="btn btn-primary"
                    onClick={() => {
                      if (!nuevaCuenta.pagador.trim() || !nuevaCuenta.concepto.trim() || !nuevaCuenta.total_presupuesto.trim()) { alert('Completa quién paga, el concepto y el presupuesto.'); return }
                      const monto = Number(nuevaCuenta.total_presupuesto)
                      if (!Number.isFinite(monto) || monto <= 0) { alert('El presupuesto tiene que ser un número mayor a cero.'); return }
                      onCrearCuentaObra(nuevaCuenta.pagador.trim(), nuevaCuenta.concepto.trim(), monto)
                      setNuevaCuenta({ pagador: '', concepto: '', total_presupuesto: '' })
                      setMostrarNuevaCuenta(false)
                    }}
                  >Guardar cuenta</button>
                </div>
              </div>
            )}
            {(!cuentasObra || cuentasObra.length === 0) ? (
              <p style={{ fontSize: 13, color: 'var(--muted)' }}>Esta obra no tiene cuentas por cobrar manuales cargadas.</p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {cuentasObra.map(c => (
                  <CuentaMiniCard key={c.id} cuenta={c} abonos={abonos || []} onAgregarAbono={onAgregarAbono} onEliminarAbono={onEliminarAbono} onEliminarCuenta={onEliminarCuenta} />
                ))}
              </div>
            )}
          </div>
        )}

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

/* ─── Mis presupuestos ──────────────────────────────── */
const ESTADO_PRESUPUESTO_LABELS: Record<EstadoPresupuesto, string> = {
  borrador: 'Borrador',
  enviado: 'Enviado',
  aceptado: 'Aceptado',
  convertido: 'Convertido en obra',
}

export function PanelPresupuestos() {
  const [presupuestos, setPresupuestos] = useState<PresupuestoGuardado[]>([])
  const [loading, setLoading] = useState(true)
  const [busqueda, setBusqueda] = useState('')
  const [detalleId, setDetalleId] = useState<string | null>(null)
  const [detalle, setDetalle] = useState<PresupuestoDetalle | null>(null)
  const [cargandoDetalle, setCargandoDetalle] = useState(false)

  const cargar = useCallback(async () => {
    const { data } = await supabase
      .from('presupuestos')
      .select('id, created_at, cliente_id, cliente_nombre, cliente_telefono, cliente_email, cliente_direccion, referencia, tipo, estado, subtotal, iva, total')
      .order('created_at', { ascending: false })
    setPresupuestos((data as PresupuestoGuardado[]) || [])
    setLoading(false)
  }, [])

  useEffect(() => { cargar() }, [cargar])

  async function cambiarEstado(id: string, estado: EstadoPresupuesto) {
    setPresupuestos(prev => prev.map(p => p.id === id ? { ...p, estado } : p))
    if (detalle?.id === id) setDetalle(prev => prev ? { ...prev, estado } : prev)
    const { error } = await supabase.from('presupuestos').update({ estado }).eq('id', id)
    if (error) {
      alert('No se pudo actualizar el estado. Intenta de nuevo.')
      cargar()
    }
  }

  async function abrirDetalle(id: string) {
    setDetalleId(id)
    setCargandoDetalle(true)
    const { data } = await supabase.from('presupuestos').select('*').eq('id', id).single()
    setDetalle(data as PresupuestoDetalle)
    setCargandoDetalle(false)
  }

  async function eliminarPresupuesto(id: string, clienteNombre: string | null) {
    if (!window.confirm(`¿Seguro que querés borrar el presupuesto de "${clienteNombre || 'sin nombre'}"? No se puede deshacer.`)) return
    const { error } = await supabase.from('presupuestos').delete().eq('id', id)
    if (error) {
      alert('No se pudo borrar. Intenta de nuevo.')
      return
    }
    setPresupuestos(prev => prev.filter(p => p.id !== id))
    if (detalleId === id) { setDetalleId(null); setDetalle(null) }
  }

  const filtrados = presupuestos.filter(p =>
    !busqueda.trim() || (p.cliente_nombre || '').toLowerCase().includes(busqueda.trim().toLowerCase())
  )

  if (loading) return <div className="spinner" />

  return (
    <div>
      <div className="field" style={{ maxWidth: 320, marginBottom: 18 }}>
        <label>Buscar por cliente</label>
        <input value={busqueda} onChange={e => setBusqueda(e.target.value)} placeholder="Nombre del cliente..." />
      </div>

      {filtrados.length === 0 ? (
        <p style={{ color: 'var(--muted)', textAlign: 'center', padding: '2rem 0' }}>
          {presupuestos.length === 0 ? 'Todavía no hay presupuestos guardados.' : 'Sin resultados para esa búsqueda.'}
        </p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {filtrados.map(p => (
            <div key={p.id} className="card" style={{ padding: 14 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10, flexWrap: 'wrap' }}>
                <div>
                  <p style={{ fontWeight: 700, fontSize: 15 }}>{p.cliente_nombre || 'Sin nombre'}</p>
                  <p style={{ fontSize: 12, color: 'var(--muted)' }}>
                    {p.referencia ? `${p.referencia} · ` : ''}
                    {new Date(p.created_at).toLocaleDateString('es-CL', { timeZone: 'America/Santiago' })}
                    {' · '}{p.tipo === 'simple' ? 'Simple' : 'Por etapas'}
                  </p>
                </div>
                <p style={{ fontWeight: 700, fontSize: 15 }}>{fmtMoney(p.total || 0)}</p>
              </div>
              <div style={{ marginTop: 10, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <select
                  value={p.estado}
                  onChange={e => cambiarEstado(p.id, e.target.value as EstadoPresupuesto)}
                  style={{ fontSize: 13, padding: '5px 10px', width: 'auto' }}
                >
                  {(Object.entries(ESTADO_PRESUPUESTO_LABELS) as [EstadoPresupuesto, string][]).map(([k, label]) => (
                    <option key={k} value={k}>{label}</option>
                  ))}
                </select>
                <button className="btn btn-secondary" onClick={() => abrirDetalle(p.id)} style={{ fontSize: 12, padding: '6px 12px' }}>
                  Detalle
                </button>
                <button className="btn btn-danger" onClick={() => eliminarPresupuesto(p.id, p.cliente_nombre)} style={{ fontSize: 12, padding: '6px 12px', marginLeft: 'auto' }}>
                  Borrar
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {detalleId && (
        <div
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16, zIndex: 100 }}
          onClick={() => { setDetalleId(null); setDetalle(null) }}
        >
          <div
            style={{ background: 'var(--white)', borderRadius: 'var(--radius)', maxWidth: 640, width: '100%', maxHeight: '85vh', overflowY: 'auto', padding: '1.5rem' }}
            onClick={e => e.stopPropagation()}
          >
            {cargandoDetalle || !detalle ? (
              <div className="spinner" />
            ) : (
              <>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10, marginBottom: 16 }}>
                  <div>
                    <h3 style={{ fontSize: 18, fontWeight: 700 }}>{detalle.cliente_nombre || 'Sin nombre'}</h3>
                    <p style={{ fontSize: 12, color: 'var(--muted)' }}>
                      {detalle.referencia ? `${detalle.referencia} · ` : ''}
                      {new Date(detalle.created_at).toLocaleDateString('es-CL', { timeZone: 'America/Santiago' })}
                    </p>
                  </div>
                  <button onClick={() => { setDetalleId(null); setDetalle(null) }} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 20, color: 'var(--muted)' }}>✕</button>
                </div>

                <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', fontSize: 13, color: 'var(--muted)', marginBottom: 16, paddingBottom: 16, borderBottom: '1px solid var(--border)' }}>
                  {detalle.cliente_telefono && <span>📞 {detalle.cliente_telefono}</span>}
                  {detalle.cliente_email && <span>✉️ {detalle.cliente_email}</span>}
                  {detalle.cliente_direccion && <span>📍 {detalle.cliente_direccion}</span>}
                </div>

                {detalle.tipo === 'simple' ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 16 }}>
                    {(detalle.items || []).map((item, i) => (
                      <div key={i} style={{ display: 'flex', justifyContent: 'space-between', gap: 10, fontSize: 13, padding: '6px 0', borderBottom: '1px solid var(--border)' }}>
                        <span style={{ flex: 1 }}>
                          <span style={{ color: 'var(--muted)', fontSize: 11 }}>{item.categoria}</span><br />
                          {item.description} × {item.quantity}
                        </span>
                        <span style={{ fontWeight: 600, flexShrink: 0 }}>{fmtMoney(item.total)}</span>
                      </div>
                    ))}
                    {(!detalle.items || detalle.items.length === 0) && (
                      <p style={{ fontSize: 13, color: 'var(--muted)' }}>Sin ítems cargados.</p>
                    )}
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 14, marginBottom: 16 }}>
                    {(detalle.etapas || []).map((etapa, i) => (
                      <div key={i}>
                        <p style={{ fontWeight: 700, fontSize: 13, marginBottom: 6 }}>{etapa.numero} — {etapa.nombre}</p>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                          {etapa.items.map((item, j) => (
                            <div key={j} style={{ display: 'flex', justifyContent: 'space-between', gap: 10, fontSize: 12, padding: '4px 0' }}>
                              <span style={{ flex: 1, color: 'var(--muted)' }}>
                                [{item.tipo}] {item.descripcion} × {item.cantidad}
                              </span>
                              <span style={{ flexShrink: 0 }}>{fmtMoney(item.total)}</span>
                            </div>
                          ))}
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'flex-end', fontSize: 12, fontWeight: 700, marginTop: 4, paddingTop: 4, borderTop: '1px solid var(--border)' }}>
                          Subtotal etapa: {fmtMoney(etapa.total)}
                        </div>
                      </div>
                    ))}
                    {(!detalle.etapas || detalle.etapas.length === 0) && (
                      <p style={{ fontSize: 13, color: 'var(--muted)' }}>Sin etapas cargadas.</p>
                    )}
                  </div>
                )}

                <div style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13, paddingTop: 12, borderTop: '1px solid var(--border)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>Subtotal</span><span>{fmtMoney(detalle.subtotal || 0)}</span></div>
                  {detalle.gg_amount != null && detalle.gg_amount > 0 && (
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>Gastos generales ({detalle.gg_pct}%)</span><span>{fmtMoney(detalle.gg_amount)}</span></div>
                  )}
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>IVA</span><span>{fmtMoney(detalle.iva || 0)}</span></div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 700, fontSize: 15 }}><span>Total</span><span>{fmtMoney(detalle.total || 0)}</span></div>
                </div>

                <div style={{ marginTop: 16, display: 'flex', gap: 8, alignItems: 'center' }}>
                  <select
                    value={detalle.estado}
                    onChange={e => cambiarEstado(detalle.id, e.target.value as EstadoPresupuesto)}
                    style={{ fontSize: 13, padding: '5px 10px', width: 'auto' }}
                  >
                    {(Object.entries(ESTADO_PRESUPUESTO_LABELS) as [EstadoPresupuesto, string][]).map(([k, label]) => (
                      <option key={k} value={k}>{label}</option>
                    ))}
                  </select>
                  <button className="btn btn-danger" onClick={() => eliminarPresupuesto(detalle.id, detalle.cliente_nombre)} style={{ fontSize: 12, padding: '6px 12px', marginLeft: 'auto' }}>
                    Borrar
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
