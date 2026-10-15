// 走读 JSON（schema v2）的类型与加载。左侧每一项 = 一件要审的事；每项一条核心链条。
import * as fs from 'fs';

export interface Anchor { path: string; start: number; end: number; line: number }
export interface DiffStat { added: number; modified: number; deleted: number }
export interface Note { line: number; text: string }
export interface ChainNode {
  id: string; step: string; symbol: string; anchor: Anchor;
  text: string; was?: string; core?: boolean;
  notes?: Note[];                       // 修改说明：一处改动一句，line 是 head 侧的改动行
  diff?: DiffStat; changed?: boolean;   // finalize.py 按真实 git diff 回填
}
export interface Item {
  id: string; title: string; commits?: string[];
  why: string; idea: string; scenario: string; before: string; after: string;
  chain: ChainNode[]; side?: string;
}
export interface Finding {
  id: string; source: 'pr' | 'reviewer'; claim: string;
  verdict: 'confirmed' | 'refuted' | 'partial' | 'unverified'; evidence: string; items: string[];
}
export interface Walkthrough {
  schemaVersion: string; kind: 'code' | 'arch'; id: string;
  meta: {
    title: string; summary: string;
    repo: { name: string; remote?: string };
    anchor: { base: string | null; head: string; branch?: string; pr?: number };
  };
  items: Item[]; findings: Finding[];
}

/** 摊平后的节点：「下一步」跨项连续走 */
export interface NodeRef { flat: number; itemIndex: number; nodeIndex: number; item: Item; node: ChainNode }

export function flatten(w: Walkthrough): NodeRef[] {
  const out: NodeRef[] = [];
  w.items.forEach((item, itemIndex) => item.chain.forEach((node, nodeIndex) =>
    out.push({ flat: out.length, itemIndex, nodeIndex, item, node })));
  return out;
}

export function loadWalkthrough(file: string): Walkthrough {
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (raw.schemaVersion !== '2') throw new Error(`走读 JSON 版本是 ${raw.schemaVersion ?? '未知'}，插件只认 2`);
  if (!Array.isArray(raw.items) || !raw.items.length) throw new Error('走读 JSON 没有 items');
  if (!raw.meta?.anchor?.head) throw new Error('走读 JSON 缺少 meta.anchor.head，无法取代码快照');
  if (!raw.meta?.repo?.name) throw new Error('走读 JSON 缺少 meta.repo.name，无法定位本地仓库');
  raw.findings ??= [];
  return raw as Walkthrough;
}

export function findingsForItem(w: Walkthrough, itemId: string): Finding[] {
  return w.findings.filter(f => f.items?.includes(itemId));
}

/** 正文链接目标：仓库相对路径 + 可选 #L行 或 #L起-L止 */
export function parseLinkTarget(target: string): { kind: 'url'; url: string } | { kind: 'file'; path: string; line?: number; end?: number } {
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(target)) return { kind: 'url', url: target };
  const m = target.match(/^([^#]+)(?:#L(\d+)(?:-L?(\d+))?)?$/);
  if (!m) return { kind: 'file', path: target };
  return { kind: 'file', path: m[1], line: m[2] ? +m[2] : undefined, end: m[3] ? +m[3] : undefined };
}
