// 左侧视图：上面选分支、像 git log 一样点选提交范围、生成走读；下面是审阅项（生成时先列项给人确认，再显示每项进度）。
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { AskFormat, CustomModels, answersPath, askModelOptions, modelCommandFor } from './ask';
import { CommitInfo, DirtyFile, commitInfo, deleteSnapshotRef, snapshotRefs, currentBranch, diffStat, dirtyFiles, fetchAll, logFrom, mainRepoRoot, snapshotWorktree, worktreeFor, isGitRepo, listBranches, logRange, mergeBase, remoteUrl, revParse } from './git';
import { GenInput, PlanItem, Signal, assemble, cancel, generateItem, generatePlan, newSignal, pool, walkthroughFile, walkthroughKey } from './gen';
import { Walkthrough } from './model';
import { sidebarHtml } from './sidebar-view';
import { Entry, forBranch, listWalkthroughs } from './store';

/** 提交列表里「工作区（未提交）」那一行的占位 sha */
export const WORK = 'WORKTREE';

const expand = (p: string) => p.replace(/^~(?=\/|$)/, os.homedir());

export interface ItemsView { set(w: Walkthrough | undefined): void; setCurrent(itemIndex: number): void }

interface GenItem { id: string; title: string; status: 'queue' | 'run' | 'ok' | 'fail'; detail: string }
interface State {
  repos: { name: string; root: string }[]; repo?: string;
  branches: { name: string; date: number; remote: boolean }[]; branch?: string; fetching?: boolean;
  bases: string[]; baseRef?: string; fork?: string;
  /** 分支已经整个合进基准：没有独有的提交，改列它最近的历史让人自己点选 */
  merged?: string;
  commits: CommitInfo[]; forkInfo?: CommitInfo;
  range?: { base: string; head: string };
  askModel: string; askModels: { id: string; label: string }[];
  /** 走读目录：显示用的短路径、完整路径、是否需要提示第一次选目录 */
  dir: { show: string; full: string; ask: boolean };
  existing: Record<string, string>;            // walkthroughKey → 文件
  /** 当前分支生成过的走读（新的在前） */
  history: Entry[];
  /** 选中的分支检出在某个目录、而且有没提交的改动：提交列表顶上多一行「工作区」 */
  work?: { dir: string; show: string; files: DirtyFile[] };
  wt?: { title: string; file: string; items: { title: string; steps: number; changed: number }[]; current: number };
  gen?: { stage: 'snapshot' | 'plan' | 'confirm' | 'items' | 'error'; note: string; plan?: (PlanItem & { checked: boolean })[]; progress?: GenItem[]; files?: DirtyFile[] };
  error?: string;
}

export class Sidebar implements vscode.WebviewViewProvider, ItemsView {
  private view?: vscode.WebviewView;
  private s: State = { repos: [], branches: [], bases: [], commits: [], existing: {}, history: [], askModel: '', askModels: [], dir: { show: '', full: '', ask: false } };
  private signal?: Signal;
  private planResolve?: (p: PlanItem[] | undefined) => void;
  private snapResolve?: (ok: boolean) => void;

  constructor(private open: (file: string) => Promise<void>, private gotoItem: (itemIndex: number) => void, private closeIf: (file: string) => void) {}

  // ---- 给会话用 ----
  private file = '';
  setFile(file: string) { this.file = file; }
  set(w: Walkthrough | undefined) {
    this.s.wt = w && {
      title: w.meta.title, file: this.file, current: -1,
      items: w.items.map(i => ({ title: i.title, steps: i.chain.length, changed: i.chain.filter(n => n.changed).length })),
    };
    this.push();
  }
  setCurrent(i: number) { if (this.s.wt) { this.s.wt.current = i; this.push(); } }

