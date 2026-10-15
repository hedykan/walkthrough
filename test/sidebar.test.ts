// 用 jsdom 真跑左侧视图：推 state、点输入框、打字、按键，看下拉和发出的消息对不对。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { sidebarHtml } from '../src/sidebar-view';

function boot(extra: Record<string, unknown> = {}) {
  const sent: any[] = [];
  const dom = new JSDOM(sidebarHtml('N', ''), {
    runScripts: 'dangerously',
    beforeParse(w: any) {
      w.acquireVsCodeApi = () => ({ postMessage: (m: any) => sent.push(JSON.parse(JSON.stringify(m))) });
      w.HTMLElement.prototype.scrollIntoView = () => {};
    },
  });
  const w = dom.window as any, d = w.document;
  const now = Math.floor(Date.now() / 1000);
  const state = {
    repos: [{ name: 'repo', root: '/r' }], repo: '/r',
    branches: [
      { name: 'main', date: now - 60, remote: false },
      { name: 'origin/hotfix/metafield-partial', date: now - 3600 * 5, remote: true },
      { name: 'feat/v14.9-mul-pao', date: now - 86400 * 3, remote: false },
    ],
    branch: 'main', bases: ['origin/main', 'origin/dev'], baseRef: 'origin/main', commits: [], existing: {},
    dir: { show: '~/walkthroughs', full: '/Users/x/walkthroughs', ask: false }, history: [],
    askModel: 'claude-sonnet', askModels: [{ id: '', label: '默认' }, { id: 'claude-opus', label: 'claude-opus' }, { id: 'claude-sonnet', label: 'claude-sonnet' }, { id: 'codex-gpt-5.6-sol', label: 'codex-gpt-5.6-sol' }], ...extra,
  };
  w.postMessage({ type: 'state', state }, '*');
  const flush = () => new Promise(r => setTimeout(r, 0));
  const q = () => d.getElementById('bq');
  const rows = () => [...d.querySelectorAll('#bq-list .b')].map((e: any) => e.dataset.b);
  const key = (k: string) => q().dispatchEvent(new w.KeyboardEvent('keydown', { key: k, bubbles: true }));
  const post = (st: any) => w.postMessage({ type: 'state', state: { ...state, ...st } }, '*');
  return { sent, w, d, flush, q, rows, key, post };
}

test('点进分支框：不被当前分支名过滤，列出全部分支', async () => {
  const t = boot(); await t.flush();
  assert.equal(t.q().value, 'main');
  t.q().focus(); await t.flush();
  assert.deepEqual(t.rows(), ['main', 'origin/hotfix/metafield-partial', 'feat/v14.9-mul-pao']);
  assert.ok(t.d.querySelector('#bq-list .b.cur'), '当前分支要标出来');
  assert.match(t.d.querySelector('#bq-list').textContent, /远端 · 5 小时前/);
});

test('打字按「包含」筛选，不区分大小写；回车选中发消息', async () => {
  const t = boot(); await t.flush();
  t.q().focus(); await t.flush();
  t.q().value = 'META';
  t.q().dispatchEvent(new t.w.Event('input', { bubbles: true }));
  assert.deepEqual(t.rows(), ['origin/hotfix/metafield-partial']);
  t.key('Enter'); await t.flush();
  assert.deepEqual(t.sent.filter(m => m.type === 'branch'), [{ type: 'branch', name: 'origin/hotfix/metafield-partial' }]);
  assert.equal(t.d.getElementById('bq-list').hidden, true);
});

test('↓ 移动高亮、点选也能选；Esc 关闭并恢复原值；⟳ 发 fetch', async () => {
  const t = boot(); await t.flush();
  t.q().focus(); await t.flush();
  t.key('ArrowDown');
  assert.equal(t.d.querySelector('#bq-list .b.on').dataset.b, 'origin/hotfix/metafield-partial');
  t.q().value = 'zzz'; t.q().dispatchEvent(new t.w.Event('input', { bubbles: true }));
  assert.match(t.d.getElementById('bq-list').textContent, /没有匹配的分支/);
  t.key('Escape'); await t.flush();
  assert.equal(t.q().value, 'main');
  t.q().focus(); await t.flush();
  const row = t.d.querySelector('#bq-list .b[data-b="feat/v14.9-mul-pao"]');
  row.dispatchEvent(new t.w.MouseEvent('mousedown', { bubbles: true }));
  assert.deepEqual(t.sent.filter(m => m.type === 'branch').pop(), { type: 'branch', name: 'feat/v14.9-mul-pao' });
  t.d.getElementById('fetch').click();
  assert.ok(t.sent.some(m => m.type === 'fetch'));
});

