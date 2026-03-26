import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { calculateTotals, isMaterialOrManoObra } from './calculationUtils';

interface Item {
  id: number;
  categoria: string;
  description: string;
  price: number;
  quantity: number;
  total: number;
}

interface Client {
  name: string;
  rut: string;
  email: string;
  address: string;
}

export const generatePDF = (client: Client, items: Item[], porcentajeGastos: number = 10) => {
  console.log('Generando PDF con:', items.length, 'items');
  console.log('Cliente:', client);
  console.log('Items:', items);
  console.log('Porcentaje gastos recibido:', porcentajeGastos);

  const doc = new jsPDF('p', 'mm', 'a4');
  const pageWidth = doc.internal.pageSize.getWidth();
  const margin = 15;
  let yPosition = margin;

  // Helper function to format numbers with Chilean style (dots as thousands separator)
  const formatNumber = (num: number): string => {
    return Math.round(num).toLocaleString('es-CL');
  };

  // Helper function to get current date in DD-MM-YYYY format
  const getCurrentDate = (): string => {
    const today = new Date();
    const day = String(today.getDate()).padStart(2, '0');
    const month = String(today.getMonth() + 1).padStart(2, '0');
    const year = today.getFullYear();
    return `${day}-${month}-${year}`;
  };

  // Helper function to get validity date (30 days from now)
  const getValidityDate = (): string => {
    const future = new Date();
    future.setDate(future.getDate() + 30);
    const day = String(future.getDate()).padStart(2, '0');
    const month = String(future.getMonth() + 1).padStart(2, '0');
    const year = future.getFullYear();
    return `${day}-${month}-${year}`;
  };

  // 1. HEADER
  doc.setFillColor(97, 94, 91); // #615e5b
  doc.rect(0, 0, pageWidth, 40, 'F');

  // Title (centered)
  doc.setFont('arial', 'bold');
  doc.setFontSize(20);
  doc.setTextColor(255, 255, 255);
  const titleWidth = doc.getTextWidth('PRESUPUESTO HORMA ELECTRICIDAD');
  const titleX = (pageWidth - titleWidth) / 2;
  doc.text('PRESUPUESTO HORMA ELECTRICIDAD', titleX, 25);

  yPosition = 50;

  // 2. COMPANY DATA
  doc.setFont('arial', 'normal');
  doc.setFontSize(11);
  doc.setTextColor(0, 0, 0);
  doc.text('HORMA ELECTRICIDAD', margin, yPosition);

  doc.setFontSize(10);
  doc.text('Dirección: Morande 696', margin, yPosition + 5);
  doc.text('Teléfono: +56920144427', margin, yPosition + 10);

  // Email as link
  doc.setTextColor(0, 0, 255);
  doc.textWithLink('contacto@hormaelectricidad.cl', margin, yPosition + 15, { url: 'mailto:contacto@hormaelectricidad.cl' });

  // Right column dates
  doc.setTextColor(0, 0, 0);
  const dateText = `Fecha: ${getCurrentDate()}`;
  const validText = `Válido hasta: ${getValidityDate()}`;
  const dateWidth = doc.getTextWidth(dateText);
  const validWidth = doc.getTextWidth(validText);
  const rightX = pageWidth - margin - Math.max(dateWidth, validWidth);

  doc.text(dateText, rightX, yPosition + 5);
  doc.text(validText, rightX, yPosition + 10);

  yPosition += 35;

  // 3. CLIENT DATA TABLE
  const clientTableData = [
    ['Cliente:', client.name || '', 'E-mail:', client.email || ''],
    [{ content: 'Dirección:', colSpan: 1 }, { content: client.address || '', colSpan: 3 }]
  ];

  autoTable(doc, {
    startY: yPosition,
    head: [],
    body: clientTableData,
    theme: 'grid',
    styles: {
      fontSize: 10,
      cellPadding: 1,
      minCellHeight: 6,
      lineWidth: 0.1,
      lineColor: [100, 100, 100]
    },
    headStyles: {
      cellPadding: 1,
      minCellHeight: 6
    },
    columnStyles: {
      0: { cellWidth: (pageWidth - 2 * margin) * 0.15 },
      1: { cellWidth: (pageWidth - 2 * margin) * 0.35 },
      2: { cellWidth: (pageWidth - 2 * margin) * 0.15 },
      3: { cellWidth: (pageWidth - 2 * margin) * 0.35 }
    },
    margin: { left: margin, right: margin }
  });

  yPosition = (doc as any).lastAutoTable.finalY + 10;

  // 4. ITEMS TABLE
  const tableData: any[] = [];

  // Gray header row (first row of table)
  tableData.push([
    { content: '', styles: { fillColor: [97, 94, 91], textColor: [255, 255, 255], fontStyle: 'normal' } },
    { content: 'PRECIO U.', styles: { fillColor: [97, 94, 91], textColor: [255, 255, 255], fontStyle: 'normal', halign: 'center' } },
    { content: 'CANT', styles: { fillColor: [97, 94, 91], textColor: [255, 255, 255], fontStyle: 'normal', halign: 'center' } },
    { content: 'NETO', styles: { fillColor: [97, 94, 91], textColor: [255, 255, 255], fontStyle: 'normal', halign: 'right' } }
  ]);

  // Materials section
  const materials = items.filter(item => item.categoria?.toUpperCase() === 'MATERIALES');
  if (materials.length > 0) {
    const materialsTotal = materials.reduce((sum, item) => sum + (item.price * item.quantity), 0);
    tableData.push([
      { content: 'MATERIALES', styles: { fillColor: [230, 154, 33], textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 10 } },
      { content: `$${formatNumber(materialsTotal)}`, styles: { fillColor: [230, 154, 33], textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 10, halign: 'center' } },
      { content: '', styles: { fillColor: [230, 154, 33], fontSize: 10 } },
      { content: '', styles: { fillColor: [230, 154, 33], fontSize: 10 } }
    ]);
    materials.forEach(item => {
      tableData.push([
        item.description,
        `$${formatNumber(item.price)}`,
        item.quantity.toString(),
        `$${formatNumber(item.total)}`
      ]);
    });
  }

  // Mano de obra section
  const manoObra = items.filter(item => item.categoria?.toUpperCase() === 'MANO DE OBRA');
  if (manoObra.length > 0) {
    const manoObraTotal = manoObra.reduce((sum, item) => sum + (item.price * item.quantity), 0);
    tableData.push([
      { content: 'MANO DE OBRA', styles: { fillColor: [230, 154, 33], textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 10 } },
      { content: `$${formatNumber(manoObraTotal)}`, styles: { fillColor: [230, 154, 33], textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 10, halign: 'center' } },
      { content: '', styles: { fillColor: [230, 154, 33], fontSize: 10 } },
      { content: '', styles: { fillColor: [230, 154, 33], fontSize: 10 } }
    ]);
    manoObra.forEach(item => {
      tableData.push([
        item.description,
        `$${formatNumber(item.price)}`,
        item.quantity.toString(),
        `$${formatNumber(item.total)}`
      ]);
    });
  }

  // Gastos generales section
  const gastosGeneralesAmount = (items
    .filter(item => isMaterialOrManoObra(item.categoria))
    .reduce((sum, item) => sum + (item.price * item.quantity), 0)) * (porcentajeGastos / 100);

  tableData.push([
    { content: 'GASTOS GENERALES', styles: { fillColor: [230, 154, 33], textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 10 } },
    { content: `$${formatNumber(gastosGeneralesAmount)}`, styles: { fillColor: [230, 154, 33], textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 10, halign: 'center' } },
    { content: '', styles: { fillColor: [230, 154, 33], fontSize: 10 } },
    { content: '', styles: { fillColor: [230, 154, 33], fontSize: 10 } }
  ]);
  tableData.push([
    { content: '', colSpan: 3 },
    { content: `$${formatNumber(gastosGeneralesAmount)}`, styles: { halign: 'right' } }
  ]);

  autoTable(doc, {
    startY: yPosition,
    head: [],
    body: tableData,
    theme: 'grid',
    styles: {
      fontSize: 9,
      cellPadding: 1,
      minCellHeight: 6,
      lineWidth: 0.1,
      lineColor: [100, 100, 100]
    },
    headStyles: {
      cellPadding: 1,
      minCellHeight: 6,
      fontSize: 9
    },
    columnStyles: {
      0: { cellWidth: 'auto', halign: 'left' },
      1: { cellWidth: 40, halign: 'center' },
      2: { cellWidth: 25, halign: 'center' },
      3: { cellWidth: 40, halign: 'right' }
    },
    margin: { left: margin, right: margin }
  });

  yPosition = (doc as any).lastAutoTable.finalY + 10;

  // 5. TOTALS TABLE - Usar función reutilizable para consistencia con interfaz
  const { subtotal, neto, iva, total } = calculateTotals(items, porcentajeGastos);

  console.log('Totales calculados en PDF:', { subtotal, gastosGeneralesAmount, neto, iva, total });

  const totalsData = [
    ['Sub Total', `$${formatNumber(neto)}`],
    ['IVA', `$${formatNumber(iva)}`],
    ['Total', `$${formatNumber(total)}`]
  ];

  autoTable(doc, {
    startY: yPosition,
    head: [],
    body: totalsData,
    theme: 'grid',
    styles: {
      fontSize: 10,
      cellPadding: 1,
      minCellHeight: 6,
      lineWidth: 0.1,
      lineColor: [100, 100, 100]
    },
    columnStyles: {
      0: { cellWidth: 30, fontStyle: 'bold' },
      1: { cellWidth: 30, halign: 'right', fontStyle: 'bold' }
    },
    margin: { left: pageWidth - margin - 60 }
  });

  yPosition = (doc as any).lastAutoTable.finalY + 10;

  // 6. TERMS AND CONDITIONS
  doc.setFillColor(147, 145, 142); // #93918e
  doc.rect(margin, yPosition, pageWidth - 2 * margin, 45, 'F');

  doc.setFont('arial', 'bold');
  doc.setFontSize(10);
  doc.setTextColor(255, 255, 255);
  doc.text('TÉRMINOS Y CONDICIONES', margin + 8, yPosition + 10);

  doc.setFont('arial', 'normal');
  doc.setFontSize(9);
  const termsText = [
    'Forma de pago: 50% Adelanto para compra de equipos y materiales.',
    '50% contra entrega de los trabajos',
    'Datos para transferencia bancaria: Mercado Pago – Cuenta Vista',
    'Número de cuenta: 1092804013 | RUT: 77.518.498-1 | Titular: HORMA SPA'
  ];

  termsText.forEach((line, index) => {
    doc.text(line, margin + 8, yPosition + 20 + index * 5);
  });

  yPosition += 55;

  // 7. FOOTER
  doc.setFont('arial', 'bold');
  doc.setFontSize(12);
  doc.setTextColor(0, 0, 0);
  const footerText = '¡Gracias por confiar en nosotros!';
  const footerWidth = doc.getTextWidth(footerText);
  const footerX = (pageWidth - footerWidth) / 2;
  doc.text(footerText, footerX, yPosition + 10);

  // Website below footer
  doc.setFont('arial', 'normal');
  doc.setFontSize(10);
  doc.setTextColor(0, 0, 255);
  doc.textWithLink('www.hormaelectricidad.cl', (pageWidth - 50) / 2, yPosition + 18, { url: 'https://www.hormaelectricidad.cl' });

  // Save the PDF
  doc.save('presupuesto.pdf');
};