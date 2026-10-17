// 入口：打开走读 JSON → 定位本地仓库 → 逐站打开只读快照 + 讲解面板。
import * as vscode from 'vscode';
import * as os from 'os';
import * as path from 'path';
import { NodeRef, Walkthrough, flatten, loadWalkthrough, parseLinkTarget } from './model';
import { fetchRef, gitDiff, hasCommit, isGitRepo, listFiles, mainRepoRoot } from './git';
import { FileDiff, parseDiff, rowsInRange } from './diff';
import { SCHEME, SnapshotProvider, parseSnapUri, snapUri } from './snapshot';
import { clear, decorate, decorateRef } from './decorations';
import { ItemsView, Sidebar } from './sidebar';
import { QuickAsk } from './quick';
import { Focus, PanelMsg, ShownRow, navigate, renderAnswer, renderItem, renderTrail } from './panel';
import { Answer, AskFormat, AskTarget, CustomModels, buildPrompt, loadAnswers, modelCommandFor, runAsk, saveAnswer, systemPrompt, targetKey } from './ask';

const expand = (p: string) => p.replace(/^~(?=\/|$)/, os.homedir());

class Session {
  private w?: Walkthrough;
  private refs: NodeRef[] = [];
  private diffs = new Map<string, FileDiff>();
  private file = '';
  private paths: string[] = [];
  /** 正在看回答引用时，切编辑器不要把它换回走读步骤的标注 */
  private viewingRef = false;
  /** 从当前步出发点过的引用，最后一个是正在看的；切步骤时清空 */
  private trail: { target: string; why: string; label: string }[] = [];
  private answers: Answer[] = [];
  private running = new Set<() => void>();
  private root = '';
  private index = -1;
  private panel?: vscode.WebviewPanel;
  private editor?: vscode.TextEditor;

  onOpened?: () => void;

  constructor(private ctx: vscode.ExtensionContext, private tree: ItemsView & { setFile(f: string): void }) {}

  async open(file: string) {
    const w = loadWalkthrough(file);
    const root = await this.resolveRepo(w);
    if (!root) return;
    if (!(await hasCommit(root, w.meta.anchor.head))) {
      const ref = w.meta.anchor.branch ?? w.meta.anchor.head;
      const pick = await vscode.window.showWarningMessage(
        `本地仓库没有提交 ${w.meta.anchor.head.slice(0, 8)}`, { modal: true }, `git fetch origin ${ref}`);
      if (!pick) return;
      const r = await fetchRef(root, ref);
      if (!r.ok || !(await hasCommit(root, w.meta.anchor.head))) {
        vscode.window.showErrorMessage(`拉取后仍找不到该提交：${r.message}`); return;
      }
    }
    this.w = w; this.refs = flatten(w); this.root = root; this.diffs.clear();
    this.file = file;
    this.paths = await listFiles(root, w.meta.anchor.head).catch(() => []);
    try { this.answers = loadAnswers(file); }
    catch (e) { this.answers = []; vscode.window.showWarningMessage(`读不了问答记录，先当作没有：${(e as Error).message}`); }
    this.tree.setFile(file);
    this.tree.set(w);
    await vscode.commands.executeCommand('setContext', 'walkthrough.active', true);
    this.onOpened?.();
    await this.goto(0);
  }

  /** 仓库定位顺序：配置 repoRoots → 同名工作区文件夹 → 上次选过的 → 让人选 */
  private async resolveRepo(w: Walkthrough): Promise<string | undefined> {
    const name = w.meta.repo.name;
    const conf = vscode.workspace.getConfiguration('walkthrough').get<Record<string, string>>('repoRoots') ?? {};
    const remembered = this.ctx.globalState.get<Record<string, string>>('repoRoots') ?? {};
    const candidates = [
      conf[name] && expand(conf[name]),
      ...(vscode.workspace.workspaceFolders ?? []).filter(f => path.basename(f.uri.fsPath) === name).map(f => f.uri.fsPath),
      remembered[name],
    ].filter((x): x is string => !!x);
    for (const c of candidates) if (await isGitRepo(c)) return c;
    // 工作区打开的是 worktree（目录名不是仓库名）：看它属于哪个主仓库
    for (const f of vscode.workspace.workspaceFolders ?? []) {
      const main = await mainRepoRoot(f.uri.fsPath);
      if (main && path.basename(main) === name) return main;
    }

    const picked = await vscode.window.showOpenDialog({
      canSelectFolders: true, canSelectFiles: false, openLabel: `选择 ${name} 的本地仓库`,
    });
    const dir = picked?.[0]?.fsPath;
    if (!dir) return;
    if (!(await isGitRepo(dir))) { vscode.window.showErrorMessage(`${dir} 不是 git 仓库`); return; }
    await this.ctx.globalState.update('repoRoots', { ...remembered, [name]: dir });
    return dir;
  }

