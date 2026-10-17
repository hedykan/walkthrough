import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { loadWalkthrough } from '../src/model';
import { Answer, askCommandFor, askModelOptions, answersPath, buildPrompt, buildQuickPrompt, commandLinks, historyFor, linkifyRefs, loadAnswers, modelCommandFor, parseClaudeLine, resolveRefPath, runAsk, saveAnswer, systemPrompt, targetKey } from '../src/ask';
import { listFiles } from '../src/git';
import { renderMd } from '../src/markdown';
import { flatten } from '../src/model';
import { renderAnswer, renderItem, renderTrail } from '../src/panel';

const SAMPLE = path.join(os.homedir(), 'Develope/loloyal/loloyal-myself/walkthrough/loloyal-services-be/code/72872858..b442c435.json');

test('提示词带齐：项的说明、整条链条、点选的那段、这一步的代码与 diff、问题', () => {
  const w = loadWalkthrough(SAMPLE);
  const item = w.items[0];
  const p = buildPrompt(w, item, { item: 'i1', kind: 'note', node: 'i1-n5', line: 50 }, '为什么不直接删掉开关参数？', {
    path: 'a.go', start: 36, end: 38, lines: ['func x(', '  a bool,', ') {'], diff: ['+  a bool,  // L37'],
  });
  for (const s of [w.meta.anchor.head, item.why, item.idea, '★ 推算缺省值', '○ 接口入口', '第 5 步「推算缺省值」第 50 行的修改说明',
    '不挂任何规则', '36  func x(', '+  a bool,  // L37', '为什么不直接删掉开关参数？']) assert.ok(p.includes(s), `缺：${s}`);
  const sys = systemPrompt(w.meta.anchor.base, w.meta.anchor.head);
  assert.ok(sys.includes(`git show ${w.meta.anchor.head}:`) && sys.includes('只读'));
});

test('解析 claude stream-json：文本、工具调用、最终结果', () => {
  assert.deepEqual(parseClaudeLine('{"type":"assistant","message":{"content":[{"type":"text","text":"先看代码"},{"type":"tool_use","name":"Bash","input":{"command":"git show abc:x.go"}}]}}'),
    [{ kind: 'text', text: '先看代码' }, { kind: 'tool', label: 'Bash git show abc:x.go' }]);
  assert.deepEqual(parseClaudeLine('{"type":"result","subtype":"success","is_error":false,"result":"结论"}'), [{ kind: 'result', text: '结论', error: false }]);
  assert.deepEqual(parseClaudeLine('{"type":"result","subtype":"error_max_turns","is_error":true}'), [{ kind: 'result', text: '', error: true }]);
  assert.deepEqual(parseClaudeLine('not json'), []);
});

test('runAsk：提示词走 stdin，参数不经 shell，{system} 被替换', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wt-ask-'));
  const fake = path.join(dir, 'fake-claude.js');
  fs.writeFileSync(fake, `
    let input = ''; process.stdin.on('data', d => input += d).on('end', () => {
      const sys = process.argv[process.argv.indexOf('--append-system-prompt') + 1];
      const say = o => process.stdout.write(JSON.stringify(o) + '\\n');
      say({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Read', input: { file_path: 'x.go' } }] } });
      say({ type: 'result', subtype: 'success', is_error: false, result: 'cwd=' + process.cwd() + ' sys=' + sys + ' q=' + input });
    });`);
  const events: string[] = [];
  const run = runAsk([process.execPath, fake, '--append-system-prompt', '{system}'], 'claude-stream-json', dir, 'SYS; rm -rf /', 'Q?',
    e => events.push(e.kind));
  const out = await run.done;
  assert.equal(out, `cwd=${fs.realpathSync(dir)} sys=SYS; rm -rf / q=Q?`);
  assert.deepEqual(events, ['tool', 'result']);
});

test('runAsk：命令失败时带上错误信息', async () => {
  const run = runAsk([process.execPath, '-e', 'process.stderr.write("boom"); process.exit(3)'], 'text', os.tmpdir(), '', '', () => {});
  await assert.rejects(run.done, /boom/);
  await assert.rejects(runAsk(['/no/such/bin'], 'text', os.tmpdir(), '', '', () => {}).done, /启动 .* 失败/);
});

