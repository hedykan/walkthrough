// 右侧面板：一项一页。修改原因 → 改的核心思想 → 场景 → 以前 / 现在 → 核心链条（当前步展开本步改动）。
// 配色只有三种：重点（--key）、注意（--warn）、不重要（--dim）。
import { NodeRef, Walkthrough, findingsForItem } from './model';
import { esc, renderMd as md } from './markdown';
import { Answer, AskTarget, linkifyRefs, targetKey } from './ask';

/** 聚焦：在说明段时是段名，在链条某一步时是 node */
export type Focus = 'why' | 'idea' | 'scene' | 'node';
export const SECTIONS: Focus[] = ['why', 'idea', 'scene'];

/** 下一步 / 上一步怎么走：先在说明段之间走，再进链条；返回「只换焦点」或「跳几步 + 焦点（不填 = 进新项从修改原因开始）」 */
export type Move = { focus: Focus } | { jump: 1 | -1; focus?: Focus };
export function navigate(focus: Focus, nodeIndex: number, dir: 1 | -1): Move {
  const k = SECTIONS.indexOf(focus);
  if (dir === 1) return k >= 0 ? { focus: k < SECTIONS.length - 1 ? SECTIONS[k + 1] : 'node' } : { jump: 1 };
  if (k > 0) return { focus: SECTIONS[k - 1] };
  if (k === 0) return { jump: -1, focus: 'node' };           // 上一项的最后一步
  return nodeIndex === 0 ? { focus: 'scene' } : { jump: -1, focus: 'node' };
}

export type PanelMsg = { type: 'next' } | { type: 'prev' } | { type: 'node'; flat: number } | { type: 'focus'; f: Focus }
  | { type: 'trail'; k: number }
  | { type: 'ask'; target: AskTarget; q: string }
  /** 点链接：peek = 按住了 Alt，就地预览不跳走；why = 回答里引用所在的那句话（正文链接为空） */
  | { type: 'ref'; target: string; why: string; label: string; peek: boolean };

/** 当前步范围内的改动行，文本已经从快照里取好 */
export type ShownRow =
  | { kind: 'added'; line: number; text: string }
  | { kind: 'modified'; line: number; text: string; old: string }
  | { kind: 'deleted'; after: number; text: string[] };

/** 一条回答；也用于流式更新时整块替换 */
/** paths：head 的文件列表，用来把裸写的「文件:行号」变成链接；prefer：这一项链条里的文件，同名时优先 */
export function renderAnswer(a: Answer, paths: string[] = [], prefer: string[] = []): string {
  const state = a.status === 'running' ? `<div class="qprog">${esc(a.progress || '思考中…')}</div>` : a.status === 'error' ? `<div class="qerr">出错了：${esc(a.a)}</div>` : '';
  const body = a.status === 'error' ? '' : md(linkifyRefs(a.a, paths, prefer));
  // 渲染出来一律收起：只有刚发出的那条，在面板里第一次出现时由脚本展开（见 message 处理）
  const meta = a.status === 'running' ? '回答中…' : a.status === 'error' ? '出错' : `${esc(a.by)} · ${esc(a.at.slice(0, 16).replace('T', ' '))}`;
  return `<details class="qa-one ${a.status ?? 'done'}" data-aid="${esc(a.id)}">
    <summary class="q"><span class="qmark">问</span>${esc(a.q)}<span class="qmeta">${meta}</span></summary>
    ${state}<div class="a">${body}</div></details>`;
}

function askBtn(t: AskTarget): string {
  return `<button class="ask" title="就这一段提问" data-key="${esc(targetKey(t))}" data-ask="${esc(JSON.stringify(t))}">问问题</button>`;
}

function qaBox(t: AskTarget, answers: Answer[], paths: string[] = [], prefer: string[] = []): string {
  const key = targetKey(t);
  return `<div class="qa" data-key="${esc(key)}">${answers.filter(a => targetKey(a.target) === key).map(a => renderAnswer(a, paths, prefer)).join('')}</div>`;
}

/** 面包屑：当前步 › 引用 › 引用…；点哪段回哪段，-1 = 回到当前步 */
export function renderTrail(step: string, trail: { label: string }[]): string {
  if (!trail.length) return '';
  const seg = (k: number, text: string, last: boolean) => last
    ? `<span class="tseg cur">${esc(text)}</span>`
    : `<a href="#" class="tseg" data-trail="${k}">${esc(text)}</a>`;
  return `<span class="tback" data-trail="${trail.length - 2}" title="回到上一处（Alt+←）">←</span>`
    + [seg(-1, step, false), ...trail.map((t, i) => seg(i, t.label, i === trail.length - 1))].join('<span class="tsep">›</span>');
}

