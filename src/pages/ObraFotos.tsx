import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import type { ObraMedia } from '../types'
import { PanelAvanceObraCampo } from '../components/PanelesObra'

const FABRIEL_TOKEN = import.meta.env.VITE_FABRIEL_TOKEN as string
const MISAEL_TOKEN = import.meta.env.VITE_MISAEL_TOKEN as string

type Momento = 'antes' | 'durante' | 'despues'

const MOMENTOS: { key: Momento; label: string }[] = [
  { key: 'antes', label: 'Antes' },
  { key: 'durante', label: 'Durante' },
  { key: 'despues', label: 'Después' },
]

interface ObraSimple {
  id: string
  nombre: string
}

interface Props {
  token: string | null
}

// Pide la ubicación al navegador de forma best-effort: si el usuario la niega, el navegador no
// la soporta, o tarda demasiado, se resuelve con null en vez de rechazar -- nunca debe bloquear
// la subida de fotos/video por esto.
function pedirUbicacion(): Promise<{ lat: number; lng: number } | null> {
  return new Promise(resolve => {
    if (!navigator.geolocation) { resolve(null); return }
    const timeoutId = setTimeout(() => resolve(null), 8000)
    navigator.geolocation.getCurrentPosition(
      pos => { clearTimeout(timeoutId); resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }) },
      () => { clearTimeout(timeoutId); resolve(null) },
      { timeout: 7000 }
    )
  })
}