test('answers.json：同名旁存、先读后写、不落 status', () => {
  const w = loadWalkthrough(SAMPLE);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wt-ans-'));
  const wt = path.join(dir, 'a..b.json');
  assert.equal(answersPath(wt), path.join(dir, 'a..b.answers.json'));
  const mk = (id: string): Answer => ({ id, target: { item: 'i1', kind: 'why' }, q: 'q' + id, a: 'a' + id, at: '2026-10-12T10:00:00Z', by: 'claude', status: 'done', progress: 'x' });
  saveAnswer(wt, w, mk('1'));
  saveAnswer(wt, w, mk('2'));
  saveAnswer(wt, w, { ...mk('1'), a: '改过' });
  const raw = JSON.parse(fs.readFileSync(answersPath(wt), 'utf8'));
  assert.equal(raw.head, w.meta.anchor.head);
  assert.deepEqual(raw.answers.map((a: Answer) => [a.id, a.a]), [['2', 'a2'], ['1', '改过']]);
  assert.ok(!('status' in raw.answers[0]) && !('progress' in raw.answers[0]));
  assert.equal(loadAnswers(wt).length, 2);
  assert.deepEqual(loadAnswers(path.join(dir, 'none.json')), []);
});

test('回答渲染在它点选的那段下面，且内容被转义', () => {
  const w = loadWalkthrough(SAMPLE);
  const refs = flatten(w);
  const ref = refs.find(r => r.node.id === 'i1-n5')!;
  const a: Answer = { id: 'x1', target: { item: 'i1', kind: 'note', node: 'i1-n5', line: 50 }, q: '<b>问</b>', a: '答 **重点**\n```go\nif a < b {}\n```', at: '2026-10-12T10:00:00Z', by: 'claude' };
  const html = renderItem(w, refs, ref, [{ kind: 'added', line: 50, text: 'if !includesShipping {' }], 'N', '', [a]);
  const box = html.indexOf(`data-key="${targetKey(a.target)}"`);
  assert.ok(box > html.indexOf('不挂任何规则</'), '回答区应在那条说明后面');
  assert.ok(html.indexOf('data-aid="x1"') > box);
  assert.ok(html.includes('&lt;b&gt;问&lt;/b&gt;') && html.includes('<pre><code>if a &lt; b {}</code></pre>'));
});

test('Markdown：代码块原样转义，标题与有序列表', () => {
  assert.equal(renderMd('# 结论\n1. 甲\n2. 乙\n```\n**不加粗** <x>\n```'),
    '<h3>结论</h3><ol><li>甲</li><li>乙</li></ol><pre><code>**不加粗** &lt;x&gt;</code></pre>');
});

test('回答渲染出来一律收起，状态写在标题行', () => {
  const base: Answer = { id: 'a', target: { item: 'i1', kind: 'why' }, q: '问题', a: '回答', at: '2026-10-12T10:00:00Z', by: 'claude' };
  for (const status of ['done', 'running', 'error'] as const) assert.doesNotMatch(renderAnswer({ ...base, status }), /<details[^>]*\sopen/, status);
  assert.match(renderAnswer({ ...base, status: 'running' }), /<span class="qmeta">回答中…/);
  assert.match(renderAnswer({ ...base, status: 'error' }), /<span class="qmeta">出错/);
  assert.match(renderAnswer(base), /<summary class="q">.*问题/);
});

