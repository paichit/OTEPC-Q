import { test, expect } from '@playwright/test';

test('TV display keeps current headings inside their panels at scaled screen sizes', async ({ page }) => {
  let queues = [];
  await page.addInitScript(() => localStorage.setItem('otepc-settings', JSON.stringify({ sound: false })));
  await page.route('https://queue-test.supabase.co/rest/v1/rpc/**', route => route.fulfill({
    json: { calling_mode: 'by_group', queues },
  }));
  for (const populated of [false, true]) {
    queues = populated ? ['A', 'B'].flatMap(group => [1, 2, 3, 4, 5, 6].map(n => ({
      id: `${group}-${n}`, service_group: group, queue_number: `${group}${String(n).padStart(3, '0')}`,
      status: n === 1 ? 'calling' : 'waiting', created_at: `2026-10-01T02:00:0${n}Z`,
      called_at: n === 1 ? '2026-10-01T02:01:00Z' : null,
    }))) : [];
    // A 1920px television at 150% scaling has about 1280 CSS pixels available.
    for (const [width, height] of [[1266, 548], [1920, 1080], [1280, 720], [960, 540], [390, 844]]) {
      await page.setViewportSize({ width, height });
      await page.goto('/');
      await page.getByRole('button', { name: 'จอแสดงคิว', exact: true }).click();
      await page.getByRole('button', { name: 'ดูจอแบบไม่เปิดเสียง' }).click();
      await expect(page.locator('.prototype-display-group')).toHaveCount(2);
      if (width === 1266) await page.screenshot({ path: `test-results/display-scaled-${populated ? 'queues' : 'empty'}.png` });
      for (const group of ['A', 'B']) {
        const geometry = await page.locator(`.prototype-display-group[data-group="${group}"]`).evaluate(element => {
          const current = element.querySelector('.prototype-display-current').getBoundingClientRect();
          const label = element.querySelector('.prototype-display-current h2').getBoundingClientRect();
          const number = element.querySelector('.prototype-current-number').getBoundingClientRect();
          const heading = element.querySelector('.prototype-group-heading').getBoundingClientRect();
          const next = element.querySelector('.prototype-next');
          return {
            labelInside: label.top >= current.top && label.top >= heading.bottom && label.bottom <= current.bottom,
            numberInside: number.top >= label.bottom && number.bottom <= current.bottom,
            emptyScroll: next.scrollHeight - next.clientHeight,
          };
        });
        expect(geometry.labelInside, `${width}x${height}, group ${group}: heading overlaps`).toBe(true);
        expect(geometry.numberInside, `${width}x${height}, group ${group}: number is clipped`).toBe(true);
        if (!populated) expect(geometry.emptyScroll, `${width}x${height}: empty list scrolls`).toBeLessThanOrEqual(1);
      }
      expect(await page.evaluate(() => document.documentElement.scrollHeight <= innerHeight + 1
        && document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    }
  }
});