test('对比也是可搜索下拉：常用主干排最前，后面是全部分支；选了发 base', async () => {
  const t = boot(); await t.flush();
  const c = t.d.getElementById('cq');
  assert.equal(c.value, 'origin/main');
  c.focus(); await t.flush();
  const rows = [...t.d.querySelectorAll('#cq-list .b')].map((e: any) => e.dataset.b);
  assert.deepEqual(rows.slice(0, 2), ['origin/main', 'origin/dev']);
  assert.ok(rows.includes('feat/v14.9-mul-pao'), '任意分支都能当基准');
  c.value = 'dev'; c.dispatchEvent(new t.w.Event('input', { bubbles: true }));
  c.dispatchEvent(new t.w.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  assert.deepEqual(t.sent.filter(m => m.type === 'base'), [{ type: 'base', ref: 'origin/dev' }]);
});

test('分支已合入：提示已合入、不预选范围；点终点 + Shift 点起点后出现生成按钮', async () => {
  const C = (sha: string, subject: string) => ({ sha: sha.padEnd(40, '0'), short: sha, subject, author: 'a', ago: '1 天前', merge: false });
  const commits = [C('844a49e9', '最新'), C('b442c435', 'Sidekick'), C('7b6b5c15', '退款'), C('72872858', '更早')];
  const t = boot({ merged: 'origin/main', fork: commits[0].sha, commits }); await t.flush();
  assert.match(t.d.body.textContent, /已合入 origin\/main，没有独有的提交/);
  assert.match(t.d.body.textContent, /分支已合入，自己点选/);
  assert.equal(t.d.getElementById('gen'), null, '没选范围前不出现生成按钮');
  // 模拟扩展收到 range 后回推的 state
  t.post({ merged: 'origin/main', commits, range: { head: commits[1].sha, base: commits[3].sha } }); await t.flush();
  assert.match(t.d.querySelector('.sum').textContent, /72872858..b442c435 · 2 个提交/);
  assert.ok(t.d.getElementById('gen'));
});

test('问答模型下拉：显示当前选择，切换后发 model', async () => {
  const t = boot(); await t.flush();
  const sel = t.d.getElementById('model');
  assert.equal(sel.value, 'claude-sonnet');
  assert.deepEqual([...sel.options].map((o: any) => o.textContent), ['默认', 'claude-opus', 'claude-sonnet', 'codex-gpt-5.6-sol']);
  sel.value = 'codex-gpt-5.6-sol'; sel.dispatchEvent(new t.w.Event('change', { bubbles: true }));
  assert.deepEqual(t.sent.filter(m => m.type === 'model'), [{ type: 'model', value: 'codex-gpt-5.6-sol' }]);
});

test('走读目录：显示短路径（悬停看全路径）；更改 / 打开发消息；第一次用时提示选目录', async () => {
  const t = boot(); await t.flush();
  const p = t.d.querySelector('.row.dir .dpath');
  assert.equal(p.textContent, '~/walkthroughs');
  assert.equal(p.getAttribute('title'), '/Users/x/walkthroughs');
  assert.equal(t.d.querySelector('.dirask'), null, '选过目录就不提示');
  t.d.getElementById('pickDir').click();
  t.d.getElementById('revealDir').click();
  assert.deepEqual(t.sent.filter(m => /Dir$/.test(m.type)).map(m => m.type), ['pickDir', 'revealDir']);

  const f = boot({ dir: { show: '~/walkthroughs', full: '/Users/x/walkthroughs', ask: true } }); await f.flush();
  assert.match(f.d.querySelector('.dirask').textContent, /还没选走读目录：生成的走读会存到 ~\/walkthroughs/);
  f.d.getElementById('useDefaultDir').click();
  f.d.getElementById('pickDir2').click();
  assert.deepEqual(f.sent.filter(m => /Dir$/.test(m.type)).map(m => m.type), ['useDefaultDir', 'pickDir']);
});

test('这个分支的走读：列出记录（日期、范围、几项、标题），正在看的标出来，点一下打开', async () => {
  const history = [
    { key: 'dc134417..76fab0a4', file: '/w/a.json', title: '修复 metafield', base: '', head: '', branch: 'x', at: '2026-10-14T03:00:00Z', items: 2 },
    { key: '72872858..b442c435', file: '/w/b.json', title: '三处修正', base: '', head: '', branch: 'x', at: '2026-10-10T03:00:00Z', items: 5 },
  ];
  const t = boot({ history, wt: { title: '三处修正', file: '/w/b.json', items: [], current: -1 } }); await t.flush();
  assert.match(t.d.body.textContent, /这个分支的走读（2）/);
  const rows = [...t.d.querySelectorAll('.hist li')] as any[];
  assert.deepEqual(rows.map(r => r.querySelector('.hk').textContent), ['dc134417..76fab0a4', '72872858..b442c435']);
  assert.equal(rows[0].querySelector('.hd').textContent, '10-14');
  assert.ok(rows[1].classList.contains('cur') && /正在看/.test(rows[1].textContent));
  rows[0].click();
  assert.deepEqual(t.sent.filter(m => m.type === 'open'), [{ type: 'open', file: '/w/a.json' }]);
  const empty = boot(); await empty.flush();
  assert.equal(empty.d.querySelector('.hist'), null, '没有记录就不显示');
});

test('工作区（未提交）：列表顶上多一行；默认终点是它；摘要写「+ 未提交改动」；Shift 点它不能当起点；双击它 = 只看未提交', async () => {
  const C = (sha: string, subject: string) => ({ sha: sha.padEnd(40, '0'), short: sha, subject, author: 'a', ago: '1 天前', merge: false });
  const commits = [C('18927c6a', '最新提交'), C('239620ac', '更早')];
  const work = { dir: '/w/plan-rename', show: '~/w/plan-rename', files: [{ status: ' M', path: 'a.go' }, { status: '??', path: 'new.go' }] };
  const t = boot({ commits, forkInfo: C('dc134417', 'fork'), fork: 'dc134417'.padEnd(40, '0'), work, range: { base: 'dc134417'.padEnd(40, '0'), head: 'WORKTREE' } });
  await t.flush();
  const rows = [...t.d.querySelectorAll('.log .c')] as any[];
  assert.match(rows[0].textContent, /工作区（未提交）· 2 个文件/);
  assert.ok(rows[0].classList.contains('head'));
  assert.match(t.d.querySelector('.sum').textContent, /dc134417..工作区 · 2 个提交 \+ 未提交改动/);
  rows[0].dispatchEvent(new t.w.MouseEvent('click', { bubbles: true, shiftKey: true, detail: 1 }));
  await new Promise(r => setTimeout(r, 260));
  assert.deepEqual(t.sent.filter(m => m.type === 'range'), [], 'Shift 点工作区不能当起点');
  rows[0].dispatchEvent(new t.w.MouseEvent('dblclick', { bubbles: true }));
  assert.deepEqual(t.sent.filter(m => m.type === 'range').pop(), { type: 'range', base: commits[0].sha, head: 'WORKTREE' });
});

test('生成前确认快照文件：列出文件（改 / 新），拍快照并生成 发 snapshot ok；取消 发 cancel', async () => {
  const files = [{ status: ' M', path: 'internal/a.go' }, { status: '??', path: 'internal/new.go' }, { status: ' D', path: 'old.go' }];
  const t = boot({ gen: { stage: 'snapshot', note: '这些文件会拍进快照', files } }); await t.flush();
  assert.match(t.d.body.querySelector('h3').textContent + t.d.querySelectorAll('h3')[1]?.textContent, /确认拍进快照的文件（3）/);
  assert.deepEqual([...t.d.querySelectorAll('.snap li')].map((li: any) => li.textContent), ['改internal/a.go', '新internal/new.go', '删old.go']);
  t.d.getElementById('snapOk').click();
  t.d.getElementById('cancel2').click();
  assert.deepEqual(t.sent.filter(m => m.type === 'snapshot' || m.type === 'cancel'), [{ type: 'snapshot', ok: true }, { type: 'cancel' }]);
});

test('走读记录的 ×：每行都有；点 × 只发 delete，不会顺带打开', async () => {
  const history = [
    { key: 'a..b', file: '/w/a.json', title: '甲', base: '', head: '', branch: 'x', at: '2026-10-14T03:00:00Z', items: 2 },
    { key: 'c..d', file: '/w/c.json', title: '乙', base: '', head: '', branch: 'x', at: '2026-10-13T03:00:00Z', items: 1 },
  ];
  const t = boot({ history }); await t.flush();
  const xs = [...t.d.querySelectorAll('.hist .x')] as any[];
  assert.equal(xs.length, 2);
  xs[1].click();
  assert.deepEqual(t.sent.filter(m => m.type === 'delete' || m.type === 'open'), [{ type: 'delete', file: '/w/c.json' }]);
});
