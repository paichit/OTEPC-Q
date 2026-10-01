import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';

test('each group calls independently and has its own current, waiting and display columns', async ({ page }) => {
  const queues = [
    { id: 'a1', service_group: 'A', queue_number: 'A001', status: 'calling', created_at: '2026-10-01T02:00:00Z', called_at: '2026-10-01T02:00:10Z', call_count: 1 },
    { id: 'b1', service_group: 'B', queue_number: 'B001', status: 'calling', created_at: '2026-10-01T02:00:01Z', called_at: '2026-10-01T02:00:11Z', call_count: 1 },
    { id: 'b2', service_group: 'B', queue_number: 'B002', status: 'waiting', created_at: '2026-10-01T02:00:02Z' },
    { id: 'a2', service_group: 'A', queue_number: 'A002', status: 'waiting', created_at: '2026-10-01T02:00:03Z' },
    { id: 'b3', service_group: 'B', queue_number: 'B003', status: 'waiting', created_at: '2026-10-01T02:00:04Z' },
    { id: 'a3', service_group: 'A', queue_number: 'A003', status: 'waiting', created_at: '2026-10-01T02:00:05Z' },
    ...[4, 5, 6].flatMap(n => ['A', 'B'].map(group => ({ id: `${group.toLowerCase()}${n}`, service_group: group, queue_number: `${group}00${n}`, status: 'waiting', created_at: `2026-10-01T02:01:0${n}Z` }))),
  ].map(q => ({ ...q, queue_date: '2026-10-01', updated_at: q.called_at || q.created_at }));
  await page.addInitScript(() => {
    sessionStorage.setItem('otepc-staff-token', 'a'.repeat(64));
    localStorage.setItem('otepc-settings', JSON.stringify({ sound: false }));
  });
  await page.route('https://queue-test.supabase.co/rest/v1/rpc/**', route => {
    const name = route.request().url().split('/').at(-1);
    const body = route.request().postDataJSON();
    if (name === 'queue_snapshot') return route.fulfill({ json: { queues, calling_mode: 'by_group' } });
    if (name === 'staff_session') return route.fulfill({ json: { username: 'staff01' } });
    if (name === 'call_next_in_group') {
      const current = queues.find(q => q.status === 'calling' && q.service_group === body.p_group);
      expect(body.p_expected).toBe(current.id);
      const next = queues.find(q => q.status === 'waiting' && q.service_group === body.p_group);
      current.status = 'completed';
      current.updated_at = new Date().toISOString();
      Object.assign(next, { status: 'calling', called_at: new Date().toISOString(), call_count: 1 });
      return route.fulfill({ json: next });
    }
    if (name === 'recall_current') {
      const q = queues.find(q => q.id === body.p_expected);
      q.call_count++;
      return route.fulfill({ json: q });
    }
    return route.fulfill({ json: null });
  });
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto('/');
  await page.getByRole('button', { name: 'จัดการคิว', exact: true }).click();
  const a = page.getByRole('region', { name: 'จัดการคิวกลุ่มทั่วไป', exact: true });
  const b = page.getByRole('region', { name: 'จัดการคิวกลุ่มประสบการณ์', exact: true });
  await expect(a.locator('.staff-current-number')).toHaveText('กลุ่มทั่วไป001');
  await expect(b.locator('.staff-current-number')).toHaveText('กลุ่มประสบการณ์001');
  await expect(a.locator('.queue-row strong')).toHaveText([2, 3, 4, 5, 6].map(n => `กลุ่มทั่วไป00${n}`));
  await expect(b.locator('.queue-row strong')).toHaveText([2, 3, 4, 5, 6].map(n => `กลุ่มประสบการณ์00${n}`));
  const aCard = await a.locator('.staff-current').boundingBox();
  const aWaiting = await a.locator('.staff-group-waiting').boundingBox();
  const bCard = await b.locator('.staff-current').boundingBox();
  expect(aWaiting.y).toBeGreaterThan(aCard.y + aCard.height);
  expect(bCard.x).toBeGreaterThan(aCard.x + aCard.width);
  await b.getByRole('button', { name: 'เรียกคิวถัดไป', exact: true }).click();
  await expect(b.locator('.staff-current-number')).toHaveText('กลุ่มประสบการณ์002');
  await expect(a.locator('.staff-current-number')).toHaveText('กลุ่มทั่วไป001');
  await a.getByRole('button', { name: 'เรียกซ้ำ', exact: true }).click();
  await expect(a.getByText('เรียกแล้ว 2 ครั้ง', { exact: false })).toBeVisible();
  await expect(b.getByText('เรียกแล้ว 1 ครั้ง', { exact: false })).toBeVisible();
  await page.screenshot({ path: 'test-results/staff-group-desktop.png', fullPage: true });
  await page.getByRole('button', { name: 'จอแสดงคิว', exact: true }).click();
  await page.getByRole('button', { name: 'ดูจอแบบไม่เปิดเสียง' }).click();
  const displayA = page.getByRole('region', { name: 'จอแสดงคิวกลุ่มทั่วไป', exact: true });
  const displayB = page.getByRole('region', { name: 'จอแสดงคิวกลุ่มประสบการณ์', exact: true });
  await expect(displayA.locator('.prototype-current-number')).toHaveText('กลุ่มทั่วไป001');
  await expect(displayB.locator('.prototype-current-number')).toHaveText('กลุ่มประสบการณ์002');
  await expect(displayA.locator('.prototype-waiting-total strong')).toHaveText('5');
  await expect(displayB.locator('.prototype-waiting-total strong')).toHaveText('4');
  await expect(displayA.locator('.prototype-next-row strong')).toHaveText([2, 3, 4, 5, 6].map(n => `กลุ่มทั่วไป00${n}`));
  await expect(displayB.locator('.prototype-next-row strong')).toHaveText([3, 4, 5, 6].map(n => `กลุ่มประสบการณ์00${n}`));
  const boxA = await displayA.boundingBox();
  const boxB = await displayB.boundingBox();
  expect(Math.abs(boxA.width - boxB.width)).toBeLessThan(2);
  expect(boxB.x).toBeGreaterThan(boxA.x);
  await page.setViewportSize({ width: 1920, height: 900 });
  expect(await displayA.locator('.prototype-next').evaluate(node => node.scrollHeight <= node.clientHeight + 1)).toBe(true);
  await page.screenshot({ path: 'test-results/display-group-tv.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 900 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth && document.documentElement.scrollHeight <= innerHeight + 1)).toBe(true);
  await page.screenshot({ path: 'test-results/display-group-mobile.png', fullPage: true });
});

test('unmigrated database shows split layout but prevents group calls', async ({ page }) => {
  await page.addInitScript(() => sessionStorage.setItem('otepc-staff-token', 'a'.repeat(64)));
  await page.route('https://queue-test.supabase.co/rest/v1/rpc/**', route => route.fulfill({ json:
    route.request().url().endsWith('/staff_session') ? { username: 'staff01' } : { queues: [] } }));
  await page.goto('/');
  await page.getByRole('button', { name: 'จัดการคิว', exact: true }).click();
  await expect(page.getByText('ยังไม่เปิดใช้งานการเรียกคิวแยกกลุ่ม', { exact: false })).toBeVisible();
  for (const button of await page.getByRole('button', { name: 'เรียกคิวถัดไป', exact: true }).all()) await expect(button).toBeDisabled();
});

test('shared group names and typed HEX propagate to tickets display history and reports', async ({ page }) => {
  let names = { A: 'กลุ่มทั่วไป', B: 'กลุ่มประสบการณ์' };
  let saves = 0;
  const queues = [{ id: 'q1', service_group: 'A', queue_number: 'กลุ่มทั่วไป001', status: 'calling', queue_date: '2026-09-30', called_at: '2026-09-30T02:00:00Z', created_at: '2026-09-30T02:00:00Z' }];
  await page.addInitScript(() => {
    sessionStorage.setItem('otepc-staff-token', 'a'.repeat(64));
    localStorage.setItem('otepc-settings', JSON.stringify({ sound: false }));
  });
  await page.route('https://queue-test.supabase.co/rest/v1/rpc/**', route => {
    const name = route.request().url().split('/').at(-1);
    if (name === 'queue_snapshot') return route.fulfill({ json: { queues, group_names: names, calling_mode: 'by_group' } });
    if (name === 'set_queue_group_names') {
      saves++;
      const body = route.request().postDataJSON();
      names = { A: body.p_name_a, B: body.p_name_b };
      return route.fulfill({ json: names });
    }
    if (name === 'issue_queue') return route.fulfill({ json: { service_group: 'B', queue_number: 'กลุ่มประสบการณ์002', queue_date: '2026-09-30', created_at: '2026-09-30T02:00:00Z' } });
    if (name === 'staff_session') return route.fulfill({ json: { username: 'staff01' } });
    if (name === 'queue_call_history') return route.fulfill({ json: [{ queue_id: 'q1', queue_number: 'กลุ่มทั่วไป001', queue_date: '2026-09-30', call_count: 1, events: [] }] });
    if (name === 'queue_report') return route.fulfill({ json: [{ service_group: 'A', queue_number: 'กลุ่มทั่วไป001', queue_date: '2026-09-30', event_kind: 'initial' }] });
    return route.fulfill({ json: null });
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'ตั้งค่าระบบ', exact: true }).click();
  await page.getByLabel('ชื่อกลุ่มที่ 1', { exact: true }).fill('ผู้สมัครทั่วไป');
  await page.getByLabel('ชื่อกลุ่มที่ 2', { exact: true }).fill('ผู้สมัครประสบการณ์');
  await page.getByLabel('รหัส HEX สีผู้สมัครทั่วไป', { exact: true }).fill('BAD');
  await page.getByRole('button', { name: 'บันทึกการตั้งค่า' }).click();
  expect(saves).toBe(0);
  await page.getByLabel('รหัส HEX สีผู้สมัครทั่วไป', { exact: true }).fill('ABCDEF');
  await page.getByRole('button', { name: 'บันทึกการตั้งค่า' }).click();
  await expect(page.getByText('บันทึกการตั้งค่าแล้ว')).toBeVisible();
  expect(saves).toBe(1);
  await page.getByRole('button', { name: 'รับบัตรคิว', exact: true }).click();
  await expect(page.getByRole('button', { name: 'รับคิวผู้สมัครทั่วไป' })).toHaveCSS('background-color', 'rgb(171, 205, 239)');
  await page.getByRole('button', { name: 'รับคิวผู้สมัครประสบการณ์' }).click();
  await expect(page.getByRole('dialog')).toContainText('ผู้สมัครประสบการณ์002');
  await page.getByRole('button', { name: 'ปิดหน้าต่าง' }).click();
  await page.getByRole('button', { name: 'จอแสดงคิว', exact: true }).click();
  await page.getByRole('button', { name: 'ดูจอแบบไม่เปิดเสียง' }).click();
  await expect(page.locator('.prototype-display-group[data-group="A"] .prototype-current-number')).toHaveText('ผู้สมัครทั่วไป001');
  await page.getByRole('button', { name: 'จัดการคิว', exact: true }).click();
  await page.getByRole('button', { name: 'ประวัติการเรียก', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('ผู้สมัครทั่วไป001');
  await page.getByRole('button', { name: 'ปิดหน้าต่าง' }).click();
  await page.getByRole('button', { name: 'ส่งออกรายงาน' }).click();
  await page.getByLabel('รูปแบบไฟล์').selectOption('csv');
  const downloading = page.waitForEvent('download');
  await page.getByRole('button', { name: 'เฉพาะผู้สมัครทั่วไป' }).click();
  const report = await downloading;
  expect(await readFile(await report.path(), 'utf8')).toContain('ผู้สมัครทั่วไป001');
  await page.reload();
  await expect(page.getByRole('button', { name: 'รับคิวผู้สมัครประสบการณ์' })).toBeVisible();
});
test('starting the queue display requests and plays spoken confirmation', async ({ page }) => {
  await page.addInitScript(() => {
    window.startupPlayCount = 0;
    window.Audio = class {
      play() { window.startupPlayCount++; return Promise.resolve(); }
      pause() {}
    };
  });
  await page.route('https://queue-test.supabase.co/functions/v1/queue-tts', async route => {
    expect(route.request().postDataJSON()).toEqual({ action: 'startup' });
    await route.fulfill({ status: 200, contentType: 'audio/mpeg', body: 'mock-audio' });
  });
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
    if (name === 'queue_snapshot') return route.fulfill({ json: { queue_date: '2026-09-22', queues, calling_mode: 'by_group' } });
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
  await expect(a).toHaveCSS('background-color', 'rgb(177, 248, 242)');
  await expect(a).toHaveCSS('color', 'rgb(0, 0, 0)');
  await expect(page.getByRole('button', { name: 'รับคิวกลุ่มประสบการณ์' })).toHaveCSS('background-color', 'rgb(170, 246, 131)');
  await a.click();
  await expect(a).toBeDisabled();
  await expect(page.getByRole('dialog')).toBeVisible();
  expect(issued).toBe(1);
  await expect(page.getByRole('dialog').getByText('กลุ่มทั่วไป001')).toBeVisible();
  await expect(page.getByRole('button', { name: 'พิมพ์บัตรคิว' })).toHaveCount(0);
  await page.getByRole('button', { name: 'ปิดหน้าต่าง' }).click();
  await page.getByRole('button', { name: 'ตั้งค่าระบบ', exact: true }).click();
  await expect(page.getByText('Google Cloud — ไทยผู้หญิง Standard-A')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'ปรับแต่งการจัดการคิว' })).toBeVisible();
  await expect(page.getByLabel('รูปแบบเสียงประกาศ')).toHaveValue('ขอเชิญบัตรคิว {q} ที่ห้องประชุมค่ะ');
  expect(await page.locator('.settings-heading-copy').evaluate(element => {
    const heading = element.querySelector('h1').getBoundingClientRect();
    const description = element.querySelector('p').getBoundingClientRect();
    return description.top < heading.bottom;
  })).toBe(true);
  await page.screenshot({ path: 'test-results/settings-desktop.png', fullPage: true });
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
  await page.getByRole('button', { name: 'ดูจอแบบไม่เปิดเสียง' }).click();
  await expect(page.getByText('กรุณารอเรียกคิวค่ะ')).toBeVisible();
  await expect(page.getByRole('button', { name: 'เปิดเต็มจอ' })).toBeVisible();
  await expect(page.getByText('คิวถัดไป / Next')).toHaveCount(2);
  await page.screenshot({ path: 'test-results/display-desktop.png', fullPage: true });
  for (const width of [320, 390, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    for (const label of ['รับบัตรคิว', 'จัดการคิว', 'จอแสดงคิว', 'ตั้งค่าระบบ']) {
      await page.getByRole('button', { name: label, exact: true }).click();
      if (label === 'จอแสดงคิว') await page.getByRole('button', { name: 'ดูจอแบบไม่เปิดเสียง' }).click();
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
  await page.getByRole('button', { name: 'ดูจอแบบไม่เปิดเสียง' }).click();
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
    if (name === 'queue_snapshot') return route.fulfill({ json: { queue_date: '2026-09-22', queues, calling_mode: 'by_group' } });
    if (name === 'staff_session') return route.fulfill({ json: loggedIn ? { username: 'staff01', expires_at: new Date(Date.now() + 3600000).toISOString() } : null });
    if (name === 'staff_login') {
      loginUsername = route.request().postDataJSON().p_username;
      if (rejectLogin) return route.fulfill({ json: { error: 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง' } });
      loggedIn = true;
      return route.fulfill({ json: { token, username: loginUsername, expires_at: new Date(Date.now() + 3600000).toISOString() } });
    }
    if (name === 'staff_logout') { loggedIn = false; return route.fulfill({ json: null }); }
    if (name === 'call_next_in_group') {
      const group = route.request().postDataJSON().p_group;
      const next = queues.find(q => q.status === 'waiting' && q.service_group === group);
      if (!next) return route.fulfill({ status: 400, json: { message: 'ทดสอบข้อผิดพลาดจาก API' } });
      queues.forEach(q => { if (q.status === 'calling' && q.service_group === group) q.status = 'completed'; });
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
  await expect(page.getByRole('button', { name: 'เรียกคิวถัดไป', exact: true })).toHaveCount(2);
  await expect(page.locator('.staff-group-column[data-group="A"] .staff-action-next')).toBeVisible();
  await expect(page.locator('.staff-group-column[data-group="A"] .staff-action-recall')).toBeVisible();
  await expect(page.getByRole('button', { name: 'เรียกคิวถัดไป (A/B)', exact: true })).toHaveCount(0);
  await page.reload();
  await page.getByRole('button', { name: 'จัดการคิว', exact: true }).click();
  await expect(page.locator('.page-heading-account')).toContainText('STAFF WORKSPACE · staff01');
  await page.locator('.staff-group-column[data-group="A"]').getByRole('button', { name: 'เรียกคิวถัดไป', exact: true }).click();
  await expect(page.locator('.staff-group-column[data-group="A"] .staff-current-number')).toHaveText('กลุ่มทั่วไป001');
  await page.locator('.staff-group-column[data-group="A"]').getByRole('button', { name: 'เรียกคิวถัดไป', exact: true }).click();
  await expect(page.locator('.staff-group-column[data-group="A"] .staff-current-number')).toHaveText('กลุ่มทั่วไป002');
  await page.locator('.staff-group-column[data-group="A"]').getByRole('button', { name: 'เรียกซ้ำ', exact: true }).click();
  await expect(page.getByText('เรียกแล้ว 2 ครั้ง')).toBeVisible();
  expect(recalls).toBe(1);
  await page.getByRole('button', { name: 'ยกเลิกคิว', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('กลุ่มทั่วไป003');
  await page.getByRole('button', { name: 'ยืนยันยกเลิก' }).click();
  await expect(page.getByText('ยกเลิกแล้ว')).toBeVisible();
  await expect(page.locator('.queue-row-a').first()).toHaveCSS('background-color', 'rgb(177, 248, 242)');
  await expect(page.locator('.queue-row-a').first()).toHaveCSS('color', 'rgb(0, 0, 0)');
  expect(cancellations).toBe(1);
  await page.getByRole('button', { name: 'ประวัติการเรียก', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('เรียก 2 ครั้ง');
  await page.getByRole('button', { name: 'ปิดหน้าต่าง' }).click();
  await page.screenshot({ path: 'test-results/staff-desktop.png', fullPage: true });
  for (const width of [320, 390, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await expect(page.locator('.staff-group-column[data-group="A"]').getByRole('button', { name: 'เรียกคิวถัดไป', exact: true })).toBeVisible();
    if (width === 390) await page.screenshot({ path: 'test-results/staff-mobile.png', fullPage: true });
  }
  await expect(page.getByRole('button', { name: 'ข้ามคิว (Skip)' })).toHaveCount(0);
  await page.locator('.staff-group-column[data-group="A"]').getByRole('button', { name: 'เรียกคิวถัดไป', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('ทดสอบข้อผิดพลาดจาก API');
  await page.getByRole('button', { name: 'รับทราบ', exact: true }).click();
  await page.getByRole('button', { name: 'ส่งออกรายงาน' }).click();
  await expect(page.getByLabel('รูปแบบไฟล์')).toHaveValue('xlsx');
  await expect(page.getByLabel('รูปแบบไฟล์').locator('option')).toHaveText(['Excel (.xlsx)', 'CSV', 'PDF']);
  await page.getByLabel('รูปแบบไฟล์').selectOption('csv');
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'ข้อมูลรวมทุกกลุ่ม' }).click();
  const report = await downloadPromise;
  expect(report.suggestedFilename()).toMatch(/otepc-queue-report-all.*\.csv$/);
  expect(await readFile(await report.path(), 'utf8')).toContain('กลุ่มทั่วไป003');
  await page.getByLabel('รูปแบบไฟล์').selectOption('xlsx');
  const excelDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: 'เฉพาะกลุ่มทั่วไป' }).click();
  const excelReport = await excelDownload;
  expect(excelReport.suggestedFilename()).toMatch(/-A-.*\.xlsx$/);
  expect((await readFile(await excelReport.path())).subarray(0, 2).toString()).toBe('PK');
  await page.getByLabel('รูปแบบไฟล์').selectOption('pdf');
  const pdfDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: 'ข้อมูลรวมทุกกลุ่ม' }).click();
  const pdfReport = await pdfDownload;
  expect(pdfReport.suggestedFilename()).toMatch(/-all-.*\.pdf$/);
  expect((await readFile(await pdfReport.path())).subarray(0, 4).toString()).toBe('%PDF');
  await page.getByRole('button', { name: 'ปิดหน้าต่าง' }).click();
  await page.getByRole('button', { name: 'คืนคิวที่ยกเลิก' }).click();
  await expect(page.getByRole('dialog')).toContainText('กลุ่มทั่วไป003');
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
