// 编辑器里的快速问答：在走读快照上选几行，点行号旁的「+」就地提问，回答出现在代码下面。
// 用 VS Code 自带的评论框；不写 answers.json，关掉就没了。同一个框里的前几轮会当上下文带上。
import * as vscode from 'vscode';
import { AskFormat, CustomModels, QuickTurn, buildQuickPrompt, commandLinks, linkifyRefs, modelCommandFor, runAsk, systemPrompt } from './ask';
import { Item, Walkthrough } from './model';
import { SCHEME, parseSnapUri } from './snapshot';

export interface QuickHost {
  context(): { w: Walkthrough; root: string; paths: string[]; item?: Item } | undefined;
}

const ME = { name: '你' };
const AI = (by: string) => ({ name: by });

class Turn implements vscode.Comment {
  mode = vscode.CommentMode.Preview;
  constructor(public body: string | vscode.MarkdownString, public author: vscode.CommentAuthorInformation, public label?: string) {}
}

/** 回答里的 [文件:行](路径#L行) → 命令链接，点了用和面板同一套方式打开引用 */
export function toCommandLinks(md: string): vscode.MarkdownString {
  const m = new vscode.MarkdownString(commandLinks(md));
  m.isTrusted = { enabledCommands: ['walkthrough.openRef'] };
  return m;
}

export class QuickAsk implements vscode.Disposable {
  private ctrl = this.createController();
  private cancels = new Map<vscode.CommentThread, () => void>();
  private turns = new Map<vscode.CommentThread, QuickTurn[]>();

  constructor(private host: QuickHost) {}

  private createController(): vscode.CommentController {
    const ctrl = vscode.comments.createCommentController('walkthrough-quick', '走读快速问答');
    // 只在走读快照上能提问（head、base 两侧都可以）
    ctrl.commentingRangeProvider = {
      provideCommentingRanges: doc => doc.uri.scheme === SCHEME && this.host.context()
        ? [new vscode.Range(0, 0, Math.max(doc.lineCount - 1, 0), 0)] : [],
    };
    ctrl.options = { prompt: '就选中的代码提问（不保存）', placeHolder: '回车提交 · 回答显示在这里，关掉就没了' };
    return ctrl;
  }

  async reply(r: vscode.CommentReply) {
    const q = r.text.trim();
    const t = r.thread;
    if (!q) return;
    const c = this.host.context();
    if (!c) { vscode.window.showWarningMessage('先打开一份走读'); return; }
    t.label = '快速问答 · 不保存';
    t.canReply = true;
    t.contextValue = 'quick';

    const doc = await vscode.workspace.openTextDocument(t.uri);
    const { relPath, sha } = parseSnapUri(t.uri);
    const selStart = t.range!.start.line + 1, selEnd = t.range!.end.line + 1;
    const start = Math.max(1, selStart - 5), end = Math.min(doc.lineCount, selEnd + 5);
    const lines = Array.from({ length: end - start + 1 }, (_, i) => doc.lineAt(start - 1 + i).text);
    const side = sha === c.w.meta.anchor.head ? 'head' : 'base';
    const history = this.turns.get(t) ?? [];
    const prompt = buildQuickPrompt(c.w, c.item, { path: relPath, sha, side, start, end, selStart, selEnd, lines }, history, q);

    const conf = vscode.workspace.getConfiguration('walkthrough.ask');
    const { command, format, by } = modelCommandFor(conf.get<string[]>('command') ?? [], conf.get<AskFormat>('format') ?? 'claude-stream-json', conf.get<string>('model') ?? '', conf.get<CustomModels>('models') ?? {});
    const answer = new Turn('思考中…', AI(by));
    t.comments = [...t.comments, new Turn(q, ME), answer];

    let text = '', last = 0;
    const refresh = (body: string | vscode.MarkdownString, label?: string) => { answer.body = body; answer.label = label; t.comments = [...t.comments]; };
    this.cancels.get(t)?.();
    const run = runAsk(command, format, c.root, systemPrompt(c.w.meta.anchor.base, c.w.meta.anchor.head), prompt, ev => {
      if (ev.kind === 'text') text = format === 'text' ? ev.text : (text ? text + '\n\n' : '') + ev.text;
      if (ev.kind === 'result') return;
      const now = Date.now();
      if (now - last < 300) return;
      last = now;
      refresh(text ? toCommandLinks(linkifyRefs(text, c.paths)) : '思考中…', ev.kind === 'tool' ? `正在查看：${ev.label}` : '回答中…');
    });
    this.cancels.set(t, run.cancel);
    // 不 await：VS Code 要等提交命令返回才清空输入框，所以命令立刻返回，回答在后台跑完再刷进框里
    void run.done.then(a => {
      refresh(toCommandLinks(linkifyRefs(a, c.paths)));
      this.turns.set(t, [...history, { q, a }]);
    }, e => {
      refresh(`出错了：${(e as Error).message}`, '出错');
    }).finally(() => {
      if (this.cancels.get(t) === run.cancel) this.cancels.delete(t);
    });
  }

  remove(t: vscode.CommentThread) {
    this.cancels.get(t)?.();
    this.cancels.delete(t); this.turns.delete(t);
    t.dispose();
  }

  /** 换了一份走读：之前的快速问答全部清掉 */
  reset() {
    for (const c of this.cancels.values()) c();
    this.cancels.clear(); this.turns.clear();
    this.ctrl.dispose();
    this.ctrl = this.createController();
  }

  dispose() { for (const c of this.cancels.values()) c(); this.ctrl.dispose(); }
}
