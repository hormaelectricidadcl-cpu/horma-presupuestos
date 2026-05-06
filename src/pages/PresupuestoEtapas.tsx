import { useState } from 'react'
import { generatePDFEtapas } from '../utils/pdfGeneratorEtapas'
import type { Etapa } from '../utils/pdfGeneratorEtapas'

interface Client {
  name: string
  rut: string
  email: string
  address: string
}

const FASES_DEFAULT: Etapa[] = [
  { numero: '1.0', nombre: 'Preparación y Empalme',        items: [], totalMO: 0, totalMAT: 0, total: 0 },
  { numero: '2.0', nombre: 'Canalización y Alimentación',  items: [], totalMO: 0, totalMAT: 0, total: 0 },
  { numero: '3.0', nombre: 'Instalaciones y Protecciones', items: [], totalMO: 0, totalMAT: 0, total: 0 },
  { numero: '4.0', nombre: 'Seguridad y Normativa',        items: [], totalMO: 0, totalMAT: 0, total: 0 },
  { numero: '5.0', nombre: 'Gastos Generales y Logística', items: [], totalMO: 0, totalMAT: 0, total: 0 },
]

const FASE_COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#8b5cf6', '#ef4444']

const fmt = (n: number) => Math.round(n).toLocaleString('es-CL')

const thS: React.CSSProperties = {
  padding: '6px 10px',
  fontSize: 10,
  fontWeight: 700,
  color: '#615e5b',
  textTransform: 'uppercase',
  letterSpacing: '0.04em',
  whiteSpace: 'nowrap',
  background: '#f5f5f3',
  borderBottom: '1px solid #e8e8e6',
}

const tdS: React.CSSProperties = {
  padding: '7px 10px',
  fontSize: 12,
  color: '#1a1a1a',
  borderTop: '1px solid #f0f0ee',
}

