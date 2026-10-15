// 编辑器标注：范围外变淡；范围内按真实 diff 标新增 / 修改 / 删除；焦点行行尾写「第 N 步」。
import * as vscode from 'vscode';
import { ChainNode } from './model';
import { FileDiff } from './diff';

// 三种颜色：重点（链接色）、注意（警告色）、不重要（淡化 / 灰）。都取主题色，深浅主题自动适配。
const KEY = new vscode.ThemeColor('textLink.foreground');
const WARN = new vscode.ThemeColor('editorWarning.foreground');
const DIM = new vscode.ThemeColor('descriptionForeground');

const dim = vscode.window.createTextEditorDecorationType({ opacity: '0.4' });
// 只在没有 base 的单快照模式下用：新增 / 修改 / 删除统一画「注意」色
const bar = () => vscode.window.createTextEditorDecorationType({
  isWholeLine: true, borderWidth: '0 0 0 3px', borderStyle: 'solid', borderColor: WARN,
  overviewRulerColor: WARN, overviewRulerLane: vscode.OverviewRulerLane.Left,
});
const added = bar();
const modified = bar();
const deleted = vscode.window.createTextEditorDecorationType({
  isWholeLine: true, borderWidth: '1px 0 0 0', borderStyle: 'dashed', borderColor: WARN,
});
const focus = vscode.window.createTextEditorDecorationType({});
const note = vscode.window.createTextEditorDecorationType({
  overviewRulerColor: KEY, overviewRulerLane: vscode.OverviewRulerLane.Right,
});
const refRange = vscode.window.createTextEditorDecorationType({
  isWholeLine: true, borderWidth: '0 0 0 3px', borderStyle: 'solid', borderColor: KEY,
  overviewRulerColor: KEY, overviewRulerLane: vscode.OverviewRulerLane.Full,
});
const ALL = [dim, added, modified, deleted, focus, note, refRange];

function brief(text: string): string {
  const plain = text.replace(/\*\*|`/g, '').replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');
  return plain.length > 70 ? plain.slice(0, 70) + '…' : plain;
}

const code = (lines: string[]) => '```\n' + lines.join('\n') + '\n```';

/** inDiff = true：编辑器是 diff 编辑器的右侧（修改后），新增 / 修改 / 删除由 diff 编辑器自己画 */
export function decorate(editor: vscode.TextEditor, node: ChainNode, step: number, diff: FileDiff | undefined, inDiff = false): void {
  const doc = editor.document;
  const last = doc.lineCount;
  const L = (n: number) => doc.lineAt(Math.min(Math.max(n, 1), last) - 1).range;
  const { start, end, line } = node.anchor;

  const outside: vscode.Range[] = [];
  if (start > 1) outside.push(new vscode.Range(L(1).start, L(start - 1).end));
  if (end < last) outside.push(new vscode.Range(L(end + 1).start, L(last).end));
  editor.setDecorations(dim, outside);

  const add: vscode.DecorationOptions[] = [], mod: vscode.DecorationOptions[] = [], del: vscode.DecorationOptions[] = [];
  if (diff && !inDiff) {
    for (let n = start; n <= end; n++) {
      const m = diff.lines.get(n);
      if (m?.kind === 'added') add.push({ range: L(n), hoverMessage: '**新增**' });
      if (m?.kind === 'modified') mod.push({ range: L(n), hoverMessage: new vscode.MarkdownString(`**修改**，原来是：\n\n${code([m.old])}`) });
    }
    for (const [after, text] of diff.deleted) {
      if (after < start - 1 || after > end) continue;
      // 红色上边框画在「删除点后面那一行」的顶上；删在文件末尾时画在最后一行
      del.push({ range: L(Math.min(after + 1, last)), hoverMessage: new vscode.MarkdownString(`**这里删了 ${text.length} 行**：\n\n${code(text)}`) });
    }
  }
  editor.setDecorations(added, add);
  editor.setDecorations(modified, mod);
  editor.setDecorations(deleted, del);
  const notes = node.notes ?? [];
  editor.setDecorations(note, notes.map(n => ({
    range: L(n.line),
    hoverMessage: new vscode.MarkdownString(`**修改说明** · L${n.line}\n\n${n.text}`),
    renderOptions: { after: { contentText: `  ◀ ${brief(n.text)}`, color: KEY, fontStyle: 'italic', margin: '0 0 0 1em' } },
  })));
  // 焦点行已经挂了说明就不再叠「第 N 步」，免得一行两段字
  editor.setDecorations(focus, notes.some(n => n.line === line) ? [] : [{
    range: L(line),
    renderOptions: { after: { contentText: `  ← 第 ${step} 步：${node.step}`, color: DIM, fontStyle: 'italic' } },
  }]);
}

export function clear(editor: vscode.TextEditor): void {
  for (const d of ALL) editor.setDecorations(d, []);
}

/** 回答里的代码引用：高亮引用范围、范围外淡化，第一行行尾挂上引用它的那句话 */
export function decorateRef(editor: vscode.TextEditor, start: number, end: number, why: string): void {
  clear(editor);
  const doc = editor.document;
  const last = doc.lineCount;
  const L = (n: number) => doc.lineAt(Math.min(Math.max(n, 1), last) - 1).range;
  const outside: vscode.Range[] = [];
  if (start > 1) outside.push(new vscode.Range(L(1).start, L(start - 1).end));
  if (end < last) outside.push(new vscode.Range(L(end + 1).start, L(last).end));
  editor.setDecorations(dim, outside);
  editor.setDecorations(refRange, [new vscode.Range(L(start).start, L(end).end)]);
  if (why) editor.setDecorations(note, [{
    range: L(start),
    hoverMessage: new vscode.MarkdownString(`**回答里的引用** · L${start}${end > start ? `-${end}` : ''}\n\n${why}`),
    renderOptions: { after: { contentText: `  ◀ ${brief(why)}`, color: KEY, fontStyle: 'italic', margin: '0 0 0 1em' } },
  }]);
}
