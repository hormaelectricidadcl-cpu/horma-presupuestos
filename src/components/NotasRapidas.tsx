import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'

interface Nota { id: string; texto: string; hecho: boolean; autor: 'alexandra' | 'gustavo' }

export function NotasRapidas({ autor }: { autor: 'alexandra' | 'gustavo' }) {
  const [notas, setNotas] = useState<Nota[]>([])
  const [input, setInput] = useState('')

  useEffect(() => {
    supabase.from('notas_rapidas').select('*').eq('autor', autor).order('created_at')
      .then(({ data }) => setNotas((data as Nota[]) || []))
  }, [autor])

  async function agregar() {
    const texto = input.trim()
    if (!texto) return
    const { data } = await supabase.from('notas_rapidas').insert({ texto, hecho: false, autor }).select().single()
    if (data) setNotas(prev => [...prev, data as Nota])
    setInput('')
  }

  async function toggleHecho(n: Nota) {
    await supabase.from('notas_rapidas').update({ hecho: !n.hecho }).eq('id', n.id)
    setNotas(prev => prev.map(x => x.id === n.id ? { ...x, hecho: !x.hecho } : x))
  }

  async function eliminar(id: string) {
    await supabase.from('notas_rapidas').delete().eq('id', id)
    setNotas(prev => prev.filter(x => x.id !== id))
  }

  async function limpiarCompletadas() {
    const ids = notas.filter(n => n.hecho).map(n => n.id)
    if (ids.length) await supabase.from('notas_rapidas').delete().in('id', ids)
    setNotas(prev => prev.filter(n => !n.hecho))
  }

  const pendientes = notas.filter(n => !n.hecho)
  const hechas = notas.filter(n => n.hecho)

  return (
    <div className="card" style={{ marginBottom: '1.25rem', padding: '1rem 1.25rem' }}>
      <h3 style={{ fontSize: 13, fontWeight: 700, marginBottom: 10, color: 'var(--secondary)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
        Mis notas
      </h3>
      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        <input
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && agregar()}
          placeholder="Escribe una nota y presiona Enter..."
          style={{ flex: 1, padding: '9px 12px', borderRadius: 8, border: '1.5px solid var(--border)', fontSize: 14, background: 'var(--white)' }}
        />
        <button className="btn btn-primary" onClick={agregar} style={{ padding: '9px 18px', fontSize: 15, fontWeight: 700 }}>+</button>
      </div>
      {notas.length === 0 ? (
        <p style={{ fontSize: 13, color: 'var(--muted)', textAlign: 'center', padding: '4px 0 2px' }}>Ninguna nota por ahora.</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
          {pendientes.map(nota => (
            <div key={nota.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', background: 'var(--white)', borderRadius: 8, border: '1px solid var(--border)' }}>
              <input type="checkbox" checked={false} onChange={() => toggleHecho(nota)} style={{ width: 16, height: 16, flexShrink: 0, accentColor: 'var(--primary)', cursor: 'pointer' }} />
              <span style={{ flex: 1, fontSize: 14, lineHeight: 1.4 }}>{nota.texto}</span>
              <button onClick={() => eliminar(nota.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 15, color: 'var(--muted)', lineHeight: 1, padding: '0 2px', flexShrink: 0 }}>✕</button>
            </div>
          ))}
          {hechas.length > 0 && (
            <div style={{ borderTop: '1px solid var(--border)', paddingTop: 6, marginTop: 3 }}>
              {hechas.map(nota => (
                <div key={nota.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 10px', opacity: 0.5 }}>
                  <input type="checkbox" checked={true} onChange={() => toggleHecho(nota)} style={{ width: 16, height: 16, flexShrink: 0, accentColor: 'var(--primary)', cursor: 'pointer' }} />
                  <span style={{ flex: 1, fontSize: 13, textDecoration: 'line-through', color: 'var(--muted)' }}>{nota.texto}</span>
                  <button onClick={() => eliminar(nota.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 14, color: 'var(--muted)', lineHeight: 1, padding: '0 2px' }}>✕</button>
                </div>
              ))}
              <button onClick={limpiarCompletadas} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 12, color: 'var(--muted)', padding: '4px 10px', width: '100%', textAlign: 'right' }}>
                Limpiar completadas
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
