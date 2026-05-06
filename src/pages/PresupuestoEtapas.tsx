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
  { numero: '1.0', nombre: 'Preparación y Empalme', descripcion: '', total: 0 },
  { numero: '2.0', nombre: 'Canalización y Alimentación', descripcion: '', total: 0 },
  { numero: '3.0', nombre: 'Montaje y Protecciones', descripcion: '', total: 0 },
  { numero: '4.0', nombre: 'Ingeniería y Certificación', descripcion: '', total: 0 },
]

const FASE_COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#8b5cf6']

export default function PresupuestoEtapas() {
  const [client, setClient] = useState<Client>({ name: '', rut: '', email: '', address: '' })
  const [texto, setTexto] = useState('')
  const [etapas, setEtapas] = useState<Etapa[]>(FASES_DEFAULT)
  const [procesado, setProcesado] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const subtotal = etapas.reduce((s, e) => s + e.total, 0)
  const iva = Math.round(subtotal * 0.19)
  const total = subtotal + iva
  const fmt = (n: number) => Math.round(n).toLocaleString('es-CL')

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
      setProcesado(true)
    } catch (e) {
      setError(String(e))
    } finally {
      setLoading(false)
    }
  }

  function setEtapaField(idx: number, field: keyof Etapa, val: string | number) {
    setEtapas(prev => prev.map((e, i) => i === idx ? { ...e, [field]: val } : e))
  }

  async function generarPDF() {
    if (!client.name.trim()) { alert('Ingresá el nombre del cliente antes de generar el PDF.'); return }
    if (subtotal === 0) { alert('Al menos una etapa debe tener un monto mayor a 0.'); return }
    await generatePDFEtapas(client, etapas)
  }

  return (
    <div className="pendientes" style={{ background: 'var(--bg)', minHeight: '100vh' }}>
      <div style={{ maxWidth: 720, margin: '0 auto', padding: '1.5rem 1rem 3rem' }}>

        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: '1.5rem' }}>
          <div style={{
            width: 44, height: 44, background: '#615e5b', borderRadius: 12,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontWeight: 800, color: '#fff', fontSize: 20, flexShrink: 0,
          }}>H</div>
          <div>
            <h1 style={{ fontSize: 18, fontWeight: 800, lineHeight: 1.2 }}>Presupuesto Itemizado por Etapas</h1>
            <p style={{ fontSize: 13, color: 'var(--muted)' }}>Estándar de ingeniería — Horma Electricidad</p>
          </div>
          <a href="/admin" style={{ marginLeft: 'auto', fontSize: 13, color: 'var(--muted)', textDecoration: 'none' }}>← Admin</a>
        </div>

        {/* Client data */}
        <div className="card" style={{ padding: '1.25rem', marginBottom: '1.25rem' }}>
          <p style={{ fontSize: 12, fontWeight: 700, color: 'var(--secondary)', marginBottom: 12, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
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

        {/* Text input + AI */}
        <div className="card" style={{ padding: '1.25rem', marginBottom: '1.25rem' }}>
          <p style={{ fontSize: 12, fontWeight: 700, color: 'var(--secondary)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
            Texto del presupuesto (de Gustavo)
          </p>
          <textarea
            value={texto}
            onChange={e => { setTexto(e.target.value); if (procesado) setProcesado(false) }}
            placeholder={`Mano de obra\nInstalación de tablero de distribución en medidor 100.000\nCanalización y cableado para tablero de cargador 100.000\nInstalación de tablero para cargador 70.000\n...\n\nMateriales:\nTablero de distribución con accesorios 120.000\nMateriales para canalización y cableado 140.000\n...`}
            rows={9}
            style={{ width: '100%', fontSize: 13, fontFamily: 'monospace', resize: 'vertical', lineHeight: 1.5 }}
          />
          {error && <p style={{ color: 'var(--danger)', fontSize: 13, marginTop: 6 }}>{error}</p>}
          <button
            className="btn btn-primary"
            onClick={procesar}
            disabled={loading}
            style={{ marginTop: 12, fontWeight: 700, fontSize: 15 }}
          >
            {loading ? '⏳ Procesando con IA...' : '✨ Agrupar en etapas con IA'}
          </button>
        </div>

        {/* Phases editor */}
        <div className="card" style={{ padding: '1.25rem', marginBottom: '1.25rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
            <p style={{ fontSize: 12, fontWeight: 700, color: 'var(--secondary)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
              Etapas de obra {procesado && <span style={{ color: 'var(--success)', fontWeight: 600, fontSize: 11 }}>✓ Generadas por IA</span>}
            </p>
            {procesado && (
              <button
                onClick={() => { setEtapas(FASES_DEFAULT); setProcesado(false) }}
                style={{ background: 'none', border: 'none', fontSize: 12, color: 'var(--muted)', cursor: 'pointer' }}
              >
                ↺ Limpiar
              </button>
            )}
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {etapas.map((etapa, idx) => (
              <div key={etapa.numero} style={{
                borderRadius: 12, border: `2px solid ${etapa.total > 0 ? FASE_COLORS[idx] + '40' : 'var(--border)'}`,
                background: etapa.total > 0 ? FASE_COLORS[idx] + '08' : 'var(--white)',
                overflow: 'hidden',
              }}>
                {/* Phase header */}
                <div style={{
                  display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px',
                  borderBottom: '1px solid var(--border)',
                  background: etapa.total > 0 ? FASE_COLORS[idx] + '12' : 'var(--bg)',
                }}>
                  <span style={{
                    width: 30, height: 30, borderRadius: 8, flexShrink: 0,
                    background: etapa.total > 0 ? FASE_COLORS[idx] : '#ccc',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    color: '#fff', fontWeight: 800, fontSize: 12,
                  }}>{etapa.numero}</span>
                  <span style={{ fontWeight: 700, fontSize: 14, flex: 1, color: etapa.total > 0 ? 'var(--text)' : 'var(--muted)' }}>
                    {etapa.nombre}
                  </span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    <span style={{ fontSize: 13, color: 'var(--muted)', fontWeight: 600 }}>$</span>
                    <input
                      type="number"
                      value={etapa.total || ''}
                      onChange={e => setEtapaField(idx, 'total', Number(e.target.value) || 0)}
                      placeholder="0"
                      style={{
                        width: 130, textAlign: 'right', fontWeight: 700, fontSize: 15,
                        padding: '6px 10px', borderRadius: 8,
                        border: `1.5px solid ${etapa.total > 0 ? FASE_COLORS[idx] : 'var(--border)'}`,
                        background: 'var(--white)', color: etapa.total > 0 ? FASE_COLORS[idx] : 'var(--text)',
                      }}
                    />
                  </div>
                </div>
                {/* Description */}
                <div style={{ padding: '8px 14px' }}>
                  <input
                    value={etapa.descripcion}
                    onChange={e => setEtapaField(idx, 'descripcion', e.target.value)}
                    placeholder="Descripción de lo incluido en esta etapa..."
                    style={{
                      width: '100%', fontSize: 13, padding: '6px 0',
                      border: 'none', borderBottom: '1px solid var(--border)',
                      background: 'transparent', color: 'var(--secondary)',
                    }}
                  />
                </div>
              </div>
            ))}
          </div>

          {/* Totals summary */}
          <div style={{ marginTop: 16, padding: '14px 16px', background: 'var(--bg)', borderRadius: 10, border: '1.5px solid var(--border)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14, color: 'var(--secondary)', marginBottom: 4 }}>
              <span>Subtotal neto</span>
              <span style={{ fontWeight: 600 }}>${fmt(subtotal)}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14, color: 'var(--secondary)', marginBottom: 8 }}>
              <span>IVA (19%)</span>
              <span>${fmt(iva)}</span>
            </div>
            <div style={{
              display: 'flex', justifyContent: 'space-between',
              fontSize: 18, fontWeight: 800,
              borderTop: '2px solid var(--border)', paddingTop: 10,
            }}>
              <span>TOTAL</span>
              <span style={{ color: 'var(--primary)' }}>${fmt(total)}</span>
            </div>
          </div>

          <button
            className="btn btn-primary btn-lg"
            onClick={generarPDF}
            style={{ marginTop: 16, width: '100%', fontWeight: 800, fontSize: 16, background: '#615e5b', borderColor: '#615e5b' }}
          >
            📄 Generar PDF Itemizado por Etapas
          </button>
        </div>

        <p style={{ textAlign: 'center', fontSize: 12, color: 'var(--muted)' }}>
          Podés editar los montos y descripciones antes de generar el PDF.
        </p>
      </div>
    </div>
  )
}
