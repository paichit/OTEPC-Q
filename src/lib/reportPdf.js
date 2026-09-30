import pdfMake from 'pdfmake/build/pdfmake';
import { reportTable } from './report.js';

async function fontBase64(name) {
  const response = await fetch(`/fonts/${name}`);
  if (!response.ok) throw new Error(`ไม่สามารถโหลดฟอนต์ PDF: ${name}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 8192) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
  }
  return btoa(binary);
}

export async function reportPdf(rows, group, from, to) {
  const [regular, bold] = await Promise.all([
    fontBase64('Sarabun-Regular.ttf'), fontBase64('Sarabun-Bold.ttf'),
  ]);
  const table = reportTable(rows, group);
  const scope = group === 'A' ? 'กลุ่มทั่วไป' : group === 'B' ? 'กลุ่มประสบการณ์' : 'ทุกกลุ่ม';
  const period = from || to ? `ช่วงวันที่ ${from || 'เริ่มต้น'} ถึง ${to || 'ปัจจุบัน'}` : 'ทุกวันที่มีบันทึก';
  const definition = {
    pageSize: 'A4', pageOrientation: 'landscape', pageMargins: [28, 38, 28, 38],
    defaultStyle: { font: 'Sarabun', fontSize: 10 },
    content: [
      { text: `รายงานคิว OTEPC Q · ${scope}`, style: 'title' },
      { text: `${period} · ${table.length - 1} รายการ`, margin: [0, 0, 0, 12] },
      { table: { headerRows: 1, widths: ['auto', '*', 'auto', 'auto', 'auto'], body: table.map((row, index) => row.map(value => ({ text: String(value ?? ''), bold: index === 0 }))) }, layout: 'lightHorizontalLines' },
    ],
    styles: { title: { fontSize: 16, bold: true, margin: [0, 0, 0, 6] } },
  };
  const fonts = { Sarabun: { normal: 'Sarabun-Regular.ttf', bold: 'Sarabun-Bold.ttf', italics: 'Sarabun-Regular.ttf', bolditalics: 'Sarabun-Bold.ttf' } };
  const vfs = { 'Sarabun-Regular.ttf': regular, 'Sarabun-Bold.ttf': bold };
  return new Promise((resolve, reject) => {
    try { pdfMake.createPdf(definition, undefined, fonts, vfs).getBlob(resolve); }
    catch (error) { reject(error); }
  });
}
