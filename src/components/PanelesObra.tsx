import { useState, useEffect, useCallback, Fragment } from 'react'
import { supabase } from '../lib/supabase'
import { TRABAJADORES } from '../pages/Reporte'
import { GaleriaArchivos } from './GaleriaArchivos'
import type { ReporteTrabajadorDia, ReporteCompraDia, ReporteCobroDia, ReporteSubcontratoDia, ReporteTrabajoPuntualDia, Trabajador, CuentaPorCobrar, AbonoCuenta, GastoFijo, GastoVariable, Obra, SubcontratoMaster, PresupuestoGuardado, PresupuestoDetalle, EstadoPresupuesto, EstadoObra, ObraMedia, EventoCalendario, Material, MovimientoStock, CompraItem, Cliente, Pendiente, TipoPendiente, PagoSemanalComprobante, IdeaContenido, AjustePagoSemanal, AdelantoTrabajador, ObraItem, ObraFase, ObraAvanceRegistro, PresupuestoItemSimple, PresupuestoEtapa } from '../types'

// Componentes y cálculos compartidos entre el panel de Admin (Alexandra) y el
// panel de Gustavo — antes vivían duplicados letra por letra en Admin.tsx y
// Gustavo.tsx. Cualquier cambio acá se refleja en los dos paneles a la vez.

export function fmtMoney(n: number) {
  const rounded = Math.round(n)
  return `${rounded < 0 ? '-' : ''}$${Math.abs(rounded).toLocaleString('es-CL')}`
}

// Cuando la suma de los ítems de una obra no coincide con su presupuesto total, antes de
// avisar "falta desglosar algo" hay que descartar la explicación más común: que la
// diferencia sea, ni más ni menos, gastos generales + IVA -- la misma fórmula que ya usa
// el presupuestador de esta app (subtotal -> +GG% -> neto -> +19% IVA -> total). Si
// cuadra con algún % de GG habitual, no es un ítem de trabajo faltante, es matemática
// normal de presupuesto.
function detectarGGeIVA(subtotal: number, total: number): { pct: number; gg: number; iva: number } | null {
  for (const pct of [0, 5, 7, 10, 12, 15]) {
    const gg = Math.round(subtotal * pct / 100)
    const neto = subtotal + gg
    const iva = Math.round(neto * 0.19)
    if (Math.abs(neto + iva - total) <= 200) return { pct, gg, iva }
  }
  return null
}

// Copia el detalle línea por línea de un presupuesto (simple, por etapas, o externo con
// desglose leído por IA) a obra_items, al momento de convertirlo en obra -- así "Avance
// de obra" tiene contra qué medir. Los presupuestos "externos" sin desglose (la IA solo
// pudo leer el monto total, o Alexandra descartó los ítems al guardar) no generan filas:
// la obra queda igual, solo que sin esa card -- se pueden cargar a mano desde ahí.
//
// Si el presupuesto era "por etapas", cada etapa se convierte además en una fila de
// obra_fases (sin fechas todavía -- esas se cargan a mano en "Avance de obra") para que
// ya arranque con la agenda armada. Si era "simple" o "externo", no se crea ninguna fase
// automática -- decisión tomada con Alexandra el 28/08: las agrupa a mano ella/Gustavo
// desde el panel, porque esos no traen ninguna estructura de fases de la que partir.
export async function copiarItemsAObra(
  obraId: string,
  presupuesto: { tipo: string; items: PresupuestoItemSimple[] | null; etapas: PresupuestoEtapa[] | null }
) {
  const filas: Omit<ObraItem, 'id' | 'created_at'>[] = []

  if (presupuesto.tipo !== 'etapas' && presupuesto.items) {
    presupuesto.items.forEach((it, idx) => {
      filas.push({
        obra_id: obraId,
        fase: null,
        descripcion: it.description,
        categoria: it.categoria || null,
        cantidad: it.quantity,
        precio_unitario: it.price,
        total: it.total,
        cantidad_completada: 0,
        orden: idx,
      })
    })
  } else if (presupuesto.tipo === 'etapas' && presupuesto.etapas) {
    let orden = 0
    presupuesto.etapas.forEach(etapa => {
      etapa.items.forEach(it => {
        filas.push({
          obra_id: obraId,
          fase: etapa.nombre,
          descripcion: it.descripcion,
          categoria: it.tipo,
          cantidad: it.cantidad,
          precio_unitario: it.precioUnitario,
          total: it.total,
          cantidad_completada: 0,
          orden: orden++,
        })
      })
    })

    const fases = presupuesto.etapas.map((etapa, idx) => ({
      obra_id: obraId,
      nombre: etapa.nombre,
      orden: idx,
      fecha_inicio: null,
      fecha_fin: null,
    }))
    if (fases.length > 0) await supabase.from('obra_fases').insert(fases)
  }

  if (filas.length === 0) return
  await supabase.from('obra_items').insert(filas)
}

// Atajo para cuando una obra se creó por la vía de excepción (sin presupuesto aceptado
// todavía, ver decisiones.md 25/08) y después aparece el PDF real -- evita tener que
// pasar por "Hacer presupuesto" -> "Mis presupuestos" -> "Convertido en obra" cuando la
// obra ya existe. Sube el archivo, la IA lee monto + ítems (mismo lector que "Cargar
// presupuesto externo"), y al confirmar crea el presupuesto YA vinculado a esta obra y
// copia los ítems a Avance de obra en el mismo paso.
function CargarPresupuestoObra({ obra, onGuardado }: { obra: { id: string; nombre: string; cliente: string | null }; onGuardado: () => void }) {
  const [abierto, setAbierto] = useState(false)
  const [subiendo, setSubiendo] = useState(false)
  const [guardando, setGuardando] = useState(false)
  const [archivoUrl, setArchivoUrl] = useState('')
  const [monto, setMonto] = useState('')
  const [items, setItems] = useState<PresupuestoItemSimple[]>([])
  const [incluirItems, setIncluirItems] = useState(true)

  async function subir(archivo: File) {
    setSubiendo(true)
    try {
      const ext = archivo.name.split('.').pop() || 'pdf'
      const filename = `presupuesto-obra-${obra.id}-${Date.now()}.${ext}`
      const { data, error } = await supabase.storage.from('audio-notas').upload(filename, archivo, { contentType: archivo.type })
      if (error) { alert('Error al subir el archivo: ' + error.message); return }
      const { data: urlData } = supabase.storage.from('audio-notas').getPublicUrl(data.path)
      setArchivoUrl(urlData.publicUrl)
      try {
        const res = await fetch('/api/parse-presupuesto-externo', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url: urlData.publicUrl }),
        })
        const resultado = await res.json()
        if (!res.ok) throw new Error(resultado.error || 'error desconocido')
        if (resultado.monto) setMonto(String(resultado.monto))
        if (Array.isArray(resultado.items) && resultado.items.length > 0) {
          setItems(resultado.items.map((it: { descripcion: string; cantidad: number; precio_unitario: number; total: number }, idx: number) => ({
            id: idx, categoria: '', description: it.descripcion, quantity: it.cantidad, price: it.precio_unitario, total: it.total,
          })))
        }
      } catch (err) {
        alert('El archivo se guardó, pero la IA no pudo leerlo (' + String(err) + '). Completa el monto a mano.')
      }
    } finally {
      setSubiendo(false)
    }
  }

  async function guardar() {
    const montoNum = Number(monto)
    if (!monto.trim() || !Number.isFinite(montoNum) || montoNum <= 0) { alert('Completa un monto válido.'); return }
    setGuardando(true)

    const { data: cliente } = obra.cliente
      ? await supabase.from('clientes').upsert({ nombre: obra.cliente }, { onConflict: 'nombre' }).select('id').single()
      : { data: null }

    const itemsAGuardar = incluirItems && items.length > 0 ? items : null
    const { data: presupuestoCreado, error } = await supabase.from('presupuestos').insert({
      cliente_id: cliente?.id ?? null,
      cliente_nombre: obra.cliente || obra.nombre,
      tipo: 'externo',
      estado: 'convertido',
      total: montoNum,
      archivo_url: archivoUrl || null,
      items: itemsAGuardar,
    }).select('id').single()
    if (error || !presupuestoCreado) {
      setGuardando(false)
      alert('No se pudo guardar el presupuesto. Intenta de nuevo.')
      return
    }

    await supabase.from('obras').update({ presupuesto_id: presupuestoCreado.id, presupuesto_total: montoNum }).eq('id', obra.id)
    if (itemsAGuardar) await copiarItemsAObra(obra.id, { tipo: 'externo', items: itemsAGuardar, etapas: null })

    setGuardando(false)
    setAbierto(false)
    setArchivoUrl('')
    setMonto('')
    setItems([])
    onGuardado()
  }

  if (!abierto) {
    return (
      <button onClick={() => setAbierto(true)} className="btn btn-secondary" style={{ fontSize: 12, padding: '6px 12px' }}>
        + Cargar presupuesto (IA)
      </button>
    )
  }

  return (
    <div style={{ padding: 12, background: 'var(--surface-alt)', borderRadius: 8, marginTop: 8 }}>
      <p style={{ fontSize: 12, fontWeight: 700, marginBottom: 8 }}>Cargar presupuesto de esta obra</p>
      <input
        type="file" accept="image/*,.pdf" disabled={subiendo}
        onChange={e => { const f = e.target.files?.[0]; if (f) subir(f) }}
        style={{ fontSize: 13, marginBottom: 8 }}
      />
      {subiendo && <p style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 8 }}>Subiendo y leyendo con IA...</p>}
      <div className="field" style={{ maxWidth: 200, marginBottom: 8 }}>
        <label>Monto total</label>
        <input type="number" min="0" value={monto} onChange={e => setMonto(e.target.value)} placeholder="0" />
      </div>
      {items.length > 0 && (
        <div style={{ marginBottom: 10, padding: 10, background: 'var(--white)', borderRadius: 8 }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6, cursor: 'pointer' }}>
            <input type="checkbox" checked={incluirItems} onChange={e => setIncluirItems(e.target.checked)} />
            <span style={{ fontSize: 12, fontWeight: 700 }}>La IA encontró {items.length} ítem{items.length !== 1 ? 's' : ''} — incluirlos en Avance de obra</span>
          </label>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 3, opacity: incluirItems ? 1 : 0.5 }}>
            {items.map(it => (
              <div key={it.id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11.5, gap: 8 }}>
                <span>{it.description} ({it.quantity} × {fmtMoney(it.price)})</span>
                <span style={{ flexShrink: 0 }}>{fmtMoney(it.total)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
      <div style={{ display: 'flex', gap: 8 }}>
        <button onClick={guardar} disabled={guardando || subiendo} className="btn btn-primary" style={{ fontSize: 12, padding: '7px 14px' }}>
          {guardando ? 'Guardando...' : 'Guardar y vincular a esta obra'}
        </button>
        <button onClick={() => setAbierto(false)} className="btn btn-secondary" style={{ fontSize: 12, padding: '7px 14px' }}>Cancelar</button>
      </div>
    </div>
  )
}

export function StatTile({ label, valor, tono = 'neutral' }: { label: string; valor: string; tono?: 'neutral' | 'positivo' | 'negativo' | 'alerta' }) {
  const color = tono === 'positivo' ? 'var(--success)' : tono === 'negativo' ? 'var(--danger)' : tono === 'alerta' ? 'var(--primary)' : 'var(--text)'
  return (
    <div style={{ padding: '14px 16px', background: 'var(--surface)', borderRadius: 14, minWidth: 100, boxShadow: 'var(--shadow)' }}>
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

  // El historial de reportes (diarios, compras, cobros, subcontratos) guarda la obra por
  // NOMBRE, no por FK -- borrar la fila de `obras` no borra ese historial, solo saca la
  // obra de esta pestaña. Solo la galería de fotos (`obra_media`) tiene FK real y se borra
  // en cascada.
  async function borrarObra(obraId: string, nombre: string) {
    if (!window.confirm(`¿Borrar la obra "${nombre}"? Se borra la fila de la obra y su galería de fotos. El historial de reportes diarios/compras/cobros que ya se cargó bajo ese nombre NO se borra (queda igual, solo deja de estar agrupado bajo esta obra). No se puede deshacer.`)) return
    const { error } = await supabase.from('obras').delete().eq('id', obraId)
    if (error) {
      alert('No se pudo borrar. Intenta de nuevo.')
      return
    }
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
        alert('Elige el presupuesto aceptado del que nace esta obra.')
        return
      }
      const presupuesto = presupuestosAceptados.find(p => p.id === nuevaObra.presupuesto_id)
      if (!presupuesto) {
        alert('Ese presupuesto ya no está disponible (puede que otra obra ya lo haya usado). Recarga la lista.')
        return
      }
      const { data: obraCreada, error } = await supabase.from('obras').insert({
        nombre: nuevaObra.nombre.trim(),
        cliente: presupuesto.cliente_nombre,
        presupuesto_total: presupuesto.total,
        presupuesto_id: presupuesto.id,
      }).select('id').single()
      if (error) {
        alert('No se pudo crear la obra. Puede que ya exista una con ese nombre.')
        return
      }
      if (obraCreada?.id) {
        const { data: detalleCompleto } = await supabase.from('presupuestos').select('tipo, items, etapas').eq('id', presupuesto.id).single()
        if (detalleCompleto) await copiarItemsAObra(obraCreada.id, detalleCompleto as { tipo: string; items: PresupuestoItemSimple[] | null; etapas: PresupuestoEtapa[] | null })
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
      if (!window.confirm('¿Confirmas que deseas crear esta obra sin vincularla a un presupuesto? Es la excepción -- lo normal es elegir uno de la lista.')) return
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

  async function agregarAbono(cuentaId: string, fecha: string, monto: number, comprobanteUrl?: string | null) {
    const { error } = await supabase.from('abonos_cuenta').insert({ cuenta_id: cuentaId, fecha, monto, comprobante_url: comprobanteUrl || null })
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
      tieneCuentas, cliente: maestro?.cliente ?? null, presupuestoTotal, presupuestoId: maestro?.presupuesto_id ?? null, gastoCompras, gastoSubcontratos, pagadoSubcontratos, manoDeObra, adelantos, pagosSemanales, porReembolsar, cobrado, cobradoManual, saldo, faltaPorCobrar,
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
                  No hay presupuestos marcados "Aceptado" todavía sin usar — marca uno en "Mis presupuestos", o usa la excepción de abajo.
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
                      {o.obraId && (
                        <button
                          className="btn btn-danger"
                          onClick={() => borrarObra(o.obraId as string, o.obra)}
                          style={{ fontSize: 12, padding: '6px 12px', flexShrink: 0 }}
                        >
                          Borrar
                        </button>
                      )}
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
                          {!o.presupuestoId && (
                            <CargarPresupuestoObra obra={{ id: o.obraId as string, nombre: o.obra, cliente: o.cliente }} onGuardado={cargar} />
                          )}
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

/* ─── Avance de obra — cantidad parcial por ítem + agenda por fase (carta Gantt) ──── */

function lunesDe(fecha: Date): Date {
  const d = new Date(fecha)
  const dia = d.getDay()
  d.setDate(d.getDate() + (dia === 0 ? -6 : 1 - dia))
  d.setHours(0, 0, 0, 0)
  return d
}
function sumarDiasDate(d: Date, n: number): Date {
  const r = new Date(d)
  r.setDate(r.getDate() + n)
  return r
}
function fechaCorta(d: Date): string {
  return d.toLocaleDateString('es-CL', { day: '2-digit', month: 'short' })
}
function parseFechaObra(s: string): Date {
  const [y, m, d] = s.split('-').map(Number)
  return new Date(y, m - 1, d)
}

// Vista semanal tipo Gantt: una fila por fase, una barra por el rango de fechas que
// tenga cargado, con un relleno interno mostrando cuánto de esa fase ya se completó
// (ponderado por monto de los ítems que le corresponden). Solo se dibuja si al menos
// una fase tiene fecha de inicio Y fin.
function GanttSemanal({ fases, items }: { fases: ObraFase[]; items: ObraItem[] }) {
  const conFechas = fases.filter(f => f.fecha_inicio && f.fecha_fin)
  if (conFechas.length === 0) return null

  const inicios = conFechas.map(f => parseFechaObra(f.fecha_inicio as string))
  const fines = conFechas.map(f => parseFechaObra(f.fecha_fin as string))
  const minInicio = new Date(Math.min(...inicios.map(d => d.getTime())))
  const maxFin = new Date(Math.max(...fines.map(d => d.getTime())))

  const semanas: Date[] = []
  let cursor = lunesDe(minInicio)
  while (cursor <= maxFin) {
    semanas.push(cursor)
    cursor = sumarDiasDate(cursor, 7)
  }

  return (
    <div style={{ overflowX: 'auto', marginBottom: 18 }}>
      <div style={{
        display: 'grid',
        gridTemplateColumns: `140px repeat(${semanas.length}, 60px)`,
        gridTemplateRows: `auto repeat(${fases.length}, 30px)`,
        gap: '4px 3px',
        minWidth: 140 + semanas.length * 63,
      }}>
        <div style={{ gridRow: 1, gridColumn: 1 }} />
        {semanas.map((s, i) => (
          <div key={i} style={{ gridRow: 1, gridColumn: i + 2, fontSize: 10, fontWeight: 700, color: 'var(--muted)', textAlign: 'center' }}>
            {fechaCorta(s)}
          </div>
        ))}
        {fases.map((f, rowIdx) => {
          const row = rowIdx + 2
          const tieneFechas = f.fecha_inicio && f.fecha_fin
          let colInicio = 0
          let colFin = 0
          if (tieneFechas) {
            const inicio = parseFechaObra(f.fecha_inicio as string)
            const fin = parseFechaObra(f.fecha_fin as string)
            colInicio = semanas.findIndex(s => sumarDiasDate(s, 6) >= inicio)
            colFin = semanas.length - 1
            for (let i = semanas.length - 1; i >= 0; i--) { if (semanas[i] <= fin) { colFin = i; break } }
          }
          return (
            <Fragment key={f.id}>
              <div style={{ gridRow: row, gridColumn: 1, fontSize: 12, fontWeight: 600, color: 'var(--text)', display: 'flex', alignItems: 'center', paddingRight: 6, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {f.nombre}
              </div>
              {tieneFechas ? (() => {
                const itemsFase = items.filter(it => (it.fase || '') === f.nombre)
                const totalFase = itemsFase.reduce((s, it) => s + it.total, 0)
                const hechoFase = itemsFase.reduce((s, it) => s + (it.cantidad > 0 ? (it.cantidad_completada / it.cantidad) * it.total : 0), 0)
                const pctFase = totalFase > 0 ? Math.round((hechoFase / totalFase) * 100) : 0
                return (
                  <div style={{
                    gridRow: row, gridColumn: `${colInicio + 2} / ${colFin + 3}`,
                    background: 'rgba(193,68,14,0.22)', borderRadius: 6, height: 20, alignSelf: 'center',
                    overflow: 'hidden', position: 'relative',
                  }}>
                    <div style={{ height: '100%', width: `${pctFase}%`, background: pctFase >= 100 ? 'var(--success)' : 'var(--primary)', transition: 'width 0.2s' }} />
                  </div>
                )
              })() : (
                <div style={{ gridRow: row, gridColumn: `2 / ${semanas.length + 2}`, fontSize: 11, color: 'var(--muted)', display: 'flex', alignItems: 'center' }}>
                  Sin fecha cargada
                </div>
              )}
            </Fragment>
          )
        })}
      </div>
    </div>
  )
}

function ItemAvanceRow({ item, fases, onCantidad, onFase, onBorrar, mostrarPrecio = true }: {
  item: ObraItem
  fases?: ObraFase[]
  onCantidad: (cantidad: number) => void
  onFase?: (fase: string | null) => void
  onBorrar?: () => void
  mostrarPrecio?: boolean
}) {
  const [valor, setValor] = useState(String(item.cantidad_completada))
  useEffect(() => { setValor(String(item.cantidad_completada)) }, [item.cantidad_completada])

  const pct = item.cantidad > 0 ? Math.min(100, Math.round((item.cantidad_completada / item.cantidad) * 100)) : 0
  const completo = item.cantidad_completada >= item.cantidad
  const colorPct = completo ? 'var(--success)' : 'var(--primary)'
  // Con cantidad=1 (el caso más común: "instalar el tablero", no "50 metros de cable")
  // un checkbox es más claro que escribir un número -- mismo mecanismo de guardado.
  const esBinario = item.cantidad === 1

  function guardar() {
    const n = Number(valor)
    if (!Number.isFinite(n) || n < 0) { setValor(String(item.cantidad_completada)); return }
    onCantidad(Math.min(n, item.cantidad))
  }

  return (
    <div style={{ padding: '9px 10px', background: 'var(--surface-alt)', borderRadius: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: esBinario ? 0 : 6 }}>
        {esBinario && (
          <input
            type="checkbox"
            checked={completo}
            onChange={e => onCantidad(e.target.checked ? item.cantidad : 0)}
            style={{ width: 18, height: 18, flexShrink: 0, accentColor: 'var(--primary)', cursor: 'pointer' }}
          />
        )}
        <span style={{ flex: 1, fontSize: 13, textDecoration: completo ? 'line-through' : 'none', color: completo ? 'var(--muted)' : 'var(--text)' }}>
          {item.descripcion}
        </span>
        {mostrarPrecio && (
          <span style={{ fontSize: 12, color: 'var(--muted)', fontVariantNumeric: 'tabular-nums', flexShrink: 0 }}>{fmtMoney(item.total)}</span>
        )}
      </div>
      {!esBinario && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <input
            type="number" min={0} max={item.cantidad} step="any"
            value={valor}
            onChange={e => setValor(e.target.value)}
            onBlur={guardar}
            style={{ width: 56, padding: '4px 6px', fontSize: 12.5, textAlign: 'right' }}
          />
          <span style={{ fontSize: 11.5, color: 'var(--muted)', flexShrink: 0 }}>/ {item.cantidad}</span>
          <div style={{ flex: 1, height: 5, background: 'var(--border)', borderRadius: 3, overflow: 'hidden' }}>
            <div style={{ height: '100%', width: `${pct}%`, background: colorPct, transition: 'width 0.2s' }} />
          </div>
          <span className="font-display" style={{ fontSize: 11, fontWeight: 700, color: colorPct, width: 30, textAlign: 'right', flexShrink: 0 }}>{pct}%</span>
          {!completo && (
            <button
              onClick={() => onCantidad(item.cantidad)}
              style={{ fontSize: 11, fontWeight: 700, color: 'var(--primary)', background: 'none', border: 'none', cursor: 'pointer', padding: 0, flexShrink: 0 }}
            >
              Listo
            </button>
          )}
        </div>
      )}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 6 }}>
        {onFase && fases && fases.length > 0 && (
          <select
            value={item.fase || ''}
            onChange={e => onFase(e.target.value || null)}
            style={{ fontSize: 11.5, padding: '3px 6px', width: 'auto' }}
          >
            <option value="">Sin fase</option>
            {fases.map(f => <option key={f.id} value={f.nombre}>{f.nombre}</option>)}
          </select>
        )}
        {onBorrar && (
          <button onClick={onBorrar} style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--danger)', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
            Borrar
          </button>
        )}
      </div>
    </div>
  )
}

// Días de atraso/adelanto de una fase, derivado de la bitácora vs. su fecha_fin
// planificada. Ver progress/decisiones.md 2026-08-28. Simplificación de v1, avisada a
// Alexandra: la "fecha real de fin" de una fase completa se toma como el MAX(fecha) de
// TODOS los registros de esa fase una vez que llegó a 100% -- no se reconstruye día por
// día cuál registro exacto fue el que hizo que el último ítem cerrara. Para una fase
// todavía en curso que ya pasó su fecha planificada, se muestra el atraso acumulado a hoy.
function calcularAtrasoFase(fase: ObraFase, items: ObraItem[], registros: ObraAvanceRegistro[]): { dias: number; tipo: 'atraso' | 'adelanto' } | null {
  if (!fase.fecha_fin) return null
  const itemsFase = items.filter(it => (it.fase || '') === fase.nombre)
  if (itemsFase.length === 0) return null
  const itemIds = new Set(itemsFase.map(it => it.id))
  const registrosFase = registros.filter(r => itemIds.has(r.item_id))
  if (registrosFase.length === 0) return null

  const faseCompleta = itemsFase.every(it => it.cantidad_completada >= it.cantidad)
  const fechaFinPlan = parseFechaObra(fase.fecha_fin)

  let fechaComparar: Date
  if (faseCompleta) {
    const fechas = registrosFase.map(r => parseFechaObra(r.fecha).getTime())
    fechaComparar = new Date(Math.max(...fechas))
  } else {
    const hoy = new Date()
    hoy.setHours(0, 0, 0, 0)
    if (hoy <= fechaFinPlan) return null // en curso, todavía dentro del plazo
    fechaComparar = hoy
  }

  const dias = Math.round((fechaComparar.getTime() - fechaFinPlan.getTime()) / 86400000)
  if (dias === 0) return null
  return { dias: Math.abs(dias), tipo: dias > 0 ? 'atraso' : 'adelanto' }
}

function FaseEditorRow({ fase, atraso, onFecha, onBorrar }: {
  fase: ObraFase
  atraso?: { dias: number; tipo: 'atraso' | 'adelanto' } | null
  onFecha: (campo: 'fecha_inicio' | 'fecha_fin', valor: string) => void
  onBorrar: () => void
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', padding: '8px 10px', background: 'var(--surface-alt)', borderRadius: 8 }}>
      <span style={{ fontSize: 13, fontWeight: 600, flex: 1, minWidth: 120 }}>{fase.nombre}</span>
      {atraso && (
        <span style={{
          fontSize: 11, fontWeight: 700, padding: '3px 9px', borderRadius: 20, flexShrink: 0,
          background: atraso.tipo === 'atraso' ? 'rgba(200,64,32,0.14)' : 'rgba(31,107,63,0.14)',
          color: atraso.tipo === 'atraso' ? 'var(--danger)' : '#1f6b3f',
        }}>
          {atraso.dias} día{atraso.dias !== 1 ? 's' : ''} de {atraso.tipo === 'atraso' ? 'atraso' : 'adelanto'}
        </span>
      )}
      <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: 'var(--muted)' }}>
        Inicio
        <input type="date" value={fase.fecha_inicio || ''} onChange={e => onFecha('fecha_inicio', e.target.value)} style={{ fontSize: 12, padding: '3px 6px', width: 'auto' }} />
      </label>
      <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: 'var(--muted)' }}>
        Fin
        <input type="date" value={fase.fecha_fin || ''} onChange={e => onFecha('fecha_fin', e.target.value)} style={{ fontSize: 12, padding: '3px 6px', width: 'auto' }} />
      </label>
      <button onClick={onBorrar} className="btn btn-ghost" style={{ fontSize: 11, padding: '4px 8px' }}>Borrar</button>
    </div>
  )
}

