import Admin from './pages/Admin'
import Gustavo from './pages/Gustavo'

export default function App() {
  const path = window.location.pathname
  const params = new URLSearchParams(window.location.search)

  if (path === '/g') {
    return <Gustavo token={params.get('t')} />
  }

  if (path === '/admin') {
    return <Admin />
  }

  if (path === '/') {
    window.location.replace('/admin')
    return null
  }

  return (
    <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--muted)' }}>
      Página no encontrada
    </div>
  )
}