  // ---- 视图 ----
  resolveWebviewView(view: vscode.WebviewView) {
    this.view = view;
    view.webview.options = { enableScripts: true };
    const nonce = Math.random().toString(36).slice(2);
    view.webview.html = sidebarHtml(nonce, `default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';`);
    view.webview.onDidReceiveMessage(m => this.onMessage(m).catch(e => { this.s.error = String((e as Error).message ?? e); this.push(); }));
    void this.init();
  }

  /** 设置里改了走读目录：重读已有走读 */
  onConfigChanged() { this.loadExisting(); this.push(); }

  private push() { this.view?.webview.postMessage({ type: 'state', state: this.s }); }

  /** 第一次用（没在设置里选过目录、默认目录也还不存在）时提示选目录 */
  private refreshDir() {
    const full = this.dataDir();
    const set = vscode.workspace.getConfiguration('walkthrough').inspect<string>('dataDir');
    const chosen = set?.globalValue !== undefined || set?.workspaceValue !== undefined;
    this.s.dir = { full, show: full.startsWith(os.homedir()) ? '~' + full.slice(os.homedir().length) : full, ask: !chosen && !fs.existsSync(full) };
  }

  private async setDir(dir: string) {
    fs.mkdirSync(dir, { recursive: true });
    const home = os.homedir();
    await vscode.workspace.getConfiguration('walkthrough').update('dataDir', dir.startsWith(home) ? '~' + dir.slice(home.length) : dir, vscode.ConfigurationTarget.Global);
    this.loadExisting();
    this.push();
  }

  private dataDir() { return expand(vscode.workspace.getConfiguration('walkthrough').get<string>('dataDir') ?? ''); }

  private customModels() { return vscode.workspace.getConfiguration('walkthrough.ask').get<CustomModels>('models') ?? {}; }

  private refreshModels(codex?: string) {
    if (codex === undefined) {
      try { codex = fs.readFileSync(path.join(os.homedir(), '.codex', 'config.toml'), 'utf8'); } catch { /* 没装 codex */ }
    }
    this.s.askModels = askModelOptions(codex, this.customModels());
    if (this.s.askModel && !this.s.askModels.some(m => m.id === this.s.askModel)) this.s.askModels.push({ id: this.s.askModel, label: this.s.askModel });
  }

  private async init() {
    this.refreshDir();
    let codex: string | undefined;
    try { codex = fs.readFileSync(path.join(os.homedir(), '.codex', 'config.toml'), 'utf8'); } catch { /* 没装 codex */ }
    const saved = vscode.workspace.getConfiguration('walkthrough.ask').get<string>('model') ?? '';
    // 旧值（opus 这种不带厂商的）显示成新写法
    this.s.askModel = saved && !saved.includes('-') && saved !== 'codex' ? `claude-${saved}` : saved;
    this.refreshModels(codex);
    const conf = vscode.workspace.getConfiguration('walkthrough').get<Record<string, string>>('repoRoots') ?? {};
    const cands = new Map<string, string>();
    for (const [name, p] of Object.entries(conf)) cands.set(expand(p), name);
    for (const f of vscode.workspace.workspaceFolders ?? []) {
      cands.set(f.uri.fsPath, path.basename(f.uri.fsPath));
      try { for (const d of fs.readdirSync(f.uri.fsPath)) if (fs.existsSync(path.join(f.uri.fsPath, d, '.git'))) cands.set(path.join(f.uri.fsPath, d), d); } catch { /* 读不了就跳过 */ }
    }
    // worktree 和主检出共用一个仓库：一律归到主仓库（名字也用主仓库的目录名），去重
    const repos: State['repos'] = [];
    for (const [root, name] of cands) {
      if (!(await isGitRepo(root))) continue;
      const main = (await mainRepoRoot(root)) ?? root;
      if (!repos.some(r => r.root === main)) repos.push({ name: main === root ? name : path.basename(main), root: main });
    }
    this.s.repos = repos.sort((a, b) => a.name.localeCompare(b.name));
    if (repos.length && !this.s.repo) await this.pickRepo(repos[0].root);
    else this.push();
  }

  private repoName() { return this.s.repos.find(r => r.root === this.s.repo)?.name ?? path.basename(this.s.repo ?? ''); }

