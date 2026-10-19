// 用 jsdom 真跑右侧面板：聚焦变暗、分段导航、点暗块切焦点
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as path from 'path';
import * as os from 'os';
import { JSDOM } from 'jsdom';
import { flatten, loadWalkthrough } from '../src/model';
import { Focus, navigate, renderItem } from '../src/panel';

import { SAMPLE } from './fixtures';

function boot(flat: number, focus: Focus) {
  const w = loadWalkthrough(SAMPLE);
  const refs = flatten(w);
  const sent: any[] = [];
  const scrolls: any[] = [];
  const dom = new JSDOM(renderItem(w, refs, refs[flat], [], 'N', '', [], [], '', focus), {
    runScripts: 'dangerously',
    beforeParse(win: any) {
      win.acquireVsCodeApi = () => ({ postMessage: (m: any) => sent.push(JSON.parse(JSON.stringify(m))) });
      win.HTMLElement.prototype.scrollIntoView = function (this: any, o: any) { scrolls.push({ el: this.className, ...o }); };
      win.scrollTo = (o: any) => scrolls.push({ top: o?.top ?? o });
      win.requestAnimationFrame = (f: any) => setTimeout(f, 0);
    },
  });
  const d = dom.window.document;
  const dim = (sel: string) => d.querySelector(sel)!.classList.contains('dim');
  return { w: dom.window as any, d, sent, dim, refs, scrolls };
}

test('不再变暗：任何时候都没有 .dim；顶部写当前位置；最开头时上一步不可点', () => {
  const t = boot(0, 'why');
  assert.equal(t.d.querySelectorAll('.dim').length, 0);
  assert.equal(t.d.getElementById('pos')!.textContent, '第 1/3 项 · 修改原因');
  assert.equal((t.d.getElementById('prev') as any).disabled, true);
});

test('切到链条：位置文字跟着变，依然不变暗', async () => {
  const t = boot(2, 'why');
  t.w.postMessage({ type: 'focus', f: 'node' }, '*');
  await new Promise(r => setTimeout(r, 0));
  assert.equal(t.d.querySelectorAll('.dim').length, 0);
  assert.equal(t.d.getElementById('pos')!.textContent, '第 1/3 项 · 第 3/7 步');
  assert.equal((t.d.getElementById('prev') as any).disabled, false);
});

test('点一段说明：位置切过去并通知会话；点当前步：位置回到链条；再点同一处不重复通知', () => {
  const t = boot(4, 'node');
  (t.d.querySelector('[data-f="idea"] p') as any).click();
  assert.equal(t.d.getElementById('pos')!.textContent, '第 1/3 项 · 核心思想');
  (t.d.querySelector('[data-f="idea"] p') as any).click();
  assert.deepEqual(t.sent, [{ type: 'focus', f: 'idea' }]);
  (t.d.querySelector('li.node.current .text') as any).click();
  assert.deepEqual(t.sent.at(-1), { type: 'focus', f: 'node' });
  assert.equal(t.d.querySelectorAll('.dim').length, 0);
});

test('下一步 / 上一步的走法：修改原因 → 核心思想 → 场景 → 链条各步 → 下一项；反向对称', () => {
  assert.deepEqual(navigate('why', 0, 1), { focus: 'idea' });
  assert.deepEqual(navigate('idea', 0, 1), { focus: 'scene' });
  assert.deepEqual(navigate('scene', 0, 1), { focus: 'node' });
  assert.deepEqual(navigate('node', 0, 1), { jump: 1 }, '链条里往后走一步；跨到新项时由跳转自己定成「修改原因」');
  assert.deepEqual(navigate('node', 3, -1), { jump: -1, focus: 'node' });
  assert.deepEqual(navigate('node', 0, -1), { focus: 'scene' }, '第 1 步往回 = 回到场景');
  assert.deepEqual(navigate('idea', 0, -1), { focus: 'why' });
  assert.deepEqual(navigate('why', 0, -1), { jump: -1, focus: 'node' }, '修改原因往回 = 上一项的最后一步');
});

test('聚焦滚动：整页刚渲染时等加载完再瞬间居中；页内切换焦点平滑居中；修改原因停在顶部', async () => {
  const t = boot(3, 'node');
  assert.deepEqual(t.scrolls, [], '加载完之前不滚：这时还没排好版，滚了也会被忽略');
  await new Promise(r => setTimeout(r, 50));                    // 等 load 事件 + 一帧
  assert.deepEqual(t.scrolls, [{ el: t.d.querySelector('li.node.current')!.className, block: 'center', behavior: 'auto' }]);
  t.scrolls.length = 0;
  t.w.postMessage({ type: 'focus', f: 'idea' }, '*'); await new Promise(r => setTimeout(r, 0));
  const s0 = (t.scrolls as any[])[0];
  assert.deepEqual([s0.block, s0.behavior], ['center', 'smooth']);
  t.scrolls.length = 0;
  t.w.postMessage({ type: 'focus', f: 'why' }, '*'); await new Promise(r => setTimeout(r, 0));
  assert.deepEqual(t.scrolls, [{ top: 0 }]);
  const fresh = boot(0, 'why');
  await new Promise(r => setTimeout(r, 50));
  assert.deepEqual(fresh.scrolls, [], '刚进入一项不滚动');
});