export function PanelAvanceObra({ obraId, presupuestoTotal = null, presupuestoId = null, nombre, cliente = null }: { obraId: string; presupuestoTotal?: number | null; presupuestoId?: string | null; nombre: string; cliente?: string | null }) {
  const [items, setItems] = useState<ObraItem[]>([])
  const [fases, setFases] = useState<ObraFase[]>([])
  const [registros, setRegistros] = useState<ObraAvanceRegistro[]>([])
  const [loading, setLoading] = useState(true)
  const [nuevaFase, setNuevaFase] = useState('')
  const [nuevoItem, setNuevoItem] = useState({ descripcion: '', cantidad: '1', precio_unitario: '', fase: '' })
  const [guardandoItem, setGuardandoItem] = useState(false)

  const cargar = useCallback(async () => {
    const [{ data: it }, { data: fa }, { data: reg }] = await Promise.all([
      supabase.from('obra_items').select('*').eq('obra_id', obraId).order('orden'),
      supabase.from('obra_fases').select('*').eq('obra_id', obraId).order('orden'),
      // Tabla nueva (obra_avance_registros) -- si todavía no se corrió la migración, esto
      // vuelve con error y `reg` queda undefined/null: se degrada a [] sin romper el resto
      // de la pantalla (la Agenda y las fases se siguen viendo, solo sin badges de atraso).
      supabase.from('obra_avance_registros').select('*').eq('obra_id', obraId).order('fecha'),
    ])
    setItems((it as ObraItem[]) || [])
    setFases((fa as ObraFase[]) || [])
    setRegistros((reg as ObraAvanceRegistro[]) || [])
    setLoading(false)
  }, [obraId])

  useEffect(() => { cargar() }, [cargar])

  // `cantidad_completada` ya no se escribe directo -- se inserta el delta como una fila
  // nueva en la bitácora (obra_avance_registros) y un trigger de Postgres recalcula el
  // campo cacheado del ítem. Ver progress/decisiones.md 2026-08-28. El estado local se
  // sigue actualizando optimista para que la UI responda al toque.
  async function actualizarCantidad(item: ObraItem, cantidad: number) {
    const delta = cantidad - item.cantidad_completada
    setItems(prev => prev.map(x => x.id === item.id ? { ...x, cantidad_completada: cantidad } : x))
    if (delta === 0) return
    const { error } = await supabase.from('obra_avance_registros').insert({
      obra_id: obraId,
      item_id: item.id,
      cantidad_avanzada: delta,
    })
    if (error) { alert('No se pudo actualizar. Intenta de nuevo.'); cargar() }
  }

  // Cubre el caso más común de esta obra en particular: presupuestos "externos" (PDF/foto
  // subida a mano) solo traen el monto total, nunca el detalle línea por línea -- así que
  // no hay nada que copiar automáticamente. Esto deja cargar los ítems a mano, para no
  // depender de que el presupuesto haya sido hecho "por etapas" en la app.
  async function agregarItem() {
    if (!nuevoItem.descripcion.trim()) { alert('Completa la descripción del ítem.'); return }
    const cantidad = Number(nuevoItem.cantidad)
    if (!Number.isFinite(cantidad) || cantidad <= 0) { alert('La cantidad tiene que ser un número mayor a cero.'); return }
    const precioUnitario = Number(nuevoItem.precio_unitario || 0)
    if (!Number.isFinite(precioUnitario) || precioUnitario < 0) { alert('El precio unitario tiene que ser un número (o dejarlo vacío si no lo sabes).'); return }
    setGuardandoItem(true)
    const { error } = await supabase.from('obra_items').insert({
      obra_id: obraId,
      fase: nuevoItem.fase || null,
      descripcion: nuevoItem.descripcion.trim(),
      categoria: null,
      cantidad,
      precio_unitario: precioUnitario,
      total: cantidad * precioUnitario,
      cantidad_completada: 0,
      orden: items.length,
    })
    setGuardandoItem(false)
    if (error) { alert('No se pudo guardar el ítem. Intenta de nuevo.'); return }
    setNuevoItem({ descripcion: '', cantidad: '1', precio_unitario: '', fase: nuevoItem.fase })
    cargar()
  }

  async function borrarItem(item: ObraItem) {
    if (!window.confirm(`¿Borrar "${item.descripcion}"? No se puede deshacer.`)) return
    const { error } = await supabase.from('obra_items').delete().eq('id', item.id)
    if (error) { alert('No se pudo borrar. Intenta de nuevo.'); return }
    cargar()
  }

  async function actualizarFaseItem(item: ObraItem, fase: string | null) {
    setItems(prev => prev.map(x => x.id === item.id ? { ...x, fase } : x))
    const { error } = await supabase.from('obra_items').update({ fase }).eq('id', item.id)
    if (error) { alert('No se pudo actualizar. Intenta de nuevo.'); cargar() }
  }

  async function crearFase() {
    if (!nuevaFase.trim()) return
    const { error } = await supabase.from('obra_fases').insert({ obra_id: obraId, nombre: nuevaFase.trim(), orden: fases.length })
    if (error) { alert('No se pudo crear la fase (puede que ya exista una con ese nombre).'); return }
    setNuevaFase('')
    cargar()
  }

  async function actualizarFechaFase(fase: ObraFase, campo: 'fecha_inicio' | 'fecha_fin', valor: string) {
    setFases(prev => prev.map(f => f.id === fase.id ? { ...f, [campo]: valor || null } : f))
    const { error } = await supabase.from('obra_fases').update({ [campo]: valor || null }).eq('id', fase.id)
    if (error) { alert('No se pudo guardar la fecha. Intenta de nuevo.'); cargar() }
  }

  async function borrarFase(fase: ObraFase) {
    if (!window.confirm(`¿Borrar la fase "${fase.nombre}"? Los ítems que estaban en esa fase quedan sin fase, no se borran.`)) return
    await supabase.from('obra_items').update({ fase: null }).eq('obra_id', obraId).eq('fase', fase.nombre)
    const { error } = await supabase.from('obra_fases').delete().eq('id', fase.id)
    if (error) { alert('No se pudo borrar. Intenta de nuevo.'); return }
    cargar()
  }

  if (loading) return <div className="spinner" style={{ margin: '16px auto' }} />

  const totalMonto = items.reduce((s, it) => s + it.total, 0)
  const montoCompletado = items.reduce((s, it) => s + (it.cantidad > 0 ? (it.cantidad_completada / it.cantidad) * it.total : 0), 0)
  const pct = totalMonto > 0 ? Math.round((montoCompletado / totalMonto) * 100) : 0
  const colorPct = pct >= 100 ? 'var(--success)' : 'var(--primary)'

  const nombresFase = Array.from(new Set(items.map(it => it.fase || '')))
  const hayFases = nombresFase.some(f => f !== '')
  const grupos = hayFases
    ? nombresFase.map(fase => ({ fase, items: items.filter(it => (it.fase || '') === fase) }))
    : [{ fase: '', items }]

  return (
    <div>
      {items.length === 0 ? (
        <div style={{ marginBottom: 16 }}>
          <p style={{ fontSize: 13, color: 'var(--muted)', padding: '4px 0', marginBottom: presupuestoId ? 0 : 10 }}>
            Esta obra todavía no tiene ítems cargados — agrégalos a mano abajo, o subí el presupuesto para que la IA lo lea.
          </p>
          {!presupuestoId && (
            <CargarPresupuestoObra obra={{ id: obraId, nombre, cliente }} onGuardado={cargar} />
          )}
        </div>
      ) : (
        <div style={{ marginBottom: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6 }}>
            <span style={{ fontSize: 13, fontWeight: 700 }}>Avance</span>
            <span className="font-display" style={{ fontSize: 15, fontWeight: 800, color: colorPct }}>{pct}%</span>
          </div>
          <div style={{ height: 8, background: 'var(--border)', borderRadius: 4, overflow: 'hidden' }}>
            <div style={{ height: '100%', width: `${pct}%`, background: colorPct, transition: 'width 0.2s' }} />
          </div>
          <p style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>{fmtMoney(montoCompletado)} de {fmtMoney(totalMonto)} completado</p>
        </div>
      )}

      {/* Si los ítems no suman lo mismo que el presupuesto de la obra: primero se descarta
          que la diferencia sea gastos generales + IVA (matemática normal, no falta nada) --
          solo si NO cuadra con eso se avisa como posible ítem sin desglosar. Pasa seguido
          con presupuestos externos, donde la IA lee bien el total pero el desglose que
          encuentra es el neto de materiales/mano de obra, sin el margen ni el impuesto. */}
      {presupuestoTotal != null && items.length > 0 && Math.abs(presupuestoTotal - totalMonto) > 1000 && (() => {
        const ggIva = detectarGGeIVA(totalMonto, presupuestoTotal)
        return ggIva ? (
          <div style={{ marginBottom: 16, padding: 12, background: '#eaf4ee', border: '1px solid #7fb894', borderRadius: 8 }}>
            <p style={{ fontSize: 12.5, fontWeight: 700, color: '#1f6b3f', marginBottom: 4 }}>
              La diferencia es gastos generales + IVA, no un ítem faltante
            </p>
            <p style={{ fontSize: 12, color: '#1f6b3f' }}>
              Ítems (neto): {fmtMoney(totalMonto)} · Gastos generales ({ggIva.pct}%): {fmtMoney(ggIva.gg)} · IVA (19%): {fmtMoney(ggIva.iva)} · Total: {fmtMoney(presupuestoTotal)}
            </p>
          </div>
        ) : (
          <div style={{ marginBottom: 16, padding: 12, background: '#fef2e0', border: '1px solid #e8a33d', borderRadius: 8 }}>
            <p style={{ fontSize: 12.5, fontWeight: 700, color: '#7a5210', marginBottom: 4 }}>
              Los ítems no suman lo mismo que el presupuesto de la obra
            </p>
            <p style={{ fontSize: 12, color: '#7a5210', marginBottom: 8 }}>
              Ítems: {fmtMoney(totalMonto)} · Presupuesto de la obra: {fmtMoney(presupuestoTotal)} · Diferencia sin desglosar: {fmtMoney(presupuestoTotal - totalMonto)}
            </p>
            <button
              onClick={() => setNuevoItem(p => ({ ...p, descripcion: p.descripcion || 'Otros / sin desglosar', cantidad: '1', precio_unitario: String(Math.round(presupuestoTotal - totalMonto)) }))}
              style={{ fontSize: 12, fontWeight: 700, color: '#7a5210', background: 'none', border: '1px solid #e8a33d', borderRadius: 6, padding: '5px 10px', cursor: 'pointer' }}
            >
              Completar el formulario de abajo con la diferencia
            </button>
          </div>
        )
      })()}

      {/* Agenda por fase — esto es lo que se dibuja como carta Gantt semanal */}
      <div style={{ marginBottom: 18 }}>
        <p className="font-display" style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 8 }}>
          Agenda
        </p>
        <GanttSemanal fases={fases} items={items} />
        {fases.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 10 }}>
            {fases.map(f => (
              <FaseEditorRow
                key={f.id}
                fase={f}
                atraso={calcularAtrasoFase(f, items, registros)}
                onFecha={(campo, valor) => actualizarFechaFase(f, campo, valor)}
                onBorrar={() => borrarFase(f)}
              />
            ))}
          </div>
        )}
        <div style={{ display: 'flex', gap: 6 }}>
          <input
            type="text" placeholder="Nombre de la fase (ej: Instalaciones y Protecciones)"
            value={nuevaFase} onChange={e => setNuevaFase(e.target.value)}
            style={{ flex: 1, fontSize: 13, padding: '6px 10px' }}
          />
          <button onClick={crearFase} className="btn btn-secondary" style={{ fontSize: 12, padding: '6px 12px', flexShrink: 0 }}>+ Fase</button>
        </div>
      </div>

      {/* Ítems, agrupados por fase */}
      {items.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14, marginBottom: 18 }}>
          {grupos.map(g => (
            <div key={g.fase}>
              {g.fase && (
                <p className="font-display" style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 6 }}>
                  {g.fase}
                </p>
              )}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {g.items.map(it => (
                  <ItemAvanceRow
                    key={it.id}
                    item={it}
                    fases={fases}
                    onCantidad={c => actualizarCantidad(it, c)}
                    onFase={f => actualizarFaseItem(it, f)}
                    onBorrar={() => borrarItem(it)}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Agregar ítem a mano -- cubre presupuestos "externos" (sin detalle) y obras sin presupuesto vinculado */}
      <div>
        <p className="font-display" style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 8 }}>
          Agregar ítem
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <input
            type="text" placeholder="Descripción (ej: Instalación de tablero)"
            value={nuevoItem.descripcion} onChange={e => setNuevoItem(p => ({ ...p, descripcion: e.target.value }))}
            style={{ fontSize: 13, padding: '7px 10px' }}
          />
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              type="number" min="0" step="any" placeholder="Cantidad"
              value={nuevoItem.cantidad} onChange={e => setNuevoItem(p => ({ ...p, cantidad: e.target.value }))}
              style={{ flex: 1, fontSize: 13, padding: '7px 10px' }}
            />
            <input
              type="number" min="0" placeholder="Precio unitario (opcional)"
              value={nuevoItem.precio_unitario} onChange={e => setNuevoItem(p => ({ ...p, precio_unitario: e.target.value }))}
              style={{ flex: 1, fontSize: 13, padding: '7px 10px' }}
            />
            {fases.length > 0 && (
              <select
                value={nuevoItem.fase} onChange={e => setNuevoItem(p => ({ ...p, fase: e.target.value }))}
                style={{ flex: 1, fontSize: 13, padding: '7px 10px' }}
              >
                <option value="">Sin fase</option>
                {fases.map(f => <option key={f.id} value={f.nombre}>{f.nombre}</option>)}
              </select>
            )}
          </div>
          <button onClick={agregarItem} disabled={guardandoItem} className="btn btn-secondary" style={{ fontSize: 13, padding: '8px 12px' }}>
            {guardandoItem ? 'Guardando...' : '+ Agregar ítem'}
          </button>
        </div>
      </div>
    </div>
  )
}

