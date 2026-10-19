import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderInline, renderMd } from '../src/markdown';

test('正文里的 HTML 被转义，不执行', () => {
  assert.equal(renderInline('<script>x</script>'), '&lt;script&gt;x&lt;/script&gt;');
});

test('代码里的 ** 和 [] 不被当语法', () => {
  assert.equal(renderInline('`a**b**[c](d)`'), '<code>a**b**[c](d)</code>');
});

test('链接带 data-link，粗体生效', () => {
  assert.equal(renderInline('**看** [fee.go:50](internal/x/fee.go#L50)'),
    '<strong>看</strong> <a href="#" class="ln" data-link="internal/x/fee.go#L50">fee.go:50</a>');
});

test('链接目标里的引号无法逃出属性', () => {
  assert.ok(!renderInline('[x](a"onclick=1)').includes('"onclick'));
});

test('列表与分段', () => {
  assert.equal(renderMd('第一行\n第二行\n\n- 甲\n- 乙\n尾'), '<p>第一行<br>第二行</p><ul><li>甲</li><li>乙</li></ul><p>尾</p>');
});
