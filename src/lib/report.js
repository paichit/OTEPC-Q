import { groups } from './queue.js';

const eventLabels = {
  issued: 'รับคิว', initial: 'เรียกคิว', recall: 'เรียกซ้ำ',
  cancelled: 'ยกเลิกคิว', restored: 'คืนคิว',
};

function csvCell(value) {
  const text = String(value ?? '');
  // Prevent spreadsheet applications from executing values as formulas.
  const safe = /^[=+@\-\t\r\n]/.test(text) ? `'${text}` : text;
  return `"${safe.replaceAll('"', '""')}"`;
}

export function reportTable(rows, group = null) {
  const selected = group ? rows.filter(row => row.service_group === group) : rows;
  const columns = ['วันที่คิว', 'หมายเลขคิว', 'กลุ่มบริการ', 'รายการ', 'วันเวลา'];
  const data = selected.map(row => [
    row.queue_date, row.queue_number, groups[row.service_group] || row.service_group,
    eventLabels[row.event_kind] || row.event_kind,
    row.event_at ? new Intl.DateTimeFormat('th-TH', { timeZone: 'Asia/Bangkok', dateStyle: 'short', timeStyle: 'medium' }).format(new Date(row.event_at)) : '',
  ]);
  return [columns, ...data];
}

export function reportCsv(rows, group = null) {
  return `\ufeff${reportTable(rows, group).map(line => line.map(csvCell).join(',')).join('\r\n')}\r\n`;
}
