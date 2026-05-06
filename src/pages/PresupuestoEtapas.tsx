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
  { numero: '1.0', nombre: 'Preparación y Empalme',       descripcion: '', manoObra: 0, materiales: 0, total: 0 },
  { numero: '2.0', nombre: 'Canalización y Alimentación', descripcion: '', manoObra: 0, materiales: 0, total: 0 },
  { numero: '3.0', nombre: 'Montaje y Protecciones',      descripcion: '', manoObra: 0, materiales: 0, total: 0 },
  { numero: '4.0', nombre: 'Ingeniería y Certificación',  descripcion: '', manoObra: 0, materiales: 0, total: 0 },
  { numero: '5.0', nombre: 'Imprevistos y Complementarios', descripcion: '', manoObra: 0, materiales: 0, total: 0 },
]

const FASE_COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#8b5cf6', '#ef4444']

export default function PresupuestoEtapas() {
  const [client, setClient]     = useState<Client>({ name: '', rut: '', email: '', address: '' })
  const [texto, setTexto]       = useState('')
  const [etapas, setEtapas]     = useState<Etapa[]>(FASES_DEFAULT)
  const [procesado, setProcesado] = useState(false)
  const [totalNeto, setTotalNeto] = useState<number | null>(null)
  const [loading, setLoading]   = useState(false)
  const [error, setError]       = useState('')

  const totalMO  = etapas.reduce((s, e) => s + e.manoObra, 0)
  const totalMAT = etapas.reduce((s, e) => s + e.materiales, 0)
  const subtotal = totalMO + totalMAT
  const iva      = Math.round(subtotal * 0.19)
  const total    = subtotal + iva
  const fmt      = (n: number) => Math.round(n).toLocaleString('es-CL')

  async function procesar() {
    if (!texto.trim()) { setError('Pegá el texto del presupuesto de Gustavo.'); return }
    setLoading(true)
    setError('')
    try {
      const res = await fetch('/api/parse-etapas', {
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

  function setEtapaField(idx: number, field: 'manoObra' | 'materiales' | 'descripcion', val: number | string) {
    setEtapas(prev => prev.map((e, i) => {
      if (i !== idx) return e
      const updated = { ...e, [field]: val }
      updated.total = updated.manoObra + updated.materiales
      return updated
    }))
  }

  async function generarPDF() {
    if (!client.name.trim()) { alert('Ingresá el nombre del cliente antes de generar el PDF.'); return }
    if (subtotal === 0) { alert('Al menos una etapa debe tener montos mayores a 0.'); return }
    await generatePDFEtapas(client, etapas)
  }

  return (
    <div className="pendientes" style={{ background: 'var(--bg)', minHeight: '100vh' }}>
      <div style={{ maxWidth: 760, margin: '0 auto', padding: '1.5rem 1rem 3rem' }}>

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

        {/* ── Client form ── */}
        <div className="card" style={{ padding: '1.25rem', marginBottom: '1.25rem' }}>
          <p style={{ fontSize: 11, fontWeight: 700, color: '#615e5b', marginBottom: 12, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
            Datos del cliente
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div className="field">
              <label>Nombre *</label>
              <input value={client.name} onChange={e => setClient(c => ({ ...c, name: e.target.value }))} placeholder="Ej: Patricio Valdés" />
            </div>
            <div className="field">
              <label>RUT</label>
              <input value={client.rut} onChange={e => setClient(c => ({ ...c, rut: e.target.value }))} placeholder="12.345.678-9" />
            </div>
            <div className="field">
              <label>Email</label>
              <input type="email" value={client.email} onChange={e => setClient(c => ({ ...c, email: e.target.value }))} placeholder="cliente@email.com" />
            </div>
            <div className="field">
              <label>Dirección</label>
              <input value={client.address} onChange={e => setClient(c => ({ ...c, address: e.target.value }))} placeholder="Las Condes, Santiago" />
            </div>
          </div>
        </div>

        {/* ── Text input ── */}
        <div className="card" style={{ padding: '1.25rem', marginBottom: '1.25rem' }}>
          <p style={{ fontSize: 11, fontWeight: 700, color: '#615e5b', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
            Texto del presupuesto (formato Gustavo)
          </p>
          <textarea
            value={texto}
            onChange={e => { setTexto(e.target.value); if (procesado) { setProcesado(false); setTotalNeto(null) } }}
            placeholder={
`Mano de obra
Instalación de tablero de distribución en medidor 100.000
Canalización y cableado para tablero de cargador 100.000
Instalación de tablero para cargador 70.000
...

Materiales:
Tablero de distribución con accesorios 120.000
Materiales para canalización y cableado 140.000
...`
            }
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

        {/* ── Phases editor ── */}
        <div className="card" style={{ padding: '1.25rem', marginBottom: '1.25rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
            <p style={{ fontSize: 11, fontWeight: 700, color: '#615e5b', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
              Etapas de obra
              {procesado && <span style={{ marginLeft: 8, color: '#16a34a', fontWeight: 700, fontSize: 11 }}>✓ IA procesó el texto</span>}
            </p>
            {procesado && (
              <button
                onClick={() => { setEtapas(FASES_DEFAULT); setProcesado(false); setTotalNeto(null) }}
                style={{ background: 'none', border: 'none', fontSize: 12, color: '#615e5b', cursor: 'pointer', fontWeight: 600 }}
              >
                ↺ Limpiar
              </button>
            )}
          </div>

          {/* Column headers */}
          <div style={{
            display: 'grid', gridTemplateColumns: '44px 1fr 120px 120px 120px',
            gap: 6, padding: '6px 12px',
            background: '#615e5b', borderRadius: 8, marginBottom: 8,
          }}>
            {['N°', 'Etapa', 'Mano de Obra', 'Materiales', 'Total'].map((h, i) => (
              <span key={i} style={{
                fontSize: 10, fontWeight: 700, color: i === 0 ? '#fff' : i === 4 ? '#e69a21' : '#fff',
                textAlign: i > 1 ? 'right' : 'left', letterSpacing: '0.04em',
              }}>{h}</span>
            ))}
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {etapas.map((etapa, idx) => {
              const color = FASE_COLORS[idx]
              const activa = etapa.total > 0
              return (
                <div key={etapa.numero} style={{
                  borderRadius: 10,
                  border: `2px solid ${activa ? color + '50' : 'var(--border)'}`,
                  background: activa ? color + '06' : 'var(--white)',
                  overflow: 'hidden',
                }}>
                  {/* Main row */}
                  <div style={{
                    display: 'grid',
                    gridTemplateColumns: '44px 1fr 120px 120px 120px',
                    gap: 6, alignItems: 'center',
                    padding: '10px 12px',
                  }}>
                    {/* Number badge */}
                    <span style={{
                      width: 34, height: 34, borderRadius: 8,
                      background: activa ? color : '#ccc',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      color: '#fff', fontWeight: 800, fontSize: 12,
                    }}>{etapa.numero}</span>

                    {/* Name */}
                    <span style={{ fontWeight: 700, fontSize: 13, color: activa ? '#1a1a1a' : '#999' }}>
                      {etapa.nombre}
                    </span>

                    {/* MO input */}
                    <input
                      type="number"
                      value={etapa.manoObra || ''}
                      onChange={e => setEtapaField(idx, 'manoObra', Number(e.target.value) || 0)}
                      placeholder="0"
                      style={{
                        width: '100%', textAlign: 'right', fontWeight: 600, fontSize: 13,
                        padding: '6px 8px', borderRadius: 6,
                        border: `1.5px solid ${etapa.manoObra > 0 ? color : 'var(--border)'}`,
                        background: 'var(--white)', color: '#1a1a1a',
                      }}
                    />

                    {/* MAT input */}
                    <input
                      type="number"
                      value={etapa.materiales || ''}
                      onChange={e => setEtapaField(idx, 'materiales', Number(e.target.value) || 0)}
                      placeholder="0"
                      style={{
                        width: '100%', textAlign: 'right', fontWeight: 600, fontSize: 13,
                        padding: '6px 8px', borderRadius: 6,
                        border: `1.5px solid ${etapa.materiales > 0 ? color : 'var(--border)'}`,
                        background: 'var(--white)', color: '#1a1a1a',
                      }}
                    />

                    {/* Total */}
                    <span style={{
                      textAlign: 'right', fontWeight: 800, fontSize: 14,
                      color: activa ? color : '#ccc',
                      padding: '6px 8px',
                    }}>
                      {activa ? `$${fmt(etapa.total)}` : '—'}
                    </span>
                  </div>

                  {/* Description */}
                  <div style={{ padding: '0 12px 10px', paddingLeft: 62 }}>
                    <input
                      value={etapa.descripcion}
                      onChange={e => setEtapaField(idx, 'descripcion', e.target.value)}
                      placeholder="Descripción de lo incluido (aparece en el PDF)..."
                      style={{
                        width: '100%', fontSize: 12, padding: '5px 0',
                        border: 'none', borderBottom: '1px solid var(--border)',
                        background: 'transparent', color: '#615e5b',
                      }}
                    />
                  </div>
                </div>
              )
            })}
          </div>

          {/* Totals summary */}
          <div style={{
            marginTop: 16, borderRadius: 10,
            border: '2px solid #e69a21',
            overflow: 'hidden',
          }}>
            {/* Column headers for totals */}
            <div style={{
              display: 'grid', gridTemplateColumns: '44px 1fr 120px 120px 120px',
              gap: 6, padding: '8px 12px',
              background: '#fef9ee',
            }}>
              <span />
              <span style={{ fontSize: 11, fontWeight: 700, color: '#615e5b', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Subtotal Neto</span>
              <span style={{ fontSize: 13, fontWeight: 700, color: '#1a1a1a', textAlign: 'right' }}>${fmt(totalMO)}</span>
              <span style={{ fontSize: 13, fontWeight: 700, color: '#1a1a1a', textAlign: 'right' }}>${fmt(totalMAT)}</span>
              <span style={{ fontSize: 13, fontWeight: 700, color: '#e69a21', textAlign: 'right' }}>${fmt(subtotal)}</span>
            </div>
            <div style={{
              display: 'grid', gridTemplateColumns: '44px 1fr 120px 120px 120px',
              gap: 6, padding: '6px 12px',
              borderTop: '1px solid #f0e0c0',
            }}>
              <span />
              <span style={{ fontSize: 11, color: '#615e5b' }}>IVA (19%)</span>
              <span /><span />
              <span style={{ fontSize: 13, color: '#1a1a1a', textAlign: 'right' }}>${fmt(iva)}</span>
            </div>
            <div style={{
              display: 'grid', gridTemplateColumns: '44px 1fr 120px 120px 120px',
              gap: 6, padding: '10px 12px',
              background: '#e69a21',
            }}>
              <span />
              <span style={{ fontSize: 13, fontWeight: 800, color: '#fff' }}>TOTAL</span>
              <span /><span />
              <span style={{ fontSize: 16, fontWeight: 800, color: '#fff', textAlign: 'right' }}>${fmt(total)}</span>
            </div>
          </div>

          <button
            className="btn btn-lg"
            onClick={generarPDF}
            style={{
              marginTop: 16, width: '100%', fontWeight: 800, fontSize: 16,
              background: '#615e5b', color: '#fff', border: 'none',
              borderBottom: '4px solid #e69a21', borderRadius: 10,
            }}
          >
            📄 Generar PDF — Presupuesto Itemizado
          </button>
        </div>

        <p style={{ textAlign: 'center', fontSize: 12, color: '#93918e' }}>
          Podés editar cada monto antes de generar el PDF.
        </p>
      </div>
    </div>
  )
}