  /** 聚焦在哪：说明段名，或 node（链条当前步）。进入新的一项时从「修改原因」开始 */
  private focus: Focus = 'node';

  async goto(i: number, focus?: Focus) {
    if (!this.w || i < 0 || i >= this.refs.length) return;
    const prevItem = this.refs[this.index]?.itemIndex;
    this.index = i;
    this.focus = focus ?? (this.refs[i].itemIndex !== prevItem ? 'why' : 'node');
    this.trail = [];
    const ref = this.refs[i];
    const diff = await this.showStep();
    this.syncTrail();
    this.tree.setCurrent(ref.itemIndex);
    this.renderPanel(this.rowsFor(ref, diff));
  }

  /** 打开当前这一步的代码并挂标注；不碰面板（面板里的展开 / 收起状态保留） */
  private async showStep(): Promise<FileDiff | undefined> {
    const ref = this.refs[this.index];
    const { anchor } = ref.node;
    this.viewingRef = false;
    const diff = await this.diffOf(anchor.path);
    const inDiff = !!(ref.node.changed && this.w!.meta.anchor.base);
    this.editor = inDiff
      ? await this.showDiff(anchor.path, anchor.line, anchor.start)
      : await this.show(anchor.path, anchor.line, anchor.line, anchor.start);
    decorate(this.editor, ref.node, ref.nodeIndex + 1, diff, inDiff);
    return diff;
  }

  /** 回到当前这一步：看完引用、关掉快速问答之后用 */
  async refocus() {
    if (!this.w || this.index < 0) return;
    this.trail = [];
    await this.showStep();
    this.syncTrail();
  }

