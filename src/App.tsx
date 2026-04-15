import Presupuesto from './pages/Presupuesto'
import Admin from './pages/Admin'
import Gustavo from './pages/Gustavo'

export default function App() {
  const path = window.location.pathname
  const params = new URLSearchParams(window.location.search)

  // Vista de Gustavo (móvil)
  if (path === '/g') {
    return <Gustavo token={params.get('t')} />
  }

  // Panel de Alexandra
  if (path === '/admin') {
    return <Admin />
  }

  // App de presupuestos (ruta principal)
  return <Presupuesto />
}
