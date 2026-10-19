// 点击提问：拼上下文 → 调本机 claude / codex（只读、在本地仓库目录运行）→ 解析输出 → 存到 <走读>.answers.json。
// 不依赖 vscode，方便单测。
import { spawn } from 'child_process';
import * as fs from 'fs';
import { Item, Walkthrough } from './model';

export type AskKind = 'why' | 'idea' | 'scenario' | 'node' | 'note';
export interface AskTarget { item: string; kind: AskKind; node?: string; line?: number }
export interface Answer {
  id: string; target: AskTarget; q: string; a: string; at: string; by: string;
  status?: 'running' | 'done' | 'error';   // 以下两个只在内存里用，不落盘
  progress?: string;
}

export const targetKey = (t: AskTarget) => [t.item, t.kind, t.node ?? '', t.line ?? ''].join(':');

const KIND_LABEL: Record<AskKind, string> = { why: '修改原因', idea: '改的核心思想', scenario: '场景', node: '链条中的一步', note: '一条修改说明' };

export function describeTarget(item: Item, t: AskTarget): { label: string; text: string } {
  if (t.kind === 'why') return { label: KIND_LABEL.why, text: item.why };
  if (t.kind === 'idea') return { label: KIND_LABEL.idea, text: item.idea };
  if (t.kind === 'scenario') return { label: KIND_LABEL.scenario, text: `${item.scenario}\n以前：${item.before}\n现在：${item.after}` };
  const i = item.chain.findIndex(n => n.id === t.node);
  const n = item.chain[i];
  if (!n) return { label: KIND_LABEL[t.kind], text: '' };
  if (t.kind === 'note') {
    const note = n.notes?.find(x => x.line === t.line);
    return { label: `第 ${i + 1} 步「${n.step}」第 ${t.line} 行的修改说明`, text: note?.text ?? '' };
  }
  return { label: `第 ${i + 1} 步「${n.step}」`, text: `${n.symbol} @ ${n.anchor.path}:${n.anchor.line}\n${n.text}${n.was ? `\n以前：${n.was}` : ''}` };
}

export function systemPrompt(base: string | null, head: string): string {
  return [
    '你在帮一位工程师审阅一次代码变更，对方正在看一份「走读」：按调用链条一步步解释这次改了什么、为什么改。',
    `代码以提交 ${head} 为准。本地工作区可能不在这个版本，看文件请用 \`git show ${head}:<路径>\`` +
      (base ? `；看改之前用 \`git show ${base}:<路径>\` 或 \`git diff ${base} ${head} -- <路径>\`。` : '。'),
    '只读：不要修改任何文件，不要执行除 git show / git log / git diff 以外的命令。',
    '用简体中文、中性专业的语气回答，不用角色语气、称呼或颜文字：回答会存档给其他同事看。',
    '',
    '## 回答要言简意赅，直切重点',
    '- 第一句就是结论，直接回答问的那件事。',
    '- 然后最多 3 条「- 」要点，每条一句话，带一处代码引用。问题里有几个小问题，就逐个一行简答，开头加粗那个小问题。',
    '- 确实有值得留意的点，最后用「留意：」写一两句；没有就不写。',
    '- 不复述走读里已经写过的背景，不讲问题以外的东西，不加小标题，不铺垫。',
    '- 篇幅建议在 200 字左右，这是参考不是硬限制：把问题讲清楚需要的话可以超出一些，但别为了凑全而铺开。',
    '- 不确定就直说不确定，不要编。',
    '',
    '## 引用代码',
    '写成 Markdown 链接，路径相对仓库根，行号是上面那个提交里的行号，例如 [service.go:30-34](internal/payment/service.go#L30-L34)。对方点链接会跳到那几行，并把这句话挂在代码旁边当说明，所以带引用的那句要能单独读懂。',
    '',
    '提示词里带了之前的问答记录：对方说「前面的回复」「刚才问的」时，指的就是记录里的那几条，直接基于它们回答，不要说看不到。',
  ].join('\n');
}

