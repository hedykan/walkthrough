import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';
import { flatten, findingsForItem, loadWalkthrough, parseLinkTarget } from '../src/model';

const SAMPLE = path.join(os.homedir(), 'Develope/loloyal/loloyal-myself/walkthrough/loloyal-services-be/code/72872858..b442c435.json');

test('真实走读 JSON：5 项、32 步，摊平后跨项连续', () => {
  const w = loadWalkthrough(SAMPLE);
  const refs = flatten(w);
  assert.equal(w.items.length, 5);
  assert.equal(refs.length, 32);
  assert.deepEqual(refs.slice(6, 9).map(r => [r.itemIndex, r.nodeIndex]), [[0, 6], [1, 0], [1, 1]]);
  for (const r of refs) {
    assert.ok(!r.node.anchor.path.startsWith('/'), `${r.node.id} 用了绝对路径`);
    assert.ok(r.node.anchor.start <= r.node.anchor.line && r.node.anchor.line <= r.node.anchor.end, `${r.node.id} 焦点行不在范围内`);
  }
  for (const it of w.items) for (const k of ['why', 'idea', 'scenario', 'before', 'after'] as const) assert.ok(it[k], `${it.id}.${k} 为空`);
  assert.ok(findingsForItem(w, 'i5').length > 0);
});

test('只认 schema v2', () => {
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'wt-')), 'v1.json');
  fs.writeFileSync(f, JSON.stringify({ schemaVersion: '1', kind: 'code', meta: {}, chapters: [] }));
  assert.throws(() => loadWalkthrough(f), /只认 2/);
});

test('链接目标解析', () => {
  assert.deepEqual(parseLinkTarget('a/b.go#L12'), { kind: 'file', path: 'a/b.go', line: 12, end: undefined });
  assert.deepEqual(parseLinkTarget('a/b.go#L12-L20'), { kind: 'file', path: 'a/b.go', line: 12, end: 20 });
  assert.deepEqual(parseLinkTarget('https://github.com/x/pull/1'), { kind: 'url', url: 'https://github.com/x/pull/1' });
});