test('「问」按钮带上回答区的 key，两者一一对应', () => {
  const w = loadWalkthrough(SAMPLE);
  const refs = flatten(w);
  const html = renderItem(w, refs, refs[4], [{ kind: 'added', line: 50, text: 'x' }], 'N', '');
  const btnKeys = [...html.matchAll(/class="ask"[^>]*data-key="([^"]+)"/g)].map(m => m[1]);
  const boxKeys = new Set([...html.matchAll(/class="qa" data-key="([^"]+)"/g)].map(m => m[1]));
  assert.ok(btnKeys.length >= 4);
  for (const k of btnKeys) assert.ok(boxKeys.has(k), `按钮 ${k} 没有对应的回答区`);
  assert.ok(!html.includes('showInputBox'));
});

test('「问问题」在每个块的最下面：先回答区，后按钮；以前在现在上面', () => {
  const w = loadWalkthrough(SAMPLE);
  const refs = flatten(w);
  const ref = refs.find(r => r.node.id === 'i1-n5')!;
  const html = renderItem(w, refs, ref, [{ kind: 'added', line: 50, text: 'x' }], 'N', '');
  assert.ok(html.indexOf('<h2>以前') < html.indexOf('<h2>现在'));
  for (const t of [{ item: 'i1', kind: 'why' }, { item: 'i1', kind: 'scenario' }, { item: 'i1', kind: 'node', node: 'i1-n5' }] as const) {
    const k = targetKey(t);
    const box = html.indexOf(`class="qa" data-key="${k}"`), btn = html.indexOf(`data-key="${k}" data-ask=`);
    assert.ok(box > 0 && btn > box, `${k}：按钮应在回答区之后`);
  }
  // 一步里，按钮在本步改动之后
  const li = html.slice(html.indexOf('data-flat="' + ref.flat + '"'));
  assert.ok(li.indexOf('class="diff"') < li.indexOf('>问问题</button>'));
  assert.ok(html.includes('>问问题</button>') && !html.includes('>问</button>'));
});

const REPO = path.join(os.homedir(), 'Develope/loloyal/loloyal-services-be');
const FUSION = 'internal/service/point/engine/fusion.go';

test('回答里裸写的「文件:行号」用 head 文件列表解析成链接（用户贴的真实回答）', async () => {
  const w = loadWalkthrough(SAMPLE);
  const paths = await listFiles(REPO, w.meta.anchor.head);
  const ans = '按金额计分的规则在金额为 0 时，算出的份数本来就是 0，不需要额外拦（fusion.go:162-166）。\n' +
    '- 固定积分规则直接返回配置的分值（`fusion.go:168`）。\n- 已经是链接的不动：[看这里](' + FUSION + '#L155-L157)';
  const out = linkifyRefs(ans, paths);
  assert.ok(out.includes(`[fusion.go:162-166](${FUSION}#L162-L166)`), out);
  assert.ok(out.includes(`[fusion.go:168](${FUSION}#L168)`) && !out.includes('`fusion.go:168`'));
  assert.ok(out.includes(`[看这里](${FUSION}#L155-L157)`) && !out.includes('[[看这里'));
  assert.equal(resolveRefPath('engine/fusion.go', paths), FUSION);
});

test('同名文件判断不出是哪个就不乱链；链条里出现过的优先', async () => {
  const w = loadWalkthrough(SAMPLE);
  const paths = await listFiles(REPO, w.meta.anchor.head);
  const dup = paths.filter(p => p.endsWith('/service.go'));
  assert.ok(dup.length > 1, '仓库里应有多个 service.go');
  assert.equal(resolveRefPath('service.go', paths), undefined);
  assert.equal(linkifyRefs('见 service.go:160', paths), '见 service.go:160');
  assert.equal(resolveRefPath('service.go', paths, ['cmd/genz/earn_rule/service.go']), 'cmd/genz/earn_rule/service.go');
  assert.equal(resolveRefPath('nope.go', paths), undefined);
});

test('面板里的回答：引用渲染成可点链接', () => {
  const a: Answer = { id: 'r1', target: { item: 'i3', kind: 'node', node: 'i3-n6' }, q: 'q', a: '固定积分不看金额（fusion.go:168）。', at: '2026-10-12T10:00:00Z', by: 'claude', status: 'done' };
  assert.ok(renderAnswer(a, [FUSION, 'x/a.go']).includes(`data-link="${FUSION}#L168"`));
  assert.ok(!renderAnswer(a, []).includes('data-link'), '没有文件列表时不猜');
});

test('提示词带上之前的问答：同一段完整、同一项其他段节选、别的项不带；还有其他项概览', () => {
  const w = loadWalkthrough(SAMPLE);
  const item = w.items[2];
  const t = { item: 'i3', kind: 'node' as const, node: 'i3-n5' };
  const A = (id: string, target: Answer['target'], at: string, q: string, a: string, status?: Answer['status']): Answer => ({ id, target, q, a, at, by: 'claude', status });
  const answers = [
    A('2', t, '2026-10-12T02:39:00Z', '和第四步一样吗', '对，都是 zeroOutByBase。'.repeat(40)),
    A('1', t, '2026-10-12T02:36:00Z', '检测固定金额的0元吗', '是的'),
    A('3', { item: 'i3', kind: 'why' }, '2026-10-12T02:14:00Z', '计分为0是干嘛的', 'X'.repeat(500)),
    A('4', { item: 'i1', kind: 'why' }, '2026-10-12T02:00:00Z', '别的项的问题', '别的项的回答'),
    A('5', t, '2026-10-12T02:41:00Z', '还在答', '半截', 'running'),
  ];
  const h = historyFor(t, answers);
  assert.deepEqual(h.same.map(a => a.id), ['1', '2'], '同一段按时间排，不含回答中的');
  assert.deepEqual(h.others.map(a => a.id), ['3']);
  const p = buildPrompt(w, item, t, '前面的回复压缩一下', undefined, answers);
  assert.ok(p.includes('对，都是 zeroOutByBase。'.repeat(40)), '同一段的回答要完整');
  assert.ok(p.includes('X'.repeat(300) + '…（后略）') && !p.includes('X'.repeat(301)), '其他段只节选 300 字');
  assert.ok(!p.includes('别的项的回答') && !p.includes('半截'));
  assert.ok(p.indexOf('第 1 轮') < p.indexOf('第 2 轮') && p.indexOf('第 2 轮') < p.indexOf('## 问题'));
  assert.ok(p.includes('## 这份走读的其他项') && p.includes(w.items[0].title) && p.includes(w.items[4].title));
});

test('快速问答提示词：选中行标 ▶，注明 base / head，带上这个框里的前几轮', () => {
  const w = loadWalkthrough(SAMPLE);
  const code = { path: 'a.go', sha: w.meta.anchor.base!, side: 'base' as const, start: 8, end: 12, selStart: 10, selEnd: 11, lines: ['l8', 'l9', 'l10', 'l11', 'l12'] };
  const p = buildQuickPrompt(w, w.items[2], code, [{ q: '上一问', a: '上一答' }], '这两行干嘛的');
  assert.ok(p.includes('▶ 10  l10') && p.includes('▶ 11  l11') && p.includes('   9  l9') && !p.includes('▶ 12'));
  assert.ok(p.includes('改之前，base') && p.includes(w.items[2].why));
  assert.ok(p.indexOf('上一答') < p.indexOf('## 问题') && p.endsWith('这两行干嘛的'));
  assert.ok(buildQuickPrompt(w, undefined, { ...code, side: 'head' }, [], 'q').includes('改之后，head'));
});

test('评论框里的代码引用改成命令链接，带上所在那一行当说明；外链不动', () => {
  const out = commandLinks('结论一句。\n- **小问题**：固定积分不看金额，见 [fusion.go:168](internal/x/fusion.go#L168)。\n见 [PR](https://github.com/a/b/pull/1)');
  const m = out.match(/\(command:walkthrough\.openRef\?([^)]+)\)/)!;
  assert.deepEqual(JSON.parse(decodeURIComponent(m[1])), ['internal/x/fusion.go#L168', '小问题：固定积分不看金额，见 fusion.go:168。', 'fusion.go:168']);
  assert.ok(out.includes('[PR](https://github.com/a/b/pull/1)'));
});

