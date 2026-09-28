import test from 'node:test';
import assert from 'node:assert/strict';
import { batchReview } from './batchReview.js';
const templates = [
  { id: 'a', title: 'A', fields: [{ tag: 'a' }] },
  { id: 'b', title: 'B', fields: [{ tag: 'b' }] },
  { id: 'c', title: 'C', reviewed: true, fields: [] },
];
test('save current template first, skip reviewed, preserve mapping snapshot', async () => {
  const seen = [], mappings = { a: 'key-a', b: 'key-b' };
  const count = await batchReview({ templates, currentId: 'b', mappings,
    openAndSave: async t => { seen.push(t.id); return `version-${t.id}`; },
    confirm: async (t, body) => {
      assert.equal(body.version_id, `version-${t.id}`);
      assert.equal(body.mappings[t.id], `key-${t.id}`);
      return {};
    },
    onProgress: () => {}, onConfirmed: () => { mappings.a = ''; },
  });
  assert.deepEqual(seen, ['b', 'a']);
  assert.equal(count, 2);
});
test('stop after save failure and retain completed confirmations', async () => {
  const confirmed = [];
  await assert.rejects(batchReview({ templates, currentId: 'a', mappings: {},
    openAndSave: async t => { if (t.id === 'b') throw new Error('保存失败'); return 'v'; },
    confirm: async t => { confirmed.push(t.id); return {}; },
    onProgress: () => {}, onConfirmed: () => {},
  }), /已确认 1\/2 份.*B.*保存失败/);
  assert.deepEqual(confirmed, ['a']);
});
test('stop after backend review rejection without confirming later templates', async () => {
  const opened = [];
  await assert.rejects(batchReview({ templates, currentId: 'a', mappings: {},
    openAndSave: async t => { opened.push(t.id); return 'v'; },
    confirm: async () => { throw new Error('控件缺失'); },
    onProgress: () => {}, onConfirmed: () => {},
  }), /已确认 0\/2 份.*控件缺失/);
  assert.deepEqual(opened, ['a']);
});
