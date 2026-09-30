import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
test('starting the queue display requests and plays spoken confirmation', async ({ page }) => {
  await page.addInitScript(() => {
    window.startupPlayCount = 0;
    HTMLMediaElement.prototype.play = function () {
      window.startupPlayCount++;
      return Promise.resolve();
    };
  });
  await page.route('https://queue-test.supabase.co/functions/v1/queue-tts', async route => {
    expect(route.request().postDataJSON()).toEqual({ action: 'startup' });
    await route.fulfill({ status: 200, contentType: 'audio/mpeg', body: 'mock-audio' });
  });
  await page.route('https://queue-test.supabase.co/functions/v1/queue-audio-lock', route => route.fulfill({ json: { acquired: true } }));
  await page.route('https://queue-test.supabase.co/rest/v1/rpc/**', route => route.fulfill({ json: { queue_date: '2026-09-22', queues: [] } }));
  await page.goto('/');
  await page.getByRole('button', { name: 'จอแสดงคิว', exact: true }).click();
  await page.getByRole('button', { name: 'เริ่มระบบและเปิดเสียง' }).click();
  await expect(page.getByRole('heading', { name: 'เชื่อมต่อระบบเสียงประกาศ' })).toHaveCount(0);
  expect(await page.evaluate(() => window.startupPlayCount)).toBe(1);
});
test('kiosk, settings, display and responsive layout', async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  let issued = 0;
  const queues = [];
  await page.route('https://queue-test.supabase.co/rest/v1/rpc/**', async route => {
    const name = route.request().url().split('/').at(-1);
    if (name === 'queue_snapshot') return route.fulfill({ json: { queue_date: '2026-09-22', queues } });
    if (name === 'issue_queue') {
      issued++;
      await new Promise(resolve => setTimeout(resolve, 250));
      const q = { id: 'test-queue', queue_number: 'กลุ่มทั่วไป001', service_group: 'A', status: 'waiting', queue_date: '2026-09-22', created_at: '2026-09-22T02:00:00Z' };
      queues.push(q); return route.fulfill({ json: q });
    }
    return route.fulfill({ json: null });
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'กรุณากดรับคิว' })).toBeVisible();
  await page.screenshot({ path: 'test-results/kiosk-desktop.png', fullPage: true });
  const a = page.getByRole('button', { name: 'รับคิวกลุ่มทั่วไป' });
  await a.click();
  await expect(a).toBeDisabled();
  await expect(page.getByRole('dialog')).toBeVisible();
  expect(issued).toBe(1);
  await expect(page.getByRole('dialog').getByText('กลุ่มทั่วไป001')).toBeVisible();
  await expect(page.getByRole('button', { name: 'พิมพ์บัตรคิว' })).toHaveCount(0);
  await page.getByRole('button', { name: 'ปิดหน้าต่าง' }).click();
  await page.getByRole('button', { name: 'ตั้งค่าระบบ', exact: true }).click();
  await expect(page.getByText('Google Cloud — ไทยผู้หญิง Standard-A')).toBeVisible();
  await expect(page.getByLabel('รูปแบบเสียงประกาศ')).toHaveValue('ขอเชิญหมายเลขคิว {q} ที่ห้องประชุมค่ะ');
  await page.getByRole('button', { name: 'ทดสอบเสียงบนเครื่องนี้' }).click();
  await expect(page.getByText('กรุณาเรียกคิวหนึ่งหมายเลขก่อนทดสอบเสียง Google Cloud')).toBeVisible();
  await page.getByLabel('ข้อความเมื่อยังไม่มีคิวถูกเรียก').fill('กรุณารอเรียกคิวค่ะ');
  await page.getByRole('switch').click();
  await page.getByRole('button', { name: 'บันทึกการตั้งค่า' }).click();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('otepc-settings')).sound)).toBe(false);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('otepc-settings')).idleMarquee)).toBe('กรุณารอเรียกคิวค่ะ');
  await page.reload();
  await page.getByRole('button', { name: 'ตั้งค่าระบบ', exact: true }).click();
  await expect(page.getByRole('switch')).toHaveAttribute('aria-checked', 'false');
  await page.getByRole('button', { name: 'จอแสดงคิว', exact: true }).click();
  await page.getByRole('button', { name: 'เริ่มระบบและเปิดเสียง' }).click();
  await expect(page.getByText('กรุณารอเรียกคิวค่ะ')).toBeVisible();
  await expect(page.getByRole('button', { name: 'เปิดเต็มจอ' })).toBeVisible();
  await expect(page.getByText('คิวถัดไป / Next')).toBeVisible();
  await page.screenshot({ path: 'test-results/display-desktop.png', fullPage: true });
  for (const width of [320, 390, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    for (const label of ['รับบัตรคิว', 'จัดการคิว', 'จอแสดงคิว', 'ตั้งค่าระบบ']) {
      await page.getByRole('button', { name: label, exact: true }).click();
      if (label === 'จอแสดงคิว') await page.getByRole('button', { name: 'เริ่มระบบและเปิดเสียง' }).click();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      if (label === 'จอแสดงคิว') {
        expect(await page.evaluate(() => document.documentElement.scrollHeight <= window.innerHeight + 1)).toBe(true);
      }
      if (width === 390 && label === 'จอแสดงคิว') await page.screenshot({ path: 'test-results/display-mobile.png', fullPage: true });
      if (width === 390 && label === 'ตั้งค่าระบบ') await page.screenshot({ path: 'test-results/settings-mobile.png', fullPage: true });
    }
    const tabs = await page.locator('nav[aria-label="เมนูหลัก"] .nav-item').evaluateAll(items => items.map(item => {
      const rect = item.getBoundingClientRect();
      return { left: rect.left, right: rect.right };
    }));
    expect(tabs.every(tab => tab.left >= 0 && tab.right <= width)).toBe(true);
  }
  await page.setViewportSize({ width: 390, height: 900 });
  await page.getByRole('button', { name: 'รับบัตรคิว', exact: true }).click();
  await page.screenshot({ path: 'test-results/kiosk-mobile.png', fullPage: true });
  queues[0].status = 'calling';
  queues[0].called_at = new Date().toISOString();
  queues.push({ id: 'next-queue', queue_number: 'กลุ่มประสบการณ์002', service_group: 'B', status: 'waiting', queue_date: '2026-09-22', created_at: '2026-09-22T02:00:01Z' });
  await page.setViewportSize({ width: 1920, height: 900 });
  await page.reload();
  await page.getByRole('button', { name: 'จอแสดงคิว', exact: true }).click();
  await page.getByRole('button', { name: 'เริ่มระบบและเปิดเสียง' }).click();
  await expect(page.getByText('กลุ่มประสบการณ์002')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth && document.documentElement.scrollHeight <= window.innerHeight + 1)).toBe(true);
  await page.screenshot({ path: 'test-results/display-tv.png', fullPage: true });
  expect(errors).toEqual([]);
});

