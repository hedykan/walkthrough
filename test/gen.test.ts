import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { assemble, extractJson, generateItem, generatePlan, newSignal, pool, walkthroughFile } from '../src/gen';
import { logRange } from '../src/git';
import { loadWalkthrough } from '../src/model';

import { BASE8, HEAD8, LOCK8, REPO, REPO_NAME, SAMPLE } from './fixtures';

test('从 AI 输出里取 JSON：优先最后一个代码块；没有代码块就取花括号；坏的报错', () => {
  assert.deepEqual(extractJson('先说两句\n```json\n{"a":1}\n```\n再来\n```json\n{"a":2}\n```'), { a: 2 });
  assert.deepEqual(extractJson('结果：{"items":[{"id":"x"}]} 完'), { items: [{ id: 'x' }] });
  assert.throws(() => extractJson('```json\n{坏\n```'), /不是合法 JSON/);
});

test('并发池：最多同时 limit 个，失败不影响其他', async () => {
  let live = 0, peak = 0;
  const r = await pool([1, 2, 3, 4, 5], 2, async x => {
    live++; peak = Math.max(peak, live);
    await new Promise(res => setTimeout(res, 10));
    live--;
    if (x === 3) throw new Error('boom');
    return x * 10;
  });
  assert.equal(peak, 2);
  assert.deepEqual(r.map(x => x.status), ['fulfilled', 'fulfilled', 'rejected', 'fulfilled', 'fulfilled']);
});

/** 假 claude：按提示词内容决定交什么；记录每次收到的提示词 */
function fakeClaude(dir: string, script: string): string[] {
  const f = path.join(dir, 'fake.js');
  fs.writeFileSync(f, `let input='';process.stdin.on('data',d=>input+=d).on('end',()=>{
    const fs=require('fs');fs.appendFileSync(${JSON.stringify(path.join(dir, 'log'))}, JSON.stringify(input)+'\\n');
    ${script}
    process.stdout.write(JSON.stringify({type:'result',subtype:'success',is_error:false,result:out})+'\\n');});`);
  return [process.execPath, f, '--append-system-prompt', '{system}'];
}

async function input() {
  const w = loadWalkthrough(SAMPLE);
  const { base, head } = w.meta.anchor;
  return { root: REPO, repoName: REPO_NAME, branch: 'feat/x', base: base!, head, commits: await logRange(REPO, base!, head), stat: '' };
}

test('逐项生成：第一次锚点写错 → 带着报错交回修正 → 第二轮通过，并回填改动统计', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wt-gen-'));
  const good = loadWalkthrough(SAMPLE).items[0];
  for (const n of good.chain) { delete n.diff; delete n.changed; }
  const bad = JSON.parse(JSON.stringify(good)); bad.chain[4].symbol = 'wrongFunc';
  fs.writeFileSync(path.join(dir, 'good.json'), JSON.stringify(good));
  fs.writeFileSync(path.join(dir, 'bad.json'), JSON.stringify(bad));
  const cmd = fakeClaude(dir, `const out = '\`\`\`json\\n' + fs.readFileSync(${JSON.stringify(dir)} + (input.includes('没有通过校验') ? '/good.json' : '/bad.json'), 'utf8') + '\\n\`\`\`';`);
  const g = await input();
  const notes: string[] = [];
  const plan = { id: 'i1', title: good.title, why: good.why };
  const { item } = await generateItem({ command: cmd, format: 'claude-stream-json', spec: 'SPEC' }, g, plan, [plan], d => notes.push(d), newSignal());
  const prompts = fs.readFileSync(path.join(dir, 'log'), 'utf8').trim().split('\n').map(l => JSON.parse(l));
  assert.equal(prompts.length, 2, '应该调了两次：生成 + 修正');
  assert.ok(prompts[1].includes('所在函数不是 wrongFunc'), '修正提示词要带上校验报错原文');
  assert.ok(notes.some(n => n.includes('交回 AI 修正')));
  assert.equal(item.chain[4].symbol, 'Service.PayOrder');
  assert.ok(item.chain.every(n => n.diff && typeof n.changed === 'boolean'), '定稿后要有回填');
});

test('逐项生成：修了两轮还不过就报错，带上原因', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wt-gen-'));
  const bad = loadWalkthrough(SAMPLE).items[0]; bad.chain[0].anchor.end = 99999;
  fs.writeFileSync(path.join(dir, 'bad.json'), JSON.stringify(bad));
  const cmd = fakeClaude(dir, `const out = '\`\`\`json\\n' + fs.readFileSync(${JSON.stringify(dir)} + '/bad.json', 'utf8') + '\\n\`\`\`';`);
  const plan = { id: 'i1', title: 't', why: 'w' };
  await assert.rejects(generateItem({ command: cmd, format: 'claude-stream-json', spec: 'S' }, await input(), plan, [plan], () => {}, newSignal()), /修了 2 轮仍没通过校验[\s\S]*范围越界/);
  assert.equal(fs.readFileSync(path.join(dir, 'log'), 'utf8').trim().split('\n').length, 3, '生成 1 次 + 修正 2 次');
});

test('列项：重新编号 i1..iN；提示词带上提交和改动统计', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wt-gen-'));
  const cmd = fakeClaude(dir, `const out = '\`\`\`json\\n{"items":[{"id":"x","title":"甲","why":"因为"},{"id":"y","title":"乙","why":"所以"}]}\\n\`\`\`';`);
  const g = { ...(await input()), stat: ' a.go | 3 ++-' };
  const plan = await generatePlan({ command: cmd, format: 'claude-stream-json', spec: 'S' }, g, () => {}, newSignal());
  assert.deepEqual(plan.map(p => [p.id, p.title]), [['i1', '甲'], ['i2', '乙']]);
  const p = JSON.parse(fs.readFileSync(path.join(dir, 'log'), 'utf8').trim());
  assert.ok(p.includes(LOCK8.slice(0, 7)) && p.includes('a.go | 3 ++-') && p.includes('阶段一'));
});

test('拼装：schema v2、文件名是 base8..head8', async () => {
  const g = await input();
  const w = assemble(g, loadWalkthrough(SAMPLE).items.slice(0, 2), 'claude');
  assert.equal(w.schemaVersion, '2');
  assert.equal(w.meta.anchor.base, g.base);
  assert.equal(path.basename(walkthroughFile('/d', g.repoName, g.base, g.head)), `${BASE8}..${HEAD8}.json`);
});