const VERDICT = { confirmed: '属实', refuted: '不属实', partial: '部分属实', unverified: '未核实' } as const;

function diffBlock(rows: ShownRow[] | undefined, notes: { line: number; text: string }[], noteTarget: (line: number) => AskTarget, box: (t: AskTarget) => string): string {
  if (!rows) return '';
  if (!rows.length) return `<div class="nodiff">本步没有改动，只是经过</div>`;
  const line = (cls: string, no: string, sign: string, text: string) =>
    `<div class="dl ${cls}"><span class="no">${no}</span><span class="sg">${sign}</span><code>${esc(text) || ' '}</code></div>`;
  const byLine = new Map(notes.map(n => [n.line, n.text]));
  const noteOf = (n: number) => byLine.has(n)
    ? `<div class="dnote">◀ ${md(byLine.get(n))}${box(noteTarget(n))}</div>` : '';
  const body = `<div class="diff">${rows.map(r => {
    if (r.kind === 'added') return line('add', String(r.line), '+', r.text) + noteOf(r.line);
    if (r.kind === 'modified') return line('del', '', '−', r.old) + line('add', String(r.line), '+', r.text) + noteOf(r.line);
    return r.text.map(t => line('del', '', '−', t)).join('');
  }).join('')}</div>`;
  // 默认收起：代码在左边编辑器里已经看得到，这里只在想对着说明逐行看时再点开
  const add = rows.filter(r => r.kind === 'added').length, mod = rows.filter(r => r.kind === 'modified').length;
  const del = rows.reduce((n, r) => n + (r.kind === 'deleted' ? r.text.length : 0), 0);
  const stat = [add && `+${add}`, mod && `~${mod}`, del && `−${del}`].filter(Boolean).join(' ');
  const shown = notes.filter(n => rows.some(r => r.kind !== 'deleted' && r.line === n.line)).length;
  return `<details class="dwrap"><summary>本步改动 <span class="dstat">${stat}${shown ? ` · ${shown} 条说明` : ''}</span></summary>${body}</details>`;
}

