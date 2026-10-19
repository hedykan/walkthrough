// 在假 DOM 里真跑面板脚本、真派发点击：脚本里 if 的先后顺序写错，这里会抓到。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as path from 'path';
import * as os from 'os';
import * as vm from 'vm';
import { flatten, loadWalkthrough } from '../src/model';
import { renderItem } from '../src/panel';

import { SAMPLE } from './fixtures';

function boot(at = 0) {
  const w = loadWalkthrough(SAMPLE);
  const refs = flatten(w);
  const html = renderItem(w, refs, refs[at], [], 'N', '');
  const script = html.match(/<script nonce="N">([\s\S]*?)<\/script>/)![1];
  const sent: any[] = [];
  let onClick: (e: any) => void = () => {};
  const scrolled: string[] = [];
  const stub = { onclick: null, scrollIntoView() {} };
  const document = {
    getElementById: () => ({ ...stub }), querySelector: (sel: string) => ({ scrollIntoView: () => scrolled.push(sel) }), querySelectorAll: () => [],
    addEventListener: (t: string, fn: any) => { if (t === 'click') onClick = fn; },
  };
  vm.runInNewContext(script, { document, window: { addEventListener() {} }, acquireVsCodeApi: () => ({ postMessage: (m: any) => sent.push(JSON.parse(JSON.stringify(m))) }) });
  /** 造一个点击：hits = 「选择器 → closest 返回的元素」 */
  const click = (hits: Record<string, any>) => {
    let prevented = false;
    onClick({ altKey: !!hits.$alt, target: { closest: (sel: string) => hits[sel] ?? null }, preventDefault: () => { prevented = true; }, stopPropagation() {} });
    return prevented;
  };
  return { sent, click, scrolled };
}

test('点回答里的代码引用：发 ref，带上所在那句话', () => {
  const { sent, click } = boot();
  const sentence = { innerText: '  金额不大于 0 时手续费为 0（fee.go:5）。 ' };
  const link = { innerText: ' fee.go:5 ', dataset: { link: 'internal/payment/engine/fee.go#L5' }, closest: (s: string) => s === '.a' ? {} : s === 'li, p' ? sentence : null };
  const prevented = click({ a: link, '.qa': {}, 'li.node': { classList: { contains: () => false }, dataset: { flat: '3' } } });
  assert.deepEqual(sent, [{ type: 'ref', target: 'internal/payment/engine/fee.go#L5', why: '金额不大于 0 时手续费为 0（fee.go:5）。', label: 'fee.go:5', peek: false }]);
  assert.ok(prevented);
  click({ $alt: true, a: link, '.qa': {} });
  assert.equal(sent[1].peek, true, '按住 Alt 点 = 就地预览');
});

test('点面包屑：发 trail，带上第几段', () => {
  const { sent, click } = boot();
  click({ '[data-trail]': { dataset: { trail: '-1' } }, a: { dataset: {} } });
  assert.deepEqual(sent, [{ type: 'trail', k: -1 }]);
});

test('点走读正文里的链接：同样走 ref（记入跳转路径），没有说明句', () => {
  const { sent, click } = boot();
  click({ a: { innerText: 'gateway.go:15', dataset: { link: 'a.go#L1' }, closest: () => null } });
  assert.deepEqual(sent, [{ type: 'ref', target: 'a.go#L1', why: '', label: 'gateway.go:15', peek: false }]);
});

test('在问答区里点别的（展开、打字）：不跳步；点链条一步的其他地方：跳步', () => {
  const { sent, click } = boot();
  const li = { classList: { contains: () => false }, dataset: { flat: '5' } };
  click({ '.qa': {}, 'li.node': li });
  assert.deepEqual(sent, []);
  click({ 'li.node': li });
  assert.deepEqual(sent, [{ type: 'node', flat: 5 }]);
});