export interface CodeContext { path: string; start: number; end: number; lines: string[]; diff: string[] }

const clip = (s: string, n: number) => s.length > n ? s.slice(0, n) + '…（后略）' : s;

/** 之前的问答：同一段的完整带上（当成对话前文，最近 6 条）；这一项其他段的只带问题 + 前 300 字（最近 10 条） */
export function historyFor(t: AskTarget, answers: Answer[]): { same: Answer[]; others: Answer[] } {
  const done = answers.filter(a => a.status !== 'running' && a.status !== 'error' && a.target.item === t.item)
    .sort((a, b) => a.at.localeCompare(b.at));
  const key = targetKey(t);
  return { same: done.filter(a => targetKey(a.target) === key).slice(-6), others: done.filter(a => targetKey(a.target) !== key).slice(-10) };
}

export function buildPrompt(w: Walkthrough, item: Item, t: AskTarget, question: string, code?: CodeContext, answers: Answer[] = []): string {
  const tgt = describeTarget(item, t);
  const chain = item.chain.map((n, i) =>
    `${i + 1}. ${n.core ? '★' : n.changed ? '●' : '○'} ${n.step} · ${n.symbol} · ${n.anchor.path}:${n.anchor.line} — ${n.text.replace(/\n/g, ' ')}`).join('\n');
  const parts = [
    `# 变更：${w.meta.title}`,
    `base ${w.meta.anchor.base ?? '（无）'} → head ${w.meta.anchor.head}${w.meta.anchor.pr ? ` · PR #${w.meta.anchor.pr}` : ''}`,
    `## 正在审的一项：${item.title}`,
    `修改原因：${item.why}`, `改的核心思想：${item.idea}`,
    `场景：${item.scenario}`, `以前：${item.before}`, `现在：${item.after}`,
    `## 核心链条（★ 核心 · ● 本次改了 · ○ 只是经过）`, chain,
    `## 对方点选的是：${tgt.label}`, tgt.text,
  ];
  const otherItems = w.items.filter(i => i.id !== item.id);
  if (otherItems.length) parts.splice(2, 0, '## 这份走读的其他项（只作背景）',
    ...otherItems.map(i => `- ${i.title}：${clip(i.why.replace(/\n/g, ' '), 120)}`));
  const label = (a: Answer) => describeTarget(item, a.target).label;
  const { same, others } = historyFor(t, answers);
  if (others.length) parts.push('## 这一项里其他地方问过的（节选）',
    ...others.map(a => `- 【${label(a)}】问：${a.q}\n  答：${clip(a.a.replace(/\n+/g, ' '), 300)}`));
  if (same.length) parts.push('## 之前在这一段上的问答（按时间，最后一条最近）',
    ...same.map((a, i) => `### 第 ${i + 1} 轮 · ${a.at.slice(0, 16).replace('T', ' ')}\n问：${a.q}\n答：\n${a.a}`));
  if (code) {
    const width = String(code.end).length;
    parts.push(`## 这一步的代码（head 版本 ${code.path}:${code.start}-${code.end}）`, '```',
      ...code.lines.map((l, i) => `${String(code.start + i).padStart(width)}  ${l}`), '```');
    if (code.diff.length) parts.push('## 这一步范围内的改动（- 改前 / + 改后）', '```diff', ...code.diff, '```');
  }
  parts.push('## 问题', question);
  return parts.join('\n');
}

/** claude --output-format stream-json 的一行 → 我们关心的事件 */
export type AskEvent = { kind: 'text'; text: string } | { kind: 'tool'; label: string } | { kind: 'result'; text: string; error: boolean };

