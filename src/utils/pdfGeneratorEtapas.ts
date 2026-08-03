import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'
import logoSrc from '../assets/Logo.PNG'

export interface Item {
  subNumero: string
  descripcion: string
  cantidad: number
  precioUnitario: number
  tipo: 'MO' | 'MAT'
  total: number
}

export interface Etapa {
  numero: string
  nombre: string
  items: Item[]
  totalMO: number
  totalMAT: number
  total: number
}

interface Client {
  name: string
  telefono: string
  email: string
  address: string
}

// Brand palette — explicit tuple types required by jsPDF
const CARBON:       [number, number, number] = [20, 33, 61]      // #14213D — azul marino
const AMBER:        [number, number, number] = [193, 68, 14]     // #c1440e — naranja
const AMBER_LIGHT:  [number, number, number] = [253, 226, 214]   // phase header bg
const AMBER_TEXT:   [number, number, number] = [120, 46, 6]      // text on amber-light bg
const WHITE:        [number, number, number] = [255, 255, 255]
const BLACK:        [number, number, number] = [26, 26, 26]
const HUESO:        [number, number, number] = [245, 245, 240]   // #F5F5F0 — item row bg
const BORDER:       [number, number, number] = [206, 209, 212]
const GRAY_MID:     [number, number, number] = [108, 117, 125]   // #6C757D — gris concreto
const SUBTOT_BG:    [number, number, number] = [232, 233, 234]   // phase subtotal row

