import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'
import logoSrc from '../assets/Logo.PNG'
import { sanitizarNombreArchivo } from './pdfGenerator'

// El PDF que faltaba para cobrar un adicional sin discutir. Gustavo: "en vez de 14 son 17...
// eso que se sumaron, ¿cómo se los muestro al cliente?". El PDF de un adicional lleva solo
// el adicional, así que hasta ahora había que explicarle de palabra cómo se llegó al total.
// Este documento muestra el camino completo: original + cada adicional = vigente.

interface Client {
  name: string
  rut?: string
  telefono?: string
  email?: string
  address?: string
}

// Una línea del desglose, ya normalizada: los presupuestos "simple" guardan items y los
// "etapas" guardan etapas con otra forma, pero para el cliente son lo mismo.
export interface LineaConsolidado {
  descripcion: string
  cantidad: number
  precioUnitario: number
  total: number
  grupo: 'MATERIALES' | 'MANO DE OBRA' | 'OTROS'
}

export interface DocumentoConsolidado {
  titulo: string
  referencia: string | null
  fecha: string
  total: number
  iva: number | null
  // Vacío cuando el presupuesto entró como PDF externo y no se cargó su desglose.
  lineas: LineaConsolidado[]
}

const CARBON: [number, number, number] = [20, 33, 61]
const AMBER: [number, number, number] = [193, 68, 14]
const AMBER_LIGHT: [number, number, number] = [253, 226, 214]
const AMBER_TEXT: [number, number, number] = [120, 46, 6]
const WHITE: [number, number, number] = [255, 255, 255]
const BLACK: [number, number, number] = [26, 26, 26]
const HUESO: [number, number, number] = [245, 245, 240]
const BORDER: [number, number, number] = [206, 209, 212]
const GRAY_MID: [number, number, number] = [108, 117, 125]

