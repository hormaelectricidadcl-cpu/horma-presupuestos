export type TipoPendiente = 'confirmar_visita' | 'revisar_fotos' | 'presupuesto' | 'otro' | 'emitir_boleta' | 'emitir_factura' | 'cobro' | 'seguimiento' | 'pedido_material' | 'solicitud_garantia'
export type EstadoPendiente = 'pendiente' | 'recordatorio_enviado' | 'respondido'
export type Destinatario = 'gustavo' | 'irazu'

export interface ItemPresupuesto {
  categoria: 'MATERIALES' | 'MANO DE OBRA'
  descripcion: string
  cantidad: number
  precioUnitario: number
}

export interface AccionPendiente {
  tipo: 'recordatorio' | 'items_generados' | 'pdf_generado' | 'visita_agendada'
  timestamp: string
}

export interface Pendiente {
  id: string
  created_at: string
  cliente_nombre: string
  cliente_id?: string | null
  tipo: TipoPendiente
  descripcion: string | null
  mensaje_cliente: string | null
  fecha_limite: string
  fecha_trabajo: string | null
  direccion: string | null
  drive_links: string[]
  estado: EstadoPendiente
  recordatorio_enviado_at: string | null
  respondido_at: string | null
  respuesta: string | null
  items: ItemPresupuesto[]
  acciones?: AccionPendiente[]
  audio_url?: string | null
  destinatario?: Destinatario
  revisado_admin?: boolean
}

export interface NuevoPendiente {
  cliente_nombre: string
  cliente_id?: string | null
  tipo: TipoPendiente
  descripcion: string
  mensaje_cliente: string
  fecha_limite: string
  fecha_trabajo: string | null
  direccion: string | null
  drive_links: string[]
  destinatario: Destinatario
}

export interface ReporteTrabajadorDia {
  id: string
  fecha: string
  trabajador: string
  presente: boolean
  obra: string | null
  fraccion_jornada: number
  viatico: boolean
  adelanto_monto: number | null
  tipo_pago?: 'adelanto' | 'pago_semanal'
}

export interface ReporteCompraDia {
  id: string
  fecha: string
  descripcion: string
  monto: number
  obra: string | null
  destino?: 'stock' | 'trabajo_puntual' | null
  pagado_por?: string | null
  reembolsado?: boolean
  foto_boleta_url?: string | null
}

export interface CompraItem {
  id: string
  created_at: string
  compra_id: string
  descripcion: string
  cantidad: number
  precio_unitario: number
}

export interface Material {
  id: string
  created_at: string
  nombre: string
  unidad: string | null
  stock_actual: number
}

export interface MovimientoStock {
  id: string
  created_at: string
  material_id: string
  tipo: 'entrada' | 'salida'
  cantidad: number
  fecha: string
  obra: string | null
  compra_id: string | null
  nota: string | null
}

export interface ReporteCobroDia {
  id: string
  fecha: string
  obra: string | null
  cliente: string
  monto: number
}

export interface ReporteSubcontratoDia {
  id: string
  fecha: string
  obra: string | null
  subcontrato: string
  monto: number
}

export interface ReporteTrabajoPuntualDia {
  id: string
  fecha: string
  descripcion: string
  direccion: string | null
  trabajador: string | null
  monto: number | null
}

export type EstadoPresupuesto = 'borrador' | 'enviado' | 'aceptado' | 'convertido'

export interface PresupuestoGuardado {
  id: string
  created_at: string
  cliente_id: string | null
  cliente_nombre: string | null
  cliente_telefono: string | null
  cliente_email: string | null
  cliente_direccion: string | null
  referencia: string | null
  tipo: 'simple' | 'etapas' | 'externo'
  estado: EstadoPresupuesto
  subtotal: number | null
  iva: number | null
  total: number | null
}

export interface PresupuestoItemSimple {
  id: number
  categoria: string
  description: string
  price: number
  quantity: number
  total: number
  servicio_sku?: string
}

export interface PresupuestoEtapaItem {
  subNumero: string
  descripcion: string
  cantidad: number
  precioUnitario: number
  tipo: 'MO' | 'MAT'
  total: number
}

export interface PresupuestoEtapa {
  numero: string
  nombre: string
  items: PresupuestoEtapaItem[]
  totalMO: number
  totalMAT: number
  total: number
}

export interface PresupuestoDetalle extends PresupuestoGuardado {
  gg_pct: number | null
  gg_amount: number | null
  items: PresupuestoItemSimple[] | null
  etapas: PresupuestoEtapa[] | null
  archivo_url: string | null
}

