import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'
import logoSrc from '../assets/Logo.PNG'

export interface Etapa {
  numero: string
  nombre: string
  descripcion: string
  total: number
}

interface Client {
  name: string
  rut: string
  email: string
  address: string
}

// Brand colors
const CARBON: [number, number, number]  = [97, 94, 91]    // #615E5B
const AMBER: [number, number, number]   = [230, 154, 33]  // #E69A21
const WHITE: [number, number, number]   = [255, 255, 255]
const BLACK: [number, number, number]   = [0, 0, 0]
const HUESO: [number, number, number]   = [244, 244, 241] // #F4F4F1
const BORDER: [number, number, number]  = [200, 200, 200]

export const generatePDFEtapas = async (client: Client, etapas: Etapa[]) => {
  const doc = new jsPDF('p', 'mm', 'a4')
  const pageWidth = doc.internal.pageSize.getWidth()
  const margin = 15
  let y = margin

  const fmt = (n: number) => Math.round(n).toLocaleString('es-CL')
  const pad = (n: number) => String(n).padStart(2, '0')
  const today = new Date()
  const currentDate = `${pad(today.getDate())}-${pad(today.getMonth() + 1)}-${today.getFullYear()}`
  const validDate = (() => {
    const d = new Date(); d.setDate(d.getDate() + 15)
    return `${pad(d.getDate())}-${pad(d.getMonth() + 1)}-${d.getFullYear()}`
  })()

  // 1. ── HEADER ────────────────────────────────────────
  const headerH = 48
  doc.setFillColor(...CARBON as [number, number, number])
  doc.rect(0, 0, pageWidth, headerH, 'F')

  // Logo (left side)
  try {
    doc.addImage(logoSrc, 'PNG', margin, 6, 36, 36)
  } catch { /* skip if logo fails */ }

  // Title (right of logo)
  const titleX = margin + 42
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(17)
  doc.setTextColor(...WHITE as [number, number, number])
  doc.text('PRESUPUESTO ITEMIZADO', titleX, 20)

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(13)
  doc.setTextColor(...AMBER as [number, number, number])
  doc.text('ETAPAS DE OBRA', titleX, 30)

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(9)
  doc.setTextColor(...WHITE as [number, number, number])
  doc.text('Horma Electricidad — Estándar de Ingeniería', titleX, 40)

  y = headerH + 8

  // 2. ── COMPANY + DATES ───────────────────────────────
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(10)
  doc.setTextColor(...BLACK as [number, number, number])
  doc.text('HORMA SPA', margin, y)

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(9)
  doc.text('Morande 696  |  +56 9 2014 4427', margin, y + 5)
  doc.setTextColor(0, 0, 200)
  doc.textWithLink('contacto@hormaelectricidad.cl', margin, y + 10, { url: 'mailto:contacto@hormaelectricidad.cl' })

  doc.setTextColor(...BLACK as [number, number, number])
  const dateText = `Fecha:        ${currentDate}`
  const validText = `Válido hasta: ${validDate}`
  const rightX = pageWidth - margin - Math.max(doc.getTextWidth(dateText), doc.getTextWidth(validText))
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(9)
  doc.text(dateText, rightX, y + 5)
  doc.text(validText, rightX, y + 10)

  y += 20

  // Separator line
  doc.setDrawColor(...AMBER as [number, number, number])
  doc.setLineWidth(0.8)
  doc.line(margin, y, pageWidth - margin, y)
  y += 8

  // 3. ── CLIENT TABLE ──────────────────────────────────
  autoTable(doc, {
    startY: y,
    head: [],
    body: [
      [
        { content: 'CLIENTE', styles: { fontStyle: 'bold', textColor: WHITE, fillColor: CARBON, fontSize: 8 } },
        { content: client.name || '', styles: { fontStyle: 'bold', fontSize: 10 } },
        { content: 'E-MAIL', styles: { fontStyle: 'bold', textColor: WHITE, fillColor: CARBON, fontSize: 8 } },
        { content: client.email || '', styles: { fontSize: 9 } },
      ],
      [
        { content: 'DIRECCIÓN', styles: { fontStyle: 'bold', textColor: WHITE, fillColor: CARBON, fontSize: 8 } },
        { content: client.address || '', colSpan: 3, styles: { fontSize: 9 } },
      ],
    ],
    theme: 'grid',
    styles: { fontSize: 9, cellPadding: 2, minCellHeight: 7, lineWidth: 0.15, lineColor: BORDER, textColor: BLACK },
    columnStyles: {
      0: { cellWidth: (pageWidth - 2 * margin) * 0.14 },
      1: { cellWidth: (pageWidth - 2 * margin) * 0.36 },
      2: { cellWidth: (pageWidth - 2 * margin) * 0.14 },
      3: { cellWidth: (pageWidth - 2 * margin) * 0.36 },
    },
    margin: { left: margin, right: margin },
  })
  y = (doc as any).lastAutoTable.finalY + 10

  // 4. ── PHASES TABLE ──────────────────────────────────
  const activeEtapas = etapas.filter(e => e.total > 0)
  const subtotal = etapas.reduce((s, e) => s + e.total, 0)
  const iva = Math.round(subtotal * 0.19)
  const total = subtotal + iva

  const rows: any[] = [
    // Column header
    [
      { content: 'N°', styles: { fillColor: CARBON, textColor: WHITE, fontStyle: 'bold', halign: 'center', fontSize: 10 } },
      { content: 'ETAPA / DESCRIPCIÓN', styles: { fillColor: CARBON, textColor: WHITE, fontStyle: 'bold', fontSize: 10 } },
      { content: 'NETO', styles: { fillColor: CARBON, textColor: WHITE, fontStyle: 'bold', halign: 'right', fontSize: 10 } },
    ],
  ]

  activeEtapas.forEach(etapa => {
    // Phase name row (amber left strip)
    rows.push([
      { content: etapa.numero, styles: { fillColor: AMBER, textColor: WHITE, fontStyle: 'bold', halign: 'center', fontSize: 11 } },
      { content: etapa.nombre, styles: { fillColor: WHITE, textColor: BLACK, fontStyle: 'bold', fontSize: 11 } },
      { content: `$${fmt(etapa.total)}`, styles: { fillColor: WHITE, textColor: BLACK, fontStyle: 'bold', halign: 'right', fontSize: 11 } },
    ])
    // Description row
    if (etapa.descripcion) {
      rows.push([
        { content: '', styles: { fillColor: HUESO } },
        { content: etapa.descripcion, styles: { fillColor: HUESO, textColor: CARBON, fontSize: 8, fontStyle: 'italic' } },
        { content: '', styles: { fillColor: HUESO } },
      ])
    }
  })

  // Subtotal / IVA / Total rows
  rows.push([
    { content: '', styles: { fillColor: WHITE, lineColor: WHITE } },
    { content: 'SUBTOTAL NETO', styles: { fontStyle: 'bold', halign: 'right', textColor: BLACK, fontSize: 10 } },
    { content: `$${fmt(subtotal)}`, styles: { fontStyle: 'bold', halign: 'right', textColor: BLACK, fontSize: 10 } },
  ])
  rows.push([
    { content: '', styles: { fillColor: WHITE, lineColor: WHITE } },
    { content: 'IVA (19%)', styles: { halign: 'right', textColor: BLACK, fontSize: 10 } },
    { content: `$${fmt(iva)}`, styles: { halign: 'right', textColor: BLACK, fontSize: 10 } },
  ])
  rows.push([
    { content: '', styles: { fillColor: AMBER } },
    { content: 'TOTAL', styles: { fillColor: AMBER, textColor: WHITE, fontStyle: 'bold', halign: 'right', fontSize: 12 } },
    { content: `$${fmt(total)}`, styles: { fillColor: AMBER, textColor: WHITE, fontStyle: 'bold', halign: 'right', fontSize: 12 } },
  ])

  autoTable(doc, {
    startY: y,
    head: [],
    body: rows,
    theme: 'grid',
    styles: { fontSize: 9, cellPadding: 2.5, minCellHeight: 8, lineWidth: 0.15, lineColor: BORDER, textColor: BLACK },
    columnStyles: {
      0: { cellWidth: 22, halign: 'center' },
      1: { cellWidth: 'auto' },
      2: { cellWidth: 52, halign: 'right' },
    },
    margin: { left: margin, right: margin },
  })
  y = (doc as any).lastAutoTable.finalY + 10

  // 5. ── TERMS ─────────────────────────────────────────
  doc.setFillColor(...CARBON as [number, number, number])
  doc.rect(margin, y, pageWidth - 2 * margin, 48, 'F')

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(10)
  doc.setTextColor(...AMBER as [number, number, number])
  doc.text('TÉRMINOS Y CONDICIONES', margin + 8, y + 10)

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(9)
  doc.setTextColor(...WHITE as [number, number, number])
  ;[
    'Forma de pago: 50% Adelanto para compra de equipos y materiales.',
    '50% contra entrega de los trabajos terminados.',
    'Transferencia bancaria: Mercado Pago – Cuenta Vista',
    'N° cuenta: 1092804013  |  RUT: 77.518.498-1  |  Titular: HORMA SPA',
  ].forEach((line, i) => doc.text(line, margin + 8, y + 22 + i * 6))
  y += 58

  // 6. ── FOOTER ────────────────────────────────────────
  doc.setDrawColor(...AMBER as [number, number, number])
  doc.setLineWidth(0.8)
  doc.line(margin, y, pageWidth - margin, y)
  y += 8

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(12)
  doc.setTextColor(...CARBON as [number, number, number])
  const footer = '¡Gracias por confiar en nosotros!'
  doc.text(footer, (pageWidth - doc.getTextWidth(footer)) / 2, y)

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(9)
  doc.setTextColor(0, 0, 200)
  doc.textWithLink('www.hormaelectricidad.cl', (pageWidth - doc.getTextWidth('www.hormaelectricidad.cl')) / 2, y + 7, { url: 'https://www.hormaelectricidad.cl' })

  doc.save('presupuesto-itemizado.pdf')
}
