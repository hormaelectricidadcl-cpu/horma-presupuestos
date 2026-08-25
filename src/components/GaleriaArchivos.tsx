import { useState } from 'react'

const EXT_IMAGEN = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.heic', '.heif']
const EXT_VIDEO = ['.mp4', '.mov', '.webm', '.avi', '.m4v']

// Links pegados a mano desde Google Drive (antes de que existiera la subida real de
// archivo) no sirven el archivo como una URL de imagen directa -- Drive sí expone un
// endpoint de miniatura público para archivos compartidos, que se puede usar como
// vista previa aunque no se sepa si el original es foto o video.
function idDriveDeUrl(url: string): string | null {
  const match = url.match(/drive\.google\.com\/file\/d\/([^/]+)/)
  return match ? match[1] : null
}

// Un solo tamaño para la miniatura chica y el visor grande -- pedirle a Google el
// mismo archivo dos veces seguidas en tamaños distintos (chico para la lista, grande
// para el visor) hace fallar la segunda petición con cierta frecuencia. CSS se encarga
// de escalarla en cada lugar.
function miniaturaDrive(id: string) {
  return `https://drive.google.com/thumbnail?id=${id}&sz=w1000`
}

function tipoDeUrl(url: string): 'imagen' | 'video' | 'drive' | 'otro' {
  if (idDriveDeUrl(url)) return 'drive'
  const limpio = url.split('?')[0].toLowerCase()
  if (EXT_IMAGEN.some(ext => limpio.endsWith(ext))) return 'imagen'
  if (EXT_VIDEO.some(ext => limpio.endsWith(ext))) return 'video'
  return 'otro'
}

function previewSrc(url: string, tipo: ReturnType<typeof tipoDeUrl>): string {
  return tipo === 'drive' ? miniaturaDrive(idDriveDeUrl(url) as string) : url
}

// Miniaturas navegables para los archivos adjuntos a un pendiente (drive_links) --
// reemplaza la lista de enlaces de texto "Archivo 1, Archivo 2..." que obligaba a
// abrir cada uno por separado. Pensado para fotos/videos que manda el cliente por
// WhatsApp: Gustavo necesita verlas junto con el mensaje del cliente para armar el
// presupuesto, sin salir de la app.
export function GaleriaArchivos({ urls }: { urls: string[] | null | undefined }) {
  const [abierto, setAbierto] = useState<number | null>(null)
  const [rotas, setRotas] = useState<Set<string>>(new Set())

  if (!urls || urls.length === 0) return null

  const marcarRota = (src: string) => setRotas(prev => new Set(prev).add(src))

  return (
    <>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 4 }}>
        {urls.map((url, i) => {
          const tipo = tipoDeUrl(url)
          const src = previewSrc(url, tipo)
          return (
            <button
              key={i}
              type="button"
              onClick={() => setAbierto(i)}
              style={{
                width: 56, height: 56, borderRadius: 8, border: '1px solid var(--border)',
                overflow: 'hidden', padding: 0, cursor: 'pointer', background: 'var(--bg)',
                flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 10, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase',
              }}
            >
              {(tipo === 'imagen' || tipo === 'drive') && !rotas.has(src) ? (
                <img
                  src={src}
                  alt=""
                  style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                  onError={() => marcarRota(src)}
                />
              ) : tipo === 'video' ? 'Video' : 'Archivo'}
            </button>
          )
        })}
      </div>

      {abierto !== null && (
        <div
          onClick={() => setAbierto(null)}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}
        >
          <button
            type="button"
            onClick={() => setAbierto(null)}
            style={{ position: 'absolute', top: 16, right: 16, background: 'none', border: 'none', color: '#fff', fontSize: 28, cursor: 'pointer', lineHeight: 1 }}
          >✕</button>

          {urls.length > 1 && (
            <button
              type="button"
              onClick={e => { e.stopPropagation(); setAbierto(a => (a! - 1 + urls.length) % urls.length) }}
              style={{ position: 'absolute', left: 12, background: 'none', border: 'none', color: '#fff', fontSize: 36, cursor: 'pointer', lineHeight: 1 }}
            >‹</button>
          )}

          <div onClick={e => e.stopPropagation()} style={{ maxWidth: '90vw', maxHeight: '85vh', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}>
            {(() => {
              const url = urls[abierto]
              const tipo = tipoDeUrl(url)
              const src = previewSrc(url, tipo)
              if (tipo === 'video') {
                // eslint-disable-next-line jsx-a11y/media-has-caption
                return <video src={url} controls autoPlay style={{ maxWidth: '90vw', maxHeight: '75vh', borderRadius: 8 }} />
              }
              if ((tipo === 'imagen' || tipo === 'drive') && !rotas.has(src)) {
                return (
                  <img
                    src={src}
                    alt=""
                    style={{ maxWidth: '90vw', maxHeight: '75vh', objectFit: 'contain', borderRadius: 8, display: 'block' }}
                    onError={() => marcarRota(src)}
                  />
                )
              }
              return (
                <a href={url} target="_blank" rel="noreferrer" style={{ color: '#fff', fontSize: 16, textDecoration: 'underline' }}>
                  Abrir archivo
                </a>
              )
            })()}
            {tipoDeUrl(urls[abierto]) === 'drive' && (
              <a href={urls[abierto]} target="_blank" rel="noreferrer" style={{ color: 'rgba(255,255,255,0.75)', fontSize: 13 }}>
                Ver original en Drive →
              </a>
            )}
          </div>

          {urls.length > 1 && (
            <button
              type="button"
              onClick={e => { e.stopPropagation(); setAbierto(a => (a! + 1) % urls.length) }}
              style={{ position: 'absolute', right: 12, background: 'none', border: 'none', color: '#fff', fontSize: 36, cursor: 'pointer', lineHeight: 1 }}
            >›</button>
          )}

          {urls.length > 1 && (
            <p style={{ position: 'absolute', bottom: 16, color: '#fff', fontSize: 13 }}>{abierto + 1} / {urls.length}</p>
          )}
        </div>
      )}
    </>
  )
}