export default function ObraFotos({ token }: Props) {
  const trabajador = token === FABRIEL_TOKEN ? 'Fabriel' : token === MISAEL_TOKEN ? 'Misael' : null

  const [obras, setObras] = useState<ObraSimple[]>([])
  const [obraId, setObraId] = useState('')
  const [obraAsignada, setObraAsignada] = useState<ObraSimple | null>(null)
  const [vista, setVista] = useState<'fotos' | 'avance'>('fotos')
  const [momento, setMomento] = useState<Momento>('durante')
  const [archivos, setArchivos] = useState<File[]>([])
  const [inputKey, setInputKey] = useState(0)
  const [subiendo, setSubiendo] = useState(false)
  const [progreso, setProgreso] = useState<{ actual: number; total: number } | null>(null)
  const [resultado, setResultado] = useState<{ ok: number; fallidos: number } | null>(null)
  const [ubicacionOk, setUbicacionOk] = useState<boolean | null>(null)

  useEffect(() => {
    if (!trabajador) return
    pedirUbicacion().then(u => setUbicacionOk(u !== null))
  }, [trabajador])

  useEffect(() => {
    if (!trabajador) return
    // Si Alexandra/Gustavo le asignaron una obra específica a este trabajador (desde la
    // card de Trabajadores), su link queda fijo a esa obra -- sin desplegable, sin ver
    // las demás. Si no tiene asignación (obra_asignada_id null), sigue viendo todas las
    // obras en curso como antes, para no dejarlo sin poder subir nada.
    supabase.from('trabajadores').select('obra_asignada_id').eq('nombre', trabajador).maybeSingle().then(({ data }) => {
      const asignadaId = data?.obra_asignada_id as string | null | undefined
      if (asignadaId) {
        supabase.from('obras').select('id, nombre').eq('id', asignadaId).maybeSingle().then(({ data: obra }) => {
          if (obra) { setObraAsignada(obra as ObraSimple); setObraId((obra as ObraSimple).id) }
        })
      } else {
        supabase.from('obras').select('id, nombre').eq('estado_obra', 'en_curso').order('nombre').then(({ data: lista }) => {
          setObras((lista as ObraSimple[]) || [])
        })
      }
    })
  }, [trabajador])

  if (!trabajador) {
    return (
      <div className="pendientes" style={{
        minHeight: '100vh',
        display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center',
        padding: '2rem', textAlign: 'center',
      }}>
        <div style={{ fontSize: 48, marginBottom: 16 }}>🔒</div>
        <h2 style={{ fontWeight: 700, marginBottom: 8 }}>Link inválido</h2>
        <p style={{ color: 'var(--muted)', fontSize: 15 }}>Pídele a Alexandra que te mande el link por WhatsApp.</p>
      </div>
    )
  }

  async function subir() {
    if (!obraId) { alert('Elige la obra en la que estás.'); return }
    if (archivos.length === 0) { alert('Elige al menos una foto o video.'); return }
    setSubiendo(true)
    setResultado(null)
    setProgreso({ actual: 0, total: archivos.length })

    const ubicacion = await pedirUbicacion()

    let ok = 0
    let fallidos = 0
    for (let i = 0; i < archivos.length; i++) {
      setProgreso({ actual: i + 1, total: archivos.length })
      const archivo = archivos[i]
      const ext = archivo.name.split('.').pop() || 'bin'
      const filename = `obra-${obraId}-${Date.now()}-${i}.${ext}`
      const { data, error } = await supabase.storage.from('audio-notas').upload(filename, archivo, { contentType: archivo.type })
      if (error) { fallidos++; continue }
      const { data: urlData } = supabase.storage.from('audio-notas').getPublicUrl(data.path)
      const tipo: ObraMedia['tipo'] = archivo.type.startsWith('image/') ? 'foto' : archivo.type.startsWith('video/') ? 'video' : 'documento'
      const { error: errorInsert } = await supabase.from('obra_media').insert({
        obra_id: obraId,
        url: urlData.publicUrl,
        tipo,
        subido_por: trabajador,
        momento,
        lat: ubicacion?.lat ?? null,
        lng: ubicacion?.lng ?? null,
      })
      if (errorInsert) fallidos++
      else ok++
    }

    setResultado({ ok, fallidos })
    setArchivos([])
    // Remonta el input de archivos (con `key`) para que su "2 files" nativo se limpie --
    // resetear `.value` a mano dentro del onChange rompía la selección múltiple (ver commit
    // anterior), así que el reset se hace acá, después de terminar, nunca durante la selección.
    setInputKey(k => k + 1)
    setSubiendo(false)
    setProgreso(null)
  }

  return (
    <div className="pendientes">
      <div style={{ maxWidth: 480, margin: '0 auto', padding: '1.25rem 14px 3rem' }}>
        {/* Header */}
        <div style={{
          background: 'var(--secondary)', borderRadius: 16, padding: '18px 20px', marginBottom: '1.5rem',
          display: 'flex', alignItems: 'center', gap: 12,
        }}>
          <div style={{
            width: 44, height: 44,
            background: 'var(--primary)', borderRadius: 12,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontWeight: 800, color: '#fff', fontSize: 20, flexShrink: 0,
          }}>H</div>
          <div>
            <p className="font-display" style={{ fontSize: 11, fontWeight: 700, color: 'var(--primary)', textTransform: 'uppercase', letterSpacing: '0.8px', marginBottom: 2 }}>Horma Grup</p>
            <h1 style={{ fontSize: 18, fontWeight: 800, lineHeight: 1.2, color: '#fff' }}>Hola {trabajador}</h1>
            <p style={{ fontSize: 13, color: 'rgba(255,255,255,0.7)' }}>Fotos y avance de la obra</p>
          </div>
        </div>

        <div className="field" style={{ marginBottom: 16 }}>
          <label>{obraAsignada ? 'Tu obra' : '¿En qué obra estás?'}</label>
          {obraAsignada ? (
            <div style={{ padding: '10px 14px', background: 'var(--white)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', fontSize: 16, fontWeight: 700 }}>
              {obraAsignada.nombre}
            </div>
          ) : (
            <select value={obraId} onChange={e => setObraId(e.target.value)} style={{ fontSize: 16 }}>
              <option value="">Selecciona una obra...</option>
              {obras.map(o => <option key={o.id} value={o.id}>{o.nombre}</option>)}
            </select>
          )}
        </div>

        <div style={{ display: 'flex', gap: 4, marginBottom: 16 }}>
          {([{ key: 'fotos', label: 'Fotos' }, { key: 'avance', label: 'Avance' }] as const).map(v => (
            <button
              key={v.key}
              type="button"
              onClick={() => setVista(v.key)}
              style={{
                flex: 1, padding: '9px 8px', borderRadius: 8, cursor: 'pointer', fontSize: 14, fontWeight: 700,
                border: `1.5px solid ${vista === v.key ? 'var(--primary)' : 'var(--border)'}`,
                background: vista === v.key ? 'var(--primary)' : 'var(--white)',
                color: vista === v.key ? '#fff' : 'var(--text)',
              }}
            >{v.label}</button>
          ))}
        </div>

        {vista === 'fotos' ? (
          <div className="card" style={{ padding: 16 }}>
            <div className="field" style={{ marginBottom: 16 }}>
              <label>Momento</label>
              <div style={{ display: 'flex', gap: 8 }}>
                {MOMENTOS.map(m => (
                  <button
                    key={m.key}
                    type="button"
                    onClick={() => setMomento(m.key)}
                    style={{
                      flex: 1, padding: '10px 8px', borderRadius: 8, cursor: 'pointer', fontSize: 14, fontWeight: 700,
                      border: `1.5px solid ${momento === m.key ? 'var(--primary)' : 'var(--border)'}`,
                      background: momento === m.key ? 'var(--primary)' : 'var(--white)',
                      color: momento === m.key ? '#fff' : 'var(--text)',
                    }}
                  >{m.label}</button>
                ))}
              </div>
            </div>

            {ubicacionOk === false && (
              <div style={{ padding: '10px 14px', background: '#fef2e0', border: '1px solid #e8a33d', borderRadius: 8, marginBottom: 18 }}>
                <p style={{ fontSize: 13, color: '#7a5210', fontWeight: 600 }}>
                  Por favor activa la ubicación en tu teléfono antes de subir las fotos, así llegan con los datos de dónde fueron tomadas.
                </p>
              </div>
            )}

            <div className="field" style={{ marginBottom: 20 }}>
              <label>Fotos o video</label>
              {archivos.length > 0 && (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(72px, 1fr))', gap: 8, marginBottom: 10 }}>
                  {archivos.map((archivo, i) => (
                    <div key={i} style={{ position: 'relative' }}>
                      {archivo.type.startsWith('image/') ? (
                        <img
                          src={URL.createObjectURL(archivo)}
                          alt=""
                          style={{ width: '100%', height: 72, objectFit: 'cover', borderRadius: 8, border: '1px solid var(--border)' }}
                        />
                      ) : (
                        <div style={{ width: '100%', height: 72, borderRadius: 8, border: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--white)', fontSize: 11, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase' }}>Video</div>
                      )}
                      <button
                        type="button"
                        onClick={() => setArchivos(prev => prev.filter((_, idx) => idx !== i))}
                        style={{ position: 'absolute', top: 4, right: 4, background: 'rgba(0,0,0,0.6)', color: '#fff', border: 'none', borderRadius: '50%', width: 20, height: 20, fontSize: 12, cursor: 'pointer', lineHeight: 1 }}
                      >✕</button>
                    </div>
                  ))}
                </div>
              )}
              <input
                key={inputKey}
                type="file"
                accept="image/*,video/*"
                multiple
                onChange={e => setArchivos(prev => [...prev, ...Array.from(e.target.files || [])])}
                style={{ fontSize: 14 }}
              />
              <p style={{ fontSize: 12, color: 'var(--muted)', marginTop: 6 }}>
                {archivos.length > 0
                  ? `${archivos.length} foto${archivos.length !== 1 ? 's' : ''}/video${archivos.length !== 1 ? 's' : ''} lista${archivos.length !== 1 ? 's' : ''} para subir. Podés seguir agregando más antes de tocar "Subir".`
                  : 'Podés elegir varias fotos a la vez, o tocar de nuevo para ir agregando una por una.'}
              </p>
            </div>

            {subiendo && (
              <div style={{ padding: '10px 14px', background: '#fef2e0', border: '1px solid #e8a33d', borderRadius: 8, marginBottom: 12, textAlign: 'center' }}>
                <p style={{ fontSize: 13, color: '#7a5210', fontWeight: 700 }}>
                  Subiendo{progreso && progreso.total > 1 ? ` foto ${progreso.actual} de ${progreso.total}` : ''}... no cierres ni salgas de esta pantalla.
                </p>
              </div>
            )}

            <button
              className="btn btn-primary btn-lg"
              onClick={subir}
              disabled={subiendo}
              style={{ width: '100%', fontSize: 17, fontWeight: 800 }}
            >
              {subiendo ? 'Subiendo, espera...' : 'Subir'}
            </button>

            {resultado && (
              <p style={{ fontSize: 13, marginTop: 12, textAlign: 'center', color: resultado.fallidos > 0 ? 'var(--danger)' : 'var(--success)', fontWeight: 600 }}>
                {resultado.ok > 0 && `${resultado.ok} archivo${resultado.ok !== 1 ? 's' : ''} subido${resultado.ok !== 1 ? 's' : ''} correctamente. `}
                {resultado.fallidos > 0 && `${resultado.fallidos} fallaron, intenta de nuevo.`}
              </p>
            )}
          </div>
        ) : !obraId ? (
          <p style={{ fontSize: 14, color: 'var(--muted-inverse)', textAlign: 'center', padding: '2rem 0' }}>
            Elige primero en qué obra estás.
          </p>
        ) : (
          <div className="card" style={{ padding: 16 }}>
            <PanelAvanceObraCampo obraId={obraId} trabajador={trabajador} />
          </div>
        )}
      </div>
    </div>
  )
}