export function parseClaudeLine(line: string): AskEvent[] {
  let e: any;
  try { e = JSON.parse(line); } catch { return []; }
  if (e?.type === 'assistant' && Array.isArray(e.message?.content)) {
    return e.message.content.flatMap((c: any): AskEvent[] => {
      if (c.type === 'text' && c.text) return [{ kind: 'text', text: c.text }];
      if (c.type === 'tool_use') {
        const inp = c.input ?? {};
        const what = inp.command ?? inp.file_path ?? inp.pattern ?? '';
        return [{ kind: 'tool', label: `${c.name}${what ? ` ${String(what).slice(0, 80)}` : ''}` }];
      }
      return [];
    });
  }
  if (e?.type === 'result') return [{ kind: 'result', text: String(e.result ?? ''), error: !!e.is_error || e.subtype !== 'success' }];
  return [];
}

export type AskFormat = 'claude-stream-json' | 'text';

// ---- 统一模型：左侧选一次，生成走读、面板问答、编辑器快速问答都用它 ----
export const CLAUDE_MODELS = ['claude-fable', 'claude-opus', 'claude-sonnet', 'claude-haiku'];
export const CODEX_MODELS = ['gpt-6.1-sol', 'gpt-6-astra', 'gpt-6-sol', 'gpt-6-luna', 'gpt-5.6-sol'];
export interface CustomModel { label: string; command: string[]; format?: AskFormat }
export type CustomModels = Record<string, CustomModel>;

/** 下拉选项：Claude、多个 Codex 模型、本机 Codex 默认，以及用户添加的本地 Agent。 */
export function askModelOptions(codexConfig?: string, custom: CustomModels = {}): { id: string; label: string; custom?: boolean }[] {
  const m = codexConfig?.match(/^\s*model\s*=\s*"([^"]+)"/m)?.[1];
  const codex = [...new Set([m, ...CODEX_MODELS].filter((x): x is string => !!x))];
  return [
    { id: '', label: '默认' },
    ...CLAUDE_MODELS.map(id => ({ id, label: id })),
    { id: 'codex', label: 'codex-默认' },
    ...codex.map(model => ({ id: `codex-${model}`, label: `codex-${model}` })),
    ...Object.entries(custom).map(([id, value]) => ({ id: `custom:${id}`, label: `自定义 · ${value.label}`, custom: true })),
  ];
}

/** 「厂商-模型」→ 厂商与模型；旧值（opus、codex）兼容：没有厂商前缀的当作 claude */
export function parseAskModel(v: string): { vendor: 'claude' | 'codex'; model: string } | undefined {
  if (!v) return undefined;
  if (v === 'codex') return { vendor: 'codex', model: '' };
  const m = v.match(/^(claude|codex)-(.+)$/);
  return m ? { vendor: m[1] as 'claude' | 'codex', model: m[2] } : { vendor: 'claude', model: v };
}

/** 按选的模型调整问答命令：claude 加 --model；codex 换成只读沙箱的 codex exec（-m 指定模型），输出按纯文本处理 */
export function askCommandFor(command: string[], format: AskFormat, model: string): { command: string[]; format: AskFormat; by: string } {
  const p = parseAskModel(model);
  if (p?.vendor === 'codex') return { command: ['codex', 'exec', '-s', 'read-only', '--skip-git-repo-check', ...(p.model ? ['-m', p.model] : []), '-'], format: 'text', by: p.model ? `codex-${p.model}` : 'codex' };
  const base = { command, format, by: command[0]?.split('/').pop() ?? 'AI' };
  if (!p || !/(^|\/)claude$/.test(command[0] ?? '')) return base;
  const rest = command.slice(1);
  const at = rest.indexOf('--model');
  if (at >= 0) rest.splice(at, 2);
  return { command: [command[0], '--model', p.model, ...rest], format, by: `claude-${p.model}` };
}

/** 解析统一模型选择；自定义 Agent 的提示词走 stdin，回答从 stdout 读取。 */
export function modelCommandFor(command: string[], format: AskFormat, model: string, custom: CustomModels = {}): { command: string[]; format: AskFormat; by: string } {
  if (!model.startsWith('custom:')) return askCommandFor(command, format, model);
  const preset = custom[model.slice('custom:'.length)];
  if (!preset?.command?.length) throw new Error(`找不到自定义模型：${model}`);
  return { command: preset.command, format: preset.format ?? 'text', by: preset.label || model };
}


