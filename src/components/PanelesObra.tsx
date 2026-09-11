import { useState, useEffect, useCallback, Fragment } from 'react'
import { supabase } from '../lib/supabase'
import { GaleriaArchivos } from './GaleriaArchivos'
import { generatePDF } from '../utils/pdfGenerator'
import { generatePDFEtapas } from '../utils/pdfGeneratorEtapas'
import { generatePDFConsolidado } from '../utils/pdfConsolidado'
import type { LineaConsolidado, DocumentoConsolidado } from '../utils/pdfConsolidado'
import type { ReporteTrabajadorDia, ReporteCompraDia, ReporteCobroDia, ReporteSubcontratoDia, ReporteTrabajoPuntualDia, Trabajador, CuentaPorCobrar, AbonoCuenta, GastoFijo, GastoVariable, Obra, SubcontratoMaster, PresupuestoGuardado, PresupuestoDetalle, EstadoPresupuesto, EstadoObra, ObraMedia, EventoCalendario, Material, MovimientoStock, CompraItem, Cliente, Pendiente, TipoPendiente, PagoSemanalComprobante, IdeaContenido, AjustePagoSemanal, AdelantoTrabajador, ObraItem, ObraFase, ObraAvanceRegistro, PresupuestoItemSimple, PresupuestoEtapa, ClienteFactura } from '../types'

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
// `opciones` (09/09) es para los adicionales: sus ítems se agregan a una obra que ya tiene
// los del original, así que van con un nombre de fase propio ("Adicional HRM-...") para que
// en Avance de obra se vea qué se presupuestó de entrada y qué se agregó después, y con el
// orden corrido para no pisar la numeración de los que ya estaban. La agrupación de Avance
// sale de los propios ítems (no exige una fila en obra_fases), así que esto no necesita
// ninguna migración.
export async function copiarItemsAObra(
  obraId: string,
  presupuesto: { tipo: string; items: PresupuestoItemSimple[] | null; etapas: PresupuestoEtapa[] | null },
  opciones?: { fase?: string; ordenDesde?: number }
) {
  const filas: Omit<ObraItem, 'id' | 'created_at'>[] = []
  const faseBase = opciones?.fase ?? null
  const ordenDesde = opciones?.ordenDesde ?? 0

  if (presupuesto.tipo !== 'etapas' && presupuesto.items) {
    presupuesto.items.forEach((it, idx) => {
      filas.push({
        obra_id: obraId,
        fase: faseBase,
        descripcion: it.description,
        categoria: it.categoria || null,
        cantidad: it.quantity,
        precio_unitario: it.price,
        total: it.total,
        cantidad_completada: 0,
        orden: ordenDesde + idx,
      })
    })
  } else if (presupuesto.tipo === 'etapas' && presupuesto.etapas) {
    let orden = 0
    presupuesto.etapas.forEach(etapa => {
      etapa.items.forEach(it => {
        filas.push({
          obra_id: obraId,
          // En un adicional por etapas, la etapa se cuelga del adicional para no mezclarla
          // con una etapa del mismo nombre que ya exista en la obra.
          fase: faseBase ? `${faseBase} — ${etapa.nombre}` : etapa.nombre,
          descripcion: it.descripcion,
          categoria: it.tipo,
          cantidad: it.cantidad,
          precio_unitario: it.precioUnitario,
          total: it.total,
          cantidad_completada: 0,
          orden: ordenDesde + orden++,
        })
      })
    })

    const fases = presupuesto.etapas.map((etapa, idx) => ({
      obra_id: obraId,
      // Mismo nombre que se le puso a los ítems arriba, o la agenda quedaría apuntando a
      // una fase que ningún ítem tiene.
      nombre: faseBase ? `${faseBase} — ${etapa.nombre}` : etapa.nombre,
      orden: ordenDesde + idx,
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

// `compacta` corta el ancho del título para que uno largo baje a dos líneas en vez de
// estirar la tarjeta a lo ancho: "Abonado a subcontratistas" en una sola línea hacía una
// tarjeta del doble que las de al lado y rompía la grilla (Alexandra, 11/09).
export function StatTile({ label, valor, tono = 'neutral', nota, compacta = false }: { label: string; valor: string; tono?: 'neutral' | 'positivo' | 'negativo' | 'alerta'; nota?: string; compacta?: boolean }) {
  const color = tono === 'positivo' ? 'var(--success)' : tono === 'negativo' ? 'var(--danger)' : tono === 'alerta' ? 'var(--primary)' : 'var(--text)'
  return (
    <div style={{ padding: '13px 13px', background: 'var(--surface)', borderRadius: 14, minWidth: 0, boxShadow: 'var(--shadow)' }}>
      <p className="font-display" style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.6px', marginBottom: 4, maxWidth: compacta ? 130 : undefined, lineHeight: 1.25 }}>
        {label}
      </p>
      <p className="font-display" style={{ fontSize: 20, fontWeight: 700, color, fontVariantNumeric: 'tabular-nums', lineHeight: 1 }}>
        {valor}
      </p>
      {nota && (
        <p style={{ fontSize: 11, color: 'var(--muted)', marginTop: 5, fontVariantNumeric: 'tabular-nums', lineHeight: 1.3 }}>
          {nota}
        </p>
      )}
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

// IVA chileno. Se usa para bajar a NETO el monto de las compras, que se carga con el total
// del documento. Gustavo confirmó el 11/09 que todas las compras de materiales van con
// factura: ese IVA se recupera como crédito fiscal, así que no es costo real de la obra.
// Verificado además contra los datos -- las compras con desglose cargado dan
// monto/desglose = 1,19. Ver decisiones.md 2026-09-11 (revisado).
const IVA_PCT = 19

// Los subcontratistas NO facturan ni boletean (confirmado el 11/09), así que lo que se les
// paga es costo completo y no pasa por acá. Si algún día empiezan a facturar, este es el
// lugar donde habría que tratarlos igual que las compras.
function aNeto(montoConIva: number) {
  return Math.round(montoConIva / (1 + IVA_PCT / 100))
}

// Resumen por obra (cobrado, gastado, saldo, falta por cobrar) -- extraído de
// PanelObras para que PanelConsultasIA (chat con IA) use exactamente el mismo
// cálculo, y nunca le muestre a Gustavo un número de saldo distinto al de la
// pestaña Obras.
export function calcularResumenObras(
  obrasMaestro: Obra[],
  diarios: ReporteTrabajadorDia[],
  compras: ReporteCompraDia[],
  cobros: ReporteCobroDia[],
  subcontratos: ReporteSubcontratoDia[],
  cuentas: CuentaPorCobrar[],
  abonos: AbonoCuenta[],
  subcontratosMaster: SubcontratoMaster[],
  trabajadoresTarifas: Trabajador[],
  // Salidas de bodega hacia obras (09/09). Opcional para no romper a quien llame sin esto:
  // sin el dato el resultado es el de antes, no un número a medias.
  salidasStock: MovimientoStock[] = [],
) {
  const nombres = Array.from(new Set([
    ...obrasMaestro.map(o => o.nombre),
    ...diarios.filter(d => d.presente && d.obra).map(d => d.obra as string),
    ...compras.filter(c => c.obra).map(c => c.obra as string),
    ...cobros.filter(c => c.obra).map(c => c.obra as string),
    ...subcontratos.filter(s => s.obra).map(s => s.obra as string),
    ...cuentas.filter(c => c.obra).map(c => c.obra as string),
  ]))

  return nombres.map(obra => {
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

    // Material que salió de bodega hacia esta obra, valorizado con el precio congelado en
    // cada salida. Es la otra mitad del modelo de bodega (09/09): una compra marcada como
    // "Stock" no le suma costo a ninguna obra, porque al pagarla todavía no se sabe a cuál
    // va -- el costo se le carga a la obra recién cuando el material sale con su vale.
    // Sin esto, comprar a bodega haría desaparecer el costo de materiales de las obras y el
    // margen se vería mejor de lo que es. Ya viene NETO: el precio del catálogo sale del
    // desglose de la factura, que es sin IVA.
    const salidasObra = salidasStock.filter(m => m.tipo === 'salida' && m.obra === obra)
    const gastoMaterialesBodega = salidasObra.reduce((sum, m) => sum + m.cantidad * (m.precio_unitario || 0), 0)
    // Dos números distintos a propósito, y la diferencia importa:
    //   * `gastoCompras` es lo que salió del banco (el total del documento, con IVA). Sirve
    //     para cuadrar caja y es lo que se muestra en la tarjeta "Compras".
    //   * `gastoComprasNeto` es lo que la obra COSTÓ de verdad. El IVA de una compra con
    //     factura se recupera como crédito fiscal, así que contarlo como costo hace ver la
    //     obra peor de lo que es. Es el que entra en el saldo y en el margen.
    const gastoCompras = comprasObra.reduce((sum, c) => sum + c.monto, 0)
    const gastoComprasNeto = aNeto(gastoCompras)
    const ivaRecuperableCompras = gastoCompras - gastoComprasNeto
    const contratosObra = subcontratosMaster.filter(s => s.obra === obra)
    const gastoSubcontratos = contratosObra.length > 0
      ? contratosObra.reduce((sum, s) => sum + s.total_contrato, 0)
      : subcontratosObra.reduce((sum, s) => sum + s.monto, 0)
    const pagadoSubcontratos = subcontratosObra.reduce((sum, s) => sum + s.monto, 0)
    // Nombres y abonos uno por uno, para poder mostrarlos en la tarjeta de la obra sin
    // obligar a abrir el detalle -- pedido de Alexandra (11/09). "Pagado hasta ahora
    // $300.000" no dice si fue una transferencia o tres, que es justo lo que hay que saber
    // antes de hacer la próxima.
    const subcontratistas = Array.from(new Set(contratosObra.map(s => s.subcontratista))).join(', ')
    const abonosSubcontratos = [...subcontratosObra].sort((a, b) => b.fecha.localeCompare(a.fecha))
    const adelantos = diariosObra.filter(d => d.tipo_pago !== 'pago_semanal').reduce((sum, d) => sum + (d.adelanto_monto || 0), 0)
    const pagosSemanales = diariosObra.filter(d => d.tipo_pago === 'pago_semanal').reduce((sum, d) => sum + (d.adelanto_monto || 0), 0)
    const manoDeObra = diariosObra.reduce((sum, d) => {
      const tarifa = trabajadoresTarifas.find(t => t.nombre === d.trabajador)
      const base = d.fraccion_jornada * (tarifa?.tarifa_diaria || 0)
      const viaticoMonto = d.viatico ? (tarifa?.viatico_diario || 0) : 0
      return sum + base + viaticoMonto
    }, 0)
    // Va en BRUTO a propósito, al revés que el costo: a la persona se le devuelve lo que
    // puso, que es el total de la boleta. El IVA lo recupera la empresa, no ella.
    const porReembolsar = comprasObra.filter(c => c.pagado_por && !c.reembolsado).reduce((sum, c) => sum + c.monto, 0)
    const cobrado = cobrosObra.reduce((sum, c) => sum + c.monto, 0) + cobradoManual
    // Saldo = lo cobrado menos lo que CUESTA la obra, no lo que ya salió de la cuenta.
    // Un costo cuenta cuando se incurre, no cuando se paga:
    //   * la mano de obra, cuando el trabajador trabajó (días × tarifa + viático);
    //   * los subcontratos, por lo CONTRATADO (`gastoSubcontratos`), no por lo pagado --
    //     la plata ya está comprometida aunque la factura no haya llegado.
    // Por eso NO se restan aparte los adelantos ni los pagos semanales cargados contra la
    // obra: son el PAGO de esa misma mano de obra, y restarlos además la contaría dos veces
    // (Ohiggins tiene $3.615.000 de mano de obra y $1.595.000 cargados como pagos).
    // Es el criterio de "committed cost" que usan los sistemas de job costing: seguir solo
    // lo pagado te entera del sobrecosto cuando ya es tarde. Ver decisiones.md 2026-09-07.
    const saldo = cobrado - gastoComprasNeto - gastoMaterialesBodega - gastoSubcontratos - manoDeObra
    // La otra mitad del mismo criterio: plata ya comprometida que todavía no salió. Sin esto
    // el saldo se lee como si fuera efectivo disponible, que es la confusión clásica entre
    // caja y margen -- una obra puede dejar plata y aun así no alcanzar para pagar el viernes.
    const subcontratosPorPagar = Math.max(gastoSubcontratos - pagadoSubcontratos, 0)
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

    // Cuánto de lo presupuestado es IVA y por lo tanto no es plata de la empresa: hay que
    // apartarlo para la cuenta de IVA. El presupuesto ya viene con IVA incluido (subtotal →
    // +GG% → neto → +19%), así que la parte de IVA es total × 19/119 -- verificado contra
    // los presupuestos reales, da exacto el mismo monto que quedó guardado en cada uno.
    // Solo se calcula si la obra está marcada como pactada con IVA.
    const conIva = maestro?.con_iva ?? false
    const ivaApartar = conIva && presupuestoTotal != null
      ? Math.round(presupuestoTotal * 19 / 119)
      : null

    // Margen de la obra. Acordado con Alexandra el 09/09 (opción "b"): Horma compra los
    // materiales -- para aprovechar el IVA, criterio de Gustavo -- y le paga al
    // subcontratista su parte, así que el margen es lo que sobra del neto DESPUÉS de todos
    // los costos, no una comisión fija.
    //
    // 11/09: los dos lados de la resta van sin IVA. La venta por `neto` (19/119 del
    // presupuesto) y los materiales por `gastoComprasNeto` / el precio de catálogo, que ya
    // es neto. Los subcontratos van completos porque ellos no facturan: no hay IVA que
    // recuperar ahí.
    //
    // El neto es el presupuesto sin IVA, con el mismo criterio que `ivaApartar` (19/119).
    // OJO: si la obra no está marcada como pactada con IVA, `ivaApartar` es null y el neto
    // queda igual al presupuesto -- el margen se ve MEJOR de lo que es. Por eso más abajo se
    // avisa cuando una obra subcontratada no tiene la marca puesta, en vez de mostrar un
    // porcentaje lindo y falso.
    const neto = presupuestoTotal != null ? presupuestoTotal - (ivaApartar ?? 0) : null
    const margen = neto != null ? neto - gastoComprasNeto - gastoMaterialesBodega - gastoSubcontratos - manoDeObra : null
    const margenPct = neto != null && neto > 0 && margen != null ? Math.round((margen / neto) * 1000) / 10 : null
    // "Subcontratada" no es una marca que alguien tenga que mantener: la obra lo es si tiene
    // un contrato de subcontratista cargado. Así no hay un flag que se pueda olvidar.
    const esSubcontratada = contratosObra.length > 0

    // Lo que quedó para Horma al cerrar el trato con el subcontratista, antes de gastar en
    // materiales. 11/09: reemplaza al "objetivo 25%", que era una constante inventada por mí.
    // Los tratos reales de Gustavo no son un porcentaje fijo -- con Gabriel fue "75% de la
    // mano de obra + 75% de los gastos operacionales, menos un ítem que el cliente cambió",
    // y no se pudo reconstruir con ninguna fórmula. Intentar modelarlo daría un número que se
    // ve preciso y está mal.
    //
    // Así que la referencia sale del monto que Gustavo escribe a mano, que es donde vive todo
    // ese criterio: neto − contrato = la bolsa que le queda a Horma. Cada peso de materiales
    // sale de ahí, y la distancia entre esa bolsa y el margen de hoy es exactamente cuánto se
    // lleva gastado. Sin reglas que mantener: si el contrato está bien escrito, el número es
    // correcto solo.
    const margenAlPactar = neto != null && esSubcontratada ? neto - gastoSubcontratos : null
    const margenAlPactarPct = margenAlPactar != null && neto && neto > 0
      ? Math.round((margenAlPactar / neto) * 1000) / 10
      : null

    return {
      obra, obraId: maestro?.id, activa, estadoObra, conIva, ivaApartar, subcontratosPorPagar,
      neto, margen, margenPct, esSubcontratada, margenAlPactar, margenAlPactarPct,
      fechaInicio: maestro?.fecha_inicio ?? null, fechaFin: maestro?.fecha_fin ?? null, garantiaHasta: maestro?.garantia_hasta ?? null,
      tieneCuentas, cliente: maestro?.cliente ?? null, presupuestoTotal, presupuestoId: maestro?.presupuesto_id ?? null, gastoCompras, gastoComprasNeto, ivaRecuperableCompras, gastoMaterialesBodega, gastoSubcontratos, pagadoSubcontratos, subcontratistas, abonosSubcontratos, manoDeObra, adelantos, pagosSemanales, porReembolsar, cobrado, cobradoManual, saldo, faltaPorCobrar,
    }
  })
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
  const [salidasStock, setSalidasStock] = useState<MovimientoStock[]>([])
  const [mostrarNuevaCuentaSuelta, setMostrarNuevaCuentaSuelta] = useState(false)
  const [nuevaCuentaSuelta, setNuevaCuentaSuelta] = useState({ pagador: '', concepto: '', total_presupuesto: '' })

  useEffect(() => {
    if (!localStorage.getItem('horma_guia_obras_vista')) {
      setMostrarGuia(true)
      localStorage.setItem('horma_guia_obras_vista', '1')
    }
  }, [])

  const cargar = useCallback(async () => {
    const [{ data: d }, { data: c }, { data: co }, { data: s }, { data: m }, { data: t }, { data: sm }, { data: cu }, { data: ab }, { data: pa }, { data: sal }] = await Promise.all([
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
      // Material entregado desde bodega: es costo de la obra que lo recibió.
      supabase.from('movimientos_stock').select('*').eq('tipo', 'salida'),
    ])
    setSalidasStock((sal as MovimientoStock[]) || [])
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

  async function guardarConIva(obraId: string, con_iva: boolean) {
    const { error } = await supabase.from('obras').update({ con_iva }).eq('id', obraId)
    if (error) {
      alert('No se pudo guardar. Puede que falte correr la migración sql/20260907_obras_con_iva.sql.')
      return
    }
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
        cliente_id: presupuesto.cliente_id,
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
      // Sin presupuesto no hay cliente_id de donde heredar -- se busca por coincidencia
      // exacta de nombre contra `clientes` (best-effort, no bloquea si no encuentra nada).
      let clienteIdExcepcion: string | null = null
      if (nuevaObra.cliente.trim()) {
        const { data: clienteMatch } = await supabase.from('clientes').select('id').ilike('nombre', nuevaObra.cliente.trim()).maybeSingle()
        clienteIdExcepcion = clienteMatch?.id || null
      }
      const { error } = await supabase.from('obras').insert({
        nombre: nuevaObra.nombre.trim(),
        cliente: nuevaObra.cliente.trim() || null,
        cliente_id: clienteIdExcepcion,
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
    // Best-effort, igual criterio que la obra por excepción: si el nombre calza exacto
    // con un cliente ya existente, se linkea; si no, la cuenta se sigue creando igual.
    const { data: clienteMatch } = await supabase.from('clientes').select('id').ilike('nombre', pagador).maybeSingle()
    const { error } = await supabase.from('cuentas_por_cobrar').insert({ pagador, cliente_id: clienteMatch?.id || null, concepto, obra, total_presupuesto: total })
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

  const resumen = calcularResumenObras(obrasMaestro, diarios, compras, cobros, subcontratos, cuentas, abonos, subcontratosMaster, trabajadoresTarifas, salidasStock)

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
                      {/* `minWidth` para que en el telefono los botones bajen enteros a la
                          linea de abajo en vez de estrangular el titulo: "Pasaje rinconada
                          8948, Vitacura" se partia en tres lineas y el nombre de la obra es
                          lo primero que hay que leer. */}
                      <p className="font-serif" style={{ fontSize: 21, flex: 1, minWidth: 200, color: 'var(--secondary)' }}>{o.obra}</p>
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
                    {/* Las fechas se pliegan: son tres campos administrativos que casi nunca
                        se tocan y en el telefono empujaban todos los numeros abajo del
                        pliegue, que es donde Gustavo mira la obra (Alexandra, 11/09).
                        Cerradas muestran lo que hay cargado, que suele ser toda la
                        pregunta. */}
                    {o.obraId && (
                      <details style={{ marginBottom: 12 }}>
                        <summary style={{ fontSize: 12, color: 'var(--muted)', cursor: 'pointer', listStyle: 'revert' }}>
                          {o.fechaInicio || o.fechaFin || o.garantiaHasta
                            ? [
                                o.fechaInicio ? `Inicio ${o.fechaInicio.split('-').reverse().join('/')}` : null,
                                o.fechaFin ? `fin ${o.fechaFin.split('-').reverse().join('/')}` : null,
                                o.garantiaHasta ? `garantía hasta ${o.garantiaHasta.split('-').reverse().join('/')}` : null,
                              ].filter(Boolean).join(' · ')
                            : 'Sin fechas cargadas'}
                        </summary>
                      <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginTop: 8, fontSize: 12 }}>
                        <label style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--muted)' }}>
                          Inicio
                          <input type="date" value={o.fechaInicio || ''} onChange={e => guardarFechaObra(o.obraId as string, 'fecha_inicio', e.target.value)} style={{ fontSize: 12, padding: '3px 6px', width: 'auto' }} />
                          {o.fechaInicio && (
                            <button type="button" onClick={() => guardarFechaObra(o.obraId as string, 'fecha_inicio', '')} title="Borrar fecha" style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--danger)', fontSize: 13, padding: 0 }}>✕</button>
                          )}
                        </label>
                        <label style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--muted)' }}>
                          Fin
                          <input type="date" value={o.fechaFin || ''} onChange={e => guardarFechaObra(o.obraId as string, 'fecha_fin', e.target.value)} style={{ fontSize: 12, padding: '3px 6px', width: 'auto' }} />
                          {o.fechaFin && (
                            <button type="button" onClick={() => guardarFechaObra(o.obraId as string, 'fecha_fin', '')} title="Borrar fecha" style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--danger)', fontSize: 13, padding: 0 }}>✕</button>
                          )}
                        </label>
                        <label style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--muted)' }}>
                          Garantía hasta
                          <input type="date" value={o.garantiaHasta || ''} onChange={e => guardarFechaObra(o.obraId as string, 'garantia_hasta', e.target.value)} style={{ fontSize: 12, padding: '3px 6px', width: 'auto' }} />
                          {o.garantiaHasta && (
                            <button type="button" onClick={() => guardarFechaObra(o.obraId as string, 'garantia_hasta', '')} title="Borrar fecha" style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--danger)', fontSize: 13, padding: 0 }}>✕</button>
                          )}
                        </label>
                      </div>
                      </details>
                    )}
                    {/* Tres bloques con sentido propio, en vez de una tira de tarjetas que se
                        acomodan solas según el ancho (Alexandra, 11/09): lo que entra, lo que
                        cuesta, y lo que queda. Así la misma tarjeta cae siempre en el mismo
                        lugar y se puede leer de memoria. */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 12 }}>
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(128px, 1fr))', gap: 8 }}>
                        {/* El IVA a apartar vive acá adentro y no en su propia tarjeta: es una
                            parte de este mismo número, no un dato suelto. */}
                        <StatTile
                          label="Presupuesto"
                          valor={o.presupuestoTotal != null ? fmtMoney(o.presupuestoTotal) : 'sin definir'}
                          nota={o.ivaApartar != null ? `IVA ${fmtMoney(o.ivaApartar)}` : undefined}
                          compacta
                        />
                        <StatTile label="Abonado" valor={fmtMoney(o.cobrado)} tono="positivo" />
                        <StatTile
                          label="Por abonar"
                          valor={o.faltaPorCobrar != null ? fmtMoney(o.faltaPorCobrar) : 'sin presupuesto'}
                          tono={o.faltaPorCobrar == null ? 'neutral' : o.faltaPorCobrar > 0 ? 'alerta' : 'positivo'}
                        />
                      </div>

                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(128px, 1fr))', gap: 8 }}>
                        <StatTile label="Mano de obra" valor={fmtMoney(o.manoDeObra)} />
                        {/* Arriba lo que salió del banco, abajo lo que costó de verdad. Sin
                            los dos números, cuadrar la caja contra el margen obliga a hacer
                            la cuenta a mano y nadie sabe cuál de los dos está mirando. */}
                        <StatTile
                          label="Compras"
                          valor={fmtMoney(o.gastoCompras)}
                          nota={o.gastoCompras > 0 ? `Sin IVA ${fmtMoney(o.gastoComprasNeto)}` : undefined}
                          compacta
                        />
                        {o.gastoMaterialesBodega > 0 && (
                          <StatTile label="Materiales de bodega" valor={fmtMoney(o.gastoMaterialesBodega)} nota="sin IVA" compacta />
                        )}
                        <StatTile label="Subcontratos" valor={fmtMoney(o.gastoSubcontratos)} />
                      </div>

                      {/* Pedido de Gustavo (11/09): se veía lo contratado y lo que falta, pero
                          no cuánto se le lleva abonado, que es lo que él necesita saber antes
                          de hacer la próxima transferencia. */}
                      {(o.pagadoSubcontratos > 0 || o.subcontratosPorPagar > 0) && (
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(128px, 1fr))', gap: 8 }}>
                          {o.pagadoSubcontratos > 0 && (
                            <StatTile label="Abonado a subcontratistas" valor={fmtMoney(o.pagadoSubcontratos)} tono="positivo" compacta />
                          )}
                          {o.subcontratosPorPagar > 0 && (
                            <StatTile label="Falta pagarle al subcontratista" valor={fmtMoney(o.subcontratosPorPagar)} tono="alerta" compacta />
                          )}
                        </div>
                      )}

                    </div>

                    {/* El resultado, en una línea sola y grande. Antes eran tres tarjetas con
                        párrafos adentro y en el teléfono quedaba ilegible -- Alexandra, 11/09:
                        "no se ve pro ni premium... esa información debería vivir entonces en
                        el detalle de la obra, no allí". Acá queda el número que importa, y la
                        cuenta completa con sus explicaciones se lee en el detalle. */}
                    {o.margen != null && (
                      <button
                        onClick={() => setHistorialObra(o.obra)}
                        style={{
                          width: '100%', background: 'none', border: 'none', borderTop: '1px solid var(--border)',
                          padding: '12px 0 4px', marginBottom: 8, cursor: 'pointer', textAlign: 'left', color: 'var(--text)',
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
                          <span className="font-display" style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.6px' }}>
                            Ganancia proyectada
                          </span>
                          <span className="font-display" style={{ fontSize: 24, fontWeight: 800, color: o.margen < 0 ? 'var(--danger)' : 'var(--success)', fontVariantNumeric: 'tabular-nums', lineHeight: 1 }}>
                            {fmtMoney(o.margen)}
                          </span>
                          {o.margenPct != null && (
                            <span style={{ fontSize: 13, color: 'var(--muted)', fontVariantNumeric: 'tabular-nums' }}>{o.margenPct}%</span>
                          )}
                          <span style={{ marginLeft: 'auto', fontSize: 12, fontWeight: 600, color: 'var(--primary)' }}>
                            Ver cómo se calcula →
                          </span>
                        </div>
                        {/* La aclaración es el punto, no un adorno: "Te queda hoy" se leía como plata
                            en la mano y no lo es -- Alexandra, 11/09: "eso asume que ya me pagaron
                            todo y no es así". Es lo que la obra va a dejar SI el cliente paga todo y
                            no se gasta más, y al lado va lo que de verdad entró. */}
                        <p style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 5, lineHeight: 1.45 }}>
                          Todavía no es plata tuya: es lo que dejaría la obra si el cliente paga todo y no se
                          gasta más.
                          {o.presupuestoTotal != null && <> Hasta ahora abonó {fmtMoney(o.cobrado)} de {fmtMoney(o.presupuestoTotal)}.</>}
                        </p>
                      </button>
                    )}
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
                          <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', width: 'fit-content' }}>
                            <input
                              type="checkbox"
                              checked={o.conIva}
                              onChange={e => guardarConIva(o.obraId as string, e.target.checked)}
                              style={{ width: 16, height: 16, accentColor: 'var(--primary)', cursor: 'pointer' }}
                            />
                            <span>
                              El precio de esta obra incluye IVA
                              <span style={{ color: 'var(--muted)', fontSize: 12 }}> — muestra cuánto hay que apartar para la cuenta de IVA</span>
                            </span>
                          </label>
                          {/* Sin esta marca el neto queda igual al presupuesto y el margen se
                              ve mejor de lo que es -- en una obra subcontratada, que es donde
                              el margen se mira de verdad, eso lleva a cobrar de menos. */}
                          {o.esSubcontratada && !o.conIva && (
                            <p style={{ fontSize: 12, color: 'var(--primary)', fontWeight: 600, lineHeight: 1.45 }}>
                              Esta obra está subcontratada y no está marcada como “incluye IVA”, así que el margen
                              de arriba se calcula sobre el precio completo y sale más alto de lo real. Marca la
                              casilla si el precio pactado lleva IVA.
                            </p>
                          )}
                          {!o.presupuestoId && (
                            <CargarPresupuestoObra obra={{ id: o.obraId as string, nombre: o.obra, cliente: o.cliente }} onGuardado={cargar} />
                          )}
                        </>
                      ) : (
                        <span style={{ color: 'var(--muted)' }}>Sin registro en la tabla de obras</span>
                      )}
                      {o.cobradoManual > 0 && (
                        <span>
                          De lo abonado, <strong style={{ color: 'var(--success)' }}>{fmtMoney(o.cobradoManual)}</strong> viene de la cuenta por cobrar manual (no del Reporte Diario).
                        </span>
                      )}
                      {o.gastoSubcontratos !== o.pagadoSubcontratos && (
                        <span>
                          Subcontratos: contrato completo {fmtMoney(o.gastoSubcontratos)}, pagado hasta ahora <strong style={{ color: 'var(--warning)' }}>{fmtMoney(o.pagadoSubcontratos)}</strong>
                          {/* Cada abono acá mismo: "pagado $300.000" no dice si fue una
                              transferencia o tres, y eso es lo que hay que saber antes de
                              hacer la próxima (Alexandra, 11/09). */}
                          {o.abonosSubcontratos.length > 0 && (
                            <span style={{ color: 'var(--muted)', fontSize: 12 }}>
                              {' — '}
                              {o.abonosSubcontratos.map(a => `${a.fecha.split('-').reverse().slice(0, 2).join('/')} ${fmtMoney(a.monto)}${a.subcontrato ? ` a ${a.subcontrato}` : ''}`).join(' · ')}
                            </span>
                          )}
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
          resumen={resumen.find(o => o.obra === historialObra)}
          presupuestoId={obrasMaestro.find(o => o.nombre === historialObra)?.presupuesto_id ?? null}
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
          onCambioSubcontratos={cargar}
        />
      )}
    </>
  )
}

