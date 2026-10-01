import { test, expect } from '@playwright/test';

// Separate contexts represent computers; additional pages represent tabs on one computer.
async function displays(browser) {
  const state = { queues: [], requests: [], tts: [], sockets: [] };
  const contexts = [];
  async function computer() {
    const context = await browser.newContext();
    contexts.push(context);
    await context.addInitScript(() => {
      window.audioPlays = 0;
      window.audioPauses = 0;
      window.playingCount = 0;
      window.maxPlayingCount = 0;
      window.Audio = class {
        play() {
          window.audioPlays++;
          window.playingAudio = this;
          this.isPlaying = true;
          window.playingCount++;
          window.maxPlayingCount = Math.max(window.maxPlayingCount, window.playingCount);
          return Promise.resolve();
        }
        pause() {
          window.audioPauses++;
          if (this.isPlaying) window.playingCount--;
          this.isPlaying = false;
        }
        dispatchEvent(event) {
          if (this.isPlaying) window.playingCount--;
          this.isPlaying = false;
          this[`on${event.type}`]?.(event);
        }
      };
    });
    await context.route('https://queue-test.supabase.co/rest/v1/rpc/**', route => route.fulfill({
      json: { queues: state.queues, calling_mode: 'by_group' },
    }));
    await context.route('https://queue-test.supabase.co/functions/v1/queue-audio-lock', async route => {
      const body = route.request().postDataJSON();
      state.requests.push(body);
      // Even an unavailable legacy lock must not restrict independent displays.
      await route.fulfill({ status: 503, json: { error: 'Legacy audio lock unavailable' } });
    });
    await context.route('https://queue-test.supabase.co/functions/v1/queue-tts', async route => {
      state.tts.push(route.request().postDataJSON());
      if (state.beforeTts) await state.beforeTts(state.tts.length);
      return route.fulfill({ contentType: 'audio/mpeg', body: 'mock-audio' });
    });
    await context.routeWebSocket('wss://queue-test.supabase.co/realtime/v1/**', socket => {
      socket.onMessage(message => {
        const [joinRef, ref, topic, event, payload] = JSON.parse(message);
        if (event === 'phx_join') {
          state.sockets.push({ socket, topic, joinRef });
          socket.send(JSON.stringify([joinRef, ref, topic, 'phx_reply', { status: 'ok', response: {
            postgres_changes: payload.config.postgres_changes.map((filter, i) => ({ ...filter, id: i + 1 })),
          } }]));
        } else if (event === 'heartbeat' || event === 'phx_leave') {
          socket.send(JSON.stringify([joinRef, ref, topic, 'phx_reply', { status: 'ok', response: {} }]));
        }
      });
    });
    return context;
  }
  async function open(context) {
    const page = await context.newPage();
    await page.goto('/');
    await page.getByRole('button', { name: 'จอแสดงคิว', exact: true }).click();
    await expect(page.getByRole('button', { name: 'ดูจอแบบไม่เปิดเสียง' })).toBeVisible();
    return page;
  }
  function call(group, n) {
    const now = new Date();
    const record = { id: `${group}-${n}`, queue_number: `${group}${String(n).padStart(3, '0')}`,
      service_group: group, status: 'calling', called_at: now.toISOString(), created_at: now.toISOString(),
      queue_date: new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok' }).format(now) };
    state.queues = state.queues.filter(q => q.service_group !== group).concat(record);
    for (const { socket, topic, joinRef } of state.sockets) socket.send(JSON.stringify([
      joinRef, null, topic, 'postgres_changes', { ids: [1], data: { schema: 'public', table: 'queues',
        type: 'INSERT', commit_timestamp: record.called_at, record, old_record: {}, columns: [], errors: null } },
    ]));
  }
  return { state, computer, open, call, close: () => Promise.all(contexts.map(context => context.close())) };
}

test('TV, projector and another tab announce independently while a silent display keeps updating', async ({ browser }) => {
  test.setTimeout(60000); // Four pages share CPU with the layout and app suites on Windows.
  const setup = await displays(browser);
  try {
    const tvComputer = await setup.computer();
    const projectorComputer = await setup.computer();
    const tv = await setup.open(tvComputer);
    const projector = await setup.open(projectorComputer);
    const extra = await setup.open(tvComputer);
    const silent = await setup.open(projectorComputer);
    await tv.screenshot({ path: 'test-results/display-sound-choice.png' });
    await tv.getByRole('button', { name: 'เริ่มระบบและเปิดเสียง' }).click();
    await expect(tv.getByText('เสียงประกาศ: เปิด', { exact: true })).toBeVisible();
    for (const page of [projector, extra, silent]) {
      await page.getByRole('button', { name: 'ดูจอแบบไม่เปิดเสียง' }).click();
      await expect(page.locator('.start-overlay')).toHaveCount(0);
      expect(await page.evaluate(() => window.audioPlays)).toBe(0);
    }
    expect(setup.state.tts).toHaveLength(1);
    for (const page of [projector, extra]) {
      await page.getByRole('button', { name: 'เปิดเสียงบนจอนี้', exact: true }).click();
      await expect(page.getByText('เสียงประกาศ: เปิด', { exact: true })).toBeVisible();
    }
    const audible = [tv, projector, extra];
    for (const page of audible) await page.evaluate(() => window.playingAudio.dispatchEvent(new Event('ended')));
    setup.call('A', 1);
    for (const page of [...audible, silent]) await expect(page.locator('[data-group="A"] .prototype-current-number')).toHaveText('กลุ่มทั่วไป001');
    await expect.poll(() => setup.state.tts.filter(r => r.queue_id === 'A-1').length).toBe(3);
    for (const page of audible) await expect.poll(() => page.evaluate(() => window.audioPlays)).toBe(2);
    // Calls from the two groups must still play sequentially on each individual tab.
    setup.call('B', 1);
    for (const page of [...audible, silent]) await expect(page.locator('[data-group="B"] .prototype-current-number')).toHaveText('กลุ่มประสบการณ์001');
    expect(setup.state.tts.filter(r => r.queue_id === 'B-1')).toHaveLength(0);
    for (const page of audible) await page.evaluate(() => window.playingAudio.dispatchEvent(new Event('ended')));
    await expect.poll(() => setup.state.tts.filter(r => r.queue_id === 'B-1').length).toBe(3);
    for (const page of audible) await expect.poll(() => page.evaluate(() => window.audioPlays)).toBe(3);

    await tv.getByRole('button', { name: 'ปิดเสียงบนจอนี้', exact: true }).click();
    await expect(tv.getByText('เสียงประกาศ: ปิด', { exact: true })).toBeVisible();
    expect(await tv.evaluate(() => window.playingCount)).toBe(0);
    for (const page of [projector, extra]) {
      await expect(page.getByText('เสียงประกาศ: เปิด', { exact: true })).toBeVisible();
      await page.evaluate(() => window.playingAudio.dispatchEvent(new Event('ended')));
    }
    setup.call('A', 2);
    for (const page of [...audible, silent]) await expect(page.locator('[data-group="A"] .prototype-current-number')).toHaveText('กลุ่มทั่วไป002');
    await expect.poll(() => setup.state.tts.filter(r => r.queue_id === 'A-2').length).toBe(2);
    expect(await tv.evaluate(() => window.audioPlays)).toBe(3);
    expect(await silent.evaluate(() => window.audioPlays)).toBe(0);
    for (const page of audible) expect(await page.evaluate(() => window.maxPlayingCount)).toBe(1);

    await tv.getByRole('button', { name: 'เปิดเสียงบนจอนี้', exact: true }).click();
    await expect(tv.getByText('เสียงประกาศ: เปิด', { exact: true })).toBeVisible();
    expect(await tv.evaluate(() => window.audioPlays)).toBe(4); // Only startup, no muted calls replayed.
    expect(setup.state.tts.filter(r => r.queue_id === 'A-2')).toHaveLength(2);
    await extra.getByRole('button', { name: 'รับบัตรคิว', exact: true }).click();
    expect(await extra.evaluate(() => window.playingCount)).toBe(0);
    await expect(projector.getByText('เสียงประกาศ: เปิด', { exact: true })).toBeVisible();
    await expect(tv.getByText('เสียงประกาศ: เปิด', { exact: true })).toBeVisible();
    expect(setup.state.requests).toEqual([]);
  } finally { await setup.close(); }
});

test('cancelling a pending sound request cannot interrupt a newer attempt or start unwanted audio', async ({ browser }) => {
  const setup = await displays(browser);
  try {
    const page = await setup.open(await setup.computer());
    let resume;
    let completed = false;
    setup.state.beforeTts = async n => {
      if (n !== 1) return;
      await new Promise(resolve => { resume = resolve; });
      completed = true;
    };
    await page.getByRole('button', { name: 'เริ่มระบบและเปิดเสียง' }).click();
    await expect.poll(() => setup.state.tts.length).toBe(1);
    await page.getByRole('button', { name: 'ยกเลิกการเปิดเสียง', exact: true }).click();
    await expect(page.getByText('เสียงประกาศ: ปิด', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'เปิดเสียงบนจอนี้', exact: true }).click();
    await expect(page.getByText('เสียงประกาศ: เปิด', { exact: true })).toBeVisible();
    resume();
    await expect.poll(() => completed).toBe(true);
    await page.getByRole('button', { name: 'ปิดเสียงบนจอนี้', exact: true }).click();
    await expect(page.getByText('เสียงประกาศ: ปิด', { exact: true })).toBeVisible();
    expect(await page.evaluate(() => window.audioPlays)).toBe(1);
    expect(await page.evaluate(() => window.playingCount)).toBe(0);
    expect(setup.state.requests).toEqual([]);
  } finally { await setup.close(); }
});

test('a failed audio device leaves only that display silent and allows retry', async ({ browser }) => {
  const setup = await displays(browser);
  try {
    const tv = await setup.open(await setup.computer());
    const projector = await setup.open(await setup.computer());
    for (const page of [tv, projector]) {
      await page.getByRole('button', { name: 'เริ่มระบบและเปิดเสียง' }).click();
      await expect(page.getByText('เสียงประกาศ: เปิด', { exact: true })).toBeVisible();
    }
    await tv.evaluate(() => window.playingAudio.dispatchEvent(new Event('error')));
    await expect(tv.getByText('เสียงประกาศ: ปิด', { exact: true })).toBeVisible();
    await expect(tv.getByText('เล่นเสียงยืนยันไม่สำเร็จ', { exact: false })).toBeVisible();
    await expect(tv.locator('.start-overlay')).toHaveCount(0);
    await expect(projector.getByText('เสียงประกาศ: เปิด', { exact: true })).toBeVisible();
    await tv.getByRole('button', { name: 'เปิดเสียงบนจอนี้', exact: true }).click();
    await expect(tv.getByText('เสียงประกาศ: เปิด', { exact: true })).toBeVisible();
    await expect(tv.getByText('เล่นเสียงยืนยันไม่สำเร็จ', { exact: false })).toHaveCount(0);
    expect(setup.state.requests).toEqual([]);
  } finally { await setup.close(); }
});