/** 用参数数组启动（不经过 shell），提示词走 stdin。{system} 占位符替换成系统提示。 */
export function runAsk(
  command: string[], format: AskFormat, cwd: string, system: string, prompt: string,
  onEvent: (e: AskEvent) => void, timeoutMs = 5 * 60_000,
): { done: Promise<string>; cancel: () => void } {
  const [bin, ...rest] = command.map(a => a.replace('{system}', system));
  // 有的 CLI（如 codex）没有追加系统提示的参数：命令里没放 {system} 就把它拼在提示词前面，规矩不丢
  if (system && !command.some(a => a.includes('{system}'))) prompt = `${system}\n\n---\n\n${prompt}`;
  const child = spawn(bin, rest, { cwd, stdio: ['pipe', 'pipe', 'pipe'], env: process.env });
  let out = '', err = '', buf = '', result: string | undefined, failed = false;
  const timer = setTimeout(() => child.kill('SIGTERM'), timeoutMs);
  const done = new Promise<string>((resolve, reject) => {
    child.on('error', e => { clearTimeout(timer); reject(new Error(`启动 ${bin} 失败：${e.message}`)); });
    child.stdout.on('data', (d: Buffer) => {
      const s = d.toString();
      if (format === 'text') { out += s; onEvent({ kind: 'text', text: out }); return; }
      buf += s;
      let i: number;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i); buf = buf.slice(i + 1);
        for (const ev of parseClaudeLine(line)) {
          if (ev.kind === 'result') { result = ev.text; failed = ev.error; }
          onEvent(ev);
        }
      }
    });
    child.stderr.on('data', (d: Buffer) => { err += d.toString(); });
    child.on('close', code => {
      clearTimeout(timer);
      if (format === 'text') return code === 0 ? resolve(out.trim()) : reject(new Error(err.trim() || `${bin} 退出码 ${code}`));
      if (result !== undefined && !failed) return resolve(result.trim());
      reject(new Error(result || err.trim() || `${bin} 退出码 ${code}，没有返回结果`));
    });
  });
  child.stdin.end(prompt);
  return { done, cancel: () => child.kill('SIGTERM') };
}

// ---- answers.json：和走读 JSON 放在一起，同名加 .answers ----

export interface AnswersFile { schemaVersion: '1'; walkthrough: string; head: string; answers: Answer[] }

export const answersPath = (walkthroughPath: string) => walkthroughPath.replace(/\.json$/i, '') + '.answers.json';

export function loadAnswers(walkthroughPath: string): Answer[] {
  const p = answersPath(walkthroughPath);
  if (!fs.existsSync(p)) return [];
  const f = JSON.parse(fs.readFileSync(p, 'utf8')) as AnswersFile;
  return (f.answers ?? []).map(a => ({ ...a, status: 'done' as const }));
}

/** 先读后写：别的窗口刚存的回答不会被覆盖 */
export function saveAnswer(walkthroughPath: string, w: Walkthrough, a: Answer): void {
  const p = answersPath(walkthroughPath);
  const cur: AnswersFile = fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8'))
    : { schemaVersion: '1', walkthrough: w.id, head: w.meta.anchor.head, answers: [] };
  const { status: _s, progress: _p, ...clean } = a;
  cur.answers = [...cur.answers.filter(x => x.id !== a.id), clean];
  const tmp = p + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(cur, null, 2) + '\n');
  fs.renameSync(tmp, p);
}

// ---- 回答里的代码引用 → 可跳转链接 ----

const REF = /`?((?:[\w.-]+\/)*[\w.-]+\.[a-z]{1,5}):(\d+)(?:-(\d+))?`?/g;