  private async pickRepo(root: string) {
    Object.assign(this.s, { repo: root, branch: undefined, commits: [], range: undefined, error: undefined });
    const branches = await listBranches(root);
    this.s.branches = branches.map(b => ({ name: b.name, date: b.date, remote: b.name.startsWith('origin/') }));
    const bases: string[] = [];
    // 远端的优先：本地主干常常落后，拿它算分叉点会多算进一堆别人的改动
    for (const b of ['origin/main', 'origin/master', 'origin/dev', 'main', 'master']) if (await revParse(root, b)) bases.push(b);
    this.s.bases = bases;
    this.s.baseRef = (vscode.workspace.getConfiguration('walkthrough').get<Record<string, string>>('baseBranch') ?? {})[this.repoName()] ?? bases[0];
    this.loadExisting();
    await this.pickBranch((await currentBranch(root)) ?? branches[0]?.name);
  }

  private all: Entry[] = [];

  private loadExisting() {
    this.refreshDir();
    this.all = listWalkthroughs(path.join(this.dataDir(), this.repoName()));
    this.s.existing = Object.fromEntries(this.all.map(e => [e.key, e.file]));
    this.refreshHistory();
  }

  /** 当前分支的走读记录：分支名一致，或终点提交在当前列出的提交里 */
  private refreshHistory() {
    // 已合入时列的是最近 100 个提交，里面混着别的分支合进来的，只按分支名认
    const shas = this.s.merged ? [] : this.s.commits.map(c => c.sha);
    this.s.history = this.s.branch ? forBranch(this.all, this.s.branch, shas) : [];
  }


  private async pickBranch(name?: string) {
    if (!name || !this.s.repo) { this.push(); return; }
    this.s.branch = name;
    await this.reload();
  }

  private async reload() {
    const root = this.s.repo!, branch = this.s.branch!, baseRef = this.s.baseRef;
    this.s.error = undefined;
    const tip = await revParse(root, branch);
    const fork = baseRef ? await mergeBase(root, baseRef, branch) : undefined;
    if (!tip) { this.s.error = `找不到分支 ${branch}`; this.push(); return; }
    if (!fork) { this.s.error = baseRef ? `${branch} 和 ${baseRef} 没有共同祖先` : '先选对比基准'; this.s.commits = []; this.push(); return; }
    this.s.fork = fork;
    await this.loadWork(branch);
    if (fork === tip && this.s.work) {
      // 还没有自己的提交、改动全在工作区：不算「已合入」，范围就是 分叉点 → 工作区
      this.s.merged = undefined;
      this.s.commits = [];
      this.s.forkInfo = await commitInfo(root, fork);
      this.s.range = { base: fork, head: WORK };
    } else if (fork === tip) {
      // 已合入：分叉点就是分支本身，算不出独有提交。列最近 100 个提交，范围留给人点
      this.s.merged = baseRef;
      this.s.commits = await logFrom(root, tip, 100);
      this.s.forkInfo = undefined;
      this.s.range = undefined;
    } else {
      this.s.merged = undefined;
      this.s.commits = await logRange(root, fork, tip);
      this.s.forkInfo = await commitInfo(root, fork);
      this.s.range = { base: fork, head: tip };
    }
    if (this.s.work && this.s.range) this.s.range = { ...this.s.range, head: WORK };   // 有没提交的改动：默认把它也看进去
    this.refreshHistory();
    this.push();
  }

