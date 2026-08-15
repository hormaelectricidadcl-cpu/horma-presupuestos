import Presupuesto from './pages/Presupuesto'
import PresupuestoEtapas from './pages/PresupuestoEtapas'
import Admin from './pages/Admin'
import Gustavo from './pages/Gustavo'
import Reporte from './pages/Reporte'
// Irazú: ruta /i desactivada a pedido (queda el código en Irazu.tsx sin usar,
// el historial de lo que ya respondió sigue visible en Admin).

export default function App() {
  const path = window.location.pathname
  const params = new URLSearchParams(window.location.search)

  if (path === '/g') return <Gustavo token={params.get('t')} />
  if (path === '/reporte') return <Reporte token={params.get('t')} />
  if (path === '/admin') return <Admin />
  if (path === '/itemizado') return <PresupuestoEtapas />

  return <Presupuesto />
}