test('改动区里不再有「问问题」，但以前在修改说明上问过的照样显示', () => {
  const w = loadWalkthrough(SAMPLE);
  const refs = flatten(w);
  const ref = refs.find(r => r.node.id === 'i3-n4')!;
  const old: Answer = { id: 'n1', target: { item: 'i3', kind: 'note', node: 'i3-n4', line: 52 }, q: '抽出公共函数吗', a: '是', at: '2026-10-12T02:33:00Z', by: 'claude' };
  const html = renderItem(w, refs, ref, [{ kind: 'modified', line: 52, text: 'x', old: 'y' }], 'N', '', [old]);
  const diff = html.slice(html.indexOf('<div class="diff">'), html.indexOf('</div></div>', html.indexOf('<div class="diff">')));
  assert.ok(!diff.includes('class="ask"'), '改动区里不该有按钮');
  assert.ok(html.includes('data-aid="n1"'), '旧回答还在');
});

test('面包屑：没跳过不显示；最后一段是当前位置不可点；← 指向上一处', () => {
  assert.equal(renderTrail('第 5 步 命中多条规则', []), '');
  const h = renderTrail('第 5 步 命中多条规则', [{ label: 'fusion.go:168' }, { label: 'sink.go:290' }]);
  assert.ok(h.includes('data-trail="-1">第 5 步 命中多条规则</a>'));
  assert.ok(h.includes('data-trail="0">fusion.go:168</a>'));
  assert.ok(h.includes('<span class="tseg cur">sink.go:290</span>'));
  assert.ok(h.startsWith('<span class="tback" data-trail="0"'), '← 回到倒数第二段');
  assert.ok(renderTrail('步', [{ label: '<x>' }]).includes('&lt;x&gt;') && renderTrail('步', [{ label: 'a' }]).includes('data-trail="-1" title'));
});