// Vista de campo para Fabriel/Misael (colgada de /obra-fotos, mismo token que ya
// usan): sin precios -- a ellos les importa la cantidad, no la plata -- agrupada por
// fase primero, y SÍ pueden actualizar cuánto llevan hecho (son quienes instalan de
// verdad, es el reporte de campo real, mismo criterio de confianza que ya tienen con
// el Reporte Diario). No pueden crear/editar fases ni fechas -- eso lo decide Gustavo.
export function PanelAvanceObraCampo({ obraId, trabajador }: { obraId: string; trabajador: string }) {
  const [items, setItems] = useState<ObraItem[]>([])
  const [fases, setFases] = useState<ObraFase[]>([])
  const [loading, setLoading] = useState(true)
  // Un solo selector de fecha arriba de la lista (no por fila) -- la fecha que se manda
  // en la bitácora para todo lo que se cargue en esta visita. Default: hoy.
  const [fecha, setFecha] = useState(() => new Date().toISOString().slice(0, 10))

  const cargar = useCallback(async () => {
    const [{ data: it }, { data: fa }] = await Promise.all([
      supabase.from('obra_items').select('*').eq('obra_id', obraId).order('orden'),
      supabase.from('obra_fases').select('*').eq('obra_id', obraId).order('orden'),
    ])
    setItems((it as ObraItem[]) || [])
    setFases((fa as ObraFase[]) || [])
    setLoading(false)
  }, [obraId])

  useEffect(() => { cargar() }, [cargar])

  // Mismo criterio que en PanelAvanceObra: el delta se inserta en la bitácora, nunca se
  // escribe cantidad_completada directo -- el trigger de Postgres se encarga.
  async function actualizarCantidad(item: ObraItem, cantidad: number) {
    const delta = cantidad - item.cantidad_completada
    setItems(prev => prev.map(x => x.id === item.id ? { ...x, cantidad_completada: cantidad } : x))
    if (delta === 0) return
    const { error } = await supabase.from('obra_avance_registros').insert({
      obra_id: obraId,
      item_id: item.id,
      fecha,
      cantidad_avanzada: delta,
      trabajador,
    })
    if (error) { alert('No se pudo actualizar. Intenta de nuevo.'); cargar() }
  }

  if (loading) return <div className="spinner" style={{ margin: '16px auto' }} />

  if (items.length === 0) {
    return (
      <p style={{ fontSize: 14, color: 'var(--muted)', textAlign: 'center', padding: '2rem 0' }}>
        Esta obra todavía no tiene ítems de avance cargados.
      </p>
    )
  }

  const nombresFase = Array.from(new Set(items.map(it => it.fase || '')))
  const hayFases = nombresFase.some(f => f !== '')
  const grupos = hayFases
    ? nombresFase.map(fase => ({ fase, items: items.filter(it => (it.fase || '') === fase) }))
    : [{ fase: '', items }]

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>
        Fecha del avance
        <input
          type="date"
          value={fecha}
          onChange={e => setFecha(e.target.value)}
          style={{ fontSize: 13, padding: '6px 10px', width: 'auto' }}
        />
      </label>
      {grupos.map(g => {
        const faseInfo = fases.find(f => f.nombre === g.fase)
        return (
          <div key={g.fase}>
            {g.fase && (
              <div style={{ marginBottom: 8 }}>
                <p className="font-display" style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>{g.fase}</p>
                {faseInfo?.fecha_inicio && faseInfo?.fecha_fin && (
                  <p style={{ fontSize: 11, color: 'var(--muted)' }}>
                    {parseFechaObra(faseInfo.fecha_inicio).toLocaleDateString('es-CL', { day: '2-digit', month: 'short' })} al {parseFechaObra(faseInfo.fecha_fin).toLocaleDateString('es-CL', { day: '2-digit', month: 'short' })}
                  </p>
                )}
              </div>
            )}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {g.items.map(it => (
                <ItemAvanceRow key={it.id} item={it} onCantidad={c => actualizarCantidad(it, c)} mostrarPrecio={false} />
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}

// Pestaña propia (no vive adentro de la card de cada obra en "Obras" -- ahí ya hay
// demasiado detalle apilado, ver conversación con Alexandra 28/08/2026): selector de
// obra + el checklist de arriba para la que se elija.
export function PanelAvanceObras() {
  const [obras, setObras] = useState<Obra[]>([])
  const [obraId, setObraId] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    supabase.from('obras').select('*').order('nombre').then(({ data }) => {
      const lista = (data as Obra[]) || []
      setObras(lista)
      setObraId(prev => prev || lista.find(o => o.estado_obra === 'en_curso')?.id || lista[0]?.id || '')
      setLoading(false)
    })
  }, [])

  if (loading) return <div className="spinner" />

  if (obras.length === 0) {
    return <p style={{ color: 'var(--muted-inverse)', fontSize: 14 }}>Todavía no hay obras cargadas.</p>
  }

  return (
    <div>
      <div style={{ marginBottom: 16 }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, fontWeight: 600, color: 'var(--text-inverse)' }}>
          Obra:
          <select
            value={obraId}
            onChange={e => setObraId(e.target.value)}
            style={{
              width: 'auto', padding: '6px 10px', fontSize: 13, fontWeight: 600, borderRadius: 6,
              border: '1.5px solid var(--primary)', background: 'var(--white)', color: 'var(--secondary)',
              cursor: 'pointer', appearance: 'auto',
            }}
          >
            {obras.map(o => (
              <option key={o.id} value={o.id}>{o.nombre}{o.estado_obra !== 'en_curso' ? ` (${ESTADO_OBRA_LABELS[o.estado_obra]})` : ''}</option>
            ))}
          </select>
        </label>
      </div>

      {obraId && (() => {
        const obra = obras.find(o => o.id === obraId)
        return (
          <div className="card" style={{ padding: '18px 20px' }}>
            <PanelAvanceObra
              obraId={obraId}
              presupuestoTotal={obra?.presupuesto_total ?? null}
              presupuestoId={obra?.presupuesto_id ?? null}
              nombre={obra?.nombre ?? ''}
              cliente={obra?.cliente ?? null}
            />
          </div>
        )
      })()}
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
                  <div key={g.id} style={{ display: 'flex', alignItems: 'center', gap: 10, background: 'var(--surface-alt)', borderRadius: 8, padding: '8px 12px', fontSize: 13, opacity: g.activo ? 1 : 0.5 }}>
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
                  <div key={g.id} style={{ display: 'flex', alignItems: 'center', gap: 10, background: 'var(--surface-alt)', borderRadius: 8, padding: '8px 12px', fontSize: 13 }}>
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

      <div className="card" style={{ padding: '22px 24px', boxShadow: 'var(--shadow-md)' }}>
        <p className="font-display" style={{ fontSize: 12, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.6px', marginBottom: 6 }}>
          {obraFiltro ? `Utilidad operativa (sin gastos generales) — ${obraFiltro}` : 'Resultado del mes'}
        </p>
        <p className="font-display" style={{ fontSize: 34, fontWeight: 800, color: resultado >= 0 ? 'var(--success)' : 'var(--danger)', fontVariantNumeric: 'tabular-nums' }}>
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
  { titulo: 'Falta por cobrar', texto: 'Cuánto le queda debiendo el cliente por esta obra, en total — suma todo lo pendiente de sus cuentas por cobrar (puedes ver el detalle de cada una en "Detalle").' },
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

/* ─── Cálculo compartido de una fila de pago semanal ──── */
// Usado por PanelPagoSemanal (semana en curso, con formularios para cargar) y por
// PanelHistorialPagos (semanas pasadas, solo lectura) -- una sola fuente de verdad
// para que "cuánto se le debe a alguien esta semana" nunca se calcule distinto en
// los dos lugares donde se muestra.
export interface FilaPagoSemanal {
  trabajador: string
  sueldoFijo: boolean
  dias: number
  ganado: number
  viatico: number
  calculado: number // ganado + viático, sin ajustes ni adelantos
  ajustes: AjustePagoSemanal[]
  totalAjustes: number
  // Adelantos que efectivamente restan del Neto de esta fila -- vacío si es sueldo
  // fijo, porque su adelanto se descuenta de su sueldo MENSUAL, no de esta semana.
  adelantosQueRestan: AdelantoTrabajador[]
  totalAdelantosQueRestan: number
  neto: number
  diasDetalle: DiaDetallePago[]
}

// Desglose día por día de una fila de pago semanal -- para que se pueda ver de
// dónde sale el "ganado"/"viático" sin tener que pedir la cuenta a mano.
export interface DiaDetallePago {
  fecha: string
  obra: string | null
  fraccionJornada: number
  ganado: number
  viatico: number
}

// Rango lunes-domingo (mismas fechas 'YYYY-MM-DD' que usa `getPeriodo`) de una
// semana a partir de su key (el lunes).
export function semanaRango(semanaKey: string): { inicio: string; fin: string } {
  const [y, m, d] = semanaKey.split('-').map(Number)
  const monday = new Date(y, m - 1, d)
  const sunday = new Date(monday)
  sunday.setDate(monday.getDate() + 6)
  const fin = `${sunday.getFullYear()}-${String(sunday.getMonth() + 1).padStart(2, '0')}-${String(sunday.getDate()).padStart(2, '0')}`
  return { inicio: semanaKey, fin }
}

export function calcularFilaPagoSemanal(
  t: Trabajador,
  diariosPresentes: ReporteTrabajadorDia[],
  ajustesDeLaSemana: AjustePagoSemanal[],
  adelantosDeLaSemana: AdelantoTrabajador[],
): FilaPagoSemanal {
  const sueldoFijo = t.tarifa_diaria === 0
  const dias = diariosPresentes.reduce((s, d) => s + d.fraccion_jornada, 0)
  const ganado = sueldoFijo ? 0 : diariosPresentes.reduce((s, d) => s + d.fraccion_jornada * t.tarifa_diaria, 0)
  const viatico = diariosPresentes.reduce((s, d) => s + (d.viatico ? t.viatico_diario : 0), 0)
  const calculado = ganado + viatico
  const totalAjustes = ajustesDeLaSemana.reduce((s, a) => s + a.monto, 0)
  const adelantosQueRestan = sueldoFijo ? [] : adelantosDeLaSemana
  const totalAdelantosQueRestan = adelantosQueRestan.reduce((s, a) => s + a.monto, 0)
  const neto = calculado + totalAjustes - totalAdelantosQueRestan
  const diasDetalle: DiaDetallePago[] = diariosPresentes
    .slice()
    .sort((a, b) => a.fecha.localeCompare(b.fecha))
    .map(d => ({
      fecha: d.fecha,
      obra: d.obra,
      fraccionJornada: d.fraccion_jornada,
      ganado: sueldoFijo ? 0 : d.fraccion_jornada * t.tarifa_diaria,
      viatico: d.viatico ? t.viatico_diario : 0,
    }))
  return {
    trabajador: t.nombre, sueldoFijo, dias, ganado, viatico, calculado,
    ajustes: ajustesDeLaSemana, totalAjustes, adelantosQueRestan, totalAdelantosQueRestan, neto, diasDetalle,
  }
}

/* ─── Desglose día por día de una fila de pago semanal, colapsado por defecto ──── */
function DesgloseDiasToggle({ fila }: { fila: FilaPagoSemanal }) {
  const [abierto, setAbierto] = useState(false)
  return (
    <div style={{ marginTop: 8 }}>
      <button
        onClick={() => setAbierto(a => !a)}
        style={{ background: 'none', border: '1px solid var(--border)', borderRadius: 8, padding: '6px 10px', fontSize: 12, fontWeight: 600, cursor: 'pointer', color: 'var(--muted)' }}
      >{abierto ? '▲' : '▾'} Ver desglose por día</button>
      {abierto && (
        <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 4 }}>
          {fila.diasDetalle.length === 0 ? (
            <p style={{ fontSize: 12, color: 'var(--muted)' }}>Sin días registrados esa semana.</p>
          ) : fila.diasDetalle.map(d => (
            <div key={d.fecha} style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 12, padding: '5px 8px', background: 'var(--surface-alt)', borderRadius: 6 }}>
              <span style={{ color: 'var(--muted)', width: 68, flexShrink: 0 }}>{d.fecha.split('-').reverse().join('/')}</span>
              <span style={{ flex: 1 }}>{d.fraccionJornada === 1 ? 'Día completo' : d.fraccionJornada === 0.5 ? 'Medio día' : `Jornada ${d.fraccionJornada}`}{d.obra ? ` · ${d.obra}` : ''}</span>
              {!fila.sueldoFijo && <span style={{ fontWeight: 700 }}>{fmtMoney(d.ganado)}</span>}
              {d.viatico > 0 && <span style={{ color: 'var(--primary)', fontWeight: 600 }}>+{fmtMoney(d.viatico)} viático</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

/* ─── Comprobante de pago semanal (uno por fila de trabajador/semana) ──── */
function ComprobanteCelda({ trabajador, semanaKey, montoCalculado, comprobante, onSubido }: {
  trabajador: string
  semanaKey: string
  montoCalculado: number
  comprobante: PagoSemanalComprobante | null
  onSubido: () => void
}) {
  const [subiendo, setSubiendo] = useState(false)

  async function subir(e: React.ChangeEvent<HTMLInputElement>) {
    const archivo = e.target.files?.[0]
    e.target.value = ''
    if (!archivo) return
    setSubiendo(true)
    try {
      const ext = archivo.name.split('.').pop() || 'jpg'
      const filename = `comprobante-pago-${trabajador.replace(/\s+/g, '_')}-${Date.now()}.${ext}`
      const { data, error } = await supabase.storage.from('audio-notas').upload(filename, archivo, { contentType: archivo.type })
      if (error) {
        alert('Error al subir la captura: ' + error.message)
        return
      }
      const { data: urlData } = supabase.storage.from('audio-notas').getPublicUrl(data.path)

      let montoLeido: number | null = null
      try {
        const res = await fetch('/api/parse-comprobante', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url: urlData.publicUrl }),
        })
        const resultado = await res.json()
        if (!res.ok) throw new Error(resultado.error || 'error desconocido')
        montoLeido = resultado.monto != null ? Number(resultado.monto) : null
      } catch (err) {
        alert('La captura se guardó, pero la IA no pudo leerla (' + String(err) + '). Se guarda sin monto leído.')
      }

      const { error: insertError } = await supabase.from('pago_semanal_comprobantes').insert({
        trabajador, semana_key: semanaKey, captura_url: urlData.publicUrl,
        monto_leido: montoLeido, monto_calculado: montoCalculado,
      })
      if (insertError) {
        alert('Error al guardar el comprobante: ' + insertError.message)
        return
      }
      onSubido()
    } finally {
      setSubiendo(false)
    }
  }

  const coincide = comprobante?.monto_leido != null && comprobante?.monto_calculado != null
    ? Math.round(comprobante.monto_leido) === Math.round(comprobante.monto_calculado)
    : null

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
      {comprobante && (
        coincide === true ? (
          <a
            href={comprobante.captura_url} target="_blank" rel="noreferrer"
            style={{ fontSize: 11, fontWeight: 700, color: 'var(--success)', textDecoration: 'none' }}
            title="Ver captura"
          >
            ✓ Coincide
          </a>
        ) : coincide === false ? (
          <a
            href={comprobante.captura_url} target="_blank" rel="noreferrer"
            style={{
              fontSize: 11, fontWeight: 700, color: 'var(--danger)', textDecoration: 'none',
              background: '#fee2e2', border: '1px solid #fecaca', borderRadius: 6, padding: '2px 6px',
            }}
            title="Ver captura"
          >
            ⚠ No coincide: comprobante {fmtMoney(comprobante.monto_leido!)} · calculado {fmtMoney(comprobante.monto_calculado!)}
          </a>
        ) : (
          <a
            href={comprobante.captura_url} target="_blank" rel="noreferrer"
            style={{ fontSize: 11, fontWeight: 600, color: 'var(--muted)', textDecoration: 'none' }}
            title="Ver captura"
          >
            Captura sin monto leído
          </a>
        )
      )}
      <label
        className="btn btn-ghost"
        style={{ fontSize: 11, padding: '4px 8px', cursor: subiendo ? 'default' : 'pointer', opacity: subiendo ? 0.6 : 1 }}
      >
        {subiendo ? 'Subiendo...' : comprobante ? '+ Reemplazar' : '+ Comprobante'}
        <input type="file" accept="image/*" onChange={subir} disabled={subiendo} style={{ display: 'none' }} />
      </label>
    </div>
  )
}

/* ─── Pago semanal a trabajadores (todas las obras) ──── */
// Fila expandible con el detalle de ajustes/adelantos de la semana y los formularios
// chicos para cargar uno nuevo -- usado solo por PanelPagoSemanal (donde SÍ se puede
// cargar), PanelHistorialPagos solo muestra el detalle ya cargado, sin formularios.
function DetalleAjustesAdelantos({ fila, semanaKey, onGuardado }: { fila: FilaPagoSemanal; semanaKey: string; onGuardado: () => void }) {
  const [formAbierto, setFormAbierto] = useState<'ajuste' | 'adelanto' | null>(null)
  const [montoAjuste, setMontoAjuste] = useState('')
  const [motivoAjuste, setMotivoAjuste] = useState('')
  const [montoAdelanto, setMontoAdelanto] = useState('')
  const [fechaAdelanto, setFechaAdelanto] = useState(() => new Date().toISOString().slice(0, 10))
  const [notaAdelanto, setNotaAdelanto] = useState('')
  const [comprobanteAdelantoUrl, setComprobanteAdelantoUrl] = useState<string | null>(null)
  const [subiendoComprobante, setSubiendoComprobante] = useState(false)
  const [guardando, setGuardando] = useState(false)

  async function guardarAjuste() {
    const monto = Number(montoAjuste)
    if (!Number.isFinite(monto) || monto === 0) { alert('El monto tiene que ser un número distinto de cero.'); return }
    if (!motivoAjuste.trim()) { alert('Escribe el motivo del ajuste.'); return }
    setGuardando(true)
    const { error } = await supabase.from('ajustes_pago_semanal').insert({
      trabajador: fila.trabajador, semana_key: semanaKey, monto, motivo: motivoAjuste.trim(),
    })
    setGuardando(false)
    if (error) { alert('No se pudo guardar el ajuste: ' + error.message); return }
    setMontoAjuste(''); setMotivoAjuste(''); setFormAbierto(null)
    onGuardado()
  }

  async function subirComprobanteAdelanto(e: React.ChangeEvent<HTMLInputElement>) {
    const archivo = e.target.files?.[0]
    e.target.value = ''
    if (!archivo) return
    setSubiendoComprobante(true)
    try {
      const ext = archivo.name.split('.').pop() || 'jpg'
      const filename = `adelanto-${fila.trabajador.replace(/\s+/g, '_')}-${Date.now()}.${ext}`
      const { data, error } = await supabase.storage.from('audio-notas').upload(filename, archivo, { contentType: archivo.type })
      if (error) { alert('Error al subir el comprobante: ' + error.message); return }
      const { data: urlData } = supabase.storage.from('audio-notas').getPublicUrl(data.path)
      setComprobanteAdelantoUrl(urlData.publicUrl)
    } finally {
      setSubiendoComprobante(false)
    }
  }

  async function guardarAdelanto() {
    const monto = Number(montoAdelanto)
    if (!Number.isFinite(monto) || monto <= 0) { alert('El monto tiene que ser un número mayor a cero.'); return }
    if (!fechaAdelanto) { alert('Elige la fecha del adelanto.'); return }
    setGuardando(true)
    const { error } = await supabase.from('adelantos_trabajador').insert({
      trabajador: fila.trabajador, fecha: fechaAdelanto, monto,
      comprobante_url: comprobanteAdelantoUrl, nota: notaAdelanto.trim() || null,
    })
    setGuardando(false)
    if (error) { alert('No se pudo guardar el adelanto: ' + error.message); return }
    setMontoAdelanto(''); setNotaAdelanto(''); setComprobanteAdelantoUrl(null)
    setFechaAdelanto(new Date().toISOString().slice(0, 10)); setFormAbierto(null)
    onGuardado()
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, fontSize: 12 }}>
      {fila.ajustes.length > 0 && (
        <div>
          <p style={{ fontWeight: 700, color: 'var(--muted)', marginBottom: 4 }}>Ajustes de la semana</p>
          {fila.ajustes.map(a => (
            <div key={a.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, padding: '3px 0' }}>
              <span style={{ color: 'var(--text)' }}>{a.motivo}</span>
              <span style={{ fontWeight: 700, color: a.monto >= 0 ? 'var(--success)' : 'var(--danger)', whiteSpace: 'nowrap' }}>
                {a.monto >= 0 ? '+' : ''}{fmtMoney(a.monto)}
              </span>
            </div>
          ))}
        </div>
      )}

      {(fila.adelantosQueRestan.length > 0 || fila.sueldoFijo) && (
        <div>
          <p style={{ fontWeight: 700, color: 'var(--muted)', marginBottom: 4 }}>Adelantos</p>
          {fila.adelantosQueRestan.map(a => (
            <div key={a.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, padding: '3px 0' }}>
              <span style={{ color: 'var(--text)' }}>
                {a.fecha.split('-').reverse().join('/')}{a.nota ? ` — ${a.nota}` : ''}
                {a.comprobante_url && <a href={a.comprobante_url} target="_blank" rel="noreferrer" style={{ marginLeft: 6, color: 'var(--primary)' }}>Ver comprobante</a>}
              </span>
              <span style={{ fontWeight: 700, color: 'var(--danger)', whiteSpace: 'nowrap' }}>-{fmtMoney(a.monto)}</span>
            </div>
          ))}
          {fila.sueldoFijo && (
            <p style={{ color: 'var(--muted)', fontStyle: 'italic' }}>
              Sus adelantos no restan acá (sueldo fijo) — se descuentan de su sueldo mensual, ver "Historial de pagos".
            </p>
          )}
        </div>
      )}

      <div style={{ display: 'flex', gap: 8 }}>
        <button
          onClick={() => setFormAbierto(x => x === 'ajuste' ? null : 'ajuste')}
          className="btn btn-ghost" style={{ fontSize: 11, padding: '4px 8px' }}
        >± Ajustar</button>
        <button
          onClick={() => setFormAbierto(x => x === 'adelanto' ? null : 'adelanto')}
          className="btn btn-ghost" style={{ fontSize: 11, padding: '4px 8px' }}
        >+ Adelanto</button>
      </div>

      {formAbierto === 'ajuste' && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'flex-end', background: 'var(--surface-alt)', padding: 8, borderRadius: 8 }}>
          <div className="field" style={{ maxWidth: 140 }}>
            <label>Monto (+/-)</label>
            <input type="number" value={montoAjuste} onChange={e => setMontoAjuste(e.target.value)} placeholder="Ej: 50000 o -20000" />
          </div>
          <div className="field" style={{ flex: 1, minWidth: 160 }}>
            <label>Motivo</label>
            <input type="text" value={motivoAjuste} onChange={e => setMotivoAjuste(e.target.value)} placeholder="Ej: trabajó sábado" />
          </div>
          <button className="btn btn-primary" style={{ fontSize: 12, padding: '6px 10px' }} onClick={guardarAjuste} disabled={guardando}>
            {guardando ? 'Guardando...' : 'Guardar'}
          </button>
        </div>
      )}

      {formAbierto === 'adelanto' && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'flex-end', background: 'var(--surface-alt)', padding: 8, borderRadius: 8 }}>
          <div className="field" style={{ maxWidth: 120 }}>
            <label>Monto</label>
            <input type="number" value={montoAdelanto} onChange={e => setMontoAdelanto(e.target.value)} placeholder="Ej: 100000" />
          </div>
          <div className="field" style={{ maxWidth: 140 }}>
            <label>Fecha</label>
            <input type="date" value={fechaAdelanto} onChange={e => setFechaAdelanto(e.target.value)} />
          </div>
          <div className="field" style={{ flex: 1, minWidth: 140 }}>
            <label>Nota</label>
            <input type="text" value={notaAdelanto} onChange={e => setNotaAdelanto(e.target.value)} placeholder="Opcional" />
          </div>
          <label className="btn btn-ghost" style={{ fontSize: 11, padding: '6px 8px', cursor: subiendoComprobante ? 'default' : 'pointer' }}>
            {subiendoComprobante ? 'Subiendo...' : comprobanteAdelantoUrl ? 'Comprobante ✓' : '+ Comprobante'}
            <input type="file" accept="image/*" onChange={subirComprobanteAdelanto} disabled={subiendoComprobante} style={{ display: 'none' }} />
          </label>
          <button className="btn btn-primary" style={{ fontSize: 12, padding: '6px 10px' }} onClick={guardarAdelanto} disabled={guardando}>
            {guardando ? 'Guardando...' : 'Guardar'}
          </button>
        </div>
      )}
    </div>
  )
}