/** 「文件:行号」→ 仓库相对路径。含目录的按后缀匹配；只有文件名的，唯一才算，多个时优先这一项链条里出现过的；判断不出就不链。 */
export function resolveRefPath(token: string, paths: string[], prefer: string[] = []): string | undefined {
  const hits = paths.filter(p => p === token || p.endsWith('/' + token));
  if (hits.length === 1) return hits[0];
  const preferred = hits.filter(h => prefer.includes(h));
  return preferred.length === 1 ? preferred[0] : undefined;
}

/** 把回答正文里裸写的 service.go:30-34 变成 [service.go:30-34](路径#L30-L34)；已经是链接的不动 */
export function linkifyRefs(text: string, paths: string[], prefer: string[] = []): string {
  if (!paths.length) return text;
  const LINK = /\[[^\]]+\]\([^)]+\)/g;
  let out = '', last = 0, m: RegExpExecArray | null;
  const fix = (seg: string) => seg.replace(REF, (all, file: string, a: string, b?: string) => {
    const p = resolveRefPath(file, paths, prefer);
    if (!p) return all;
    const label = `${file.split('/').pop()}:${a}${b ? `-${b}` : ''}`;
    return `[${label}](${p}#L${a}${b ? `-L${b}` : ''})`;
  });
  while ((m = LINK.exec(text))) { out += fix(text.slice(last, m.index)) + m[0]; last = m.index + m[0].length; }
  return out + fix(text.slice(last));
}

// ---- 编辑器里的快速问答：不落盘，同一个评论框里的前几轮当上下文 ----

export interface QuickTurn { q: string; a: string }
export interface QuickCode { path: string; sha: string; side: 'head' | 'base'; start: number; end: number; selStart: number; selEnd: number; lines: string[] }

export function buildQuickPrompt(w: Walkthrough, item: Item | undefined, code: QuickCode, turns: QuickTurn[], question: string): string {
  const width = String(code.end).length;
  const parts = [
    `# 变更：${w.meta.title}`,
    `base ${w.meta.anchor.base ?? '（无）'} → head ${w.meta.anchor.head}`,
  ];
  if (item) parts.push(`## 对方正在看的一项：${item.title}`, `修改原因：${item.why}`, `改的核心思想：${item.idea}`);
  parts.push(
    `## 对方在编辑器里选中的代码：${code.path} 第 ${code.selStart}-${code.selEnd} 行（${code.side === 'base' ? '改之前，base' : '改之后，head'} 版本 ${code.sha.slice(0, 8)}）`,
    '前后各多给了几行上下文，选中的行前面标了 ▶。', '```',
    ...code.lines.map((l, i) => {
      const n = code.start + i;
      return `${n >= code.selStart && n <= code.selEnd ? '▶' : ' '} ${String(n).padStart(width)}  ${l}`;
    }), '```');
  if (turns.length) parts.push('## 这个框里之前的问答', ...turns.map((t, i) => `### 第 ${i + 1} 轮\n问：${t.q}\n答：\n${t.a}`));
  parts.push('## 问题', question);
  return parts.join('\n');
}

/** 回答里的 [文件:行](仓库相对路径#L行) → command:walkthrough.openRef 链接（评论框里用）；http 等外链不动。
 *  参数带上所在那一行的纯文本，点过去挂在代码旁边当说明，和面板里一样。 */
export function commandLinks(md: string): string {
  const LINK = /\[([^\]]+)\]\(([^)\s]+)\)/g;
  return md.split('\n').map(line => {
    const why = line.replace(LINK, '$1').replace(/\*\*|`/g, '').replace(/^\s*(?:[-*]|\d+[.)])\s+/, '').trim();
    return line.replace(LINK, (all, label: string, target: string) => {
      if (/^[a-z][a-z0-9+.-]*:/i.test(target)) return all;
      return `[${label}](command:walkthrough.openRef?${encodeURIComponent(JSON.stringify([target, why, label]))})`;
    });
  }).join('\n');
}
