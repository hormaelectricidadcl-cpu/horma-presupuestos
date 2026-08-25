import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import type { PendienteMensaje } from '../types'

// Hilo de conversación de un pendiente -- aparte de `pendientes.respuesta`/`estado` (que
// sigue siendo la respuesta final y el marcador de resuelto, sin tocar). Esto es para el ida
// y vuelta que pasa antes de llegar a esa respuesta final: Alexandra y Gustavo pueden sumar
// mensajes sin cerrar el pendiente.
export function HiloPendiente({ pendienteId, autor, respuestaLegado }: {
  pendienteId: string
  autor: 'gustavo' | 'irazu'
  // Pendientes viejos ya tenían una respuesta única antes de que existiera este hilo -- se
  // muestra como el primer mensaje del hilo (de solo lectura) para no perder ese historial.
  respuestaLegado?: string | null
}) {
  const [mensajes, setMensajes] = useState<PendienteMensaje[]>([])
  const [loading, setLoading] = useState(true)
  const [texto, setTexto] = useState('')
  const [enviando, setEnviando] = useState(false)

  const cargar = useCallback(async () => {
    const { data } = await supabase
      .from('pendiente_mensajes')
      .select('*')
      .eq('pendiente_id', pendienteId)
      .order('created_at', { ascending: true })
    setMensajes((data as PendienteMensaje[]) || [])
    setLoading(false)
  }, [pendienteId])

  useEffect(() => { cargar() }, [cargar])

  async function enviar() {
    if (!texto.trim()) return
    setEnviando(true)
    const { error } = await supabase.from('pendiente_mensajes').insert({
      pendiente_id: pendienteId,
      autor,
      texto: texto.trim(),
    })
    setEnviando(false)
    if (error) {
      alert('No se pudo enviar el mensaje. Intenta de nuevo.')
      return
    }
    setTexto('')
    cargar()
  }

  const nombreAutor = (a: 'gustavo' | 'irazu') => a === 'gustavo' ? 'Gustavo' : 'Alexandra'

  if (loading) return <div className="spinner" />

  return (
    <div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 12 }}>
        {respuestaLegado && mensajes.length === 0 && (
          <div style={{ alignSelf: 'flex-start', maxWidth: '85%', background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 10, padding: '8px 12px' }}>
            <p style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)', marginBottom: 3 }}>Respuesta anterior</p>
            <p style={{ fontSize: 13, lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>{respuestaLegado}</p>
          </div>
        )}
        {mensajes.length === 0 && !respuestaLegado ? (
          <p style={{ fontSize: 13, color: 'var(--muted)', textAlign: 'center', padding: '8px 0' }}>Sin mensajes todavía.</p>
        ) : (
          mensajes.map(m => {
            const esPropio = m.autor === autor
            return (
              <div
                key={m.id}
                style={{
                  alignSelf: esPropio ? 'flex-end' : 'flex-start',
                  maxWidth: '85%',
                  background: esPropio ? 'var(--primary)' : 'var(--bg)',
                  color: esPropio ? '#fff' : 'var(--text)',
                  border: esPropio ? 'none' : '1px solid var(--border)',
                  borderRadius: 10,
                  padding: '8px 12px',
                }}
              >
                <p style={{ fontSize: 11, fontWeight: 700, opacity: 0.8, marginBottom: 3 }}>{nombreAutor(m.autor)}</p>
                <p style={{ fontSize: 13, lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>{m.texto}</p>
              </div>
            )
          })
        )}
      </div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
        <textarea
          value={texto}
          onChange={e => setTexto(e.target.value)}
          placeholder="Escribe un mensaje..."
          rows={2}
          style={{ flex: 1 }}
        />
        <button className="btn btn-secondary" onClick={enviar} disabled={enviando || !texto.trim()} style={{ flexShrink: 0 }}>
          {enviando ? 'Enviando...' : 'Responder'}
        </button>
      </div>
    </div>
  )
}