  /** 有改动的步骤：左 base、右 head 的 diff 编辑器；返回右侧（修改后）那个编辑器 */
  private async showDiff(rel: string, line: number, top: number): Promise<vscode.TextEditor> {
    const { base, head } = this.w!.meta.anchor;
    const left = snapUri(this.root, base!, rel, true);
    const right = snapUri(this.root, head, rel);
    const name = rel.split('/').pop();
    await vscode.commands.executeCommand('vscode.diff', left, right,
      `${name}（${base!.slice(0, 8)} → ${head.slice(0, 8)}）`, { viewColumn: vscode.ViewColumn.One, preview: true });
    const editor = vscode.window.visibleTextEditors.find(e => e.document.uri.toString() === right.toString())
      ?? await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(right), { viewColumn: vscode.ViewColumn.One });
    this.reveal(editor, line, line, top);
    return editor;
  }

  /** 整个 PR 的 base..head；没有 base（架构走读）就不画 diff */
  private async diffOf(rel: string): Promise<FileDiff | undefined> {
    const base = this.w!.meta.anchor.base;
    if (!base) return undefined;
    let d = this.diffs.get(rel);
    if (!d) { d = parseDiff(await gitDiff(this.root, base, this.w!.meta.anchor.head, rel)); this.diffs.set(rel, d); }
    return d;
  }

  private rowsFor(ref: NodeRef, diff: FileDiff | undefined): ShownRow[] | undefined {
    if (!diff || !this.editor) return undefined;
    const doc = this.editor.document;
    const text = (n: number) => n >= 1 && n <= doc.lineCount ? doc.lineAt(n - 1).text : '';
    return rowsInRange(diff, ref.node.anchor.start, ref.node.anchor.end).map(r =>
      r.kind === 'deleted' ? r : r.kind === 'added' ? { ...r, text: text(r.line) } : { ...r, text: text(r.line) });
  }

  /** 左侧点审阅项：跳到这一项的第一步 */
  gotoItem(itemIndex: number) {
    const r = this.refs.find(x => x.itemIndex === itemIndex);
    if (r) return this.goto(r.flat, 'why');
  }

  /** 下一步：先在说明段之间走（修改原因 → 核心思想 → 场景），走完进链条；链条走完进下一项 */
  next() { return this.move(1); }
  prev() { return this.move(-1); }

  private move(dir: 1 | -1) {
    const m = navigate(this.focus, this.refs[this.index]?.nodeIndex ?? 0, dir);
    if ('jump' in m) return this.goto(this.index + m.jump, m.focus);
    return this.setFocus(m.focus);
  }

  /** 只换焦点：面板只改样式，不重新渲染 */
  private setFocus(f: Focus) {
    this.focus = f;
    this.panel?.webview.postMessage({ type: 'focus', f });
  }

  private async show(rel: string, start: number, end = start, top = start): Promise<vscode.TextEditor> {
    const doc = await vscode.workspace.openTextDocument(snapUri(this.root, this.w!.meta.anchor.head, rel));
    const editor = await vscode.window.showTextDocument(doc, { viewColumn: vscode.ViewColumn.One, preview: true, preserveFocus: false });
    this.reveal(editor, start, end, top);
    return editor;
  }

  private reveal(editor: vscode.TextEditor, start: number, end: number, top: number) {
    const last = editor.document.lineCount - 1;
    const r = new vscode.Range(Math.min(start - 1, last), 0, Math.min(end - 1, last), 0);
    editor.selection = new vscode.Selection(r.start, r.start);
    // 先把范围顶部滚到上方，再保证焦点行可见：既看得到函数开头，又不会让焦点行跑出屏幕
    editor.revealRange(new vscode.Range(Math.min(top - 1, last), 0, Math.min(top - 1, last), 0), vscode.TextEditorRevealType.AtTop);
    editor.revealRange(r, vscode.TextEditorRevealType.Default);
  }

  private lastRows?: ShownRow[];

  private renderPanel(rows: ShownRow[] | undefined) {
    this.lastRows = rows;
    const ref = this.refs[this.index];
    if (!this.panel) {
      this.panel = vscode.window.createWebviewPanel('walkthrough.panel', '走读', { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true }, { enableScripts: true, retainContextWhenHidden: true });
      this.panel.onDidDispose(() => { this.panel = undefined; for (const c of this.running) c(); this.running.clear(); });
      this.panel.webview.onDidReceiveMessage((m: PanelMsg) => this.onMessage(m));
    }
    const nonce = Math.random().toString(36).slice(2) + Date.now().toString(36);
    const csp = `default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';`;
    this.panel.title = `走读 · ${ref.itemIndex + 1}/${this.w!.items.length}`;
    this.panel.webview.html = renderItem(this.w!, this.refs, ref, rows, nonce, csp, this.answers.filter(a => a.target.item === ref.item.id), this.paths, this.trailHtml(), this.focus);
    if (!this.panel.visible) this.panel.reveal(vscode.ViewColumn.Beside, true);
  }

  private async ask(t: AskTarget, question: string) {
    const w = this.w!;
    const item = w.items.find(i => i.id === t.item);
    if (!item) return;
    const q = question.trim();
    if (!q) return;

    const conf = vscode.workspace.getConfiguration('walkthrough.ask');
    const { command, format, by } = modelCommandFor(conf.get<string[]>('command') ?? [], conf.get<AskFormat>('format') ?? 'claude-stream-json', conf.get<string>('model') ?? '', conf.get<CustomModels>('models') ?? {});
    if (!command.length) { vscode.window.showErrorMessage('没有配置 walkthrough.ask.command'); return; }

    const ref = this.refs.find(r => r.item.id === t.item && r.node.id === (t.node ?? this.refs[this.index].node.id))
      ?? this.refs[this.index];
    const prompt = buildPrompt(w, item, t, q, await this.codeContext(ref), this.answers);
    const a: Answer = { id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, target: t, q, a: '',
      at: new Date().toISOString(), by, status: 'running' };
    this.answers.push(a);
    const prefer = item.chain.map(n => n.anchor.path);
    const push = () => this.panel?.webview.postMessage({ type: 'answer', key: targetKey(t), id: a.id, html: renderAnswer(a, this.paths, prefer) });
    push();

    let last = 0;
    const run = runAsk(command, format, this.root, systemPrompt(w.meta.anchor.base, w.meta.anchor.head), prompt, ev => {
      if (ev.kind === 'text') a.a = format === 'text' ? ev.text : (a.a ? a.a + '\n\n' : '') + ev.text;
      if (ev.kind === 'tool') a.progress = `正在查看：${ev.label}`;
      if (ev.kind === 'result') return;
      const now = Date.now();
      if (now - last > 300) { last = now; push(); }
    });
    this.running.add(run.cancel);
    try {
      a.a = await run.done;
      a.status = 'done'; a.progress = undefined;
      saveAnswer(this.file, w, a);
    } catch (e) {
      a.status = 'error'; a.a = (e as Error).message;
    } finally {
      this.running.delete(run.cancel);
      push();
    }
  }

  /** 提问时带上「这一步」的 head 代码与范围内 diff；超过 150 行只取焦点附近 */
  private async codeContext(ref: NodeRef) {
    const { path: rel, start, end, line } = ref.node.anchor;
    try {
      const doc = await vscode.workspace.openTextDocument(snapUri(this.root, this.w!.meta.anchor.head, rel));
      let s = start, e = end;
      if (e - s > 150) { s = Math.max(start, line - 75); e = Math.min(end, s + 150); }
      const lines = Array.from({ length: e - s + 1 }, (_, i) => doc.lineAt(s - 1 + i).text);
      const d = await this.diffOf(rel);
      const diff: string[] = [];
      if (d) for (const r of rowsInRange(d, start, end)) {
        if (r.kind === 'deleted') diff.push(...r.text.map(t => `-${t}`));
        else if (r.kind === 'modified') diff.push(`-${r.old}`, `+${doc.lineAt(r.line - 1).text}  // L${r.line}`);
        else diff.push(`+${doc.lineAt(r.line - 1).text}  // L${r.line}`);
      }
      return { path: rel, start: s, end: e, lines, diff };
    } catch { return undefined; }
  }

  /** 打开一处代码引用：记入跳转路径，高亮范围，把引用它的那句话挂在旁边。peek = 就地预览，不跳走也不记路径 */
  async openRef(target: string, why: string, label = target, peek = false) {
    const t = parseLinkTarget(target);
    if (t.kind === 'url') return vscode.env.openExternal(vscode.Uri.parse(t.url));
    if (!this.w) return;
    if (peek) return this.peek(t.path, t.line ?? 1, t.end ?? t.line ?? 1);
    this.trail.push({ target, why, label });
    await this.showRef(this.trail[this.trail.length - 1]);
    this.syncTrail();
  }

  private async showRef(r: { target: string; why: string }) {
    const t = parseLinkTarget(r.target);
    if (t.kind !== 'file') return;
    const start = t.line ?? 1, end = t.end ?? start;
    this.viewingRef = true;
    const editor = await this.show(t.path, start, end, Math.max(1, start - 3));
    decorateRef(editor, start, end, r.why);
  }

  /** 回到上一处：路径只剩一处时回到当前步 */
  async back() {
    if (!this.trail.length) return;
    this.trail.pop();
    if (this.trail.length) await this.showRef(this.trail[this.trail.length - 1]);
    else await this.showStep();
    this.syncTrail();
  }

  /** 点面包屑：k = -1 回到当前步，否则回到第 k 处 */
  async jumpTrail(k: number) {
    if (k < 0) return this.refocus();
    this.trail = this.trail.slice(0, k + 1);
    await this.showRef(this.trail[k]);
    this.syncTrail();
  }

  /** 就地预览：在当前步的代码下面展开被引用的那几行，Esc 收起 */
  private async peek(rel: string, start: number, end: number) {
    const host = this.editor;
    if (!host) return;
    const loc = new vscode.Location(snapUri(this.root, this.w!.meta.anchor.head, rel), new vscode.Range(start - 1, 0, end - 1, 0));
    await vscode.commands.executeCommand('workbench.action.focusFirstEditorGroup');
    await vscode.commands.executeCommand('editor.action.peekLocations', host.document.uri, host.selection.active, [loc], 'peek');
  }

  private trailHtml(): string {
    const ref = this.refs[this.index];
    return ref ? renderTrail(`第 ${ref.nodeIndex + 1} 步 ${ref.node.step}`, this.trail) : '';
  }

  private syncTrail() {
    void vscode.commands.executeCommand('setContext', 'walkthrough.canBack', this.trail.length > 0);
    this.panel?.webview.postMessage({ type: 'trail', html: this.trailHtml() });
  }

  /** 给编辑器里的快速问答用 */
  context() {
    if (!this.w) return undefined;
    return { w: this.w, root: this.root, paths: this.paths, item: this.refs[this.index]?.item };
  }

  /** 左侧删掉了正在看的那份走读：关掉面板、清空状态 */
  closeIf(file: string) {
    if (!this.w || this.file !== file) return;
    for (const c of this.running) c();
    this.running.clear();
    this.panel?.dispose();
    this.w = undefined; this.refs = []; this.index = -1; this.file = '';
    this.tree.set(undefined);
    void vscode.commands.executeCommand('setContext', 'walkthrough.active', false);
  }

  showPanel() { if (this.w && this.index >= 0) { this.renderPanel(this.lastRows); this.panel?.reveal(undefined, true); } }

  private async onMessage(m: PanelMsg) {
    if (m.type === 'next') return this.next();
    if (m.type === 'prev') return this.prev();
    if (m.type === 'node') return this.goto(m.flat, 'node');
    if (m.type === 'focus') { this.focus = m.f; return; }
    if (m.type === 'ask') return this.ask(m.target, m.q);
    if (m.type === 'ref') return this.openRef(m.target, m.why, m.label, m.peek).catch(e => vscode.window.showErrorMessage(String((e as Error).message ?? e)));
    if (m.type === 'trail') return this.jumpTrail(m.k);
  }

  /** 切回站点文件时重新挂装饰（编辑器重开后装饰会丢） */
  onEditor(editor: vscode.TextEditor | undefined) {
    const ref = this.refs[this.index];
    if (!editor || !ref || editor.document.uri.scheme !== SCHEME) return;
    if (this.viewingRef) {
      const top = this.trail[this.trail.length - 1];
      const t = top && parseLinkTarget(top.target);
      if (t && t.kind === 'file' && parseSnapUri(editor.document.uri).relPath === t.path) decorateRef(editor, t.line ?? 1, t.end ?? t.line ?? 1, top.why);
      return;
    }
    const { relPath: rel, sha } = parseSnapUri(editor.document.uri);
    if (sha !== this.w!.meta.anchor.head) return;   // diff 左侧（base）不挂说明
    const inDiff = !!(ref.node.changed && this.w!.meta.anchor.base);
    if (rel === ref.node.anchor.path) { this.editor = editor; decorate(editor, ref.node, ref.nodeIndex + 1, this.diffs.get(rel), inDiff); }
    else clear(editor);
  }
}

