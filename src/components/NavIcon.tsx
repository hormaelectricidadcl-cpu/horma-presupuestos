/* Set de íconos lineales para la navegación de Gustavo/Admin — reemplaza
   el color-por-sección por un único set de íconos consistente. Sin
   librería externa, sin emojis (ver feedback_no_emojis_sin_pedir). */

export type NavIconName =
  | 'tareas' | 'reporte' | 'calendario' | 'obras' | 'pago' | 'historial'
  | 'trabajadores' | 'boletas' | 'facturas' | 'presupuestos' | 'presupuestador'
  | 'ideas' | 'notas' | 'clientes' | 'stock' | 'resultados' | 'banco_contenido' | 'gustavo'
  | 'avance' | 'consultas'

export function NavIcon({ name, color = '#14213D', size = 20 }: { name: NavIconName; color?: string; size?: number }) {
  const p = { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: color, strokeWidth: 1.5, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const }
  switch (name) {
    case 'tareas':
      return <svg {...p}><rect x="4" y="4" width="16" height="16" rx="3" /><path d="M8 12l2.5 2.5L16 9" /></svg>
    case 'reporte':
      return <svg {...p}><rect x="6" y="4" width="12" height="16" rx="2" /><rect x="9" y="2.3" width="6" height="3" rx="1" /><path d="M9 12l2 2 4-4" /></svg>
    case 'calendario':
      return <svg {...p}><rect x="4" y="5" width="16" height="15" rx="2" /><path d="M4 9.5h16" /><path d="M8 3v3.2M16 3v3.2" />
        <circle cx="9" cy="13.5" r="0.9" fill={color} stroke="none" /><circle cx="12" cy="13.5" r="0.9" fill={color} stroke="none" /><circle cx="15" cy="13.5" r="0.9" fill={color} stroke="none" /></svg>
    case 'obras':
      return <svg {...p}><path d="M5 21V7l7-4 7 4v14" /><path d="M3 21h18" /><rect x="10" y="15" width="4" height="6" /><rect x="7" y="10" width="2.4" height="2.4" /><rect x="14.6" y="10" width="2.4" height="2.4" /></svg>
    case 'pago':
      return <svg {...p}><rect x="3" y="6" width="18" height="13" rx="2" /><path d="M3 10h18" /><circle cx="16.4" cy="14.5" r="1" fill={color} stroke="none" /></svg>
    case 'historial':
      return <svg {...p}><circle cx="12" cy="13" r="8" /><path d="M12 9v4l3 2" /><path d="M9 2.6l-3 2M15 2.6l3 2" /></svg>
    case 'trabajadores':
      return <svg {...p}><circle cx="9" cy="8" r="3" /><path d="M3.3 20c0-3.3 2.5-6 5.7-6s5.7 2.7 5.7 6" /><circle cx="17.3" cy="9" r="2.3" /><path d="M20.7 20c0-2.6-1.6-4.9-3.9-5.7" /></svg>
    case 'boletas':
      return <svg {...p}><path d="M6 3h12v18l-2.5-1.5L13 21l-2.5-1.5L8 21l-2-1.5z" /><path d="M9 8h6M9 12h6M9 16h4" /></svg>
    case 'facturas':
      return <svg {...p}><path d="M7 3h7l4 4v14H7z" /><path d="M14 3v4h4" /><path d="M10 12.3h6M10 16h6" /></svg>
    case 'presupuestos':
      return <svg {...p}><path d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2z" /></svg>
    case 'presupuestador':
      return <svg {...p}><path d="M4 20l1-4.5L15.5 5l3.5 3.5L8.5 19 4 20z" /><path d="M13.5 6.5l3.5 3.5" /></svg>
    case 'ideas':
      return <svg {...p}><path d="M9.2 18h5.6" /><path d="M10.1 21h3.8" /><path d="M12 3a6 6 0 00-3.5 10.9c.6.5.9 1.1.9 1.8v.3h5.2v-.3c0-.7.3-1.3.9-1.8A6 6 0 0012 3z" /></svg>
    case 'notas':
      return <svg {...p}><path d="M6 3h9l3 3v15H6z" /><path d="M15 3v3h3" /><path d="M9 11h6M9 15h6" /></svg>
    case 'clientes':
      return <svg {...p}><circle cx="12" cy="12" r="9" /><circle cx="12" cy="10" r="3" /><path d="M6.3 18.5a6 6 0 0111.4 0" /></svg>
    case 'stock':
      return <svg {...p}><path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z" /><path d="M4.5 7.5L12 12l7.5-4.5" /><path d="M12 12v9" /></svg>
    case 'resultados':
      return <svg {...p}><path d="M4 21V10M10 21V4M16 21v-7M21 21H3" /></svg>
    case 'banco_contenido':
      return <svg {...p}><rect x="3" y="4" width="18" height="15" rx="2" /><circle cx="8.3" cy="9.3" r="1.6" /><path d="M3 15.5l5.3-5 4.2 4 3.2-3.2L21 16" /></svg>
    case 'gustavo':
      return <svg {...p}><path d="M4 5h16v11H9l-5 4z" /></svg>
    case 'avance':
      return <svg {...p}><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M7 15.5l3-4 3 2 4-6" /><circle cx="17" cy="7.5" r="1" fill={color} stroke="none" /></svg>
    case 'consultas':
      return <svg {...p}><path d="M4 5h16v11H9l-5 4z" /><path d="M8 9h8M8 12.5h5" /></svg>
  }
}
