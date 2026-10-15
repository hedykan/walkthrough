import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as path from 'path';
import * as os from 'os';
import { flatten, loadWalkthrough } from '../src/model';
import { renderItem } from '../src/panel';

const SAMPLE = path.join(os.homedir(), 'Develope/loloyal/loloyal-myself/walkthrough/loloyal-services-be/code/72872858..b442c435.json');

test('32 个节点逐个渲染：结构齐全、当前步唯一、内嵌脚本可解析', () => {
  const w = loadWalkthrough(SAMPLE);
  const refs = flatten(w);
  for (const ref of refs) {
    const html = renderItem(w, refs, ref, [{ kind: 'added', line: ref.node.anchor.line, text: 'x <b>' }], 'N', "default-src 'none'");
    for (const h of ['修改原因', '改的核心思想', '场景', '以前', '现在', '核心链条']) assert.ok(html.includes(`<h2>${h}`), `${ref.node.id} 缺「${h}」`);
    assert.equal(html.match(/class="node [^"]*current/g)?.length, 1, ref.node.id);
    assert.equal(html.match(/<li class="node /g)?.length, ref.item.chain.length, ref.node.id);
    assert.ok(html.includes('x &lt;b&gt;'), 'diff 文本必须转义');
    const order = ['修改原因', '改的核心思想', '场景', '以前', '现在', '核心链条'].map(h => html.indexOf(`<h2>${h}`));
    assert.deepEqual(order, [...order].sort((a, b) => a - b), `${ref.node.id} 段落顺序不对`);
    for (const gone of ['这是干嘛的', '为什么改', '一句话收尾']) assert.ok(!html.includes(gone), `「${gone}」应已删除`);
    const script = html.match(/<script nonce="N">([\s\S]*?)<\/script>/)![1];
    assert.doesNotThrow(() => new Function(script), `${ref.node.id} 内嵌脚本语法错误`);
  }
});

test('本步改动里，修改说明紧跟在对应改动行后面', () => {
  const w = loadWalkthrough(SAMPLE);
  const refs = flatten(w);
  const ref = refs.find(r => r.node.id === 'i1-n5')!;
  const html = renderItem(w, refs, ref, [
    { kind: 'added', line: 40, text: 'includesShipping bool,' },
    { kind: 'added', line: 50, text: 'if !includesShipping {' },
    { kind: 'added', line: 51, text: 'return 0' },
  ], 'N', '');
  const block = html.slice(html.indexOf('<div class="diff">'));
  const at = (t: string) => { const i = block.indexOf(t); assert.ok(i >= 0, `diff 区块里找不到：${t}`); return i; };
  assert.ok(at('includesShipping bool,') < at('新增参数') && at('新增参数') < at('if !includesShipping {'), '说明应在 L40 与 L50 之间');
  assert.ok(at('if !includesShipping {') < at('不挂任何规则') && at('不挂任何规则') < at('>return 0<'), '说明应在 L50 与 L51 之间');
});

test('配色只有三种：样式里不许出现写死的颜色值', () => {
  const w = loadWalkthrough(SAMPLE);
  const refs = flatten(w);
  const css = renderItem(w, refs, refs[0], [], 'N', '').match(/<style nonce="N">([\s\S]*?)<\/style>/)![1];
  assert.doesNotMatch(css, /#[0-9a-f]{3,6}\b|\brgba?\(/i, '颜色必须取自 --key / --warn / --dim');
  const vars = new Set(css.match(/var\(--(key|warn|dim)\)/g));
  assert.deepEqual([...vars].sort(), ['var(--dim)', 'var(--key)', 'var(--warn)']);
});

test('本步改动默认收起：摘要行写改动统计和说明条数，点开才有代码', () => {
  const w = loadWalkthrough(SAMPLE);
  const refs = flatten(w);
  const ref = refs.find(r => r.node.id === 'i1-n5')!;
  const html = renderItem(w, refs, ref, [
    { kind: 'added', line: 40, text: 'includesShipping bool,' },
    { kind: 'modified', line: 50, text: 'if !includesShipping {', old: 'x' },
    { kind: 'deleted', after: 51, text: ['a', 'b'] },
  ], 'N', '');
  const m = html.match(/<details class="dwrap"( open)?><summary>本步改动 <span class="dstat">([^<]*)<\/span><\/summary><div class="diff">/);
  assert.ok(m, '改动区要包在折叠块里');
  assert.equal(m![1], undefined, '默认收起');
  assert.equal(m![2], '+1 ~1 −2 · 2 条说明');
  assert.ok(renderItem(w, refs, refs[0], [], 'N', '').includes('本步没有改动，只是经过'));
});
