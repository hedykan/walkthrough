// 生成走读：阶段一列项（交给人确认）→ 阶段二逐项生成 → 定稿校验，不过就带着报错让 AI 修（最多 2 轮）→ 拼成走读文件。
// 生成规范在 GENERATE.md，作为系统提示传入。不依赖 vscode，方便单测。
import * as path from 'path';
import { AskEvent, AskFormat, runAsk } from './ask';
import { Finalizer } from './finalize';
import { CommitInfo } from './git';
import { Item, Walkthrough } from './model';

export interface GenInput {
  root: string; repoName: string; remote?: string;
  branch: string; base: string; head: string;
  commits: CommitInfo[]; stat: string;
  /** 终点是工作区快照时，快照的时间（MM-DD HH:mm），用在标题里 */
  snapshot?: string;
}
export interface PlanItem { id: string; title: string; why: string; entry?: string; commits?: string[]; files?: string[] }
export interface Runner { command: string[]; format: AskFormat; spec: string; timeoutMs?: number }

const MAX_REPAIR = 2;

/** 从 AI 输出里取 JSON：优先最后一个 ```json 代码块，否则取第一个 { 到最后一个 } */
export function extractJson(text: string): any {
  const blocks = [...text.matchAll(/```(?:json)?\s*\n([\s\S]*?)\n```/g)].map(m => m[1]);
  const cand = blocks.length ? blocks[blocks.length - 1] : text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1);
  try { return JSON.parse(cand); }
  catch (e) { throw new Error(`AI 输出的不是合法 JSON：${(e as Error).message}\n开头：${text.slice(0, 200)}`); }
}

function context(g: GenInput): string {
  return [
    `# 仓库：${g.repoName}`,
    `分支 ${g.branch} · base ${g.base}（与主干的分叉点）→ head ${g.head}`,
    '## 提交（新的在前）',
    ...g.commits.map(c => `- ${c.short} ${c.subject}${c.merge ? '（合并提交）' : ''}`),
    '## 改动文件（git diff --stat）', '```', g.stat || '（无）', '```',
  ].join('\n');
}

export const systemFor = (spec: string, g: GenInput) =>
  `${spec}\n\n---\n本次：base = ${g.base}，head = ${g.head}。代码以 head 为准，用 \`git show ${g.head}:<路径>\` 看文件，用 \`git diff ${g.base} ${g.head} -- <路径>\` 看改动。`;

export const planPrompt = (g: GenInput) =>
  `${context(g)}\n\n## 任务\n按规范的「阶段一：列项」，列出这次要审的几件事。只输出一个 JSON 代码块。`;

export const itemPrompt = (g: GenInput, p: PlanItem, all: PlanItem[]) => [
  context(g),
  '## 已确认要审的几项（只写其中一项，其余是为了让你知道边界、别重复）',
  ...all.map(x => `- ${x.id} ${x.title}${x.id === p.id ? '  ← 写这一项' : ''}`),
  '## 这一项', '```json', JSON.stringify(p, null, 2), '```',
  `## 任务\n按规范的「阶段二：写一项」，输出这一项的完整 JSON。id 用 ${p.id}，链条每步 id 用 ${p.id}-n1、${p.id}-n2…。只输出一个 JSON 代码块。`,
].join('\n');

export const repairPrompt = (g: GenInput, item: unknown, errors: string[]) => [
  context(g),
  '## 你上一次写的这一项没有通过校验',
  '```json', JSON.stringify(item, null, 2), '```',
  '## 校验报错（逐条修正；行号、函数名以 head 代码为准，先用 git show 核对再改）',
  ...errors.map(e => `- ${e}`),
  '## 任务\n输出修正后的完整 JSON（同一项、同样的 id）。只输出一个 JSON 代码块。',
].join('\n');

export type Progress = (detail: string) => void;

function ask(r: Runner, g: GenInput, prompt: string, onProgress: Progress, signal: { cancelled: boolean; cancels: Set<() => void> }) {
  if (signal.cancelled) return Promise.reject(new Error('已取消'));
  const run = runAsk(r.command, r.format, g.root, systemFor(r.spec, g), prompt, (e: AskEvent) => {
    if (e.kind === 'tool') onProgress(`正在查看：${e.label}`);
  }, r.timeoutMs ?? 20 * 60_000);
  signal.cancels.add(run.cancel);
  return run.done.finally(() => signal.cancels.delete(run.cancel));
}