export function renderItem(w: Walkthrough, refs: NodeRef[], cur: NodeRef, rows: ShownRow[] | undefined, nonce: string, csp: string, answers: Answer[] = [], paths: string[] = [], trail = '', focus: Focus = 'node'): string {
  const { item } = cur;
  const prefer = item.chain.map(n => n.anchor.path);
  const Q = (t: AskTarget) => qaBox(t, answers, paths, prefer);
  const T = (kind: AskTarget['kind'], node?: string, line?: number): AskTarget => ({ item: item.id, kind, ...(node ? { node } : {}), ...(line ? { line } : {}) });
  const mine = refs.filter(r => r.itemIndex === cur.itemIndex);
  const findings = findingsForItem(w, item.id);

  const chain = mine.map(r => {
    const n = r.node, on = r.flat === cur.flat;
    const st = n.diff ? [n.diff.added && `+${n.diff.added}`, n.diff.modified && `~${n.diff.modified}`, n.diff.deleted && `−${n.diff.deleted}`].filter(Boolean).join(' ') : '';
    return `
    <li class="node ${n.changed ? 'changed' : 'pass'} ${on ? 'current' : ''} ${n.core ? 'core' : ''}" data-flat="${r.flat}">
      <div class="head">
        <span class="num">${r.nodeIndex + 1}</span>
        <span class="dot">${n.changed ? '●' : '○'}</span>
        <span class="step">${esc(n.step)}</span>
        <code class="sym">${esc(n.symbol)}</code>
        ${n.core ? '<span class="star">★ 核心</span>' : ''}
        ${st ? `<span class="st">${st}</span>` : ''}
      </div>
      <div class="where">${esc(n.anchor.path.split('/').pop()!)}:${n.anchor.line}</div>
      <div class="text">${md(n.text)}</div>
      ${n.was ? `<div class="was"><b>以前：</b>${md(n.was)}</div>` : ''}
      ${on ? diffBlock(rows, n.notes ?? [], l => T('note', n.id, l), Q) : ''}
      ${Q(T('node', n.id))}
      ${askBtn(T('node', n.id))}
    </li>`;
  }).join('');

  return `<!doctype html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<style nonce="${nonce}">${CSS}</style></head><body>
<div class="top">
<nav class="bar">
  <button id="prev">← 上一步</button>
  <span class="pos" id="pos"></span>
  <button id="next">下一步 →</button>
</nav>
<div id="trail" class="trail">${trail}</div>
</div>
<h1>${esc(item.title)}</h1>
<section class="why blk" data-f="why"><h2>修改原因</h2>${md(item.why)}${Q(T('why'))}${askBtn(T('why'))}</section>
<section class="idea blk" data-f="idea"><h2>改的核心思想</h2>${md(item.idea)}${Q(T('idea'))}${askBtn(T('idea'))}</section>
<div class="scene blk" data-f="scene">
<section><h2>场景</h2>${md(item.scenario)}</section>
<div class="cmp">
  <section class="before"><h2>以前</h2>${md(item.before)}</section>
  <section class="after"><h2>现在</h2>${md(item.after)}</section>
</div>
${Q(T('scenario'))}${askBtn(T('scenario'))}
</div>
<section class="blk" data-f="chain"><h2>核心链条 <span class="legend">● 本次改了　○ 只是经过　点一步跳到代码</span></h2>
  <ol class="chain">${chain}</ol>
</section>
${item.side ? `<section class="side blk" data-f="side">${md(item.side)}</section>` : ''}
${findings.length ? `<details class="findings blk" data-f="findings"><summary>审查发现（${findings.length}）</summary>${findings.map(f => `
  <div class="finding v-${f.verdict}"><div class="ftitle"><span class="badge">${VERDICT[f.verdict]}</span>${f.source === 'pr' ? 'PR 自述' : '审查发现'}：${md(f.claim)}</div>${md(f.evidence)}</div>`).join('')}
</details>` : ''}
<script nonce="${nonce}">
  const vscode = acquireVsCodeApi();
  // ---- 聚焦：只记「走到哪了」，决定滚到哪、下一步从哪接着走；不改明暗 ----
  const POS = { item: '第 ${cur.itemIndex + 1}/${w.items.length} 项', step: ${cur.nodeIndex + 1}, steps: ${mine.length}, first: ${cur.flat === 0}, last: ${cur.flat === refs.length - 1} };
  const LABEL = { why: '修改原因', idea: '核心思想', scene: '场景' };
  let F = ${JSON.stringify(focus)};
  function applyFocus(f, scroll, behavior = 'smooth') {
    F = f;
    document.getElementById('pos').textContent = POS.item + ' · ' + (f === 'node' ? '第 ' + POS.step + '/' + POS.steps + ' 步' : LABEL[f]);
    document.getElementById('prev').disabled = POS.first && f === 'why';
    document.getElementById('next').disabled = POS.last && f === 'node';
    if (!scroll) return;
    // 修改原因停在顶部（连着标题看）；其余聚焦块滚到正中
    if (f === 'why') window.scrollTo({ top: 0, behavior });
    else (f === 'node' ? document.querySelector('li.node.current') : document.querySelector('.blk[data-f="' + f + '"]'))?.scrollIntoView({ block: 'center', behavior });
  }
  /** 点一块：把位置切过去，下一步从这里接着走 */
  function focusTo(f) {
    if (f === F) return;
    applyFocus(f, false);
    vscode.postMessage({ type: 'focus', f });
  }
  document.getElementById('prev').onclick = () => vscode.postMessage({ type: 'prev' });
  document.getElementById('next').onclick = () => vscode.postMessage({ type: 'next' });
  document.addEventListener('click', e => {
    const ask = e.target.closest('button.ask');
    if (ask) { openForm(ask); return; }
    const a = e.target.closest('a');
    const tr = e.target.closest('[data-trail]');
    if (tr) { e.preventDefault(); vscode.postMessage({ type: 'trail', k: +tr.dataset.trail }); return; }
    if (a && a.dataset.link) {
      // 回答里的引用把所在那句话一起带过去，挂在代码旁边当说明；按住 Alt = 就地预览
      e.preventDefault();
      const why = a.closest('.a') ? (a.closest('li, p') || a).innerText.trim() : '';
      vscode.postMessage({ type: 'ref', target: a.dataset.link, why, label: a.innerText.trim(), peek: !!e.altKey });
      return;
    }
    if (e.target.closest('.qa')) return;   // 问答区里的其他点击（展开、打字）不触发跳步；链接已在上面处理
    if (window.getSelection && String(window.getSelection()).length) return;   // 在选文字，不算点击
    const li = e.target.closest('li.node');
    if (li && !li.classList.contains('current')) { vscode.postMessage({ type: 'node', flat: +li.dataset.flat }); return; }
    if (li) { focusTo('node'); return; }
    const blk = e.target.closest('.blk');
    if (blk && ['why', 'idea', 'scene'].includes(blk.dataset.f)) focusTo(blk.dataset.f);
  });
  // 刚进入一项（聚焦修改原因）从标题开始看；聚焦到链条某一步时把它滚到正中。
  // 整页刚渲染时还没排好版，这时滚动（尤其是平滑滚动）会被浏览器忽略：先只改样式，等加载完再等一帧，瞬间定位过去
  applyFocus(F, false);
  if (F !== 'why') window.addEventListener('load', () => requestAnimationFrame(() => applyFocus(F, true, 'auto')), { once: true });
  const boxOf = key => [...document.querySelectorAll('.qa')].find(b => b.dataset.key === key);
  // 就地提问：输入框出现在这一段的问答区里。回车发送，Shift+回车换行，Esc 取消；输入法选字时的回车不算
  function openForm(btn) {
    const box = boxOf(btn.dataset.key);
    if (!box) return;
    let form = box.querySelector('form.askf');
    if (!form) {
      form = document.createElement('form');
      form.className = 'askf';
      form.innerHTML = '<textarea rows="2" placeholder="就这一段提问…  回车发送 · Shift+回车换行 · Esc 取消"></textarea>'
        + '<div class="askbar"><button type="button" class="cancel">取消</button><button type="submit">发送</button></div>';
      const ta = form.querySelector('textarea');
      const close = () => form.remove();
      form.onsubmit = ev => {
        ev.preventDefault();
        const q = ta.value.trim();
        if (!q) return;
        vscode.postMessage({ type: 'ask', target: JSON.parse(btn.dataset.ask), q });
        close();
      };
      form.querySelector('.cancel').onclick = close;
      ta.addEventListener('keydown', ev => {
        if (ev.key === 'Escape') { ev.preventDefault(); close(); }
        else if (ev.key === 'Enter' && !ev.shiftKey && !ev.isComposing && ev.keyCode !== 229) { ev.preventDefault(); form.requestSubmit(); }
      });
      ta.addEventListener('input', () => { ta.style.height = 'auto'; ta.style.height = ta.scrollHeight + 'px'; });
      box.appendChild(form);
    }
    form.scrollIntoView({ block: 'nearest' });
    form.querySelector('textarea').focus();
  }
  window.addEventListener('message', ({ data }) => {
    if (data.type === 'focus') { applyFocus(data.f, true); return; }
    if (data.type === 'trail') { document.getElementById('trail').innerHTML = data.html; return; }
    if (data.type !== 'answer') return;
    const box = boxOf(data.key);
    if (!box) return;
    const old = [...box.children].find(c => c.dataset.aid === data.id);
    const tpl = document.createElement('template'); tpl.innerHTML = data.html.trim();
    const el = tpl.content.firstElementChild;
    if (old) { el.open = old.open; old.replaceWith(el); }   // 流式更新时保留人手动收起 / 展开的状态
    else { el.open = true; box.insertBefore(el, box.querySelector('form.askf')); el.scrollIntoView({ block: 'nearest' }); }   // 刚发出的这条展开看着它答
  });
</script></body></html>`;
}

