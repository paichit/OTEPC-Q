import test from 'node:test';
import assert from 'node:assert/strict';
import { createRefreshQueue } from '../src/services/refreshQueue.js';

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

test('bursts use one active read and one trailing read without starving earlier callers', async () => {
  const first = deferred();
  const second = deferred();
  let calls = 0;
  const values = [];
  const queue = createRefreshQueue(() => (++calls === 1 ? first.promise : second.promise), value => values.push(value), assert.fail);
  const done = queue.request();
  for (let i = 0; i < 100; i++) assert.equal(queue.request(), done);
  await Promise.resolve();
  assert.equal(calls, 1);
  const trailing = queue.request();
  for (let i = 0; i < 100; i++) assert.equal(queue.request(), trailing);
  first.resolve('first');
  await done;
  // Initial readers finish even though the next network response has not arrived.
  assert.deepEqual(values, ['first']);
  await Promise.resolve();
  assert.equal(calls, 2);
  second.resolve('latest');
  await trailing;
  assert.deepEqual(values, ['first', 'latest']);
});

test('read failure is reported and a subsequent request can recover', async () => {
  let calls = 0;
  const errors = [];
  const values = [];
  const queue = createRefreshQueue(async () => {
    if (++calls === 1) throw new Error('offline');
    return 'online';
  }, value => values.push(value), error => errors.push(error.message));
  await queue.request();
  await queue.request();
  assert.deepEqual(errors, ['offline']);
  assert.deepEqual(values, ['online']);
});

test('disposing prevents late updates and queued reads after unmount', async () => {
  const work = deferred();
  let calls = 0;
  const queue = createRefreshQueue(() => { calls++; return work.promise; }, assert.fail, assert.fail);
  const done = queue.request();
  await Promise.resolve();
  const pending = queue.request();
  queue.dispose();
  await pending;
  work.resolve('ignored');
  await done;
  await queue.request();
  assert.equal(calls, 1);
});