export function generatePDFConsolidado(client: Client, documentos: DocumentoConsolidado[]) {
  const doc = new jsPDF('p', 'mm', 'a4')
  const pageWidth = doc.internal.pageSize.getWidth()
  const pageHeight = doc.internal.pageSize.getHeight()
  const margin = 14
  const contentW = pageWidth - 2 * margin
  let y = margin

  const fmt = (n: number) => Math.round(n || 0).toLocaleString('es-CL')
  const pad = (n: number) => String(n).padStart(2, '0')
  const hoy = new Date()
  const fechaHoy = `${pad(hoy.getDate())}-${pad(hoy.getMonth() + 1)}-${hoy.getFullYear()}`

  const totalVigente = documentos.reduce((s, d) => s + (d.total || 0), 0)
  const cantAdicionales = Math.max(documentos.length - 1, 0)

  // ── 1. HEADER ──────────────────────────────────────────────────
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
  doc.text('PRESUPUESTO VIGENTE', tx, 18)

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(9.5)
  doc.setTextColor(...AMBER)
  doc.text(
    `ORIGINAL + ${cantAdicionales} ADICIONAL${cantAdicionales === 1 ? '' : 'ES'} APROBADO${cantAdicionales === 1 ? '' : 'S'}`,
    tx, 27,
  )

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(7.5)
  doc.setTextColor(210, 210, 210)
  doc.text('Resumen de todo lo aprobado hasta hoy. No reemplaza los documentos anteriores.', tx, 34)

  y = hH + 8

  // ── 2. EMPRESA + FECHA ─────────────────────────────────────────
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(9.5)
  doc.setTextColor(...BLACK)
  doc.text('HORMA GRUP', margin, y)

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8)
  const fechaTexto = `Fecha: ${fechaHoy}`
  doc.text(fechaTexto, pageWidth - margin - doc.getTextWidth(fechaTexto), y)

  y += 8
  doc.setDrawColor(...AMBER)
  doc.setLineWidth(0.6)
  doc.line(margin, y, pageWidth - margin, y)
  y += 7

  // ── 3. CLIENTE ─────────────────────────────────────────────────
  autoTable(doc, {
    startY: y,
    head: [],
    body: [
      [
        { content: 'CLIENTE', styles: { fontStyle: 'bold', textColor: WHITE, fillColor: CARBON, fontSize: 7.5, cellPadding: 2 } },
        { content: client.name || '', styles: { fontStyle: 'bold', fontSize: 9, textColor: BLACK } },
        { content: 'DIRECCIÓN', styles: { fontStyle: 'bold', textColor: WHITE, fillColor: CARBON, fontSize: 7.5, cellPadding: 2 } },
        { content: client.address || '', styles: { fontSize: 8.5, textColor: BLACK } },
      ],
      [
        { content: 'TELÉFONO', styles: { fontStyle: 'bold', textColor: WHITE, fillColor: CARBON, fontSize: 7.5, cellPadding: 2 } },
        { content: client.telefono || '', styles: { fontSize: 8.5, textColor: BLACK } },
        { content: 'E-MAIL', styles: { fontStyle: 'bold', textColor: WHITE, fillColor: CARBON, fontSize: 7.5, cellPadding: 2 } },
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

  // ── 4. RESUMEN: la cuenta que el cliente tiene que poder seguir solo ──
  const resumen: any[] = [[
    { content: 'DOCUMENTO', styles: { fillColor: CARBON, textColor: WHITE, fontStyle: 'bold', fontSize: 7 } },
    { content: 'REFERENCIA', styles: { fillColor: CARBON, textColor: WHITE, fontStyle: 'bold', fontSize: 7 } },
    { content: 'FECHA', styles: { fillColor: CARBON, textColor: WHITE, fontStyle: 'bold', halign: 'center', fontSize: 7 } },
    { content: 'TOTAL', styles: { fillColor: AMBER, textColor: WHITE, fontStyle: 'bold', halign: 'right', fontSize: 7 } },
  ]]

  documentos.forEach(d => {
    resumen.push([
      { content: d.titulo, styles: { fillColor: HUESO, textColor: BLACK, fontSize: 8.5 } },
      { content: d.referencia || '—', styles: { fillColor: HUESO, textColor: GRAY_MID, fontSize: 8 } },
      { content: d.fecha, styles: { fillColor: HUESO, textColor: GRAY_MID, halign: 'center', fontSize: 8 } },
      { content: `$${fmt(d.total)}`, styles: { fillColor: HUESO, textColor: BLACK, fontStyle: 'bold', halign: 'right', fontSize: 9 } },
    ])
  })

  resumen.push([
    { content: 'TOTAL VIGENTE', colSpan: 3, styles: { fillColor: AMBER, textColor: WHITE, fontStyle: 'bold', fontSize: 11, cellPadding: 4 } },
    { content: `$${fmt(totalVigente)}`, styles: { fillColor: AMBER, textColor: WHITE, fontStyle: 'bold', halign: 'right', fontSize: 11, cellPadding: 4 } },
  ])

  autoTable(doc, {
    startY: y,
    head: [],
    body: resumen,
    theme: 'grid',
    styles: { fontSize: 8.5, cellPadding: 2.5, minCellHeight: 8, lineWidth: 0.12, lineColor: BORDER },
    columnStyles: {
      0: { cellWidth: contentW * 0.40 },
      1: { cellWidth: contentW * 0.22 },
      2: { cellWidth: contentW * 0.16, halign: 'center' },
      3: { cellWidth: contentW * 0.22, halign: 'right' },
    },
    margin: { left: margin, right: margin },
  })
  y = (doc as any).lastAutoTable.finalY + 4

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(7.5)
  doc.setTextColor(...GRAY_MID)
  doc.text('Los montos incluyen IVA. Cada adicional fue aprobado por separado y se suma al presupuesto original.', margin, y + 3)
  y += 12

  // ── 5. DESGLOSE DE CADA DOCUMENTO ──────────────────────────────
  const anchos = {
    desc: contentW * 0.52,
    cant: contentW * 0.10,
    punit: contentW * 0.19,
    total: contentW * 0.19,
  }

  documentos.forEach(d => {
    // Un título solo al pie de página es peor que una página nueva: si no entran el
    // encabezado del documento y al menos un par de líneas, se pasa de hoja.
    if (y > pageHeight - 60) { doc.addPage(); y = margin }

    const filas: any[] = [[
      { content: `${d.titulo}${d.referencia ? ` · ${d.referencia}` : ''}`, colSpan: 3,
        styles: { fillColor: AMBER_LIGHT, textColor: AMBER_TEXT, fontStyle: 'bold', fontSize: 9, cellPadding: 3.5 } },
      { content: `$${fmt(d.total)}`,
        styles: { fillColor: AMBER_LIGHT, textColor: AMBER_TEXT, fontStyle: 'bold', halign: 'right', fontSize: 9, cellPadding: 3.5 } },
    ]]

    if (d.lineas.length === 0) {
      filas.push([
        { content: 'Este documento se cargó como PDF externo: el detalle línea por línea está en el presupuesto original que ya recibió.',
          colSpan: 4, styles: { fillColor: WHITE, textColor: GRAY_MID, fontSize: 8, cellPadding: 3 } },
      ])
    } else {
      for (const grupo of ['MATERIALES', 'MANO DE OBRA', 'OTROS'] as const) {
        const delGrupo = d.lineas.filter(l => l.grupo === grupo)
        if (delGrupo.length === 0) continue
        // "OTROS" solo aparece si hay ítems sin categoría: los presupuestos entrados por PDF
        // externo no la traen, y forzarlos a "Materiales" mentiría sobre qué se cotizó.
        filas.push([
          { content: grupo, colSpan: 4,
            styles: { fillColor: CARBON, textColor: WHITE, fontStyle: 'bold', fontSize: 7.5, cellPadding: 2 } },
        ])
        delGrupo.forEach(l => {
          filas.push([
            { content: l.descripcion, styles: { fillColor: HUESO, textColor: BLACK, fontSize: 8 } },
            { content: String(l.cantidad), styles: { fillColor: HUESO, textColor: GRAY_MID, halign: 'center', fontSize: 8 } },
            { content: `$${fmt(l.precioUnitario)}`, styles: { fillColor: HUESO, textColor: GRAY_MID, halign: 'right', fontSize: 8 } },
            { content: `$${fmt(l.total)}`, styles: { fillColor: HUESO, textColor: BLACK, halign: 'right', fontSize: 8 } },
          ])
        })
      }
      if (d.iva != null) {
        filas.push([
          { content: 'Neto', colSpan: 3, styles: { fillColor: WHITE, textColor: GRAY_MID, halign: 'right', fontSize: 8 } },
          { content: `$${fmt(d.total - d.iva)}`, styles: { fillColor: WHITE, textColor: GRAY_MID, halign: 'right', fontSize: 8 } },
        ])
        filas.push([
          { content: 'IVA (19%)', colSpan: 3, styles: { fillColor: WHITE, textColor: GRAY_MID, halign: 'right', fontSize: 8 } },
          { content: `$${fmt(d.iva)}`, styles: { fillColor: WHITE, textColor: GRAY_MID, halign: 'right', fontSize: 8 } },
        ])
      }
      filas.push([
        { content: 'Total del documento', colSpan: 3,
          styles: { fillColor: WHITE, textColor: BLACK, fontStyle: 'bold', halign: 'right', fontSize: 9 } },
        { content: `$${fmt(d.total)}`,
          styles: { fillColor: WHITE, textColor: BLACK, fontStyle: 'bold', halign: 'right', fontSize: 9 } },
      ])
    }

    autoTable(doc, {
      startY: y,
      head: [],
      body: filas,
      theme: 'grid',
      styles: { fontSize: 8, cellPadding: 2.5, minCellHeight: 7, lineWidth: 0.12, lineColor: BORDER },
      columnStyles: {
        0: { cellWidth: anchos.desc },
        1: { cellWidth: anchos.cant, halign: 'center' },
        2: { cellWidth: anchos.punit, halign: 'right' },
        3: { cellWidth: anchos.total, halign: 'right' },
      },
      margin: { left: margin, right: margin, top: margin },
    })
    y = (doc as any).lastAutoTable.finalY + 8
  })

  // ── 6. TÉRMINOS ────────────────────────────────────────────────
  const termsH = 58
  if (y > pageHeight - termsH - 30) { doc.addPage(); y = margin }

  doc.setFillColor(225, 226, 227)
  doc.roundedRect(margin + 1, y + 1.5, contentW, termsH, 3, 3, 'F')
  doc.setFillColor(...CARBON)
  doc.roundedRect(margin, y, contentW, termsH, 3, 3, 'F')

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

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(8.5)
  doc.setTextColor(...AMBER)
  doc.text('DATOS PARA TRANSFERENCIA', margin + 8, y + 35)

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8)
  doc.setTextColor(...WHITE)
  ;[
    'Titular: Constructora Horma Grup SPA — RUT: 78.420.993-8',
    'Mercado Pago — Cuenta Vista — N° de cuenta: 1012891392',
    'Contacto: contacto@hormagrup.cl / administracion@hormagrup.cl',
  ].forEach((line, i) => doc.text(line, margin + 8, y + 41 + i * 5.5))
  y += termsH + 10

  // ── 7. PIE ─────────────────────────────────────────────────────
  doc.setDrawColor(...AMBER)
  doc.setLineWidth(0.6)
  doc.line(margin, y, pageWidth - margin, y)
  y += 7

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(10.5)
  doc.setTextColor(...CARBON)
  const pie = '¡Gracias por confiar en nosotros!'
  doc.text(pie, (pageWidth - doc.getTextWidth(pie)) / 2, y)

  const nombreArchivo = sanitizarNombreArchivo(client.name) || 'Cliente'
  doc.save(`Presupuesto vigente ${nombreArchivo} - ${fechaHoy}.pdf`)
}
