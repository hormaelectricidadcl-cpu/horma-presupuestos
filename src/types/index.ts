export type TipoPendiente = 'confirmar_visita' | 'revisar_fotos' | 'presupuesto' | 'otro' | 'emitir_boleta' | 'emitir_factura' | 'cobro'
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
  pagado_por?: string | null
  reembolsado?: boolean
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
}

export interface Obra {
  id: string
  nombre: string
  cliente: string | null
  presupuesto_total: number | null
  activa: boolean
}

export interface Trabajador {
  id: string
  nombre: string
  tarifa_diaria: number
  viatico_diario: number
}
