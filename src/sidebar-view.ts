// 左侧视图的页面：HTML + 样式 + 脚本。不依赖 vscode，测试里用 jsdom 真跑。

export function sidebarHtml(nonce: string, csp: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${csp}">
<style nonce="${nonce}">${CSS}</style></head><body>
<div id="app"></div>
<script nonce="${nonce}">${SCRIPT}</script></body></html>`;
}

const CSS = `
:root { --key: var(--vscode-textLink-foreground); --warn: var(--vscode-editorWarning-foreground); --dim: var(--vscode-descriptionForeground); --line: var(--vscode-panel-border);
  --key-bg: color-mix(in srgb, var(--key) 12%, transparent); }
body { font-family: var(--vscode-font-family); font-size: 13px; color: var(--vscode-foreground); padding: 6px 10px 20px; margin: 0; }
.row { display: flex; align-items: center; gap: 6px; margin: 4px 0; }
.row label { width: 32px; flex: none; color: var(--dim); font-size: 12px; }
select, input[type=text] { flex: 1; min-width: 0; font: inherit; font-size: 12.5px; color: var(--vscode-input-foreground); background: var(--vscode-input-background); border: 1px solid var(--vscode-input-border, var(--line)); border-radius: 3px; padding: 2px 4px; }
.row.dir .dpath { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-family: var(--vscode-editor-font-family); font-size: 12px; color: var(--dim); }
.row.dir a { flex: none; font-size: 12px; color: var(--key); cursor: pointer; }
.dirask { font-size: 12px; color: var(--warn); border: 1px solid var(--warn); border-radius: 3px; padding: 6px 8px; margin: 4px 0 8px; }
.dirask b { font-family: var(--vscode-editor-font-family); font-weight: 600; } .dirask .btns { margin-top: 6px; }
.combo { flex: 1; min-width: 0; position: relative; display: flex; } .combo input { flex: 1; }
.blist { position: absolute; top: 100%; left: 0; right: -32px; z-index: 5; max-height: 280px; overflow-y: auto; margin-top: 2px;
  background: var(--vscode-dropdown-background, var(--vscode-input-background)); border: 1px solid var(--key); border-radius: 3px; box-shadow: 0 4px 12px rgba(0,0,0,.25); }
.blist .b { display: flex; gap: 6px; padding: 3px 8px; cursor: pointer; white-space: nowrap; }
.blist .b.on { background: var(--vscode-list-activeSelectionBackground); color: var(--vscode-list-activeSelectionForeground); }
.blist .b.cur .bn { color: var(--key); font-weight: 600; } .blist .b.on.cur .bn { color: inherit; }
.blist .bn { flex: 1; overflow: hidden; text-overflow: ellipsis; } .blist .bt { flex: none; color: var(--dim); font-size: 11px; }
.blist .b.on .bt { color: inherit; opacity: .8; }
.bmore { padding: 4px 8px; color: var(--dim); font-size: 11.5px; }
button.icon { flex: none; padding: 1px 7px; background: transparent; color: var(--key); border: 1px solid var(--line); }
.model-add { width: 26px; height: 24px; display: grid; place-items: center; padding: 0!important; font-size: 16px!important; }
.fork { color: var(--dim); font-size: 11.5px; font-family: var(--vscode-editor-font-family); white-space: nowrap; }
h3 { font-size: 11px; font-weight: 600; letter-spacing: .5px; color: var(--dim); margin: 12px 0 4px; display: flex; justify-content: space-between; align-items: center; }
h3 a { font-weight: 400; letter-spacing: 0; cursor: pointer; color: var(--key); }
.log { border: 1px solid var(--line); border-radius: 3px; max-height: 260px; overflow-y: auto; }
.c { display: flex; gap: 6px; align-items: baseline; padding: 2px 6px 2px 4px; cursor: pointer; user-select: none; white-space: nowrap; }
.c:hover { background: var(--vscode-list-hoverBackground); }
.c .g { width: 12px; flex: none; text-align: center; color: var(--dim); font-size: 11px; }
.c.in { background: var(--key-bg); } .c.in .g { color: var(--key); }
.c.head .g, .c.base .g { color: var(--key); font-weight: 700; }
.c .sha { font-family: var(--vscode-editor-font-family); font-size: 11.5px; color: var(--dim); flex: none; }
.c .sub { flex: 1; overflow: hidden; text-overflow: ellipsis; }
.c .ago { color: var(--dim); font-size: 11px; flex: none; }
.c .wt { flex: none; }
.c.forkrow .sub { color: var(--dim); font-style: italic; }
.hint { color: var(--dim); font-size: 11px; margin: 3px 0 0; }
.sum { font-size: 12px; margin: 6px 0; } .sum b { font-family: var(--vscode-editor-font-family); font-weight: 600; }
button { font: inherit; font-size: 12.5px; padding: 4px 10px; border: 0; border-radius: 3px; cursor: pointer; background: var(--vscode-button-background); color: var(--vscode-button-foreground); }
button.sec { background: transparent; color: var(--key); border: 1px solid var(--key); }
button:disabled { opacity: .4; cursor: default; }
.btns { display: flex; gap: 6px; flex-wrap: wrap; }
.err { color: var(--warn); font-size: 12px; margin: 6px 0; white-space: pre-wrap; }
.items { list-style: none; margin: 0; padding: 0; }
.items li { padding: 4px 6px; border-radius: 3px; cursor: pointer; display: flex; gap: 6px; align-items: baseline; }
.items li:hover { background: var(--vscode-list-hoverBackground); }
.items li.cur { background: var(--vscode-list-inactiveSelectionBackground); outline: 1px solid var(--key); }
.items .n { color: var(--dim); flex: none; width: 16px; } .items li.cur .n { color: var(--key); font-weight: 700; }
.items .t { flex: 1; }
.c.workrow .sub { font-style: italic; } .c.workrow .g { color: var(--warn); }
.snap { max-height: 220px; overflow-y: auto; border: 1px solid var(--line); border-radius: 3px; margin-bottom: 8px; }
.snap li { cursor: default; padding: 1px 6px; font-family: var(--vscode-editor-font-family); font-size: 11.5px; }
.snap .fs { flex: none; width: 16px; color: var(--warn); }
.hist .t { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
.hist .hd { flex: none; color: var(--dim); font-size: 11px; font-family: var(--vscode-editor-font-family); }
.hist .hk { flex: none; color: var(--dim); font-size: 11px; font-family: var(--vscode-editor-font-family); }
.hist li.cur .m { color: var(--key); }
.hist .x { flex: none; width: 16px; text-align: center; color: var(--dim); opacity: 0; border-radius: 3px; cursor: pointer; }
.hist li:hover .x { opacity: .7; } .hist .x:hover { opacity: 1; color: var(--warn); background: var(--vscode-toolbar-hoverBackground); } .items .m { color: var(--dim); font-size: 11px; flex: none; }
.plan li { cursor: default; align-items: center; } .plan input[type=text] { flex: 1; }
.plan .why { display: block; color: var(--dim); font-size: 11.5px; margin: 0 0 4px 22px; }
.prog .st { flex: none; width: 14px; } .prog .st.ok { color: var(--key); } .prog .st.fail { color: var(--warn); } .prog .st.run { color: var(--key); }
.prog .d { display: block; color: var(--dim); font-size: 11px; margin: 0 0 4px 20px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.note { color: var(--dim); font-size: 12px; margin: 4px 0 8px; }
`;

// 客户端渲染：扩展推 state，这里画；交互只发消息，不改 state
const SCRIPT = `
const vscode = acquireVsCodeApi();
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const key = (b, h) => b.slice(0, 8) + '..' + h.slice(0, 8);
let S = null, logOpen = true;
/** 提交列表的行：工作区（有未提交改动时）+ 提交 + 分叉点 */
function allRows() {
  return [...(S.work ? [{ sha: 'WORKTREE', short: '工作区', subject: '', author: '', ago: '', merge: false, work: true }] : []),
    ...S.commits.map(c => ({ ...c })), ...(S.forkInfo ? [{ ...S.forkInfo, fork: true }] : [])];
}

function render() {
  if (!S) return;
  const app = document.getElementById('app');
  const r = S.range;
  const rows = allRows();
  const hi = r ? rows.findIndex(c => c.sha === r.head) : -1, bi = r ? rows.findIndex(c => c.sha === r.base) : -1;
  const has = sha => Object.keys(S.existing).some(k => k.endsWith('..' + sha.slice(0, 8)));
  const exFile = r && r.base && r.head && S.existing[key(r.base, r.head)];
  const busy = !!S.gen && S.gen.stage !== 'error';
  let h = '';
  h += '<div class="row dir"><label>目录</label><span class="dpath" title="' + esc(S.dir.full) + '">' + esc(S.dir.show) + '</span>'
     + '<a id="pickDir">更改</a><a id="revealDir">打开</a></div>';
  if (S.dir.ask) h += '<div class="dirask">还没选走读目录：生成的走读会存到 <b>' + esc(S.dir.show) + '</b><div class="btns"><button id="pickDir2" class="sec">选择目录</button><button id="useDefaultDir">就用这个</button></div></div>';
  h += '<div class="row"><label>仓库</label><select id="repo">' + S.repos.map(x => '<option value="' + esc(x.root) + '"' + (x.root === S.repo ? ' selected' : '') + '>' + esc(x.name) + '</option>').join('') + '</select></div>';
  h += '<div class="row"><label>分支</label>' + comboHtml('bq', S.branch, '搜索分支…')
     + '<button class="icon" id="fetch" title="拉取远端分支（git fetch --prune origin，不动工作区）"' + (S.fetching ? ' disabled' : '') + '>' + (S.fetching ? '…' : '⟳') + '</button></div>';
  h += '<div class="row"><label>对比</label>' + comboHtml('cq', S.baseRef, '搜索基准分支…')
     + (S.fork && !S.merged ? '<span class="fork">分叉 ' + esc(S.fork.slice(0, 8)) + '</span>' : '') + '</div>';
  h += '<div class="row"><label>模型</label><select id="model" title="生成走读和所有问答都使用这个模型">' + S.askModels.map(m => '<option value="' + esc(m.id) + '"' + (m.id === S.askModel ? ' selected' : '') + '>' + esc(m.label) + '</option>').join('') + '</select><button class="icon model-add" id="manageModels" title="添加或删除模型">＋</button></div>';
  if (S.error) h += '<div class="err">' + esc(S.error) + '</div>';
  if (rows.length) {
    h += '<h3><span>' + (S.merged ? '最近提交（已合入 ' + esc(S.merged) + '，没有独有的提交）' : '提交（' + esc(S.baseRef) + ' 分叉后 ' + S.commits.length + ' 个）') + '</span><a id="fold">' + (logOpen ? '收起' : '展开') + '</a></h3>';
    if (logOpen) {
      h += '<div class="log">' + rows.map((c, i) => {
        const cls = ['c', i === hi ? 'head' : '', i === bi ? 'base' : '', i > hi && i < bi ? 'in' : '', i === hi && bi > hi ? 'in' : '', c.fork ? 'forkrow' : '', c.work ? 'workrow' : ''].join(' ');
        const g = c.work ? (i === hi ? '◆' : '◇') : i === hi ? '●' : i === bi ? '○' : (i > hi && i < bi) ? '┃' : '·';
        return '<div class="' + cls + '" data-i="' + i + '" title="' + esc(c.author + ' · ' + c.ago + (c.merge ? ' · 合并提交' : '')) + '">'
          + '<span class="g">' + g + '</span><span class="sha">' + esc(c.short) + '</span>'
          + '<span class="sub">' + (c.fork ? '── ' + esc(S.baseRef) + ' 分叉点 ──' : c.work ? '工作区（未提交）· ' + S.work.files.length + ' 个文件' : esc(c.subject)) + (c.merge ? ' ⑂' : '') + '</span>'
          + (has(c.sha) ? '<span class="wt" title="以它为终点的走读已存在">📖</span>' : '') + '<span class="ago">' + esc(c.ago) + '</span></div>';
      }).join('') + '</div><div class="hint">' + (S.merged && !(r && r.base) ? '分支已合入，自己点选：' : '') + '点 = 终点 · Shift+点 = 起点 · 双击 = 只看这一个提交</div>';
    }
    if (r && hi >= 0 && bi > hi) {
      const isWork = r.head === 'WORKTREE', n = bi - hi - (isWork ? 1 : 0);
      h += '<div class="sum"><b>' + esc(r.base.slice(0, 8)) + '..' + (isWork ? '工作区' : esc(r.head.slice(0, 8))) + '</b> · '
        + (isWork ? (n ? n + ' 个提交 + ' : '') + '未提交改动' : n + ' 个提交') + '</div><div class="btns">';
      if (exFile) h += '<button id="open">📖 打开已有走读</button><button class="sec" id="gen"' + (busy ? ' disabled' : '') + '>重新生成</button>';
      else h += '<button id="gen"' + (busy ? ' disabled' : '') + '>生成走读</button>';
      h += '</div>';
    } else if (r && r.base && r.head) h += '<div class="err">起点要在终点下面（更早）</div>';
  }
  // 下半部分：生成中 / 审阅项
  // 这个分支以前生成过的走读：点一下打开
  if (S.history && S.history.length) {
    h += '<h3><span>这个分支的走读（' + S.history.length + '）</span></h3><ul class="items hist">' + S.history.map(e =>
      '<li data-open="' + esc(e.file) + '" class="' + (S.wt && S.wt.file === e.file ? 'cur' : '') + '" title="' + esc(e.title) + '">'
      + '<span class="hd">' + esc(e.at.slice(5, 10)) + '</span><span class="hk">' + esc(e.key) + '</span>'
      + '<span class="t">' + esc(e.title) + '</span><span class="m">' + e.items + ' 项' + (S.wt && S.wt.file === e.file ? ' · ● 正在看' : '') + '</span>'
      + '<span class="x" data-del="' + esc(e.file) + '" title="删除这份走读">×</span></li>').join('') + '</ul>';
  }
  const G = S.gen;
  if (G) {
    h += '<h3><span>' + (G.stage === 'snapshot' ? '确认拍进快照的文件（' + G.files.length + '）' : G.stage === 'confirm' ? '确认要审的几项' : G.stage === 'error' ? '生成失败' : '生成中') + '</span>' + (G.stage !== 'error' ? '<a id="cancel">取消</a>' : '<a id="dismiss">关闭</a>') + '</h3>';
    h += '<div class="' + (G.stage === 'error' ? 'err' : 'note') + '">' + esc(G.note) + '</div>';
    if (G.stage === 'snapshot') {
      h += '<ul class="items snap">' + G.files.slice(0, 200).map(f => '<li><span class="fs">' + esc(f.status.trim() === '??' ? '新' : f.status.trim()[0] === 'D' ? '删' : f.status.trim()[0] === 'A' ? '加' : '改') + '</span><span class="t">' + esc(f.path) + '</span></li>').join('') + '</ul>'
        + (G.files.length > 200 ? '<div class="note">还有 ' + (G.files.length - 200) + ' 个没列出</div>' : '');
      h += '<div class="btns"><button id="snapOk">拍快照并生成</button><button class="sec" id="cancel2">取消</button></div>';
    }
    if (G.stage === 'confirm') {
      h += '<ul class="items plan">' + G.plan.map((p, i) => '<li><input type="checkbox" data-p="' + i + '"' + (p.checked ? ' checked' : '') + '><input type="text" data-t="' + i + '" value="' + esc(p.title) + '"></li><span class="why">' + esc(p.why) + (p.entry ? ' · 入口 ' + esc(p.entry) : '') + '</span>').join('') + '</ul>';
      h += '<div class="btns"><button id="go">开始生成</button></div>';
    }
    if (G.progress) h += '<ul class="items prog">' + G.progress.map(p => '<li><span class="st ' + p.status + '">' + ({ queue: '◌', run: '◐', ok: '✓', fail: '✕' })[p.status] + '</span><span class="t">' + esc(p.title) + '</span></li><span class="d" title="' + esc(p.detail) + '">' + esc(p.detail) + '</span>').join('') + '</ul>';
  } else if (S.wt) {
    h += '<h3><span>审阅项 · ' + esc(S.wt.title) + '</span></h3><ul class="items">' + S.wt.items.map((it, i) =>
      '<li data-item="' + i + '" class="' + (i === S.wt.current ? 'cur' : '') + '"><span class="n">' + (i + 1) + '</span><span class="t">' + esc(it.title) + '</span><span class="m">' + it.steps + '步·' + it.changed + '改</span></li>').join('') + '</ul>';
  } else {
    h += '<h3><span>审阅项</span></h3><div class="note">选一个范围生成，或打开已有走读</div>';
  }
  app.innerHTML = h;
  if (combo.open) { const q = document.getElementById(combo.id); q.value = combo.q; q.focus(); renderList(); }
}

// ---- 可搜索下拉（分支、对比共用）：点进去先列全部，输入后按「包含」筛选；↑↓ 选、回车定、Esc 关 ----
const COMBOS = {
  bq: { cur: () => S.branch, items: () => S.branches, msg: name => ({ type: 'branch', name }) },
  // 对比：常用的主干放最前，后面是全部分支
  cq: { cur: () => S.baseRef, items: () => {
    const top = S.bases.map(n => S.branches.find(b => b.name === n) || { name: n, date: 0, remote: n.startsWith('origin/') });
    return [...top, ...S.branches.filter(b => !S.bases.includes(b.name))];
  }, msg: ref => ({ type: 'base', ref }) },
};
const combo = { id: '', open: false, q: '', idx: 0, typed: false };
const ago = ts => { if (!ts) return ''; const d = Date.now() / 1000 - ts; return d < 3600 ? Math.max(1, Math.round(d / 60)) + ' 分钟前' : d < 86400 ? Math.round(d / 3600) + ' 小时前' : Math.round(d / 86400) + ' 天前'; };
function comboHtml(id, value, ph) {
  return '<div class="combo"><input type="text" id="' + id + '" autocomplete="off" spellcheck="false" value="' + esc(value) + '" placeholder="' + ph + '"><div id="' + id + '-list" class="blist" hidden></div></div>';
}
function matches() {
  const q = combo.typed ? combo.q.trim().toLowerCase() : '';
  return COMBOS[combo.id].items().filter(b => !q || b.name.toLowerCase().includes(q)).slice(0, 200);
}
function renderList() {
  const el = document.getElementById(combo.id + '-list');
  if (!el) return;
  const list = matches(), cur = COMBOS[combo.id].cur(), all = COMBOS[combo.id].items().length;
  combo.idx = Math.min(combo.idx, Math.max(0, list.length - 1));
  el.hidden = false;
  el.innerHTML = list.length ? list.map((b, i) => '<div class="b' + (i === combo.idx ? ' on' : '') + (b.name === cur ? ' cur' : '') + '" data-b="' + esc(b.name) + '">'
    + '<span class="bn">' + esc(b.name.replace(/^origin\\//, '')) + '</span><span class="bt">' + (b.remote ? '远端' + (b.date ? ' · ' : '') : '') + ago(b.date) + '</span></div>').join('')
    + (all > 200 && !combo.typed ? '<div class="bmore">只列前 200 个，输入关键字找更早的</div>' : '')
    : '<div class="bmore">没有匹配的分支；没拉下来的话点 ⟳</div>';
  el.querySelector('.on')?.scrollIntoView({ block: 'nearest' });
}
function closeCombo(pick) {
  const id = combo.id;
  combo.open = false;
  if (pick) vscode.postMessage(COMBOS[id].msg(pick));
  else { const q = document.getElementById(id); if (q) q.value = COMBOS[id].cur() || ''; }
  const el = document.getElementById(id + '-list'); if (el) el.hidden = true;
}
document.addEventListener('focusin', e => {
  const id = e.target.id;
  if (!COMBOS[id] || (combo.open && combo.id === id)) return;
  if (combo.open) closeCombo();
  const items = COMBOS[id].items(), cur = COMBOS[id].cur();
  Object.assign(combo, { id, open: true, q: e.target.value, idx: Math.max(0, items.findIndex(b => b.name === cur)), typed: false });
  e.target.select(); renderList();
});
document.addEventListener('focusout', e => {
  const id = e.target.id;
  if (COMBOS[id]) setTimeout(() => { if (combo.open && combo.id === id && document.activeElement?.id !== id) closeCombo(); }, 150);
});
document.addEventListener('keydown', e => {
  if (!COMBOS[e.target.id] || !combo.open) return;
  const list = matches();
  if (e.key === 'ArrowDown') { e.preventDefault(); combo.idx = Math.min(combo.idx + 1, list.length - 1); renderList(); }
  else if (e.key === 'ArrowUp') { e.preventDefault(); combo.idx = Math.max(combo.idx - 1, 0); renderList(); }
  else if (e.key === 'Enter') { e.preventDefault(); if (list[combo.idx]) { e.target.blur(); closeCombo(list[combo.idx].name); } }
  else if (e.key === 'Escape') { e.preventDefault(); e.target.blur(); closeCombo(); }
});
document.addEventListener('mousedown', e => {
  const b = e.target.closest('.blist .b');
  if (b) { e.preventDefault(); document.getElementById(combo.id).blur(); closeCombo(b.dataset.b); }
});

let planEdit = null;
window.addEventListener('message', ({ data }) => {
  if (data.type !== 'state') return;
  const keepPlan = S && S.gen && S.gen.stage === 'confirm' && data.state.gen && data.state.gen.stage === 'confirm';
  S = data.state;
  if (keepPlan && planEdit) S.gen.plan = planEdit;
  planEdit = S.gen && S.gen.stage === 'confirm' ? S.gen.plan.map(p => ({ ...p })) : null;
  if (planEdit) S.gen.plan = planEdit;
  render();
});
document.addEventListener('change', e => {
  const t = e.target;
  if (t.id === 'repo') vscode.postMessage({ type: 'repo', root: t.value });
  else if (t.id === 'model') vscode.postMessage({ type: 'model', value: t.value });
  else if (t.dataset.p !== undefined) planEdit[+t.dataset.p].checked = t.checked;
});
document.addEventListener('input', e => {
  const t = e.target;
  if (COMBOS[t.id]) { combo.q = t.value; combo.typed = true; combo.idx = 0; renderList(); return; }
  if (t.dataset.t !== undefined) planEdit[+t.dataset.t].title = t.value;
});
let clickTimer = null;
document.addEventListener('click', e => {
  const t = e.target;
  if (t.id === 'fold') { logOpen = !logOpen; render(); return; }
  if (t.id === 'gen') return vscode.postMessage({ type: 'generate' });
  if (t.id === 'manageModels') return vscode.postMessage({ type: 'manageModels' });
  if (t.id === 'fetch') return vscode.postMessage({ type: 'fetch' });
  if (t.id === 'pickDir' || t.id === 'pickDir2') return vscode.postMessage({ type: 'pickDir' });
  if (t.id === 'useDefaultDir') return vscode.postMessage({ type: 'useDefaultDir' });
  if (t.id === 'revealDir') return vscode.postMessage({ type: 'revealDir' });
  if (t.id === 'open') return vscode.postMessage({ type: 'open', file: S.existing[key(S.range.base, S.range.head)] });
  if (t.id === 'cancel' || t.id === 'cancel2') return vscode.postMessage({ type: 'cancel' });
  if (t.id === 'snapOk') return vscode.postMessage({ type: 'snapshot', ok: true });
  if (t.id === 'dismiss') { S.gen = null; render(); return; }
  if (t.id === 'go') return vscode.postMessage({ type: 'plan', items: planEdit.filter(p => p.checked).map(p => ({ id: p.id, title: p.title.trim() || p.id })) });
  const del = t.closest('[data-del]');
  if (del) return vscode.postMessage({ type: 'delete', file: del.dataset.del });   // 先于「打开」判断：点 × 不打开
  const op = t.closest('[data-open]');
  if (op) return vscode.postMessage({ type: 'open', file: op.dataset.open });
  const it = t.closest('[data-item]');
  if (it) return vscode.postMessage({ type: 'item', index: +it.dataset.item });
  const row = t.closest('.c');
  if (row && e.detail === 1) {
    const rows = allRows();
    const c = rows[+row.dataset.i];
    const shift = e.shiftKey;
    if (shift && c.work) return;   // 起点不能是工作区
    clearTimeout(clickTimer);
    clickTimer = setTimeout(() => {   // 等一下，区分单击和双击
      const r = S.range || {};
      vscode.postMessage(shift ? { type: 'range', base: c.sha, head: r.head } : { type: 'range', base: r.base, head: c.sha });
    }, 220);
  }
});
document.addEventListener('dblclick', e => {
  const row = e.target.closest('.c');
  if (!row) return;
  clearTimeout(clickTimer);
  const rows = allRows();
  const i = +row.dataset.i;   // 双击工作区那一行 = 只看还没提交的部分（起点 = 当前 HEAD）
  if (i + 1 < rows.length) vscode.postMessage({ type: 'range', base: rows[i + 1].sha, head: rows[i].sha });
});
vscode.postMessage({ type: 'ready' });
`;