const CSS = `
:root {
  --key: var(--vscode-textLink-foreground);
  --warn: var(--vscode-editorWarning-foreground);
  --dim: var(--vscode-descriptionForeground);
  --line: var(--vscode-panel-border);
  --key-bg: color-mix(in srgb, var(--key) 9%, transparent);
  --warn-bg: color-mix(in srgb, var(--warn) 8%, transparent);
}
body { font-family: var(--vscode-font-family); font-size: 14px; line-height: 1.7; color: var(--vscode-foreground); padding: 0 18px 40px; }
.top { position: sticky; top: 0; z-index: 1; background: var(--vscode-editor-background); }
.bar { display: flex; gap: 10px; align-items: center; padding: 10px 0; background: var(--vscode-editor-background); border-bottom: 1px solid var(--line); z-index: 1; }
.trail:empty { display: none; }
.trail { padding: 4px 0 6px; font-size: 12.5px; background: var(--vscode-editor-background); border-bottom: 1px solid var(--line); white-space: nowrap; overflow-x: auto; }
.tseg { color: var(--dim); } a.tseg:hover { color: var(--key); }
.tseg.cur { color: var(--key); font-weight: 600; }
.tsep { color: var(--dim); margin: 0 6px; }
.tback { cursor: pointer; color: var(--key); font-weight: 700; margin-right: 8px; padding: 0 4px; border: 1px solid var(--key); border-radius: 3px; }
.bar .pos { flex: 1; text-align: center; color: var(--dim); font-size: 13px; }
button { background: var(--vscode-button-background); color: var(--vscode-button-foreground); border: 0; padding: 5px 12px; border-radius: 3px; cursor: pointer; font-size: 13px; }
button:disabled { opacity: .35; cursor: default; }
h1 { font-size: 20px; margin: 20px 0 18px; line-height: 1.4; }
h2 { font-size: 13px; margin: 0 0 6px; color: var(--dim); font-weight: 600; letter-spacing: .5px; }
section { margin: 26px 0; }
section p { margin: 4px 0; }
strong { color: var(--key); font-weight: 600; }
a { color: var(--key); text-decoration: none; } a:hover { text-decoration: underline; }
code { font-family: var(--vscode-editor-font-family); background: var(--vscode-textCodeBlock-background); padding: 0 4px; border-radius: 3px; font-size: 12.5px; }

/* 注意：修改原因 */
.why { padding: 12px 14px; border-left: 3px solid var(--warn); background: var(--warn-bg); font-size: 14.5px; }
.why h2 { color: var(--warn); }
/* 重点：核心思想 */
.idea { padding: 12px 14px; border-left: 3px solid var(--key); background: var(--key-bg); font-size: 14.5px; }
.idea h2 { color: var(--key); }
/* 以前 / 现在：中性，靠标题区分 */
.cmp { display: flex; flex-direction: column; gap: 14px; }
.cmp section { margin: 0; padding: 12px 14px; border: 1px solid var(--line); border-radius: 4px; }
.scene { margin: 26px 0; }
.scene > section { margin: 0 0 14px; }
.legend { font-weight: 400; font-size: 12px; margin-left: 8px; letter-spacing: 0; }

/* 链条：★ 核心 = 重点，● 改了 = 注意，○ 经过 = 不重要 */
ol.chain { list-style: none; padding: 0; margin: 10px 0 0; position: relative; }
ol.chain::before { content: ''; position: absolute; left: 11px; top: 12px; bottom: 12px; width: 2px; background: var(--line); }
li.node { position: relative; padding: 10px 12px 10px 34px; margin: 8px 0; border-radius: 4px; cursor: pointer; }
li.node:hover { background: var(--vscode-list-hoverBackground); }
li.node.current { background: var(--vscode-list-inactiveSelectionBackground); outline: 1px solid var(--key); cursor: default; }
li.node.pass { color: var(--dim); }
li.node.pass.current { color: var(--vscode-foreground); }
.num { position: absolute; left: 2px; top: 11px; width: 20px; height: 20px; border-radius: 50%; font-size: 11px; text-align: center; line-height: 20px; background: var(--vscode-editor-background); border: 2px solid var(--line); }
li.changed .num { border-color: var(--warn); }
li.core .num { border-color: var(--key); background: var(--key); color: var(--vscode-editor-background); font-weight: 700; }
.head { display: flex; gap: 6px; align-items: baseline; flex-wrap: wrap; }
.dot { font-size: 11px; } li.changed .dot { color: var(--warn); }
.step { font-weight: 600; }
.sym { font-size: 12px; color: var(--dim); }
.star { font-size: 11px; color: var(--key); font-weight: 700; }
.st { font-family: var(--vscode-editor-font-family); font-size: 11.5px; color: var(--dim); margin-left: auto; }
.where { font-family: var(--vscode-editor-font-family); font-size: 11.5px; color: var(--dim); }
.text p, .was p { margin: 2px 0; }
.was { font-size: 13px; padding-left: 8px; border-left: 2px solid var(--warn); margin-top: 4px; }
.was b { color: var(--warn); font-weight: 600; }

/* 本步改动：新增 = 重点，删除 = 不重要（删除线），说明 = 重点 */
.diff { margin-top: 8px; border: 1px solid var(--line); border-radius: 3px; overflow-x: auto; font-family: var(--vscode-editor-font-family); font-size: 12px; line-height: 1.5; }
.dl { display: flex; white-space: pre; }
.dl .no { width: 40px; text-align: right; padding-right: 6px; color: var(--dim); flex: none; }
.dl .sg { width: 14px; flex: none; }
.dl code { background: none; padding: 0; font-size: 12px; }
.dl.add { background: var(--key-bg); } .dl.add .sg { color: var(--key); font-weight: 700; }
.dl.del { color: var(--dim); } .dl.del code { text-decoration: line-through; }
.dnote { font-family: var(--vscode-font-family); font-size: 12.5px; padding: 3px 10px 4px 60px; color: var(--key); border-bottom: 1px solid var(--line); white-space: normal; }
.dnote p { margin: 0; display: inline; }
.dwrap { margin-top: 6px; }
.dwrap > summary { cursor: pointer; font-size: 12.5px; color: var(--dim); list-style: none; user-select: none; }
.dwrap > summary::-webkit-details-marker { display: none; }
.dwrap > summary::before { content: '▸'; display: inline-block; width: 12px; }
.dwrap[open] > summary::before { content: '▾'; }
.dwrap > summary:hover { color: var(--key); }
.dstat { font-family: var(--vscode-editor-font-family); font-size: 11.5px; }
.nodiff { margin-top: 6px; font-size: 12.5px; color: var(--dim); }

/* 提问：按钮平时淡、悬停才明显；回答用中性底，问题前缀用重点色 */
button.ask { display: block; width: 100%; box-sizing: border-box; margin-top: 12px; padding: 3px 0; font-size: 12px; line-height: 18px;
  background: transparent; color: var(--dim); border: 1px dashed var(--line); border-radius: 4px; }
button.ask:hover, button.ask:focus { color: var(--key); border-color: var(--key); border-style: solid; }
.qa:empty { display: none; }
.qa:not(:empty) { margin-top: 6px; }
.qa { margin-top: 10px; clear: both; }
.qa-one { margin: 6px 0; padding: 4px 10px; border: 1px solid var(--line); border-radius: 4px; background: var(--vscode-editor-background); color: var(--vscode-foreground); font-size: 13px; }
.qa-one[open] { padding-bottom: 8px; }
summary.q { font-weight: 600; cursor: pointer; list-style: none; }
summary.q::-webkit-details-marker { display: none; }
summary.q::before { content: '▸'; display: inline-block; width: 12px; color: var(--dim); }
.qa-one[open] > summary.q::before { content: '▾'; }
.qmark { color: var(--key); margin-right: 6px; }
form.askf { margin: 6px 0; }
form.askf textarea { width: 100%; box-sizing: border-box; resize: none; font-family: var(--vscode-font-family); font-size: 13px; line-height: 1.5; padding: 6px 8px;
  color: var(--vscode-input-foreground); background: var(--vscode-input-background); border: 1px solid var(--key); border-radius: 4px; outline: none; }
.askbar { display: flex; justify-content: flex-end; gap: 6px; margin-top: 4px; }
.askbar button { padding: 2px 10px; font-size: 12px; }
.askbar .cancel { background: transparent; color: var(--dim); border: 1px solid var(--line); }
.qmeta { float: right; font-weight: 400; font-size: 11px; color: var(--dim); }
.qprog { color: var(--dim); font-size: 12px; font-style: italic; }
.qerr { color: var(--warn); font-size: 12.5px; }
.qa-one.error .qmeta { color: var(--warn); }
.a p { margin: 4px 0; } .a ul, .a ol { margin: 4px 0; padding-left: 20px; }
.a pre { background: var(--vscode-textCodeBlock-background); padding: 6px 8px; border-radius: 3px; overflow-x: auto; font-size: 12px; }
.a pre code { background: none; padding: 0; }
.a h3, .a h4, .a h5, .a h6 { font-size: 13px; margin: 8px 0 2px; }

/* 不重要：旁注 */
.side { font-size: 13px; color: var(--dim); padding: 10px 14px; border: 1px dashed var(--line); border-radius: 4px; }
.side strong { color: var(--warn); }

/* 审查发现：不属实 / 部分属实 = 注意，其余 = 不重要 */
details.findings { margin-top: 30px; } details.findings summary { cursor: pointer; font-weight: 600; color: var(--dim); }
.finding { padding: 10px 12px; margin: 12px 0; border-radius: 3px; border: 1px solid var(--line); font-size: 13px; }
.badge { font-size: 11px; padding: 0 6px; border-radius: 8px; margin-right: 6px; border: 1px solid var(--dim); color: var(--dim); }
.v-refuted, .v-partial { border-color: var(--warn); }
.v-refuted .badge, .v-partial .badge { border-color: var(--warn); color: var(--warn); }
`;