/* ─── Avance de obra — cantidad parcial por ítem + agenda por fase (carta Gantt) ──── */
// Un ítem puede crecer después de presupuestado ("se colocaron cuatro, se agregaron dos
// más"). `cantidad` es la línea base y nunca se edita; los adicionales viven aparte. Estas
// dos funciones son la única forma de leer "cuánto hay que hacer" y "cuánto vale", para que
// ninguna pantalla se quede mirando la cantidad vieja.
function cantidadAEjecutar(item: ObraItem): number {
  return item.cantidad + (item.cantidad_adicional || 0)
}
function totalConAdicionales(item: ObraItem): number {
  return item.total + (item.cantidad_adicional || 0) * item.precio_unitario
}

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
                const hechoFase = itemsFase.reduce((s, it) => { const aEj = cantidadAEjecutar(it); return s + (aEj > 0 ? (it.cantidad_completada / aEj) * totalConAdicionales(it) : 0) }, 0)
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

function ItemAvanceRow({ item, fases, onCantidad, onFase, onCategoria, onBorrar, onAdicional, mostrarPrecio = true }: {
  item: ObraItem
  fases?: ObraFase[]
  onCantidad: (cantidad: number) => void
  onFase?: (fase: string | null) => void
  // Solo el panel de gestión: en el de campo el trabajador no reclasifica ítems.
  onCategoria?: (categoria: string | null) => void
  onBorrar?: () => void
  // Solo lo pasa el panel de gestión: en el de campo el trabajador marca avance, no cambia
  // lo que hay que hacer.
  onAdicional?: (cantidadAdicional: number) => void
  mostrarPrecio?: boolean
}) {
  const [valor, setValor] = useState(String(item.cantidad_completada))
  useEffect(() => { setValor(String(item.cantidad_completada)) }, [item.cantidad_completada])
  const [editandoAdicional, setEditandoAdicional] = useState(false)
  const [valorAdicional, setValorAdicional] = useState(String(item.cantidad_adicional || 0))
  useEffect(() => { setValorAdicional(String(item.cantidad_adicional || 0)) }, [item.cantidad_adicional])

  const aEjecutar = cantidadAEjecutar(item)
  const adicional = item.cantidad_adicional || 0
  const pct = aEjecutar > 0 ? Math.min(100, Math.round((item.cantidad_completada / aEjecutar) * 100)) : 0
  const completo = item.cantidad_completada >= aEjecutar
  const colorPct = completo ? 'var(--success)' : 'var(--primary)'
  // Con una sola unidad a ejecutar (el caso más común: "instalar el tablero", no "50 metros
  // de cable") un checkbox es más claro que escribir un número -- mismo guardado.
  const esBinario = aEjecutar === 1

  function guardar() {
    const n = Number(valor)
    if (!Number.isFinite(n) || n < 0) { setValor(String(item.cantidad_completada)); return }
    onCantidad(Math.min(n, aEjecutar))
  }

  function guardarAdicional() {
    const n = Number(valorAdicional)
    if (!Number.isFinite(n) || n < 0) { setValorAdicional(String(adicional)); setEditandoAdicional(false); return }
    setEditandoAdicional(false)
    if (n !== adicional) onAdicional?.(n)
  }

  return (
    <div style={{ padding: '9px 10px', background: 'var(--surface-alt)', borderRadius: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: esBinario ? 0 : 6 }}>
        {esBinario && (
          <input
            type="checkbox"
            checked={completo}
            onChange={e => onCantidad(e.target.checked ? aEjecutar : 0)}
            style={{ width: 18, height: 18, flexShrink: 0, accentColor: 'var(--primary)', cursor: 'pointer' }}
          />
        )}
        <span style={{ flex: 1, fontSize: 13, textDecoration: completo ? 'line-through' : 'none', color: completo ? 'var(--muted)' : 'var(--text)' }}>
          {item.descripcion}
          {adicional > 0 && (
            <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--primary)' }}> · +{adicional} adicional{adicional !== 1 ? 'es' : ''}</span>
          )}
        </span>
        {mostrarPrecio && (
          <span style={{ fontSize: 12, color: 'var(--muted)', fontVariantNumeric: 'tabular-nums', flexShrink: 0 }}>{fmtMoney(totalConAdicionales(item))}</span>
        )}
      </div>
      {!esBinario && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <input
            type="number" min={0} max={aEjecutar} step="any"
            value={valor}
            onChange={e => setValor(e.target.value)}
            onBlur={guardar}
            style={{ width: 56, padding: '4px 6px', fontSize: 12.5, textAlign: 'right' }}
          />
          <span style={{ fontSize: 11.5, color: 'var(--muted)', flexShrink: 0 }} title={adicional > 0 ? `${item.cantidad} presupuestados + ${adicional} adicionales` : undefined}>
            / {aEjecutar}
          </span>
          <div style={{ flex: 1, height: 5, background: 'var(--border)', borderRadius: 3, overflow: 'hidden' }}>
            <div style={{ height: '100%', width: `${pct}%`, background: colorPct, transition: 'width 0.2s' }} />
          </div>
          <span className="font-display" style={{ fontSize: 11, fontWeight: 700, color: colorPct, width: 30, textAlign: 'right', flexShrink: 0 }}>{pct}%</span>
          {!completo && (
            <button
              onClick={() => onCantidad(aEjecutar)}
              style={{ fontSize: 11, fontWeight: 700, color: 'var(--primary)', background: 'none', border: 'none', cursor: 'pointer', padding: 0, flexShrink: 0 }}
            >
              Listo
            </button>
          )}
        </div>
      )}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 6, flexWrap: 'wrap' }}>
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
        {/* La categoría es lo que separa el avance del trabajo de la compra de materiales.
            Los presupuestos que entraron como PDF externo vienen sin ella, y hasta que se
            cargue el porcentaje de esa obra mezcla las dos cosas. */}
        {onCategoria && (
          <select
            value={(item.categoria || '').trim().toUpperCase() === 'MATERIALES' ? 'MATERIALES' : (item.categoria || '').trim() ? 'MANO DE OBRA' : ''}
            onChange={e => onCategoria(e.target.value || null)}
            style={{ fontSize: 11.5, padding: '3px 6px', width: 'auto', color: item.categoria ? 'var(--text)' : 'var(--primary)' }}
            title="Los materiales no cuentan para el avance del trabajo"
          >
            <option value="">Sin categoría</option>
            <option value="MANO DE OBRA">Mano de obra</option>
            <option value="MATERIALES">Materiales</option>
          </select>
        )}
        {/* "Se colocaron cuatro, se agregaron dos más": acá se carga ese 2. Lo presupuestado
            (item.cantidad) no se toca nunca. */}
        {onAdicional && (
          editandoAdicional ? (
            <span style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11.5 }}>
              <span style={{ color: 'var(--muted)' }}>{item.cantidad} presupuestados +</span>
              <input
                type="number" min={0} step="any" autoFocus
                value={valorAdicional}
                onChange={e => setValorAdicional(e.target.value)}
                onBlur={guardarAdicional}
                onKeyDown={e => { if (e.key === 'Enter') guardarAdicional() }}
                style={{ width: 52, padding: '3px 5px', fontSize: 11.5, textAlign: 'right' }}
              />
              <span style={{ color: 'var(--muted)' }}>adicionales</span>
            </span>
          ) : (
            <button
              onClick={() => setEditandoAdicional(true)}
              style={{ fontSize: 11, fontWeight: 700, color: adicional > 0 ? 'var(--primary)' : 'var(--muted)', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
              title="Se hicieron más unidades de las presupuestadas"
            >
              {adicional > 0 ? `Adicionales: ${adicional}` : '+ Se hicieron más'}
            </button>
          )
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

  const faseCompleta = itemsFase.every(it => it.cantidad_completada >= cantidadAEjecutar(it))
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
  // Adicionales ya sumados a esta obra. Se necesitan acá porque suben el presupuesto de la
  // obra pero sus ítems son una carga aparte: entre una cosa y la otra, los ítems y el
  // presupuesto no cuadran y el aviso de abajo tiene que decir POR QUÉ.
  const [adicionales, setAdicionales] = useState<PresupuestoGuardado[]>([])
  const [trayendoAdicional, setTrayendoAdicional] = useState<string | null>(null)

  const cargar = useCallback(async () => {
    const [{ data: it }, { data: fa }, { data: reg }, adic] = await Promise.all([
      supabase.from('obra_items').select('*').eq('obra_id', obraId).order('orden'),
      supabase.from('obra_fases').select('*').eq('obra_id', obraId).order('orden'),
      // Tabla nueva (obra_avance_registros) -- si todavía no se corrió la migración, esto
      // vuelve con error y `reg` queda undefined/null: se degrada a [] sin romper el resto
      // de la pantalla (la Agenda y las fases se siguen viendo, solo sin badges de atraso).
      supabase.from('obra_avance_registros').select('*').eq('obra_id', obraId).order('fecha'),
      presupuestoId
        ? supabase.from('presupuestos').select('*').eq('origen_id', presupuestoId).eq('estado', 'convertido')
        : Promise.resolve({ data: [], error: null }),
    ])
    setItems((it as ObraItem[]) || [])
    setFases((fa as ObraFase[]) || [])
    setRegistros((reg as ObraAvanceRegistro[]) || [])
    setAdicionales(adic.error ? [] : ((adic.data as unknown as PresupuestoGuardado[]) || []))
    setLoading(false)
  }, [obraId, presupuestoId])

  function faseDeAdicional(a: PresupuestoGuardado) { return `Adicional ${a.referencia || ''}`.trim() }

  async function traerItemsDeAdicional(a: PresupuestoGuardado) {
    setTrayendoAdicional(a.id)
    try {
      const { data: det } = await supabase.from('presupuestos').select('tipo, items, etapas').eq('id', a.id).single()
      if (!det) { alert('No se pudo leer el adicional. Intenta de nuevo.'); return }
      const ordenDesde = items.reduce((m, x) => Math.max(m, x.orden), -1) + 1
      await copiarItemsAObra(
        obraId,
        det as { tipo: string; items: PresupuestoItemSimple[] | null; etapas: PresupuestoEtapa[] | null },
        { fase: faseDeAdicional(a), ordenDesde },
      )
      await cargar()
    } finally {
      setTrayendoAdicional(null)
    }
  }

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

  // Cuántas unidades se agregaron después de presupuestar. `cantidad` no se toca: se guarda
  // aparte para que siempre se pueda ver "4 presupuestados + 2 adicionales".
  async function actualizarAdicional(item: ObraItem, cantidadAdicional: number) {
    setItems(prev => prev.map(x => x.id === item.id ? { ...x, cantidad_adicional: cantidadAdicional } : x))
    const { error } = await supabase.from('obra_items').update({ cantidad_adicional: cantidadAdicional }).eq('id', item.id)
    if (error) {
      alert('No se pudo guardar. Puede que falte correr la migración sql/20260908_obra_items_cantidad_adicional.sql.')
      cargar()
    }
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

  // Reclasificar un ítem entre mano de obra y materiales. Es lo que decide si cuenta para el
  // avance del trabajo, así que se puede corregir en las obras que entraron sin categoría.
  async function actualizarCategoriaItem(item: ObraItem, categoria: string | null) {
    setItems(prev => prev.map(x => x.id === item.id ? { ...x, categoria } : x))
    const { error } = await supabase.from('obra_items').update({ categoria }).eq('id', item.id)
    if (error) { alert('No se pudo actualizar la categoría. Intenta de nuevo.'); cargar() }
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

  // El avance mide TRABAJO, no compras. Alexandra, 09/09: si los materiales cuentan, comprar
  // el tablero mueve la barra sin que nadie haya trabajado -- en la obra de Alexis los
  // materiales son el 39,4% ($970.000 de $2.460.000), así que la barra podía marcar 39% con
  // cero obra ejecutada, y dejaba de responder "cuánto falta por hacer".
  // Los materiales se siguen tildando (Gustavo quiere saber que el tablero ya está en obra)
  // pero van en su propia línea, sin entrar en el porcentaje.
  const esMaterial = (it: ObraItem) => (it.categoria || '').trim().toUpperCase() === 'MATERIALES'
  // Los presupuestos que entraron como PDF externo guardan la categoría vacía (66 de 66
  // ítems en O'Higgins, Camino turístico y Geronimo de Alderete). Ahí no hay con qué
  // separar: se sigue midiendo como antes y se avisa, en vez de inventar una división.
  const hayCategorias = items.some(it => (it.categoria || '').trim() !== '')
  const itemsTrabajo = hayCategorias ? items.filter(it => !esMaterial(it)) : items
  const itemsMaterial = hayCategorias ? items.filter(esMaterial) : []
  const sumaTotal = (lista: ObraItem[]) => lista.reduce((s, it) => s + totalConAdicionales(it), 0)
  const sumaHecho = (lista: ObraItem[]) => lista.reduce((s, it) => {
    const aEj = cantidadAEjecutar(it)
    return s + (aEj > 0 ? (it.cantidad_completada / aEj) * totalConAdicionales(it) : 0)
  }, 0)

  const totalMonto = sumaTotal(itemsTrabajo)
  const montoCompletado = sumaHecho(itemsTrabajo)
  const pct = totalMonto > 0 ? Math.round((montoCompletado / totalMonto) * 100) : 0
  const colorPct = pct >= 100 ? 'var(--success)' : 'var(--primary)'
  const totalMaterial = sumaTotal(itemsMaterial)
  const materialEntregado = sumaHecho(itemsMaterial)
  const pctMaterial = totalMaterial > 0 ? Math.round((materialEntregado / totalMaterial) * 100) : 0

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
            <span style={{ fontSize: 13, fontWeight: 700 }}>
              {hayCategorias ? 'Avance del trabajo' : 'Avance'}
            </span>
            <span className="font-display" style={{ fontSize: 15, fontWeight: 800, color: colorPct }}>{pct}%</span>
          </div>
          <div style={{ height: 8, background: 'var(--border)', borderRadius: 4, overflow: 'hidden' }}>
            <div style={{ height: '100%', width: `${pct}%`, background: colorPct, transition: 'width 0.2s' }} />
          </div>
          <p style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>
            {fmtMoney(montoCompletado)} de {fmtMoney(totalMonto)} completado
            {hayCategorias && ' — solo mano de obra, los materiales van aparte'}
          </p>

          {totalMaterial > 0 && (
            <div style={{ marginTop: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6 }}>
                <span style={{ fontSize: 13, fontWeight: 700 }}>Materiales en obra</span>
                <span className="font-display" style={{ fontSize: 15, fontWeight: 800, color: 'var(--muted)' }}>{pctMaterial}%</span>
              </div>
              <div style={{ height: 6, background: 'var(--border)', borderRadius: 4, overflow: 'hidden' }}>
                <div style={{ height: '100%', width: `${pctMaterial}%`, background: 'var(--muted)', transition: 'width 0.2s' }} />
              </div>
              <p style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>
                {fmtMoney(materialEntregado)} de {fmtMoney(totalMaterial)} — lo que ya está en la obra. No cuenta como avance del trabajo.
              </p>
            </div>
          )}

          {/* Avance por adicional. Pedido de Gustavo: "de los adicionales se te van tachando,
              pero debería aparecer... el avance del presupuesto adicional". La barra de
              arriba mezcla original y adicionales en un solo porcentaje, así que un adicional
              recién empezado se esconde detrás de un original casi terminado -- y es
              justamente el que hay que cobrar aparte. Los ítems ya vienen agrupados por fase
              ("Adicional HRM-..."), o sea que el dato existía; faltaba mostrarlo. */}
          {(() => {
            const fasesAdicional = Array.from(new Set(
              itemsTrabajo.map(it => it.fase || '').filter(f => f.startsWith('Adicional ')),
            ))
            if (fasesAdicional.length === 0) return null
            const itemsOriginal = itemsTrabajo.filter(it => !(it.fase || '').startsWith('Adicional '))
            const grupos = [
              ...(itemsOriginal.length > 0 ? [{ nombre: 'Presupuesto original', items: itemsOriginal }] : []),
              ...fasesAdicional.map(f => ({ nombre: f, items: itemsTrabajo.filter(it => (it.fase || '') === f) })),
            ]
            return (
              <div style={{ marginTop: 14, paddingTop: 12, borderTop: '1px solid var(--border)' }}>
                <p style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 8 }}>
                  Avance por presupuesto
                </p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {grupos.map(g => {
                    const total = sumaTotal(g.items)
                    const hecho = sumaHecho(g.items)
                    const pctG = total > 0 ? Math.round((hecho / total) * 100) : 0
                    return (
                      <div key={g.nombre}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 4, gap: 10 }}>
                          <span style={{ fontSize: 12.5, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{g.nombre}</span>
                          <span className="font-display" style={{ fontSize: 13, fontWeight: 800, color: pctG >= 100 ? 'var(--success)' : 'var(--text)', flexShrink: 0 }}>{pctG}%</span>
                        </div>
                        <div style={{ height: 6, background: 'var(--border)', borderRadius: 4, overflow: 'hidden' }}>
                          <div style={{ height: '100%', width: `${pctG}%`, background: pctG >= 100 ? 'var(--success)' : 'var(--primary)', transition: 'width 0.2s' }} />
                        </div>
                        <p style={{ fontSize: 11, color: 'var(--muted)', marginTop: 3 }}>
                          {fmtMoney(hecho)} de {fmtMoney(total)}
                        </p>
                      </div>
                    )
                  })}
                </div>
              </div>
            )
          })()}

          {!hayCategorias && (
            <p style={{ fontSize: 11.5, color: 'var(--primary)', fontWeight: 600, marginTop: 8, lineHeight: 1.45 }}>
              En esta obra los ítems no tienen categoría (el presupuesto entró como PDF externo), así que este
              porcentaje mezcla trabajo y materiales — comprar material lo hace subir. Ponle categoría a cada
              ítem abajo y el avance pasa a medir solo el trabajo.
            </p>
          )}
        </div>
      )}

      {/* Si los ítems no suman lo mismo que el presupuesto de la obra: primero se descarta
          que la diferencia sea gastos generales + IVA (matemática normal, no falta nada) --
          solo si NO cuadra con eso se avisa como posible ítem sin desglosar. Pasa seguido
          con presupuestos externos, donde la IA lee bien el total pero el desglose que
          encuentra es el neto de materiales/mano de obra, sin el margen ni el impuesto. */}
      {presupuestoTotal != null && items.length > 0 && Math.abs(presupuestoTotal - totalMonto) > 1000 && (() => {
        // 09/09: un adicional sumado sube el presupuesto de la obra al instante, pero sus
        // ítems son una carga aparte. En esa ventana el cartel de abajo acusaba un "ítem sin
        // desglosar" por la diferencia entera -- que en la obra de Alexis eran $1.302.140:
        // los gastos generales del original, su IVA, y el adicional completo. Y encima
        // ofrecía inventar un ítem por ese monto, que habría metido el adicional dos veces y
        // un montón de impuesto como si fuera trabajo por ejecutar. Ahora se detecta primero
        // esa causa concreta y se manda al botón correcto.
        //
        // `subtotal` del adicional es la suma de sus líneas antes de GG e IVA, que es
        // exactamente con lo que se lo compara acá (obra_items guarda las líneas, sin GG ni
        // IVA). Verificado: 1.918.000 + 542.000 = 2.460.000, +10% GG +19% IVA = 3.220.140.
        const pendientes = adicionales.filter(a => !items.some(it => (it.fase || '') === faseDeAdicional(a)))
        if (pendientes.length > 0) {
          const faltante = pendientes.reduce((s, a) => s + (a.subtotal || 0), 0)
          const ggIvaCon = detectarGGeIVA(totalMonto + faltante, presupuestoTotal)
          return (
            <div style={{ marginBottom: 16, padding: 12, background: '#fef2e0', border: '1px solid #e8a33d', borderRadius: 8 }}>
              <p style={{ fontSize: 12.5, fontWeight: 700, color: '#7a5210', marginBottom: 4 }}>
                Faltan los ítems de {pendientes.length === 1 ? 'un adicional' : `${pendientes.length} adicionales`} que ya se {pendientes.length === 1 ? 'sumó' : 'sumaron'} a la obra
              </p>
              <p style={{ fontSize: 12, color: '#7a5210', marginBottom: 8, lineHeight: 1.5 }}>
                No falta desglosar nada: el presupuesto de la obra ya subió con{' '}
                {pendientes.map(a => a.referencia || 'el adicional').join(', ')}, pero sus líneas de trabajo
                todavía no están acá, así que no hay dónde marcarlas como hechas.
                {ggIvaCon && (
                  <> Al traerlas, los ítems pasan a {fmtMoney(totalMonto + faltante)} y con gastos generales
                    ({ggIvaCon.pct}%) más IVA dan {fmtMoney(presupuestoTotal)} — el presupuesto exacto de la obra.</>
                )}
              </p>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {pendientes.map(a => (
                  <button
                    key={a.id}
                    onClick={() => traerItemsDeAdicional(a)}
                    disabled={trayendoAdicional === a.id}
                    style={{ fontSize: 12, fontWeight: 700, color: '#7a5210', background: 'none', border: '1px solid #e8a33d', borderRadius: 6, padding: '5px 10px', cursor: 'pointer' }}
                  >
                    {trayendoAdicional === a.id ? 'Trayendo...' : `Traer los ítems de ${a.referencia || 'el adicional'}`}
                  </button>
                ))}
              </div>
            </div>
          )
        }
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
                    onCategoria={c => actualizarCategoriaItem(it, c)}
                    onBorrar={() => borrarItem(it)}
                    onAdicional={c => actualizarAdicional(it, c)}
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
  { titulo: 'Subcontratos', texto: 'Lo CONTRATADO con subcontratistas externos, como un pintor, que no son parte del equipo fijo — el total comprometido, aunque todavía no se les haya pagado todo.' },
  { titulo: 'Abonado a subcontratistas', texto: 'Cuánto se le lleva pagado al subcontratista de esta obra, sumando los abonos cargados en el Reporte Diario. Es lo que ya salió de la cuenta, no lo que se le debe — para eso está "Falta pagar".' },
  { titulo: 'Falta pagarle al subcontratista', texto: 'De los subcontratos ya contratados, cuánto todavía no salió de la cuenta. Es plata que ya se debe: el saldo la descuenta como costo, pero el dinero sigue estando. Aparece solo si queda algo por pagar.' },
  { titulo: 'Abonado', texto: 'Lo que el cliente ya pagó por esta obra hasta ahora — puede venir del Reporte Diario o de una cuenta por cobrar manual. No es lo facturado: una factura es un documento aparte, que se carga en la ficha del cliente.' },
  { titulo: 'Por abonar', texto: 'Cuánto le queda debiendo el cliente por esta obra. Dice "sin presupuesto" si la obra todavía no tiene un presupuesto cargado.' },
  { titulo: 'Saldo', texto: 'Lo abonado menos lo que CUESTA la obra: mano de obra, compras, materiales entregados desde bodega y subcontratos contratados. Un costo cuenta cuando se incurre, no cuando se paga, así que un sobrecosto se ve apenas se contrata y no cuando llega la factura. No es la plata que queda en la cuenta: para eso mira "Falta pagar", que es lo comprometido que todavía no salió.' },
  { titulo: 'Materiales de bodega', texto: 'Material que salió de la bodega hacia esta obra, con su vale de entrega. Aparece cuando se compró en bloque (sin decidir la obra todavía) y después se entregó: el costo se le carga a la obra recién en ese momento, no al pagar la boleta. Cada salida queda valorizada con el precio que tenía cuando salió, así una compra nueva más cara no reescribe lo que costó una obra ya cerrada.' },
  { titulo: 'IVA a apartar', texto: 'Va escrito debajo del Presupuesto: cuánto de ese total es IVA y hay que transferir a la cuenta de IVA, porque no es plata de Horma. Aparece solo en las obras marcadas como "el precio incluye IVA".' },
  { titulo: 'Te quedaba al cerrar el trato', texto: 'En las obras que ejecuta un subcontratista: el precio sin IVA menos lo pactado con él. Es la bolsa que le quedó a Horma al cerrar el trato, antes de gastar un peso en materiales. La distancia entre este número y "Ganancia proyectada" es exactamente cuánto se lleva gastado. Sale del monto que se escribe a mano al cargar el subcontrato, porque cada trato se negocia distinto y no hay fórmula que lo reproduzca.' },
  { titulo: 'Ganancia proyectada', texto: 'Lo que queda del precio sin IVA después de restar mano de obra, compras, materiales de bodega y subcontratos. NO es plata que ya tengas: da por hecho que el cliente va a pagar todo el precio y que no se va a gastar más. Para ver la plata que realmente entró, mirá el Saldo. Si mañana se compra más material, este número baja. Si la obra no está marcada como "incluye IVA", el porcentaje sale más alto de lo real y la app te lo avisa.' },
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
// Usado por PanelPagoSemanal (semana en curso, con formularios para cargar) y por el
// historial dentro de la ficha de cada trabajador en PanelTrabajadores (períodos
// pasados, solo lectura) -- una sola fuente de verdad para que "cuánto se le debe a
// alguien esta semana" nunca se calcule distinto en los dos lugares donde se muestra.
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

  // Se compara contra el neto que corresponde HOY (`montoCalculado`), no contra
  // `comprobante.monto_calculado`, que es la foto del monto al momento de subir la captura.
  // Esa foto queda vieja apenas se carga un adelanto, se corrige un día o cambia una regla
  // después de haber subido el comprobante, y el cartel avisaba "No coincide" sobre cuentas
  // que en realidad estaban bien. `monto_calculado` se sigue guardando como historial.
  const coincide = comprobante?.monto_leido != null
    ? Math.round(comprobante.monto_leido) === Math.round(montoCalculado)
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
            ⚠ No coincide: comprobante {fmtMoney(comprobante.monto_leido!)} · calculado {fmtMoney(montoCalculado)}
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
// cargar); el historial dentro de PanelTrabajadores solo muestra el detalle ya
// cargado, sin formularios (ahí sí se puede borrar un ajuste/adelanto mal cargado).
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

  async function borrarAjuste(id: string, motivo: string) {
    if (!window.confirm(`¿Borrar el ajuste "${motivo}"? No se puede deshacer.`)) return
    const { error } = await supabase.from('ajustes_pago_semanal').delete().eq('id', id)
    if (error) { alert('No se pudo borrar el ajuste: ' + error.message); return }
    onGuardado()
  }

  async function borrarAdelanto(id: string, monto: number) {
    if (!window.confirm(`¿Borrar el adelanto de ${fmtMoney(monto)}? No se puede deshacer.`)) return
    const { error } = await supabase.from('adelantos_trabajador').delete().eq('id', id)
    if (error) { alert('No se pudo borrar el adelanto: ' + error.message); return }
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

    // Aviso de posible duplicado -- mismo criterio que ya existe para compras/cobros en
    // Reporte Diario. Acá hace falta más que ahí: como esta fecha puede ser de cualquier
    // semana (no solo la que se está viendo), un adelanto ya cargado para ese trabajador
    // ese mismo día no aparece en ningún lado de esta pantalla -- se detectó así un
    // duplicado real (mismo comprobante subido dos veces) el 31/08/2026.
    const { data: existentes } = await supabase
      .from('adelantos_trabajador')
      .select('id, monto, nota')
      .eq('trabajador', fila.trabajador)
      .eq('fecha', fechaAdelanto)
    if (existentes && existentes.length > 0) {
      const detalle = existentes.map(e => `${fmtMoney(e.monto)}${e.nota ? ` (${e.nota})` : ''}`).join(', ')
      if (!window.confirm(`${fila.trabajador} ya tiene un adelanto cargado el ${fechaAdelanto.split('-').reverse().join('/')}: ${detalle}. ¿Es un adelanto distinto (Aceptar) o es el mismo cargado de nuevo (Cancelar)?`)) {
        return
      }
    }

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
            <div key={a.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, padding: '3px 0' }}>
              <span style={{ color: 'var(--text)' }}>{a.motivo}</span>
              <span style={{ display: 'flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap' }}>
                <span style={{ fontWeight: 700, color: a.monto >= 0 ? 'var(--success)' : 'var(--danger)' }}>
                  {a.monto >= 0 ? '+' : ''}{fmtMoney(a.monto)}
                </span>
                <button onClick={() => borrarAjuste(a.id, a.motivo)} title="Borrar ajuste" style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--danger)', fontSize: 13, padding: 0 }}>✕</button>
              </span>
            </div>
          ))}
        </div>
      )}

      {(fila.adelantosQueRestan.length > 0 || fila.sueldoFijo) && (
        <div>
          <p style={{ fontWeight: 700, color: 'var(--muted)', marginBottom: 4 }}>Adelantos</p>
          {fila.adelantosQueRestan.map(a => (
            <div key={a.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, padding: '3px 0' }}>
              <span style={{ color: 'var(--text)' }}>
                {a.fecha.split('-').reverse().join('/')}{a.nota ? ` — ${a.nota}` : ''}
                {a.comprobante_url && <a href={a.comprobante_url} target="_blank" rel="noreferrer" style={{ marginLeft: 6, color: 'var(--primary)' }}>Ver comprobante</a>}
              </span>
              <span style={{ display: 'flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap' }}>
                <span style={{ fontWeight: 700, color: 'var(--danger)' }}>-{fmtMoney(a.monto)}</span>
                <button onClick={() => borrarAdelanto(a.id, a.monto)} title="Borrar adelanto" style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--danger)', fontSize: 13, padding: 0 }}>✕</button>
              </span>
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
                        : `${f.dias} día${f.dias !== 1 ? 's' : ''}${f.ganado ? ` · ganado ${fmtMoney(f.ganado)}` : ''}${f.viatico > 0 ? ` · viático ${fmtMoney(f.viatico)}` : ''}`}
                    </p>
                  </div>
                  <div style={{ textAlign: 'right', flexShrink: 0 }}>
                    <p className="font-display" style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--muted)', marginBottom: 2 }}>Neto</p>
                    <p className="font-display" style={{ fontSize: 20, fontWeight: 800, color: 'var(--text)', fontVariantNumeric: 'tabular-nums' }}>{fmtMoney(f.neto)}</p>
                  </div>
                </div>

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

      <ReembolsosPendientes />
    </div>
  )
}