export function PanelPagoSemanal() {
  const [diarios, setDiarios] = useState<ReporteTrabajadorDia[]>([])
  const [tarifas, setTarifas] = useState<Trabajador[]>([])
  const [comprobantes, setComprobantes] = useState<PagoSemanalComprobante[]>([])
  const [ajustes, setAjustes] = useState<AjustePagoSemanal[]>([])
  const [adelantos, setAdelantos] = useState<AdelantoTrabajador[]>([])
  const [loading, setLoading] = useState(true)
  const [semanaKey, setSemanaKey] = useState('')
  const [expandido, setExpandido] = useState<string | null>(null)

  const cargar = useCallback(async () => {
    const [{ data: d }, { data: t }, { data: c }, { data: aj }, { data: ad }] = await Promise.all([
      supabase.from('reportes_diarios').select('*'),
      supabase.from('trabajadores').select('*'),
      supabase.from('pago_semanal_comprobantes').select('*'),
      supabase.from('ajustes_pago_semanal').select('*'),
      supabase.from('adelantos_trabajador').select('*'),
    ])
    setDiarios((d as ReporteTrabajadorDia[]) || [])
    setTarifas((t as Trabajador[]) || [])
    setComprobantes((c as PagoSemanalComprobante[]) || [])
    setAjustes((aj as AjustePagoSemanal[]) || [])
    setAdelantos((ad as AdelantoTrabajador[]) || [])
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
  const { inicio, fin } = semanaRango(semana.key)

  const filas = tarifas
    .map(t => {
      const diasPresentes = semana.diarios.filter(d => d.trabajador === t.nombre && d.presente)
      const ajustesDeLaSemana = ajustes.filter(a => a.trabajador === t.nombre && a.semana_key === semana.key)
      const adelantosDeLaSemana = adelantos.filter(a => a.trabajador === t.nombre && a.fecha >= inicio && a.fecha <= fin)
      return calcularFilaPagoSemanal(t, diasPresentes, ajustesDeLaSemana, adelantosDeLaSemana)
    })
    .filter(f => f.dias > 0 || f.ajustes.length > 0 || f.adelantosQueRestan.length > 0)

  const totalSemana = filas.reduce((s, f) => s + f.neto, 0)
  const haySueldoFijo = filas.some(f => f.sueldoFijo)

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, fontWeight: 600, color: 'var(--text-inverse)' }}>
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
          style={{ padding: '6px 10px', fontSize: 12, fontWeight: 600, borderRadius: 6, border: '1px solid var(--border-inverse)', background: 'transparent', cursor: 'pointer', color: 'var(--muted-inverse)' }}
        >↻ Actualizar</button>
      </div>

      <div style={{ marginBottom: 18 }}>
        <StatTile label="Total neto a pagar esa semana" valor={fmtMoney(totalSemana)} tono="alerta" />
      </div>

      {filas.length === 0 ? (
        <p style={{ color: 'var(--muted-inverse)', fontSize: 14 }}>Nadie tiene actividad reportada esa semana.</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {filas.map(f => {
            const comprobantesFila = comprobantes
              .filter(c => c.trabajador === f.trabajador && c.semana_key === semana.key)
              .sort((a, b) => b.created_at.localeCompare(a.created_at))
            const ultimoComprobante = comprobantesFila[0] || null
            const abierta = expandido === f.trabajador
            return (
              <div key={f.trabajador} className="card" style={{ padding: '16px 18px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 }}>
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 3, flexWrap: 'wrap' }}>
                      <span style={{ fontWeight: 700, fontSize: 15 }}>{f.trabajador}</span>
                      {f.sueldoFijo && (
                        <span className="font-display" style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase', color: 'var(--muted)', background: 'var(--surface-alt)', borderRadius: 5, padding: '2px 6px' }}>
                          Sueldo fijo
                        </span>
                      )}
                    </div>
                    <p style={{ fontSize: 12, color: 'var(--muted)' }}>
                      {f.sueldoFijo
                        ? 'Solo viático/ajustes esta semana'
                        : `${f.dias} día${f.dias !== 1 ? 's' : ''}${f.ganado ? ` · ganado ${fmtMoney(f.ganado)}` : ''}${f.viatico > 0 ? ' · viático incluido' : ''}`}
                    </p>
                  </div>
                  <div style={{ textAlign: 'right', flexShrink: 0 }}>
                    <p className="font-display" style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--muted)', marginBottom: 2 }}>Neto</p>
                    <p className="font-display" style={{ fontSize: 20, fontWeight: 800, color: 'var(--text)', fontVariantNumeric: 'tabular-nums' }}>{fmtMoney(f.neto)}</p>
                  </div>
                </div>

                {(f.totalAjustes !== 0 || f.totalAdelantosQueRestan > 0 || ultimoComprobante) && (
                  <>
                    <div style={{ height: 1, background: 'var(--border)', margin: '12px 0 10px' }} />
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
                      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', fontSize: 12.5, fontWeight: 700 }}>
                        {f.totalAjustes !== 0 && (
                          <span style={{ color: f.totalAjustes >= 0 ? 'var(--success)' : 'var(--danger)' }}>
                            Ajustes {f.totalAjustes > 0 ? '+' : ''}{fmtMoney(f.totalAjustes)}
                          </span>
                        )}
                        {f.totalAdelantosQueRestan > 0 && (
                          <span style={{ color: 'var(--danger)' }}>Adelanto -{fmtMoney(f.totalAdelantosQueRestan)}</span>
                        )}
                      </div>
                      <ComprobanteCelda
                        trabajador={f.trabajador}
                        semanaKey={semana.key}
                        montoCalculado={f.neto}
                        comprobante={ultimoComprobante}
                        onSubido={cargar}
                      />
                    </div>
                  </>
                )}

                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12 }}>
                  <button
                    onClick={() => setExpandido(abierta ? null : f.trabajador)}
                    style={{ background: 'none', border: '1px solid var(--border)', borderRadius: 8, padding: '6px 10px', fontSize: 12, fontWeight: 600, cursor: 'pointer', color: 'var(--muted)' }}
                  >{abierta ? '▲' : '▾'} Ajustar/Adelanto</button>
                </div>

                {abierta && (
                  <div style={{ marginTop: 12 }}>
                    <DetalleAjustesAdelantos fila={f} semanaKey={semana.key} onGuardado={cargar} />
                  </div>
                )}

                <DesgloseDiasToggle fila={f} />
              </div>
            )
          })}
        </div>
      )}

      {haySueldoFijo && (
        <p style={{ fontSize: 12, color: 'var(--muted-inverse)', marginTop: 14 }}>
          Los trabajadores marcados "Sueldo fijo" tienen mensualidad fija (ver Gastos Fijos en Estado de Resultados) — acá solo se refleja su viático de esa semana más los ajustes que corresponda, no un cálculo por día. Sus adelantos se ven en "Historial de pagos".
        </p>
      )}
    </div>
  )
}

/* ─── Fila de detalle semanal, solo lectura, para el historial ──── */
function FilaSemanaHistorial({ fila, semanaKey, semanaLabel, comprobante, onSubido }: {
  fila: FilaPagoSemanal
  semanaKey: string
  semanaLabel: string
  comprobante: PagoSemanalComprobante | null
  onSubido: () => void
}) {
  return (
    <div className="card" style={{ padding: '12px 14px', marginBottom: 10 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, marginBottom: 6, flexWrap: 'wrap' }}>
        <span style={{ fontWeight: 700, fontSize: 13 }}>{semanaLabel}</span>
        <span style={{ fontWeight: 700, fontSize: 14, color: 'var(--secondary)' }}>Neto {fmtMoney(fila.neto)}</span>
      </div>
      <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', fontSize: 12, color: 'var(--muted)', marginBottom: 6 }}>
        <span>Calculado: {fmtMoney(fila.calculado)}</span>
        {fila.totalAjustes !== 0 && (
          <span style={{ color: fila.totalAjustes >= 0 ? 'var(--success)' : 'var(--danger)' }}>
            Ajustes: {fila.totalAjustes > 0 ? '+' : ''}{fmtMoney(fila.totalAjustes)}
          </span>
        )}
        {fila.totalAdelantosQueRestan > 0 && (
          <span style={{ color: 'var(--danger)' }}>Adelantos: -{fmtMoney(fila.totalAdelantosQueRestan)}</span>
        )}
      </div>
      {fila.ajustes.length > 0 && (
        <div style={{ fontSize: 12, marginBottom: 4 }}>
          {fila.ajustes.map(a => (
            <div key={a.id} style={{ color: 'var(--text)' }}>• {a.motivo} ({a.monto >= 0 ? '+' : ''}{fmtMoney(a.monto)})</div>
          ))}
        </div>
      )}
      {fila.adelantosQueRestan.length > 0 && (
        <div style={{ fontSize: 12, marginBottom: 4 }}>
          {fila.adelantosQueRestan.map(a => (
            <div key={a.id} style={{ color: 'var(--text)' }}>
              • {a.fecha.split('-').reverse().join('/')} -{fmtMoney(a.monto)}{a.nota ? ` — ${a.nota}` : ''}
              {a.comprobante_url && <a href={a.comprobante_url} target="_blank" rel="noreferrer" style={{ marginLeft: 6, color: 'var(--primary)' }}>Ver comprobante</a>}
            </div>
          ))}
        </div>
      )}
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 4 }}>
        <ComprobanteCelda trabajador={fila.trabajador} semanaKey={semanaKey} montoCalculado={fila.neto} comprobante={comprobante} onSubido={onSubido} />
      </div>
      <DesgloseDiasToggle fila={fila} />
    </div>
  )
}

/* ─── Historial de pagos (por trabajador) — card separada de "Pago semanal" ──── */
export function PanelHistorialPagos() {
  const [tarifas, setTarifas] = useState<Trabajador[]>([])
  const [diarios, setDiarios] = useState<ReporteTrabajadorDia[]>([])
  const [ajustes, setAjustes] = useState<AjustePagoSemanal[]>([])
  const [adelantos, setAdelantos] = useState<AdelantoTrabajador[]>([])
  const [comprobantes, setComprobantes] = useState<PagoSemanalComprobante[]>([])
  const [gastosFijos, setGastosFijos] = useState<GastoFijo[]>([])
  const [loading, setLoading] = useState(true)
  const [trabajadorSel, setTrabajadorSel] = useState('')

  const cargar = useCallback(async () => {
    const [{ data: t }, { data: d }, { data: aj }, { data: ad }, { data: c }, { data: gf }] = await Promise.all([
      supabase.from('trabajadores').select('*').order('nombre'),
      supabase.from('reportes_diarios').select('*'),
      supabase.from('ajustes_pago_semanal').select('*'),
      supabase.from('adelantos_trabajador').select('*'),
      supabase.from('pago_semanal_comprobantes').select('*'),
      supabase.from('gastos_fijos').select('*'),
    ])
    setTarifas((t as Trabajador[]) || [])
    setDiarios((d as ReporteTrabajadorDia[]) || [])
    setAjustes((aj as AjustePagoSemanal[]) || [])
    setAdelantos((ad as AdelantoTrabajador[]) || [])
    setComprobantes((c as PagoSemanalComprobante[]) || [])
    setGastosFijos((gf as GastoFijo[]) || [])
    setLoading(false)
  }, [])

  useEffect(() => { cargar() }, [cargar])

  if (loading) return <div className="spinner" />
  if (tarifas.length === 0) {
    return <p style={{ color: 'var(--muted)', fontSize: 14 }}>Todavía no hay trabajadores cargados.</p>
  }

  const trabajador = tarifas.find(t => t.nombre === trabajadorSel) || tarifas[0]
  const sueldoFijo = trabajador.tarifa_diaria === 0

  const diariosTrabajador = diarios.filter(d => d.trabajador === trabajador.nombre && d.presente)
  const ajustesTrabajador = ajustes.filter(a => a.trabajador === trabajador.nombre)
  const adelantosTrabajador = adelantos.filter(a => a.trabajador === trabajador.nombre)
  const comprobantesTrabajador = comprobantes.filter(c => c.trabajador === trabajador.nombre)

  const selector = (
    <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, fontWeight: 600, color: 'var(--text-inverse)', marginBottom: 18 }}>
      Trabajador:
      <select
        value={trabajador.nombre}
        onChange={e => setTrabajadorSel(e.target.value)}
        style={{
          width: 'auto', padding: '6px 10px', fontSize: 13, fontWeight: 600, borderRadius: 6,
          border: '1.5px solid var(--primary)', background: 'var(--white)', color: 'var(--secondary)',
          cursor: 'pointer', appearance: 'auto',
        }}
      >
        {tarifas.map(t => <option key={t.id} value={t.nombre}>{t.nombre}</option>)}
      </select>
    </label>
  )

  const ultimoComprobante = (semanaKey: string) =>
    comprobantesTrabajador
      .filter(c => c.semana_key === semanaKey)
      .sort((a, b) => b.created_at.localeCompare(a.created_at))[0] || null

  if (sueldoFijo) {
    // Concepto de gastos_fijos se empareja por texto (ilike), no por FK -- funciona
    // hoy porque el único caso (Fabriel) tiene su nombre literal en el concepto. Ver
    // limitación documentada en el plan (steady-purring-spring.md).
    const sueldoMensual = gastosFijos
      .filter(g => g.activo && g.concepto.toLowerCase().includes(trabajador.nombre.toLowerCase()))
      .reduce((s, g) => s + g.monto_mensual, 0)

    const semanas = agruparPorPeriodo('semana', diariosTrabajador, [], [], [])

    // Cada semana pertenece al mes calendario de su lunes.
    const mesesSet = new Set<string>()
    const mesDeSemana = new Map<string, string>()
    for (const s of semanas) {
      const mesKey = getPeriodo(s.key, 'mes').key
      mesesSet.add(mesKey)
      mesDeSemana.set(s.key, mesKey)
    }
    for (const a of adelantosTrabajador) mesesSet.add(getPeriodo(a.fecha, 'mes').key)

    const meses = Array.from(mesesSet).sort((a, b) => b.localeCompare(a))

    if (meses.length === 0) {
      return <div>{selector}<p style={{ color: 'var(--muted)', fontSize: 14 }}>Sin actividad ni adelantos registrados todavía para {trabajador.nombre}.</p></div>
    }

    return (
      <div>
        {selector}
        {meses.map(mesKey => {
          const [y, m] = mesKey.split('-').map(Number)
          const label = `${MESES[m - 1]} ${y}`
          const adelantadoMes = adelantosTrabajador.filter(a => getPeriodo(a.fecha, 'mes').key === mesKey).reduce((s, a) => s + a.monto, 0)
          const restaPagar = sueldoMensual - adelantadoMes
          const semanasDelMes = semanas.filter(s => mesDeSemana.get(s.key) === mesKey)

          return (
            <div key={mesKey} className="card" style={{ padding: '14px 16px', marginBottom: 14 }}>
              <h3 style={{ fontSize: 15, fontWeight: 800, marginBottom: 10 }}>{label}</h3>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 14 }}>
                <StatTile label="Sueldo del mes" valor={fmtMoney(sueldoMensual)} />
                <StatTile label="Adelantado" valor={fmtMoney(adelantadoMes)} tono={adelantadoMes > 0 ? 'alerta' : 'neutral'} />
                <StatTile label="Resta pagar" valor={fmtMoney(restaPagar)} tono={restaPagar >= 0 ? 'positivo' : 'negativo'} />
              </div>

              {adelantosTrabajador.filter(a => getPeriodo(a.fecha, 'mes').key === mesKey).length > 0 && (
                <div style={{ fontSize: 12, marginBottom: 12 }}>
                  <p style={{ fontWeight: 700, color: 'var(--muted)', marginBottom: 4 }}>Adelantos del mes</p>
                  {adelantosTrabajador.filter(a => getPeriodo(a.fecha, 'mes').key === mesKey).map(a => (
                    <div key={a.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, padding: '3px 0' }}>
                      <span>{a.fecha.split('-').reverse().join('/')}{a.nota ? ` — ${a.nota}` : ''}
                        {a.comprobante_url && <a href={a.comprobante_url} target="_blank" rel="noreferrer" style={{ marginLeft: 6, color: 'var(--primary)' }}>Ver comprobante</a>}
                      </span>
                      <span style={{ fontWeight: 700, color: 'var(--danger)' }}>-{fmtMoney(a.monto)}</span>
                    </div>
                  ))}
                </div>
              )}

              {semanasDelMes.length > 0 && (
                <div>
                  <p style={{ fontSize: 12, fontWeight: 700, color: 'var(--muted)', marginBottom: 8 }}>Detalle semanal (viático y ajustes)</p>
                  {semanasDelMes.map(s => {
                    const ajustesSemana = ajustesTrabajador.filter(a => a.semana_key === s.key)
                    // Los adelantos de sueldo fijo no restan de la semana -- se muestran arriba, contra el mes.
                    const fila = calcularFilaPagoSemanal(trabajador, s.diarios.filter(d => d.presente), ajustesSemana, [])
                    return (
                      <FilaSemanaHistorial
                        key={s.key} fila={fila} semanaKey={s.key} semanaLabel={s.label}
                        comprobante={ultimoComprobante(s.key)} onSubido={cargar}
                      />
                    )
                  })}
                </div>
              )}
            </div>
          )
        })}
      </div>
    )
  }

  // Trabajador semanal: agrupa por semana, misma lógica que PanelPagoSemanal.
  const semanas = agruparPorPeriodo('semana', diariosTrabajador, [], [], [])
    .map(s => {
      const { inicio, fin } = semanaRango(s.key)
      const ajustesSemana = ajustesTrabajador.filter(a => a.semana_key === s.key)
      const adelantosSemana = adelantosTrabajador.filter(a => a.fecha >= inicio && a.fecha <= fin)
      return { key: s.key, label: s.label, fila: calcularFilaPagoSemanal(trabajador, s.diarios.filter(d => d.presente), ajustesSemana, adelantosSemana) }
    })
    .filter(s => s.fila.dias > 0 || s.fila.ajustes.length > 0 || s.fila.adelantosQueRestan.length > 0)

  if (semanas.length === 0) {
    return <div>{selector}<p style={{ color: 'var(--muted)', fontSize: 14 }}>Sin actividad registrada todavía para {trabajador.nombre}.</p></div>
  }

  return (
    <div>
      {selector}
      {semanas.map(s => (
        <FilaSemanaHistorial
          key={s.key} fila={s.fila} semanaKey={s.key} semanaLabel={s.label}
          comprobante={ultimoComprobante(s.key)} onSubido={cargar}
        />
      ))}
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
              <div key={d.id} style={{ display: 'flex', alignItems: 'center', gap: 10, background: 'var(--surface-alt)', borderRadius: 8, padding: '8px 12px', fontSize: 13 }}>
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
              <div key={d.id} style={{ display: 'flex', alignItems: 'center', gap: 10, background: 'var(--surface-alt)', borderRadius: 8, padding: '8px 12px', fontSize: 13 }}>
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
              <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 10, background: 'var(--surface-alt)', borderRadius: 8, padding: '8px 12px', fontSize: 13, flexWrap: 'wrap' }}>
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
              <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 10, background: 'var(--surface-alt)', borderRadius: 8, padding: '8px 12px', fontSize: 13 }}>
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
              <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 10, background: 'var(--surface-alt)', borderRadius: 8, padding: '8px 12px', fontSize: 13 }}>
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
    <div style={{ marginBottom: 10, background: 'var(--surface)', borderRadius: 10, overflow: 'hidden' }}>
      <button
        onClick={() => setAbierto(a => !a)}
        style={{
          width: '100%', display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px',
          background: periodo.enCurso ? '#fff8f0' : 'var(--surface-alt)', border: 'none', cursor: 'pointer', textAlign: 'left',
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
  onAgregarAbono: (cuentaId: string, fecha: string, monto: number, comprobanteUrl?: string | null) => void
  onEliminarAbono: (id: string) => void
  onEliminarCuenta: (id: string) => void
}) {
  const [fecha, setFecha] = useState('')
  const [monto, setMonto] = useState('')
  const [comprobanteUrl, setComprobanteUrl] = useState<string | null>(null)
  const [subiendoComprobante, setSubiendoComprobante] = useState(false)
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
            <div key={a.id} style={{ display: 'flex', alignItems: 'center', gap: 10, background: 'var(--surface-alt)', borderRadius: 8, padding: '8px 12px', fontSize: 13 }}>
              <span style={{ color: 'var(--muted)', fontSize: 12, width: 78, flexShrink: 0 }}>{a.fecha.split('-').reverse().join('/')}</span>
              <span style={{ flex: 1, fontWeight: 700, color: 'var(--success)' }}>{fmtMoney(a.monto)}</span>
              {a.comprobante_url && (
                <a href={a.comprobante_url} target="_blank" rel="noreferrer" style={{ fontSize: 11, color: 'var(--primary)', fontWeight: 600 }}>
                  Ver comprobante
                </a>
              )}
              <button onClick={() => onEliminarAbono(a.id)} className="btn btn-ghost" style={{ fontSize: 11, padding: '3px 8px' }}>Quitar</button>
            </div>
          ))}
        </div>
      )}
      <p style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 6 }}>
        Sube la captura del comprobante y la IA completa fecha y monto — revísalos antes de agregar el abono. También se puede cargar todo a mano, sin foto.
      </p>
      <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' }}>
        <div className="field" style={{ flex: 1, minWidth: 130 }}>
          <label>Fecha del abono</label>
          <input type="date" value={fecha} onChange={e => setFecha(e.target.value)} />
        </div>
        <div className="field" style={{ flex: 1, minWidth: 130 }}>
          <label>Monto del abono</label>
          <input type="number" min="0" placeholder="Monto en pesos" value={monto} onChange={e => setMonto(e.target.value)} />
        </div>
        <label className="btn btn-secondary" style={{ flexShrink: 0, cursor: subiendoComprobante ? 'default' : 'pointer', opacity: subiendoComprobante ? 0.6 : 1 }}>
          {subiendoComprobante ? 'Leyendo el comprobante...' : comprobanteUrl ? 'Comprobante ✓' : '+ Comprobante'}
          <input
            type="file"
            accept="image/*,.pdf"
            disabled={subiendoComprobante}
            style={{ display: 'none' }}
            onChange={async e => {
              const archivo = e.target.files?.[0]
              e.target.value = ''
              if (!archivo) return
              setSubiendoComprobante(true)
              const ext = archivo.name.split('.').pop() || 'bin'
              const filename = `comprobante-${cuenta.id}-${Date.now()}.${ext}`
              const { data, error } = await supabase.storage.from('audio-notas').upload(filename, archivo, { contentType: archivo.type })
              if (error) {
                alert('Error al subir el comprobante: ' + error.message)
                setSubiendoComprobante(false)
                return
              }
              const { data: urlData } = supabase.storage.from('audio-notas').getPublicUrl(data.path)
              setComprobanteUrl(urlData.publicUrl)
              // La IA completa monto/fecha a partir de la captura -- revisables antes de
              // confirmar "+ Agregar abono", la carga manual sigue disponible si falla o
              // si hace falta corregir algo.
              try {
                const res = await fetch('/api/parse-comprobante', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ url: urlData.publicUrl }),
                })
                const resultado = await res.json()
                if (!res.ok) throw new Error(resultado.error || 'error desconocido')
                if (resultado.monto) setMonto(String(resultado.monto))
                if (resultado.fecha) setFecha(resultado.fecha)
              } catch (err) {
                alert('El comprobante se guardó, pero la IA no pudo leerlo (' + String(err) + '). Completa fecha y monto a mano.')
              }
              setSubiendoComprobante(false)
            }}
          />
        </label>
        <button
          className="btn btn-secondary"
          onClick={() => {
            const m = Number(monto)
            if (!fecha || !Number.isFinite(m) || m <= 0) { alert('Completa fecha y un monto válido.'); return }
            onAgregarAbono(cuenta.id, fecha, m, comprobanteUrl)
            setFecha(''); setMonto(''); setComprobanteUrl(null)
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
    if (!window.confirm('¿Seguro que quieres borrar este archivo?')) return
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
                  <div style={{ width: '100%', height: 90, borderRadius: 8, border: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--surface-alt)', fontSize: 11, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase' }}>Video</div>
                ) : (
                  <div style={{ width: '100%', height: 90, borderRadius: 8, border: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--surface-alt)', fontSize: 11, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase' }}>Archivo</div>
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
  onAgregarAbono?: (cuentaId: string, fecha: string, monto: number, comprobanteUrl?: string | null) => void
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