test('staff login, next, reset confirmation and API error modal', async ({ page }) => {
  const token = 'a'.repeat(64);
  let queues = [1, 2, 3].map(n => ({ id: `queue-${n}`, queue_number: `A00${n}`, service_group: 'A', queue_date: '2026-09-22', status: 'waiting', created_at: `2026-09-22T02:00:0${n}Z`, updated_at: `2026-09-22T02:00:0${n}Z` }));
  let resets = 0;
  let recalls = 0;
  let cancellations = 0;
  let loginUsername = '';
  let rejectLogin = true;
  let loggedIn = false;
  const callEvents = [];
  await page.route('https://queue-test.supabase.co/rest/v1/rpc/**', route => {
    const name = route.request().url().split('/').at(-1);
    if (name === 'queue_snapshot') return route.fulfill({ json: { queue_date: '2026-09-22', queues } });
    if (name === 'staff_session') return route.fulfill({ json: loggedIn ? { username: 'staff01', expires_at: new Date(Date.now() + 3600000).toISOString() } : null });
    if (name === 'staff_login') {
      loginUsername = route.request().postDataJSON().p_username;
      if (rejectLogin) return route.fulfill({ json: { error: 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง' } });
      loggedIn = true;
      return route.fulfill({ json: { token, username: loginUsername, expires_at: new Date(Date.now() + 3600000).toISOString() } });
    }
    if (name === 'staff_logout') { loggedIn = false; return route.fulfill({ json: null }); }
    if (name === 'call_next') {
      const next = queues.find(q => q.status === 'waiting');
      if (!next) return route.fulfill({ status: 400, json: { message: 'ทดสอบข้อผิดพลาดจาก API' } });
      queues.forEach(q => { if (q.status === 'calling') q.status = 'completed'; });
      Object.assign(next, { status: 'calling', counter_number: null, called_at: new Date().toISOString(), call_count: 1 });
      callEvents.push({ queue_id: next.id, queue_number: next.queue_number, queue_date: next.queue_date, event_kind: 'initial', called_at: next.called_at });
      return route.fulfill({ json: next });
    }
    if (name === 'recall_current') {
      recalls++;
      const q = queues.find(q => q.status === 'calling');
      q.called_at = new Date().toISOString(); q.call_count++;
      callEvents.push({ queue_id: q.id, queue_number: q.queue_number, queue_date: q.queue_date, event_kind: 'recall', called_at: q.called_at });
      return route.fulfill({ json: q });
    }
    if (name === 'cancel_waiting') {
      cancellations++;
      const q = queues.find(q => q.id === route.request().postDataJSON().p_queue_id);
      q.status = 'cancelled'; q.updated_at = new Date().toISOString();
      return route.fulfill({ json: q });
    }
    if (name === 'cancelled_queues_current') return route.fulfill({ json: queues.filter(q => q.status === 'cancelled') });
    if (name === 'restore_cancelled') {
      const q = queues.find(q => q.id === route.request().postDataJSON().p_queue_id);
      q.status = 'waiting'; q.created_at = new Date().toISOString();
      return route.fulfill({ json: q });
    }
    if (name === 'queue_report') return route.fulfill({ json: [
      { queue_date: '2026-09-22', queue_number: 'A003', service_group: 'A', event_kind: 'cancelled', event_at: '2026-09-22T02:00:03Z' },
    ] });
    if (name === 'queue_call_history') {
      const history = [...new Set(callEvents.map(e => e.queue_id))].map(id => {
        const events = callEvents.filter(e => e.queue_id === id);
        return { queue_id: id, queue_number: events[0].queue_number, queue_date: events[0].queue_date, call_count: events.length, events };
      });
      return route.fulfill({ json: history });
    }
    if (name === 'reset_today') { resets++; queues = []; }
    return route.fulfill({ json: null });
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'จัดการคิว', exact: true }).click();
  await page.getByLabel('ชื่อผู้ใช้', { exact: true }).fill('staff01');
  await expect(page.getByLabel('อีเมล', { exact: true })).toHaveCount(0);
  await page.getByLabel('รหัสผ่าน', { exact: true }).fill('test-password');
  await page.getByRole('button', { name: 'เข้าสู่ระบบ', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง');
  await expect(page.getByText('STAFF WORKSPACE')).toHaveCount(0);
  await page.getByRole('button', { name: 'รับทราบ', exact: true }).click();
  rejectLogin = false;
  await page.getByRole('button', { name: 'เข้าสู่ระบบ', exact: true }).click();
  expect(loginUsername).toBe('staff01');
  await expect(page.locator('.page-heading-account')).toContainText('STAFF WORKSPACE · staff01');
  await expect(page.getByRole('heading', { name: 'จัดการคิว อย่างเป็นระบบ' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'เรียกคิวถัดไป', exact: true })).toHaveCount(1);
  await expect(page.locator('.staff-current .staff-action-next')).toBeVisible();
  await expect(page.locator('.staff-current .staff-action-recall')).toBeVisible();
  await expect(page.getByRole('button', { name: 'เรียกคิวถัดไป (A/B)', exact: true })).toHaveCount(0);
  await page.reload();
  await page.getByRole('button', { name: 'จัดการคิว', exact: true }).click();
  await expect(page.locator('.page-heading-account')).toContainText('STAFF WORKSPACE · staff01');
  await page.getByRole('button', { name: 'เรียกคิวถัดไป', exact: true }).click();
  await expect(page.locator('.current-counter strong')).toHaveText('A001');
  await page.getByRole('button', { name: 'เรียกคิวถัดไป', exact: true }).click();
  await expect(page.locator('.current-counter strong')).toHaveText('A002');
  await page.getByRole('button', { name: 'เรียกซ้ำ', exact: true }).click();
  await expect(page.getByText('เรียกแล้ว 2 ครั้ง')).toBeVisible();
  expect(recalls).toBe(1);
  await page.getByRole('button', { name: 'ยกเลิกคิว', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('A003');
  await page.getByRole('button', { name: 'ยืนยันยกเลิก' }).click();
  await expect(page.getByText('ยกเลิกแล้ว')).toBeVisible();
  expect(cancellations).toBe(1);
  await page.getByRole('button', { name: 'ประวัติการเรียก', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('เรียก 2 ครั้ง');
  await page.getByRole('button', { name: 'ปิดหน้าต่าง' }).click();
  await page.screenshot({ path: 'test-results/staff-desktop.png', fullPage: true });
  for (const width of [320, 390, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await expect(page.getByRole('button', { name: 'เรียกคิวถัดไป', exact: true })).toBeVisible();
    if (width === 390) await page.screenshot({ path: 'test-results/staff-mobile.png', fullPage: true });
  }
  await expect(page.getByRole('button', { name: 'ข้ามคิว (Skip)' })).toHaveCount(0);
  await page.getByRole('button', { name: 'เรียกคิวถัดไป', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('ทดสอบข้อผิดพลาดจาก API');
  await page.getByRole('button', { name: 'รับทราบ', exact: true }).click();
  await page.getByRole('button', { name: 'ส่งออกรายงาน' }).click();
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'ข้อมูลรวมทุกกลุ่ม' }).click();
  const report = await downloadPromise;
  expect(report.suggestedFilename()).toMatch(/otepc-queue-report-all.*\.csv$/);
  expect(await readFile(await report.path(), 'utf8')).toContain('A003');
  await page.getByRole('button', { name: 'ปิดหน้าต่าง' }).click();
  await page.getByRole('button', { name: 'คืนคิวที่ยกเลิก' }).click();
  await expect(page.getByRole('dialog')).toContainText('A003');
  await page.getByRole('dialog').getByRole('button', { name: 'คืนคิว', exact: true }).click();
  await page.getByRole('button', { name: 'ยืนยันคืนคิว' }).click();
  await expect(page.getByText('รอเข้ารับเรียกคิว')).toBeVisible();
  await page.getByRole('button', { name: 'รีเซ็ตคิวของวันนี้', exact: true }).click();
  expect(resets).toBe(0);
  await page.getByRole('button', { name: 'กลับ', exact: true }).click();
  expect(resets).toBe(0);
  await page.getByRole('button', { name: 'รีเซ็ตคิวของวันนี้', exact: true }).click();
  await page.getByRole('button', { name: 'ยืนยันรีเซ็ต', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(resets).toBe(1);
  await page.getByRole('button', { name: 'ออกจากระบบ' }).click();
  await expect(page.getByRole('button', { name: 'เข้าสู่ระบบ', exact: true })).toBeVisible();
});