export default function PresupuestoEtapas() {
  const [client, setClient]         = useState<Client>({ name: '', rut: '', email: '', address: '' })
  const [texto, setTexto]           = useState('')
  const [etapas, setEtapas]         = useState<Etapa[]>(FASES_DEFAULT)
  const [procesado, setProcesado]   = useState(false)
  const [totalNeto, setTotalNeto]   = useState<number | null>(null)
  const [loading, setLoading]       = useState(false)
  const [error, setError]           = useState('')
  const [ggPct, setGgPct]           = useState(0)

  const grandMO  = etapas.reduce((s, e) => s + e.totalMO,  0)
  const grandMAT = etapas.reduce((s, e) => s + e.totalMAT, 0)
  const ggBase   = grandMO + grandMAT
  const ggAmount = Math.round(ggBase * ggPct / 100)
  const subtotal = ggBase + ggAmount
  const iva      = Math.round(subtotal * 0.19)
  const total    = subtotal + iva

  async function procesar() {
    if (!texto.trim()) { setError('Pegá el texto del presupuesto de Gustavo.'); return }
    setLoading(true)
    setError('')
    try {
      const res  = await fetch('/api/parse-etapas', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ texto }),
      })
      const data = await res.json()
      if (!res.ok || !data.etapas) throw new Error(data.error || 'Error al procesar')
      setEtapas(data.etapas)
      setTotalNeto(data.totalNeto ?? null)
      setProcesado(true)
    } catch (e) {
      setError(String(e))
    } finally {
      setLoading(false)
    }
  }

  async function generarPDF() {
    if (!client.name.trim()) { alert('Ingresá el nombre del cliente antes de generar el PDF.'); return }
    if (ggBase === 0) { alert('Procesá el texto con IA antes de generar el PDF.'); return }
    await generatePDFEtapas(client, etapas, { pct: ggPct, amount: ggAmount })
  }

  return (
    <div className="pendientes" style={{ background: 'var(--bg)', minHeight: '100vh' }}>
      <div style={{ maxWidth: 820, margin: '0 auto', padding: '1.5rem 1rem 3rem' }}>

        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: '1.5rem' }}>
          <div style={{
            width: 44, height: 44, background: '#615e5b', borderRadius: 12,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontWeight: 800, color: '#fff', fontSize: 20, flexShrink: 0,
          }}>H</div>
          <div>
            <h1 style={{ fontSize: 18, fontWeight: 800, lineHeight: 1.2, color: '#1a1a1a' }}>Presupuesto Itemizado por Etapas</h1>
            <p style={{ fontSize: 13, color: '#615e5b', fontWeight: 500 }}>Horma Electricidad — Estándar de Ingeniería</p>
          </div>
          <a href="/admin" style={{ marginLeft: 'auto', fontSize: 13, color: '#615e5b', textDecoration: 'none', fontWeight: 600 }}>← Admin</a>
        </div>

        {/* Client form */}
        <div className="card" style={{ padding: '1.25rem', marginBottom: '1.25rem' }}>
          <p style={{ fontSize: 11, fontWeight: 700, color: '#615e5b', marginBottom: 12, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
            Datos del cliente
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div className="field">
              <label>Nombre *</label>
              <input value={client.name}    onChange={e => setClient(c => ({ ...c, name:    e.target.value }))} placeholder="Ej: Patricio Valdés" />
            </div>
            <div className="field">
              <label>RUT</label>
              <input value={client.rut}     onChange={e => setClient(c => ({ ...c, rut:     e.target.value }))} placeholder="12.345.678-9" />
            </div>
            <div className="field">
              <label>Email</label>
              <input type="email" value={client.email}   onChange={e => setClient(c => ({ ...c, email:   e.target.value }))} placeholder="cliente@email.com" />
            </div>
            <div className="field">
              <label>Dirección</label>
              <input value={client.address} onChange={e => setClient(c => ({ ...c, address: e.target.value }))} placeholder="Las Condes, Santiago" />
            </div>
          </div>
        </div>

        {/* Text input */}
        <div className="card" style={{ padding: '1.25rem', marginBottom: '1.25rem' }}>
          <p style={{ fontSize: 11, fontWeight: 700, color: '#615e5b', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
            Texto del presupuesto (formato Gustavo)
          </p>
          <textarea
            value={texto}
            onChange={e => {
              setTexto(e.target.value)
              if (procesado) { setProcesado(false); setTotalNeto(null); setEtapas(FASES_DEFAULT); setGgPct(0) }
            }}
            placeholder={`Mano de obra\n75 Reemplazo de cable de centros eléctricos 13.000\nInstalación de tablero de distribución 100.000\n\nMateriales:\n50 ml Cable 2.5mm 800\nTablero de distribución con accesorios 120.000\n...`}
            rows={9}
            style={{ width: '100%', fontSize: 13, fontFamily: 'monospace', resize: 'vertical', lineHeight: 1.6 }}
          />
          {error && <p style={{ color: 'var(--danger)', fontSize: 13, marginTop: 6 }}>{error}</p>}
          {totalNeto !== null && (
            <div style={{
              marginTop: 10, padding: '8px 14px', borderRadius: 8,
              background: '#f0fdf4', border: '1.5px solid #22c55e',
              display: 'flex', alignItems: 'center', gap: 8,
            }}>
              <span style={{ fontSize: 16 }}>✓</span>
              <span style={{ fontSize: 13, fontWeight: 700, color: '#15803d' }}>
                Total detectado por IA: ${fmt(totalNeto)}
              </span>
            </div>
          )}
          <button
            className="btn btn-primary"
            onClick={procesar}
            disabled={loading}
            style={{ marginTop: 12, fontWeight: 700, fontSize: 15 }}
          >
            {loading ? '⏳ Procesando con IA...' : '✨ Agrupar en etapas con IA'}
          </button>
        </div>

        {/* Phase cards */}
        <div style={{ marginBottom: '1.25rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
            <p style={{ fontSize: 11, fontWeight: 700, color: '#615e5b', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
              Etapas de obra
              {procesado && <span style={{ marginLeft: 8, color: '#16a34a', fontWeight: 700, fontSize: 11 }}>✓ IA procesó el texto</span>}
            </p>
            {procesado && (
              <button
                onClick={() => { setEtapas(FASES_DEFAULT); setProcesado(false); setTotalNeto(null); setGgPct(0) }}
                style={{ background: 'none', border: 'none', fontSize: 12, color: '#615e5b', cursor: 'pointer', fontWeight: 600 }}
              >↺ Limpiar</button>
            )}
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {etapas.map((etapa, idx) => {
              const color  = FASE_COLORS[idx]
              const activa = etapa.items.length > 0
              return (
                <div key={etapa.numero} className="card" style={{
                  padding: 0, overflow: 'hidden',
                  border: `2px solid ${activa ? color + '35' : 'var(--border)'}`,
                }}>
                  {/* Phase header bar */}
                  <div style={{
                    padding: '10px 14px',
                    background: activa ? color + '0d' : '#fafaf9',
                    borderBottom: activa ? `1px solid ${color}20` : '1px solid var(--border)',
                    display: 'flex', alignItems: 'center', gap: 10,
                  }}>
                    <span style={{
                      width: 34, height: 34, borderRadius: 8, flexShrink: 0,
                      background: activa ? color : '#d4d4d2',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      color: '#fff', fontWeight: 800, fontSize: 11,
                    }}>{etapa.numero}</span>
                    <span style={{ fontWeight: 700, fontSize: 13, color: activa ? '#1a1a1a' : '#b0b0ac' }}>
                      {etapa.nombre}
                    </span>
                    {activa ? (
                      <div style={{ marginLeft: 'auto', display: 'flex', gap: 18, fontSize: 12 }}>
                        <span style={{ color: '#615e5b' }}>
                          MO: <strong style={{ color: '#1d4ed8' }}>${fmt(etapa.totalMO)}</strong>
                        </span>
                        <span style={{ color: '#615e5b' }}>
                          MAT: <strong style={{ color: '#15803d' }}>${fmt(etapa.totalMAT)}</strong>
                        </span>
                        <span style={{ color: color, fontWeight: 800, fontSize: 13 }}>
                          ${fmt(etapa.total)}
                        </span>
                      </div>
                    ) : (
                      <span style={{ marginLeft: 'auto', fontSize: 12, color: '#ccc' }}>Sin ítems</span>
                    )}
                  </div>

                  {/* Items table */}
                  {activa && (
                    <div style={{ overflowX: 'auto' }}>
                      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                        <thead>
                          <tr>
                            <th style={{ ...thS, width: 44, textAlign: 'center' }}>N°</th>
                            <th style={{ ...thS, textAlign: 'left' }}>Descripción / Concepto</th>
                            <th style={{ ...thS, width: 54, textAlign: 'center' }}>Cant.</th>
                            <th style={{ ...thS, width: 96, textAlign: 'right' }}>P. Unitario</th>
                            <th style={{ ...thS, width: 46, textAlign: 'center' }}>Tipo</th>
                            <th style={{ ...thS, width: 100, textAlign: 'right' }}>Total</th>
                          </tr>
                        </thead>
                        <tbody>
                          {etapa.items.map((item, i) => (
                            <tr key={i} style={{ background: i % 2 === 0 ? '#fff' : '#fafaf8' }}>
                              <td style={{ ...tdS, textAlign: 'center', color: '#93918e', fontSize: 11 }}>{item.subNumero}</td>
                              <td style={{ ...tdS }}>{item.descripcion}</td>
                              <td style={{ ...tdS, textAlign: 'center', color: '#615e5b', fontWeight: 600 }}>{item.cantidad}</td>
                              <td style={{ ...tdS, textAlign: 'right', color: '#615e5b' }}>${fmt(item.precioUnitario)}</td>
                              <td style={{ ...tdS, textAlign: 'center' }}>
                                <span style={{
                                  fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 4,
                                  background: item.tipo === 'MO' ? '#dbeafe' : '#dcfce7',
                                  color:      item.tipo === 'MO' ? '#1d4ed8' : '#15803d',
                                }}>{item.tipo}</span>
                              </td>
                              <td style={{ ...tdS, textAlign: 'right', fontWeight: 700 }}>${fmt(item.total)}</td>
                            </tr>
                          ))}
                        </tbody>
                        {etapa.items.length > 1 && (
                          <tfoot>
                            <tr style={{ background: '#f0efed' }}>
                              <td colSpan={4} style={{ ...tdS, fontSize: 11, fontWeight: 700, color: '#615e5b', textAlign: 'right' }}>
                                Subtotal {etapa.numero}
                              </td>
                              <td style={{ ...tdS, textAlign: 'center' }} />
                              <td style={{ ...tdS, textAlign: 'right', fontWeight: 800, color: color }}>${fmt(etapa.total)}</td>
                            </tr>
                          </tfoot>
                        )}
                      </table>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>

        {/* Gastos Generales selector */}
        {procesado && (
          <div className="card" style={{ padding: '1.25rem', marginBottom: '1.25rem' }}>
            <p style={{ fontSize: 11, fontWeight: 700, color: '#615e5b', marginBottom: 12, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
              Gastos Generales y Logística
            </p>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 10 }}>
              {[0, 5, 7, 10, 12, 15].map(pct => (
                <button
                  key={pct}
                  onClick={() => setGgPct(pct)}
                  style={{
                    fontSize: 13, padding: '6px 14px', borderRadius: 8, fontWeight: 700, cursor: 'pointer',
                    border: ggPct === pct ? '2px solid #e69a21' : '2px solid var(--border)',
                    background: ggPct === pct ? '#fef9ee' : 'var(--white)',
                    color: ggPct === pct ? '#e69a21' : '#615e5b',
                  }}
                >
                  {pct === 0 ? 'Sin GG' : `${pct}%`}
                </button>
              ))}
              <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <input
                  type="number"
                  min={0}
                  max={100}
                  step={0.5}
                  value={ggPct === 0 ? '' : ggPct}
                  onChange={e => setGgPct(Math.max(0, Math.min(100, Number(e.target.value) || 0)))}
                  placeholder="Otro"
                  style={{ width: 72, fontSize: 13, padding: '6px 10px', borderRadius: 8, border: '2px solid var(--border)', textAlign: 'center' }}
                />
                <span style={{ fontSize: 13, color: '#615e5b', fontWeight: 600 }}>%</span>
              </div>
            </div>
            {ggAmount > 0 && (
              <div style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                padding: '8px 12px', borderRadius: 8, background: '#fef9ee', border: '1px solid #e69a21',
                fontSize: 13,
              }}>
                <span style={{ color: '#615e5b' }}>
                  ${fmt(ggBase)} × {ggPct}%
                </span>
                <strong style={{ color: '#e69a21', fontSize: 15 }}>${fmt(ggAmount)}</strong>
              </div>
            )}
          </div>
        )}

        {/* Grand totals */}
        <div className="card" style={{ padding: '1.25rem', marginBottom: '1.25rem' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginBottom: 14 }}>
            <div style={{ textAlign: 'center', padding: '10px 0' }}>
              <p style={{ fontSize: 11, color: '#615e5b', fontWeight: 600, marginBottom: 4 }}>Subtotal Mano de Obra</p>
              <p style={{ fontSize: 18, fontWeight: 800, color: '#1d4ed8' }}>${fmt(grandMO)}</p>
            </div>
            <div style={{ textAlign: 'center', padding: '10px 0', borderLeft: '1px solid var(--border)', borderRight: '1px solid var(--border)' }}>
              <p style={{ fontSize: 11, color: '#615e5b', fontWeight: 600, marginBottom: 4 }}>Subtotal Materiales</p>
              <p style={{ fontSize: 18, fontWeight: 800, color: '#15803d' }}>${fmt(grandMAT)}</p>
            </div>
            <div style={{ textAlign: 'center', padding: '10px 0' }}>
              <p style={{ fontSize: 11, color: '#615e5b', fontWeight: 600, marginBottom: 4 }}>Subtotal Neto</p>
              <p style={{ fontSize: 18, fontWeight: 800, color: '#1a1a1a' }}>${fmt(ggBase)}</p>
            </div>
          </div>
          {ggAmount > 0 && (
            <div style={{
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              padding: '8px 14px', borderRadius: 8, background: '#f5f5f3',
              border: '1px solid var(--border)', marginBottom: 10, fontSize: 13,
            }}>
              <span style={{ color: '#615e5b' }}>Gastos Generales ({ggPct}%)</span>
              <strong style={{ color: '#1a1a1a' }}>${fmt(ggAmount)}</strong>
            </div>
          )}
          <div style={{
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            padding: '12px 16px', borderRadius: 10,
            background: '#fef9ee', border: '2px solid #e69a21', marginBottom: 14,
          }}>
            <span style={{ fontSize: 13, color: '#615e5b' }}>
              IVA (19%): <strong style={{ color: '#1a1a1a' }}>${fmt(iva)}</strong>
            </span>
            <div style={{ textAlign: 'right' }}>
              <p style={{ fontSize: 11, color: '#615e5b', fontWeight: 600 }}>TOTAL CON IVA</p>
              <p style={{ fontSize: 24, fontWeight: 800, color: '#e69a21', lineHeight: 1.1 }}>${fmt(total)}</p>
            </div>
          </div>
          <button
            className="btn btn-lg"
            onClick={generarPDF}
            style={{
              width: '100%', fontWeight: 800, fontSize: 16,
              background: '#615e5b', color: '#fff', border: 'none',
              borderBottom: '4px solid #e69a21', borderRadius: 10,
            }}
          >
            📄 Generar PDF — Presupuesto Itemizado
          </button>
        </div>

        <p style={{ textAlign: 'center', fontSize: 12, color: '#93918e' }}>
          Procesá el texto con IA para ver el desglose ítem a ítem antes de generar el PDF.
        </p>
      </div>
    </div>
  )
}