/* ─── Trabajadores: agregar/archivar, resumen de lo pagado ───────────── */
export function PanelTrabajadores() {
  const [trabajadores, setTrabajadores] = useState<Trabajador[]>([])
  const [comprobantes, setComprobantes] = useState<PagoSemanalComprobante[]>([])
  const [obras, setObras] = useState<{ id: string; nombre: string }[]>([])
  const [loading, setLoading] = useState(true)
  const [verArchivados, setVerArchivados] = useState(false)
  const [mostrarForm, setMostrarForm] = useState(false)
  const [nuevoNombre, setNuevoNombre] = useState('')
  const [nuevaTarifa, setNuevaTarifa] = useState('')
  const [nuevoViatico, setNuevoViatico] = useState('')
  const [guardando, setGuardando] = useState(false)

  const cargar = useCallback(async () => {
    const [{ data: t }, { data: c }, { data: o }] = await Promise.all([
      supabase.from('trabajadores').select('*').order('nombre'),
      supabase.from('pago_semanal_comprobantes').select('*'),
      supabase.from('obras').select('id, nombre').eq('estado_obra', 'en_curso').order('nombre'),
    ])
    setTrabajadores((t as Trabajador[]) || [])
    setComprobantes((c as PagoSemanalComprobante[]) || [])
    setObras((o as { id: string; nombre: string }[]) || [])
    setLoading(false)
  }, [])

  useEffect(() => { cargar() }, [cargar])

  // Restringe el link de /obra-fotos de este trabajador a una sola obra en vez de
  // dejarle elegir entre todas las que están en curso -- ver conversación 28/08/2026.
  async function asignarObra(t: Trabajador, obraId: string) {
    const { error } = await supabase.from('trabajadores').update({ obra_asignada_id: obraId || null }).eq('id', t.id)
    if (error) { alert('No se pudo guardar. Intenta de nuevo.'); return }
    cargar()
  }

  async function agregarTrabajador() {
    if (!nuevoNombre.trim()) { alert('Completa el nombre.'); return }
    setGuardando(true)
    const { error } = await supabase.from('trabajadores').insert({
      nombre: nuevoNombre.trim(),
      tarifa_diaria: Number(nuevaTarifa) || 0,
      viatico_diario: Number(nuevoViatico) || 0,
    })
    setGuardando(false)
    if (error) { alert('No se pudo agregar. Puede que ya exista un trabajador con ese nombre.'); return }
    setNuevoNombre(''); setNuevaTarifa(''); setNuevoViatico(''); setMostrarForm(false)
    cargar()
  }

  // Archivar (no borrar) -- deja de aparecer en Reporte Diario y Pago semanal, pero
  // sus comprobantes/ajustes/adelantos pasados (guardados por nombre, no por FK) siguen
  // disponibles en "Historial de pagos", que lista trabajadores sin filtrar por activo.
  async function archivar(t: Trabajador) {
    if (!window.confirm(`¿Archivar a ${t.nombre}? Deja de aparecer en Reporte Diario y Pago semanal. Su historial de pagos sigue disponible en "Historial de pagos".`)) return
    await supabase.from('trabajadores').update({ activo: false }).eq('id', t.id)
    cargar()
  }

  async function reactivar(t: Trabajador) {
    await supabase.from('trabajadores').update({ activo: true }).eq('id', t.id)
    cargar()
  }

  if (loading) return <div className="spinner" />

  const totalPagadoPorNombre = new Map<string, number>()
  for (const c of comprobantes) {
    const monto = c.monto_leido ?? c.monto_calculado ?? 0
    totalPagadoPorNombre.set(c.trabajador, (totalPagadoPorNombre.get(c.trabajador) || 0) + monto)
  }

  // `!== false` en vez de solo `t.activo`: mientras la migración de la columna `activo` no
  // esté corrida, `select('*')` no la trae y quedaría `undefined` -- tratarlo como activo evita
  // que la lista se vea vacía por error antes de que Alexandra corra la migración.
  const visibles = trabajadores.filter(t => verArchivados || t.activo !== false)

  return (
    <div>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 16, flexWrap: 'wrap' }}>
        <button className="btn btn-primary" onClick={() => setMostrarForm(v => !v)} style={{ fontSize: 13, padding: '7px 14px' }}>
          {mostrarForm ? 'Cancelar' : '+ Agregar trabajador'}
        </button>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: 'var(--muted)', marginLeft: 'auto', cursor: 'pointer' }}>
          <input type="checkbox" checked={verArchivados} onChange={e => setVerArchivados(e.target.checked)} />
          Ver archivados
        </label>
      </div>

      {mostrarForm && (
        <div className="card" style={{ padding: 14, marginBottom: 16, display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div className="field" style={{ flex: 1, minWidth: 140 }}>
            <label>Nombre</label>
            <input type="text" value={nuevoNombre} onChange={e => setNuevoNombre(e.target.value)} />
          </div>
          <div className="field" style={{ width: 140 }}>
            <label>Tarifa diaria</label>
            <input type="number" min="0" value={nuevaTarifa} onChange={e => setNuevaTarifa(e.target.value)} placeholder="0" />
          </div>
          <div className="field" style={{ width: 140 }}>
            <label>Viático diario</label>
            <input type="number" min="0" value={nuevoViatico} onChange={e => setNuevoViatico(e.target.value)} placeholder="0" />
          </div>
          <button className="btn btn-primary" onClick={agregarTrabajador} disabled={guardando} style={{ fontSize: 13, padding: '8px 16px' }}>
            {guardando ? 'Guardando...' : 'Guardar'}
          </button>
        </div>
      )}

      {visibles.length === 0 ? (
        <p style={{ color: 'var(--muted)', textAlign: 'center', padding: '2rem 0' }}>Sin trabajadores para mostrar.</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {visibles.map(t => {
            const activo = t.activo !== false
            return (
              <div key={t.id} className="card" style={{ padding: 14, opacity: activo ? 1 : 0.6 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10, flexWrap: 'wrap' }}>
                  <div>
                    <p style={{ fontWeight: 700, fontSize: 15 }}>
                      {t.nombre}
                      {!activo && <span style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 600 }}> · Archivado</span>}
                    </p>
                    <p style={{ fontSize: 12, color: 'var(--muted)' }}>
                      {t.tarifa_diaria > 0 ? `Tarifa diaria: ${fmtMoney(t.tarifa_diaria)}` : 'Sueldo fijo mensual'}
                      {t.viatico_diario > 0 ? ` · Viático: ${fmtMoney(t.viatico_diario)}` : ''}
                    </p>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <p style={{ fontSize: 11, color: 'var(--muted)' }}>Total pagado (comprobantes)</p>
                    <p style={{ fontWeight: 700, fontSize: 15 }}>{fmtMoney(totalPagadoPorNombre.get(t.nombre) || 0)}</p>
                  </div>
                </div>
                <div style={{ marginTop: 10, display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
                  {activo ? (
                    <button onClick={() => archivar(t)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 12, color: 'var(--danger)', fontWeight: 600, padding: 0 }}>
                      Archivar
                    </button>
                  ) : (
                    <button onClick={() => reactivar(t)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 12, color: 'var(--primary)', fontWeight: 600, padding: 0 }}>
                      Reactivar
                    </button>
                  )}
                  <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--muted)', marginLeft: 'auto' }}>
                    Obra asignada
                    <select
                      value={t.obra_asignada_id || ''}
                      onChange={e => asignarObra(t, e.target.value)}
                      style={{ fontSize: 12, padding: '4px 8px', width: 'auto' }}
                    >
                      <option value="">Sin asignar (elige él)</option>
                      {obras.map(o => <option key={o.id} value={o.id}>{o.nombre}</option>)}
                    </select>
                  </label>
                </div>
              </div>
            )
          })}
        </div>
      )}
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

const TIPO_PRESUPUESTO_LABELS: Record<PresupuestoGuardado['tipo'], string> = {
  simple: 'Simple',
  etapas: 'Por etapas',
  externo: 'Externo',
}

/* ─── Boletas y compras cargadas (con o sin foto) ────── */
const LABEL_DESTINO: Record<string, string> = {
  stock: 'Stock (sin obra)',
  trabajo_puntual: 'Trabajo puntual (sin obra)',
}