/* ─── Lo que la empresa le debe a quien puso plata de su bolsillo ──── */
// Pedido de Gustavo (11/09): "si yo hago unas compras y yo no cargo, entonces no me van a
// transferir". Su ejemplo fue $2.100.000 con su tarjeta de crédito. El dato ya se guardaba
// (`pagado_por` + `reembolsado`) pero no había ninguna pantalla que dijera el total, así que
// para saber cuánto se le debe había que abrir obra por obra.
//
// Va acá, en Pago semanal, porque es la pantalla donde se decide qué transferir. Aparte de
// las filas de sueldo a propósito: un reembolso no es sueldo, y sumarlo al neto del
// trabajador rompería la comparación contra el comprobante que ya existe.
//
// NO se filtra por semana: una compra de hace tres semanas que nadie devolvió se sigue
// debiendo, y esconderla sería justo el problema que esto viene a resolver.
function ReembolsosPendientes() {
  const [compras, setCompras] = useState<ReporteCompraDia[]>([])
  const [cargando, setCargando] = useState(true)
  const [marcando, setMarcando] = useState<string | null>(null)

  const cargar = useCallback(async () => {
    const { data } = await supabase
      .from('reportes_compras').select('*')
      .not('pagado_por', 'is', null).neq('reembolsado', true)
      .order('fecha')
    setCompras((data as ReporteCompraDia[]) || [])
    setCargando(false)
  }, [])

  useEffect(() => { cargar() }, [cargar])

  async function marcarReembolsado(id: string) {
    setMarcando(id)
    const { error } = await supabase.from('reportes_compras').update({ reembolsado: true }).eq('id', id)
    setMarcando(null)
    if (error) { alert('No se pudo marcar como reembolsado. Intenta de nuevo.'); return }
    await cargar()
  }

  if (cargando || compras.length === 0) return null

  const porPersona = Array.from(
    compras.reduce((mapa, c) => {
      const quien = c.pagado_por as string
      mapa.set(quien, [...(mapa.get(quien) || []), c])
      return mapa
    }, new Map<string, ReporteCompraDia[]>()),
  ).sort((a, b) => a[0].localeCompare(b[0]))

  const total = compras.reduce((s, c) => s + c.monto, 0)

  return (
    <div style={{ marginTop: 26 }}>
      <h2 style={{ fontSize: 15, fontWeight: 800, marginBottom: 4, color: 'var(--text-inverse)' }}>Compras por reembolsar</h2>
      <p style={{ fontSize: 12, color: 'var(--muted-inverse)', marginBottom: 12, lineHeight: 1.45 }}>
        Compras que alguien pagó con su propia plata y la empresa todavía no le devolvió. Es plata aparte
        del sueldo, y se devuelve por el monto completo de la boleta, con IVA — es lo que la persona puso.
      </p>

      <div style={{ marginBottom: 14 }}>
        <StatTile label="Total por reembolsar" valor={fmtMoney(total)} tono="alerta" />
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {porPersona.map(([quien, suyas]) => (
          <div key={quien} className="card" style={{ padding: '16px 18px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 10, marginBottom: 10 }}>
              <span style={{ fontWeight: 700, fontSize: 15 }}>{quien}</span>
              <span className="font-display" style={{ fontSize: 18, fontWeight: 800, fontVariantNumeric: 'tabular-nums' }}>
                {fmtMoney(suyas.reduce((s, c) => s + c.monto, 0))}
              </span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {suyas.map(c => (
                <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 10, background: 'var(--surface-alt)', borderRadius: 8, padding: '8px 12px', fontSize: 13, flexWrap: 'wrap' }}>
                  <span style={{ color: 'var(--muted)', fontSize: 12, width: 78, flexShrink: 0 }}>{c.fecha.split('-').reverse().join('/')}</span>
                  <span style={{ flex: 1, minWidth: 140 }}>
                    {c.descripcion}
                    {c.obra && <span style={{ color: 'var(--muted)', fontSize: 12 }}> · {c.obra}</span>}
                  </span>
                  <span style={{ fontWeight: 700 }}>{fmtMoney(c.monto)}</span>
                  <button
                    className="btn btn-ghost"
                    onClick={() => marcarReembolsado(c.id)}
                    disabled={marcando === c.id}
                    style={{ fontSize: 11, padding: '3px 8px' }}
                  >
                    {marcando === c.id ? 'Guardando...' : 'Ya se le devolvió'}
                  </button>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

/* ─── Fila de detalle semanal, solo lectura, para el historial ──── */
function FilaSemanaHistorial({ fila, semanaKey, semanaLabel, comprobante, onSubido }: {
  fila: FilaPagoSemanal
  semanaKey: string
  semanaLabel: string
  // Opcionales -- el comprobante matchea por semana_key REAL, así que al agrupar por
  // quincena o mes (HistorialPeriodosTrabajador) no corresponde ofrecer subir uno: esa
  // clave no es una semana de verdad.
  comprobante?: PagoSemanalComprobante | null
  onSubido?: () => void
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
      {onSubido && (
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 4 }}>
          <ComprobanteCelda trabajador={fila.trabajador} semanaKey={semanaKey} montoCalculado={fila.neto} comprobante={comprobante ?? null} onSubido={onSubido} />
        </div>
      )}
      <DesgloseDiasToggle fila={fila} />
    </div>
  )
}

/* ─── Historial de pagos de un trabajador — usado dentro de PanelTrabajadores al
   entrar a la ficha de cada uno (antes vivía en una pestaña aparte, "Historial de
   pagos"; se fusionó a pedido de Alexandra para no repetir el selector de trabajador
   en dos lugares distintos). Dos variantes según el tipo de trabajador. ──── */
function PanelHistorialSueldoFijo({ trabajador, diariosTrabajador, ajustesTrabajador, adelantosTrabajador, gastosFijos, ultimoComprobante, onRecargar, onBorrarAdelanto }: {
  trabajador: Trabajador
  diariosTrabajador: ReporteTrabajadorDia[]
  ajustesTrabajador: AjustePagoSemanal[]
  adelantosTrabajador: AdelantoTrabajador[]
  gastosFijos: GastoFijo[]
  ultimoComprobante: (semanaKey: string) => PagoSemanalComprobante | null
  onRecargar: () => void
  onBorrarAdelanto: (id: string, monto: number, fecha: string) => void
}) {
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
  // El mes actual siempre se muestra, aunque todavía no tenga ningún día trabajado ni
  // adelanto cargado -- si no, no había manera de "entrar" a septiembre para cargarle
  // un adelanto antes de que exista algo ahí (reportado por Alexandra con Fabriel).
  mesesSet.add(getPeriodo(new Date().toISOString().slice(0, 10), 'mes').key)

  const meses = Array.from(mesesSet).sort((a, b) => b.localeCompare(a))

  if (meses.length === 0) {
    return <p style={{ color: 'var(--muted)', fontSize: 14 }}>Sin actividad ni adelantos registrados todavía para {trabajador.nombre}.</p>
  }

  return (
    <div>
      {meses.map(mesKey => {
        const [y, m] = mesKey.split('-').map(Number)
        const label = `${MESES[m - 1]} ${y}`
        const adelantosDelMes = adelantosTrabajador.filter(a => getPeriodo(a.fecha, 'mes').key === mesKey)
        const adelantadoMes = adelantosDelMes.reduce((s, a) => s + a.monto, 0)
        const restaPagar = sueldoMensual - adelantadoMes
        const semanasDelMes = semanas.filter(s => mesDeSemana.get(s.key) === mesKey)
        const comprobanteMes = ultimoComprobante(`mensual-${mesKey}`)
        const pagoConfirmado = comprobanteMes?.monto_leido != null && Math.round(comprobanteMes.monto_leido) === Math.round(restaPagar)

        return (
          <div key={mesKey} className="card" style={{ padding: '14px 16px', marginBottom: 14 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10, flexWrap: 'wrap' }}>
              <h3 style={{ fontSize: 15, fontWeight: 800 }}>{label}</h3>
              {pagoConfirmado && (
                <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--success)', background: '#eafaf0', border: '1px solid #b8e6c9', borderRadius: 6, padding: '3px 8px' }}>
                  ✓ Pago del mes confirmado con comprobante
                </span>
              )}
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
              <StatTile label="Sueldo del mes" valor={fmtMoney(sueldoMensual)} />
              <StatTile label="Adelantado" valor={fmtMoney(adelantadoMes)} tono={adelantadoMes > 0 ? 'alerta' : 'neutral'} />
              {/* Mismo monto que "Resta pagar" -- pero una vez que el comprobante confirma que
                  se pagó, mantener la etiqueta "Resta pagar" contradice al aviso verde de arriba
                  (Alexandra lo reportó: "si ya pagué, ¿por qué sigue diciendo resta pagar?").
                  Se relabela a "Pagado" en vez de poner $0, para no perder de vista el monto. */}
              <StatTile label={pagoConfirmado ? 'Pagado' : 'Resta pagar'} valor={fmtMoney(restaPagar)} tono={pagoConfirmado || restaPagar >= 0 ? 'positivo' : 'negativo'} />
            </div>

            {/* Comprobante del pago mensual (el sueldo/"Resta pagar" grande) -- distinto de los
                comprobantes de viático semanal más abajo. Usa una clave sintética ("mensual-...")
                en vez de una semana real, porque este pago no corresponde a ninguna semana. */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
              <p style={{ fontSize: 12, color: 'var(--muted)' }}>Comprobante del pago del mes</p>
              <ComprobanteCelda
                trabajador={trabajador.nombre}
                semanaKey={`mensual-${mesKey}`}
                montoCalculado={restaPagar}
                comprobante={ultimoComprobante(`mensual-${mesKey}`)}
                onSubido={onRecargar}
              />
            </div>

            {adelantosDelMes.length > 0 && (
              <div style={{ fontSize: 12, marginBottom: 12 }}>
                <p style={{ fontWeight: 700, color: 'var(--muted)', marginBottom: 4 }}>Adelantos del mes</p>
                {adelantosDelMes.map(a => (
                  <div key={a.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, padding: '3px 0' }}>
                    <span>{a.fecha.split('-').reverse().join('/')}{a.nota ? ` — ${a.nota}` : ''}
                      {a.comprobante_url && <a href={a.comprobante_url} target="_blank" rel="noreferrer" style={{ marginLeft: 6, color: 'var(--primary)' }}>Ver comprobante</a>}
                    </span>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap' }}>
                      <span style={{ fontWeight: 700, color: 'var(--danger)' }}>-{fmtMoney(a.monto)}</span>
                      <button onClick={() => onBorrarAdelanto(a.id, a.monto, a.fecha)} title="Borrar adelanto" style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--danger)', fontSize: 13, padding: 0 }}>✕</button>
                    </span>
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
                      comprobante={ultimoComprobante(s.key)} onSubido={onRecargar}
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

// Trabajadores con tarifa diaria: antes solo se veía semana por semana -- Alexandra pidió
// poder verlo también por quincena o mes sin cambiar de pestaña. Los ajustes se cargan por
// semana (semana_key), así que para agruparlos en un período más largo se ubica cada uno
// según a qué período pertenece el lunes de esa semana.
function HistorialPeriodosTrabajador({ vista, trabajador, diariosTrabajador, ajustesTrabajador, adelantosTrabajador, ultimoComprobante, onRecargar }: {
  vista: VistaPeriodo
  trabajador: Trabajador
  diariosTrabajador: ReporteTrabajadorDia[]
  ajustesTrabajador: AjustePagoSemanal[]
  adelantosTrabajador: AdelantoTrabajador[]
  ultimoComprobante: (semanaKey: string) => PagoSemanalComprobante | null
  onRecargar: () => void
}) {
  const periodos = agruparPorPeriodo(vista, diariosTrabajador, [], [], [])
    .map(p => {
      const ajustesPeriodo = ajustesTrabajador.filter(a => getPeriodo(semanaRango(a.semana_key).inicio, vista).key === p.key)
      const adelantosPeriodo = adelantosTrabajador.filter(a => getPeriodo(a.fecha, vista).key === p.key)
      const fila = calcularFilaPagoSemanal(trabajador, p.diarios.filter(d => d.presente), ajustesPeriodo, adelantosPeriodo)
      return { key: p.key, label: p.label, fila }
    })
    .filter(p => p.fila.dias > 0 || p.fila.ajustes.length > 0 || p.fila.adelantosQueRestan.length > 0)

  if (periodos.length === 0) {
    return <p style={{ color: 'var(--muted)', fontSize: 14 }}>Sin actividad registrada todavía para {trabajador.nombre}.</p>
  }

  // El comprobante de pago matchea por semana_key REAL -- solo se ofrece subir/ver uno
  // cuando se está viendo semana por semana, nunca al agrupar por quincena o mes (esa
  // clave no correspondería a ninguna semana real y ensuciaría pago_semanal_comprobantes).
  return (
    <div>
      {periodos.map(p => (
        <FilaSemanaHistorial
          key={p.key} fila={p.fila} semanaKey={p.key} semanaLabel={p.label}
          comprobante={vista === 'semana' ? ultimoComprobante(p.key) : undefined}
          onSubido={vista === 'semana' ? onRecargar : undefined}
        />
      ))}
    </div>
  )
}

/* ─── Subir una factura o boleta emitida, desde la ficha del cliente ──── */
// Hasta ahora una factura emitida solo se podía cargar desde el pendiente "Emitir factura"
// del panel de Admin, que es de Alexandra. Gustavo, que es quien las emite, no tenía por
// dónde: en la conversación del 04/09 la buscó en Obras, en Facturas y en Clientes y no
// estaba en ninguna. Resultado real: una sola factura cargada en todo el sistema.
// Esta es la misma máquina que ya usa Admin (mismo bucket, misma lectura por IA, misma
// tabla), pero disponible donde él trabaja. `pendiente_id` queda en null: esta factura no
// nace de un pendiente.
function SubirFacturaCliente({ cliente, presupuestos, onGuardado }: { cliente: Cliente; presupuestos: PresupuestoGuardado[]; onGuardado: () => void }) {
  const [abierto, setAbierto] = useState(false)
  const [presupuestoId, setPresupuestoId] = useState('')
  const [tipo, setTipo] = useState<'factura' | 'boleta'>('factura')
  const [fecha, setFecha] = useState(() => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Santiago' }).format(new Date()))
  const [monto, setMonto] = useState('')
  const [archivoUrl, setArchivoUrl] = useState<string | null>(null)
  const [nombreArchivo, setNombreArchivo] = useState('')
  const [subiendo, setSubiendo] = useState(false)
  const [guardando, setGuardando] = useState(false)
  const [datosIA, setDatosIA] = useState<{ rut: string | null; razon_social: string | null; giro: string | null; direccion: string | null } | null>(null)

  function limpiar() {
    setTipo('factura'); setMonto(''); setArchivoUrl(null); setNombreArchivo(''); setDatosIA(null)
    setPresupuestoId('')
    setAbierto(false)
  }

  async function subirYLeer(archivo: File) {
    setSubiendo(true)
    setNombreArchivo(archivo.name)
    const filename = `${tipo}-cliente-${cliente.id}-${Date.now()}-${archivo.name}`
    const { data, error } = await supabase.storage.from('audio-notas').upload(filename, archivo, { contentType: archivo.type })
    if (error) { alert('No se pudo subir el archivo: ' + error.message); setSubiendo(false); return }
    const url = supabase.storage.from('audio-notas').getPublicUrl(data.path).data.publicUrl
    setArchivoUrl(url)
    try {
      const res = await fetch('/api/parse-factura-emitida', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
      })
      const resultado = await res.json()
      if (res.ok) {
        if (resultado.monto != null) setMonto(String(resultado.monto))
        setDatosIA({ rut: resultado.rut, razon_social: resultado.razon_social, giro: resultado.giro, direccion: resultado.direccion })
      }
    } catch {
      // Si la IA falla, el archivo ya quedó subido -- se completa el monto a mano, mismo
      // criterio que el resto de la app.
    }
    setSubiendo(false)
  }

  async function guardar() {
    const montoNum = Number(monto)
    if (!Number.isFinite(montoNum) || montoNum <= 0) { alert('Ingresa un monto válido.'); return }
    if (!fecha) { alert('Ingresa la fecha del documento.'); return }
    setGuardando(true)
    const { error } = await supabase.from('cliente_facturas').insert({
      cliente_id: cliente.id,
      cliente_nombre: cliente.nombre,
      pendiente_id: null,
      presupuesto_id: presupuestoId || null,
      fecha,
      monto: montoNum,
      archivo_url: archivoUrl,
      tipo,
    })
    if (error) {
      alert(`No se pudo registrar la ${tipo}: ${error.message}\n\nSi menciona "presupuesto_id", falta correr la migración sql/20260908_cliente_facturas_presupuesto.sql.`)
      setGuardando(false)
      return
    }

    // Igual que en Admin: lo que la IA leyó del documento completa la ficha del cliente,
    // pero NUNCA pisa un dato ya cargado a mano.
    if (datosIA) {
      const patch: Record<string, string> = {}
      if (!cliente.rut && datosIA.rut) patch.rut = datosIA.rut
      if (!cliente.razon_social && datosIA.razon_social) patch.razon_social = datosIA.razon_social
      if (!cliente.giro && datosIA.giro) patch.giro = datosIA.giro
      if (!cliente.direccion_fiscal && datosIA.direccion) patch.direccion_fiscal = datosIA.direccion
      if (Object.keys(patch).length > 0) await supabase.from('clientes').update(patch).eq('id', cliente.id)
    }

    setGuardando(false)
    limpiar()
    onGuardado()
  }

  if (!abierto) {
    return (
      <button className="btn btn-ghost" onClick={() => setAbierto(true)} style={{ fontSize: 12 }}>
        + Subir factura o boleta
      </button>
    )
  }

  return (
    <div style={{ width: '100%', background: 'var(--surface-alt)', color: 'var(--text)', borderRadius: 8, padding: 12, marginTop: 10, display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        <div className="field" style={{ flex: '1 1 130px' }}>
          <label>Tipo</label>
          <select value={tipo} onChange={e => setTipo(e.target.value as 'factura' | 'boleta')}>
            <option value="factura">Factura</option>
            <option value="boleta">Boleta</option>
          </select>
        </div>
        <div className="field" style={{ flex: '1 1 150px' }}>
          <label>Fecha del documento</label>
          <input type="date" value={fecha} onChange={e => setFecha(e.target.value)} />
        </div>
      </div>

      {presupuestos.length > 0 && (
        <div className="field">
          <label>¿Qué presupuesto está cobrando? (opcional)</label>
          <select value={presupuestoId} onChange={e => setPresupuestoId(e.target.value)}>
            <option value="">Ninguno — no sale de un presupuesto guardado</option>
            {presupuestos.map(p => (
              <option key={p.id} value={p.id}>
                {p.referencia || 'Sin referencia'} · {new Date(p.created_at).toLocaleDateString('es-CL', { timeZone: 'America/Santiago' })} · {p.total != null ? fmtMoney(p.total) : 'sin total'}
              </option>
            ))}
          </select>
        </div>
      )}

      <label className="btn btn-secondary" style={{ fontSize: 12, cursor: subiendo ? 'default' : 'pointer', opacity: subiendo ? 0.6 : 1, width: 'fit-content' }}>
        {subiendo ? 'Leyendo el documento...' : archivoUrl ? 'Cambiar archivo' : 'Subir el archivo'}
        <input
          type="file"
          accept="image/*,application/pdf"
          style={{ display: 'none' }}
          disabled={subiendo}
          onChange={e => { const a = e.target.files?.[0]; e.target.value = ''; if (a) subirYLeer(a) }}
        />
      </label>
      {nombreArchivo && (
        <p style={{ fontSize: 12, color: 'var(--muted)' }}>
          {nombreArchivo}
          {archivoUrl && ' — subido'}
          {datosIA && ' · la IA leyó el documento, revisá el monto antes de guardar'}
        </p>
      )}

      <div className="field">
        <label>Monto</label>
        <input type="number" min="0" placeholder="Monto en pesos" value={monto} onChange={e => setMonto(e.target.value)} />
      </div>

      <div style={{ display: 'flex', gap: 8 }}>
        <button className="btn btn-primary" disabled={guardando || subiendo} onClick={guardar} style={{ fontSize: 12, padding: '7px 14px' }}>
          {guardando ? 'Guardando...' : 'Guardar'}
        </button>
        <button className="btn btn-secondary" onClick={limpiar} style={{ fontSize: 12, padding: '7px 14px' }}>Cancelar</button>
      </div>
    </div>
  )
}

/* ─── Traer presupuestos tolerando que falte la migración de adicionales ──── */
// Supabase falla la consulta ENTERA si se pide una columna que no existe, así que pedir
// `origen_id` antes de correr sql/20260908_presupuestos_adicionales.sql dejaba la ficha del
// cliente y "Mis presupuestos" sin ningún presupuesto -- se veía como si se hubieran
// borrado. Se intenta con la columna y, si falla, se reintenta sin ella.
const COLUMNAS_PRESUPUESTO = 'id, created_at, cliente_id, cliente_nombre, cliente_telefono, cliente_email, cliente_direccion, referencia, tipo, estado, subtotal, iva, total'

// clienteId opcional: sin él trae todos (Mis presupuestos); con él, los de ese cliente.
async function traerPresupuestos(clienteId?: string): Promise<PresupuestoGuardado[]> {
  async function pedir(columnas: string) {
    const q = supabase.from('presupuestos').select(columnas).order('created_at', { ascending: false })
    return clienteId ? await q.eq('cliente_id', clienteId) : await q
  }
  const conOrigen = await pedir(`${COLUMNAS_PRESUPUESTO}, origen_id`)
  if (!conOrigen.error) return (conOrigen.data as unknown as PresupuestoGuardado[]) || []
  const sinOrigen = await pedir(COLUMNAS_PRESUPUESTO)
  return (sinOrigen.data as unknown as PresupuestoGuardado[]) || []
}

/* ─── Cuerpo de un presupuesto: ítems (o etapas, o el archivo) y sus totales ──── */
// Compartido por el detalle de la obra y la ficha del cliente, para que el presupuesto se
// vea igual en los dos lados y no haya dos versiones que se puedan separar con el tiempo.
function CuerpoPresupuesto({ presupuesto }: { presupuesto: PresupuestoDetalle }) {
  return (
    <>
      {presupuesto.tipo === 'simple' ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {(presupuesto.items || []).map((item, i) => (
            <div key={i} style={{ display: 'flex', justifyContent: 'space-between', gap: 10, fontSize: 13, padding: '6px 0', borderBottom: '1px solid var(--border)' }}>
              <span style={{ flex: 1 }}>
                <span style={{ color: 'var(--muted)', fontSize: 11 }}>{item.categoria}</span><br />
                {item.description} × {item.quantity}
              </span>
              <span style={{ fontWeight: 600, flexShrink: 0 }}>{fmtMoney(item.total)}</span>
            </div>
          ))}
          {(!presupuesto.items || presupuesto.items.length === 0) && (
            <p style={{ fontSize: 13, color: 'var(--muted)' }}>Sin ítems cargados.</p>
          )}
        </div>
      ) : presupuesto.tipo === 'externo' ? (
        presupuesto.archivo_url
          ? <GaleriaArchivos urls={[presupuesto.archivo_url]} />
          : <p style={{ fontSize: 13, color: 'var(--muted)' }}>Sin archivo cargado.</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {(presupuesto.etapas || []).map((etapa, i) => (
            <div key={i}>
              <p style={{ fontWeight: 700, fontSize: 13, marginBottom: 6 }}>{etapa.numero} — {etapa.nombre}</p>
              {etapa.items.map((item, j) => (
                <div key={j} style={{ display: 'flex', justifyContent: 'space-between', gap: 10, fontSize: 12, padding: '4px 0' }}>
                  <span style={{ flex: 1, color: 'var(--muted)' }}>[{item.tipo}] {item.descripcion} × {item.cantidad}</span>
                  <span style={{ flexShrink: 0 }}>{fmtMoney(item.total)}</span>
                </div>
              ))}
              <div style={{ display: 'flex', justifyContent: 'flex-end', fontSize: 12, fontWeight: 700, marginTop: 4, paddingTop: 4, borderTop: '1px solid var(--border)' }}>
                Subtotal etapa: {fmtMoney(etapa.total)}
              </div>
            </div>
          ))}
          {(!presupuesto.etapas || presupuesto.etapas.length === 0) && (
            <p style={{ fontSize: 13, color: 'var(--muted)' }}>Sin etapas cargadas.</p>
          )}
        </div>
      )}

      {presupuesto.tipo !== 'externo' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13, marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--border)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>Subtotal</span><span>{fmtMoney(presupuesto.subtotal || 0)}</span></div>
          {presupuesto.gg_amount != null && presupuesto.gg_amount > 0 && (
            <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>Gastos generales ({presupuesto.gg_pct}%)</span><span>{fmtMoney(presupuesto.gg_amount)}</span></div>
          )}
          <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>IVA</span><span>{fmtMoney(presupuesto.iva || 0)}</span></div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 700, fontSize: 15 }}><span>Total</span><span>{fmtMoney(presupuesto.total || 0)}</span></div>
        </div>
      )}
    </>
  )
}

/* ─── Una fila de adicional, con su detalle desplegable ──── */
// Compartida por la ficha del cliente y por el detalle de la obra, a propósito: el mismo
// adicional se ve igual en los dos lados y no puede haber dos versiones que se separen con
// el tiempo. Antes los adicionales se listaban como texto muerto (fecha, ref, estado,
// total) y para ver qué tenían adentro había que salir a "Mis presupuestos" y buscarlos
// de nuevo -- Alexandra 09/09: "necesitamos que todo se comunique".
function FilaAdicional({ adicional }: { adicional: PresupuestoGuardado }) {
  const [abierto, setAbierto] = useState(false)
  const [detalle, setDetalle] = useState<PresupuestoDetalle | null>(null)
  const [cargando, setCargando] = useState(false)

  async function alternar() {
    if (abierto) { setAbierto(false); return }
    setAbierto(true)
    if (detalle) return
    setCargando(true)
    const { data } = await supabase.from('presupuestos').select('*').eq('id', adicional.id).single()
    setDetalle((data as PresupuestoDetalle) || null)
    setCargando(false)
  }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 12.5, flexWrap: 'wrap' }}>
        <span style={{ color: 'var(--muted)' }}>{new Date(adicional.created_at).toLocaleDateString('es-CL', { timeZone: 'America/Santiago' })}</span>
        {adicional.referencia && <span style={{ fontWeight: 600 }}>{adicional.referencia}</span>}
        <span className="badge badge-otro" style={{ fontSize: 10 }}>
          {adicional.estado === 'convertido' ? 'Sumado a la obra' : ESTADO_PRESUPUESTO_LABELS[adicional.estado]}
        </span>
        <span style={{ fontWeight: 700, marginLeft: 'auto' }}>{adicional.total != null ? fmtMoney(adicional.total) : '—'}</span>
      </div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        <button className="btn btn-ghost" onClick={alternar} style={{ fontSize: 11.5, padding: '2px 6px' }}>
          {abierto ? 'Ocultar detalle ▲' : 'Ver detalle ▼'}
        </button>
        {detalle && detalle.tipo !== 'externo' && (
          <button className="btn btn-ghost" onClick={() => descargarPdfPresupuesto(detalle)} style={{ fontSize: 11.5, padding: '2px 6px' }}>
            Descargar PDF
          </button>
        )}
      </div>
      {abierto && (
        cargando ? <div className="spinner" />
          : detalle
            ? <div style={{ marginTop: 6, paddingLeft: 10, borderLeft: '2px solid var(--border)' }}><CuerpoPresupuesto presupuesto={detalle} /></div>
            : <p style={{ fontSize: 12.5, color: 'var(--muted)' }}>No se pudo cargar el detalle.</p>
      )}
    </div>
  )
}

/* ─── Un presupuesto de la ficha del cliente, que se abre en el lugar ──── */
// Alexandra, viendo la ficha: "no podemos hacer clic y ver nada". La fila mostraba
// referencia, estado y total como texto muerto: para ver los ítems había que salir a
// "Mis presupuestos" y buscarlo de nuevo. Se carga el detalle completo recién al abrir,
// porque la ficha trae solo el resumen de cada presupuesto.
function PresupuestoDeLaFicha({ presupuesto, adicionales = [] }: { presupuesto: PresupuestoGuardado; adicionales?: PresupuestoGuardado[] }) {
  const [abierto, setAbierto] = useState(false)
  const [detalle, setDetalle] = useState<PresupuestoDetalle | null>(null)
  const [cargando, setCargando] = useState(false)

  async function alternar() {
    if (abierto) { setAbierto(false); return }
    setAbierto(true)
    if (detalle) return
    setCargando(true)
    const { data } = await supabase.from('presupuestos').select('*').eq('id', presupuesto.id).single()
    setDetalle((data as PresupuestoDetalle) || null)
    setCargando(false)
  }

  return (
    <div style={{ marginTop: 8 }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <button className="btn btn-ghost" onClick={alternar} style={{ fontSize: 12 }}>
          {abierto ? 'Ocultar detalle ▲' : 'Ver detalle ▼'}
        </button>
        {detalle && detalle.tipo !== 'externo' && (
          <button className="btn btn-ghost" onClick={() => descargarPdfPresupuesto(detalle)} style={{ fontSize: 12 }}>
            Descargar PDF
          </button>
        )}
        {/* Adicionales (08/09): abre el presupuestador apuntando a este presupuesto. El
            original no se toca -- lo que se guarde es un documento nuevo que lo apunta.
            09/09: antes esto era solo para los "simple", y dejaba sin forma de cargar
            adicionales a las obras que entraron por PDF externo o por etapas (Nicole/
            O'Higgins), que son justo las grandes. Ahora está para los tres tipos: en los
            que no son "simple" el adicional se carga desde cero, sin lista que consultar. */}
        <a
          className="btn btn-ghost"
          href={`/?t=${import.meta.env.VITE_PRESUPUESTO_TOKEN}&desde_presupuesto=${presupuesto.id}`}
          target="_blank"
          rel="noreferrer"
          style={{ fontSize: 12, textDecoration: 'none' }}
          title="Abre el presupuestador para armar un adicional de este presupuesto. El original queda intacto."
        >
          Crear adicionales →
        </a>
      </div>

      {adicionales.length > 0 && (
        <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid var(--border)' }}>
          <p style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 6 }}>
            Adicionales de este presupuesto
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {adicionales.map(a => <FilaAdicional key={a.id} adicional={a} />)}
          </div>
          {(() => {
            // Lo que muestran los sistemas de job costing: original, adicionales aprobados,
            // y el vigente que es la suma.
            //
            // 09/09: antes acá se sumaban los "aceptado" Y los "convertido", y eso creaba dos
            // verdades sobre la misma obra -- esta línea decía $3.220.140 mientras la pestaña
            // Obras seguía diciendo $2.510.662, que es el número contra el que se calcula el
            // saldo real. Ahora solo cuenta lo que YA se sumó a la obra ("convertido"), así
            // los dos números no pueden discrepar; y lo aceptado pero todavía sin sumar se
            // avisa aparte, porque es una acción pendiente, no un total.
            const sumados = adicionales.filter(a => a.estado === 'convertido')
            const sumaSumados = sumados.reduce((s, a) => s + (a.total || 0), 0)
            const pendientes = adicionales.filter(a => a.estado === 'aceptado')
            const sumaPendientes = pendientes.reduce((s, a) => s + (a.total || 0), 0)
            if (sumaSumados === 0 && sumaPendientes === 0) return null
            return (
              <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px solid var(--border)' }}>
                {sumaSumados > 0 && (
                  <>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5, fontWeight: 700 }}>
                      <span>Vigente (original + {sumados.length} adicional{sumados.length !== 1 ? 'es' : ''} sumado{sumados.length !== 1 ? 's' : ''} a la obra)</span>
                      <span>{fmtMoney((presupuesto.total || 0) + sumaSumados)}</span>
                    </div>
                    <button
                      className="btn btn-secondary"
                      onClick={() => descargarPdfConsolidado(presupuesto, sumados)}
                      style={{ fontSize: 12, marginTop: 8 }}
                      title="Un solo PDF con el original, cada adicional y el total vigente — para mandárselo al cliente sin tener que explicarle la cuenta."
                    >
                      PDF del vigente (original + adicionales)
                    </button>
                  </>
                )}
                {sumaPendientes > 0 && (
                  <p style={{ fontSize: 11.5, color: 'var(--primary)', fontWeight: 600, marginTop: sumaSumados > 0 ? 6 : 0, lineHeight: 1.45 }}>
                    {pendientes.length} adicional{pendientes.length !== 1 ? 'es' : ''} aceptado{pendientes.length !== 1 ? 's' : ''} por {fmtMoney(sumaPendientes)} que todavía no está{pendientes.length !== 1 ? 'n' : ''} sumado{pendientes.length !== 1 ? 's' : ''} a la obra —
                    la obra todavía no lo cobra. En “Mis presupuestos”, ponle el estado “Sumado a la obra”.
                  </p>
                )}
              </div>
            )
          })()}
        </div>
      )}
      {abierto && (
        cargando ? <div className="spinner" />
          : detalle ? <div style={{ marginTop: 10 }}><CuerpoPresupuesto presupuesto={detalle} /></div>
            : <p style={{ fontSize: 13, color: 'var(--muted)', marginTop: 8 }}>No se pudo cargar el detalle.</p>
      )}
    </div>
  )
}

/* ─── Presupuesto vinculado a una obra, dentro del detalle de la obra ──── */
// Muestra el presupuesto ORIGINAL (lo que se le vendió al cliente), no los ítems de
// trabajo: esos viven en "Avance de obra" (`obra_items`), se editan a medida que la obra
// avanza y por eso pueden dejar de coincidir con lo presupuestado. Acá interesa el
// documento tal como se envió -- por eso también se puede volver a bajar el PDF.
function PresupuestoDeLaObra({ presupuestoId, obraId }: { presupuestoId: string | null; obraId?: string | null }) {
  const [presupuesto, setPresupuesto] = useState<PresupuestoDetalle | null>(null)
  // 09/09: la obra solo conocía su presupuesto original (`obras.presupuesto_id` es un campo
  // único) y no había forma de ver desde acá los adicionales que la hicieron crecer -- la
  // obra decía $3.220.140 y el único papel que se podía abrir era el de $2.510.662.
  const [adicionales, setAdicionales] = useState<PresupuestoGuardado[]>([])
  const [cargando, setCargando] = useState(false)
  const [abierto, setAbierto] = useState(false)

  useEffect(() => {
    if (!presupuestoId) { setPresupuesto(null); setAdicionales([]); return }
    let cancelado = false
    setCargando(true)
    Promise.all([
      supabase.from('presupuestos').select('*').eq('id', presupuestoId).single(),
      // Tolera que falte la migración de adicionales, igual que traerPresupuestos: sin la
      // columna el select falla entero y dejaría la obra sin su presupuesto original.
      supabase.from('presupuestos').select('*').eq('origen_id', presupuestoId).order('created_at'),
    ]).then(([orig, adic]) => {
      if (cancelado) return
      setPresupuesto((orig.data as PresupuestoDetalle) || null)
      setAdicionales(adic.error ? [] : ((adic.data as unknown as PresupuestoGuardado[]) || []))
      setCargando(false)
    })
    return () => { cancelado = true }
  }, [presupuestoId])

  // Mismo criterio que la ficha del cliente: solo cuenta lo que YA se sumó a la obra, para
  // que este total no pueda discrepar del presupuesto de la obra.
  const sumados = adicionales.filter(a => a.estado === 'convertido')
  const sumaSumados = sumados.reduce((s, a) => s + (a.total || 0), 0)

  // Para los adicionales que se sumaron ANTES de que existiera el copiado automático (o si
  // ese copiado falló): trae solo los ítems, sin tocar un peso. Es a propósito una acción
  // aparte y no un reintento de "sumar a la obra" -- volver a sumar duplicaría el
  // presupuesto, y este boton no puede hacer eso ni por error.
  const [copiando, setCopiando] = useState<string | null>(null)
  async function copiarItemsDelAdicional(a: PresupuestoGuardado) {
    if (!obraId) return
    const fase = `Adicional ${a.referencia || ''}`.trim()
    setCopiando(a.id)
    try {
      const { data: yaEstan } = await supabase
        .from('obra_items').select('id').eq('obra_id', obraId).eq('fase', fase).limit(1)
      if (yaEstan && yaEstan.length > 0) {
        alert('Los ítems de este adicional ya están cargados en Avance de obra.')
        return
      }
      const { data: det } = await supabase
        .from('presupuestos').select('tipo, items, etapas').eq('id', a.id).single()
      if (!det) { alert('No se pudo leer el adicional. Intenta de nuevo.'); return }
      const { data: ultimo } = await supabase
        .from('obra_items').select('orden').eq('obra_id', obraId).order('orden', { ascending: false }).limit(1).maybeSingle()
      await copiarItemsAObra(
        obraId,
        det as { tipo: string; items: PresupuestoItemSimple[] | null; etapas: PresupuestoEtapa[] | null },
        { fase, ordenDesde: (ultimo?.orden ?? -1) + 1 },
      )
      alert(`Listo: los ítems de ${a.referencia || 'el adicional'} ya están en "Avance de obra", agrupados bajo "${fase}".`)
    } finally {
      setCopiando(null)
    }
  }

  return (
    <SeccionPlegable
      titulo="Presupuesto de esta obra"
      abiertaPorDefecto
      resumen={presupuesto
        ? `${fmtMoney((presupuesto.total || 0) + sumaSumados)}${sumados.length > 0 ? ` · ${sumados.length} adicional${sumados.length !== 1 ? 'es' : ''}` : ''}`
        : undefined}
      accion={presupuesto && presupuesto.tipo !== 'externo' && (
        <button className="btn btn-ghost" onClick={() => descargarPdfPresupuesto(presupuesto)} style={{ fontSize: 12, flexShrink: 0 }}>
          Descargar PDF
        </button>
      )}
    >

      {!presupuestoId ? (
        <p style={{ fontSize: 13, color: 'var(--muted)' }}>
          Esta obra no tiene un presupuesto vinculado — se creó a mano, sin partir de uno guardado.
        </p>
      ) : cargando ? (
        <div className="spinner" />
      ) : !presupuesto ? (
        <p style={{ fontSize: 13, color: 'var(--muted)' }}>No se pudo cargar el presupuesto vinculado.</p>
      ) : (
        <>
          <button
            onClick={() => setAbierto(x => !x)}
            style={{
              width: '100%', background: 'var(--surface-alt)', border: '1px solid var(--border)',
              borderRadius: 8, padding: '10px 12px', cursor: 'pointer', color: 'var(--text)',
              display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, textAlign: 'left',
            }}
          >
            <span style={{ fontSize: 13, minWidth: 0 }}>
              <strong>{presupuesto.referencia || 'Sin referencia'}</strong>
              <span style={{ color: 'var(--muted)' }}>
                {' · '}{new Date(presupuesto.created_at).toLocaleDateString('es-CL', { timeZone: 'America/Santiago' })}
                {presupuesto.tipo === 'externo' ? ' · presupuesto externo' : ''}
              </span>
            </span>
            <span style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
              <strong style={{ fontSize: 14 }}>{fmtMoney(presupuesto.total || 0)}</strong>
              <span style={{ color: 'var(--muted)', fontSize: 12 }}>{abierto ? '▲' : '▼'}</span>
            </span>
          </button>

          {abierto && <div style={{ marginTop: 12 }}><CuerpoPresupuesto presupuesto={presupuesto} /></div>}

          {adicionales.length > 0 && (
            <div style={{ marginTop: 12, paddingTop: 10, borderTop: '1px solid var(--border)' }}>
              <p style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 8 }}>
                Adicionales de esta obra
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {adicionales.map(a => (
                  <div key={a.id}>
                    <FilaAdicional adicional={a} />
                    {obraId && a.estado === 'convertido' && (
                      <button
                        className="btn btn-ghost"
                        onClick={() => copiarItemsDelAdicional(a)}
                        disabled={copiando === a.id}
                        style={{ fontSize: 11.5, padding: '2px 6px' }}
                        title="Copia los ítems de este adicional a Avance de obra. No toca el presupuesto de la obra."
                      >
                        {copiando === a.id ? 'Copiando...' : 'Llevar sus ítems a Avance de obra'}
                      </button>
                    )}
                  </div>
                ))}
              </div>
              {sumaSumados > 0 && (
                <>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5, marginTop: 8, paddingTop: 8, borderTop: '1px solid var(--border)', fontWeight: 700 }}>
                    <span>Total de la obra (original + {sumados.length} adicional{sumados.length !== 1 ? 'es' : ''})</span>
                    <span>{fmtMoney((presupuesto.total || 0) + sumaSumados)}</span>
                  </div>
                  <button
                    className="btn btn-secondary"
                    onClick={() => descargarPdfConsolidado(presupuesto, sumados)}
                    style={{ fontSize: 12, marginTop: 8 }}
                    title="Un solo PDF con el original, cada adicional y el total vigente — para mandárselo al cliente sin tener que explicarle la cuenta."
                  >
                    PDF del vigente (original + adicionales)
                  </button>
                </>
              )}
            </div>
          )}
        </>
      )}
    </SeccionPlegable>
  )
}

/* ─── Contratos de subcontratistas de una obra ──── */
// 09/09: `subcontratos_master` ya existía y el saldo la usaba como costo comprometido, pero
// NO había ninguna pantalla para cargar un contrato -- el único que existía (Endy, pintura,
// O'Higgins) se había cargado por SQL a mano. Por eso la obra de Alexis mostraba
// Subcontratos $0 y un saldo de $889.415 que se leía como ganancia, cuando en realidad
// todavía le deben a Cristian casi toda su parte: el número no mentía, le faltaba el dato.
//
// No se ofrece borrar a propósito: la seguridad etapa 1 (08/09) le sacó DELETE a esta tabla
// y un botón de borrar fallaría en silencio. Para sacar uno, se corrige el monto o se avisa.
function SubcontratosDeLaObra({ obra, onCambio }: { obra: string; onCambio?: () => void }) {
  const [filas, setFilas] = useState<SubcontratoMaster[]>([])
  const [cargando, setCargando] = useState(true)
  const [mostrarNuevo, setMostrarNuevo] = useState(false)
  const [guardando, setGuardando] = useState(false)
  const [nuevo, setNuevo] = useState({ subcontratista: '', trabajo: '', total_contrato: '' })

  const cargar = useCallback(async () => {
    const { data } = await supabase.from('subcontratos_master').select('*').eq('obra', obra).order('created_at')
    setFilas((data as SubcontratoMaster[]) || [])
    setCargando(false)
  }, [obra])
  useEffect(() => { cargar() }, [cargar])

  async function guardar() {
    if (!nuevo.subcontratista.trim() || !nuevo.trabajo.trim()) { alert('Completa quién es el subcontratista y qué trabajo hace.'); return }
    const monto = Number(nuevo.total_contrato)
    if (!Number.isFinite(monto) || monto <= 0) { alert('El total del contrato tiene que ser un número mayor a cero.'); return }
    setGuardando(true)
    const { error } = await supabase.from('subcontratos_master').insert({
      subcontratista: nuevo.subcontratista.trim(), obra, trabajo: nuevo.trabajo.trim(), total_contrato: monto,
    })
    setGuardando(false)
    if (error) { alert('No se pudo guardar el subcontrato. Intenta de nuevo.'); return }
    setNuevo({ subcontratista: '', trabajo: '', total_contrato: '' })
    setMostrarNuevo(false)
    await cargar()
    onCambio?.()
  }

  const totalContratado = filas.reduce((s, f) => s + Number(f.total_contrato), 0)

  return (
    <SeccionPlegable
      titulo="Subcontratistas"
      resumen={filas.length > 0
        ? `${filas.map(f => f.subcontratista).join(', ')} · ${fmtMoney(totalContratado)}`
        : 'ninguno cargado'}
      accion={
        <button className="btn btn-ghost" onClick={() => setMostrarNuevo(x => !x)} style={{ fontSize: 12, flexShrink: 0 }}>
          {mostrarNuevo ? 'Cancelar' : '+ Agregar subcontrato'}
        </button>
      }
    >

      {mostrarNuevo && (
        <div className="card" style={{ padding: 14, marginBottom: 10 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div className="field">
              <label>¿Quién lo ejecuta?</label>
              <input type="text" placeholder="Ej: Cristian" value={nuevo.subcontratista} onChange={e => setNuevo(p => ({ ...p, subcontratista: e.target.value }))} />
            </div>
            <div className="field">
              <label>¿Qué trabajo?</label>
              <input type="text" placeholder="Ej: Instalación eléctrica completa" value={nuevo.trabajo} onChange={e => setNuevo(p => ({ ...p, trabajo: e.target.value }))} />
            </div>
            <div className="field">
              <label>Total del contrato</label>
              <input type="number" min="0" placeholder="Monto en pesos" value={nuevo.total_contrato} onChange={e => setNuevo(p => ({ ...p, total_contrato: e.target.value }))} />
              <span style={{ fontSize: 11.5, color: 'var(--muted)' }}>
                Lo pactado con él, completo. Cuenta como costo de la obra desde ahora, aunque todavía no se le
                haya pagado nada — lo ya pagado se carga día a día en el Reporte Diario.
              </span>
            </div>
            <button className="btn btn-primary" onClick={guardar} disabled={guardando} style={{ fontSize: 13 }}>
              {guardando ? 'Guardando...' : 'Guardar subcontrato'}
            </button>
          </div>
        </div>
      )}

      {cargando ? <div className="spinner" /> : filas.length === 0 ? (
        <p style={{ fontSize: 13, color: 'var(--muted)' }}>
          Esta obra no tiene subcontratistas cargados — la ejecuta el equipo de Horma.
        </p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {filas.map(f => (
            <div key={f.id} style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 13, flexWrap: 'wrap' }}>
              <span style={{ fontWeight: 600 }}>{f.subcontratista}</span>
              <span style={{ color: 'var(--muted)' }}>{f.trabajo}</span>
              <span style={{ fontWeight: 700, marginLeft: 'auto' }}>{fmtMoney(Number(f.total_contrato))}</span>
            </div>
          ))}
          {filas.length > 1 && (
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, fontWeight: 700, paddingTop: 6, borderTop: '1px solid var(--border)' }}>
              <span>Total contratado</span><span>{fmtMoney(totalContratado)}</span>
            </div>
          )}
        </div>
      )}
    </SeccionPlegable>
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
                {/* Pedido de Alexandra (07/09): "en el detalle debe aparecer en compras poder
                    ver lo que se subió, que se compró o el capture del pago". La foto ya se
                    guardaba desde el Reporte Diario, pero acá no había forma de mirarla. */}
                {c.foto_boleta_url && (
                  <a
                    href={c.foto_boleta_url}
                    target="_blank"
                    rel="noreferrer"
                    style={{ fontSize: 12, fontWeight: 600, color: 'var(--primary)', textDecoration: 'none', flexShrink: 0 }}
                  >
                    Ver boleta →
                  </a>
                )}
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
                {s.comprobante_url && (
                  <a href={s.comprobante_url} target="_blank" rel="noreferrer" style={{ fontSize: 12, color: 'var(--primary)', fontWeight: 600 }}>
                    Ver comprobante
                  </a>
                )}
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
                {c.comprobante_url && (
                  <a href={c.comprobante_url} target="_blank" rel="noreferrer" style={{ fontSize: 12, color: 'var(--primary)', fontWeight: 600 }}>
                    Ver comprobante
                  </a>
                )}
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
        <StatTile label="Abonado" valor={fmtMoney(totalAbonado)} tono="positivo" />
        <StatTile label="Por abonar" valor={fmtMoney(restante)} tono={restante > 0 ? 'negativo' : 'positivo'} />
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
    <SeccionPlegable
      titulo="Fotos y videos"
      resumen={loading ? undefined : media.length === 0 ? 'ninguna' : `${media.length} archivo${media.length !== 1 ? 's' : ''}`}
      accion={
        <label className="btn btn-ghost" style={{ fontSize: 12, flexShrink: 0, cursor: subiendo ? 'default' : 'pointer', opacity: subiendo ? 0.6 : 1 }}>
          {subiendo ? 'Subiendo...' : '+ Subir'}
          <input type="file" accept="image/*,video/*,.pdf" onChange={subirArchivo} disabled={subiendo} style={{ display: 'none' }} />
        </label>
      }
    >
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
    </SeccionPlegable>
  )
}