export const generatePDFEtapas = async (
  client: Client,
  etapas: Etapa[],
  gg: { pct: number; amount: number } = { pct: 0, amount: 0 }
) => {
  const doc       = new jsPDF('p', 'mm', 'a4')
  const pageWidth = doc.internal.pageSize.getWidth()  // 210mm
  const margin    = 14
  const contentW  = pageWidth - 2 * margin            // 182mm
  let y = margin

  const fmt   = (n: number) => Math.round(n || 0).toLocaleString('es-CL')
  const pad   = (n: number) => String(n).padStart(2, '0')
  const today = new Date()
  const currentDate = `${pad(today.getDate())}-${pad(today.getMonth() + 1)}-${today.getFullYear()}`
  const validDate   = (() => {
    const d = new Date(); d.setDate(d.getDate() + 15)
    return `${pad(d.getDate())}-${pad(d.getMonth() + 1)}-${d.getFullYear()}`
  })()

  // ── 1. HEADER ────────────────────────────────────────────────────
  const hH = 46
  doc.setFillColor(...CARBON)
  doc.rect(0, 0, pageWidth, hH, 'F')
  doc.setFillColor(...AMBER)
  doc.rect(0, hH - 3, pageWidth, 3, 'F')

  try { doc.addImage(logoSrc, 'PNG', margin, 5, 34, 34) } catch { /* skip */ }

  const tx = margin + 40
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(15)
  doc.setTextColor(...WHITE)
  doc.text('PRESUPUESTO HORMA SERVICIOS', tx, 18)

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(10)
  doc.setTextColor(...AMBER)
  doc.text('PRESUPUESTO ITEMIZADO POR ETAPAS DE OBRA', tx, 27)

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(7.5)
  doc.setTextColor(210, 210, 210)
  doc.text('Estándar de ingeniería — Horma Servicios', tx, 34)

  y = hH + 8

  // ── 2. COMPANY + DATES ───────────────────────────────────────────
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(9.5)
  doc.setTextColor(...BLACK)
  doc.text('HORMA SERVICIOS', margin, y)

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8)
  doc.setTextColor(...BLACK)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8)
  const rightLabel = `Fecha: ${currentDate}   Válido hasta: ${validDate}`
  doc.text(rightLabel, pageWidth - margin - doc.getTextWidth(rightLabel), y + 5.5)

  y += 18

  doc.setDrawColor(...AMBER)
  doc.setLineWidth(0.6)
  doc.line(margin, y, pageWidth - margin, y)
  y += 7

  // ── 3. CLIENT TABLE ──────────────────────────────────────────────
  autoTable(doc, {
    startY: y,
    head: [],
    body: [
      [
        { content: 'CLIENTE',   styles: { fontStyle: 'bold', textColor: WHITE, fillColor: CARBON, fontSize: 7.5, cellPadding: 2 } },
        { content: client.name    || '', styles: { fontStyle: 'bold', fontSize: 9,   textColor: BLACK } },
        { content: 'DIRECCIÓN', styles: { fontStyle: 'bold', textColor: WHITE, fillColor: CARBON, fontSize: 7.5, cellPadding: 2 } },
        { content: client.address || '', styles: { fontSize: 8.5, textColor: BLACK } },
      ],
      [
        { content: 'TELÉFONO',  styles: { fontStyle: 'bold', textColor: WHITE, fillColor: CARBON, fontSize: 7.5, cellPadding: 2 } },
        { content: client.telefono || '', styles: { fontSize: 8.5, textColor: BLACK } },
        { content: 'E-MAIL',    styles: { fontStyle: 'bold', textColor: WHITE, fillColor: CARBON, fontSize: 7.5, cellPadding: 2 } },
        { content: client.email || '', styles: { fontSize: 8.5, textColor: BLACK } },
      ],
    ],
    theme: 'grid',
    styles: { fontSize: 8.5, cellPadding: 2.5, minCellHeight: 7, lineWidth: 0.12, lineColor: BORDER },
    columnStyles: {
      0: { cellWidth: contentW * 0.11 },
      1: { cellWidth: contentW * 0.39 },
      2: { cellWidth: contentW * 0.11 },
      3: { cellWidth: contentW * 0.39 },
    },
    margin: { left: margin, right: margin },
  })
  y = (doc as any).lastAutoTable.finalY + 8

  // ── 4. MAIN TABLE — 7 columns ────────────────────────────────────
  // N°(5%) | Descripción(35%) | Cant.(8%) | P.Unit.(12%) | MO(12%) | MAT(12%) | Total(16%)
  const cW = {
    num:   contentW * 0.05,   //  9.1mm
    desc:  contentW * 0.35,   // 63.7mm
    cant:  contentW * 0.08,   // 14.6mm
    punit: contentW * 0.12,   // 21.8mm
    mo:    contentW * 0.12,   // 21.8mm
    mat:   contentW * 0.12,   // 21.8mm
    total: contentW * 0.16,   // 29.1mm
  }

  const activeEtapas   = etapas.filter(e => e.items.length > 0)
  const grandTotalMO   = etapas.reduce((s, e) => s + (Number(e.totalMO)  || 0), 0)
  const grandTotalMAT  = etapas.reduce((s, e) => s + (Number(e.totalMAT) || 0), 0)
  const ggAmount       = gg?.amount || 0
  const subtotal       = grandTotalMO + grandTotalMAT + ggAmount
  const iva            = Math.round(subtotal * 0.19)
  const total          = subtotal + iva

  const rows: any[] = []

  // Global column header row
  rows.push([
    { content: 'N°',            styles: { fillColor: CARBON, textColor: WHITE, fontStyle: 'bold', halign: 'center', fontSize: 7 } },
    { content: 'DESCRIPCIÓN / CONCEPTO', styles: { fillColor: CARBON, textColor: WHITE, fontStyle: 'bold', fontSize: 7 } },
    { content: 'CANT.',         styles: { fillColor: CARBON, textColor: WHITE, fontStyle: 'bold', halign: 'center', fontSize: 7 } },
    { content: 'P. UNITARIO',   styles: { fillColor: CARBON, textColor: WHITE, fontStyle: 'bold', halign: 'right',  fontSize: 7 } },
    { content: 'MANO DE OBRA',  styles: { fillColor: CARBON, textColor: WHITE, fontStyle: 'bold', halign: 'right',  fontSize: 7 } },
    { content: 'MATERIALES',    styles: { fillColor: CARBON, textColor: WHITE, fontStyle: 'bold', halign: 'right',  fontSize: 7 } },
    { content: 'TOTAL',         styles: { fillColor: AMBER,  textColor: WHITE, fontStyle: 'bold', halign: 'right',  fontSize: 7 } },
  ])

  activeEtapas.forEach(etapa => {
    // Phase header — número en col N°, nombre en las 6 restantes
    rows.push([
      { content: etapa.numero,
        styles: { fillColor: AMBER_LIGHT, textColor: AMBER_TEXT, fontStyle: 'bold', halign: 'center', fontSize: 8.5,
          cellPadding: { top: 4, bottom: 4, left: 2, right: 2 } } },
      { content: etapa.nombre.toUpperCase(), colSpan: 6,
        styles: { fillColor: AMBER_LIGHT, textColor: AMBER_TEXT, fontStyle: 'bold', halign: 'left', fontSize: 8.5,
          cellPadding: { top: 4, bottom: 4, left: 4, right: 4 } } },
    ])

    // Individual item rows
    etapa.items.forEach(item => {
      rows.push([
        { content: item.subNumero,
          styles: { fillColor: HUESO, textColor: GRAY_MID, halign: 'center', fontSize: 7.5, cellPadding: 2.5 } },
        { content: item.descripcion,
          styles: { fillColor: HUESO, textColor: BLACK, fontSize: 8, cellPadding: 2.5 } },
        { content: String(item.cantidad),
          styles: { fillColor: HUESO, textColor: CARBON, halign: 'center', fontSize: 8, cellPadding: 2.5 } },
        { content: `$${fmt(item.precioUnitario)}`,
          styles: { fillColor: HUESO, textColor: CARBON, halign: 'right', fontSize: 8, cellPadding: 2.5 } },
        { content: item.tipo === 'MO'  ? `$${fmt(item.total)}` : '',
          styles: { fillColor: HUESO, textColor: BLACK, halign: 'right', fontSize: 8, cellPadding: 2.5 } },
        { content: item.tipo === 'MAT' ? `$${fmt(item.total)}` : '',
          styles: { fillColor: HUESO, textColor: BLACK, halign: 'right', fontSize: 8, cellPadding: 2.5 } },
        { content: `$${fmt(item.total)}`,
          styles: { fillColor: HUESO, textColor: BLACK, fontStyle: 'bold', halign: 'right', fontSize: 8, cellPadding: 2.5 } },
      ])
    })

    // Phase subtotal row (only when there are multiple items)
    if (etapa.items.length > 1) {
      rows.push([
        { content: '', styles: { fillColor: SUBTOT_BG, lineColor: SUBTOT_BG } },
        { content: `Subtotal ${etapa.numero}`,
          styles: { fillColor: SUBTOT_BG, textColor: CARBON, fontStyle: 'bold', halign: 'right', fontSize: 7.5, cellPadding: { top: 2.5, bottom: 2.5, left: 2, right: 2 } } },
        { content: '', styles: { fillColor: SUBTOT_BG } },
        { content: '', styles: { fillColor: SUBTOT_BG } },
        { content: `$${fmt(etapa.totalMO)}`,
          styles: { fillColor: SUBTOT_BG, textColor: CARBON, halign: 'right', fontSize: 7.5, cellPadding: { top: 2.5, bottom: 2.5, left: 2, right: 2 } } },
        { content: `$${fmt(etapa.totalMAT)}`,
          styles: { fillColor: SUBTOT_BG, textColor: CARBON, halign: 'right', fontSize: 7.5, cellPadding: { top: 2.5, bottom: 2.5, left: 2, right: 2 } } },
        { content: `$${fmt(etapa.total)}`,
          styles: { fillColor: SUBTOT_BG, textColor: BLACK, fontStyle: 'bold', halign: 'right', fontSize: 8, cellPadding: { top: 2.5, bottom: 2.5, left: 2, right: 2 } } },
      ])
    }
  })

  // Footer rows: COSTOS DIRECTOS → (GG) → SUBTOTAL NETO → IVA → TOTAL
  const costosDirectos = grandTotalMO + grandTotalMAT
  if (ggAmount > 0) {
    // COSTOS DIRECTOS con desglose MO/MAT
    rows.push([
      { content: '', styles: { fillColor: WHITE, lineColor: BORDER } },
      { content: 'COSTOS DIRECTOS',
        styles: { fillColor: WHITE, textColor: CARBON, fontStyle: 'bold', halign: 'right', fontSize: 8.5, cellPadding: 3 } },
      { content: '', styles: { fillColor: WHITE } },
      { content: '', styles: { fillColor: WHITE } },
      { content: `$${fmt(grandTotalMO)}`,
        styles: { fillColor: WHITE, textColor: GRAY_MID, halign: 'right', fontSize: 8.5, cellPadding: 3 } },
      { content: `$${fmt(grandTotalMAT)}`,
        styles: { fillColor: WHITE, textColor: GRAY_MID, halign: 'right', fontSize: 8.5, cellPadding: 3 } },
      { content: `$${fmt(costosDirectos)}`,
        styles: { fillColor: WHITE, textColor: BLACK, fontStyle: 'bold', halign: 'right', fontSize: 9, cellPadding: 3 } },
    ])
    // GASTOS GENERALES (sin porcentaje visible)
    rows.push([
      { content: '', styles: { fillColor: WHITE, lineColor: BORDER } },
      { content: 'Gastos Generales y Logística',
        styles: { fillColor: WHITE, textColor: GRAY_MID, halign: 'right', fontSize: 8, cellPadding: 3 } },
      { content: '', styles: { fillColor: WHITE } },
      { content: '', styles: { fillColor: WHITE } },
      { content: '', styles: { fillColor: WHITE } },
      { content: '', styles: { fillColor: WHITE } },
      { content: `$${fmt(ggAmount)}`,
        styles: { fillColor: WHITE, textColor: GRAY_MID, halign: 'right', fontSize: 8, cellPadding: 3 } },
    ])
    // SUBTOTAL NETO (costos directos + GG)
    rows.push([
      { content: '', styles: { fillColor: WHITE, lineColor: BORDER } },
      { content: 'SUBTOTAL NETO',
        styles: { fillColor: WHITE, textColor: CARBON, fontStyle: 'bold', halign: 'right', fontSize: 8.5, cellPadding: 3 } },
      { content: '', styles: { fillColor: WHITE } },
      { content: '', styles: { fillColor: WHITE } },
      { content: '', styles: { fillColor: WHITE } },
      { content: '', styles: { fillColor: WHITE } },
      { content: `$${fmt(subtotal)}`,
        styles: { fillColor: WHITE, textColor: BLACK, fontStyle: 'bold', halign: 'right', fontSize: 9, cellPadding: 3 } },
    ])
  } else {
    // Sin GG: SUBTOTAL NETO con desglose MO/MAT
    rows.push([
      { content: '', styles: { fillColor: WHITE, lineColor: BORDER } },
      { content: 'SUBTOTAL NETO',
        styles: { fillColor: WHITE, textColor: CARBON, fontStyle: 'bold', halign: 'right', fontSize: 8.5, cellPadding: 3 } },
      { content: '', styles: { fillColor: WHITE } },
      { content: '', styles: { fillColor: WHITE } },
      { content: `$${fmt(grandTotalMO)}`,
        styles: { fillColor: WHITE, textColor: GRAY_MID, halign: 'right', fontSize: 8.5, cellPadding: 3 } },
      { content: `$${fmt(grandTotalMAT)}`,
        styles: { fillColor: WHITE, textColor: GRAY_MID, halign: 'right', fontSize: 8.5, cellPadding: 3 } },
      { content: `$${fmt(subtotal)}`,
        styles: { fillColor: WHITE, textColor: BLACK, fontStyle: 'bold', halign: 'right', fontSize: 9, cellPadding: 3 } },
    ])
  }

  // IVA
  rows.push([
    { content: '', styles: { fillColor: WHITE, lineColor: BORDER } },
    { content: 'IVA (19%)',
      styles: { fillColor: WHITE, textColor: GRAY_MID, halign: 'right', fontSize: 8, cellPadding: { top: 2, bottom: 2, left: 2, right: 2 } } },
    { content: '', styles: { fillColor: WHITE } },
    { content: '', styles: { fillColor: WHITE } },
    { content: '', styles: { fillColor: WHITE } },
    { content: '', styles: { fillColor: WHITE } },
    { content: `$${fmt(iva)}`,
      styles: { fillColor: WHITE, textColor: GRAY_MID, halign: 'right', fontSize: 8, cellPadding: { top: 2, bottom: 2, left: 2, right: 2 } } },
  ])

  // Total final
  rows.push([
    { content: '', styles: { fillColor: AMBER, cellPadding: 4 } },
    { content: 'TOTAL',
      styles: { fillColor: AMBER, textColor: WHITE, fontStyle: 'bold', halign: 'right', fontSize: 11, cellPadding: 4 } },
    { content: '', styles: { fillColor: AMBER } },
    { content: '', styles: { fillColor: AMBER } },
    { content: '', styles: { fillColor: AMBER } },
    { content: '', styles: { fillColor: AMBER } },
    { content: `$${fmt(total)}`,
      styles: { fillColor: AMBER, textColor: WHITE, fontStyle: 'bold', halign: 'right', fontSize: 11, cellPadding: 4 } },
  ])

  autoTable(doc, {
    startY: y,
    head: [],
    body: rows,
    theme: 'grid',
    styles: { fontSize: 8, cellPadding: 2.5, minCellHeight: 8, lineWidth: 0.12, lineColor: BORDER },
    columnStyles: {
      0: { cellWidth: cW.num,   halign: 'center' },
      1: { cellWidth: cW.desc },
      2: { cellWidth: cW.cant,  halign: 'center' },
      3: { cellWidth: cW.punit, halign: 'right' },
      4: { cellWidth: cW.mo,    halign: 'right' },
      5: { cellWidth: cW.mat,   halign: 'right' },
      6: { cellWidth: cW.total, halign: 'right' },
    },
    margin: { left: margin, right: margin },
  })
  y = (doc as any).lastAutoTable.finalY + 8

  // ── 5. TERMS — con sombra suave y esquinas redondeadas ────────────
  doc.setFillColor(225, 226, 227)
  doc.roundedRect(margin + 1, y + 1.5, contentW, 34, 3, 3, 'F')
  doc.setFillColor(...CARBON)
  doc.roundedRect(margin, y, contentW, 34, 3, 3, 'F')

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(8.5)
  doc.setTextColor(...AMBER)
  doc.text('TÉRMINOS Y CONDICIONES', margin + 8, y + 9)

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8)
  doc.setTextColor(...WHITE)
  ;[
    'Forma de pago: 50% Adelanto para compra de equipos y materiales.',
    '50% contra entrega de los trabajos terminados.',
  ].forEach((line, i) => doc.text(line, margin + 8, y + 19 + i * 6))
  y += 44

  // ── 6. FOOTER ────────────────────────────────────────────────────
  doc.setDrawColor(...AMBER)
  doc.setLineWidth(0.6)
  doc.line(margin, y, pageWidth - margin, y)
  y += 7

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(10.5)
  doc.setTextColor(...CARBON)
  const footer = '¡Gracias por confiar en nosotros!'
  doc.text(footer, (pageWidth - doc.getTextWidth(footer)) / 2, y)

  doc.save('presupuesto-horma.pdf')
}
