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

// Regla de negocio confirmada por Alexandra (ver decisiones.md 2026-08-31 y 2026-09-07):
// un sábado trabajado NO lleva viático, ni siquiera en Limache. Ya causó dos veces que el
// neto de la semana saliera $10.000 de más por persona contra lo realmente transferido.
// Ojo con el parseo: `new Date('2026-09-05')` se interpreta como UTC y en Chile devuelve
// el día anterior -- por eso se arma la fecha con los componentes locales.
function esSabado(fecha: string) {
  const [y, m, d] = fecha.split('-').map(Number)
  if (!y || !m || !d) return false
  return new Date(y, m - 1, d).getDay() === 6
}

// Si el día es sábado no hay viático, sin importar la obra.
function viaticoCorresponde(obra: string, fecha: string) {
  return viaticoPorObra(obra) && !esSabado(fecha)
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
  // (material para tener a mano), 'trabajo_puntual' (algo chico sin obra formal) o
  // 'gasto_empresa' (no es material: combustible, peaje, herramientas) -- en vez de dejarla
  // sin etiqueta. No se guarda nada acá si `obra` sí tiene una obra real.
  //
  // 'gasto_empresa' no es una compra: esa fila se guarda en `gastos_variables`, no en
  // `reportes_compras`. Vive igual en este formulario porque la regla que decidió Alexandra
  // (11/09) es que Gustavo elija el destino UNA vez, donde carga, y la app se encargue del
  // resto. Antes tenía que acordarse de ir a otra pantalla, y por eso hay combustible
  // cargado en los dos lados.
  destino: '' | 'stock' | 'trabajo_puntual' | 'gasto_empresa'
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
  comprobanteUrl: string
}

interface SubcontratoRow {
  id?: string
  obra: string
  subcontrato: string
  monto: string
  comprobanteUrl: string
}

interface TrabajoPuntualRow {
  id?: string
  descripcion: string
  direccion: string
  trabajador: string
  monto: string
  comprobanteUrl: string
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
  const [obrasConContrato, setObrasConContrato] = useState<Set<string>>(new Set())
  const [clientePorObra, setClientePorObra] = useState<Record<string, string>>({})
  const [obraGeneral, setObraGeneral] = useState('')
  const [compras, setCompras] = useState<CompraRow[]>([])
  // Compras ya guardadas (con id) se ven como una tarjeta chica y cerrada -- "esto ya
  // quedó guardado, no hace falta que ocupe media pantalla" -- en vez de mostrar el
  // formulario completo de todas de nuevo. Una compra recién agregada (sin id) siempre
  // arranca abierta. Ver progress/decisiones.md 2026-08-28 sobre por qué NO se vacía el
  // formulario entero: el guardado borra-y-reinserta todo el día, vaciar el formulario
  // hacía que un segundo guardado el mismo día borrara lo del primero.
  const [comprasColapsadas, setComprasColapsadas] = useState<Set<string>>(new Set())
  // Mismo criterio que las compras (arriba): un trabajador que ya tiene fila guardada
  // hoy para esta fecha se ve como una línea chica y cerrada -- "esto ya quedó guardado"
  // -- en vez del formulario completo siempre abierto. Se descolapsa solo si se edita
  // algo de ese trabajador (deja de coincidir con lo guardado), nunca al revés.
  const [trabajadoresColapsados, setTrabajadoresColapsados] = useState<Set<string>>(new Set())
  // Trabajadores con datos reales para este día: ya tenían fila guardada, o se tocó algo
  // de su formulario en esta sesión (marcar ausente, elegir obra, "aplicar obra a todos").
  // "presente" arranca en true por defecto para todos -- si no filtráramos por esto, guardar
  // CUALQUIER otra cosa (un cobro, una compra) exigiría completar la obra de cada trabajador
  // activo aunque nadie haya tocado su fila, incluso en una obra nueva sin gente trabajando aún.
  const [trabajadoresTocados, setTrabajadoresTocados] = useState<Set<string>>(new Set())
  // Un sábado guardado ANTES de que existiera la regla del viático quedó con viatico=true en
  // la base. La pantalla ya lo muestra como "sin viático" (así se va a guardar), pero Pago
  // Semanal sigue leyendo el dato viejo hasta que se guarde el día -- si no se avisa, las dos
  // pantallas se contradicen sin explicación. Ver decisiones.md 2026-09-07.
  const [viaticoViejoEsteDia, setViaticoViejoEsteDia] = useState(false)
  // Mismo criterio para Cobros -- solo los de origen 'reportes_cobros' (editables acá);
  // los de 'abono_cuenta' ya se muestran de solo lectura, sin formulario que colapsar.
  const [cobrosColapsados, setCobrosColapsados] = useState<Set<string>>(new Set())
  const [subcontratosColapsados, setSubcontratosColapsados] = useState<Set<string>>(new Set())
  const [trabajosPuntualesColapsados, setTrabajosPuntualesColapsados] = useState<Set<string>>(new Set())
  const [subiendoBoletaIdx, setSubiendoBoletaIdx] = useState<number | null>(null)
  // Captura de comprobante para Cobros/Subcontratos/Trabajo puntual -- 'cobro-0', 'subcontrato-2', etc.
  const [subiendoComprobante, setSubiendoComprobante] = useState<string | null>(null)
  const [cobros, setCobros] = useState<CobroRow[]>([])
  const [subcontratos, setSubcontratos] = useState<SubcontratoRow[]>([])
  const [trabajosPuntuales, setTrabajosPuntuales] = useState<TrabajoPuntualRow[]>([])
  const [materiales, setMateriales] = useState<{ id: string; nombre: string; stock_actual: number }[]>([])
  const [usosStock, setUsosStock] = useState<UsoStockRow[]>([])
  // Ids de los gastos de empresa que este día ya tenía guardados. Hace falta aparte de
  // `compras` porque si el usuario borra la última fila de gasto, esa fila desaparece del
  // estado y sin esto no habría cómo saber que hay algo que borrar en la base.
  const [gastosEmpresaDelDia, setGastosEmpresaDelDia] = useState<string[]>([])

