import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'
import logoSrc from '../assets/Logo.PNG'

export interface Etapa {
  numero: string
  nombre: string
  descripcion: string
  manoObra: number
  materiales: number
  total: number
}

interface Client {
  name: string
  rut: string
  email: string
  address: string
}

// Brand palette
const CARBON:   [number, number, number] = [97, 94, 91]    // #615E5B
const AMBER:    [number, number, number] = [230, 154, 33]  // #E69A21
const WHITE:    [number, number, number] = [255, 255, 255]
const BLACK:    [number, number, number] = [26, 26, 26]    // near-black
const HUESO:    [number, number, number] = [244, 244, 241] // #F4F4F1
const BORDER:   [number, number, number] = [218, 218, 215]
const GRAY_MID: [number, number, number] = [130, 128, 125] // subtotal secondary values

export const generatePDFEtapas = async (client: Client, etapas: Etapa[]) => {
  const doc = new jsPDF('p', 'mm', 'a4')
  const pageWidth  = doc.internal.pageSize.getWidth()   // 210mm
  const margin     = 15
  const contentW   = pageWidth - 2 * margin              // 180mm
  let y = margin

  const fmt  = (n: number) => Math.round(n).toLocaleString('es-CL')
  const pad  = (n: number) => String(n).padStart(2, '0')
  const today = new Date()
  const currentDate = `${pad(today.getDate())}-${pad(today.getMonth() + 1)}-${today.getFullYear()}`
  const validDate = (() => {
    const d = new Date(); d.setDate(d.getDate() + 15)
    return `${pad(d.getDate())}-${pad(d.getMonth() + 1)}-${d.getFullYear()}`
  })()

  // ── 1. HEADER ─────────────────────────────────────────
  const hH = 46
  doc.setFillColor(...CARBON)
  doc.rect(0, 0, pageWidth, hH, 'F')

  // Amber bottom stripe
  doc.setFillColor(...AMBER)
  doc.rect(0, hH - 3, pageWidth, 3, 'F')

  // Logo
  try { doc.addImage(logoSrc, 'PNG', margin, 5, 34, 34) } catch { /* skip */ }

  // Title text
  const tx = margin + 40
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(16)
  doc.setTextColor(...WHITE)
  doc.text('PRESUPUESTO HORMA ELECTRICIDAD', tx, 18)

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(11)
  doc.setTextColor(...AMBER)
  doc.text('PRESUPUESTO ITEMIZADO POR ETAPAS DE OBRA', tx, 27)

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8)
  doc.setTextColor(220, 220, 220)
  doc.text('Estándar de ingeniería — Horma Electricidad', tx, 35)

  y = hH + 8

  // ── 2. COMPANY + DATES ────────────────────────────────
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(10)
  doc.setTextColor(...BLACK)
  doc.text('HORMA SPA', margin, y)

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(9)
  doc.setTextColor(...CARBON)
  doc.text('Morande 696  |  +56 9 2014 4427', margin, y + 6)
  doc.setTextColor(0, 0, 200)
  doc.textWithLink('contacto@hormaelectricidad.cl', margin, y + 12, { url: 'mailto:contacto@hormaelectricidad.cl' })

  doc.setTextColor(...BLACK)
  doc.setFont('helvetica', 'bold')
  const rightLabel = `Fecha: ${currentDate}   Válido hasta: ${validDate}`
  doc.text(rightLabel, pageWidth - margin - doc.getTextWidth(rightLabel), y + 6)

  y += 20

  // Separator
  doc.setDrawColor(...AMBER)
  doc.setLineWidth(0.6)
  doc.line(margin, y, pageWidth - margin, y)
  y += 8

  // ── 3. CLIENT TABLE ───────────────────────────────────
  autoTable(doc, {
    startY: y,
    head: [],
    body: [
      [
        { content: 'CLIENTE', styles: { fontStyle: 'bold', textColor: WHITE, fillColor: CARBON, fontSize: 8, cellPadding: 2 } },
        { content: client.name || '', styles: { fontStyle: 'bold', fontSize: 10, textColor: BLACK } },
        { content: 'DIRECCIÓN', styles: { fontStyle: 'bold', textColor: WHITE, fillColor: CARBON, fontSize: 8, cellPadding: 2 } },
        { content: client.address || '', styles: { fontSize: 9, textColor: BLACK } },
      ],
      [
        { content: 'RUT', styles: { fontStyle: 'bold', textColor: WHITE, fillColor: CARBON, fontSize: 8, cellPadding: 2 } },
        { content: client.rut || '', styles: { fontSize: 9, textColor: BLACK } },
        { content: 'E-MAIL', styles: { fontStyle: 'bold', textColor: WHITE, fillColor: CARBON, fontSize: 8, cellPadding: 2 } },
        { content: client.email || '', styles: { fontSize: 9, textColor: BLACK } },
      ],
    ],
    theme: 'grid',
    styles: { fontSize: 9, cellPadding: 2, minCellHeight: 7, lineWidth: 0.15, lineColor: BORDER },
    columnStyles: {
      0: { cellWidth: contentW * 0.12 },
      1: { cellWidth: contentW * 0.38 },
      2: { cellWidth: contentW * 0.12 },
      3: { cellWidth: contentW * 0.38 },
    },
    margin: { left: margin, right: margin },
  })
  y = (doc as any).lastAutoTable.finalY + 10

  // ── 4. PHASES TABLE (5 columns) ───────────────────────
  // Column widths: N°(8%) | Etapa(42%) | MO(15%) | MAT(15%) | Total(20%)
  const cW = {
    num:   contentW * 0.08,  // 14.4mm — enough for "5.0" without line-break
    desc:  contentW * 0.42,  // 75.6mm
    mo:    contentW * 0.15,  // 27mm
    mat:   contentW * 0.15,  // 27mm
    total: contentW * 0.20,  // 36mm
  }

  const activeEtapas = etapas.filter(e => e.total > 0)
  const totalMO  = etapas.reduce((s, e) => s + e.manoObra,  0)
  const totalMAT = etapas.reduce((s, e) => s + e.materiales, 0)
  const subtotal = totalMO + totalMAT
  const iva      = Math.round(subtotal * 0.19)
  const total    = subtotal + iva

  const rows: any[] = [
    // Header
    [
      { content: 'N°',              styles: { fillColor: CARBON, textColor: WHITE, fontStyle: 'bold', halign: 'center', fontSize: 7.5 } },
      { content: 'ETAPA / DESCRIPCIÓN', styles: { fillColor: CARBON, textColor: WHITE, fontStyle: 'bold', fontSize: 7.5 } },
      { content: 'MANO DE OBRA',    styles: { fillColor: CARBON, textColor: WHITE, fontStyle: 'bold', halign: 'right', fontSize: 7.5 } },
      { content: 'MATERIALES',      styles: { fillColor: CARBON, textColor: WHITE, fontStyle: 'bold', halign: 'right', fontSize: 7.5 } },
      { content: 'TOTAL NETO',      styles: { fillColor: CARBON, textColor: WHITE, fontStyle: 'bold', halign: 'right', fontSize: 7.5 } },
    ],
  ]

  activeEtapas.forEach(etapa => {
    // Phase row — medium weight, not full bold
    rows.push([
      { content: etapa.numero,
        styles: { fillColor: AMBER, textColor: WHITE, fontStyle: 'bold', halign: 'center', fontSize: 8.5, cellPadding: 3.5 } },
      { content: etapa.nombre,
        styles: { fillColor: HUESO, textColor: BLACK, fontStyle: 'normal', fontSize: 9, cellPadding: 3.5 } },
      { content: etapa.manoObra > 0  ? `$${fmt(etapa.manoObra)}`  : '—',
        styles: { fillColor: HUESO, textColor: BLACK, halign: 'right', fontSize: 9, cellPadding: 3.5 } },
      { content: etapa.materiales > 0 ? `$${fmt(etapa.materiales)}` : '—',
        styles: { fillColor: HUESO, textColor: BLACK, halign: 'right', fontSize: 9, cellPadding: 3.5 } },
      { content: `$${fmt(etapa.total)}`,
        styles: { fillColor: HUESO, textColor: BLACK, fontStyle: 'bold', halign: 'right', fontSize: 9, cellPadding: 3.5 } },
    ])
    // Description row
    if (etapa.descripcion) {
      rows.push([
        { content: '', styles: { fillColor: WHITE, cellPadding: { top: 2, bottom: 3, left: 2, right: 2 } } },
        { content: etapa.descripcion, styles: { fillColor: WHITE, textColor: CARBON, fontSize: 7.5, fontStyle: 'italic', cellPadding: { top: 2, bottom: 3, left: 3, right: 2 } } },
        { content: '', styles: { fillColor: WHITE } },
        { content: '', styles: { fillColor: WHITE } },
        { content: '', styles: { fillColor: WHITE } },
      ])
    }
  })

  // Subtotals — secondary values in GRAY_MID, total column in BLACK for hierarchy
  rows.push([
    { content: '', styles: { fillColor: WHITE, lineColor: WHITE } },
    { content: 'SUBTOTAL NETO', styles: { fontStyle: 'bold', halign: 'right', textColor: CARBON, fontSize: 8.5, fillColor: WHITE, cellPadding: 3.5 } },
    { content: `$${fmt(totalMO)}`,  styles: { fontStyle: 'normal', halign: 'right', textColor: GRAY_MID, fontSize: 8.5, fillColor: WHITE, cellPadding: 3.5 } },
    { content: `$${fmt(totalMAT)}`, styles: { fontStyle: 'normal', halign: 'right', textColor: GRAY_MID, fontSize: 8.5, fillColor: WHITE, cellPadding: 3.5 } },
    { content: `$${fmt(subtotal)}`, styles: { fontStyle: 'bold', halign: 'right', textColor: BLACK, fontSize: 9, fillColor: WHITE, cellPadding: 3.5 } },
  ])
  rows.push([
    { content: '', styles: { fillColor: WHITE, lineColor: WHITE } },
    { content: 'IVA (19%)', styles: { halign: 'right', textColor: GRAY_MID, fontSize: 8, fillColor: WHITE, cellPadding: { top: 2, bottom: 2, left: 2, right: 2 } } },
    { content: '', styles: { fillColor: WHITE } },
    { content: '', styles: { fillColor: WHITE } },
    { content: `$${fmt(iva)}`, styles: { halign: 'right', textColor: GRAY_MID, fontSize: 8, fillColor: WHITE, cellPadding: { top: 2, bottom: 2, left: 2, right: 2 } } },
  ])
  rows.push([
    { content: '', styles: { fillColor: AMBER, cellPadding: 4 } },
    { content: 'TOTAL', styles: { fillColor: AMBER, textColor: WHITE, fontStyle: 'bold', halign: 'right', fontSize: 11, cellPadding: 4 } },
    { content: '', styles: { fillColor: AMBER } },
    { content: '', styles: { fillColor: AMBER } },
    { content: `$${fmt(total)}`, styles: { fillColor: AMBER, textColor: WHITE, fontStyle: 'bold', halign: 'right', fontSize: 11, cellPadding: 4 } },
  ])

  autoTable(doc, {
    startY: y,
    head: [],
    body: rows,
    theme: 'grid',
    styles: { fontSize: 9, cellPadding: 3, minCellHeight: 9, lineWidth: 0.12, lineColor: BORDER },
    columnStyles: {
      0: { cellWidth: cW.num,   halign: 'center' },
      1: { cellWidth: cW.desc },
      2: { cellWidth: cW.mo,   halign: 'right' },
      3: { cellWidth: cW.mat,  halign: 'right' },
      4: { cellWidth: cW.total, halign: 'right' },
    },
    margin: { left: margin, right: margin },
  })
  y = (doc as any).lastAutoTable.finalY + 10

  // ── 5. TERMS ──────────────────────────────────────────
  doc.setFillColor(...CARBON)
  doc.rect(margin, y, contentW, 48, 'F')

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(9)
  doc.setTextColor(...AMBER)
  doc.text('TÉRMINOS Y CONDICIONES', margin + 8, y + 10)

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8.5)
  doc.setTextColor(...WHITE)
  ;[
    'Forma de pago: 50% Adelanto para compra de equipos y materiales.',
    '50% contra entrega de los trabajos terminados.',
    'Transferencia bancaria: Mercado Pago – Cuenta Vista',
    'N° cuenta: 1092804013  |  RUT: 77.518.498-1  |  Titular: HORMA SPA',
  ].forEach((line, i) => doc.text(line, margin + 8, y + 20 + i * 6))
  y += 58

  // ── 6. FOOTER ─────────────────────────────────────────
  doc.setDrawColor(...AMBER)
  doc.setLineWidth(0.6)
  doc.line(margin, y, pageWidth - margin, y)
  y += 8

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(11)
  doc.setTextColor(...CARBON)
  const footer = '¡Gracias por confiar en nosotros!'
  doc.text(footer, (pageWidth - doc.getTextWidth(footer)) / 2, y)

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(9)
  doc.setTextColor(0, 0, 200)
  const web = 'www.hormaelectricidad.cl'
  doc.textWithLink(web, (pageWidth - doc.getTextWidth(web)) / 2, y + 7, { url: 'https://www.hormaelectricidad.cl' })

  doc.save('presupuesto-horma.pdf')
}
