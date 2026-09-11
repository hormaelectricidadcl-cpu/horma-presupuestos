import Presupuesto from './pages/Presupuesto'
import PresupuestoEtapas from './pages/PresupuestoEtapas'
import Admin from './pages/Admin'
import Gustavo from './pages/Gustavo'
import Reporte from './pages/Reporte'
import ObraFotos from './pages/ObraFotos'
// Irazú: ruta /i desactivada a pedido (queda el código en Irazu.tsx sin usar,
// el historial de lo que ya respondió sigue visible en Admin).

export default function App() {
  const path = window.location.pathname
  const params = new URLSearchParams(window.location.search)

  if (path === '/g') return <Gustavo token={params.get('t')} />
  if (path === '/reporte') return <Reporte token={params.get('t')} />
  if (path === '/obra-fotos') return <ObraFotos token={params.get('t')} />
  if (path === '/admin') return <Admin />
  if (path === '/itemizado') return <PresupuestoEtapas />

  // El presupuestador se abre en una pestaña aparte desde el panel ("Crear adicionales", o
  // desde un pendiente), y ahí quedaba sin salida: Alexandra lo pidió el 10/09 -- "¿cómo
  // vuelvo? poner un botón de volver". El botón ya existía en el componente, solo que esta
  // ruta nunca le pasaba el onVolver. Se intenta cerrar la pestaña (que es lo que uno quiere
  // cuando vino del panel) y si el navegador no deja, se vuelve atrás en el historial.
  const vinoDelPanel = params.has('desde_presupuesto') || params.has('desde_pendiente')
  return (
    <Presupuesto
      token={params.get('t')}
      onVolver={vinoDelPanel ? () => { window.close(); if (!window.closed) window.history.back() } : undefined}
    />
  )
}