  const cargarDia = useCallback(async (f: string) => {
    setLoading(true)
    setError(null)
    const [{ data: dia }, { data: compr }, { data: cobr }, { data: subc }, { data: punt }, { data: aboAquiDia }, { data: salidasDia }, gastosDia] = await Promise.all([
      supabase.from('reportes_diarios').select('*').eq('fecha', f),
      supabase.from('reportes_compras').select('*').eq('fecha', f).order('created_at'),
      supabase.from('reportes_cobros').select('*').eq('fecha', f).order('created_at'),
      supabase.from('reportes_subcontratos').select('*').eq('fecha', f).order('created_at'),
      supabase.from('reportes_trabajos_puntuales').select('*').eq('fecha', f).order('created_at'),
      // Cobros de ese dia que ya viven en una cuenta por cobrar (obra con cuenta
      // unica) en vez de reportes_cobros — para que se sigan viendo/editando acá.
      supabase.from('abonos_cuenta').select('id, fecha, monto, cuentas_por_cobrar(obra, pagador)').eq('fecha', f),
      supabase.from('movimientos_stock').select('*').eq('fecha', f).eq('tipo', 'salida').order('created_at'),
      // Gastos de la empresa cargados desde acá. Solo los de `origen = 'reporte_diario'`:
      // los que Alexandra carga a mano desde Estado de resultados no se tocan desde esta
      // pantalla, ni para mostrarlos ni para borrarlos.
      supabase.from('gastos_variables').select('*').eq('fecha', f).eq('origen', 'reporte_diario').order('created_at'),
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
    setTrabajadoresColapsados(new Set((dia || []).map(row => row.trabajador)))
    setTrabajadoresTocados(new Set((dia || []).map(row => row.trabajador)))
    setViaticoViejoEsteDia((dia || []).some(row => row.presente && row.viatico))

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
    // Si la migración todavía no se corrió, la columna `origen` no existe y el select falla:
    // se muestra el día sin esos gastos antes que dejar el Reporte Diario sin cargar.
    const gastosEmpresaDia = (gastosDia.error ? [] : (gastosDia.data || [])) as { id: string; descripcion: string | null; monto: number; foto_boleta_url: string | null }[]
    setCompras([
      ...comprasDia.map(c => ({
        id: c.id, descripcion: c.descripcion, monto: String(c.monto), obra: c.obra || '', destino: (c.destino || '') as CompraRow['destino'], pagadoPor: c.pagado_por || '', reembolsado: c.reembolsado ?? false, fotoBoletaUrl: c.foto_boleta_url || '',
        items: itemsPorCompra[c.id] || [],
      })),
      ...gastosEmpresaDia.map(g => ({
        id: g.id, descripcion: g.descripcion || '', monto: String(g.monto), obra: '', destino: 'gasto_empresa' as const,
        pagadoPor: '', reembolsado: false, fotoBoletaUrl: g.foto_boleta_url || '', items: [],
      })),
    ])
    setComprasColapsadas(new Set([...comprasDia.map(c => c.id), ...gastosEmpresaDia.map(g => g.id)]))
    setGastosEmpresaDelDia(gastosEmpresaDia.map(g => g.id))
    setUsosStock((salidasDia || []).map((s: { id: string; material_id: string; cantidad: number; obra: string | null }) => ({
      id: s.id, materialId: s.material_id, cantidad: String(s.cantidad), obra: s.obra || '',
    })))
    const cobrosLegado = (cobr || []).map((c: { id: string; obra: string | null; cliente: string; monto: number; comprobante_url: string | null }) => ({
      id: c.id, origen: 'reportes_cobros' as const, obra: c.obra || '', cliente: c.cliente, monto: String(c.monto), comprobanteUrl: c.comprobante_url || '',
    }))
    type AbonoConCuenta = { id: string; monto: number; cuentas_por_cobrar: { obra: string | null; pagador: string }[] | { obra: string | null; pagador: string } | null }
    const cobrosDeCuenta = ((aboAquiDia || []) as AbonoConCuenta[])
      .map(a => ({ ...a, cuenta: Array.isArray(a.cuentas_por_cobrar) ? a.cuentas_por_cobrar[0] : a.cuentas_por_cobrar }))
      .filter(a => a.cuenta?.obra)
      .map(a => ({
        id: a.id, origen: 'abono_cuenta' as const, obra: a.cuenta!.obra as string, cliente: a.cuenta!.pagador, monto: String(a.monto), comprobanteUrl: '',
      }))
    setCobros([...cobrosLegado, ...cobrosDeCuenta])
    setCobrosColapsados(new Set(cobrosLegado.map(c => c.id)))
    setSubcontratos((subc || []).map((s: { id: string; obra: string | null; subcontrato: string; monto: number; comprobante_url: string | null }) => ({
      id: s.id, obra: s.obra || '', subcontrato: s.subcontrato, monto: String(s.monto), comprobanteUrl: s.comprobante_url || '',
    })))
    setSubcontratosColapsados(new Set((subc || []).map((s: { id: string }) => s.id)))
    setTrabajosPuntuales((punt || []).map((p: { id: string; descripcion: string; direccion: string | null; trabajador: string | null; monto: number | null; comprobante_url: string | null }) => ({
      id: p.id, descripcion: p.descripcion, direccion: p.direccion || '', trabajador: p.trabajador || '', monto: p.monto != null ? String(p.monto) : '', comprobanteUrl: p.comprobante_url || '',
    })))
    setTrabajosPuntualesColapsados(new Set((punt || []).map((p: { id: string }) => p.id)))
    setLoading(false)
  }, [])

  useEffect(() => {
    if (!tokenValido) return
    cargarDia(fecha)
  }, [tokenValido, fecha, cargarDia])

  // El cartel de "guardado" quedaba pegado abajo, cerca del botón -- en el celular, si ya
  // se había bajado hasta ahí para tocar "Guardar", no había forma de perderlo, pero si
  // alguien mira hacia otro lado un segundo se lo pierde igual y el resto de la pantalla
  // no cambia (correctamente: muestra lo mismo que se guardó). Para que sea imposible de
  // no ver, al guardar se sube la pantalla arriba de todo, donde está el cartel grande.
  useEffect(() => {
    if (saved) window.scrollTo({ top: 0, behavior: 'smooth' })
  }, [saved])

  useEffect(() => {
    if (!tokenValido) return
    supabase.from('obras').select('nombre, cliente').eq('activa', true).order('nombre').then(({ data }) => {
      if (data && data.length) {
        setObras(data.map((o: { nombre: string }) => o.nombre))
        // El cliente de cada obra, para completarlo solo al elegir la obra en un cobro.
        // Gustavo lo definió así (conversación 2): "no me importa quién nos pagó o el nombre
        // que le coloquemos, pero la obra se va a guardar es de ese cliente".
        const mapa: Record<string, string> = {}
        for (const o of data as { nombre: string; cliente: string | null }[]) {
          if (o.cliente) mapa[o.nombre] = o.cliente
        }
        setClientePorObra(mapa)
      }
    })
    supabase.from('materiales').select('id, nombre, stock_actual').order('nombre').then(({ data }) => {
      setMateriales(data || [])
    })
    // Qué obras ya tienen un trato cargado con su subcontratista: si no lo tienen, abonar acá
    // no tiene contra qué descontarse y el abono termina leyéndose como el costo total de la
    // obra. Es exactamente lo que pasó con Gabriel el 09/09.
    supabase.from('subcontratos_master').select('obra').then(({ data }) => {
      setObrasConContrato(new Set(((data as { obra: string }[]) || []).map(s => s.obra)))
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
    setTrabajadoresColapsados(prev => { if (!prev.has(nombre)) return prev; const next = new Set(prev); next.delete(nombre); return next })
    setTrabajadoresTocados(prev => { if (prev.has(nombre)) return prev; const next = new Set(prev); next.add(nombre); return next })
  }

  function aplicarObraATodos() {
    if (!obraGeneral) return
    const nombresAfectados: string[] = []
    setTrabajadores(prev => {
      const next = { ...prev }
      for (const nombre of trabajadorNombres) {
        if (next[nombre]?.presente) {
          next[nombre] = { ...next[nombre], obra: obraGeneral, viatico: viaticoCorresponde(obraGeneral, fecha) }
          nombresAfectados.push(nombre)
        }
      }
      return next
    })
    setTrabajadoresColapsados(prev => { const next = new Set(prev); for (const n of nombresAfectados) next.delete(n); return next })
    setTrabajadoresTocados(prev => { const next = new Set(prev); for (const n of nombresAfectados) next.add(n); return next })
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
    setCobros(prev => [...prev, { obra: '', cliente: '', monto: '', comprobanteUrl: '' }])
  }
  function actualizarCobro(idx: number, patch: Partial<CobroRow>) {
    setCobros(prev => prev.map((c, i) => (i === idx ? { ...c, ...patch } : c)))
    const id = cobros[idx]?.id
    if (id) setCobrosColapsados(prev => { if (!prev.has(id)) return prev; const next = new Set(prev); next.delete(id); return next })
  }
  function quitarCobro(idx: number) {
    if (!window.confirm('¿Seguro que quieres quitar este cobro?')) return
    setCobros(prev => prev.filter((_, i) => i !== idx))
  }

  function agregarSubcontrato() {
    setSubcontratos(prev => [...prev, { obra: '', subcontrato: '', monto: '', comprobanteUrl: '' }])
  }
  function actualizarSubcontrato(idx: number, patch: Partial<SubcontratoRow>) {
    setSubcontratos(prev => prev.map((s, i) => (i === idx ? { ...s, ...patch } : s)))
    const id = subcontratos[idx]?.id
    if (id) setSubcontratosColapsados(prev => { if (!prev.has(id)) return prev; const next = new Set(prev); next.delete(id); return next })
  }
  function quitarSubcontrato(idx: number) {
    if (!window.confirm('¿Seguro que quieres quitar este subcontrato?')) return
    setSubcontratos(prev => prev.filter((_, i) => i !== idx))
  }

  function agregarTrabajoPuntual() {
    setTrabajosPuntuales(prev => [...prev, { descripcion: '', direccion: '', trabajador: '', monto: '', comprobanteUrl: '' }])
  }
  function actualizarTrabajoPuntual(idx: number, patch: Partial<TrabajoPuntualRow>) {
    setTrabajosPuntuales(prev => prev.map((p, i) => (i === idx ? { ...p, ...patch } : p)))
    const id = trabajosPuntuales[idx]?.id
    if (id) setTrabajosPuntualesColapsados(prev => { if (!prev.has(id)) return prev; const next = new Set(prev); next.delete(id); return next })
  }
  function quitarTrabajoPuntual(idx: number) {
    if (!window.confirm('¿Seguro que quieres quitar este trabajo puntual?')) return
    setTrabajosPuntuales(prev => prev.filter((_, i) => i !== idx))
  }

  // Subida genérica de captura (comprobante/foto) para Cobros, Subcontratos y Trabajo
  // puntual -- sube la imagen y además la manda a leer con la misma IA que ya lee el
  // comprobante de Pago semanal (/api/parse-comprobante, piensa en captura de
  // transferencia): así el monto se completa solo y Gustavo no tiene que tipearlo a
  // mano ni arriesgarse a un error de dedo. Si la IA no puede leerlo, avisa y deja
  // completar a mano -- igual criterio que la boleta de Compras.
  async function subirCaptura(prefijo: string, archivo: File): Promise<string | null> {
    const ext = archivo.name.split('.').pop() || 'jpg'
    const filename = `${prefijo}-${Date.now()}.${ext}`
    const { data, error } = await supabase.storage.from('audio-notas').upload(filename, archivo, { contentType: archivo.type })
    if (error) {
      alert('Error al subir la captura: ' + error.message)
      return null
    }
    const { data: urlData } = supabase.storage.from('audio-notas').getPublicUrl(data.path)
    return urlData.publicUrl
  }

  async function leerMontoDeCaptura(url: string): Promise<number | null> {
    const res = await fetch('/api/parse-comprobante', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
    })
    const resultado = await res.json()
    if (!res.ok) throw new Error(resultado.error || 'error desconocido')
    return resultado.monto != null ? Number(resultado.monto) : null
  }

  async function subirCapturaCobro(idx: number, archivo: File) {
    setSubiendoComprobante(`cobro-${idx}`)
    try {
      const url = await subirCaptura('cobro', archivo)
      if (!url) return
      actualizarCobro(idx, { comprobanteUrl: url })
      try {
        const monto = await leerMontoDeCaptura(url)
        if (monto != null) actualizarCobro(idx, { monto: String(monto) })
      } catch (err) {
        alert('La captura se guardó, pero la IA no pudo leer el monto (' + String(err) + '). Complétalo a mano.')
      }
    } finally {
      setSubiendoComprobante(null)
    }
  }
  async function subirCapturaSubcontrato(idx: number, archivo: File) {
    setSubiendoComprobante(`subcontrato-${idx}`)
    try {
      const url = await subirCaptura('subcontrato', archivo)
      if (!url) return
      actualizarSubcontrato(idx, { comprobanteUrl: url })
      try {
        const monto = await leerMontoDeCaptura(url)
        if (monto != null) actualizarSubcontrato(idx, { monto: String(monto) })
      } catch (err) {
        alert('La captura se guardó, pero la IA no pudo leer el monto (' + String(err) + '). Complétalo a mano.')
      }
    } finally {
      setSubiendoComprobante(null)
    }
  }
  async function subirCapturaTrabajoPuntual(idx: number, archivo: File) {
    setSubiendoComprobante(`trabajo-${idx}`)
    try {
      const url = await subirCaptura('trabajo-puntual', archivo)
      if (!url) return
      actualizarTrabajoPuntual(idx, { comprobanteUrl: url })
      try {
        const monto = await leerMontoDeCaptura(url)
        if (monto != null) actualizarTrabajoPuntual(idx, { monto: String(monto) })
      } catch (err) {
        alert('La captura se guardó, pero la IA no pudo leer el monto (' + String(err) + '). Complétalo a mano.')
      }
    } finally {
      setSubiendoComprobante(null)
    }
  }

  async function enviarReporte() {
    setError(null)

    if (subiendoBoletaIdx !== null) {
      alert('Espera a que la IA termine de leer la boleta antes de guardar.')
      return
    }

    const filasDiarias = trabajadorNombres.filter(nombre => trabajadoresTocados.has(nombre)).map(nombre => {
      const t = trabajadores[nombre] || { ...DEFAULT_TRABAJADOR, presente: false }
      return {
        fecha,
        trabajador: nombre,
        presente: t.presente,
        obra: t.presente ? (t.obra || null) : null,
        fraccion_jornada: t.presente ? t.fraccionJornada : 0,
        // El sábado nunca lleva viático -- se fuerza acá además de en la UI para que un día
        // ya cargado mal (o el estado arrastrado de otro día) no lo vuelva a guardar en true.
        viatico: t.presente && !esSabado(fecha) ? t.viatico : false,
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

    // Aviso de posible duplicado -- mismo criterio que ya existe para cobros más abajo:
    // solo mira las compras NUEVAS (sin id, recién tipeadas/subidas ahora). Si ya hay una
    // compra guardada ese mismo día con el mismo monto, probablemente es la misma boleta
    // cargada dos veces sin querer (ej: se subió de nuevo por las dudas de si había
    // guardado la primera vez).
    for (const c of comprasValidas) {
      if (c.id || c.destino === 'gasto_empresa') continue
      const { data: existentes } = await supabase.from('reportes_compras').select('id, descripcion').eq('fecha', fecha).eq('monto', Number(c.monto)).limit(1)
      if (existentes && existentes.length > 0) {
        if (!window.confirm(`Ya hay una compra de $${c.monto} cargada hoy ("${existentes[0].descripcion}"). ¿Es una compra distinta (Aceptar) o la misma boleta cargada dos veces (Cancelar)?`)) {
          setSaving(false)
          return
        }
      }
    }

    // Las filas marcadas "Gasto de la empresa" no son compras: van a `gastos_variables`, que
    // es lo que lee Estado de resultados. Se separan acá y no entran a `reportes_compras` --
    // si entraran, le sumarían costo a una obra o quedarían como una compra sin destino.
    const gastosEmpresa = comprasValidas.filter(c => c.destino === 'gasto_empresa')
    const comprasDeVerdad = comprasValidas.filter(c => c.destino !== 'gasto_empresa')

    // Mismo borrar-y-reinsertar que las compras, pero SOLO sobre lo que se cargó desde acá
    // (`origen = 'reporte_diario'`). Sin ese filtro, guardar el día borraría los gastos
    // variables que Alexandra carga a mano desde Estado de resultados con la misma fecha.
    //
    // Se toca `gastos_variables` únicamente si hay algo que escribir o algo que borrar. Si
    // corriera siempre, mientras la migración no esté aplicada la columna `origen` no
    // existe, el delete falla y NADIE podría guardar un reporte diario -- una pantalla que
    // se usa todos los días caída por una función que quizá ni se está usando.
    const tocaGastos = gastosEmpresa.length > 0 || gastosEmpresaDelDia.length > 0
    if (tocaGastos) {
      const { error: eBorrarGastos } = await supabase
        .from('gastos_variables').delete().eq('fecha', fecha).eq('origen', 'reporte_diario')
      if (eBorrarGastos) {
        setError('No se pudieron guardar los gastos de la empresa. Puede que falte correr la migración sql/20260911_gastos_variables_desde_reporte.sql — avísale a Alexandra.')
        setSaving(false)
        return
      }
    }
    if (gastosEmpresa.length) {
      const { error: eGastos } = await supabase.from('gastos_variables').insert(
        gastosEmpresa.map(c => ({
          fecha,
          descripcion: c.descripcion.trim(),
          monto: Number(c.monto),
          foto_boleta_url: c.fotoBoletaUrl || null,
          origen: 'reporte_diario',
        })),
      )
      if (eGastos) {
        setError('No se pudieron guardar los gastos de la empresa. Intenta de nuevo.')
        setSaving(false)
        return
      }
    }

    // Borra las compras viejas del día -- el `on delete cascade` de `compra_items` limpia solo
    // el desglose de esas compras, no hace falta borrarlo aparte.
    await supabase.from('reportes_compras').delete().eq('fecha', fecha)
    if (comprasDeVerdad.length) {
      // Se inserta una por una (no en bloque) para poder vincular el desglose de ítems al ID
      // real de cada compra -- un insert en bloque no garantiza el orden de vuelta.
      for (const c of comprasDeVerdad) {
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
          // El precio entra junto con el material (09/09): sin él, cuando ese material se
          // entregue a una obra no se le puede cargar ningún costo y el margen de esa obra
          // saldría más alto de lo real. Si no hay desglose, el precio es el monto completo
          // de la compra, que es lo único que se sabe.
          const materialesAIngresar = itemsValidos.length
            ? itemsValidos.map(it => ({
                nombre: it.descripcion.trim(),
                cantidad: Number(it.cantidad) > 0 ? Number(it.cantidad) : 1,
                precio: Number(it.precioUnitario),
              }))
            : [{ nombre: c.descripcion.trim(), cantidad: 1, precio: Number(c.monto) }]
          for (const m of materialesAIngresar) {
            // Con precio primero; si la migración sql/20260909_stock_vales_de_entrega.sql
            // todavía no se corrió, la columna no existe y el upsert falla ENTERO. En ese
            // caso se guarda sin precio antes que perder la entrada al stock: el reporte
            // diario no se puede quedar sin guardar por esto.
            let material: { id: string } | null = null
            const conPrecio = await supabase
              .from('materiales')
              .upsert({ nombre: m.nombre, precio_unitario: m.precio }, { onConflict: 'nombre', ignoreDuplicates: false })
              .select('id')
              .single()
            if (!conPrecio.error) {
              material = conPrecio.data as { id: string }
            } else {
              const sinPrecio = await supabase
                .from('materiales')
                .upsert({ nombre: m.nombre }, { onConflict: 'nombre', ignoreDuplicates: false })
                .select('id')
                .single()
              material = (sinPrecio.data as { id: string }) || null
            }
            if (material) {
              const movimiento = {
                material_id: material.id,
                tipo: 'entrada',
                cantidad: m.cantidad,
                fecha,
                compra_id: compraInsertada.id,
              }
              const { error: eConPrecio } = await supabase
                .from('movimientos_stock')
                .insert({ ...movimiento, precio_unitario: m.precio })
              if (eConPrecio) await supabase.from('movimientos_stock').insert(movimiento)
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
        cobrosParaLegado.map(c => ({ fecha, obra: c.obra || null, cliente: c.cliente.trim(), monto: Number(c.monto), comprobante_url: c.comprobanteUrl || null }))
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
        cobrosNuevosParaCuenta.map(c => ({ cuenta_id: c.cuentaId, fecha, monto: Number(c.fila.monto), comprobante_url: c.fila.comprobanteUrl || null }))
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
        subcontratosValidos.map(s => ({ fecha, obra: s.obra || null, subcontrato: s.subcontrato.trim(), monto: Number(s.monto), comprobante_url: s.comprobanteUrl || null }))
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
        trabajosValidos.map(p => ({ fecha, descripcion: p.descripcion.trim(), direccion: p.direccion.trim() || null, trabajador: p.trabajador || null, monto: p.monto.trim() ? Number(p.monto) : null, comprobante_url: p.comprobanteUrl || null }))
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
    setTimeout(() => setSaved(false), 7000)
    // OJO -- se probó dejar el formulario en blanco tras guardar (pedido inicial de
    // Alexandra) pero se revirtió: como el guardado borra TODAS las compras/cobros/etc. del
    // día y reinserta solo lo que hay en el formulario, un formulario vacío en el segundo
    // guardado del mismo día borraba lo ya guardado en el primero (bug real, encontrado
    // antes de que pasara con datos reales). Se vuelve a recargar el día completo -- para
    // sumar otra compra/cobro sin perder lo anterior, se usa "+ Agregar..." como siempre.
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
        {saved && (
          <div style={{ padding: '16px 18px', background: '#1f6b3f', borderRadius: 12, marginBottom: '1.25rem', textAlign: 'center' }}>
            <p style={{ fontSize: 16, color: '#fff', fontWeight: 800 }}>
              ✓ Reporte guardado correctamente
            </p>
            <p style={{ fontSize: 13, color: 'rgba(255,255,255,0.85)', marginTop: 2 }}>
              Las compras ya guardadas quedaron cerraditas más abajo (✓). Para agregar otra boleta, tocá "+ Agregar compra".
            </p>
          </div>
        )}
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
            {esSabado(fecha) && viaticoViejoEsteDia && (
              <div style={{
                background: '#fef3c7', border: '1px solid #fde68a', color: 'var(--text)',
                borderRadius: 10, padding: '10px 14px', marginBottom: 12, fontSize: 13, lineHeight: 1.5,
              }}>
                Este sábado quedó guardado <strong>con viático</strong> de antes. Acá abajo ya se ve
                corregido, pero Pago Semanal va a seguir contándolo hasta que toques
                <strong> "Guardar reporte del día"</strong>.
              </div>
            )}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 24 }}>
              {trabajadorNombres.map(nombre => {
                const t = trabajadores[nombre]
                if (!t) return null
                const esFabriel = nombre === 'Fabriel'
                const colapsado = t.presente && trabajadoresColapsados.has(nombre)
                if (colapsado) {
                  const jornadaLabel = t.fraccionJornada === 1 ? 'Día completo' : 'Medio día'
                  return (
                    <div key={nombre} className="card" style={{ padding: '10px 14px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0, flexWrap: 'wrap' }}>
                        <span style={{ color: '#1f6b3f', fontWeight: 800, flexShrink: 0 }}>✓</span>
                        <span style={{ fontSize: 14, fontWeight: 700 }}>{nombre}</span>
                        <span style={{ fontSize: 13, color: 'var(--muted)' }}>{t.obra || 'sin obra'} · {jornadaLabel}{t.viatico && !esSabado(fecha) ? '' : ' · sin viático'}</span>
                        {t.adelanto.trim() && (
                          <span style={{ fontSize: 13, color: 'var(--muted)' }}>· ${Number(t.adelanto).toLocaleString('es-CL')}</span>
                        )}
                      </div>
                      <button
                        type="button"
                        className="btn btn-ghost"
                        onClick={() => setTrabajadoresColapsados(prev => { const next = new Set(prev); next.delete(nombre); return next })}
                        style={{ fontSize: 12, flexShrink: 0 }}
                      >Editar</button>
                    </div>
                  )
                }
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
                          <p style={{ fontSize: 12, color: 'var(--muted)', background: 'var(--surface-alt)', padding: '6px 10px', borderRadius: 8 }}>
                            Fabriel tiene sueldo fijo mensual + bono. Aquí solo registra asistencia y viático, no ingreses un monto de sueldo del día.
                          </p>
                        )}
                        <div className="field">
                          <label>Obra</label>
                          <select
                            value={t.obra}
                            onChange={e => actualizarTrabajador(nombre, { obra: e.target.value, viatico: viaticoCorresponde(e.target.value, fecha) })}
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
                          {esSabado(fecha) ? (
                            <p style={{ fontSize: 13, fontWeight: 600, color: 'var(--muted)', paddingTop: 22 }}>
                              Sábado: sin viático
                            </p>
                          ) : (
                            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, fontWeight: 600, color: t.viatico ? 'var(--text)' : 'var(--danger)', paddingTop: 22, cursor: 'pointer' }}>
                              <input
                                type="checkbox"
                                checked={!t.viatico}
                                onChange={e => actualizarTrabajador(nombre, { viatico: !e.target.checked })}
                                style={{ width: 18, height: 18, accentColor: 'var(--danger)', cursor: 'pointer' }}
                              />
                              Sin viático hoy
                            </label>
                          )}
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
              {compras.map((c, idx) => {
                const colapsada = !!(c.id && comprasColapsadas.has(c.id))
                if (colapsada) {
                  return (
                    <div key={idx} className="card" style={{ padding: '10px 14px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                        <span style={{ color: '#1f6b3f', fontWeight: 800, flexShrink: 0 }}>✓</span>
                        <span style={{ fontSize: 14, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.descripcion}</span>
                        <span style={{ fontSize: 13, color: 'var(--muted)', flexShrink: 0 }}>${Number(c.monto).toLocaleString('es-CL')}</span>
                        {c.destino === 'gasto_empresa' && (
                          <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)', flexShrink: 0 }}>Gasto de la empresa</span>
                        )}
                      </div>
                      <button
                        type="button"
                        className="btn btn-ghost"
                        onClick={() => setComprasColapsadas(prev => { const next = new Set(prev); next.delete(c.id!); return next })}
                        style={{ fontSize: 12, flexShrink: 0 }}
                      >Editar</button>
                    </div>
                  )
                }
                return (
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
                        <label>¿A dónde va?</label>
                        <select
                          value={c.obra || (c.destino ? `__${c.destino}__` : '')}
                          onChange={e => {
                            const v = e.target.value
                            if (v.startsWith('__')) {
                              actualizarCompra(idx, { obra: '', destino: v.replace(/^__|__$/g, '') as 'stock' | 'trabajo_puntual' | 'gasto_empresa' })
                            } else {
                              actualizarCompra(idx, { obra: v, destino: '' })
                            }
                          }}
                        >
                          <option value="">Selecciona...</option>
                          {obras.map(o => <option key={o} value={o}>{o}</option>)}
                          <option value="__stock__">Stock (sin obra todavía)</option>
                          <option value="__gasto_empresa__">Gasto de la empresa (no es de una obra)</option>
                          <option value="__trabajo_puntual__">Trabajo puntual (sin obra)</option>
                        </select>
                      </div>
                    </div>

                    {/* La regla, donde se carga. Estaba escrita solo en la ayuda del Estado de
                        Resultados, que es justo donde Gustavo no entra -- y por eso hoy hay
                        combustible cargado como compra de O'Higgins y también como gasto
                        variable de la empresa, el mismo gasto en dos lados. */}
                    <p style={{ fontSize: 12, color: 'var(--muted)', marginTop: -4, lineHeight: 1.45 }}>
                      {c.destino === 'gasto_empresa'
                        ? 'Se guarda como gasto variable de la empresa, no como costo de ninguna obra. Aparece en Estado de resultados.'
                        : c.destino === 'stock'
                          ? 'Entra a bodega sin obra. El costo se le carga a una obra recién cuando el material sale con su vale de entrega.'
                          : 'Si el gasto es de UNA obra, elige la obra. Si compraste materiales para varias, elige Stock. Si no es material de obra (combustible, peaje, herramientas), elige Gasto de la empresa.'}
                    </p>

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
                      {/* Gustavo va acá (11/09). Lo pidió él: "si yo hago unas compras y yo no
                          cargo, entonces no me van a transferir". Faltaba en la lista porque
                          no está en `trabajadores`, así que su gasto con tarjeta no existía
                          en la app -- 43 de 44 compras figuraban como de la caja. */}
                      <select value={c.pagadoPor} onChange={e => actualizarCompra(idx, { pagadoPor: e.target.value })}>
                        <option value="">Caja de la empresa</option>
                        {quienLoHizo.map(n => <option key={n} value={n}>{n} (con su propia plata — hay que reembolsarle)</option>)}
                      </select>
                    </div>
                    <button type="button" className="btn btn-ghost" onClick={() => quitarCompra(idx)} style={{ alignSelf: 'flex-end', fontSize: 13 }}>
                      ✕ Quitar
                    </button>
                  </div>
                </div>
                )
              })}
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
              {cobros.map((c, idx) => {
                const colapsado = !!(c.id && c.origen !== 'abono_cuenta' && cobrosColapsados.has(c.id))
                if (colapsado) {
                  return (
                    <div key={idx} className="card" style={{ padding: '10px 14px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0, flexWrap: 'wrap' }}>
                        <span style={{ color: '#1f6b3f', fontWeight: 800, flexShrink: 0 }}>✓</span>
                        <span style={{ fontSize: 14, fontWeight: 700 }}>{c.cliente}</span>
                        <span style={{ fontSize: 13, color: 'var(--muted)' }}>{c.obra || 'sin obra'} · ${Number(c.monto).toLocaleString('es-CL')}</span>
                      </div>
                      <button
                        type="button"
                        className="btn btn-ghost"
                        onClick={() => setCobrosColapsados(prev => { const next = new Set(prev); next.delete(c.id!); return next })}
                        style={{ fontSize: 12, flexShrink: 0 }}
                      >Editar</button>
                    </div>
                  )
                }
                return (
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
                      {/* La obra va primero porque es la que manda: al elegirla se completa
                          solo el cliente, y el nombre de abajo pasa a ser solo "quién pagó".
                          Antes había que escribir el cliente a mano y quedaba distinto del de
                          su ficha (pasó de verdad: "Elsie Goycoolea" contra "Elsie Goycoolea
                          propiedades Ltda"). Ver decisiones.md 2026-09-08. */}
                      <div style={{ display: 'flex', gap: 10 }}>
                        <div className="field" style={{ flex: 1 }}>
                          <label>Obra</label>
                          <select
                            value={c.obra}
                            onChange={e => {
                              const obra = e.target.value
                              const clienteDeLaObra = clientePorObra[obra]
                              // Solo completa si está vacío o si tenía el cliente de la obra
                              // anterior: nunca pisa un nombre escrito a mano.
                              const pisable = !c.cliente.trim() || c.cliente === clientePorObra[c.obra]
                              actualizarCobro(idx, pisable && clienteDeLaObra ? { obra, cliente: clienteDeLaObra } : { obra })
                            }}
                          >
                            <option value="">Selecciona...</option>
                            {obras.map(o => <option key={o} value={o}>{o}</option>)}
                          </select>
                        </div>
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
                      </div>
                      <div className="field">
                        <label>Quién pagó</label>
                        <input
                          type="text"
                          placeholder="Nombre de quien transfirió"
                          value={c.cliente}
                          onChange={e => actualizarCobro(idx, { cliente: e.target.value })}
                        />
                        {c.obra && clientePorObra[c.obra] && (
                          <p style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4 }}>
                            {c.cliente === clientePorObra[c.obra]
                              ? `Cliente de la obra: ${clientePorObra[c.obra]}`
                              : `Se guarda igual para ${clientePorObra[c.obra]}, que es el cliente de esta obra.`}
                          </p>
                        )}
                      </div>
                      <div>
                        <label className="btn btn-secondary" style={{ display: 'inline-block', fontSize: 13, cursor: subiendoComprobante === `cobro-${idx}` ? 'default' : 'pointer', opacity: subiendoComprobante === `cobro-${idx}` ? 0.6 : 1 }}>
                          {subiendoComprobante === `cobro-${idx}` ? 'Leyendo captura...' : c.comprobanteUrl ? 'Cambiar captura' : '+ Subir captura'}
                          <input
                            type="file"
                            accept="image/*"
                            disabled={subiendoComprobante === `cobro-${idx}`}
                            style={{ display: 'none' }}
                            onChange={e => {
                              const archivo = e.target.files?.[0]
                              e.target.value = ''
                              if (archivo) subirCapturaCobro(idx, archivo)
                            }}
                          />
                        </label>
                        {c.comprobanteUrl && (
                          <a href={c.comprobanteUrl} target="_blank" rel="noreferrer" style={{ marginLeft: 10, fontSize: 12, color: 'var(--primary)', fontWeight: 600 }}>
                            Ver captura
                          </a>
                        )}
                        <p style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4 }}>
                          Sube la captura y la IA completa el monto — revísalo antes de guardar.
                        </p>
                      </div>
                      <button type="button" className="btn btn-ghost" onClick={() => quitarCobro(idx)} style={{ alignSelf: 'flex-end', fontSize: 13 }}>
                        ✕ Quitar
                      </button>
                    </div>
                  )}
                </div>
                )
              })}
            </div>
            <button type="button" className="btn btn-secondary" onClick={agregarCobro} style={{ width: '100%', marginBottom: 28 }}>
              + Agregar cobro
            </button>

            {/* Abonos a subcontratistas. 11/09: antes decía "Subcontratos" a secas y Gustavo
                cargó acá los $1.088.550 del trato completo con Gabriel creyendo que estaba
                creando el contrato -- lo que hizo fue registrar que ya se lo había pagado
                entero. El contrato se crea en Obras -> Detalle -> Subcontratistas; acá van
                los abonos, uno por cada transferencia. */}
            <h2 style={{ fontSize: 15, fontWeight: 800, marginBottom: 4 }}>Abonos a subcontratistas</h2>
            <p style={{ fontSize: 12.5, color: 'var(--muted)', marginBottom: 10, lineHeight: 1.45 }}>
              Cada transferencia que se le hace a un subcontratista. El trato completo no va acá: ese se carga
              una sola vez en Obras → Detalle de la obra → Subcontratistas.
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 12 }}>
              {subcontratos.map((s, idx) => {
                const colapsado = !!(s.id && subcontratosColapsados.has(s.id))
                if (colapsado) {
                  return (
                    <div key={idx} className="card" style={{ padding: '10px 14px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0, flexWrap: 'wrap' }}>
                        <span style={{ color: '#1f6b3f', fontWeight: 800, flexShrink: 0 }}>✓</span>
                        <span style={{ fontSize: 14, fontWeight: 700 }}>{s.subcontrato}</span>
                        <span style={{ fontSize: 13, color: 'var(--muted)' }}>{s.obra || 'sin obra'} · ${Number(s.monto).toLocaleString('es-CL')}</span>
                      </div>
                      <button
                        type="button"
                        className="btn btn-ghost"
                        onClick={() => setSubcontratosColapsados(prev => { const next = new Set(prev); next.delete(s.id!); return next })}
                        style={{ fontSize: 12, flexShrink: 0 }}
                      >Editar</button>
                    </div>
                  )
                }
                return (
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
                    {s.obra && !obrasConContrato.has(s.obra) && (
                      <p style={{ fontSize: 12, color: 'var(--primary)', fontWeight: 600, lineHeight: 1.45, margin: 0 }}>
                        Esta obra todavía no tiene cargado el trato con su subcontratista, así que este abono se
                        va a leer como si fuera el costo total de la obra. Carga primero el trato en Obras →
                        Detalle de la obra → Subcontratistas.
                      </p>
                    )}
                    <div>
                      <label className="btn btn-secondary" style={{ display: 'inline-block', fontSize: 13, cursor: subiendoComprobante === `subcontrato-${idx}` ? 'default' : 'pointer', opacity: subiendoComprobante === `subcontrato-${idx}` ? 0.6 : 1 }}>
                        {subiendoComprobante === `subcontrato-${idx}` ? 'Leyendo captura...' : s.comprobanteUrl ? 'Cambiar captura' : '+ Subir captura'}
                        <input
                          type="file"
                          accept="image/*"
                          disabled={subiendoComprobante === `subcontrato-${idx}`}
                          style={{ display: 'none' }}
                          onChange={e => {
                            const archivo = e.target.files?.[0]
                            e.target.value = ''
                            if (archivo) subirCapturaSubcontrato(idx, archivo)
                          }}
                        />
                      </label>
                      {s.comprobanteUrl && (
                        <a href={s.comprobanteUrl} target="_blank" rel="noreferrer" style={{ marginLeft: 10, fontSize: 12, color: 'var(--primary)', fontWeight: 600 }}>
                          Ver captura
                        </a>
                      )}
                      <p style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4 }}>
                        Sube la captura y la IA completa el monto — revísalo antes de guardar.
                      </p>
                    </div>
                    <button type="button" className="btn btn-ghost" onClick={() => quitarSubcontrato(idx)} style={{ alignSelf: 'flex-end', fontSize: 13 }}>
                      ✕ Quitar
                    </button>
                  </div>
                </div>
                )
              })}
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
              {trabajosPuntuales.map((p, idx) => {
                const colapsado = !!(p.id && trabajosPuntualesColapsados.has(p.id))
                if (colapsado) {
                  return (
                    <div key={idx} className="card" style={{ padding: '10px 14px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0, flexWrap: 'wrap' }}>
                        <span style={{ color: '#1f6b3f', fontWeight: 800, flexShrink: 0 }}>✓</span>
                        <span style={{ fontSize: 14, fontWeight: 700 }}>{p.descripcion}</span>
                        <span style={{ fontSize: 13, color: 'var(--muted)' }}>{p.direccion || 'sin dirección'}{p.monto.trim() ? ` · $${Number(p.monto).toLocaleString('es-CL')}` : ''}</span>
                      </div>
                      <button
                        type="button"
                        className="btn btn-ghost"
                        onClick={() => setTrabajosPuntualesColapsados(prev => { const next = new Set(prev); next.delete(p.id!); return next })}
                        style={{ fontSize: 12, flexShrink: 0 }}
                      >Editar</button>
                    </div>
                  )
                }
                return (
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
                    <div>
                      <label className="btn btn-secondary" style={{ display: 'inline-block', fontSize: 13, cursor: subiendoComprobante === `trabajo-${idx}` ? 'default' : 'pointer', opacity: subiendoComprobante === `trabajo-${idx}` ? 0.6 : 1 }}>
                        {subiendoComprobante === `trabajo-${idx}` ? 'Leyendo captura...' : p.comprobanteUrl ? 'Cambiar captura' : '+ Subir captura'}
                        <input
                          type="file"
                          accept="image/*"
                          disabled={subiendoComprobante === `trabajo-${idx}`}
                          style={{ display: 'none' }}
                          onChange={e => {
                            const archivo = e.target.files?.[0]
                            e.target.value = ''
                            if (archivo) subirCapturaTrabajoPuntual(idx, archivo)
                          }}
                        />
                      </label>
                      {p.comprobanteUrl && (
                        <a href={p.comprobanteUrl} target="_blank" rel="noreferrer" style={{ marginLeft: 10, fontSize: 12, color: 'var(--primary)', fontWeight: 600 }}>
                          Ver captura
                        </a>
                      )}
                      <p style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4 }}>
                        Sube la captura y la IA completa el monto — revísalo antes de guardar.
                      </p>
                    </div>
                    <button type="button" className="btn btn-ghost" onClick={() => quitarTrabajoPuntual(idx)} style={{ alignSelf: 'flex-end', fontSize: 13 }}>
                      ✕ Quitar
                    </button>
                  </div>
                </div>
                )
              })}
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
