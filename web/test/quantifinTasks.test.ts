import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { buildQuantifinTasks } from '../src/lib/quantifinTasks.js';

test('task board checks every PDF page and never treats an unmeasured page as complete', () => {
  const tasks = buildQuantifinTasks({
    files: [{ name: 'plan.pdf' }], pages: ['plan.pdf', 'plan.pdf#2'],
    annotations: { sheets: [{ sheet_id: 'plan.pdf', units_per_px: 0.1, scale_confirmed: true }], shapes: [{ id: 's1', sheet_id: 'plan.pdf', condition_id: 'c1' }], conditions: [{ id: 'c1', finish_tag: 'F1', materials: [] }] },
  });
  assert.equal(tasks.filter(t => t.type === 'scale').length, 1);
  assert.equal(tasks.find(t => t.type === 'scale')?.href, '/scale-review?sheet=plan.pdf%232');
  assert.equal(tasks.filter(t => t.type === 'scope').length, 1);
  assert.ok(tasks.some(t => t.type === 'materials'));
  assert.ok(tasks.some(t => t.type === 'final'));
});

test('task board names unassigned shapes, pending proposals and invalid coverage', () => {
  const tasks = buildQuantifinTasks({
    files: [{ name: 'a.pdf' }], pages: ['a.pdf'],
    annotations: { sheets: [{ sheet_id: 'a.pdf', units_per_px: 0.1 }], shapes: [
      { id: 's1', sheet_id: 'a.pdf', condition_id: 'missing', origin: { reviewed: false } },
      { id: 's2', sheet_id: 'a.pdf', condition_id: 'c1' },
    ], conditions: [{ id: 'c1', finish_tag: 'F1', materials: [{ name: '胶', per: 0 }] }] },
  });
  for (const type of ['unassigned', 'review', 'coverage']) assert.ok(tasks.some(t => t.type === type));
  assert.ok(!tasks.some(t => t.type === 'scale' || t.type === 'scope'));
});

test('no drawings yields a single import task', () => {
  const tasks = buildQuantifinTasks({});
  assert.deepEqual(tasks.map(t => t.type), ['import']);
});

test('multiple problems on one sheet retain distinct task identities', () => {
  const tasks = buildQuantifinTasks({ files: [{ name: 'a.pdf' }], pages: ['a.pdf'], annotations: {
    shapes: [{ id: 's1', sheet_id: 'a.pdf', condition_id: 'missing' }, { id: 's2', sheet_id: 'a.pdf', condition_id: 'missing' }],
  } });
  assert.equal(new Set(tasks.map(t => t.id)).size, tasks.length);
});