/* ─── Sección plegable del detalle de obra ──── */
// El detalle tenía seis secciones apiladas y cada una con su propio scroll interno
// (maxHeight 24vh/28vh/30vh). En un notebook eso dejaba seis ventanitas de tres líneas y en
// el teléfono directamente no se veía nada -- Alexandra, 11/09: "hay que arreglar la forma
// en que se presentan los datos porque en pc no se puede ver todos y en móvil menos".
//
// Ahora el modal tiene UN solo scroll y cada sección se pliega, con el dato importante en el
// título para no tener que abrirla: cuánto suma, cuántas hay. Se abren solas únicamente las
// que casi siempre se van a mirar.
function SeccionPlegable({ titulo, resumen, abiertaPorDefecto = false, accion, children }: {
  titulo: string
  resumen?: string
  abiertaPorDefecto?: boolean
  accion?: React.ReactNode
  children: React.ReactNode
}) {
  const [abierta, setAbierta] = useState(abiertaPorDefecto)
  return (
    <div style={{ borderBottom: '1px solid var(--border)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '12px 1.5rem' }}>
        <button
          onClick={() => setAbierta(x => !x)}
          style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'baseline', gap: 8, background: 'none', border: 'none', cursor: 'pointer', padding: 0, textAlign: 'left', color: 'var(--text)' }}
        >
          <span style={{ color: 'var(--muted)', fontSize: 11, flexShrink: 0 }}>{abierta ? '▲' : '▼'}</span>
          <span className="font-display" style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
            {titulo}
          </span>
          {resumen && (
            <span style={{ fontSize: 12.5, color: 'var(--muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {resumen}
            </span>
          )}
        </button>
        {abierta && accion}
      </div>
      {abierta && <div style={{ padding: '0 1.5rem 14px' }}>{children}</div>}
    </div>
  )
}

/* ─── IVA del mes (la cuenta del F29) ───────────────── */
// Pedido de Alexandra (11/09): "definitivamente tenemos que meter la parte fiscal y
// contable... la card de IVA es de suma importancia", y con una condición que manda sobre
// todo lo demás: "uno le da clic ahí y debe aparecer de dónde la app está tomando el IVA...
// todo siempre debe tener su respectivo porqué, así es fácil ver cualquier error y no es
// una caja negra". Por eso cada tarjeta de acá se abre y muestra documento por documento
// de dónde salió su número, y lo que NO se está contando se dice, no se esconde.
//
// Cómo funciona en Chile, que es lo que replica esta pantalla (Formulario 29, mensual):
//   * DÉBITO FISCAL: el IVA de lo que vendiste. Lo cobraste al cliente y no es tuyo -- se
//     le debe al SII. Lo generan tanto las facturas como las boletas emitidas.
//   * CRÉDITO FISCAL: el IVA de lo que compraste. Se descuenta del débito, pero SOLO si la
//     compra está respaldada con FACTURA a nombre de la empresa: una boleta de compra no da
//     derecho a crédito. Es la misma regla por la que el costo de materiales se cuenta neto
//     (ver la explicación dentro de cada obra) y por la que el pago a un subcontratista que
//     no factura se cuenta completo.
//   * RESULTADO: débito − crédito. Si da positivo, es plata a pagar. Si da negativo, no se
//     pierde: queda como remanente a favor para el mes siguiente.
export function PanelIVA() {
  const hoy = new Date()
  const [mes, setMes] = useState(`${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, '0')}`)
  const [emitidas, setEmitidas] = useState<ClienteFactura[]>([])
  const [compras, setCompras] = useState<ReporteCompraDia[]>([])
  const [gastos, setGastos] = useState<GastoVariable[]>([])
  const [loading, setLoading] = useState(true)
  const [abierto, setAbierto] = useState<'ventas' | 'compras' | null>(null)

  useEffect(() => {
    Promise.all([
      supabase.from('cliente_facturas').select('*').order('fecha'),
      supabase.from('reportes_compras').select('*').order('fecha'),
      supabase.from('gastos_variables').select('*').order('fecha'),
    ]).then(([f, c, g]) => {
      setEmitidas((f.data as ClienteFactura[]) || [])
      setCompras((c.data as ReporteCompraDia[]) || [])
      setGastos((g.data as GastoVariable[]) || [])
      setLoading(false)
    })
  }, [])

  if (loading) return <div className="spinner" />

  const delMes = (fecha: string) => fecha.slice(0, 7) === mes
  // El IVA de un monto que ya lo trae adentro es 19/119, no el 19%. Es el mismo criterio
  // que usa "IVA a apartar" en cada obra, y da exacto contra los presupuestos guardados.
  const ivaDe = (montoConIva: number) => Math.round(montoConIva * 19 / 119)

  const ventasMes = emitidas.filter(f => delMes(f.fecha))
  const comprasMes = compras.filter(c => delMes(c.fecha))
  const gastosMes = gastos.filter(g => delMes(g.fecha))

  const debito = ventasMes.reduce((s, f) => s + ivaDe(f.monto), 0)
  const credito = comprasMes.reduce((s, c) => s + ivaDe(c.monto), 0)
  const resultado = debito - credito
  const gastosSinContar = gastosMes.reduce((s, g) => s + g.monto, 0)

  const fmtFecha = (f: string) => f.split('-').reverse().join('/')
  const Fila = ({ izq, sub, bruto }: { izq: string; sub?: string; bruto: number }) => (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, background: 'var(--surface-alt)', borderRadius: 8, padding: '8px 12px', fontSize: 12.5, flexWrap: 'wrap' }}>
      <span style={{ flex: 1, minWidth: 150 }}>
        {izq}
        {sub && <span style={{ color: 'var(--muted)', fontSize: 11.5 }}> · {sub}</span>}
      </span>
      <span style={{ color: 'var(--muted)', fontSize: 11.5, flexShrink: 0 }}>total {fmtMoney(bruto)}</span>
      <span style={{ color: 'var(--muted)', fontSize: 11.5, flexShrink: 0 }}>neto {fmtMoney(bruto - ivaDe(bruto))}</span>
      <span style={{ fontWeight: 700, flexShrink: 0, minWidth: 80, textAlign: 'right' }}>{fmtMoney(ivaDe(bruto))}</span>
    </div>
  )

  return (
    <div>
      <div className="field" style={{ maxWidth: 220, marginBottom: 18 }}>
        <label>Mes</label>
        <input type="month" value={mes} onChange={e => setMes(e.target.value)} />
      </div>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
        <button onClick={() => setAbierto(abierto === 'ventas' ? null : 'ventas')} style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', textAlign: 'left' }}>
          <StatTile
            label="IVA de servicios (débito)"
            valor={fmtMoney(debito)}
            nota={`${ventasMes.length} documento${ventasMes.length !== 1 ? 's' : ''} · ver de dónde sale ${abierto === 'ventas' ? '▲' : '▼'}`}
          />
        </button>
        <button onClick={() => setAbierto(abierto === 'compras' ? null : 'compras')} style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', textAlign: 'left' }}>
          <StatTile
            label="IVA de compras (crédito)"
            valor={fmtMoney(credito)}
            nota={`${comprasMes.length} compra${comprasMes.length !== 1 ? 's' : ''} · ver de dónde sale ${abierto === 'compras' ? '▲' : '▼'}`}
          />
        </button>
        <StatTile
          label={resultado >= 0 ? 'A pagar al SII' : 'Remanente a favor'}
          valor={fmtMoney(Math.abs(resultado))}
          tono={resultado >= 0 ? 'alerta' : 'positivo'}
          nota={resultado >= 0 ? 'débito − crédito' : 'queda para el mes siguiente'}
        />
      </div>

      {abierto === 'ventas' && (
        <div className="card" style={{ padding: 16, marginBottom: 16 }}>
          <p style={{ fontSize: 13, fontWeight: 700, marginBottom: 4 }}>De dónde sale el IVA de servicios</p>
          <p style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 10, lineHeight: 1.45 }}>
            Cada factura o boleta que se emitió este mes y está cargada en la app. El IVA de cada una es
            19/119 de su total, porque el monto ya lo trae adentro.
          </p>
          {ventasMes.length === 0 ? (
            <p style={{ fontSize: 12.5, color: 'var(--muted)' }}>No hay ninguna factura ni boleta cargada con fecha de este mes.</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {ventasMes.map(f => (
                <Fila key={f.id} izq={`${fmtFecha(f.fecha)} · ${f.cliente_nombre}`} sub={f.tipo === 'boleta' ? 'Boleta' : 'Factura'} bruto={f.monto} />
              ))}
            </div>
          )}
          {/* El agujero más grande de esta pantalla, dicho donde se ve y no escondido: la app
              tiene 3 documentos emitidos cargados en total. Si Gustavo emitió facturas por
              fuera, este número sale corto y el F29 real va a ser más alto. */}
          <p style={{ fontSize: 12, color: 'var(--primary)', fontWeight: 600, marginTop: 10, lineHeight: 1.45 }}>
            Solo cuenta lo que está cargado en “Facturas”. Una factura emitida que no se subió acá no aparece
            en este número, y el F29 real va a dar más. Lo cobrado a los clientes NO se usa para esta cuenta:
            el IVA se declara cuando se emite el documento, no cuando el cliente paga.
          </p>
        </div>
      )}

      {abierto === 'compras' && (
        <div className="card" style={{ padding: 16, marginBottom: 16 }}>
          <p style={{ fontSize: 13, fontWeight: 700, marginBottom: 4 }}>De dónde sale el IVA de compras</p>
          <p style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 10, lineHeight: 1.45 }}>
            Cada compra cargada este mes, agrupada por obra. Es el mismo IVA que en la pestaña Obras se
            descuenta del costo — por eso el margen de una obra cuenta los materiales netos.
          </p>
          {comprasMes.length === 0 ? (
            <p style={{ fontSize: 12.5, color: 'var(--muted)' }}>No hay compras cargadas con fecha de este mes.</p>
          ) : (
            /* Una card por obra (pedido de Alexandra, 11/09): en una lista corrida no se ve
               dónde termina una obra y empieza la otra, y el número que importa -- cuánto
               IVA aportó cada una -- se pierde entre las filas. */
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {Array.from(comprasMes.reduce((mapa, c) => {
                const k = c.obra || (c.destino === 'stock' ? 'Bodega (sin obra todavía)' : 'Sin obra')
                mapa.set(k, [...(mapa.get(k) || []), c])
                return mapa
              }, new Map<string, ReporteCompraDia[]>())).sort((a, b) => a[0].localeCompare(b[0])).map(([obraNombre, suyas]) => (
                <div key={obraNombre} className="card" style={{ padding: '14px 16px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 10, paddingBottom: 8, marginBottom: 10, borderBottom: '1px solid var(--border)', flexWrap: 'wrap' }}>
                    <span style={{ fontSize: 13.5, fontWeight: 700, minWidth: 0 }}>{obraNombre}</span>
                    <span style={{ fontSize: 12, color: 'var(--muted)', flexShrink: 0 }}>
                      {suyas.length} compra{suyas.length !== 1 ? 's' : ''} · total {fmtMoney(suyas.reduce((s, c) => s + c.monto, 0))}
                    </span>
                    <span className="font-display" style={{ fontSize: 17, fontWeight: 800, flexShrink: 0, fontVariantNumeric: 'tabular-nums' }}>
                      {fmtMoney(suyas.reduce((s, c) => s + ivaDe(c.monto), 0))}
                    </span>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                    {suyas.map(c => <Fila key={c.id} izq={`${fmtFecha(c.fecha)} · ${c.descripcion}`} bruto={c.monto} />)}
                  </div>
                </div>
              ))}
            </div>
          )}
          <p style={{ fontSize: 12, color: 'var(--primary)', fontWeight: 600, marginTop: 10, lineHeight: 1.45 }}>
            Esta cuenta asume que todas las compras van con factura, que es lo que confirmó Gustavo. Una
            compra hecha con boleta NO da derecho a crédito fiscal, así que si alguna entró con boleta este
            número sale más alto de lo que el SII va a aceptar.
            {gastosSinContar > 0 && (
              <> Aparte hay {fmtMoney(gastosSinContar)} en gastos variables de la empresa este mes que no se
              están contando acá, porque no se sabe cuáles tienen factura. Los que la tengan también dan crédito.</>
            )}
          </p>
        </div>
      )}

      <div className="card" style={{ padding: '18px 20px' }}>
        <p style={{ fontSize: 13, fontWeight: 700, marginBottom: 8 }}>Cómo se lee esta pantalla</p>
        <p style={{ fontSize: 12.5, color: 'var(--muted)', lineHeight: 1.55 }}>
          El IVA no es plata de la empresa: se cobra por cuenta del SII. Cada mes se declara la diferencia
          entre el IVA que se le cobró a los clientes (débito) y el que se pagó a los proveedores con factura
          (crédito). Si el débito es mayor, esa diferencia se paga. Si el crédito es mayor, no se pierde:
          queda como remanente a favor y se descuenta el mes siguiente.
        </p>
        <p style={{ fontSize: 12.5, color: 'var(--muted)', lineHeight: 1.55, marginTop: 8 }}>
          Esta pantalla arma la cuenta del mes con lo que hay cargado en la app. No reemplaza al contador ni
          al F29: no trae el remanente acumulado de los meses anteriores (empezó antes que este sistema), ni
          el PPM, ni las retenciones. Sirve para saber con cuánto hay que contar y para encontrar un dato mal
          cargado antes de que llegue a la declaración.
        </p>
      </div>
    </div>
  )
}

