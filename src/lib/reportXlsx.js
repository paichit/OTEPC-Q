import ExcelJS from 'exceljs';
import { reportTable } from './report.js';

export async function reportXlsx(rows, group, groups) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('รายงานคิว');
  const table = reportTable(rows, group, groups);
  table.forEach(row => sheet.addRow(row));
  sheet.columns = [{ width: 17 }, { width: 28 }, { width: 24 }, { width: 19 }, { width: 29 }];
  sheet.getRow(1).font = { bold: true, color: { argb: 'FF000000' } };
  sheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFBAFFDF' } };
  sheet.views = [{ state: 'frozen', ySplit: 1 }];
  sheet.autoFilter = 'A1:E1';
  const buffer = await workbook.xlsx.writeBuffer();
  return new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}