export function PanelBoletas() {
  const [compras, setCompras] = useState<ReporteCompraDia[]>([])
  const [itemsPorCompra, setItemsPorCompra] = useState<Record<string, CompraItem[]>>({})
  const [loading, setLoading] = useState(true)
  const [periodoKey, setPeriodoKey] = useState('')
  const [expandidoId, setExpandidoId] = useState<string | null>(null)

  const cargar = useCallback(async () => {
    const { data: comprasData } = await supabase
      .from('reportes_compras')
      .select('*')
      .order('fecha', { ascending: false })
    const lista = (comprasData as ReporteCompraDia[]) || []
    setCompras(lista)

    if (lista.length) {
      const { data: itemsData } = await supabase
        .from('compra_items')
        .select('*')
        .in('compra_id', lista.map(c => c.id))
      const porCompra: Record<string, CompraItem[]> = {}
      for (const it of (itemsData as CompraItem[]) || []) {
        if (!porCompra[it.compra_id]) porCompra[it.compra_id] = []
        porCompra[it.compra_id].push(it)
      }
      setItemsPorCompra(porCompra)
    } else {
      setItemsPorCompra({})
    }
    setLoading(false)
  }, [])

  useEffect(() => { cargar() }, [cargar])

  async function borrarCompra(id: string, descripcion: string) {
    if (!window.confirm(`¿Borrar la compra "${descripcion}"? Si se cargó a Stock, también se revierte esa entrada. No se puede deshacer.`)) return
    const { error } = await supabase.from('reportes_compras').delete().eq('id', id)
    if (error) {
      alert('No se pudo borrar. Intenta de nuevo.')
      return
    }
    setCompras(prev => prev.filter(c => c.id !== id))
  }

  if (loading) return <div className="spinner" />

  const periodos = agruparPorPeriodo('mes', [], compras, [], [])
  if (periodos.length === 0) {
    return <p style={{ color: 'var(--muted)', fontSize: 14 }}>Todavía no hay compras cargadas.</p>
  }
  const periodo = periodos.find(p => p.key === periodoKey) || periodos.find(p => p.enCurso) || periodos[0]
  const totalPeriodo = periodo.compras.reduce((s, c) => s + c.monto, 0)

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, fontWeight: 600, color: 'var(--text-inverse)' }}>
          Mes:
          <select
            value={periodo.key}
            onChange={e => setPeriodoKey(e.target.value)}
            style={{
              width: 'auto', padding: '6px 10px', fontSize: 13, fontWeight: 600, borderRadius: 6,
              border: '1.5px solid var(--primary)', background: 'var(--white)', color: 'var(--secondary)',
              cursor: 'pointer', appearance: 'auto',
            }}
          >
            {periodos.map(p => (
              <option key={p.key} value={p.key}>{p.label}{p.enCurso ? ' (en curso)' : ''}</option>
            ))}
          </select>
        </label>
        <button
          onClick={cargar}
          style={{ padding: '6px 10px', fontSize: 12, fontWeight: 600, borderRadius: 6, border: '1px solid var(--border)', background: 'var(--white)', cursor: 'pointer', color: 'var(--muted)' }}
        >↻ Actualizar</button>
      </div>

      <div style={{ marginBottom: 18 }}>
        <StatTile label="Total compras del mes" valor={fmtMoney(totalPeriodo)} tono="neutral" />
      </div>

      {periodo.compras.length === 0 ? (
        <p style={{ color: 'var(--muted)', fontSize: 14 }}>Sin compras cargadas ese mes.</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {periodo.compras.map(c => {
            const items = itemsPorCompra[c.id] || []
            const expandido = expandidoId === c.id
            return (
              <div key={c.id} className="card" style={{ padding: 14 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10, flexWrap: 'wrap' }}>
                  <div>
                    <p style={{ fontWeight: 700, fontSize: 14 }}>{c.descripcion}</p>
                    <p style={{ fontSize: 12, color: 'var(--muted)' }}>
                      {new Date(c.fecha + 'T00:00:00').toLocaleDateString('es-CL', { timeZone: 'America/Santiago' })}
                      {' · '}{c.obra || LABEL_DESTINO[c.destino || ''] || 'Sin destino'}
                    </p>
                  </div>
                  <p style={{ fontWeight: 700, fontSize: 15 }}>{fmtMoney(c.monto)}</p>
                </div>

                <div style={{ marginTop: 10, display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
                  {c.foto_boleta_url ? (
                    <div>
                      <p style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 4 }}>Foto de la boleta</p>
                      <GaleriaArchivos urls={[c.foto_boleta_url]} />
                    </div>
                  ) : (
                    <p style={{ fontSize: 12, color: 'var(--muted)' }}>Sin foto cargada</p>
                  )}
                  {items.length > 0 && (
                    <button
                      onClick={() => setExpandidoId(expandido ? null : c.id)}
                      style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 12, color: 'var(--primary)', fontWeight: 600, padding: 0, marginLeft: 'auto' }}
                    >
                      {expandido ? 'Ocultar materiales ▲' : `Ver materiales (${items.length}) ▼`}
                    </button>
                  )}
                  <button
                    onClick={() => borrarCompra(c.id, c.descripcion)}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 12, color: 'var(--danger)', fontWeight: 600, padding: 0, marginLeft: items.length > 0 ? 0 : 'auto' }}
                  >
                    Borrar
                  </button>
                </div>

                {expandido && items.length > 0 && (
                  <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: 4 }}>
                    {items.map(it => (
                      <div key={it.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 10, fontSize: 12 }}>
                        <span style={{ color: 'var(--muted)' }}>{it.descripcion} × {it.cantidad}</span>
                        <span>{fmtMoney(it.cantidad * it.precio_unitario)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

/* ─── Facturas emitidas ───────────────────────────────── */
export function PanelFacturas() {
  const [facturas, setFacturas] = useState<{ id: string; fecha: string; obra: string | null; monto: number }[]>([])
  const [obras, setObras] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [mostrarForm, setMostrarForm] = useState(false)
  const [nuevaFecha, setNuevaFecha] = useState(() => new Date().toISOString().slice(0, 10))
  const [nuevaObra, setNuevaObra] = useState('')
  const [nuevoMonto, setNuevoMonto] = useState('')
  const [guardando, setGuardando] = useState(false)

  const cargar = useCallback(async () => {
    const [{ data: f }, { data: o }] = await Promise.all([
      supabase.from('facturas').select('*').order('fecha', { ascending: false }),
      supabase.from('obras').select('nombre').order('nombre'),
    ])
    setFacturas(f || [])
    setObras((o || []).map((x: { nombre: string }) => x.nombre))
    setLoading(false)
  }, [])

  useEffect(() => { cargar() }, [cargar])

  async function agregarFactura() {
    if (!nuevaFecha || !nuevoMonto.trim()) { alert('Completa la fecha y el monto.'); return }
    const monto = Number(nuevoMonto)
    if (!Number.isFinite(monto) || monto <= 0) { alert('El monto no es válido.'); return }
    setGuardando(true)
    const { error } = await supabase.from('facturas').insert({ fecha: nuevaFecha, obra: nuevaObra || null, monto })
    setGuardando(false)
    if (error) { alert('No se pudo guardar. Intenta de nuevo.'); return }
    setNuevaObra(''); setNuevoMonto(''); setMostrarForm(false)
    cargar()
  }

  async function borrarFactura(id: string) {
    if (!window.confirm('¿Borrar esta factura? No se puede deshacer.')) return
    const { error } = await supabase.from('facturas').delete().eq('id', id)
    if (error) { alert('No se pudo borrar. Intenta de nuevo.'); return }
    setFacturas(prev => prev.filter(f => f.id !== id))
  }

  if (loading) return <div className="spinner" />

  const totalGeneral = facturas.reduce((s, f) => s + f.monto, 0)

  return (
    <div>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 16, flexWrap: 'wrap' }}>
        <button className="btn btn-primary" onClick={() => setMostrarForm(v => !v)} style={{ fontSize: 13, padding: '7px 14px' }}>
          {mostrarForm ? 'Cancelar' : '+ Agregar factura'}
        </button>
      </div>

      {mostrarForm && (
        <div className="card" style={{ padding: 14, marginBottom: 16, display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div className="field" style={{ width: 160 }}>
            <label>Fecha</label>
            <input type="date" value={nuevaFecha} onChange={e => setNuevaFecha(e.target.value)} />
          </div>
          <div className="field" style={{ flex: 1, minWidth: 160 }}>
            <label>Obra (opcional)</label>
            <select value={nuevaObra} onChange={e => setNuevaObra(e.target.value)}>
              <option value="">Sin obra</option>
              {obras.map(o => <option key={o} value={o}>{o}</option>)}
            </select>
          </div>
          <div className="field" style={{ width: 160 }}>
            <label>Monto</label>
            <input type="number" min="0" value={nuevoMonto} onChange={e => setNuevoMonto(e.target.value)} placeholder="0" />
          </div>
          <button className="btn btn-primary" onClick={agregarFactura} disabled={guardando} style={{ fontSize: 13, padding: '8px 16px' }}>
            {guardando ? 'Guardando...' : 'Guardar'}
          </button>
        </div>
      )}

      <div style={{ marginBottom: 18 }}>
        <StatTile label="Total facturado" valor={fmtMoney(totalGeneral)} tono="neutral" />
      </div>

      {facturas.length === 0 ? (
        <p style={{ color: 'var(--muted)', textAlign: 'center', padding: '2rem 0' }}>Todavía no hay facturas cargadas.</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {facturas.map(f => (
            <div key={f.id} className="card" style={{ padding: 14, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <div>
                <p style={{ fontWeight: 700, fontSize: 14 }}>{f.obra || 'Sin obra asignada'}</p>
                <p style={{ fontSize: 12, color: 'var(--muted)' }}>{new Date(f.fecha + 'T00:00:00').toLocaleDateString('es-CL', { timeZone: 'America/Santiago' })}</p>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                <p style={{ fontWeight: 700, fontSize: 15 }}>{fmtMoney(f.monto)}</p>
                <button onClick={() => borrarFactura(f.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 12, color: 'var(--danger)', fontWeight: 600, padding: 0 }}>
                  Borrar
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export function PanelPresupuestos() {
  const [presupuestos, setPresupuestos] = useState<PresupuestoGuardado[]>([])
  const [loading, setLoading] = useState(true)
  const [busqueda, setBusqueda] = useState('')
  const [detalleId, setDetalleId] = useState<string | null>(null)
  const [detalle, setDetalle] = useState<PresupuestoDetalle | null>(null)
  const [cargandoDetalle, setCargandoDetalle] = useState(false)
  const [convirtiendoId, setConvirtiendoId] = useState<string | null>(null)
  const [nombreObraNueva, setNombreObraNueva] = useState('')
  const [convirtiendo, setConvirtiendo] = useState(false)

  const [mostrarFormExterno, setMostrarFormExterno] = useState(false)
  const [clienteExterno, setClienteExterno] = useState('')
  const [montoExterno, setMontoExterno] = useState('')
  const [estadoExterno, setEstadoExterno] = useState<EstadoPresupuesto>('enviado')
  const [archivoExternoUrl, setArchivoExternoUrl] = useState('')
  const [subiendoArchivo, setSubiendoArchivo] = useState(false)
  const [guardandoExterno, setGuardandoExterno] = useState(false)
  const [itemsExterno, setItemsExterno] = useState<PresupuestoItemSimple[]>([])
  const [incluirItemsExterno, setIncluirItemsExterno] = useState(true)

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

  // "Convertido en obra" nunca se escribe directo desde el selector de estado -- solo
  // el flujo real de conversión (que crea la obra) puede llegar a ese estado, para que
  // nunca quede un presupuesto "convertido" sin ninguna obra vinculada.
  function seleccionarEstado(p: PresupuestoGuardado, estado: EstadoPresupuesto) {
    if (estado === 'convertido') {
      if (p.estado !== 'aceptado') {
        alert('Primero marca el presupuesto como "Aceptado" y después conviértelo en obra.')
        return
      }
      abrirConvertir(p)
      return
    }
    cambiarEstado(p.id, estado)
  }

  async function abrirDetalle(id: string) {
    setDetalleId(id)
    setCargandoDetalle(true)
    const { data } = await supabase.from('presupuestos').select('*').eq('id', id).single()
    setDetalle(data as PresupuestoDetalle)
    setCargandoDetalle(false)
  }

  async function eliminarPresupuesto(id: string, clienteNombre: string | null) {
    if (!window.confirm(`¿Seguro que quieres borrar el presupuesto de "${clienteNombre || 'sin nombre'}"? No se puede deshacer.`)) return
    const { error } = await supabase.from('presupuestos').delete().eq('id', id)
    if (error) {
      alert('No se pudo borrar. Intenta de nuevo.')
      return
    }
    setPresupuestos(prev => prev.filter(p => p.id !== id))
    if (detalleId === id) { setDetalleId(null); setDetalle(null) }
  }

  function abrirConvertir(p: PresupuestoGuardado) {
    setConvirtiendoId(p.id)
    setNombreObraNueva(p.cliente_direccion || p.cliente_nombre || '')
  }

  async function confirmarConvertir(p: PresupuestoGuardado) {
    if (!nombreObraNueva.trim()) { alert('Completa el nombre de la obra.'); return }
    setConvirtiendo(true)
    const { data: obraCreada, error: errorObra } = await supabase.from('obras').insert({
      nombre: nombreObraNueva.trim(),
      cliente: p.cliente_nombre,
      presupuesto_total: p.total,
      presupuesto_id: p.id,
    }).select('id').single()
    if (errorObra) {
      setConvirtiendo(false)
      alert('No se pudo crear la obra. Puede que ya exista una con ese nombre.')
      return
    }
    // El detalle (items/etapas) no viene en la lista liviana de presupuestos -- se busca
    // recién acá, solo cuando hace falta, para no cargar ese JSON en cada fila de la lista.
    if (obraCreada?.id) {
      const { data: detalleCompleto } = await supabase.from('presupuestos').select('tipo, items, etapas').eq('id', p.id).single()
      if (detalleCompleto) await copiarItemsAObra(obraCreada.id, detalleCompleto as { tipo: string; items: PresupuestoItemSimple[] | null; etapas: PresupuestoEtapa[] | null })
    }
    await supabase.from('presupuestos').update({ estado: 'convertido' }).eq('id', p.id)
    setPresupuestos(prev => prev.map(x => x.id === p.id ? { ...x, estado: 'convertido' } : x))
    if (detalle?.id === p.id) setDetalle(prev => prev ? { ...prev, estado: 'convertido' } : prev)
    setConvirtiendo(false)
    setConvirtiendoId(null)
    alert(`Obra "${nombreObraNueva.trim()}" creada. Ya la puedes ver en la pestaña Obras.`)
  }

  async function subirArchivoExterno(archivo: File) {
    setSubiendoArchivo(true)
    try {
      const ext = archivo.name.split('.').pop() || 'pdf'
      const filename = `presupuesto-externo-${Date.now()}.${ext}`
      const { data, error } = await supabase.storage.from('audio-notas').upload(filename, archivo, { contentType: archivo.type })
      if (error) {
        alert('Error al subir el archivo: ' + error.message)
        return
      }
      const { data: urlData } = supabase.storage.from('audio-notas').getPublicUrl(data.path)
      setArchivoExternoUrl(urlData.publicUrl)
      // La IA completa el monto (y el detalle de ítems, si el documento lo muestra) a
      // partir del PDF/foto -- todo revisable antes de guardar, la carga manual del
      // monto sigue disponible si falla o si hace falta corregirlo.
      try {
        const res = await fetch('/api/parse-presupuesto-externo', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url: urlData.publicUrl }),
        })
        const resultado = await res.json()
        if (!res.ok) throw new Error(resultado.error || 'error desconocido')
        if (resultado.monto) setMontoExterno(String(resultado.monto))
        if (Array.isArray(resultado.items) && resultado.items.length > 0) {
          setItemsExterno(resultado.items.map((it: { descripcion: string; cantidad: number; precio_unitario: number; total: number }, idx: number) => ({
            id: idx,
            categoria: '',
            description: it.descripcion,
            quantity: it.cantidad,
            price: it.precio_unitario,
            total: it.total,
          })))
          setIncluirItemsExterno(true)
        }
      } catch (err) {
        alert('El archivo se guardó, pero la IA no pudo leer el monto (' + String(err) + '). Complétalo a mano.')
      }
    } finally {
      setSubiendoArchivo(false)
    }
  }

  async function guardarExterno() {
    if (!clienteExterno.trim()) { alert('Completa el nombre del cliente.'); return }
    const monto = Number(montoExterno)
    if (!montoExterno.trim() || Number.isNaN(monto) || monto <= 0) { alert('Completa un monto válido.'); return }
    setGuardandoExterno(true)

    const { data: cliente } = await supabase
      .from('clientes')
      .upsert({ nombre: clienteExterno.trim() }, { onConflict: 'nombre' })
      .select('id')
      .single()

    const { error } = await supabase.from('presupuestos').insert({
      cliente_id: cliente?.id ?? null,
      cliente_nombre: clienteExterno.trim(),
      tipo: 'externo',
      estado: estadoExterno,
      total: monto,
      archivo_url: archivoExternoUrl || null,
      items: incluirItemsExterno && itemsExterno.length > 0 ? itemsExterno : null,
    })
    setGuardandoExterno(false)
    if (error) {
      alert('No se pudo guardar el presupuesto externo. Intenta de nuevo.')
      return
    }
    setMostrarFormExterno(false)
    setClienteExterno('')
    setMontoExterno('')
    setEstadoExterno('enviado')
    setArchivoExternoUrl('')
    setItemsExterno([])
    setIncluirItemsExterno(true)
    cargar()
  }

  const filtrados = presupuestos.filter(p =>
    !busqueda.trim() || (p.cliente_nombre || '').toLowerCase().includes(busqueda.trim().toLowerCase())
  )

  if (loading) return <div className="spinner" />

  return (
    <div>
      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap', marginBottom: 18 }}>
        <div className="field" style={{ maxWidth: 320, marginBottom: 0, flex: 1, minWidth: 200 }}>
          <label>Buscar por cliente</label>
          <input value={busqueda} onChange={e => setBusqueda(e.target.value)} placeholder="Nombre del cliente..." />
        </div>
        <button
          className="btn btn-secondary"
          onClick={() => setMostrarFormExterno(v => !v)}
          style={{ fontSize: 13, padding: '8px 14px' }}
        >
          {mostrarFormExterno ? 'Cancelar' : '+ Cargar presupuesto externo'}
        </button>
      </div>

      {mostrarFormExterno && (
        <div className="card" style={{ padding: 16, marginBottom: 18 }}>
          <p style={{ fontSize: 13, fontWeight: 700, marginBottom: 12 }}>Presupuesto hecho fuera de la app</p>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <div className="field" style={{ flex: 1, minWidth: 160 }}>
              <label>Cliente</label>
              <input value={clienteExterno} onChange={e => setClienteExterno(e.target.value)} placeholder="Nombre del cliente" />
            </div>
            <div className="field" style={{ width: 160 }}>
              <label>Monto total</label>
              <input type="number" min="0" value={montoExterno} onChange={e => setMontoExterno(e.target.value)} placeholder="0" />
            </div>
            <div className="field" style={{ width: 180 }}>
              <label>Estado</label>
              <select value={estadoExterno} onChange={e => setEstadoExterno(e.target.value as EstadoPresupuesto)}>
                {(Object.entries(ESTADO_PRESUPUESTO_LABELS) as [EstadoPresupuesto, string][])
                  .filter(([k]) => k !== 'convertido')
                  .map(([k, label]) => (
                    <option key={k} value={k}>{label}</option>
                  ))}
              </select>
            </div>
          </div>
          <div className="field" style={{ marginTop: 10, maxWidth: 320 }}>
            <label>Archivo (PDF o foto)</label>
            <input
              type="file"
              accept="image/*,.pdf"
              onChange={e => { const f = e.target.files?.[0]; if (f) subirArchivoExterno(f) }}
              disabled={subiendoArchivo}
            />
            <p style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>La IA completa el campo "Monto total" de arriba al subir el archivo — revísalo antes de guardar.</p>
            {subiendoArchivo && <p style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4 }}>Subiendo y leyendo el monto...</p>}
            {archivoExternoUrl && !subiendoArchivo && <p style={{ fontSize: 12, color: 'var(--success)', marginTop: 4 }}>Archivo subido.</p>}

            {itemsExterno.length > 0 && (
              <div style={{ marginTop: 12, padding: 12, background: 'var(--surface-alt)', borderRadius: 8 }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, cursor: 'pointer' }}>
                  <input type="checkbox" checked={incluirItemsExterno} onChange={e => setIncluirItemsExterno(e.target.checked)} />
                  <span style={{ fontSize: 12, fontWeight: 700 }}>
                    La IA también encontró {itemsExterno.length} ítem{itemsExterno.length !== 1 ? 's' : ''} con desglose — incluirlos (se van a poder usar en "Avance de obra" si esto se convierte en obra)
                  </span>
                </label>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4, opacity: incluirItemsExterno ? 1 : 0.5 }}>
                  {itemsExterno.map(it => (
                    <div key={it.id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, gap: 8 }}>
                      <span>{it.description} ({it.quantity} × {fmtMoney(it.price)})</span>
                      <span style={{ flexShrink: 0 }}>{fmtMoney(it.total)}</span>
                    </div>
                  ))}
                </div>
                <p style={{ fontSize: 11, color: 'var(--muted)', marginTop: 6 }}>
                  Revisa que sea correcto — si la IA se equivocó, destilda la casilla y el presupuesto se guarda solo con el monto total, como antes.
                </p>
              </div>
            )}
          </div>
          <button
            className="btn btn-primary"
            onClick={guardarExterno}
            disabled={guardandoExterno || subiendoArchivo}
            style={{ marginTop: 14, fontSize: 13, padding: '8px 16px' }}
          >
            {guardandoExterno ? 'Guardando...' : 'Guardar presupuesto'}
          </button>
        </div>
      )}

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
                    {' · '}{TIPO_PRESUPUESTO_LABELS[p.tipo]}
                  </p>
                </div>
                <p style={{ fontWeight: 700, fontSize: 15 }}>{fmtMoney(p.total || 0)}</p>
              </div>
              <div style={{ marginTop: 10, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <select
                  value={p.estado}
                  onChange={e => seleccionarEstado(p, e.target.value as EstadoPresupuesto)}
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
              {convirtiendoId === p.id && (
                <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid var(--border)', display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' }}>
                  <div className="field" style={{ flex: 1, minWidth: 160 }}>
                    <label>Nombre de la obra</label>
                    <input type="text" value={nombreObraNueva} onChange={e => setNombreObraNueva(e.target.value)} />
                  </div>
                  <button className="btn btn-primary" onClick={() => confirmarConvertir(p)} disabled={convirtiendo} style={{ fontSize: 12, padding: '7px 14px' }}>
                    {convirtiendo ? 'Creando...' : 'Confirmar'}
                  </button>
                  <button className="btn btn-secondary" onClick={() => setConvirtiendoId(null)} style={{ fontSize: 12, padding: '7px 14px' }}>
                    Cancelar
                  </button>
                </div>
              )}
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
                  {detalle.cliente_telefono && <span>Tel: {detalle.cliente_telefono}</span>}
                  {detalle.cliente_email && <span>Email: {detalle.cliente_email}</span>}
                  {detalle.cliente_direccion && <span>Dirección: {detalle.cliente_direccion}</span>}
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
                ) : detalle.tipo === 'externo' ? (
                  <div style={{ marginBottom: 16 }}>
                    {detalle.archivo_url ? (
                      <GaleriaArchivos urls={[detalle.archivo_url]} />
                    ) : (
                      <p style={{ fontSize: 13, color: 'var(--muted)' }}>Sin archivo cargado.</p>
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
                  {detalle.tipo !== 'externo' && (
                    <>
                      <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>Subtotal</span><span>{fmtMoney(detalle.subtotal || 0)}</span></div>
                      {detalle.gg_amount != null && detalle.gg_amount > 0 && (
                        <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>Gastos generales ({detalle.gg_pct}%)</span><span>{fmtMoney(detalle.gg_amount)}</span></div>
                      )}
                      <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>IVA</span><span>{fmtMoney(detalle.iva || 0)}</span></div>
                    </>
                  )}
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 700, fontSize: 15 }}><span>Total</span><span>{fmtMoney(detalle.total || 0)}</span></div>
                </div>

                <div style={{ marginTop: 16, display: 'flex', gap: 8, alignItems: 'center' }}>
                  <select
                    value={detalle.estado}
                    onChange={e => {
                      const nuevo = e.target.value as EstadoPresupuesto
                      if (nuevo === 'convertido') {
                        if (detalle.estado !== 'aceptado') {
                          alert('Primero marca el presupuesto como "Aceptado" y después conviértelo en obra.')
                          return
                        }
                        setDetalleId(null); setDetalle(null); abrirConvertir(detalle)
                        return
                      }
                      cambiarEstado(detalle.id, nuevo)
                    }}
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

/* ─── Calendario compartido de disponibilidad ────────── */
const PERSONAS_CALENDARIO = ['Gustavo', 'Alexandra', ...TRABAJADORES]
const DIAS_SEMANA_CORTOS = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom']

function emptyEvento(fecha: string) {
  return { fecha, hora_inicio: '09:00', hora_fin: '10:00', persona: 'Gustavo', titulo: '', cliente_nombre: '', direccion: '', notas: '' }
}

function fmtFechaLarga(fecha: string) {
  const d = new Date(fecha + 'T00:00:00')
  return d.toLocaleDateString('es-CL', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'America/Santiago' })
}

function hoyISO() {
  return new Date().toISOString().slice(0, 10)
}
function sumarDias(fecha: string, n: number) {
  const d = new Date(fecha + 'T00:00:00')
  d.setDate(d.getDate() + n)
  return d.toISOString().slice(0, 10)
}
function sumarMeses(fecha: string, n: number) {
  const d = new Date(fecha + 'T00:00:00')
  d.setMonth(d.getMonth() + n)
  return d.toISOString().slice(0, 10)
}
// Lunes de la semana que contiene `fecha` -- semana Lunes a Domingo.
function inicioDeSemana(fecha: string) {
  const d = new Date(fecha + 'T00:00:00')
  const dia = d.getDay() // 0=domingo..6=sábado
  const diff = dia === 0 ? -6 : 1 - dia
  return sumarDias(fecha, diff)
}
// 42 días (6 semanas) para la grilla del mes, empezando el lunes de la semana del día 1.
function gridDelMes(fechaAncla: string) {
  const d = new Date(fechaAncla + 'T00:00:00')
  const primerDiaMes = new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10)
  const inicioGrid = inicioDeSemana(primerDiaMes)
  return Array.from({ length: 42 }, (_, i) => sumarDias(inicioGrid, i))
}

function LinksDireccion({ direccion }: { direccion: string }) {
  return (
    <span style={{ display: 'inline-flex', gap: 8 }}>
      <a
        href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(direccion)}`}
        target="_blank" rel="noreferrer"
        style={{ color: 'var(--primary)', fontWeight: 600 }}
      >Maps</a>
      <a
        href={`https://waze.com/ul?q=${encodeURIComponent(direccion)}&navigate=yes`}
        target="_blank" rel="noreferrer"
        style={{ color: 'var(--primary)', fontWeight: 600 }}
      >Waze</a>
    </span>
  )
}

export function PanelCalendario() {
  const [eventos, setEventos] = useState<EventoCalendario[]>([])
  const [loading, setLoading] = useState(true)
  const [mostrarForm, setMostrarForm] = useState(false)
  const [vista, setVista] = useState<'dia' | 'semana' | 'mes'>('semana')
  const [fechaAncla, setFechaAncla] = useState(hoyISO())
  const [form, setForm] = useState(emptyEvento(hoyISO()))
  const [guardando, setGuardando] = useState(false)

  const rango = (() => {
    if (vista === 'dia') return { desde: fechaAncla, hasta: fechaAncla }
    if (vista === 'semana') { const ini = inicioDeSemana(fechaAncla); return { desde: ini, hasta: sumarDias(ini, 6) } }
    const grid = gridDelMes(fechaAncla)
    return { desde: grid[0], hasta: grid[grid.length - 1] }
  })()

  const cargar = useCallback(async (desde: string, hasta: string) => {
    setLoading(true)
    const { data } = await supabase
      .from('eventos_calendario')
      .select('*')
      .gte('fecha', desde)
      .lte('fecha', hasta)
      .order('fecha', { ascending: true })
      .order('hora_inicio', { ascending: true })
    setEventos((data as EventoCalendario[]) || [])
    setLoading(false)
  }, [])

  useEffect(() => { cargar(rango.desde, rango.hasta) }, [cargar, rango.desde, rango.hasta])

  async function crear() {
    if (!form.titulo.trim()) { alert('Completa un título (ej. "Visita técnica - Juan Pérez").'); return }
    if (form.hora_fin <= form.hora_inicio) { alert('La hora de fin tiene que ser después de la hora de inicio.'); return }

    setGuardando(true)

    const { data: existentes } = await supabase
      .from('eventos_calendario')
      .select('hora_inicio, hora_fin, titulo')
      .eq('fecha', form.fecha)
      .eq('persona', form.persona)

    const conflictos = (existentes || []).filter(e => form.hora_inicio < e.hora_fin && form.hora_fin > e.hora_inicio)
    if (conflictos.length > 0) {
      const detalle = conflictos.map(c => `${c.hora_inicio.slice(0, 5)}–${c.hora_fin.slice(0, 5)} (${c.titulo})`).join(', ')
      if (!window.confirm(`${form.persona} ya tiene algo agendado ese día a esa hora: ${detalle}.\n\n¿Confirmas que quieres agendar igual?`)) {
        setGuardando(false)
        return
      }
    }

    const { error } = await supabase.from('eventos_calendario').insert({
      fecha: form.fecha,
      hora_inicio: form.hora_inicio,
      hora_fin: form.hora_fin,
      persona: form.persona,
      titulo: form.titulo.trim(),
      cliente_nombre: form.cliente_nombre.trim() || null,
      direccion: form.direccion.trim() || null,
      notas: form.notas.trim() || null,
    })
    setGuardando(false)
    if (error) {
      alert('No se pudo guardar. Intenta de nuevo.')
      return
    }
    setForm(emptyEvento(fechaAncla))
    setMostrarForm(false)
    cargar(rango.desde, rango.hasta)
  }

  async function eliminar(id: string) {
    if (!window.confirm('¿Seguro que quieres quitar este evento del calendario?')) return
    await supabase.from('eventos_calendario').delete().eq('id', id)
    setEventos(prev => prev.filter(e => e.id !== id))
  }

  const porDia = eventos.reduce<Record<string, EventoCalendario[]>>((acc, e) => {
    if (!acc[e.fecha]) acc[e.fecha] = []
    acc[e.fecha].push(e)
    return acc
  }, {})

  const irA = (fecha: string, v?: 'dia' | 'semana' | 'mes') => {
    setFechaAncla(fecha)
    if (v) setVista(v)
  }
  const anterior = () => irA(vista === 'dia' ? sumarDias(fechaAncla, -1) : vista === 'semana' ? sumarDias(fechaAncla, -7) : sumarMeses(fechaAncla, -1))
  const siguiente = () => irA(vista === 'dia' ? sumarDias(fechaAncla, 1) : vista === 'semana' ? sumarDias(fechaAncla, 7) : sumarMeses(fechaAncla, 1))

  const tituloRango = (() => {
    if (vista === 'dia') return fmtFechaLarga(fechaAncla)
    if (vista === 'semana') {
      const ini = new Date(rango.desde + 'T00:00:00')
      const fin = new Date(rango.hasta + 'T00:00:00')
      const mismoMes = ini.getMonth() === fin.getMonth()
      const finTxt = fin.toLocaleDateString('es-CL', { day: 'numeric', month: mismoMes ? undefined : 'long', timeZone: 'America/Santiago' })
      const iniTxt = ini.toLocaleDateString('es-CL', { day: 'numeric', month: 'long', timeZone: 'America/Santiago' })
      return `${iniTxt} – ${finTxt}`
    }
    return new Date(fechaAncla + 'T00:00:00').toLocaleDateString('es-CL', { month: 'long', year: 'numeric', timeZone: 'America/Santiago' })
  })()

  const renderEvento = (ev: EventoCalendario, compacto = false) => (
    <div key={ev.id} className="card" style={{ padding: compacto ? '8px 10px' : '10px 14px', display: 'flex', alignItems: 'flex-start', gap: 10 }}>
      <div style={{ minWidth: compacto ? 68 : 90, fontSize: compacto ? 12 : 13, fontWeight: 700, color: 'var(--primary)', flexShrink: 0 }}>
        {ev.hora_inicio.slice(0, 5)}–{ev.hora_fin.slice(0, 5)}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <p style={{ fontSize: compacto ? 13 : 14, fontWeight: 600 }}>{ev.titulo}</p>
        <p style={{ fontSize: 12, color: 'var(--muted)' }}>
          {ev.persona}{ev.cliente_nombre ? ` · ${ev.cliente_nombre}` : ''}
        </p>
        {ev.direccion && (
          <p style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>
            {ev.direccion} · <LinksDireccion direccion={ev.direccion} />
          </p>
        )}
        {ev.notas && <p style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>{ev.notas}</p>}
      </div>
      <button className="btn btn-ghost" onClick={() => eliminar(ev.id)} style={{ fontSize: 12, padding: '4px 8px', flexShrink: 0 }}>✕</button>
    </div>
  )

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
        <div style={{ display: 'flex', gap: 4 }}>
          {(['dia', 'semana', 'mes'] as const).map(v => (
            <button
              key={v}
              onClick={() => setVista(v)}
              style={{
                padding: '6px 14px', fontSize: 13, fontWeight: 700, borderRadius: 20, cursor: 'pointer',
                border: `1.5px solid ${vista === v ? 'var(--primary)' : 'var(--border)'}`,
                background: vista === v ? 'var(--primary)' : 'var(--white)',
                color: vista === v ? '#fff' : 'var(--muted)', textTransform: 'capitalize',
              }}
            >{v}</button>
          ))}
        </div>
        <button className="btn btn-secondary" onClick={() => { setForm(emptyEvento(fechaAncla)); setMostrarForm(x => !x) }} style={{ fontSize: 13 }}>
          {mostrarForm ? 'Cancelar' : '+ Agendar'}
        </button>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <button className="btn btn-ghost" onClick={anterior} style={{ fontSize: 16, padding: '4px 10px' }}>‹</button>
          <p style={{ fontSize: 15, fontWeight: 700, textTransform: 'capitalize' }}>{tituloRango}</p>
          <button className="btn btn-ghost" onClick={siguiente} style={{ fontSize: 16, padding: '4px 10px' }}>›</button>
        </div>
        <button className="btn btn-ghost" onClick={() => irA(hoyISO())} style={{ fontSize: 12 }}>Hoy</button>
      </div>

      {mostrarForm && (
        <div className="card" style={{ padding: 16, marginBottom: 20 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
              <div className="field">
                <label>Fecha</label>
                <input type="date" value={form.fecha} onChange={e => setForm(f => ({ ...f, fecha: e.target.value }))} />
              </div>
              <div className="field">
                <label>Hora inicio</label>
                <input type="time" value={form.hora_inicio} onChange={e => setForm(f => ({ ...f, hora_inicio: e.target.value }))} />
              </div>
              <div className="field">
                <label>Hora fin</label>
                <input type="time" value={form.hora_fin} onChange={e => setForm(f => ({ ...f, hora_fin: e.target.value }))} />
              </div>
            </div>
            <div className="field">
              <label>Ocupa la hora de</label>
              <select value={form.persona} onChange={e => setForm(f => ({ ...f, persona: e.target.value }))}>
                {PERSONAS_CALENDARIO.map(p => <option key={p} value={p}>{p}</option>)}
              </select>
            </div>
            <div className="field">
              <label>Título</label>
              <input type="text" placeholder="Ej: Visita técnica - Juan Pérez" value={form.titulo} onChange={e => setForm(f => ({ ...f, titulo: e.target.value }))} />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <div className="field">
                <label>Cliente (opcional)</label>
                <input type="text" value={form.cliente_nombre} onChange={e => setForm(f => ({ ...f, cliente_nombre: e.target.value }))} />
              </div>
              <div className="field">
                <label>Dirección (opcional)</label>
                <input type="text" value={form.direccion} onChange={e => setForm(f => ({ ...f, direccion: e.target.value }))} />
              </div>
            </div>
            <div className="field">
              <label>Notas (opcional)</label>
              <textarea value={form.notas} onChange={e => setForm(f => ({ ...f, notas: e.target.value }))} rows={2} />
            </div>
            <button className="btn btn-primary" onClick={crear} disabled={guardando}>
              {guardando ? 'Guardando...' : '✓ Agendar'}
            </button>
          </div>
        </div>
      )}

      {loading ? (
        <div className="spinner" />
      ) : vista === 'mes' ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 4 }}>
          {DIAS_SEMANA_CORTOS.map(d => (
            <div key={d} style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)', textAlign: 'center', paddingBottom: 4 }}>{d}</div>
          ))}
          {gridDelMes(fechaAncla).map(fecha => {
            const enMes = new Date(fecha + 'T00:00:00').getMonth() === new Date(fechaAncla + 'T00:00:00').getMonth()
            const evs = (porDia[fecha] || []).sort((a, b) => a.hora_inicio.localeCompare(b.hora_inicio))
            const esHoy = fecha === hoyISO()
            return (
              <button
                key={fecha}
                onClick={() => irA(fecha, 'dia')}
                style={{
                  minHeight: 68, padding: '4px 5px', textAlign: 'left', cursor: 'pointer',
                  background: esHoy ? '#fff7ed' : 'var(--white)', opacity: enMes ? 1 : 0.4,
                  border: `1px solid ${esHoy ? 'var(--primary)' : 'var(--border)'}`, borderRadius: 6,
                  display: 'flex', flexDirection: 'column', gap: 2,
                }}
              >
                <span style={{ fontSize: 11, fontWeight: esHoy ? 800 : 600, color: esHoy ? 'var(--primary)' : 'var(--text)' }}>
                  {Number(fecha.slice(8, 10))}
                </span>
                {evs.slice(0, 2).map(ev => (
                  <span key={ev.id} style={{ fontSize: 9.5, color: 'var(--muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'block' }}>
                    {ev.hora_inicio.slice(0, 5)} {ev.titulo}
                  </span>
                ))}
                {evs.length > 2 && (
                  <span style={{ fontSize: 9.5, color: 'var(--primary)', fontWeight: 700 }}>+{evs.length - 2} más</span>
                )}
              </button>
            )
          })}
        </div>
      ) : vista === 'semana' ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
          {Array.from({ length: 7 }, (_, i) => sumarDias(rango.desde, i)).map(fecha => {
            const evs = porDia[fecha] || []
            return (
              <div key={fecha}>
                <p className="font-display" style={{ fontSize: 12, fontWeight: 700, color: fecha === hoyISO() ? 'var(--primary)' : 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.6px', marginBottom: 8, paddingBottom: 6, borderBottom: '1px solid var(--border)' }}>
                  {fmtFechaLarga(fecha)}
                </p>
                {evs.length === 0 ? (
                  <p style={{ fontSize: 12, color: 'var(--muted)', paddingLeft: 2 }}>Sin eventos.</p>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {evs.map(ev => renderEvento(ev, true))}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      ) : (
        // vista === 'dia'
        (porDia[fechaAncla] || []).length === 0 ? (
          <p style={{ color: 'var(--muted)', textAlign: 'center', padding: '2rem 0' }}>Sin eventos agendados este día.</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {(porDia[fechaAncla] || []).map(ev => renderEvento(ev))}
          </div>
        )
      )}
    </div>
  )
}

/* ─── Stock de materiales ────────────────────────────── */
export function PanelStock() {
  const [materiales, setMateriales] = useState<Material[]>([])
  const [movimientos, setMovimientos] = useState<MovimientoStock[]>([])
  const [loading, setLoading] = useState(true)
  const [busqueda, setBusqueda] = useState('')

  const cargar = useCallback(async () => {
    const [{ data: mats }, { data: movs }] = await Promise.all([
      supabase.from('materiales').select('*').order('nombre'),
      supabase.from('movimientos_stock').select('*').order('created_at', { ascending: false }).limit(30),
    ])
    setMateriales((mats as Material[]) || [])
    setMovimientos((movs as MovimientoStock[]) || [])
    setLoading(false)
  }, [])

  useEffect(() => { cargar() }, [cargar])

  const materialesFiltrados = materiales.filter(m =>
    !busqueda.trim() || m.nombre.toLowerCase().includes(busqueda.trim().toLowerCase())
  )
  const materialPorId = new Map(materiales.map(m => [m.id, m]))

  if (loading) return <div className="spinner" />

  return (
    <div>
      <div className="field" style={{ maxWidth: 320, marginBottom: 18 }}>
        <label>Buscar material</label>
        <input value={busqueda} onChange={e => setBusqueda(e.target.value)} placeholder="Nombre del material..." />
      </div>

      {materiales.length === 0 ? (
        <p style={{ color: 'var(--muted)', textAlign: 'center', padding: '2rem 0' }}>
          Todavía no hay materiales en stock — entran solos cuando se marca una compra como "Stock" en el Reporte Diario.
        </p>
      ) : (
        <>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 24 }}>
            {materialesFiltrados.map(m => (
              <StatTile
                key={m.id}
                label={m.nombre}
                valor={`${m.stock_actual}${m.unidad ? ' ' + m.unidad : ''}`}
                tono={m.stock_actual <= 0 ? 'negativo' : 'neutral'}
              />
            ))}
          </div>

          <p className="font-display" style={{ fontSize: 12, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.6px', marginBottom: 8, paddingBottom: 6, borderBottom: '1px solid var(--border)' }}>
            Últimos movimientos
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {movimientos.map(mov => {
              const material = materialPorId.get(mov.material_id)
              return (
                <div key={mov.id} className="card" style={{ padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 10, fontSize: 13 }}>
                  <span style={{ color: 'var(--muted)', fontSize: 12, width: 78, flexShrink: 0 }}>{mov.fecha.split('-').reverse().join('/')}</span>
                  <span style={{ flex: 1 }}>
                    <strong>{material?.nombre || 'Material eliminado'}</strong>
                    {mov.tipo === 'entrada' ? ' — entró al stock' : mov.obra ? ` — usado en ${mov.obra}` : ' — salió del stock'}
                  </span>
                  <span style={{ fontWeight: 700, color: mov.tipo === 'entrada' ? 'var(--success)' : 'var(--warning)' }}>
                    {mov.tipo === 'entrada' ? '+' : '-'}{mov.cantidad}
                  </span>
                </div>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}

/* ─── Ficha de cliente: facturación + marketing + timeline de pendientes ──── */
/* Compartido entre Gustavo.tsx y Admin.tsx (antes había dos listas separadas,
   ambas derivadas de `pendientes.cliente_nombre` — un cliente sin ningún pendiente
   cargado no aparecía en ninguna. Ahora la lista sale directo de la tabla `clientes`.) */
const TIPO_LABELS_CLIENTE: Record<TipoPendiente, string> = {
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

function fmtFechaCliente(iso: string) {
  return new Date(iso).toLocaleString('es-CL', {
    timeZone: 'America/Santiago',
    day: '2-digit', month: '2-digit', year: '2-digit',
    hour: '2-digit', minute: '2-digit',
  })
}

interface DraftCliente {
  rut: string
  razon_social: string
  giro: string
  direccion_fiscal: string
  origen: string
  notas: string
}

function draftDeCliente(c: Cliente): DraftCliente {
  return {
    rut: c.rut || '',
    razon_social: c.razon_social || '',
    giro: c.giro || '',
    direccion_fiscal: c.direccion_fiscal || '',
    origen: c.origen || '',
    notas: c.notas || '',
  }
}

/* `modoAdmin`/`onNuevoPendiente` preservan dos acciones que ya existían solo en la
   sección "Clientes" de Admin.tsx (archivar/desarchivar, atajo "+ Pendiente") — no son
   funcionalidad nueva, solo se mantienen al unificar los dos paneles en este componente. */
export function PanelClientes({ modoAdmin = false, onNuevoPendiente }: { modoAdmin?: boolean; onNuevoPendiente?: (nombre: string) => void } = {}) {
  const [clientes, setClientes] = useState<Cliente[]>([])
  const [loading, setLoading] = useState(true)
  const [verArchivados, setVerArchivados] = useState(false)
  const [seleccionado, setSeleccionado] = useState<Cliente | null>(null)
  const [historial, setHistorial] = useState<Pendiente[]>([])
  const [loadingH, setLoadingH] = useState(false)
  const [draft, setDraft] = useState<DraftCliente>({ rut: '', razon_social: '', giro: '', direccion_fiscal: '', origen: '', notas: '' })
  const [guardando, setGuardando] = useState(false)

  const cargar = useCallback(async () => {
    setLoading(true)
    const { data } = await supabase.from('clientes').select('*').eq('archivado', verArchivados).order('nombre')
    setClientes((data as Cliente[]) || [])
    setLoading(false)
  }, [verArchivados])

  useEffect(() => { cargar() }, [cargar])

  async function verCliente(c: Cliente) {
    setSeleccionado(c)
    setDraft(draftDeCliente(c))
    setLoadingH(true)
    const { data } = await supabase
      .from('pendientes')
      .select('*')
      .eq('cliente_nombre', c.nombre)
      .order('created_at', { ascending: true })
    setHistorial((data as Pendiente[]) || [])
    setLoadingH(false)
  }

  async function guardar() {
    if (!seleccionado) return
    setGuardando(true)
    const patch = {
      rut: draft.rut.trim() || null,
      razon_social: draft.razon_social.trim() || null,
      giro: draft.giro.trim() || null,
      direccion_fiscal: draft.direccion_fiscal.trim() || null,
      origen: draft.origen.trim() || null,
      notas: draft.notas.trim() || null,
    }
    const { error } = await supabase.from('clientes').update(patch).eq('id', seleccionado.id)
    setGuardando(false)
    if (error) {
      alert('Error al guardar: ' + error.message)
      return
    }
    setSeleccionado(prev => (prev ? { ...prev, ...patch } : prev))
    cargar()
  }

  async function toggleArchivado(c: Cliente) {
    await supabase.from('clientes').update({ archivado: !c.archivado, archivado_at: !c.archivado ? new Date().toISOString() : null }).eq('id', c.id)
    setSeleccionado(null)
    cargar()
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

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10, marginBottom: 10, flexWrap: 'wrap' }}>
          <h2 style={{ fontSize: 18, fontWeight: 800 }}>{seleccionado.nombre}</h2>
          <div style={{ display: 'flex', gap: 8 }}>
            {modoAdmin && onNuevoPendiente && (
              <button className="btn btn-primary" style={{ fontSize: 12, padding: '6px 12px' }} onClick={() => onNuevoPendiente(seleccionado.nombre)}>
                + Pendiente
              </button>
            )}
            <button
              className="btn btn-ghost"
              style={{ fontSize: 12, padding: '6px 12px' }}
              onClick={() => toggleArchivado(seleccionado)}
              title={seleccionado.archivado ? 'Volver a mostrar en la lista' : 'Sacar de la lista sin borrar el historial'}
            >
              {seleccionado.archivado ? 'Desarchivar' : 'Archivar'}
            </button>
          </div>
        </div>

        <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', fontSize: 13, color: 'var(--muted)', marginBottom: 20 }}>
          {seleccionado.telefono && <span>Tel: {seleccionado.telefono}</span>}
          {seleccionado.email && <span>Email: {seleccionado.email}</span>}
          {seleccionado.comuna && <span>Comuna: {seleccionado.comuna}</span>}
        </div>

        <div className="card" style={{ padding: '14px 16px', marginBottom: 14 }}>
          <p style={{ fontSize: 12, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 10 }}>
            Facturación
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10 }}>
            <div className="field">
              <label>RUT</label>
              <input value={draft.rut} onChange={e => setDraft(d => ({ ...d, rut: e.target.value }))} />
            </div>
            <div className="field">
              <label>Razón social</label>
              <input value={draft.razon_social} onChange={e => setDraft(d => ({ ...d, razon_social: e.target.value }))} />
            </div>
            <div className="field">
              <label>Giro</label>
              <input value={draft.giro} onChange={e => setDraft(d => ({ ...d, giro: e.target.value }))} />
            </div>
            <div className="field">
              <label>Dirección fiscal</label>
              <input value={draft.direccion_fiscal} onChange={e => setDraft(d => ({ ...d, direccion_fiscal: e.target.value }))} />
            </div>
          </div>
        </div>

        <div className="card" style={{ padding: '14px 16px', marginBottom: 14 }}>
          <p style={{ fontSize: 12, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 10 }}>
            Marketing
          </p>
          <div className="field" style={{ marginBottom: 10 }}>
            <label>Cómo llegó</label>
            <input value={draft.origen} onChange={e => setDraft(d => ({ ...d, origen: e.target.value }))} placeholder="Ej: Recomendado, Instagram, Google..." />
          </div>
          <div className="field">
            <label>Notas</label>
            <textarea value={draft.notas} onChange={e => setDraft(d => ({ ...d, notas: e.target.value }))} rows={3} />
          </div>
        </div>

        <button className="btn btn-primary" onClick={guardar} disabled={guardando} style={{ marginBottom: 24 }}>
          {guardando ? 'Guardando...' : 'Guardar cambios'}
        </button>

        <p className="font-display" style={{ fontSize: 12, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.6px', marginBottom: 10, paddingBottom: 6, borderBottom: '1px solid var(--border)' }}>
          Historial
        </p>

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
                        {TIPO_LABELS_CLIENTE[h.tipo]}
                      </span>
                      <span style={{ fontSize: 11, color: 'var(--muted)' }}>{fmtFechaCliente(h.created_at)}</span>
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
                          {esIrazu ? 'Admin respondió:' : 'Respuesta:'}
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
      <button
        onClick={() => setVerArchivados(v => !v)}
        className="btn btn-secondary"
        style={{ fontSize: 12, padding: '6px 12px', marginBottom: 12 }}
      >
        {verArchivados ? '← Ver clientes activos' : 'Ver archivados'}
      </button>
      {loading ? (
        <div className="spinner" />
      ) : clientes.length === 0 ? (
        <p style={{ color: 'var(--muted)', textAlign: 'center', padding: '2rem 0' }}>
          {verArchivados ? 'No hay clientes archivados.' : 'Aún no hay clientes registrados.'}
        </p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {clientes.map(c => (
            <button
              key={c.id}
              onClick={() => verCliente(c)}
              style={{
                width: '100%', padding: '14px 16px',
                borderRadius: 12, border: '1.5px solid var(--border)',
                background: 'var(--white)', fontSize: 15, fontWeight: 600,
                color: 'var(--text)', cursor: 'pointer', textAlign: 'left',
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              }}
            >
              <span>{c.nombre}{c.rut ? ` · ${c.rut}` : ''}</span>
              <span style={{ fontSize: 14, color: 'var(--muted)' }}>→</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

/* ─── Banco de contenido: fotos/video de obra para marketing ──────────
   Alimentado por Fabriel/Misael desde /obra-fotos. Alexandra revisa, marca
   destacados y descarga por obra/período. */
type VistaBanco = 'semana' | 'mes'

const MOMENTO_LABEL: Record<'antes' | 'durante' | 'despues', string> = {
  antes: 'Antes', durante: 'Durante', despues: 'Después',
}

function agruparMediaPorPeriodo(vista: VistaBanco, media: ObraMedia[]): { key: string; label: string; enCurso: boolean; items: ObraMedia[] }[] {
  const mapa = new Map<string, { key: string; label: string; enCurso: boolean; items: ObraMedia[] }>()
  for (const m of media) {
    const fecha = m.created_at.slice(0, 10)
    const { key, label, enCurso } = getPeriodo(fecha, vista)
    if (!mapa.has(key)) mapa.set(key, { key, label, enCurso, items: [] })
    mapa.get(key)!.items.push(m)
  }
  return Array.from(mapa.values()).sort((a, b) => b.key.localeCompare(a.key))
}

export function PanelBancoContenido() {
  const [obras, setObras] = useState<{ id: string; nombre: string }[]>([])
  const [media, setMedia] = useState<ObraMedia[]>([])
  const [loading, setLoading] = useState(true)
  const [obraFiltro, setObraFiltro] = useState('')
  const [vista, setVista] = useState<VistaBanco>('semana')
  const [periodoKey, setPeriodoKey] = useState('')
  const [soloDestacados, setSoloDestacados] = useState(false)
  const [visorIndex, setVisorIndex] = useState<number | null>(null)

  const cargar = useCallback(async () => {
    const [{ data: o }, { data: m }] = await Promise.all([
      supabase.from('obras').select('id, nombre').order('nombre'),
      supabase.from('obra_media').select('*').order('created_at', { ascending: false }),
    ])
    setObras((o as { id: string; nombre: string }[]) || [])
    setMedia((m as ObraMedia[]) || [])
    setLoading(false)
  }, [])

  useEffect(() => { cargar() }, [cargar])

  async function toggleDestacado(item: ObraMedia) {
    await supabase.from('obra_media').update({ destacado: !item.destacado }).eq('id', item.id)
    setMedia(prev => prev.map(m => m.id === item.id ? { ...m, destacado: !m.destacado } : m))
  }

  const obraMap = new Map(obras.map(o => [o.id, o.nombre]))
  const mediaFiltradaObra = obraFiltro ? media.filter(m => m.obra_id === obraFiltro) : media
  const periodos = agruparMediaPorPeriodo(vista, mediaFiltradaObra)
  const periodo = periodos.find(p => p.key === periodoKey) || periodos.find(p => p.enCurso) || periodos[0] || null
  const itemsPeriodo = periodo ? (soloDestacados ? periodo.items.filter(m => m.destacado) : periodo.items) : []

  // Navegación del visor con flechas del teclado -- se define acá (antes del `if (loading)`)
  // porque los hooks no pueden ser condicionales.
  useEffect(() => {
    if (visorIndex === null) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'ArrowRight') setVisorIndex(i => (i === null ? null : (i + 1) % itemsPeriodo.length))
      if (e.key === 'ArrowLeft') setVisorIndex(i => (i === null ? null : (i - 1 + itemsPeriodo.length) % itemsPeriodo.length))
      if (e.key === 'Escape') setVisorIndex(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [visorIndex, itemsPeriodo.length])

  if (loading) return <div className="spinner" />

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, fontWeight: 600, color: 'var(--text-inverse)' }}>
          Obra:
          <select
            value={obraFiltro}
            onChange={e => { setObraFiltro(e.target.value); setPeriodoKey('') }}
            style={{
              width: 'auto', padding: '6px 10px', fontSize: 13, fontWeight: 600, borderRadius: 6,
              border: '1.5px solid var(--primary)', background: 'var(--white)', color: 'var(--secondary)',
              cursor: 'pointer', appearance: 'auto',
            }}
          >
            <option value="">Todas</option>
            {obras.map(o => <option key={o.id} value={o.id}>{o.nombre}</option>)}
          </select>
        </label>
        <div style={{ display: 'flex', gap: 4 }}>
          {(['semana', 'mes'] as const).map(v => (
            <button
              key={v}
              onClick={() => { setVista(v); setPeriodoKey('') }}
              style={{
                padding: '6px 12px', borderRadius: 6, cursor: 'pointer', fontSize: 12, fontWeight: 700,
                border: `1.5px solid ${vista === v ? 'var(--primary)' : 'var(--border)'}`,
                background: vista === v ? 'var(--primary)' : 'var(--white)',
                color: vista === v ? '#fff' : 'var(--text)',
              }}
            >{v === 'semana' ? 'Semana' : 'Mes'}</button>
          ))}
        </div>
        {periodo && (
          <select
            value={periodo.key}
            onChange={e => setPeriodoKey(e.target.value)}
            style={{
              width: 'auto', padding: '6px 10px', fontSize: 13, fontWeight: 600, borderRadius: 6,
              border: '1.5px solid var(--primary)', background: 'var(--white)', color: 'var(--secondary)',
              cursor: 'pointer', appearance: 'auto',
            }}
          >
            {periodos.map(p => (
              <option key={p.key} value={p.key}>{p.label}{p.enCurso ? ' (en curso)' : ''}</option>
            ))}
          </select>
        )}
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, fontWeight: 600, cursor: 'pointer', marginLeft: 'auto' }}>
          <input type="checkbox" checked={soloDestacados} onChange={e => setSoloDestacados(e.target.checked)} style={{ width: 16, height: 16, accentColor: 'var(--primary)', cursor: 'pointer' }} />
          Solo destacados
        </label>
      </div>

      {itemsPeriodo.length === 0 ? (
        <p style={{ color: 'var(--muted)', fontSize: 14 }}>
          {media.length === 0
            ? 'Todavía no hay fotos ni videos cargados desde obra.'
            : `Sin material ${soloDestacados ? 'destacado ' : ''}en este período${obraFiltro ? ' para esta obra' : ''}.`}
        </p>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 12 }}>
          {itemsPeriodo.map(m => (
            <div key={m.id} className="card" style={{ padding: 8, position: 'relative' }}>
              <button
                onClick={() => toggleDestacado(m)}
                title={m.destacado ? 'Quitar de destacados' : 'Marcar como destacado'}
                style={{
                  position: 'absolute', top: 12, left: 12, zIndex: 1,
                  background: 'rgba(0,0,0,0.55)', border: 'none', borderRadius: '50%',
                  width: 26, height: 26, cursor: 'pointer', fontSize: 15, lineHeight: 1,
                  color: m.destacado ? '#fbbf24' : '#fff',
                }}
              >★</button>
              {m.autorizado_cliente && (
                <span
                  title="El cliente autorizó usar esto en redes"
                  style={{
                    position: 'absolute', top: 12, right: 12, zIndex: 1, fontSize: 13,
                    background: 'rgba(0,0,0,0.55)', borderRadius: '50%', width: 26, height: 26,
                    display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#4ade80',
                  }}
                >✓</span>
              )}
              <button
                type="button"
                onClick={() => setVisorIndex(itemsPeriodo.indexOf(m))}
                style={{ display: 'block', width: '100%', padding: 0, border: 'none', background: 'none', cursor: 'pointer' }}
              >
                {m.tipo === 'foto' ? (
                  <img src={m.url} alt="" style={{ width: '100%', height: 120, objectFit: 'cover', borderRadius: 8, border: '1px solid var(--border)' }} />
                ) : m.tipo === 'video' ? (
                  <div style={{ width: '100%', height: 120, borderRadius: 8, border: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--surface-alt)', fontSize: 12, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase' }}>Video</div>
                ) : (
                  <div style={{ width: '100%', height: 120, borderRadius: 8, border: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--surface-alt)', fontSize: 12, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase' }}>Archivo</div>
                )}
              </button>
              <div style={{ marginTop: 6, display: 'flex', flexDirection: 'column', gap: 2 }}>
                {!obraFiltro && (
                  <p style={{ fontSize: 11, fontWeight: 700, color: 'var(--secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {obraMap.get(m.obra_id) || 'Obra eliminada'}
                  </p>
                )}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 6 }}>
                  <span style={{ fontSize: 11, color: 'var(--muted)' }}>
                    {m.momento ? MOMENTO_LABEL[m.momento] : '—'}{m.subido_por ? ` · ${m.subido_por}` : ''}
                  </span>
                  <a href={m.url} download target="_blank" rel="noreferrer" style={{ fontSize: 11, fontWeight: 700, color: 'var(--primary)' }}>
                    Descargar
                  </a>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {visorIndex !== null && itemsPeriodo[visorIndex] && (() => {
        const actual = itemsPeriodo[visorIndex]
        return (
          <div
            onClick={() => setVisorIndex(null)}
            style={{
              position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(10,14,26,0.92)',
              display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '3rem 1.5rem',
            }}
          >
            <button
              onClick={() => setVisorIndex(null)}
              title="Cerrar (Esc)"
              style={{
                position: 'absolute', top: 16, right: 16, background: 'rgba(255,255,255,0.12)', border: 'none', borderRadius: '50%',
                width: 40, height: 40, color: '#fff', fontSize: 18, cursor: 'pointer', lineHeight: 1,
              }}
            >✕</button>

            {itemsPeriodo.length > 1 && (
              <button
                onClick={e => { e.stopPropagation(); setVisorIndex(i => (i === null ? null : (i - 1 + itemsPeriodo.length) % itemsPeriodo.length)) }}
                title="Anterior (←)"
                style={{
                  position: 'absolute', left: 16, top: '50%', transform: 'translateY(-50%)',
                  background: 'rgba(255,255,255,0.12)', border: 'none', borderRadius: '50%',
                  width: 48, height: 48, color: '#fff', fontSize: 22, cursor: 'pointer', lineHeight: 1,
                }}
              >‹</button>
            )}
            {itemsPeriodo.length > 1 && (
              <button
                onClick={e => { e.stopPropagation(); setVisorIndex(i => (i === null ? null : (i + 1) % itemsPeriodo.length)) }}
                title="Siguiente (→)"
                style={{
                  position: 'absolute', right: 16, top: '50%', transform: 'translateY(-50%)',
                  background: 'rgba(255,255,255,0.12)', border: 'none', borderRadius: '50%',
                  width: 48, height: 48, color: '#fff', fontSize: 22, cursor: 'pointer', lineHeight: 1,
                }}
              >›</button>
            )}

            <div onClick={e => e.stopPropagation()} style={{ maxWidth: '90vw', maxHeight: '78vh', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
              {actual.tipo === 'foto' ? (
                <img src={actual.url} alt="" style={{ maxWidth: '90vw', maxHeight: '72vh', borderRadius: 10, objectFit: 'contain' }} />
              ) : actual.tipo === 'video' ? (
                <video src={actual.url} controls autoPlay style={{ maxWidth: '90vw', maxHeight: '72vh', borderRadius: 10 }} />
              ) : (
                <a href={actual.url} target="_blank" rel="noreferrer" style={{ color: '#fff', fontWeight: 700 }}>Abrir archivo →</a>
              )}
              <div style={{ display: 'flex', alignItems: 'center', gap: 14, color: 'rgba(255,255,255,0.85)', fontSize: 13 }}>
                <span>{visorIndex + 1} de {itemsPeriodo.length}</span>
                <span>{actual.momento ? MOMENTO_LABEL[actual.momento] : '—'}{actual.subido_por ? ` · ${actual.subido_por}` : ''}</span>
                <a href={actual.url} download target="_blank" rel="noreferrer" style={{ color: '#fff', fontWeight: 700, textDecoration: 'underline' }}>Descargar</a>
              </div>
            </div>
          </div>
        )
      })()}
    </div>
  )
}

/* ─── Ideas de contenido: Alexandra carga, Gustavo ejecuta ─────────────
   En Admin (soloLectura=false) se puede crear/borrar/cambiar estado. En
   Gustavo (soloLectura=true) solo se puede tildar "Marcar como hecho". */
export function PanelIdeasContenido({ soloLectura = false }: { soloLectura?: boolean }) {
  const [ideas, setIdeas] = useState<IdeaContenido[]>([])
  const [loading, setLoading] = useState(true)
  const [titulo, setTitulo] = useState('')
  const [hook, setHook] = useState('')
  const [formato, setFormato] = useState('')
  const [tema, setTema] = useState('')
  const [guardando, setGuardando] = useState(false)

  const cargar = useCallback(async () => {
    const { data } = await supabase.from('ideas_contenido').select('*').order('created_at', { ascending: false })
    setIdeas((data as IdeaContenido[]) || [])
    setLoading(false)
  }, [])

  useEffect(() => { cargar() }, [cargar])

  async function crear() {
    if (!titulo.trim()) { alert('Escribe un título para la idea.'); return }
    setGuardando(true)
    const { error } = await supabase.from('ideas_contenido').insert({
      titulo: titulo.trim(),
      hook: hook.trim() || null,
      formato: formato.trim() || null,
      tema: tema.trim() || null,
    })
    setGuardando(false)
    if (error) { alert('Error al guardar la idea: ' + error.message); return }
    setTitulo(''); setHook(''); setFormato(''); setTema('')
    cargar()
  }

  async function toggleEstado(idea: IdeaContenido) {
    const nuevoEstado = idea.estado === 'hecho' ? 'pendiente' : 'hecho'
    await supabase.from('ideas_contenido').update({ estado: nuevoEstado }).eq('id', idea.id)
    setIdeas(prev => prev.map(i => i.id === idea.id ? { ...i, estado: nuevoEstado } : i))
  }

  async function eliminar(id: string) {
    if (!window.confirm('¿Seguro que quieres borrar esta idea?')) return
    await supabase.from('ideas_contenido').delete().eq('id', id)
    setIdeas(prev => prev.filter(i => i.id !== id))
  }

  if (loading) return <div className="spinner" />

  const pendientes = ideas.filter(i => i.estado === 'pendiente')
  const hechas = ideas.filter(i => i.estado === 'hecho')

  return (
    <div>
      {!soloLectura && (
        <div className="card" style={{ padding: 16, marginBottom: 16 }}>
          <p style={{ fontSize: 13, fontWeight: 700, color: 'var(--secondary)', marginBottom: 10, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
            Nueva idea
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <input
              value={titulo}
              onChange={e => setTitulo(e.target.value)}
              placeholder="Título de la idea"
              style={{ padding: '9px 12px', borderRadius: 8, border: '1.5px solid var(--border)', fontSize: 14 }}
            />
            <input
              value={hook}
              onChange={e => setHook(e.target.value)}
              placeholder="Hook (la frase que engancha al empezar el video)"
              style={{ padding: '9px 12px', borderRadius: 8, border: '1.5px solid var(--border)', fontSize: 14 }}
            />
            <div style={{ display: 'flex', gap: 8 }}>
              <input
                value={formato}
                onChange={e => setFormato(e.target.value)}
                placeholder="Formato (ej: Reel, Antes/Después)"
                style={{ flex: 1, padding: '9px 12px', borderRadius: 8, border: '1.5px solid var(--border)', fontSize: 14 }}
              />
              <input
                value={tema}
                onChange={e => setTema(e.target.value)}
                placeholder="Tema"
                style={{ flex: 1, padding: '9px 12px', borderRadius: 8, border: '1.5px solid var(--border)', fontSize: 14 }}
              />
            </div>
            <button className="btn btn-primary" onClick={crear} disabled={guardando} style={{ alignSelf: 'flex-start' }}>
              {guardando ? 'Guardando...' : '+ Agregar idea'}
            </button>
          </div>
        </div>
      )}

      {ideas.length === 0 ? (
        <p style={{ fontSize: 13, color: 'var(--muted)', textAlign: 'center', padding: '2rem 0' }}>
          {soloLectura ? 'Todavía no hay ideas de contenido cargadas.' : 'Todavía no cargaste ninguna idea.'}
        </p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {pendientes.map(idea => (
            <div key={idea.id} className="card" style={{ padding: 14 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
                <p style={{ fontWeight: 700, fontSize: 14 }}>{idea.titulo}</p>
                {!soloLectura && (
                  <button onClick={() => eliminar(idea.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 15, color: 'var(--muted)', lineHeight: 1, flexShrink: 0 }}>✕</button>
                )}
              </div>
              {idea.hook && <p style={{ fontSize: 13, color: 'var(--text)', marginTop: 6, fontStyle: 'italic' }}>"{idea.hook}"</p>}
              {(idea.formato || idea.tema) && (
                <p style={{ fontSize: 12, color: 'var(--muted)', marginTop: 6 }}>
                  {[idea.formato, idea.tema].filter(Boolean).join(' · ')}
                </p>
              )}
              <button
                onClick={() => toggleEstado(idea)}
                className="btn btn-secondary"
                style={{ fontSize: 12, padding: '6px 12px', marginTop: 10 }}
              >
                Marcar como hecho
              </button>
            </div>
          ))}
          {hechas.length > 0 && (
            <div style={{ borderTop: '1px solid var(--border)', paddingTop: 10, marginTop: 4, display: 'flex', flexDirection: 'column', gap: 6 }}>
              {hechas.map(idea => (
                <div key={idea.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', opacity: 0.6 }}>
                  <span style={{ flex: 1, fontSize: 13, textDecoration: 'line-through' }}>{idea.titulo}</span>
                  <button
                    onClick={() => toggleEstado(idea)}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 11, color: 'var(--primary)', fontWeight: 600 }}
                  >Reabrir</button>
                  {!soloLectura && (
                    <button onClick={() => eliminar(idea.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 14, color: 'var(--muted)', lineHeight: 1 }}>✕</button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