test('问答模型：「厂商-模型」写法；claude 加 --model 且替换已有的；codex 用 -m；旧值兼容；非 claude 自定义命令不乱插', () => {
  const C = ['/usr/bin/claude', '-p', '--output-format', 'stream-json', '--append-system-prompt', '{system}'];
  assert.deepEqual(askCommandFor(C, 'claude-stream-json', ''), { command: C, format: 'claude-stream-json', by: 'claude' });
  assert.deepEqual(askCommandFor(C, 'claude-stream-json', 'claude-opus'), { command: ['/usr/bin/claude', '--model', 'opus', ...C.slice(1)], format: 'claude-stream-json', by: 'claude-opus' });
  assert.deepEqual(askCommandFor(['claude', '--model', 'haiku', '-p'], 'claude-stream-json', 'claude-sonnet').command, ['claude', '--model', 'sonnet', '-p'], '不能出现两个 --model');
  assert.deepEqual(askCommandFor(C, 'claude-stream-json', 'codex-gpt-5.6-sol'), { command: ['codex', 'exec', '-s', 'read-only', '--skip-git-repo-check', '-m', 'gpt-5.6-sol', '-'], format: 'text', by: 'codex-gpt-5.6-sol' });
  assert.deepEqual(askCommandFor(C, 'claude-stream-json', 'codex').command, ['codex', 'exec', '-s', 'read-only', '--skip-git-repo-check', '-'], 'codex 不带模型 = 用它自己的默认');
  assert.equal(askCommandFor(C, 'claude-stream-json', 'opus').by, 'claude-opus', '旧值 opus 兼容成 claude-opus');
  assert.deepEqual(askCommandFor(['my-llm', '-x'], 'text', 'claude-opus').command, ['my-llm', '-x']);
});

test('下拉选项：Claude、多个 Codex 模型、本机配置模型和自定义 Agent', () => {
  const labels = askModelOptions('approval = "x"\nmodel = "gpt-local"\n', { pi: { label: 'Pi Agent', command: ['pi', '--print'] } }).map(o => o.label);
  assert.deepEqual(labels.slice(0, 6), ['默认', 'claude-fable', 'claude-opus', 'claude-sonnet', 'claude-haiku', 'codex-默认']);
  assert.ok(labels.includes('codex-gpt-local') && labels.includes('codex-gpt-6.1-sol') && labels.includes('codex-gpt-6-astra'));
  assert.equal(labels.at(-1), '自定义 · Pi Agent');
});

test('统一模型：自定义本地 Agent 的命令、格式和名称用于全部 AI 操作', () => {
  const custom = { pi: { label: 'Pi Agent', command: ['pi', '--print'], format: 'text' as const } };
  assert.deepEqual(modelCommandFor(['claude'], 'claude-stream-json', 'custom:pi', custom), { command: ['pi', '--print'], format: 'text', by: 'Pi Agent' });
  assert.throws(() => modelCommandFor(['claude'], 'claude-stream-json', 'custom:missing', custom), /找不到自定义模型/);
});

test('命令里没有 {system} 占位符（如 codex）：系统提示拼进 stdin', async () => {
  const run = runAsk([process.execPath, '-e', 'let i="";process.stdin.on("data",d=>i+=d).on("end",()=>process.stdout.write(i))'], 'text', os.tmpdir(), '规矩', '问题', () => {});
  assert.equal(await run.done, '规矩\n\n---\n\n问题');
  const run2 = runAsk([process.execPath, '-e', 'let i="";process.stdin.on("data",d=>i+=d).on("end",()=>process.stdout.write(i))', '{system}'], 'text', os.tmpdir(), '规矩', '问题', () => {});
  assert.equal(await run2.done, '问题', '有占位符时走参数，不重复拼');
});
