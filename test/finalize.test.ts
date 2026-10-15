import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as path from 'path';
import * as os from 'os';
import { Finalizer } from '../src/finalize';
import { loadWalkthrough } from '../src/model';

const REPO = path.join(os.homedir(), 'Develope/loloyal/loloyal-services-be');
const SAMPLE = path.join(os.homedir(), 'Develope/loloyal/loloyal-myself/walkthrough/loloyal-services-be/code/72872858..b442c435.json');
const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x));

test('TS 版定稿：#2606 五项零报错，回填的改动统计与 Python 版逐节点一致', async () => {
  const w = loadWalkthrough(SAMPLE);
  const f = new Finalizer(REPO, w.meta.anchor.base, w.meta.anchor.head);
  for (const orig of w.items) {
    const it = clone(orig);
    for (const n of it.chain) { delete n.diff; delete n.changed; }
    const r = await f.check(it);
    assert.deepEqual(r.errors, [], orig.id);
    it.chain.forEach((n, i) => assert.deepEqual([n.diff, n.changed], [orig.chain[i].diff, orig.chain[i].changed], n.id));
  }
});

test('TS 版定稿：拦住锚点漂移、说明挂错行、越界、绝对路径、缺字段', async () => {
  const w = loadWalkthrough(SAMPLE);
  const f = new Finalizer(REPO, w.meta.anchor.base, w.meta.anchor.head);
  const it = clone(w.items[0]);
  it.chain[4].notes![0].line = 42;                      // 没改的行
  it.chain[4].symbol = 'notThisFunc';                   // 函数名对不上
  it.chain[0].anchor.end = 99999;                       // 越界
  it.chain[1].anchor.path = '/Users/x/a.go';            // 绝对路径
  it.chain[2].anchor.path = 'no/such/file.go';
  (it as any).idea = '';
  const { errors } = await f.check(it);
  for (const want of ['说明行 42 不是改动行', '所在函数不是 notThisFunc', '范围越界', '必须是仓库相对路径', '文件在 head 不存在', 'i1.idea 为空'])
    assert.ok(errors.some(e => e.includes(want)), `没拦住：${want}\n${errors.join('\n')}`);
});

test('TS 版定稿：代码文件的 symbol 必须解析得出函数名（堵住加句点绕过）；SQL 等非代码文件不查所属函数', async () => {
  const w = loadWalkthrough(SAMPLE);
  const f = new Finalizer(REPO, w.meta.anchor.base, w.meta.anchor.head);
  const it = clone(w.items[0]);
  it.chain[4].symbol = 'wrongFunc.';                          // 末尾加句点：以前取到空串就跳过了检查
  it.chain[3].symbol = '第 4 步';                              // 代码文件写段落名：不行
  it.chain[2].anchor = { path: 'go.mod', start: 1, end: 3, line: 1 };   // 非代码文件：不查所属函数
  it.chain[2].symbol = '第 1 段 module';
  delete it.chain[2].notes;
  const { errors } = await f.check(it);
  assert.ok(errors.some(e => e.startsWith('i1-n5') && e.includes('所在函数不是 wrongFunc')), errors.join('\n'));
  assert.ok(errors.some(e => e.startsWith('i1-n4') && e.includes('解析不出函数名')), errors.join('\n'));
  assert.ok(!errors.some(e => e.startsWith('i1-n3')), '非代码文件不该报所属函数：' + errors.join('\n'));
});