  private async onMessage(m: any) {
    switch (m.type) {
      case 'ready': return this.push();
      case 'repo': return this.pickRepo(m.root);
      case 'branch': return this.pickBranch(m.name);
      case 'base': this.s.baseRef = m.ref; return this.reload();
      case 'range': this.s.range = { base: m.base, head: m.head }; return this.push();
      case 'open': return this.open(m.file);
      case 'item': return this.gotoItem(m.index);
      case 'generate': return this.generate();
      case 'model':
        this.s.askModel = m.value;
        await vscode.workspace.getConfiguration('walkthrough.ask').update('model', m.value || undefined, vscode.ConfigurationTarget.Global);
        return this.push();
      case 'manageModels': return this.manageModels();
      case 'delete': return this.remove(m.file);
      case 'pickDir': {
        const picked = await vscode.window.showOpenDialog({
          canSelectFolders: true, canSelectFiles: false, canSelectMany: false, openLabel: '用这个目录放走读',
          defaultUri: vscode.Uri.file(fs.existsSync(this.s.dir.full) ? this.s.dir.full : os.homedir()),
        });
        if (picked?.[0]) await this.setDir(picked[0].fsPath);
        return;
      }
      case 'useDefaultDir': return this.setDir(this.s.dir.full);
      case 'revealDir':
        fs.mkdirSync(this.s.dir.full, { recursive: true });
        return vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(this.s.dir.full));
      case 'fetch': {
        if (!this.s.repo || this.s.fetching) return;
        this.s.fetching = true; this.push();
        const r = await fetchAll(this.s.repo);
        this.s.fetching = false;
        if (!r.ok) { this.s.error = `拉取失败：${r.message}`; this.push(); return; }
        const keep = this.s.branch;
        this.s.branches = (await listBranches(this.s.repo)).map(b => ({ name: b.name, date: b.date, remote: b.name.startsWith('origin/') }));
        return this.pickBranch(keep);
      }
      case 'cancel': if (this.signal) cancel(this.signal); this.planResolve?.(undefined); this.snapResolve?.(false); return;
      case 'plan': this.planResolve?.(m.items); return;
      case 'snapshot': this.snapResolve?.(!!m.ok); return;
    }
  }

  private async manageModels() {
    const custom = this.customModels();
    const actions: { label: string; action: 'codex' | 'agent' | 'remove' }[] = [
      { label: '$(add) 添加 Codex 模型', action: 'codex' },
      { label: '$(terminal) 添加本地 Agent', action: 'agent' },
      ...(Object.keys(custom).length ? [{ label: '$(trash) 删除自定义模型', action: 'remove' as const }] : []),
    ];
    const action = await vscode.window.showQuickPick(actions, { placeHolder: '管理模型' });
    if (!action) return;
    if (action.action === 'remove') {
      const picked = await vscode.window.showQuickPick(Object.entries(custom).map(([id, m]) => ({ label: m.label, description: m.command.join(' '), id })), { placeHolder: '选择要删除的自定义模型' });
      if (!picked) return;
      delete custom[picked.id];
      if (this.s.askModel === `custom:${picked.id}`) this.s.askModel = '';
    } else if (action.action === 'codex') {
      const model = (await vscode.window.showInputBox({ title: '添加 Codex 模型', prompt: '输入 Codex CLI 支持的模型 ID', placeHolder: '例如 gpt-6.1-sol', ignoreFocusOut: true }))?.trim();
      if (!model) return;
      const builtIn = `codex-${model}`;
      if (askModelOptions(undefined).some(x => x.id === builtIn)) {
        this.s.askModel = builtIn;
        await vscode.workspace.getConfiguration('walkthrough.ask').update('model', builtIn, vscode.ConfigurationTarget.Global);
        this.refreshModels(); this.push(); return;
      }
      const id = `codex-${model}`.replace(/[^a-zA-Z0-9._-]+/g, '-');
      custom[id] = { label: `codex-${model}`, command: ['codex', 'exec', '-s', 'read-only', '--skip-git-repo-check', '-m', model, '-'], format: 'text' };
      this.s.askModel = `custom:${id}`;
    } else {
      const label = (await vscode.window.showInputBox({ title: '添加本地 Agent', prompt: '显示名称', placeHolder: '例如 Pi Agent', ignoreFocusOut: true }))?.trim();
      if (!label) return;
      const raw = await vscode.window.showInputBox({ title: `添加 ${label}`, prompt: '输入命令参数数组；插件会把提示词写入 stdin，并从 stdout 读取回答', placeHolder: '["pi", "--print"]', value: label.toLowerCase().includes('pi') ? '["pi", "--print"]' : '', ignoreFocusOut: true, validateInput: value => { try { const a = JSON.parse(value); return Array.isArray(a) && a.length && a.every(x => typeof x === 'string') ? undefined : '必须是非空的字符串数组'; } catch { return '请输入合法 JSON，例如 ["pi", "--print"]'; } } });
      if (!raw) return;
      const command = JSON.parse(raw) as string[];
      const id = `${label}-${Date.now().toString(36)}`.toLowerCase().replace(/[^a-z0-9._-]+/g, '-');
      custom[id] = { label, command, format: 'text' };
      this.s.askModel = `custom:${id}`;
    }
    const conf = vscode.workspace.getConfiguration('walkthrough.ask');
    await conf.update('models', custom, vscode.ConfigurationTarget.Global);
    await conf.update('model', this.s.askModel || undefined, vscode.ConfigurationTarget.Global);
    this.refreshModels(); this.push();
  }

  // ---- 生成 ----
  /** 删一份走读：二次确认 → 走读和问答一起进废纸篓；快照生成的可以顺带清掉快照引用 */
  private async remove(file: string) {
    const e = this.all.find(x => x.file === file);
    if (!e) return;
    const refs = this.s.repo ? await snapshotRefs(this.s.repo, e.head) : [];
    const DEL = '删除', DEL_SNAP = '删除并清理快照';
    const pick = await vscode.window.showWarningMessage(
      `删除这份走读？`,
      { modal: true, detail: `${e.title}\n${e.key} · ${e.items} 项\n\n问答记录会一起删除。文件会放进废纸篓，删错了可以从那里找回。${refs.length ? '\n\n它是用未提交快照生成的：选「删除并清理快照」会顺带删掉快照引用；只选「删除」则保留快照。' : ''}` },
      ...(refs.length ? [DEL, DEL_SNAP] : [DEL]),
    );
    if (!pick) return;
    // 一份一个文件夹（walkthrough.json）就删整个文件夹；旧的平铺结构删文件和旁边的 .answers.json
    const targets = path.basename(file) === 'walkthrough.json' ? [path.dirname(file)] : [file, answersPath(file)].filter(f => fs.existsSync(f));
    for (const t of targets) await vscode.workspace.fs.delete(vscode.Uri.file(t), { recursive: true, useTrash: true });
    if (pick === DEL_SNAP) for (const r of refs) await deleteSnapshotRef(this.s.repo!, r);
    this.closeIf(file);
    this.loadExisting();
    this.push();
    vscode.window.showInformationMessage(`已删除走读「${e.title}」${pick === DEL_SNAP ? '，快照也清理了' : ''}`);
  }

  /** 分支检出在哪、有没有没提交的改动 */
  private async loadWork(branch: string) {
    this.s.work = undefined;
    const dir = await worktreeFor(this.s.repo!, branch);
    if (!dir) return;
    const files = await dirtyFiles(dir).catch(() => []);
    if (!files.length) return;
    const home = os.homedir();
    this.s.work = { dir, files, show: dir.startsWith(home) ? '~' + dir.slice(home.length) : dir };
  }

  private async generate() {
    const { repo: root, branch } = this.s;
    let range = this.s.range;
    if (!root || !range || !branch || this.signal) return;
    const conf = vscode.workspace.getConfiguration('walkthrough');
    const selected = modelCommandFor(conf.get<string[]>('ask.command') ?? [], conf.get<AskFormat>('ask.format') ?? 'claude-stream-json', this.s.askModel, conf.get<CustomModels>('ask.models') ?? {});
    const { command, format, by } = selected;
    const specPath = expand(conf.get<string>('generate.spec') ?? '');
    const spec = fs.readFileSync(fs.existsSync(specPath) ? specPath : path.join(__dirname, 'GENERATE.md'), 'utf8');
    const sig = this.signal = newSignal();
    const set = (gen: State['gen']) => { this.s.gen = gen; this.push(); };
    try {
      // 终点是「工作区」：先列出会拍进快照的文件给人确认，再拍快照，拿快照的 sha 照常生成
      let snapshot: string | undefined;
      if (range.head === WORK) {
        const work = this.s.work;
        if (!work) throw new Error('工作区已经没有未提交的改动了，刷新一下再试');
        set({ stage: 'snapshot', note: `这些文件会拍进快照交给 AI 读（只在本机）。目录：${work.show}`, files: work.files });
        const ok = await new Promise<boolean>(res => { this.snapResolve = res; });
        this.snapResolve = undefined;
        if (!ok) { set(undefined); return; }
        const now = new Date(), pad = (n: number) => String(n).padStart(2, '0');
        const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
        snapshot = `${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`;
        set({ stage: 'plan', note: '拍快照…' });
        const sha = await snapshotWorktree(work.dir, `${branch.replace(/^origin\//, '').replace(/[^\w.-]+/g, '-')}-${stamp}`);
        range = { base: range.base, head: sha };
      }
      const commits = await logRange(root, range.base, range.head);
      if (snapshot && commits[0]) commits[0] = { ...commits[0], subject: `（未提交的改动，快照 ${snapshot}）` };
      const g: GenInput = { root, repoName: this.repoName(), remote: await remoteUrl(root), branch, base: range.base, head: range.head, commits, stat: await diffStat(root, range.base, range.head), snapshot };
      const r = { command, format, spec };
      set({ stage: 'plan', note: '读提交和改动，列出要审的几件事…' });
      const plan = await generatePlan(r, g, note => set({ stage: 'plan', note }), sig);
      set({ stage: 'confirm', note: '勾掉不用审的、改一下标题，再点「开始生成」', plan: plan.map(p => ({ ...p, checked: true })) });
      const confirmed = await new Promise<PlanItem[] | undefined>(res => { this.planResolve = res; });
      this.planResolve = undefined;
      if (!confirmed?.length) { set(undefined); return; }
      const chosen = confirmed.map((p, i) => ({ ...plan.find(x => x.id === p.id)!, title: p.title, id: `i${i + 1}` }));
      const progress: GenItem[] = chosen.map(p => ({ id: p.id, title: p.title, status: 'queue', detail: '排队中' }));
      const tick = () => set({ stage: 'items', note: `逐项生成（${progress.filter(p => p.status === 'ok').length}/${progress.length}）`, progress });
      tick();
      const results = await pool(chosen, 3, async (p, i) => {
        progress[i].status = 'run'; tick();
        try {
          const out = await generateItem(r, g, p, chosen, d => { progress[i].detail = d; tick(); }, sig);
          progress[i].status = 'ok';
          progress[i].detail = out.warnings.length ? `完成，${out.warnings.length} 条提醒` : '完成';
          return out.item;
        } catch (e) {
          progress[i].status = 'fail'; progress[i].detail = (e as Error).message.split('\n')[0];
          throw e;
        } finally { tick(); }
      });
      const items = results.flatMap(x => x.status === 'fulfilled' ? [x.value] : []);
      if (sig.cancelled) { set(undefined); return; }
      if (!items.length) { set({ stage: 'error', note: '每一项都生成失败了，看上面的原因', progress }); return; }
      const file = walkthroughFile(this.dataDir(), g.repoName, g.base, g.head);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, JSON.stringify(assemble(g, items, by), null, 2) + '\n');
      this.loadExisting();
      const failed = progress.filter(p => p.status === 'fail').length;
      set(undefined);
      if (failed) vscode.window.showWarningMessage(`走读已生成，但有 ${failed} 项失败没写进去`);
      await this.open(file);
    } catch (e) {
      set(sig.cancelled ? undefined : { stage: 'error', note: (e as Error).message, progress: this.s.gen?.progress });
    } finally {
      this.signal = undefined;
    }
  }
}
