export type TipoPendiente = 'confirmar_visita' | 'revisar_fotos' | 'presupuesto' | 'otro'
export type EstadoPendiente = 'pendiente' | 'recordatorio_enviado' | 'respondido'

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
}

export interface NuevoPendiente {
  cliente_nombre: string
  tipo: TipoPendiente
  descripcion: string
  fecha_limite: string
  fecha_trabajo: string | null
  direccion: string | null
  drive_links: string[]
}