export interface ObraItem {
  id: string
  created_at: string
  obra_id: string
  fase: string | null
  descripcion: string
  categoria: string | null
  cantidad: number
  precio_unitario: number
  total: number
  cantidad_completada: number
  orden: number
}

export interface ObraFase {
  id: string
  created_at: string
  obra_id: string
  nombre: string
  orden: number
  fecha_inicio: string | null
  fecha_fin: string | null
}

// Bitácora de avance diario -- append-only, ver progress/decisiones.md 2026-08-28.
// `cantidad_completada` de ObraItem es un campo cacheado, mantenido por un trigger de
// Postgres a partir de la suma de estos registros -- nunca se escribe directo desde el
// frontend.
export interface ObraAvanceRegistro {
  id: string
  created_at: string
  obra_id: string
  item_id: string
  fecha: string
  cantidad_avanzada: number
  trabajador: string | null
  nota: string | null
}

export interface EventoCalendario {
  id: string
  created_at: string
  fecha: string
  hora_inicio: string
  hora_fin: string
  persona: string
  titulo: string
  cliente_nombre: string | null
  direccion: string | null
  notas: string | null
}

export interface PendienteMensaje {
  id: string
  created_at: string
  pendiente_id: string
  autor: 'gustavo' | 'irazu'
  texto: string
}

export interface ObraMedia {
  id: string
  created_at: string
  obra_id: string
  url: string
  tipo: 'foto' | 'video' | 'documento'
  descripcion: string | null
  subido_por: string | null
  // Banco de contenido (sql/20260826_obra_media_contenido.sql)
  lat: number | null
  lng: number | null
  momento: 'antes' | 'durante' | 'despues' | null
  autorizado_cliente: boolean
  destacado: boolean
}

export interface IdeaContenido {
  id: string
  created_at: string
  titulo: string
  hook: string | null
  formato: string | null
  tema: string | null
  estado: 'pendiente' | 'hecho'
}

export type EstadoObra = 'en_curso' | 'terminada_terreno' | 'facturada' | 'en_garantia' | 'cerrada'

export interface Obra {
  id: string
  nombre: string
  cliente: string | null
  presupuesto_total: number | null
  presupuesto_id?: string | null
  estado_obra: EstadoObra
  fecha_inicio: string | null
  fecha_fin: string | null
  garantia_hasta: string | null
  activa: boolean
}

export interface Trabajador {
  id: string
  nombre: string
  tarifa_diaria: number
  viatico_diario: number
  activo: boolean
  obra_asignada_id: string | null
}

export interface CuentaPorCobrar {
  id: string
  pagador: string
  concepto: string
  obra: string | null
  total_presupuesto: number
  activa: boolean
}

export interface AbonoCuenta {
  id: string
  cuenta_id: string
  fecha: string
  monto: number
  comprobante_url?: string | null
}

export interface SubcontratoMaster {
  id: string
  subcontratista: string
  obra: string | null
  trabajo: string | null
  total_contrato: number
}

export interface GastoFijo {
  id: string
  concepto: string
  categoria: string | null
  monto_mensual: number
  activo: boolean
  observaciones: string | null
  vigente_desde: string | null
}

export interface GastoVariable {
  id: string
  fecha: string
  categoria: string | null
  descripcion: string | null
  monto: number
}

export interface Factura {
  id: string
  fecha: string
  obra: string | null
  monto: number
}

export interface Cliente {
  id: string
  nombre: string
  telefono: string | null
  email: string | null
  rut: string | null
  comuna: string | null
  archivado: boolean
  archivado_at: string | null
  // Facturación (sql/20260826_clientes_facturacion.sql)
  razon_social: string | null
  giro: string | null
  direccion_fiscal: string | null
  // Marketing (sql/20260826_clientes_facturacion.sql)
  origen: string | null
  notas: string | null
}

export interface PagoSemanalComprobante {
  id: string
  created_at: string
  trabajador: string
  semana_key: string
  captura_url: string
  monto_leido: number | null
  monto_calculado: number | null
}

export interface AjustePagoSemanal {
  id: string
  created_at: string
  trabajador: string
  semana_key: string
  monto: number
  motivo: string
}

export interface AdelantoTrabajador {
  id: string
  created_at: string
  trabajador: string
  fecha: string
  monto: number
  comprobante_url: string | null
  nota: string | null
}