export function activate(ctx: vscode.ExtensionContext) {
  let session!: Session;
  const sidebar = new Sidebar(f => session.open(f), i => session.gotoItem(i), f => session.closeIf(f));
  session = new Session(ctx, sidebar);
  const guard = (fn: (...a: any[]) => unknown) => async (...a: any[]) => {
    try { await fn(...a); } catch (e) { vscode.window.showErrorMessage(`走读：${(e as Error).message ?? e}`); }
  };

  const quick = new QuickAsk(session);
  session.onOpened = () => quick.reset();
  ctx.subscriptions.push(
    quick,
    vscode.commands.registerCommand('walkthrough.quickAsk.reply', guard((r: vscode.CommentReply) => quick.reply(r))),
    vscode.commands.registerCommand('walkthrough.quickAsk.delete', guard(async (t: vscode.CommentThread) => { quick.remove(t); await session.refocus(); })),
    vscode.commands.registerCommand('walkthrough.refocus', guard(() => session.refocus())),
    vscode.commands.registerCommand('walkthrough.openRef', guard((target: string, why = '', label = target) => session.openRef(target, why, label))),
    vscode.commands.registerCommand('walkthrough.back', guard(() => session.back())),
    vscode.workspace.registerTextDocumentContentProvider(SCHEME, new SnapshotProvider()),
    vscode.window.registerWebviewViewProvider('walkthrough.side', sidebar, { webviewOptions: { retainContextWhenHidden: true } }),
    vscode.workspace.onDidChangeConfiguration(e => { if (e.affectsConfiguration('walkthrough.dataDir')) sidebar.onConfigChanged(); }),
    vscode.commands.registerCommand('walkthrough.open', guard(async () => {
      const dir = expand(vscode.workspace.getConfiguration('walkthrough').get<string>('dataDir') ?? '');
      const picked = await vscode.window.showOpenDialog({
        canSelectMany: false, filters: { '走读 JSON': ['json'] },
        defaultUri: dir ? vscode.Uri.file(dir) : undefined, openLabel: '打开走读',
      });
      if (picked?.[0]) await session.open(picked[0].fsPath);
    })),
    vscode.commands.registerCommand('walkthrough.openFile', guard((uri?: vscode.Uri) => {
      const u = uri ?? vscode.window.activeTextEditor?.document.uri;
      if (u) return session.open(u.fsPath);
    })),
    vscode.commands.registerCommand('walkthrough.goto', guard((i: number) => session.goto(i))),
    vscode.commands.registerCommand('walkthrough.next', guard(() => session.next())),
    vscode.commands.registerCommand('walkthrough.prev', guard(() => session.prev())),
    vscode.commands.registerCommand('walkthrough.showPanel', guard(() => session.showPanel())),
    vscode.window.onDidChangeActiveTextEditor(e => session.onEditor(e)),
  );
}

export function deactivate() {}