export async function generatePlan(r: Runner, g: GenInput, onProgress: Progress, signal: Signal): Promise<PlanItem[]> {
  onProgress('读提交和改动，列出要审的几件事…');
  const out = extractJson(await ask(r, g, planPrompt(g), onProgress, signal));
  const items: PlanItem[] = Array.isArray(out) ? out : out.items;
  if (!Array.isArray(items) || !items.length) throw new Error('AI 没有列出任何一项');
  return items.map((x, i) => ({ ...x, id: `i${i + 1}`, title: String(x.title ?? ''), why: String(x.why ?? '') }));
}

export async function generateItem(r: Runner, g: GenInput, p: PlanItem, all: PlanItem[], onProgress: Progress, signal: Signal): Promise<{ item: Item; warnings: string[] }> {
  const fin = new Finalizer(g.root, g.base, g.head);
  onProgress('沿链条读代码…');
  let item = extractJson(await ask(r, g, itemPrompt(g, p, all), onProgress, signal)) as Item;
  for (let round = 0; ; round++) {
    item.id = p.id;
    if (p.commits && !item.commits) item.commits = p.commits;
    onProgress(round ? `第 ${round} 轮修正后重新校验…` : '校验锚点与改动…');
    const { errors, warnings } = await fin.check(item);
    if (!errors.length) return { item, warnings };
    if (round >= MAX_REPAIR) throw new Error(`修了 ${MAX_REPAIR} 轮仍没通过校验：\n${errors.join('\n')}`);
    onProgress(`校验没过（${errors.length} 处），交回 AI 修正…`);
    item = extractJson(await ask(r, g, repairPrompt(g, item, errors), onProgress, signal)) as Item;
  }
}

export interface Signal { cancelled: boolean; cancels: Set<() => void> }
export const newSignal = (): Signal => ({ cancelled: false, cancels: new Set() });
export function cancel(s: Signal) { s.cancelled = true; for (const c of s.cancels) c(); s.cancels.clear(); }

/** 并发跑，最多同时 limit 个 */
export async function pool<T, R>(xs: T[], limit: number, fn: (x: T, i: number) => Promise<R>): Promise<PromiseSettledResult<R>[]> {
  const out: PromiseSettledResult<R>[] = new Array(xs.length);
  let next = 0;
  const worker = async () => {
    while (next < xs.length) {
      const i = next++;
      try { out[i] = { status: 'fulfilled', value: await fn(xs[i], i) }; }
      catch (e) { out[i] = { status: 'rejected', reason: e }; }
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, xs.length) }, worker));
  return out;
}

export function assemble(g: GenInput, items: Item[], by: string): Walkthrough {
  const branch = g.branch.replace(/^origin\//, '');
  const title = g.snapshot ? `${branch}（未提交快照 ${g.snapshot}）`
    : g.commits.length === 1 ? g.commits[0].subject : `${branch}（${g.commits.length} 个提交）`;
  return {
    schemaVersion: '2', kind: 'code', id: `${g.repoName}:${g.base.slice(0, 8)}..${g.head.slice(0, 8)}`,
    meta: {
      title, summary: items.map(i => i.title).join('；'),
      repo: { name: g.repoName, ...(g.remote ? { remote: g.remote } : {}) },
      anchor: { base: g.base, head: g.head, branch: g.branch, ...(g.snapshot ? { snapshot: true } : {}) },
      generatedBy: { tool: 'walkthrough-ext', ai: by, at: new Date().toISOString() },
    } as Walkthrough['meta'],
    items, findings: [],
  };
}

export const walkthroughKey = (base: string, head: string) => `${base.slice(0, 8)}..${head.slice(0, 8)}`;
export const walkthroughFile = (dataDir: string, repoName: string, base: string, head: string) =>
  path.join(dataDir, repoName, 'code', `${walkthroughKey(base, head)}.json`);