/* ─── Bitácora: qué cambió en esta obra y cuándo ──── */
// Idea de Alexandra (10/09): "hoy el único rastro de un cambio es que el número cambió, sin
// decir cuándo ni por qué". Pasó tres veces esta semana -- el pago de Gabriel cargado como si
// fuera el contrato, el objetivo del 25% que se sacó, el IVA de bodega que se puso y se
// revirtió -- y cada vez hubo que reconstruirlo a mano contra la base.
//
// Se DERIVA de los `created_at` que ya existen, sin tabla de auditoría ni escrituras nuevas.
// Eso tiene un límite honesto y está escrito en pantalla: se ve cuándo se CARGÓ cada cosa,
// no cuándo se editó una que ya estaba. Marcar una obra "con IVA" o corregirle el monto a un
// contrato no deja rastro, porque nada lo registra. Para eso haría falta una tabla aparte.
//
// El eje es `created_at` (cuándo se cargó) y no `fecha` (el día del que habla el movimiento),
// justamente porque la pregunta que esto responde es "¿cuándo entró este número?". Cuando las
// dos no coinciden, se muestran las dos.
function BitacoraObra({ obra, presupuestoId }: { obra: string; presupuestoId: string | null }) {
  const [abierta, setAbierta] = useState(false)
  const [cargando, setCargando] = useState(false)
  const [eventos, setEventos] = useState<{ cuando: string; fecha: string | null; texto: string; monto: number | null }[] | null>(null)

  async function alternar() {
    if (abierta) { setAbierta(false); return }
    setAbierta(true)
    if (eventos) return
    setCargando(true)
    const [comprasR, cobrosR, subR, contratosR, salidasR, adicionalesR] = await Promise.all([
      supabase.from('reportes_compras').select('created_at, fecha, descripcion, monto').eq('obra', obra),
      supabase.from('reportes_cobros').select('created_at, fecha, cliente, monto').eq('obra', obra),
      supabase.from('reportes_subcontratos').select('created_at, fecha, subcontrato, monto').eq('obra', obra),
      supabase.from('subcontratos_master').select('created_at, subcontratista, trabajo, total_contrato').eq('obra', obra),
      supabase.from('movimientos_stock').select('created_at, fecha, cantidad, precio_unitario, receptor, materiales(nombre)').eq('obra', obra).eq('tipo', 'salida'),
      presupuestoId
        ? supabase.from('presupuestos').select('created_at, referencia, total, estado').eq('origen_id', presupuestoId)
        : Promise.resolve({ data: [], error: null }),
    ])

    const lista: { cuando: string; fecha: string | null; texto: string; monto: number | null }[] = []
    const agregar = (cuando: string | null, fecha: string | null, texto: string, monto: number | null) => {
      if (cuando) lista.push({ cuando, fecha, texto, monto })
    }

    for (const a of (adicionalesR.data || []) as { created_at: string; referencia: string | null; total: number | null; estado: string }[]) {
      agregar(a.created_at, null, `Adicional ${a.referencia || 'sin referencia'}${a.estado === 'convertido' ? ', sumado a la obra' : ` (${ESTADO_PRESUPUESTO_LABELS[a.estado as EstadoPresupuesto] || a.estado})`}`, a.total)
    }
    for (const c of (contratosR.data || []) as { created_at: string; subcontratista: string; trabajo: string | null; total_contrato: number }[]) {
      agregar(c.created_at, null, `Contrato con ${c.subcontratista}${c.trabajo ? ` — ${c.trabajo}` : ''}`, c.total_contrato)
    }
    for (const s of (subR.data || []) as { created_at: string; fecha: string; subcontrato: string | null; monto: number }[]) {
      agregar(s.created_at, s.fecha, `Abono a ${s.subcontrato || 'un subcontratista'}`, s.monto)
    }
    for (const c of (cobrosR.data || []) as { created_at: string; fecha: string; cliente: string; monto: number }[]) {
      agregar(c.created_at, c.fecha, `Cobro a ${c.cliente}`, c.monto)
    }
    for (const c of (comprasR.data || []) as { created_at: string; fecha: string; descripcion: string; monto: number }[]) {
      agregar(c.created_at, c.fecha, `Compra: ${c.descripcion}`, c.monto)
    }
    type SalidaBitacora = { created_at: string; fecha: string; cantidad: number; precio_unitario: number | null; receptor: string | null; materiales: { nombre: string } | { nombre: string }[] | null }
    for (const m of (salidasR.data || []) as unknown as SalidaBitacora[]) {
      const mat = Array.isArray(m.materiales) ? m.materiales[0] : m.materiales
      agregar(m.created_at, m.fecha, `Salió de bodega: ${m.cantidad} × ${mat?.nombre || 'material'}${m.receptor ? ` → ${m.receptor}` : ''}`, m.precio_unitario != null ? m.cantidad * m.precio_unitario : null)
    }

    lista.sort((a, b) => b.cuando.localeCompare(a.cuando))
    setEventos(lista)
    setCargando(false)
  }

  return (
    <div style={{ marginTop: 4 }}>
      <button className="btn btn-ghost" onClick={alternar} style={{ fontSize: 12, padding: '4px 8px' }}>
        {abierta ? 'Ocultar bitácora ▲' : 'Bitácora: qué cambió y cuándo ▼'}
      </button>
      {abierta && (
        cargando ? <div className="spinner" /> : (
          <div style={{ marginTop: 8 }}>
            <p style={{ fontSize: 11.5, color: 'var(--muted)', marginBottom: 8, lineHeight: 1.45 }}>
              Cuándo se cargó cada cosa en esta obra, de lo más nuevo a lo más viejo. No muestra ediciones de
              algo que ya estaba (corregirle el monto a un contrato, marcar la obra con IVA): eso no queda
              registrado en ningún lado todavía.
            </p>
            {eventos && eventos.length === 0 ? (
              <p style={{ fontSize: 12.5, color: 'var(--muted)' }}>Todavía no hay nada cargado en esta obra.</p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                {(eventos || []).map((e, i) => {
                  const cuando = new Date(e.cuando)
                  const dia = cuando.toLocaleDateString('es-CL', { timeZone: 'America/Santiago' })
                  const hora = cuando.toLocaleTimeString('es-CL', { timeZone: 'America/Santiago', hour: '2-digit', minute: '2-digit' })
                  const fechaMovimiento = e.fecha ? e.fecha.split('-').reverse().join('/') : null
                  return (
                    <div key={i} style={{ display: 'flex', alignItems: 'baseline', gap: 10, background: 'var(--surface-alt)', borderRadius: 8, padding: '7px 11px', fontSize: 12.5, flexWrap: 'wrap' }}>
                      <span style={{ color: 'var(--muted)', fontSize: 11.5, width: 104, flexShrink: 0 }}>{dia} {hora}</span>
                      <span style={{ flex: 1, minWidth: 160 }}>
                        {e.texto}
                        {fechaMovimiento && fechaMovimiento !== dia && (
                          <span style={{ color: 'var(--muted)', fontSize: 11.5 }}> · del día {fechaMovimiento}</span>
                        )}
                      </span>
                      {e.monto != null && <span style={{ fontWeight: 700, flexShrink: 0 }}>{fmtMoney(e.monto)}</span>}
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )
      )}
    </div>
  )
}

// La fila que devuelve `calcularResumenObras` para una obra. Se deriva del cálculo en vez de
// escribirla a mano, así no puede quedar desfasada si mañana se agrega un campo.
export type ResumenObra = ReturnType<typeof calcularResumenObras>[number]

/* ─── Cómo va la plata de esta obra ──── */
// Vive en el detalle y no en la tarjeta de la obra, a pedido de Alexandra (11/09): en la
// tarjeta eran tres recuadros con un párrafo adentro cada uno y en el teléfono quedaba
// ilegible. Acá hay lugar para contarlo como lo que es -- una resta con tres pasos.
function ComoVaLaPlata({ o }: { o: ResumenObra }) {
  if (o.margen == null || o.neto == null) return null
  const costoTotal = o.gastoComprasNeto + o.gastoMaterialesBodega + o.manoDeObra
  const Linea = ({ etiqueta, valor, detalle, fuerte, tono }: { etiqueta: string; valor: string; detalle?: string; fuerte?: boolean; tono?: string }) => (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, padding: '9px 0', borderBottom: '1px solid var(--border)' }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <p style={{ fontSize: fuerte ? 13.5 : 13, fontWeight: fuerte ? 700 : 500 }}>{etiqueta}</p>
        {detalle && <p style={{ fontSize: 11.5, color: 'var(--muted)', lineHeight: 1.4, marginTop: 2 }}>{detalle}</p>}
      </div>
      <span className="font-display" style={{ fontSize: fuerte ? 18 : 14, fontWeight: fuerte ? 800 : 600, color: tono || 'var(--text)', fontVariantNumeric: 'tabular-nums', flexShrink: 0 }}>
        {valor}
      </span>
    </div>
  )

  return (
    <SeccionPlegable
      titulo="Cómo va la plata"
      abiertaPorDefecto
      resumen={`Ganancia proyectada ${fmtMoney(o.margen)}${o.margenPct != null ? ` · ${o.margenPct}%` : ''}`}
    >
      <div>
        <Linea
          etiqueta="Precio de la obra, sin IVA"
          detalle={o.ivaApartar != null ? `${fmtMoney(o.presupuestoTotal ?? 0)} menos ${fmtMoney(o.ivaApartar)} de IVA, que va al SII y no es plata de Horma` : 'Esta obra no está marcada como “el precio incluye IVA”, así que se usa el precio completo'}
          valor={fmtMoney(o.neto)}
        />
        {o.margenAlPactar != null && (
          <Linea
            etiqueta={`Menos lo pactado con ${o.subcontratistas || 'el subcontratista'}`}
            detalle="Lo que se le prometió por el trabajo completo, facture o no"
            valor={`− ${fmtMoney(o.gastoSubcontratos)}`}
          />
        )}
        {o.margenAlPactar != null && (
          <Linea
            etiqueta="Te quedaba al cerrar el trato"
            detalle="La bolsa que le quedó a Horma el día que se cerró, antes de gastar un peso en materiales. Este número no se mueve salvo que se renegocie."
            valor={`${fmtMoney(o.margenAlPactar)}${o.margenAlPactarPct != null ? ` · ${o.margenAlPactarPct}%` : ''}`}
            fuerte
          />
        )}
        {costoTotal > 0 && (
          <Linea
            etiqueta="Menos lo que se lleva gastado"
            detalle={[
              o.gastoComprasNeto > 0 ? `materiales ${fmtMoney(o.gastoComprasNeto)} (se compraron ${fmtMoney(o.gastoCompras)}, pero ${fmtMoney(o.ivaRecuperableCompras)} es IVA que vuelve con la factura)` : null,
              o.gastoMaterialesBodega > 0 ? `bodega ${fmtMoney(o.gastoMaterialesBodega)}` : null,
              o.manoDeObra > 0 ? `mano de obra ${fmtMoney(o.manoDeObra)}` : null,
            ].filter(Boolean).join(' · ')}
            valor={`− ${fmtMoney(costoTotal)}`}
          />
        )}
        <Linea
          etiqueta="Ganancia proyectada"
          detalle={`Lo que dejaría la obra SI el cliente paga todo el precio y no se gasta más. Todavía no es plata tuya${o.presupuestoTotal != null ? `: abonó ${fmtMoney(o.cobrado)} de ${fmtMoney(o.presupuestoTotal)}` : ''}.${o.margenAlPactar != null ? ' Si mañana se compra más material este número baja y el de arriba no se mueve: la distancia entre los dos es lo que se está yendo.' : ''}`}
          valor={`${fmtMoney(o.margen)}${o.margenPct != null ? ` · ${o.margenPct}%` : ''}`}
          fuerte
          tono={o.margen < 0 ? 'var(--danger)' : 'var(--success)'}
        />
        <Linea
          etiqueta="Saldo de caja"
          detalle="Esta sí es plata de verdad: lo que el cliente ya abonó menos lo que la obra lleva gastado. Lo de arriba es una proyección; esto es lo que pasó por la cuenta."
          valor={fmtMoney(o.saldo)}
          tono={o.saldo < 0 ? 'var(--danger)' : 'var(--success)'}
        />
      </div>

      {(o.gastoCompras > 0 || o.gastoSubcontratos > 0) && (
        <p style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1.5, marginTop: 12 }}>
          Los materiales se cuentan <strong>sin IVA</strong> porque las compras van con factura y ese IVA vuelve
          como crédito fiscal: no es plata que la obra perdió. Los subcontratistas se cuentan <strong>completos</strong>,
          porque no facturan ni boletean. La tarjeta “Compras” de la pestaña Obras muestra lo que salió del banco,
          para cuadrar caja.
        </p>
      )}
    </SeccionPlegable>
  )
}

export function HistorialObraModal({
  obra,
  obraId,
  resumen,
  presupuestoId = null,
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
  onCambioSubcontratos,
}: {
  obra: string
  obraId?: string
  // La fila ya calculada de esta obra. Se pasa hecha en vez de recalcularla acá, para que
  // el detalle no pueda mostrar un numero distinto al de la tarjeta.
  resumen?: ResumenObra
  presupuestoId?: string | null
  // Para que la tarjeta de la obra recalcule saldo y margen apenas se carga un subcontrato,
  // sin tener que cerrar el detalle y volver a entrar.
  onCambioSubcontratos?: () => void
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
      {/* Un solo scroll para todo el cuerpo, y cada sección plegable con su dato en el
          título. Antes cada sección tenía su propio `maxHeight` + scroll interno: en un
          notebook quedaban seis ventanitas de tres líneas y en el teléfono no se veía nada
          (Alexandra, 11/09). */}
      <div style={{
        background: 'var(--white)', color: 'var(--text)', borderRadius: '16px 16px 0 0',
        width: '100%', maxWidth: 860, maxHeight: '92vh',
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

        <div style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>

        {resumen && <ComoVaLaPlata o={resumen} />}

        <PresupuestoDeLaObra presupuestoId={presupuestoId} obraId={obraId} />

        <SubcontratosDeLaObra obra={obra} onCambio={onCambioSubcontratos} />

        <div style={{ padding: '10px 1.5rem', borderBottom: '1px solid var(--border)' }}>
          <BitacoraObra obra={obra} presupuestoId={presupuestoId} />
        </div>

        {obraId && <GaleriaObra obraId={obraId} />}

        {onAgregarAbono && onEliminarAbono && onEliminarCuenta && (
          <SeccionPlegable
            titulo="Cuentas por cobrar"
            resumen={cuentasObra && cuentasObra.length > 0
              ? `${cuentasObra.length} cuenta${cuentasObra.length !== 1 ? 's' : ''} · ${fmtMoney(cuentasObra.reduce((s, c) => s + c.total_presupuesto, 0))}`
              : 'ninguna cargada'}
            abiertaPorDefecto={(cuentasObra?.length ?? 0) > 0}
            accion={onCrearCuentaObra && (
              <button className="btn btn-ghost" onClick={() => setMostrarNuevaCuenta(x => !x)} style={{ fontSize: 12, flexShrink: 0 }}>
                {mostrarNuevaCuenta ? 'Cancelar' : '+ Agregar cuenta'}
              </button>
            )}
          >
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
          </SeccionPlegable>
        )}

        <SeccionPlegable
          titulo="Movimientos del día a día"
          resumen={`${diariosObra.length + comprasObra.length + cobrosObra.length + subcontratosObra.length} registros`}
          abiertaPorDefecto
          accion={
            <select value={vista} onChange={e => setVista(e.target.value as VistaPeriodo)} style={{ fontSize: 13, padding: '5px 10px', width: 'auto', flexShrink: 0 }}>
              <option value="dia">Día a día</option>
              <option value="semana">Semana</option>
              <option value="quincena">Quincena</option>
              <option value="mes">Mes</option>
            </select>
          }
        >
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
        </SeccionPlegable>

        </div>
      </div>
    </div>
  )
}

/* ─── Trabajadores: agregar/archivar/asignar obra + historial de pagos por trabajador
   (fusión de las antiguas "Trabajadores" e "Historial de pagos" -- Alexandra pidió que
   al entrar a un trabajador se vea toda su información junta, en vez de tener el mismo
   selector de trabajador repetido en dos pestañas distintas). ───────────────────── */
export function PanelTrabajadores() {
  const [trabajadores, setTrabajadores] = useState<Trabajador[]>([])
  const [comprobantes, setComprobantes] = useState<PagoSemanalComprobante[]>([])
  const [obras, setObras] = useState<{ id: string; nombre: string }[]>([])
  const [diarios, setDiarios] = useState<ReporteTrabajadorDia[]>([])
  const [ajustes, setAjustes] = useState<AjustePagoSemanal[]>([])
  const [adelantos, setAdelantos] = useState<AdelantoTrabajador[]>([])
  const [gastosFijos, setGastosFijos] = useState<GastoFijo[]>([])
  const [loading, setLoading] = useState(true)
  const [verArchivados, setVerArchivados] = useState(false)
  const [mostrarForm, setMostrarForm] = useState(false)
  const [nuevoNombre, setNuevoNombre] = useState('')
  const [nuevaTarifa, setNuevaTarifa] = useState('')
  const [nuevoViatico, setNuevoViatico] = useState('')
  const [guardando, setGuardando] = useState(false)
  const [trabajadorSel, setTrabajadorSel] = useState<string | null>(null)
  const [vistaHistorial, setVistaHistorial] = useState<VistaPeriodo>('semana')
  const [obrasPorTrabajador, setObrasPorTrabajador] = useState<Record<string, string[]>>({})

  const cargar = useCallback(async () => {
    const [{ data: t }, { data: c }, { data: o }, { data: d }, { data: aj }, { data: ad }, { data: gf }] = await Promise.all([
      supabase.from('trabajadores').select('*').order('nombre'),
      supabase.from('pago_semanal_comprobantes').select('*'),
      supabase.from('obras').select('id, nombre').eq('estado_obra', 'en_curso').order('nombre'),
      supabase.from('reportes_diarios').select('*'),
      supabase.from('ajustes_pago_semanal').select('*'),
      supabase.from('adelantos_trabajador').select('*'),
      supabase.from('gastos_fijos').select('*'),
    ])
    setTrabajadores((t as Trabajador[]) || [])
    setComprobantes((c as PagoSemanalComprobante[]) || [])
    setObras((o as { id: string; nombre: string }[]) || [])
    setDiarios((d as ReporteTrabajadorDia[]) || [])
    setAjustes((aj as AjustePagoSemanal[]) || [])
    setAdelantos((ad as AdelantoTrabajador[]) || [])
    setGastosFijos((gf as GastoFijo[]) || [])
    // Obras asignadas a cada trabajador. Si la migración todavía no corrió, la consulta falla
    // y se queda vacío: se usa el `obra_asignada_id` viejo y nada se rompe.
    const { data: asignaciones } = await supabase.from('trabajador_obras').select('trabajador_id, obra_id')
    const mapa: Record<string, string[]> = {}
    for (const a of (asignaciones as { trabajador_id: string; obra_id: string }[]) || []) {
      if (!mapa[a.trabajador_id]) mapa[a.trabajador_id] = []
      mapa[a.trabajador_id].push(a.obra_id)
    }
    setObrasPorTrabajador(mapa)
    setLoading(false)
  }, [])

  useEffect(() => { cargar() }, [cargar])

  // Restringe el link de /obra-fotos de este trabajador a las obras que le tocan, en vez de
  // dejarle elegir entre todas las que están en curso -- conversación 28/08 y pregunta de
  // Alexandra del 08/09 ("¿y si está asignado a más de una?"). Sin ninguna marcada, ve todas.
  async function alternarObraAsignada(t: Trabajador, obraId: string, asignar: boolean) {
    const { error } = asignar
      ? await supabase.from('trabajador_obras').insert({ trabajador_id: t.id, obra_id: obraId })
      : await supabase.from('trabajador_obras').delete().eq('trabajador_id', t.id).eq('obra_id', obraId)
    if (error) {
      alert('No se pudo guardar. Puede que falte correr la migración sql/20260908_trabajador_varias_obras.sql.')
      return
    }
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
  // disponibles en su ficha acá mismo, que lista trabajadores sin filtrar por activo.
  async function archivar(t: Trabajador) {
    if (!window.confirm(`¿Archivar a ${t.nombre}? Deja de aparecer en Reporte Diario y Pago semanal. Su historial de pagos sigue disponible acá.`)) return
    await supabase.from('trabajadores').update({ activo: false }).eq('id', t.id)
    cargar()
  }

  async function reactivar(t: Trabajador) {
    await supabase.from('trabajadores').update({ activo: true }).eq('id', t.id)
    cargar()
  }

  // Para trabajadores de sueldo fijo (ej. Fabriel), sus adelantos solo se listan acá --
  // en Pago semanal no aparecen (adelantosQueRestan siempre vacío para sueldo fijo, no
  // restan de la semana). Sin este botón no había forma de corregir uno mal fechado, ej.
  // "mover" un adelanto de agosto a septiembre a pedido del trabajador: borrar el viejo y
  // cargar uno nuevo con la fecha correcta desde Pago semanal → "+ Adelanto".
  async function borrarAdelanto(id: string, monto: number, fecha: string) {
    if (!window.confirm(`¿Borrar el adelanto de ${fmtMoney(monto)} del ${fecha.split('-').reverse().join('/')}? No se puede deshacer.`)) return
    const { error } = await supabase.from('adelantos_trabajador').delete().eq('id', id)
    if (error) { alert('No se pudo borrar: ' + error.message); return }
    cargar()
  }

  if (loading) return <div className="spinner" />

  if (trabajadorSel) {
    const trabajador = trabajadores.find(t => t.nombre === trabajadorSel)
    if (!trabajador) {
      return <p style={{ color: 'var(--muted)', fontSize: 14 }}>Trabajador no encontrado.</p>
    }
    const activo = trabajador.activo !== false
    const sueldoFijo = trabajador.tarifa_diaria === 0
    const diariosTrabajador = diarios.filter(d => d.trabajador === trabajador.nombre && d.presente)
    const ajustesTrabajador = ajustes.filter(a => a.trabajador === trabajador.nombre)
    const adelantosTrabajador = adelantos.filter(a => a.trabajador === trabajador.nombre)
    const comprobantesTrabajador = comprobantes.filter(c => c.trabajador === trabajador.nombre)
    const ultimoComprobante = (semanaKey: string) =>
      comprobantesTrabajador.filter(c => c.semana_key === semanaKey).sort((a, b) => b.created_at.localeCompare(a.created_at))[0] || null

    return (
      <div>
        <button
          onClick={() => setTrabajadorSel(null)}
          /* Va directo sobre --bg (#10182C), no dentro de una card: con --secondary (#14213D)
             quedaba azul oscuro sobre azul oscuro, invisible. styles.css ya lo dice -- lo que
             queda sobre --bg usa las variables *-inverse. */
          style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'none', border: 'none', cursor: 'pointer', fontSize: 14, fontWeight: 600, color: 'var(--text-inverse)', marginBottom: 16, padding: 0 }}
        >
          ← Volver a trabajadores
        </button>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10, marginBottom: 4, flexWrap: 'wrap' }}>
          <h2 style={{ fontSize: 18, fontWeight: 800 }}>
            {trabajador.nombre}
            {!activo && <span style={{ fontSize: 12, color: 'var(--muted)', fontWeight: 600 }}> · Archivado</span>}
          </h2>
          {activo ? (
            <button onClick={() => archivar(trabajador)} className="btn btn-ghost" style={{ fontSize: 12, padding: '6px 12px', color: 'var(--danger)' }}>
              Archivar
            </button>
          ) : (
            <button onClick={() => reactivar(trabajador)} className="btn btn-ghost" style={{ fontSize: 12, padding: '6px 12px' }}>
              Reactivar
            </button>
          )}
        </div>
        <p style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 14 }}>
          {trabajador.tarifa_diaria > 0 ? `Tarifa diaria: ${fmtMoney(trabajador.tarifa_diaria)}` : 'Sueldo fijo mensual'}
          {trabajador.viatico_diario > 0 ? ` · Viático: ${fmtMoney(trabajador.viatico_diario)}` : ''}
        </p>
        <div style={{ marginBottom: 20 }}>
          <p style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>Obras asignadas</p>
          <p style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 8 }}>
            En su link solo va a ver estas. Si no marcás ninguna, ve todas las obras en curso y elige él.
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {obras.map(o => {
              const asignada = obrasPorTrabajador[trabajador.id]?.includes(o.id) || trabajador.obra_asignada_id === o.id
              return (
                <label key={o.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={asignada}
                    onChange={e => alternarObraAsignada(trabajador, o.id, e.target.checked)}
                    style={{ width: 16, height: 16, accentColor: 'var(--primary)', cursor: 'pointer' }}
                  />
                  {o.nombre}
                </label>
              )
            })}
          </div>
        </div>

        {sueldoFijo ? (
          <PanelHistorialSueldoFijo
            trabajador={trabajador}
            diariosTrabajador={diariosTrabajador}
            ajustesTrabajador={ajustesTrabajador}
            adelantosTrabajador={adelantosTrabajador}
            gastosFijos={gastosFijos}
            ultimoComprobante={ultimoComprobante}
            onRecargar={cargar}
            onBorrarAdelanto={borrarAdelanto}
          />
        ) : (
          <>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, fontWeight: 700, color: 'var(--text)', marginBottom: 14 }}>
              Agrupar por
              <select value={vistaHistorial} onChange={e => setVistaHistorial(e.target.value as VistaPeriodo)} style={{ fontSize: 13, padding: '5px 10px', width: 'auto' }}>
                <option value="semana">Semana</option>
                <option value="quincena">Quincena</option>
                <option value="mes">Mes</option>
              </select>
            </label>
            <HistorialPeriodosTrabajador
              vista={vistaHistorial}
              trabajador={trabajador}
              diariosTrabajador={diariosTrabajador}
              ajustesTrabajador={ajustesTrabajador}
              adelantosTrabajador={adelantosTrabajador}
              ultimoComprobante={ultimoComprobante}
              onRecargar={cargar}
            />
          </>
        )}
      </div>
    )
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
                <button
                  onClick={() => setTrabajadorSel(t.nombre)}
                  style={{
                    width: '100%', textAlign: 'left', background: 'none', border: 'none', cursor: 'pointer', padding: 0, color: 'var(--text)',
                    display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10, flexWrap: 'wrap',
                  }}
                >
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
                  <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--primary)', whiteSpace: 'nowrap' }}>Ver historial →</span>
                </button>
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
                  {/* En la lista solo se informa; se asignan desde la ficha, donde entran
                      varias sin apretar el renglón. */}
                  <span style={{ fontSize: 12, color: 'var(--muted)', marginLeft: 'auto' }}>
                    {(() => {
                      const ids = obrasPorTrabajador[t.id] || (t.obra_asignada_id ? [t.obra_asignada_id] : [])
                      if (ids.length === 0) return 'Sin obra asignada — ve todas'
                      if (ids.length === 1) return obras.find(o => o.id === ids[0])?.nombre || '1 obra asignada'
                      return `${ids.length} obras asignadas`
                    })()}
                  </span>
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
  const [obraFiltro, setObraFiltro] = useState('')
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
  // Pedido de Alexandra (conversación 2): "unas subtarjetitas que yo seleccione obra y ver".
  // Lo marcó como comodidad -- con 24 compras en Ohiggins, buscar la de una obra puntual en
  // la lista del mes es incómodo.
  const obrasDelPeriodo = Array.from(new Set(periodo.compras.map(c => c.obra).filter((o): o is string => !!o))).sort()
  const comprasVisibles = obraFiltro ? periodo.compras.filter(c => c.obra === obraFiltro) : periodo.compras
  const totalPeriodo = comprasVisibles.reduce((s, c) => s + c.monto, 0)

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
        {obrasDelPeriodo.length > 1 && (
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, fontWeight: 600, color: 'var(--text-inverse)' }}>
            Obra:
            <select
              value={obraFiltro}
              onChange={e => setObraFiltro(e.target.value)}
              style={{
                width: 'auto', padding: '6px 10px', fontSize: 13, fontWeight: 600, borderRadius: 6,
                border: '1.5px solid var(--primary)', background: 'var(--white)', color: 'var(--secondary)',
                cursor: 'pointer', appearance: 'auto',
              }}
            >
              <option value="">Todas</option>
              {obrasDelPeriodo.map(o => <option key={o} value={o}>{o}</option>)}
            </select>
          </label>
        )}
        <button
          onClick={cargar}
          style={{ padding: '6px 10px', fontSize: 12, fontWeight: 600, borderRadius: 6, border: '1px solid var(--border)', background: 'var(--white)', cursor: 'pointer', color: 'var(--muted)' }}
        >↻ Actualizar</button>
      </div>

      <div style={{ marginBottom: 18 }}>
        <StatTile label="Total compras del mes" valor={fmtMoney(totalPeriodo)} tono="neutral" />
      </div>

      {comprasVisibles.length === 0 ? (
        <p style={{ color: 'var(--muted)', fontSize: 14 }}>Sin compras cargadas ese mes.</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {comprasVisibles.map(c => {
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
// Esta pestaña leía la tabla `facturas` (fecha + obra + monto, cargados a mano), que quedó
// abandonada: 2 filas, la última del 17/08. Las facturas de verdad -- con el documento y
// los datos leídos por IA -- viven en `cliente_facturas` desde el 02/09. Eran dos sistemas
// que no se hablaban, y eso hizo que Gustavo y Alexandra marcaran una obra como facturada
// y no vieran nada acá (conversación del 04/09).
// Ahora muestra las facturas reales. Los registros viejos no se borran -- se muestran
// aparte y etiquetados, mismo criterio que ya se usó con los pendientes y los trabajadores:
// nunca se destruye historial, se lo saca del camino.
export function PanelFacturas() {
  const [emitidas, setEmitidas] = useState<ClienteFactura[]>([])
  const [viejas, setViejas] = useState<{ id: string; fecha: string; obra: string | null; monto: number }[]>([])
  const [verViejas, setVerViejas] = useState(false)
  const [loading, setLoading] = useState(true)

  const cargar = useCallback(async () => {
    const [{ data: emit }, { data: old }] = await Promise.all([
      supabase.from('cliente_facturas').select('*').order('fecha', { ascending: false }),
      supabase.from('facturas').select('*').order('fecha', { ascending: false }),
    ])
    setEmitidas((emit as ClienteFactura[]) || [])
    setViejas(old || [])
    setLoading(false)
  }, [])

  useEffect(() => { cargar() }, [cargar])

  async function borrarVieja(id: string) {
    if (!window.confirm('¿Borrar este registro viejo? Es del sistema anterior, no tiene documento asociado. No se puede deshacer.')) return
    const { error } = await supabase.from('facturas').delete().eq('id', id)
    if (error) { alert('No se pudo borrar. Intenta de nuevo.'); return }
    setViejas(prev => prev.filter(f => f.id !== id))
  }

  if (loading) return <div className="spinner" />

  const totalFacturas = emitidas.filter(f => f.tipo !== 'boleta').reduce((s, f) => s + f.monto, 0)
  const totalBoletas = emitidas.filter(f => f.tipo === 'boleta').reduce((s, f) => s + f.monto, 0)

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16 }}>
        <StatTile label="Facturas emitidas" valor={fmtMoney(totalFacturas)} tono="neutral" />
        {totalBoletas > 0 && <StatTile label="Boletas emitidas" valor={fmtMoney(totalBoletas)} tono="neutral" />}
        <StatTile label="Documentos" valor={String(emitidas.length)} tono="neutral" />
      </div>

      <p style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 16 }}>
        Cada factura o boleta se carga desde la ficha de su cliente, en <strong>Clientes</strong> — ahí se sube
        el documento y la IA lee el monto y los datos fiscales. Acá se ven todas juntas.
      </p>

      {emitidas.length === 0 ? (
        <p style={{ color: 'var(--muted)', textAlign: 'center', padding: '2rem 0' }}>
          Todavía no hay ninguna factura ni boleta cargada.
        </p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {emitidas.map(f => (
            <div key={f.id} className="card" style={{ padding: 14, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <div style={{ minWidth: 0 }}>
                <p style={{ fontWeight: 700, fontSize: 14 }}>{f.cliente_nombre}</p>
                <p style={{ fontSize: 12, color: 'var(--muted)' }}>
                  <span className="badge badge-otro" style={{ fontSize: 11, marginRight: 6 }}>{f.tipo === 'boleta' ? 'Boleta' : 'Factura'}</span>
                  {new Date(f.fecha + 'T00:00:00').toLocaleDateString('es-CL', { timeZone: 'America/Santiago' })}
                </p>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexShrink: 0 }}>
                <p style={{ fontWeight: 700, fontSize: 15 }}>{fmtMoney(f.monto)}</p>
                {f.archivo_url && (
                  <a href={f.archivo_url} target="_blank" rel="noreferrer" style={{ color: 'var(--primary)', fontWeight: 600, fontSize: 13 }}>
                    Ver archivo →
                  </a>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {viejas.length > 0 && (
        <div style={{ marginTop: 26, paddingTop: 16, borderTop: '1px solid var(--border)' }}>
          <button className="btn btn-ghost" onClick={() => setVerViejas(v => !v)} style={{ fontSize: 12 }}>
            {verViejas ? 'Ocultar' : `Ver ${viejas.length} registro${viejas.length !== 1 ? 's' : ''} viejo${viejas.length !== 1 ? 's' : ''}`} del sistema anterior {verViejas ? '▲' : '▼'}
          </button>
          {verViejas && (
            <>
              <p style={{ fontSize: 12, color: 'var(--muted)', margin: '10px 0' }}>
                Cargados a mano antes de que existiera el circuito de facturas: solo tienen fecha, obra y monto,
                sin documento. Se dejan acá para no perder el dato; se pueden borrar cuando ya no sirvan.
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {viejas.map(f => (
                  <div key={f.id} style={{ background: 'var(--surface-alt)', color: 'var(--text)', borderRadius: 8, padding: '8px 12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap', fontSize: 13 }}>
                    <span>
                      <strong>{f.obra || 'Sin obra asignada'}</strong>
                      <span style={{ color: 'var(--muted)' }}> · {new Date(f.fecha + 'T00:00:00').toLocaleDateString('es-CL', { timeZone: 'America/Santiago' })}</span>
                    </span>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                      <strong>{fmtMoney(f.monto)}</strong>
                      <button onClick={() => borrarVieja(f.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 12, color: 'var(--danger)', fontWeight: 600, padding: 0 }}>
                        Borrar
                      </button>
                    </span>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}

// Para que Gustavo pueda descargar y compartir el presupuesto (ej. por WhatsApp) sin
// depender de que Alexandra se lo pase -- mismo generador que ya usa el presupuestador
// al crearlo, así el PDF descargado desde acá es idéntico al que se le mandó al cliente.
// Vive suelta (no dentro de PanelPresupuestos) porque también se usa desde el detalle de
// una obra, y el PDF tiene que salir igual desde los dos lados.
export function descargarPdfPresupuesto(d: PresupuestoDetalle) {
  if (d.tipo === 'etapas') {
    const client = { name: d.cliente_nombre || '', telefono: d.cliente_telefono || '', email: d.cliente_email || '', address: d.cliente_direccion || '' }
    generatePDFEtapas(client, d.etapas || [], { pct: d.gg_pct || 0, amount: d.gg_amount || 0 }, d.referencia || undefined)
  } else {
    // El RUT del cliente no se guarda en `presupuestos` (solo en la ficha de `clientes`) --
    // el PDF generado desde acá sale sin ese dato, igual que cualquier otro campo que no
    // se haya cargado al crear el presupuesto original.
    const client = { name: d.cliente_nombre || '', rut: '', email: d.cliente_email || '', address: d.cliente_direccion || '' }
    generatePDF(client, d.items || [], d.gg_pct ?? 10, d.referencia || undefined)
  }
}

// Pasa un presupuesto guardado a las líneas que muestra el PDF consolidado. Los "simple"
// guardan `items` y los "etapas" guardan `etapas` con otra forma; para el cliente son lo
// mismo, así que acá se unifican.
function lineasDelPresupuesto(d: PresupuestoDetalle): LineaConsolidado[] {
  const lineas: LineaConsolidado[] = []
  if (d.tipo === 'etapas') {
    for (const etapa of d.etapas || []) {
      for (const it of etapa.items) {
        lineas.push({
          descripcion: `${etapa.nombre} — ${it.descripcion}`,
          cantidad: it.cantidad,
          precioUnitario: it.precioUnitario,
          total: it.cantidad * it.precioUnitario,
          grupo: it.tipo === 'MAT' ? 'MATERIALES' : 'MANO DE OBRA',
        })
      }
    }
  } else {
    for (const it of d.items || []) {
      const cat = (it.categoria || '').toUpperCase()
      lineas.push({
        descripcion: it.description,
        cantidad: it.quantity,
        precioUnitario: it.price,
        total: it.price * it.quantity,
        grupo: cat === 'MATERIALES' ? 'MATERIALES' : cat === 'MANO DE OBRA' ? 'MANO DE OBRA' : 'OTROS',
      })
    }
  }
  // Los gastos generales son una línea más para el cliente: sin esto el desglose no suma
  // el neto y parece que falta algo.
  if (d.gg_amount) {
    lineas.push({
      descripcion: `Gastos generales${d.gg_pct ? ` (${d.gg_pct}%)` : ''}`,
      cantidad: 1,
      precioUnitario: d.gg_amount,
      total: d.gg_amount,
      grupo: 'OTROS',
    })
  }
  return lineas
}

// El PDF que faltaba para cobrar un adicional: original + adicionales = vigente, en un solo
// papel. Solo cuenta los adicionales que ya se sumaron a la obra ("convertido"), igual que
// la línea "Vigente" de la pantalla -- si contara los aceptados todavía sin sumar, el PDF
// le pediría al cliente plata que la obra no está cobrando.
export async function descargarPdfConsolidado(original: PresupuestoGuardado, sumados: PresupuestoGuardado[]) {
  const ids = [original.id, ...sumados.map(a => a.id)]
  const { data, error } = await supabase.from('presupuestos').select('*').in('id', ids)
  if (error || !data) {
    alert('No se pudieron leer los presupuestos para armar el PDF. Intenta de nuevo.')
    return
  }
  const porId = new Map((data as PresupuestoDetalle[]).map(d => [d.id, d]))
  const fechaCorta = (iso: string) => new Date(iso).toLocaleDateString('es-CL', { timeZone: 'America/Santiago' })

  const documentos: DocumentoConsolidado[] = ids.map((id, i) => {
    const d = porId.get(id)
    const base = i === 0 ? original : sumados[i - 1]
    const total = d?.total ?? base.total ?? 0
    const iva = d?.iva ?? null
    const lineas = d ? lineasDelPresupuesto(d) : []
    // Se muestra el desglose SOLO si cuadra con el total del documento. Los presupuestos
    // cargados como PDF externo guardan ítems netos que la IA leyó, y su total ya trae
    // gastos generales e IVA: listarlos como están le mandaría al cliente un detalle que
    // no suma. Antes que inventar la diferencia, se dice que el detalle está en el papel
    // original.
    const neto = iva != null ? total - iva : total
    const sumaLineas = lineas.reduce((s, l) => s + l.total, 0)
    const cuadra = lineas.length > 0 && Math.abs(sumaLineas - neto) <= 1
    return {
      titulo: i === 0 ? 'Presupuesto original' : `Adicional ${i}`,
      referencia: (d?.referencia ?? base.referencia) || null,
      fecha: fechaCorta(d?.created_at ?? base.created_at),
      total,
      iva: cuadra ? iva : null,
      lineas: cuadra ? lineas : [],
    }
  })

  generatePDFConsolidado({
    name: original.cliente_nombre || '',
    telefono: original.cliente_telefono || '',
    email: original.cliente_email || '',
    address: original.cliente_direccion || '',
  }, documentos)
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
  // Si se llena, el presupuesto externo que se sube es un ADICIONAL del que se elija.
  const [origenExterno, setOrigenExterno] = useState('')

  const cargar = useCallback(async () => {
    setPresupuestos(await traerPresupuestos())
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

  // Un adicional no se convierte en obra: la obra ya existe y es la del original. Sumarlo
  // significa subir el presupuesto de ESA obra, que es el número contra el que se calcula
  // lo que el cliente todavía debe.
  //
  // 09/09: antes esto no existía y el selector le ofrecía "Convertido en obra" a un
  // adicional igual que a cualquier presupuesto. Intentaba crear una obra NUEVA con la
  // dirección del cliente, chocaba contra `obras_nombre_key` (nombre único) y devolvía
  // "No se pudo crear la obra. Puede que ya exista una con ese nombre" -- sin decir que el
  // camino entero estaba mal. Si el nombre hubiera sido distinto, habría creado una obra
  // duplicada, que es peor.
  async function sumarAdicionalALaObra(p: PresupuestoGuardado) {
    if (!p.origen_id) return
    const { data: obra, error: errBuscar } = await supabase
      .from('obras')
      .select('id, nombre, presupuesto_total')
      .eq('presupuesto_id', p.origen_id)
      .maybeSingle()
    if (errBuscar) {
      alert('No se pudo buscar la obra de este adicional. Intenta de nuevo.')
      return
    }
    if (!obra) {
      alert('El presupuesto original de este adicional todavía no está convertido en obra, así que no hay a qué sumarlo.\n\nConvierte primero el original en obra y después vuelve acá.')
      return
    }
    const actual = obra.presupuesto_total || 0
    const monto = p.total || 0
    const nuevo = actual + monto
    const seguir = window.confirm(
      `Sumar este adicional de ${fmtMoney(monto)} a la obra "${obra.nombre}".\n\n` +
      `Presupuesto de la obra: ${fmtMoney(actual)} → ${fmtMoney(nuevo)}\n\n` +
      'Eso es lo que el cliente pasa a deber por esta obra. ¿Confirmas?'
    )
    if (!seguir) return

    const { error: errObra } = await supabase.from('obras').update({ presupuesto_total: nuevo }).eq('id', obra.id)
    if (errObra) {
      alert('No se pudo actualizar el presupuesto de la obra. No se cambió nada, intenta de nuevo.')
      return
    }

    // Los ítems del adicional también tienen que llegar a "Avance de obra": si no, la obra
    // sube de precio pero el trabajo nuevo no se puede marcar como hecho en ningún lado
    // (el adicional de Alexis subió la obra a $3.220.140 y sus 5 líneas -- picado, tuberías,
    // enchufes -- no existían en la obra). Van con la referencia como nombre de fase, así se
    // distingue lo presupuestado de entrada de lo que se agregó después.
    // Best-effort a propósito: la plata ya quedó bien, y si esto falla se puede cargar a
    // mano desde Avance. No vale la pena deshacer el cambio de presupuesto por esto.
    try {
      const { data: det } = await supabase
        .from('presupuestos').select('tipo, items, etapas').eq('id', p.id).single()
      const { data: ultimo } = await supabase
        .from('obra_items').select('orden').eq('obra_id', obra.id).order('orden', { ascending: false }).limit(1).maybeSingle()
      if (det) {
        await copiarItemsAObra(
          obra.id,
          det as { tipo: string; items: PresupuestoItemSimple[] | null; etapas: PresupuestoEtapa[] | null },
          { fase: `Adicional ${p.referencia || ''}`.trim(), ordenDesde: ((ultimo?.orden ?? -1) + 1) },
        )
      }
    } catch (e) {
      console.error('El adicional se sumó, pero sus ítems no se copiaron a Avance de obra:', e)
    }
    // El estado se escribe DESPUÉS de la obra a propósito: si fallara al revés, el adicional
    // quedaría marcado como sumado sin haberse sumado, y nadie se enteraría.
    const { error: errEstado } = await supabase.from('presupuestos').update({ estado: 'convertido' }).eq('id', p.id)
    if (errEstado) {
      alert(`La obra "${obra.nombre}" quedó en ${fmtMoney(nuevo)}, pero el adicional no se pudo marcar como sumado.\n\nNO lo vuelvas a sumar (se sumaría dos veces) — avísale a Alexandra.`)
      cargar()
      return
    }
    cargar()
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
      if (p.origen_id) {
        sumarAdicionalALaObra(p)
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
      cliente_id: p.cliente_id,
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
      // Vacío = presupuesto suelto, como fue siempre. Con valor, queda enganchado como
      // adicional del original y hereda todo el camino que ya existe.
      origen_id: origenExterno || null,
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
    setOrigenExterno('')
    cargar()
  }

  // Candidatos a "original" para el adicional que se está subiendo: los presupuestos de ese
  // mismo cliente que no son adicionales a su vez -- un adicional de un adicional no tiene
  // sentido y rompería el anidado de la ficha.
  const presupuestosDelClienteExterno = clienteExterno.trim()
    ? presupuestos.filter(p =>
        !p.origen_id &&
        (p.cliente_nombre || '').trim().toLowerCase() === clienteExterno.trim().toLowerCase()
      )
    : []

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

          {/* 09/09: Gustavo ya tiene adicionales hechos fuera de la app y quiere subirlos a
              sus obras. Hasta ahora este formulario siempre creaba un presupuesto suelto:
              el adicional quedaba como un documento más del cliente, sin colgar del
              original, sin la opción "Sumado a la obra" y sin que sus ítems llegaran a
              Avance. La única alternativa era retipearlo entero en "Crear adicionales". */}
          {presupuestosDelClienteExterno.length > 0 && (
            <div className="field" style={{ marginTop: 10, maxWidth: 420 }}>
              <label>¿Es un adicional de un presupuesto que ya existe?</label>
              <select value={origenExterno} onChange={e => setOrigenExterno(e.target.value)}>
                <option value="">No — es un presupuesto nuevo</option>
                {presupuestosDelClienteExterno.map(p => (
                  <option key={p.id} value={p.id}>
                    Adicional de {p.referencia || 'presupuesto'} · {new Date(p.created_at).toLocaleDateString('es-CL', { timeZone: 'America/Santiago' })} · {fmtMoney(p.total || 0)}
                  </option>
                ))}
              </select>
              <span style={{ fontSize: 11.5, color: 'var(--muted)' }}>
                Si lo enganchas, queda colgando de ese presupuesto y después se le puede poner “Sumado a la
                obra” para que suba el presupuesto de la obra y sus ítems lleguen a Avance.
              </span>
            </div>
          )}
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
                  <p style={{ fontWeight: 700, fontSize: 15 }}>
                    {p.cliente_nombre || 'Sin nombre'}
                    {p.origen_id && (
                      <span className="badge badge-otro" style={{ fontSize: 10, marginLeft: 8, verticalAlign: 'middle' }}>Adicional</span>
                    )}
                  </p>
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
                    // En un adicional "Convertido en obra" se lee mal: no crea ninguna obra,
                    // le suma plata a la que ya existe. Mismo estado en la base, nombre honesto.
                    <option key={k} value={k}>{k === 'convertido' && p.origen_id ? 'Sumado a la obra' : label}</option>
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
            style={{ background: 'var(--white)', color: 'var(--text)', borderRadius: 'var(--radius)', maxWidth: 640, width: '100%', maxHeight: '85vh', overflowY: 'auto', padding: '1.5rem' }}
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
                  <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexShrink: 0 }}>
                    {detalle.tipo !== 'externo' && (
                      <button className="btn btn-primary" onClick={() => descargarPdfPresupuesto(detalle)} style={{ fontSize: 12, padding: '6px 12px' }}>
                        Descargar PDF
                      </button>
                    )}
                    <button onClick={() => { setDetalleId(null); setDetalle(null) }} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 20, color: 'var(--muted)' }}>✕</button>
                  </div>
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
                      // 09/09: acá había una copia propia de la lógica del selector de la
                      // lista, que llamaba directo a abrirConvertir. Con eso un ADICIONAL
                      // abierto por "Detalle" se seguía yendo a crear una obra nueva, saltándose
                      // el camino de sumarlo a la obra del original. Ahora las dos pantallas
                      // pasan por la misma función y no pueden volver a separarse.
                      const nuevo = e.target.value as EstadoPresupuesto
                      // Solo se cierra si el cambio va a proceder de verdad: si falta marcarlo
                      // "Aceptado" primero, seleccionarEstado avisa y no hace nada, y cerrar el
                      // modal ahí dejaría el aviso sin la pantalla a la que se refiere.
                      if (nuevo === 'convertido' && detalle.estado === 'aceptado') setDetalleId(null)
                      seleccionarEstado(detalle, nuevo)
                    }}
                    style={{ fontSize: 13, padding: '5px 10px', width: 'auto' }}
                  >
                    {(Object.entries(ESTADO_PRESUPUESTO_LABELS) as [EstadoPresupuesto, string][]).map(([k, label]) => (
                      <option key={k} value={k}>{k === 'convertido' && detalle.origen_id ? 'Sumado a la obra' : label}</option>
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
// Quiénes pueden ocupar una hora. Los trabajadores salen de la base, no de una lista escrita
// acá: la que había se quedó con Alejandro (archivado) y sin Yasmani.
const PERSONAS_FIJAS_CALENDARIO = ['Gustavo', 'Alexandra']
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
  const [trabajadores, setTrabajadores] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [mostrarForm, setMostrarForm] = useState(false)
  const [vista, setVista] = useState<'dia' | 'semana' | 'mes'>('semana')
  const [fechaAncla, setFechaAncla] = useState(hoyISO())
  const [form, setForm] = useState(emptyEvento(hoyISO()))
  const [guardando, setGuardando] = useState(false)

  useEffect(() => {
    supabase.from('trabajadores').select('nombre').eq('activo', true).order('nombre').then(({ data }) => {
      setTrabajadores(((data as { nombre: string }[]) || []).map(t => t.nombre))
    })
  }, [])
  const personas = [...PERSONAS_FIJAS_CALENDARIO, ...trabajadores]

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
                {personas.map(p => <option key={p} value={p}>{p}</option>)}
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
  const [obras, setObras] = useState<Obra[]>([])
  const [trabajadores, setTrabajadores] = useState<Trabajador[]>([])
  const [subcontratistas, setSubcontratistas] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [busqueda, setBusqueda] = useState('')
  const [hoy] = useState(() => new Date().toISOString().slice(0, 10))

  // Inventario manual. Gustavo ya tiene materiales en la bodega de antes de que existiera
  // esto, y sin facturas ordenadas para reconstruirlo: si el catálogo solo se pudiera
  // llenar desde compras nuevas, el sistema arrancaría vacío y mostraría faltantes falsos.
  const [mostrarAlta, setMostrarAlta] = useState(false)
  const [alta, setAlta] = useState({ nombre: '', unidad: '', cantidad: '', precio_unitario: '' })
  const [guardandoAlta, setGuardandoAlta] = useState(false)

  // Vale de entrega: material que sale de bodega a una obra, en manos de alguien.
  const [mostrarVale, setMostrarVale] = useState(false)
  const [vale, setVale] = useState<{ obra: string; receptor: string; fecha: string; lineas: { materialId: string; cantidad: string }[] }>(
    { obra: '', receptor: '', fecha: '', lineas: [{ materialId: '', cantidad: '' }] }
  )
  const [guardandoVale, setGuardandoVale] = useState(false)

  const cargar = useCallback(async () => {
    const [{ data: mats }, { data: movs }, { data: obs }, { data: trab }, { data: subs }] = await Promise.all([
      supabase.from('materiales').select('*').order('nombre'),
      supabase.from('movimientos_stock').select('*').order('created_at', { ascending: false }).limit(30),
      supabase.from('obras').select('*').eq('activa', true).order('nombre'),
      supabase.from('trabajadores').select('*'),
      supabase.from('subcontratos_master').select('subcontratista'),
    ])
    setMateriales((mats as Material[]) || [])
    setMovimientos((movs as MovimientoStock[]) || [])
    setObras((obs as Obra[]) || [])
    setTrabajadores((trab as Trabajador[]) || [])
    setSubcontratistas(Array.from(new Set(((subs as { subcontratista: string }[]) || []).map(s => s.subcontratista))))
    setLoading(false)
  }, [])

  useEffect(() => { cargar() }, [cargar])

  async function guardarAlta() {
    const cantidad = Number(alta.cantidad)
    const precio = Number(alta.precio_unitario)
    if (!alta.nombre.trim()) { alert('Ponle nombre al material.'); return }
    if (!Number.isFinite(cantidad) || cantidad <= 0) { alert('La cantidad tiene que ser un número mayor a cero.'); return }
    if (!Number.isFinite(precio) || precio <= 0) { alert('El precio unitario tiene que ser un número mayor a cero — sin él no se puede cargarle el costo a ninguna obra cuando se entregue.'); return }
    setGuardandoAlta(true)
    try {
      const { data: material, error: eMat } = await supabase
        .from('materiales')
        .upsert({ nombre: alta.nombre.trim(), unidad: alta.unidad.trim() || null, precio_unitario: precio }, { onConflict: 'nombre' })
        .select('id')
        .single()
      if (eMat || !material) {
        alert('No se pudo guardar el material. Puede que falte correr la migración sql/20260909_stock_vales_de_entrega.sql — avísale a Alexandra.')
        return
      }
      // El trigger de la base ajusta `stock_actual`; acá solo se crea el movimiento.
      const { error: eMov } = await supabase.from('movimientos_stock').insert({
        material_id: material.id, tipo: 'entrada', cantidad, fecha: hoy,
        precio_unitario: precio, nota: 'Inventario cargado a mano',
      })
      if (eMov) { alert('El material quedó en el catálogo pero no se pudo registrar la entrada. Intenta de nuevo.'); return }
      setAlta({ nombre: '', unidad: '', cantidad: '', precio_unitario: '' })
      setMostrarAlta(false)
      await cargar()
    } finally { setGuardandoAlta(false) }
  }

  async function guardarVale() {
    const lineas = vale.lineas.filter(l => l.materialId && Number(l.cantidad) > 0)
    if (!vale.obra) { alert('Elige a qué obra va el material.'); return }
    if (!vale.receptor.trim()) { alert('Pon quién se lleva el material — el vale es justamente para eso.'); return }
    if (lineas.length === 0) { alert('Agrega al menos un material con su cantidad.'); return }
    const sinStock = lineas.filter(l => {
      const m = materiales.find(x => x.id === l.materialId)
      return m && Number(l.cantidad) > m.stock_actual
    })
    if (sinStock.length > 0) {
      const detalle = sinStock.map(l => {
        const m = materiales.find(x => x.id === l.materialId)
        return `${m?.nombre}: se entregan ${l.cantidad} y en bodega hay ${m?.stock_actual}`
      }).join('\n')
      if (!window.confirm(`Estás entregando más de lo que dice el stock:\n\n${detalle}\n\nPuede ser que el inventario esté desactualizado. ¿Registrar el vale igual?`)) return
    }
    setGuardandoVale(true)
    try {
      const filas = lineas.map(l => {
        const m = materiales.find(x => x.id === l.materialId)
        return {
          material_id: l.materialId,
          tipo: 'salida',
          cantidad: Number(l.cantidad),
          fecha: vale.fecha || hoy,
          obra: vale.obra,
          receptor: vale.receptor.trim(),
          // Precio congelado al momento de salir: el costo de una obra ya cerrada no se
          // reescribe cuando mañana se compre el mismo material más caro. Va NETO, tal cual
          // el catálogo -- el IVA de la compra se recupera con la factura, así que sumarlo
          // acá inventaría un costo que la obra no tuvo (revertido el 11/09).
          precio_unitario: m?.precio_unitario ?? null,
        }
      })
      const { error } = await supabase.from('movimientos_stock').insert(filas)
      if (error) {
        alert('No se pudo registrar el vale. Puede que falte correr la migración sql/20260909_stock_vales_de_entrega.sql — avísale a Alexandra.')
        return
      }
      const sinPrecio = filas.filter(f => !f.precio_unitario).length
      if (sinPrecio > 0) {
        alert(`El vale quedó registrado, pero ${sinPrecio} material(es) no tienen precio cargado, así que esa parte no le suma costo a la obra. Ponles precio en el catálogo para que el margen sea real.`)
      }
      setVale({ obra: '', receptor: '', fecha: '', lineas: [{ materialId: '', cantidad: '' }] })
      setMostrarVale(false)
      await cargar()
    } finally { setGuardandoVale(false) }
  }

  const materialesFiltrados = materiales.filter(m =>
    !busqueda.trim() || m.nombre.toLowerCase().includes(busqueda.trim().toLowerCase())
  )
  const materialPorId = new Map(materiales.map(m => [m.id, m]))
  const valorBodega = materiales.reduce((s, m) => s + m.stock_actual * (m.precio_unitario || 0), 0)
  const sinPrecio = materiales.filter(m => !m.precio_unitario && m.stock_actual > 0)
  const receptoresSugeridos = Array.from(new Set([...subcontratistas, ...trabajadores.filter(t => t.activo).map(t => t.nombre)]))

  if (loading) return <div className="spinner" />

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 14 }}>
        <button className="btn btn-primary" onClick={() => { setMostrarAlta(x => !x); setMostrarVale(false) }} style={{ fontSize: 13 }}>
          {mostrarAlta ? 'Cancelar' : '+ Cargar material a mano'}
        </button>
        <button className="btn btn-secondary" onClick={() => { setMostrarVale(x => !x); setMostrarAlta(false) }} disabled={materiales.length === 0} style={{ fontSize: 13 }}>
          {mostrarVale ? 'Cancelar' : 'Entregar material a una obra'}
        </button>
      </div>

      {mostrarAlta && (
        <div className="card" style={{ padding: 16, marginBottom: 16 }}>
          <p style={{ fontSize: 13, fontWeight: 700, marginBottom: 4 }}>Cargar material que ya está en bodega</p>
          <p style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 10, lineHeight: 1.45 }}>
            Para lo que ya hay en la bodega de antes, sin boleta que lo respalde. Si el material se compró
            ahora, conviene cargarlo desde el Reporte Diario marcando la compra como “Stock”: así queda
            enganchado a su boleta.
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div className="field">
              <label>Material</label>
              <input value={alta.nombre} onChange={e => setAlta(p => ({ ...p, nombre: e.target.value }))} placeholder="Ej: Cable 2,5mm rojo" />
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <div className="field" style={{ flex: 1, minWidth: 110 }}>
                <label>Unidad</label>
                <input value={alta.unidad} onChange={e => setAlta(p => ({ ...p, unidad: e.target.value }))} placeholder="metros, unidades..." />
              </div>
              <div className="field" style={{ flex: 1, minWidth: 110 }}>
                <label>Cantidad en bodega</label>
                <input type="number" min="0" value={alta.cantidad} onChange={e => setAlta(p => ({ ...p, cantidad: e.target.value }))} />
              </div>
              <div className="field" style={{ flex: 1, minWidth: 130 }}>
                {/* Tiene que decir "sin IVA": este precio es el costo con el que el material
                    entra a la obra, y los costos van netos. Cargar acá un precio con IVA
                    haría ver la obra más cara de lo que fue. */}
                <label>Precio por unidad (sin IVA)</label>
                <input type="number" min="0" value={alta.precio_unitario} onChange={e => setAlta(p => ({ ...p, precio_unitario: e.target.value }))} />
              </div>
            </div>
            <button className="btn btn-primary" onClick={guardarAlta} disabled={guardandoAlta} style={{ fontSize: 13 }}>
              {guardandoAlta ? 'Guardando...' : 'Cargar al inventario'}
            </button>
          </div>
        </div>
      )}

      {mostrarVale && (
        <div className="card" style={{ padding: 16, marginBottom: 16 }}>
          <p style={{ fontSize: 13, fontWeight: 700, marginBottom: 4 }}>Vale de entrega</p>
          <p style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 10, lineHeight: 1.45 }}>
            Lo que sale de la bodega hacia una obra, y en manos de quién. Recién en este momento el material
            se convierte en costo de esa obra — al comprarlo todavía no se sabía a cuál iba. Se valoriza sin
            IVA, igual que las compras directas: ese IVA se recupera con la factura, así que no es costo.
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <div className="field" style={{ flex: 1, minWidth: 190 }}>
                <label>¿A qué obra va?</label>
                <select value={vale.obra} onChange={e => setVale(p => ({ ...p, obra: e.target.value }))}>
                  <option value="">Elegir obra...</option>
                  {obras.map(o => <option key={o.id} value={o.nombre}>{o.nombre}</option>)}
                </select>
              </div>
              <div className="field" style={{ flex: 1, minWidth: 160 }}>
                <label>¿Quién se lo lleva?</label>
                <input list="receptores-stock" value={vale.receptor} onChange={e => setVale(p => ({ ...p, receptor: e.target.value }))} placeholder="Ej: Cristian" />
                <datalist id="receptores-stock">
                  {receptoresSugeridos.map(r => <option key={r} value={r} />)}
                </datalist>
              </div>
              <div className="field" style={{ minWidth: 140 }}>
                <label>Fecha</label>
                <input type="date" value={vale.fecha || hoy} onChange={e => setVale(p => ({ ...p, fecha: e.target.value }))} />
              </div>
            </div>

            {vale.lineas.map((l, i) => {
              const m = materiales.find(x => x.id === l.materialId)
              const subtotal = m && Number(l.cantidad) > 0 ? Number(l.cantidad) * (m.precio_unitario || 0) : 0
              return (
                <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' }}>
                  <div className="field" style={{ flex: 1, minWidth: 180 }}>
                    <label>Material</label>
                    <select value={l.materialId} onChange={e => setVale(p => ({ ...p, lineas: p.lineas.map((x, j) => j === i ? { ...x, materialId: e.target.value } : x) }))}>
                      <option value="">Elegir...</option>
                      {materiales.map(mat => (
                        <option key={mat.id} value={mat.id}>
                          {mat.nombre} (hay {mat.stock_actual}{mat.unidad ? ' ' + mat.unidad : ''})
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="field" style={{ width: 110 }}>
                    <label>Cantidad</label>
                    <input type="number" min="0" value={l.cantidad} onChange={e => setVale(p => ({ ...p, lineas: p.lineas.map((x, j) => j === i ? { ...x, cantidad: e.target.value } : x) }))} />
                  </div>
                  <span style={{ fontSize: 12, color: subtotal > 0 ? 'var(--text)' : 'var(--muted)', paddingBottom: 8, minWidth: 150 }}>
                    {subtotal > 0
                      ? <><strong>{fmtMoney(subtotal)}</strong> <span style={{ color: 'var(--muted)' }}>sin IVA</span></>
                      : m && !m.precio_unitario ? 'sin precio' : ''}
                  </span>
                  {vale.lineas.length > 1 && (
                    <button type="button" onClick={() => setVale(p => ({ ...p, lineas: p.lineas.filter((_, j) => j !== i) }))} style={{ background: 'none', border: 'none', color: 'var(--danger)', cursor: 'pointer', fontSize: 13, paddingBottom: 8 }}>Quitar</button>
                  )}
                </div>
              )
            })}
            <button type="button" className="btn btn-ghost" onClick={() => setVale(p => ({ ...p, lineas: [...p.lineas, { materialId: '', cantidad: '' }] }))} style={{ fontSize: 12, alignSelf: 'flex-start' }}>
              + Otro material
            </button>
            <button className="btn btn-primary" onClick={guardarVale} disabled={guardandoVale} style={{ fontSize: 13 }}>
              {guardandoVale ? 'Registrando...' : 'Registrar entrega'}
            </button>
          </div>
        </div>
      )}

      <div className="field" style={{ maxWidth: 320, marginBottom: 18 }}>
        <label>Buscar material</label>
        <input value={busqueda} onChange={e => setBusqueda(e.target.value)} placeholder="Nombre del material..." />
      </div>

      {materiales.length === 0 ? (
        <p style={{ color: 'var(--muted)', textAlign: 'center', padding: '2rem 0' }}>
          Todavía no hay materiales en bodega. Se cargan de dos formas: marcando una compra como “Stock” en el
          Reporte Diario, o con “+ Cargar material a mano” para lo que ya estaba ahí de antes.
        </p>
      ) : (
        <>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 14 }}>
            <StatTile label="Valor en bodega (sin IVA)" valor={fmtMoney(valorBodega)} />
            {sinPrecio.length > 0 && (
              <StatTile label="Sin precio cargado" valor={`${sinPrecio.length} material${sinPrecio.length !== 1 ? 'es' : ''}`} tono="alerta" />
            )}
          </div>
          {sinPrecio.length > 0 && (
            <p style={{ fontSize: 12, color: 'var(--primary)', fontWeight: 600, marginBottom: 14, lineHeight: 1.45 }}>
              Hay material sin precio en el catálogo ({sinPrecio.map(m => m.nombre).join(', ')}). Cuando se entregue
              a una obra, esa parte no le va a sumar costo y el margen de esa obra va a salir más alto de lo real.
            </p>
          )}

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 24 }}>
            {materialesFiltrados.map(m => (
              <StatTile
                key={m.id}
                label={m.nombre}
                valor={`${m.stock_actual}${m.unidad ? ' ' + m.unidad : ''}${m.precio_unitario ? ` · ${fmtMoney(m.stock_actual * m.precio_unitario)}` : ''}`}
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
                    {mov.tipo === 'entrada'
                      ? (mov.nota ? ` — ${mov.nota.toLowerCase()}` : ' — entró al stock')
                      : mov.obra
                        ? ` — a ${mov.obra}${mov.receptor ? `, se lo llevó ${mov.receptor}` : ''}`
                        : ' — salió del stock'}
                  </span>
                  {mov.precio_unitario ? (
                    <span style={{ fontSize: 12, color: 'var(--muted)' }}>{fmtMoney(mov.cantidad * mov.precio_unitario)}</span>
                  ) : null}
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
  const [facturasCliente, setFacturasCliente] = useState<ClienteFactura[]>([])
  const [presupuestosCliente, setPresupuestosCliente] = useState<PresupuestoGuardado[]>([])
  const [obrasCliente, setObrasCliente] = useState<Obra[]>([])
  const [cuentasCliente, setCuentasCliente] = useState<CuentaPorCobrar[]>([])
  const [abonosCliente, setAbonosCliente] = useState<AbonoCuenta[]>([])
  const [cuentaAbierta, setCuentaAbierta] = useState<string | null>(null)
  const [convirtiendoPresId, setConvirtiendoPresId] = useState<string | null>(null)
  const [nombreObraCliente, setNombreObraCliente] = useState('')
  const [convirtiendoCliente, setConvirtiendoCliente] = useState(false)
  const [draft, setDraft] = useState<DraftCliente>({ rut: '', razon_social: '', giro: '', direccion_fiscal: '', origen: '', notas: '' })
  const [guardando, setGuardando] = useState(false)
  const [mostrarNuevoCliente, setMostrarNuevoCliente] = useState(false)
  const [nuevoClienteNombre, setNuevoClienteNombre] = useState('')
  const [guardandoNuevoCliente, setGuardandoNuevoCliente] = useState(false)

  const cargar = useCallback(async () => {
    setLoading(true)
    const { data } = await supabase.from('clientes').select('*').eq('archivado', verArchivados).order('nombre')
    setClientes((data as Cliente[]) || [])
    setLoading(false)
  }, [verArchivados])

  useEffect(() => { cargar() }, [cargar])

  // Hasta ahora `clientes` solo se llenaba con un backfill único desde
  // `pendientes.cliente_nombre` (sql/20260826_clientes_backfill_desde_pendientes.sql) --
  // no existía ninguna forma de crear un cliente nuevo directo, así que para cargar
  // los datos de facturación de alguien que todavía no generó ningún pendiente/
  // presupuesto no había por dónde entrar. Esto crea la fila mínima (solo nombre) y
  // abre directo su ficha para cargar el resto.
  async function agregarCliente() {
    if (!nuevoClienteNombre.trim()) { alert('Completa el nombre del cliente.'); return }
    setGuardandoNuevoCliente(true)
    const { data, error } = await supabase.from('clientes').insert({ nombre: nuevoClienteNombre.trim() }).select().single()
    setGuardandoNuevoCliente(false)
    if (error) { alert('No se pudo agregar. Puede que ya exista un cliente con ese nombre.'); return }
    setNuevoClienteNombre(''); setMostrarNuevoCliente(false)
    await cargar()
    verCliente(data as Cliente)
  }

  async function verCliente(c: Cliente) {
    setSeleccionado(c)
    setDraft(draftDeCliente(c))
    setLoadingH(true)
    const [{ data }, { data: fac }, pres, { data: obr }, { data: cuentas }] = await Promise.all([
      supabase.from('pendientes').select('*').eq('cliente_nombre', c.nombre).order('created_at', { ascending: true }),
      supabase.from('cliente_facturas').select('*').eq('cliente_nombre', c.nombre).order('fecha', { ascending: false }),
      traerPresupuestos(c.id),
      supabase.from('obras').select('*').eq('cliente_id', c.id).order('created_at', { ascending: false }),
      supabase.from('cuentas_por_cobrar').select('*').eq('cliente_id', c.id).order('created_at', { ascending: false }),
    ])
    setHistorial((data as Pendiente[]) || [])
    setFacturasCliente((fac as ClienteFactura[]) || [])
    setPresupuestosCliente(pres)
    setObrasCliente((obr as Obra[]) || [])
    const cuentasList = (cuentas as CuentaPorCobrar[]) || []
    setCuentasCliente(cuentasList)
    if (cuentasList.length > 0) {
      const { data: abonos } = await supabase.from('abonos_cuenta').select('*').in('cuenta_id', cuentasList.map(cu => cu.id))
      setAbonosCliente((abonos as AbonoCuenta[]) || [])
    } else {
      setAbonosCliente([])
    }
    setLoadingH(false)
  }

  // "Desde el cliente se pueda convertir en obra" -- pedido de Alexandra el 03/09/2026,
  // para que un presupuesto aceptado no obligue a ir a "Mis presupuestos" a convertirlo.
  // Mismo mecanismo que ya usa esa pestaña (`copiarItemsAObra`, importado/exportado
  // como función compartida), solo que acá parte de la ficha del cliente.
  function abrirConvertirCliente(p: PresupuestoGuardado) {
    setConvirtiendoPresId(p.id)
    setNombreObraCliente(p.cliente_direccion || p.cliente_nombre || '')
  }

  async function confirmarConvertirCliente(p: PresupuestoGuardado) {
    if (!nombreObraCliente.trim()) { alert('Completa el nombre de la obra.'); return }
    setConvirtiendoCliente(true)
    const { data: obraCreada, error: errorObra } = await supabase.from('obras').insert({
      nombre: nombreObraCliente.trim(),
      cliente: p.cliente_nombre,
      cliente_id: p.cliente_id,
      presupuesto_total: p.total,
      presupuesto_id: p.id,
    }).select('id').single()
    if (errorObra) {
      setConvirtiendoCliente(false)
      alert('No se pudo crear la obra. Puede que ya exista una con ese nombre.')
      return
    }
    if (obraCreada?.id) {
      const { data: detalleCompleto } = await supabase.from('presupuestos').select('tipo, items, etapas').eq('id', p.id).single()
      if (detalleCompleto) await copiarItemsAObra(obraCreada.id, detalleCompleto as { tipo: string; items: PresupuestoItemSimple[] | null; etapas: PresupuestoEtapa[] | null })
    }
    await supabase.from('presupuestos').update({ estado: 'convertido' }).eq('id', p.id)
    setConvirtiendoCliente(false)
    setConvirtiendoPresId(null)
    if (seleccionado) verCliente(seleccionado)
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

  // Ninguna otra tabla tiene FK real a clientes.id -- obras/cuentas_por_cobrar/pendientes
  // guardan el nombre del cliente como texto, no por referencia. Borrar la fila de
  // `clientes` no borra ningún historial, solo saca el cliente de esta lista (mismo
  // principio ya usado en borrarObra).
  async function borrarCliente(c: Cliente) {
    if (!window.confirm(`¿Borrar a "${c.nombre}" de Clientes? Su historial de pendientes/obras (si tiene) NO se borra, solo deja de aparecer acá. No se puede deshacer.`)) return
    const { error } = await supabase.from('clientes').delete().eq('id', c.id)
    if (error) {
      alert('No se pudo borrar: ' + error.message)
      return
    }
    setSeleccionado(null)
    cargar()
  }

  if (seleccionado) {
    return (
      <div>
        <button
          onClick={() => setSeleccionado(null)}
          /* Va directo sobre --bg (#10182C), no dentro de una card: con --secondary (#14213D)
             quedaba azul oscuro sobre azul oscuro, invisible. styles.css ya lo dice -- lo que
             queda sobre --bg usa las variables *-inverse. */
          style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'none', border: 'none', cursor: 'pointer', fontSize: 14, fontWeight: 600, color: 'var(--text-inverse)', marginBottom: 16, padding: 0 }}
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
            <button
              className="btn btn-ghost"
              style={{ fontSize: 12, padding: '6px 12px', color: 'var(--danger)' }}
              onClick={() => borrarCliente(seleccionado)}
              title="Borrar esta ficha de cliente (no se puede deshacer)"
            >
              Borrar
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
            Presupuestos
          </p>
          {presupuestosCliente.length === 0 ? (
            <p style={{ color: 'var(--muted)', fontSize: 13 }}>Todavía no tiene ningún presupuesto.</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {/* Los adicionales no se listan sueltos: se muestran anidados bajo el
                  presupuesto del que nacieron, que es lo que deja ver original + adicionales
                  = vigente de un vistazo. */}
              {presupuestosCliente.filter(p => !p.origen_id).map(p => (
                <div key={p.id} style={{ background: 'var(--surface-alt)', borderRadius: 8, padding: '8px 12px', fontSize: 13 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                    <span style={{ color: 'var(--muted)', fontSize: 12 }}>{new Date(p.created_at).toLocaleDateString('es-CL', { timeZone: 'America/Santiago' })}</span>
                    {p.referencia && <span style={{ fontWeight: 600 }}>{p.referencia}</span>}
                    <span className="badge badge-otro" style={{ fontSize: 11 }}>{ESTADO_PRESUPUESTO_LABELS[p.estado]}</span>
                    {(() => {
                      // Idea de Gustavo (08/09): que se vea qué presupuesto ya está facturado.
                      const suyas = facturasCliente.filter(f => f.presupuesto_id === p.id)
                      if (suyas.length === 0) return null
                      const total = suyas.reduce((s, f) => s + f.monto, 0)
                      return (
                        <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--success)' }}>
                          Facturado {fmtMoney(total)}
                        </span>
                      )
                    })()}
                    <span style={{ fontWeight: 700, marginLeft: 'auto' }}>{p.total != null ? fmtMoney(p.total) : '—'}</span>
                    {p.estado === 'aceptado' && (
                      <button className="btn btn-primary" style={{ fontSize: 12, padding: '5px 10px' }} onClick={() => abrirConvertirCliente(p)}>
                        Convertir en obra
                      </button>
                    )}
                  </div>
                  <PresupuestoDeLaFicha presupuesto={p} adicionales={presupuestosCliente.filter(x => x.origen_id === p.id)} />
                  {convirtiendoPresId === p.id && (
                    <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap', marginTop: 10, paddingTop: 10, borderTop: '1px solid var(--border)' }}>
                      <div className="field" style={{ flex: 1, minWidth: 180 }}>
                        <label>Nombre de la obra</label>
                        <input value={nombreObraCliente} onChange={e => setNombreObraCliente(e.target.value)} />
                      </div>
                      <button className="btn btn-primary" disabled={convirtiendoCliente} onClick={() => confirmarConvertirCliente(p)} style={{ fontSize: 12, padding: '7px 12px' }}>
                        {convirtiendoCliente ? 'Creando...' : 'Confirmar'}
                      </button>
                      <button className="btn btn-secondary" onClick={() => setConvirtiendoPresId(null)} style={{ fontSize: 12, padding: '7px 12px' }}>
                        Cancelar
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="card" style={{ padding: '14px 16px', marginBottom: 14 }}>
          <p style={{ fontSize: 12, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 10 }}>
            Obra{obrasCliente.length !== 1 ? 's' : ''}
          </p>
          {obrasCliente.length === 0 ? (
            <p style={{ color: 'var(--muted)', fontSize: 13 }}>Todavía no tiene ninguna obra.</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {obrasCliente.map(o => {
                // Mismo criterio que la pestaña Obras: si la obra tiene cuentas por cobrar,
                // el presupuesto real es la SUMA de esas cuentas, no el campo suelto de la
                // obra -- ese queda desactualizado cuando aparecen adicionales (Luis Carrera
                // mostraba $2.722.500 acá y $4.831.150 en Obras). Ver decisiones.md 2026-09-07.
                const cuentasDeLaObra = cuentasCliente.filter(c => c.obra === o.nombre && c.activa)
                const total = cuentasDeLaObra.length > 0
                  ? cuentasDeLaObra.reduce((s, c) => s + c.total_presupuesto, 0)
                  : o.presupuesto_total
                return (
                  <div key={o.id} style={{ display: 'flex', alignItems: 'center', gap: 10, background: 'var(--surface-alt)', borderRadius: 8, padding: '8px 12px', fontSize: 13, flexWrap: 'wrap' }}>
                    <span style={{ fontWeight: 600 }}>{o.nombre}</span>
                    <span className="badge badge-otro" style={{ fontSize: 11 }}>{ESTADO_OBRA_LABELS[o.estado_obra]}</span>
                    {cuentasDeLaObra.length > 1 && (
                      <span style={{ fontSize: 11, color: 'var(--muted)' }}>
                        presupuesto original + {cuentasDeLaObra.length - 1} adicional{cuentasDeLaObra.length - 1 !== 1 ? 'es' : ''}
                      </span>
                    )}
                    <span style={{ fontWeight: 700, marginLeft: 'auto' }}>{total != null ? fmtMoney(total) : '—'}</span>
                    {/* Lo intentaron desde acá en la conversación 3 y no se podía: el botón
                        solo estaba en Obras y en Avance de obra. */}
                    {!o.presupuesto_id && (
                      <CargarPresupuestoObra
                        obra={{ id: o.id, nombre: o.nombre, cliente: o.cliente }}
                        onGuardado={() => seleccionado && verCliente(seleccionado)}
                      />
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>

        <div className="card" style={{ padding: '14px 16px', marginBottom: 14 }}>
          <p style={{ fontSize: 12, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 10 }}>
            Cuentas por cobrar
          </p>
          {cuentasCliente.length === 0 ? (
            <p style={{ color: 'var(--muted)', fontSize: 13 }}>Todavía no tiene ninguna cuenta por cobrar.</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {cuentasCliente.map(cu => {
                const abonosDeLaCuenta = abonosCliente
                  .filter(a => a.cuenta_id === cu.id)
                  .slice()
                  .sort((a, b) => b.fecha.localeCompare(a.fecha))
                const abonado = abonosDeLaCuenta.reduce((s, a) => s + a.monto, 0)
                const restante = cu.total_presupuesto - abonado
                const desplegada = cuentaAbierta === cu.id
                return (
                  <div key={cu.id} style={{ background: 'var(--surface-alt)', borderRadius: 8, padding: '8px 12px', fontSize: 13 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 4 }}>
                      <span style={{ fontWeight: 600 }}>{cu.concepto}</span>
                      {cu.obra && <span style={{ color: 'var(--muted)', fontSize: 12 }}>{cu.obra}</span>}
                      {abonosDeLaCuenta.length > 0 && (
                        <button
                          className="btn btn-ghost"
                          onClick={() => setCuentaAbierta(desplegada ? null : cu.id)}
                          style={{ fontSize: 12, marginLeft: 'auto' }}
                        >
                          {desplegada ? 'Ocultar abonos ▲' : `Ver ${abonosDeLaCuenta.length} abono${abonosDeLaCuenta.length !== 1 ? 's' : ''} ▼`}
                        </button>
                      )}
                    </div>
                    <div style={{ display: 'flex', gap: 14, fontSize: 12 }}>
                      <span>Presupuesto: <strong>{fmtMoney(cu.total_presupuesto)}</strong></span>
                      <span style={{ color: 'var(--success)' }}>Abonado: <strong>{fmtMoney(abonado)}</strong></span>
                      <span style={{ color: restante > 0 ? 'var(--danger)' : 'var(--success)' }}>Resta: <strong>{fmtMoney(restante)}</strong></span>
                    </div>
                    {desplegada && (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 8, paddingTop: 8, borderTop: '1px solid var(--border)' }}>
                        {abonosDeLaCuenta.map(a => (
                          <div key={a.id} style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 12 }}>
                            <span style={{ color: 'var(--muted)', width: 78, flexShrink: 0 }}>{a.fecha.split('-').reverse().join('/')}</span>
                            <span style={{ fontWeight: 600 }}>{fmtMoney(a.monto)}</span>
                            {a.comprobante_url && (
                              <a href={a.comprobante_url} target="_blank" rel="noreferrer" style={{ color: 'var(--primary)', fontWeight: 600, marginLeft: 'auto' }}>
                                Ver comprobante →
                              </a>
                            )}
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

        <div className="card" style={{ padding: '14px 16px', marginBottom: 14 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, marginBottom: 10, flexWrap: 'wrap' }}>
            <p style={{ fontSize: 12, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
              Facturas y boletas emitidas
            </p>
            <SubirFacturaCliente cliente={seleccionado} presupuestos={presupuestosCliente} onGuardado={() => verCliente(seleccionado)} />
          </div>
          {facturasCliente.length === 0 ? (
            <p style={{ color: 'var(--muted)', fontSize: 13 }}>Todavía no hay facturas ni boletas registradas para este cliente.</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {facturasCliente.map(f => (
                <div key={f.id} style={{ display: 'flex', alignItems: 'center', gap: 10, background: 'var(--surface-alt)', borderRadius: 8, padding: '8px 12px', fontSize: 13, flexWrap: 'wrap' }}>
                  <span className="badge badge-otro" style={{ fontSize: 11 }}>{f.tipo === 'boleta' ? 'Boleta' : 'Factura'}</span>
                  <span style={{ color: 'var(--muted)' }}>{new Date(f.fecha + 'T00:00:00').toLocaleDateString('es-CL', { timeZone: 'America/Santiago' })}</span>
                  <span style={{ fontWeight: 700 }}>{fmtMoney(f.monto)}</span>
                  {f.presupuesto_id && (
                    <span style={{ fontSize: 12, color: 'var(--muted)' }}>
                      por {presupuestosCliente.find(p => p.id === f.presupuesto_id)?.referencia || 'un presupuesto'}
                    </span>
                  )}
                  {f.archivo_url && (
                    <a href={f.archivo_url} target="_blank" rel="noreferrer" style={{ color: 'var(--primary)', fontWeight: 600, marginLeft: 'auto' }}>
                      Ver archivo →
                    </a>
                  )}
                </div>
              ))}
            </div>
          )}
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
                  <div style={{ background: 'var(--white)', color: 'var(--text)', borderRadius: 12, padding: '12px 14px', boxShadow: '0 1px 4px rgba(0,0,0,0.06)' }}>
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
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
        <button
          onClick={() => setVerArchivados(v => !v)}
          className="btn btn-secondary"
          style={{ fontSize: 12, padding: '6px 12px' }}
        >
          {verArchivados ? '← Ver clientes activos' : 'Ver archivados'}
        </button>
        <button
          onClick={() => setMostrarNuevoCliente(v => !v)}
          className="btn btn-primary"
          style={{ fontSize: 12, padding: '6px 12px' }}
        >
          + Agregar cliente
        </button>
      </div>
      {mostrarNuevoCliente && (
        <div className="card" style={{ padding: 14, marginBottom: 12, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div className="field" style={{ flex: 1, minWidth: 180 }}>
            <label>Nombre del cliente</label>
            <input
              type="text"
              value={nuevoClienteNombre}
              onChange={e => setNuevoClienteNombre(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && !guardandoNuevoCliente) agregarCliente() }}
              placeholder="Ej: Juan Pérez"
            />
          </div>
          <button className="btn btn-primary" style={{ fontSize: 13, padding: '8px 14px' }} onClick={agregarCliente} disabled={guardandoNuevoCliente}>
            {guardandoNuevoCliente ? 'Guardando...' : 'Crear y cargar datos'}
          </button>
        </div>
      )}
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

/* ─── Consultas con IA — Gustavo pregunta, la IA responde con datos reales de hoy ──── */
interface MensajeChatIA {
  rol: 'usuario' | 'ia'
  texto: string
}

export function PanelConsultasIA() {
  const [cargando, setCargando] = useState(true)
  const [contexto, setContexto] = useState<Record<string, unknown> | null>(null)
  const [mensajes, setMensajes] = useState<MensajeChatIA[]>([])
  const [pregunta, setPregunta] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [error, setError] = useState('')

  // Junta el mismo tipo de datos que ya se muestran en Obras/Pago semanal/Cuentas por
  // cobrar y los resume en un JSON chico para pasarle a la IA como contexto -- reusa
  // calcularResumenObras/calcularFilaPagoSemanal (misma fuente de verdad que esos
  // paneles) en vez de recalcular los números por su cuenta.
  const cargarContexto = useCallback(async () => {
    setCargando(true)
    const [
      { data: diarios }, { data: compras }, { data: cobros }, { data: subcontratos },
      { data: obrasMaestro }, { data: trabajadoresTarifas }, { data: subcontratosMaster },
      { data: cuentas }, { data: abonos }, { data: ajustes }, { data: adelantos },
    ] = await Promise.all([
      supabase.from('reportes_diarios').select('*'),
      supabase.from('reportes_compras').select('*'),
      supabase.from('reportes_cobros').select('*'),
      supabase.from('reportes_subcontratos').select('*'),
      supabase.from('obras').select('*').order('nombre'),
      supabase.from('trabajadores').select('*'),
      supabase.from('subcontratos_master').select('*'),
      supabase.from('cuentas_por_cobrar').select('*'),
      supabase.from('abonos_cuenta').select('*'),
      supabase.from('ajustes_pago_semanal').select('*'),
      supabase.from('adelantos_trabajador').select('*'),
    ])

    const diariosT = (diarios as ReporteTrabajadorDia[]) || []
    const tarifasT = (trabajadoresTarifas as Trabajador[]) || []
    const cuentasT = (cuentas as CuentaPorCobrar[]) || []
    const abonosT = (abonos as AbonoCuenta[]) || []

    const resumenObras = calcularResumenObras(
      (obrasMaestro as Obra[]) || [], diariosT, (compras as ReporteCompraDia[]) || [],
      (cobros as ReporteCobroDia[]) || [], (subcontratos as ReporteSubcontratoDia[]) || [], cuentasT,
      abonosT, (subcontratosMaster as SubcontratoMaster[]) || [], tarifasT,
    )

    const semanas = agruparPorPeriodo('semana', diariosT, [], [], [])
    const semanaActual = semanas.find(s => s.enCurso) || semanas[0] || null
    const semanaPagoActual = semanaActual ? (() => {
      const { inicio, fin } = semanaRango(semanaActual.key)
      const filas = tarifasT
        .map(t => {
          const diasPresentes = semanaActual.diarios.filter(d => d.trabajador === t.nombre && d.presente)
          const ajustesDeLaSemana = ((ajustes as AjustePagoSemanal[]) || []).filter(a => a.trabajador === t.nombre && a.semana_key === semanaActual.key)
          const adelantosDeLaSemana = ((adelantos as AdelantoTrabajador[]) || []).filter(a => a.trabajador === t.nombre && a.fecha >= inicio && a.fecha <= fin)
          return calcularFilaPagoSemanal(t, diasPresentes, ajustesDeLaSemana, adelantosDeLaSemana)
        })
        .filter(f => f.dias > 0 || f.ajustes.length > 0 || f.adelantosQueRestan.length > 0)
      return { rango: `${inicio} a ${fin}`, trabajadores: filas.map(f => ({ trabajador: f.trabajador, sueldoFijo: f.sueldoFijo, dias: f.dias, ganado: f.ganado, viatico: f.viatico, ajustes: f.totalAjustes, adelantos: f.totalAdelantosQueRestan, neto: f.neto })) }
    })() : null

    const cuentasSueltas = cuentasT
      .filter(c => !c.obra && c.activa)
      .map(c => {
        const abonado = abonosT.filter(a => a.cuenta_id === c.id).reduce((s, a) => s + a.monto, 0)
        return { pagador: c.pagador, concepto: c.concepto, totalPresupuesto: c.total_presupuesto, abonado, pendiente: Math.max(c.total_presupuesto - abonado, 0) }
      })

    // Gustavo probó el chat y lo primero que preguntó fue cuánto se gastó en julio: no podía
    // responder porque el resumen solo llevaba totales actuales, sin nada de tiempo (los
    // datos por mes se cargaban en el navegador y se descartaban antes de mandarlos).
    // Esto arma el desglose por mes -- son unas decenas de números, no mueve el costo de la API.
    const porMes: Record<string, { compras: number; cobros: number; manoDeObra: number; subcontratos: number }> = {}
    function mesDe(fecha: string) { return fecha.slice(0, 7) }
    function celdaMes(fecha: string) {
      const k = mesDe(fecha)
      if (!porMes[k]) porMes[k] = { compras: 0, cobros: 0, manoDeObra: 0, subcontratos: 0 }
      return porMes[k]
    }
    for (const c of (compras as ReporteCompraDia[]) || []) celdaMes(c.fecha).compras += c.monto
    for (const c of (cobros as ReporteCobroDia[]) || []) celdaMes(c.fecha).cobros += c.monto
    for (const s of (subcontratos as ReporteSubcontratoDia[]) || []) celdaMes(s.fecha).subcontratos += s.monto
    for (const d of diariosT) {
      if (!d.presente) continue
      const t = tarifasT.find(x => x.nombre === d.trabajador)
      celdaMes(d.fecha).manoDeObra += d.fraccion_jornada * (t?.tarifa_diaria || 0) + (d.viatico ? (t?.viatico_diario || 0) : 0)
    }
    const gastosPorMes = Object.entries(porMes)
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([mes, v]) => ({ mes, ...v, gastoTotal: v.compras + v.manoDeObra + v.subcontratos }))

    setContexto({
      fechaHoy: new Date().toISOString().slice(0, 10),
      gastosPorMes,
      // Las cerradas también: antes solo iban las activas, así que no podía hablar de una
      // obra terminada aunque le preguntaran por ella.
      obrasCerradas: resumenObras.filter(o => !o.activa).map(o => ({
        nombre: o.obra, cliente: o.cliente, estado: o.estadoObra,
        presupuestoTotal: o.presupuestoTotal, cobrado: o.cobrado, saldo: o.saldo,
      })),
      obras: resumenObras.filter(o => o.activa).map(o => ({
        nombre: o.obra, cliente: o.cliente, estado: o.estadoObra,
        presupuestoTotal: o.presupuestoTotal, cobrado: o.cobrado, faltaPorCobrar: o.faltaPorCobrar,
        // Los dos: sin el neto la IA rearma el saldo con el bruto y le da otro número al
        // que muestra la pestaña Obras.
        gastoComprasPagado: o.gastoCompras, gastoComprasCostoSinIva: o.gastoComprasNeto,
        gastoSubcontratos: o.gastoSubcontratos, manoDeObra: o.manoDeObra, saldo: o.saldo,
        fechaInicio: o.fechaInicio, fechaFin: o.fechaFin, garantiaHasta: o.garantiaHasta,
      })),
      semanaPagoActual,
      cuentasPorCobrarSueltas: cuentasSueltas,
      trabajadores: tarifasT.filter(t => t.activo).map(t => ({ nombre: t.nombre, tarifaDiaria: t.tarifa_diaria, viaticoDiario: t.viatico_diario, sueldoFijo: t.tarifa_diaria === 0 })),
    })
    setCargando(false)
  }, [])

  useEffect(() => { cargarContexto() }, [cargarContexto])

  async function preguntar() {
    if (!pregunta.trim() || !contexto || enviando) return
    const preguntaActual = pregunta.trim()
    const historialParaEnviar = mensajes.slice(-8)
    setMensajes(prev => [...prev, { rol: 'usuario', texto: preguntaActual }])
    setPregunta('')
    setEnviando(true)
    setError('')
    try {
      const res = await fetch('/api/chat-ia', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pregunta: preguntaActual, contexto, historial: historialParaEnviar }),
      })
      const resultado = await res.json()
      if (!res.ok) throw new Error(resultado.error || 'error desconocido')
      setMensajes(prev => [...prev, { rol: 'ia', texto: resultado.respuesta || 'No obtuve respuesta.' }])
    } catch (err) {
      setError('No se pudo consultar a la IA: ' + String(err))
    } finally {
      setEnviando(false)
    }
  }

  if (cargando) return <div className="spinner" />

  return (
    <div>
      <p style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 14 }}>
        Pregúntale a la IA sobre tus obras, pagos y cobros — responde con los datos reales cargados hoy en la app, no inventa cifras.
      </p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 14 }}>
        {mensajes.length === 0 && (
          <p style={{ fontSize: 13, color: 'var(--muted)', fontStyle: 'italic' }}>
            Ej: "¿Cuánto falta por cobrar en Luis Carrera?", "¿Cuánto llevo pagado esta semana?", "¿Qué obra tiene el saldo más bajo?"
          </p>
        )}
        {mensajes.map((m, i) => (
          <div
            key={i}
            style={{
              alignSelf: m.rol === 'usuario' ? 'flex-end' : 'flex-start',
              maxWidth: '85%', padding: '10px 14px', borderRadius: 12, fontSize: 14, lineHeight: 1.5, whiteSpace: 'pre-wrap',
              background: m.rol === 'usuario' ? 'var(--primary)' : 'var(--surface-alt)',
              color: m.rol === 'usuario' ? 'var(--text-inverse)' : 'var(--text)',
            }}
          >
            {m.texto}
          </div>
        ))}
        {enviando && <p style={{ fontSize: 13, color: 'var(--muted)', fontStyle: 'italic' }}>Pensando...</p>}
      </div>
      {error && <p style={{ color: 'var(--danger)', fontSize: 13, marginBottom: 10 }}>{error}</p>}
      <div style={{ display: 'flex', gap: 8 }}>
        <input
          type="text"
          placeholder="Escribe tu pregunta..."
          value={pregunta}
          onChange={e => setPregunta(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && !enviando) preguntar() }}
          style={{ flex: 1 }}
          disabled={enviando}
        />
        <button className="btn btn-primary" onClick={preguntar} disabled={enviando || !pregunta.trim()}>
          {enviando ? '...' : 'Preguntar'}
        </button>
      </div>
    </div>
  )
}
