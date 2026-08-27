import { useState, useEffect, useCallback, useRef } from 'react'
import { supabase } from '../lib/supabase'

const REPORTE_TOKEN = import.meta.env.VITE_REPORTE_TOKEN as string

// Respaldo por si falla la carga desde Supabase (tabla `trabajadores`, fuente real de la
// lista) -- la lista real, filtrada a los activos, se carga en un efecto más abajo.
export const TRABAJADORES = ['Alejandro', 'Fabriel', 'Henry', 'Manuel', 'Misael', 'Samuel']
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

interface CompraItemRow {
  id?: string
  descripcion: string
  cantidad: string
  precioUnitario: string
}

interface CompraRow {
  id?: string
  descripcion: string
  monto: string
  obra: string
  // Cuando la compra no es para ninguna obra, explica a propósito por qué -- 'stock'
  // (material para tener a mano) o 'trabajo_puntual' (algo chico sin obra formal) -- en vez
  // de dejarla sin etiqueta. No se guarda nada acá si `obra` sí tiene una obra real.
  destino: '' | 'stock' | 'trabajo_puntual'
  pagadoPor: string
  reembolsado: boolean
  fotoBoletaUrl: string
  // Desglose por ítem de la boleta (paso 2 del plan de IA) -- se guarda aparte en
  // `compra_items`, esta fila de `reportes_compras` sigue siendo el total de la compra.
  items: CompraItemRow[]
}

interface CobroRow {
  id?: string
  // De dónde viene esta fila al cargarla — determina si al guardar se borra de
  // reportes_cobros o de abonos_cuenta. Las filas nuevas (sin id) se resuelven
  // solas al guardar: si la obra tiene una única cuenta por cobrar activa, el
  // cobro se guarda ahí (evita el duplicado que ya pasó una vez); si no, cae al
  // camino viejo (reportes_cobros).
  origen?: 'reportes_cobros' | 'abono_cuenta'
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
  monto: string
}

