import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as path from 'path';
import * as os from 'os';
import { gitDiff, gitShow, hasCommit, logFrom, mergeBase, revParse } from '../src/git';
import { parseDiff, rowsInRange } from '../src/diff';
import { flatten, loadWalkthrough } from '../src/model';

import { REPO, SAMPLE } from './fixtures';

test('插件算的 diff 与 finalize.py 回填的统计逐节点一致', async () => {
  const w = loadWalkthrough(SAMPLE);
  const { base, head } = w.meta.anchor;
  for (const { node } of flatten(w)) {
    const rows = rowsInRange(parseDiff(await gitDiff(REPO, base!, head, node.anchor.path)), node.anchor.start, node.anchor.end);
    const got = {
      added: rows.filter(r => r.kind === 'added').length,
      modified: rows.filter(r => r.kind === 'modified').length,
      deleted: rows.reduce((n, r) => n + (r.kind === 'deleted' ? r.text.length : 0), 0),
    };
    assert.deepEqual(got, node.diff, node.id);
  }
});

test('焦点行在 head 快照里存在，且所属函数名与 symbol 对得上', async () => {
  const w = loadWalkthrough(SAMPLE);
  for (const { node } of flatten(w)) {
    const lines = (await gitShow(REPO, w.meta.anchor.head, node.anchor.path)).split('\n');
    assert.ok(node.anchor.end <= lines.length, node.id);
    const ident = node.symbol.split('.').pop()!;
    if (node.symbol === 'router') continue;
    const owner = lines.slice(0, node.anchor.start).reverse().find(l => l.startsWith('func ')) ?? '';
    assert.match(owner, new RegExp(`\\b${ident}\\b`), node.id);
  }
});

test('每条修改说明都挂在真实改动行上', async () => {
  const w = loadWalkthrough(SAMPLE);
  const { base, head } = w.meta.anchor;
  let count = 0;
  for (const { node } of flatten(w)) {
    if (!node.notes) continue;
    const d = parseDiff(await gitDiff(REPO, base!, head, node.anchor.path));
    for (const n of node.notes) { assert.ok(d.lines.has(n.line), `${node.id} L${n.line} 不是改动行`); count++; }
  }
  assert.equal(count, 13);
});

test('新增文件在 base 不存在：git show 报错，由快照的 missingOk 兜成空文件', async () => {
  const w = loadWalkthrough(SAMPLE);
  await assert.rejects(gitShow(REPO, w.meta.anchor.base!, 'internal/payment/lock.go'));
});

test('不存在的提交返回 false', async () => {
  assert.equal(await hasCommit(REPO, '0'.repeat(40)), false);
});

test('已合入的 feature/payment-lock：和 origin/main 的分叉点就是它自己；往下 100 个历史里能找到样例走读那段', async () => {
  const tip = await revParse(REPO, 'feature/payment-lock');
  assert.ok(tip);
  assert.equal(await mergeBase(REPO, 'origin/main', tip!), tip, '已合入：分叉点 = 分支本身');
  const shas = (await logFrom(REPO, tip!, 100)).map(c => c.sha.slice(0, 8));
  const head = shas.indexOf('f2c3bced'), base = shas.indexOf('dfca5cf3');
  assert.ok(head >= 0 && base > head, `应能点选 dfca5cf3..f2c3bced：head=${head} base=${base}`);
});