interface UsoStockRow {
  id?: string
  materialId: string
  cantidad: string
  obra: string
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

function defaultTrabajadores(nombres: string[]): Record<string, TrabajadorState> {
  const base: Record<string, TrabajadorState> = {}
  for (const nombre of nombres) base[nombre] = { ...DEFAULT_TRABAJADOR }
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

  const [trabajadorNombres, setTrabajadorNombres] = useState<string[]>(TRABAJADORES)
  const trabajadorNombresRef = useRef<string[]>(TRABAJADORES)
  const [trabajadores, setTrabajadores] = useState<Record<string, TrabajadorState>>(defaultTrabajadores(TRABAJADORES))
  const [obras, setObras] = useState<string[]>(OBRAS_FALLBACK)
  const [obraGeneral, setObraGeneral] = useState('')
  const [compras, setCompras] = useState<CompraRow[]>([])
  const [subiendoBoletaIdx, setSubiendoBoletaIdx] = useState<number | null>(null)
  const [cobros, setCobros] = useState<CobroRow[]>([])
  const [subcontratos, setSubcontratos] = useState<SubcontratoRow[]>([])
  const [trabajosPuntuales, setTrabajosPuntuales] = useState<TrabajoPuntualRow[]>([])
  const [materiales, setMateriales] = useState<{ id: string; nombre: string; stock_actual: number }[]>([])
  const [usosStock, setUsosStock] = useState<UsoStockRow[]>([])

  const cargarDia = useCallback(async (f: string) => {
    setLoading(true)
    setError(null)
    const [{ data: dia }, { data: compr }, { data: cobr }, { data: subc }, { data: punt }, { data: aboAquiDia }, { data: salidasDia }] = await Promise.all([
      supabase.from('reportes_diarios').select('*').eq('fecha', f),
      supabase.from('reportes_compras').select('*').eq('fecha', f).order('created_at'),
      supabase.from('reportes_cobros').select('*').eq('fecha', f).order('created_at'),
      supabase.from('reportes_subcontratos').select('*').eq('fecha', f).order('created_at'),
      supabase.from('reportes_trabajos_puntuales').select('*').eq('fecha', f).order('created_at'),
      // Cobros de ese dia que ya viven en una cuenta por cobrar (obra con cuenta
      // unica) en vez de reportes_cobros — para que se sigan viendo/editando acá.
      supabase.from('abonos_cuenta').select('id, fecha, monto, cuentas_por_cobrar(obra, pagador)').eq('fecha', f),
      supabase.from('movimientos_stock').select('*').eq('fecha', f).eq('tipo', 'salida').order('created_at'),
    ])

    const base = defaultTrabajadores(trabajadorNombresRef.current)
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

    const comprasDia = (compr || []) as { id: string; descripcion: string; monto: number; obra: string | null; destino: 'stock' | 'trabajo_puntual' | null; pagado_por: string | null; reembolsado: boolean | null; foto_boleta_url: string | null }[]
    let itemsPorCompra: Record<string, CompraItemRow[]> = {}
    if (comprasDia.length) {
      const { data: itemsData } = await supabase.from('compra_items').select('*').in('compra_id', comprasDia.map(c => c.id))
      itemsPorCompra = (itemsData || []).reduce((acc: Record<string, CompraItemRow[]>, it: { id: string; compra_id: string; descripcion: string; cantidad: number; precio_unitario: number }) => {
        if (!acc[it.compra_id]) acc[it.compra_id] = []
        acc[it.compra_id].push({ id: it.id, descripcion: it.descripcion, cantidad: String(it.cantidad), precioUnitario: String(it.precio_unitario) })
        return acc
      }, {})
    }
    setCompras(comprasDia.map(c => ({
      id: c.id, descripcion: c.descripcion, monto: String(c.monto), obra: c.obra || '', destino: c.destino || '', pagadoPor: c.pagado_por || '', reembolsado: c.reembolsado ?? false, fotoBoletaUrl: c.foto_boleta_url || '',
      items: itemsPorCompra[c.id] || [],
    })))
    setUsosStock((salidasDia || []).map((s: { id: string; material_id: string; cantidad: number; obra: string | null }) => ({
      id: s.id, materialId: s.material_id, cantidad: String(s.cantidad), obra: s.obra || '',
    })))
    const cobrosLegado = (cobr || []).map((c: { id: string; obra: string | null; cliente: string; monto: number }) => ({
      id: c.id, origen: 'reportes_cobros' as const, obra: c.obra || '', cliente: c.cliente, monto: String(c.monto),
    }))
    type AbonoConCuenta = { id: string; monto: number; cuentas_por_cobrar: { obra: string | null; pagador: string }[] | { obra: string | null; pagador: string } | null }
    const cobrosDeCuenta = ((aboAquiDia || []) as AbonoConCuenta[])
      .map(a => ({ ...a, cuenta: Array.isArray(a.cuentas_por_cobrar) ? a.cuentas_por_cobrar[0] : a.cuentas_por_cobrar }))
      .filter(a => a.cuenta?.obra)
      .map(a => ({
        id: a.id, origen: 'abono_cuenta' as const, obra: a.cuenta!.obra as string, cliente: a.cuenta!.pagador, monto: String(a.monto),
      }))
    setCobros([...cobrosLegado, ...cobrosDeCuenta])
    setSubcontratos((subc || []).map((s: { id: string; obra: string | null; subcontrato: string; monto: number }) => ({
      id: s.id, obra: s.obra || '', subcontrato: s.subcontrato, monto: String(s.monto),
    })))
    setTrabajosPuntuales((punt || []).map((p: { id: string; descripcion: string; direccion: string | null; trabajador: string | null; monto: number | null }) => ({
      id: p.id, descripcion: p.descripcion, direccion: p.direccion || '', trabajador: p.trabajador || '', monto: p.monto != null ? String(p.monto) : '',
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
    supabase.from('materiales').select('id, nombre, stock_actual').order('nombre').then(({ data }) => {
      setMateriales(data || [])
    })
    // Trabajadores activos reales -- si alguien se archiva desde la card de Trabajadores,
    // deja de aparecer acá (aunque su historial de pagos pasado se mantenga intacto).
    supabase.from('trabajadores').select('nombre').eq('activo', true).order('nombre').then(({ data }) => {
      if (data && data.length) {
        const nombres = data.map((t: { nombre: string }) => t.nombre)
        trabajadorNombresRef.current = nombres
        setTrabajadorNombres(nombres)
        setTrabajadores(prev => {
          const next = defaultTrabajadores(nombres)
          for (const nombre of nombres) if (prev[nombre]) next[nombre] = prev[nombre]
          return next
        })
      }
    })
  }, [tokenValido])

  // Gustavo no tiene tarifa diaria (no está en la tabla `trabajadores`, cobra distinto por ser
  // el dueño) -- no puede sumarse a trabajadorNombres o aparecería en asistencia/pago semanal
  // por error. Se usa aparte solo donde tiene sentido que él sea la respuesta (ej: quién hizo
  // un trabajo puntual).
  const quienLoHizo = [...trabajadorNombres, 'Gustavo']

  function actualizarTrabajador(nombre: string, patch: Partial<TrabajadorState>) {
    setTrabajadores(prev => ({ ...prev, [nombre]: { ...prev[nombre], ...patch } }))
  }

  function aplicarObraATodos() {
    if (!obraGeneral) return
    setTrabajadores(prev => {
      const next = { ...prev }
      for (const nombre of trabajadorNombres) {
        if (next[nombre]?.presente) next[nombre] = { ...next[nombre], obra: obraGeneral, viatico: viaticoPorObra(obraGeneral) }
      }
      return next
    })
  }

  function agregarCompra() {
    setCompras(prev => [...prev, { descripcion: '', monto: '', obra: '', destino: '', pagadoPor: '', reembolsado: false, fotoBoletaUrl: '', items: [] }])
  }

  async function subirFotoBoleta(idx: number, archivo: File) {
    setSubiendoBoletaIdx(idx)
    try {
      const ext = archivo.name.split('.').pop() || 'jpg'
      const filename = `boleta-${Date.now()}.${ext}`
      const { data, error } = await supabase.storage.from('audio-notas').upload(filename, archivo, { contentType: archivo.type })
      if (error) {
        alert('Error al subir la foto: ' + error.message)
        return
      }
      const { data: urlData } = supabase.storage.from('audio-notas').getPublicUrl(data.path)
      actualizarCompra(idx, { fotoBoletaUrl: urlData.publicUrl })

      try {
        const res = await fetch('/api/parse-factura', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url: urlData.publicUrl }),
        })
        const resultado = await res.json()
        if (!res.ok) throw new Error(resultado.error || 'error desconocido')
        const itemsIA: CompraItemRow[] = Array.isArray(resultado.items)
          ? resultado.items.map((it: { descripcion: string; cantidad: number; precioUnitario: number }) => ({
            descripcion: it.descripcion,
            cantidad: String(it.cantidad),
            precioUnitario: String(it.precioUnitario),
          }))
          : []
        actualizarCompra(idx, {
          descripcion: resultado.descripcion || '',
          monto: resultado.monto != null ? String(resultado.monto) : '',
          items: itemsIA,
        })
      } catch (err) {
        alert('La foto se guardó, pero la IA no pudo leerla (' + String(err) + '). Completa descripción y monto a mano.')
      }
    } finally {
      setSubiendoBoletaIdx(null)
    }
  }
  function actualizarCompra(idx: number, patch: Partial<CompraRow>) {
    setCompras(prev => prev.map((c, i) => (i === idx ? { ...c, ...patch } : c)))
  }
  function quitarCompra(idx: number) {
    if (!window.confirm('¿Seguro que quieres quitar esta compra?')) return
    setCompras(prev => prev.filter((_, i) => i !== idx))
  }
  function agregarCompraItem(compraIdx: number) {
    setCompras(prev => prev.map((c, i) => i === compraIdx ? { ...c, items: [...c.items, { descripcion: '', cantidad: '1', precioUnitario: '' }] } : c))
  }
  function actualizarCompraItem(compraIdx: number, itemIdx: number, patch: Partial<CompraItemRow>) {
    setCompras(prev => prev.map((c, i) => i === compraIdx
      ? { ...c, items: c.items.map((it, j) => j === itemIdx ? { ...it, ...patch } : it) }
      : c
    ))
  }
  function quitarCompraItem(compraIdx: number, itemIdx: number) {
    setCompras(prev => prev.map((c, i) => i === compraIdx ? { ...c, items: c.items.filter((_, j) => j !== itemIdx) } : c))
  }

  function agregarUsoStock() {
    setUsosStock(prev => [...prev, { materialId: '', cantidad: '', obra: '' }])
  }
  function actualizarUsoStock(idx: number, patch: Partial<UsoStockRow>) {
    setUsosStock(prev => prev.map((u, i) => i === idx ? { ...u, ...patch } : u))
  }
  function quitarUsoStock(idx: number) {
    setUsosStock(prev => prev.filter((_, i) => i !== idx))
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
    setTrabajosPuntuales(prev => [...prev, { descripcion: '', direccion: '', trabajador: '', monto: '' }])
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

    if (subiendoBoletaIdx !== null) {
      alert('Espera a que la IA termine de leer la boleta antes de guardar.')
      return
    }

    const filasDiarias = trabajadorNombres.map(nombre => {
      const t = trabajadores[nombre] || { ...DEFAULT_TRABAJADOR, presente: false }
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

    // Una compra con foto pero sin descripción/monto (la IA no pudo leerlos, o falló)
    // también cuenta como "con datos" -- si no, quedaba afuera del chequeo de abajo y
    // se guardaba el reporte sin avisar que esa compra nunca se guardó.
    const comprasValidas = compras.filter(c => c.descripcion.trim() || c.monto.trim() || c.fotoBoletaUrl)
    if (comprasValidas.some(c => !c.descripcion.trim() || !c.monto.trim())) {
      alert('Cada compra necesita descripción y monto. Si subiste una foto y la IA no pudo leerlos, complétalos a mano antes de guardar.')
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

    const usosStockValidos = usosStock.filter(u => u.materialId || u.cantidad.trim())
    if (usosStockValidos.some(u => !u.materialId || !u.cantidad.trim() || !u.obra)) {
      alert('Cada uso de stock necesita material, cantidad y obra.')
      return
    }
    if (usosStockValidos.some(u => montoInvalido(u.cantidad))) {
      alert('La cantidad de algún uso de stock no es válida.')
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

    // Borra las compras viejas del día -- el `on delete cascade` de `compra_items` limpia solo
    // el desglose de esas compras, no hace falta borrarlo aparte.
    await supabase.from('reportes_compras').delete().eq('fecha', fecha)
    if (comprasValidas.length) {
      // Se inserta una por una (no en bloque) para poder vincular el desglose de ítems al ID
      // real de cada compra -- un insert en bloque no garantiza el orden de vuelta.
      for (const c of comprasValidas) {
        const { data: compraInsertada, error: e2 } = await supabase.from('reportes_compras').insert({
          fecha, descripcion: c.descripcion.trim(), monto: Number(c.monto), obra: c.obra || null, destino: c.obra ? null : (c.destino || null), pagado_por: c.pagadoPor || null, reembolsado: c.reembolsado, foto_boleta_url: c.fotoBoletaUrl || null,
        }).select('id').single()
        if (e2 || !compraInsertada) {
          setError('Error al guardar las compras. Intenta de nuevo.')
          setSaving(false)
          return
        }
        const itemsValidos = c.items.filter(it => it.descripcion.trim() && Number(it.precioUnitario) > 0)
        if (itemsValidos.length) {
          await supabase.from('compra_items').insert(
            itemsValidos.map(it => ({
              compra_id: compraInsertada.id,
              descripcion: it.descripcion.trim(),
              cantidad: Number(it.cantidad) > 0 ? Number(it.cantidad) : 1,
              precio_unitario: Number(it.precioUnitario),
            }))
          )
        }

        // Si la compra es para Stock, cada material entra al catálogo automáticamente --
        // el trigger de la base de datos ajusta `stock_actual`, acá solo se crea el
        // movimiento. Se crea/reusa el material por nombre (upsert), nunca se duplica.
        // Si no hay desglose por ítem (compra cargada solo con descripción y monto,
        // sin "Materiales de esta compra"), la compra entera entra como un material.
        if (c.destino === 'stock') {
          const materialesAIngresar = itemsValidos.length
            ? itemsValidos.map(it => ({ nombre: it.descripcion.trim(), cantidad: Number(it.cantidad) > 0 ? Number(it.cantidad) : 1 }))
            : [{ nombre: c.descripcion.trim(), cantidad: 1 }]
          for (const m of materialesAIngresar) {
            const { data: material } = await supabase
              .from('materiales')
              .upsert({ nombre: m.nombre }, { onConflict: 'nombre', ignoreDuplicates: false })
              .select('id')
              .single()
            if (material) {
              await supabase.from('movimientos_stock').insert({
                material_id: material.id,
                tipo: 'entrada',
                cantidad: m.cantidad,
                fecha,
                compra_id: compraInsertada.id,
              })
            }
          }
        }
      }
    }

    // Uso de stock del día -- borra y vuelve a crear las salidas de esa fecha, mismo patrón
    // que el resto del reporte diario. El trigger de la base de datos revierte/aplica el
    // stock solo al borrar/crear cada movimiento.
    await supabase.from('movimientos_stock').delete().eq('fecha', fecha).eq('tipo', 'salida')
    if (usosStockValidos.length) {
      const { error: eStock } = await supabase.from('movimientos_stock').insert(
        usosStockValidos.map(u => ({
          material_id: u.materialId,
          tipo: 'salida',
          cantidad: Number(u.cantidad),
          fecha,
          obra: u.obra,
        }))
      )
      if (eStock) {
        setError('Error al guardar el uso de stock. Intenta de nuevo.')
        setSaving(false)
        return
      }
    }

    // Resolver a que cuenta por cobrar corresponde cada obra — solo si tiene UNA
    // sola cuenta activa (si tiene 0 o varias, ese cobro sigue el camino viejo,
    // reportes_cobros, para no adivinar a cual de varias cuentas corresponde).
    const { data: cuentasActivas } = await supabase.from('cuentas_por_cobrar').select('id, obra').eq('activa', true).not('obra', 'is', null)
    const cuentaIdsPorObra = new Map<string, string[]>()
    for (const c of cuentasActivas || []) {
      if (!c.obra) continue
      if (!cuentaIdsPorObra.has(c.obra)) cuentaIdsPorObra.set(c.obra, [])
      cuentaIdsPorObra.get(c.obra)!.push(c.id)
    }

    const cobrosParaCuenta: { fila: CobroRow; cuentaId: string }[] = []
    const cobrosParaLegado: CobroRow[] = []
    for (const c of cobrosValidos) {
      const ids = c.obra ? cuentaIdsPorObra.get(c.obra) : undefined
      if (c.origen !== 'reportes_cobros' && ids && ids.length === 1) {
        cobrosParaCuenta.push({ fila: c, cuentaId: ids[0] })
      } else {
        cobrosParaLegado.push(c)
      }
    }

    // Aviso de posible duplicado — solo para filas nuevas (sin id, recien
    // tipeadas hoy): si ya existe un monto igual, misma obra, misma fecha, EN
    // CUALQUIERA de los dos sistemas (el mismo donde va a caer esta fila, o el
    // otro), es probablemente el mismo pago cargado dos veces por error (esto
    // fue exactamente el bug real que paso con Luis Carrera 2700).
    for (const c of cobrosParaCuenta) {
      if (c.fila.id) continue
      const [{ data: enLegado }, { data: enMismaCuenta }] = await Promise.all([
        supabase.from('reportes_cobros').select('id').eq('fecha', fecha).eq('obra', c.fila.obra).eq('monto', Number(c.fila.monto)).limit(1),
        supabase.from('abonos_cuenta').select('id').eq('fecha', fecha).eq('monto', Number(c.fila.monto)).eq('cuenta_id', c.cuentaId).limit(1),
      ])
      if ((enLegado && enLegado.length > 0) || (enMismaCuenta && enMismaCuenta.length > 0)) {
        if (!window.confirm(`Ya hay un cobro de $${c.fila.monto} para "${c.fila.obra}" el ${fecha} cargado antes. ¿Es un pago distinto (seguir) o el mismo cargado dos veces (cancelar)?`)) {
          setSaving(false)
          return
        }
      }
    }
    for (const c of cobrosParaLegado) {
      if (c.id) continue
      const idsObra = c.obra ? cuentaIdsPorObra.get(c.obra) : undefined
      const [{ data: enMismoLegado }, { data: enCuenta }] = await Promise.all([
        supabase.from('reportes_cobros').select('id').eq('fecha', fecha).eq('obra', c.obra).eq('monto', Number(c.monto)).limit(1),
        idsObra && idsObra.length > 0
          ? supabase.from('abonos_cuenta').select('id').eq('fecha', fecha).eq('monto', Number(c.monto)).in('cuenta_id', idsObra).limit(1)
          : Promise.resolve({ data: [] as { id: string }[] }),
      ])
      if ((enMismoLegado && enMismoLegado.length > 0) || (enCuenta && enCuenta.length > 0)) {
        if (!window.confirm(`Ya hay un cobro de $${c.monto} para "${c.obra}" el ${fecha} cargado antes. ¿Es un pago distinto (seguir) o el mismo cargado dos veces (cancelar)?`)) {
          setSaving(false)
          return
        }
      }
    }

    // Reportes_cobros: se reemplaza completo el dia, como antes — pero solo las
    // filas que efectivamente corresponden a este camino (las que se enrutaron a
    // una cuenta no tocan esta tabla).
    await supabase.from('reportes_cobros').delete().eq('fecha', fecha)
    if (cobrosParaLegado.length) {
      const { error: e3 } = await supabase.from('reportes_cobros').insert(
        cobrosParaLegado.map(c => ({ fecha, obra: c.obra || null, cliente: c.cliente.trim(), monto: Number(c.monto) }))
      )
      if (e3) {
        setError('Error al guardar los cobros. Intenta de nuevo.')
        setSaving(false)
        return
      }
    }

    // Abonos de cuenta: solo se insertan los NUEVOS (sin id) — los que ya
    // existian (origen 'abono_cuenta', cargados por cargarDia) se dejan como
    // estan, se editan desde la pestaña Obras > Detalle si hace falta corregirlos.
    const cobrosNuevosParaCuenta = cobrosParaCuenta.filter(c => !c.fila.id)
    if (cobrosNuevosParaCuenta.length) {
      const { error: e3b } = await supabase.from('abonos_cuenta').insert(
        cobrosNuevosParaCuenta.map(c => ({ cuenta_id: c.cuentaId, fecha, monto: Number(c.fila.monto) }))
      )
      if (e3b) {
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
        trabajosValidos.map(p => ({ fecha, descripcion: p.descripcion.trim(), direccion: p.direccion.trim() || null, trabajador: p.trabajador || null, monto: p.monto.trim() ? Number(p.monto) : null }))
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
              {trabajadorNombres.map(nombre => {
                const t = trabajadores[nombre]
                if (!t) return null
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
                    <div>
                      <label className="btn btn-secondary" style={{ display: 'inline-block', fontSize: 13, cursor: subiendoBoletaIdx === idx ? 'default' : 'pointer', opacity: subiendoBoletaIdx === idx ? 0.6 : 1 }}>
                        {subiendoBoletaIdx === idx ? 'Leyendo la boleta...' : c.fotoBoletaUrl ? 'Cambiar foto de la boleta' : '+ Subir foto de la boleta'}
                        <input
                          type="file"
                          accept="image/*"
                          disabled={subiendoBoletaIdx === idx}
                          style={{ display: 'none' }}
                          onChange={e => {
                            const archivo = e.target.files?.[0]
                            e.target.value = ''
                            if (archivo) subirFotoBoleta(idx, archivo)
                          }}
                        />
                      </label>
                      {c.fotoBoletaUrl && (
                        <a href={c.fotoBoletaUrl} target="_blank" rel="noreferrer" style={{ marginLeft: 10, fontSize: 12, color: 'var(--primary)', fontWeight: 600 }}>
                          Ver foto
                        </a>
                      )}
                      <p style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4 }}>
                        Sube la foto y la IA completa descripción y monto — revísalos antes de guardar.
                      </p>
                    </div>
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
                        <select
                          value={c.obra || (c.destino ? `__${c.destino}__` : '')}
                          onChange={e => {
                            const v = e.target.value
                            if (v === '__stock__' || v === '__trabajo_puntual__') {
                              actualizarCompra(idx, { obra: '', destino: v.replace(/^__|__$/g, '') as 'stock' | 'trabajo_puntual' })
                            } else {
                              actualizarCompra(idx, { obra: v, destino: '' })
                            }
                          }}
                        >
                          <option value="">Selecciona...</option>
                          {obras.map(o => <option key={o} value={o}>{o}</option>)}
                          <option value="__stock__">Stock (sin obra todavía)</option>
                          <option value="__trabajo_puntual__">Trabajo puntual (sin obra)</option>
                        </select>
                      </div>
                    </div>

                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                        <label style={{ margin: 0 }}>Materiales de esta compra (opcional)</label>
                        <button type="button" className="btn btn-ghost" onClick={() => agregarCompraItem(idx)} style={{ fontSize: 12 }}>
                          + Agregar material
                        </button>
                      </div>
                      {c.items.length > 0 && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                          {c.items.map((it, itemIdx) => (
                            <div key={itemIdx} style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                              <input
                                type="text"
                                placeholder="Material"
                                value={it.descripcion}
                                onChange={e => actualizarCompraItem(idx, itemIdx, { descripcion: e.target.value })}
                                style={{ flex: 3 }}
                              />
                              <input
                                type="number"
                                min="0"
                                placeholder="Cant."
                                value={it.cantidad}
                                onChange={e => actualizarCompraItem(idx, itemIdx, { cantidad: e.target.value })}
                                style={{ flex: 1 }}
                              />
                              <input
                                type="number"
                                min="0"
                                placeholder="P. unit."
                                value={it.precioUnitario}
                                onChange={e => actualizarCompraItem(idx, itemIdx, { precioUnitario: e.target.value })}
                                style={{ flex: 1 }}
                              />
                              <button type="button" className="btn btn-ghost" onClick={() => quitarCompraItem(idx, itemIdx)} style={{ fontSize: 13, padding: '4px 8px', flexShrink: 0 }}>✕</button>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    <div className="field">
                      <label>¿Quién pagó?</label>
                      <select value={c.pagadoPor} onChange={e => actualizarCompra(idx, { pagadoPor: e.target.value })}>
                        <option value="">Caja de la empresa</option>
                        {trabajadorNombres.map(n => <option key={n} value={n}>{n} (con su propia plata — hay que reembolsarle)</option>)}
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

            {/* Uso de stock del día */}
            {materiales.length > 0 && (
              <>
                <h2 style={{ fontSize: 15, fontWeight: 800, marginBottom: 10 }}>Uso de stock hoy</h2>
                <p style={{ fontSize: 12, color: 'var(--muted)', marginTop: -6, marginBottom: 10 }}>
                  Si usaste material que ya estaba guardado (de una compra anterior), regístralo acá para que se descuente del stock.
                </p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 12 }}>
                  {usosStock.map((u, idx) => (
                    <div key={idx} className="card" style={{ padding: 14 }}>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                        <div className="field">
                          <label>Material</label>
                          <select value={u.materialId} onChange={e => actualizarUsoStock(idx, { materialId: e.target.value })}>
                            <option value="">Selecciona...</option>
                            {materiales.map(m => (
                              <option key={m.id} value={m.id}>{m.nombre} (quedan {m.stock_actual})</option>
                            ))}
                          </select>
                        </div>
                        <div style={{ display: 'flex', gap: 10 }}>
                          <div className="field" style={{ flex: 1 }}>
                            <label>Cantidad usada</label>
                            <input
                              type="number"
                              min="0"
                              value={u.cantidad}
                              onChange={e => actualizarUsoStock(idx, { cantidad: e.target.value })}
                            />
                          </div>
                          <div className="field" style={{ flex: 1 }}>
                            <label>Obra</label>
                            <select value={u.obra} onChange={e => actualizarUsoStock(idx, { obra: e.target.value })}>
                              <option value="">Selecciona...</option>
                              {obras.map(o => <option key={o} value={o}>{o}</option>)}
                            </select>
                          </div>
                        </div>
                        <button type="button" className="btn btn-ghost" onClick={() => quitarUsoStock(idx)} style={{ alignSelf: 'flex-end', fontSize: 13 }}>
                          ✕ Quitar
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
                <button type="button" className="btn btn-secondary" onClick={agregarUsoStock} style={{ width: '100%', marginBottom: 24 }}>
                  + Agregar uso de stock
                </button>
              </>
            )}

            {/* Cobros del día */}
            <h2 style={{ fontSize: 15, fontWeight: 800, marginBottom: 10 }}>Cobros del día</h2>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 12 }}>
              {cobros.map((c, idx) => (
                <div key={idx} className="card" style={{ padding: 14 }}>
                  {c.origen === 'abono_cuenta' ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                      <span style={{ fontSize: 13 }}><strong>{c.cliente}</strong> — {c.obra}: {c.monto ? `$${Number(c.monto).toLocaleString('es-CL')}` : ''}</span>
                      <span style={{ fontSize: 12, color: 'var(--muted)' }}>
                        Este cobro ya vive en la cuenta por cobrar de esta obra — para corregirlo, hazlo desde la pestaña Obras → Detalle, no acá.
                      </span>
                    </div>
                  ) : (
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
                  )}
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
                        {quienLoHizo.map(n => <option key={n} value={n}>{n}</option>)}
                      </select>
                    </div>
                    <div className="field">
                      <label>Monto cobrado (opcional)</label>
                      <input
                        type="number"
                        placeholder="Ej: 30000"
                        value={p.monto}
                        onChange={e => actualizarTrabajoPuntual(idx, { monto: e.target.value })}
                      />
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
