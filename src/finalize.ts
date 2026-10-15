// 定稿：校验 AI 生成的一项，并按真实 git diff 回填每步的改动统计。规则与 walkthrough/finalize.py 一致，改一边记得改另一边。
import { gitDiff, gitShow } from './git';
import { FileDiff, parseDiff } from './diff';
import { Item } from './model';

const HTML_TAG = /<\s*\/?\s*[a-zA-Z][^>]*>/;
const ABS_PATH = /(^|[^\w.])(\/Users\/|\/home\/|~\/|[A-Z]:\\)/;
const MD_FIELDS = ['why', 'idea', 'scenario', 'before', 'after', 'side'] as const;
const REQUIRED = ['title', 'why', 'idea', 'scenario', 'before', 'after'] as const;
/** 只有这些代码文件才检查「这一段属于哪个函数」；SQL、文档、配置里没有函数，symbol 写段落名，不检查 */
const CODE_EXT = /\.(go|php|js|jsx|ts|tsx|mjs|cjs|py|java|kt|rb|rs|swift|c|cc|cpp|h|hpp|cs)$/i;
/** 往上找「这一段属于哪个函数」：Go func、PHP / JS function、Python def */
const OWNER = /^\s*(?:(?:public|private|protected|static|final|abstract|async|export)\s+)*(?:func|function|def)\b/;

export interface Checked { errors: string[]; warnings: string[] }

export class Finalizer {
  private files = new Map<string, string[] | null>();
  private diffs = new Map<string, FileDiff>();
  constructor(private root: string, private base: string | null, private head: string) {}

  private async lines(p: string): Promise<string[] | null> {
    if (!this.files.has(p)) {
      try { this.files.set(p, (await gitShow(this.root, this.head, p)).split('\n')); } catch { this.files.set(p, null); }
    }
    return this.files.get(p)!;
  }

  private async diff(p: string): Promise<FileDiff | undefined> {
    if (!this.base) return undefined;
    if (!this.diffs.has(p)) this.diffs.set(p, parseDiff(await gitDiff(this.root, this.base, this.head, p)));
    return this.diffs.get(p);
  }

  /** 校验并回填（原地修改 item）。errors 非空 = 不合格，要交回 AI 修 */
  async check(item: Item): Promise<Checked> {
    const errors: string[] = [], warnings: string[] = [];
    const E = (m: string) => errors.push(m);
    const id = item.id ?? '?';
    for (const k of REQUIRED) if (!item[k] || typeof item[k] !== 'string') E(`${id}.${k} 为空`);
    for (const k of MD_FIELDS) {
      const v = (item as any)[k] ?? '';
      if (HTML_TAG.test(v)) E(`${id}.${k} 含 HTML 标签`);
      if (ABS_PATH.test(v)) E(`${id}.${k} 含绝对路径`);
    }
    if (!Array.isArray(item.chain) || !item.chain.length) { E(`${id} 没有核心链条`); return { errors, warnings }; }

    const ids = new Set<string>();
    for (const n of item.chain) {
      const nid = n.id ?? '?';
      if (ids.has(nid)) E(`节点 id 重复：${nid}`);
      ids.add(nid);
      for (const k of ['step', 'symbol', 'text'] as const) if (!n[k]) E(`${nid}.${k} 为空`);
      const a = n.anchor ?? ({} as any);
      const p: string = a.path ?? '';
      if (!p || p.startsWith('/') || ABS_PATH.test(p)) { E(`${nid} 路径必须是仓库相对路径：${p}`); continue; }
      const lines = await this.lines(p);
      if (!lines) { E(`${nid} 文件在 head 不存在：${p}`); continue; }
      const { start: s, end: e, line: ln } = a;
      if (!(Number.isInteger(s) && Number.isInteger(e) && 1 <= s && s <= e && e <= lines.length)) { E(`${nid} 范围越界 ${s}-${e}（文件 ${lines.length} 行）`); continue; }
      if (!(Number.isInteger(ln) && s <= ln && ln <= e)) E(`${nid} 焦点行 ${ln} 不在范围 ${s}-${e} 内`);
      const ident = String(n.symbol ?? '').split(/[.\s]/).filter(Boolean).pop() ?? '';
      if (CODE_EXT.test(p) && n.symbol !== 'router') {
        if (!/^[\w$]+$/.test(ident)) E(`${nid} symbol「${n.symbol}」解析不出函数名：代码文件要写成 类型.方法 或 函数名`);
        else {
        let owner = '';
        for (let i = s - 1; i >= 0; i--) if (OWNER.test(lines[i])) { owner = lines[i]; break; }
        if (!new RegExp(`\\b${ident.replace(/[$()*+.?[\\\]^{|}]/g, '\\$&')}\\b`).test(owner))
          E(`${nid} 范围 ${s}-${e} 所在函数不是 ${ident}：${owner.trim().slice(0, 60) || '（往上找不到函数定义）'}（锚点漂了？）`);
        }
      }
      for (const k of ['text', 'was'] as const) {
        const v = n[k] ?? '';
        if (HTML_TAG.test(v)) E(`${nid}.${k} 含 HTML 标签`);
        if (ABS_PATH.test(v)) E(`${nid}.${k} 含绝对路径`);
      }
      const d = await this.diff(p);
      if (d) {
        const st = { added: 0, modified: 0, deleted: 0 };
        for (let i = s; i <= e; i++) { const m = d.lines.get(i); if (m) st[m.kind]++; }
        for (const [at, text] of d.deleted) if (s - 1 <= at && at <= e) st.deleted += text.length;
        n.diff = st;
        n.changed = st.added + st.modified + st.deleted > 0;
        for (const note of n.notes ?? []) {
          if (!(s <= note.line && note.line <= e)) E(`${nid} 说明行 ${note.line} 不在范围 ${s}-${e} 内`);
          else if (!d.lines.has(note.line)) E(`${nid} 说明行 ${note.line} 不是改动行（说明只能挂在改动上）`);
          if (!note.text) E(`${nid} 说明行 ${note.line} 没有内容`);
        }
        if (n.changed && !n.notes?.length) warnings.push(`${nid} 有改动但没写修改说明`);
        if (n.core && !n.changed) warnings.push(`${nid} 标了 core 但范围内没有任何改动`);
      }
    }
    return { errors, warnings };
  }
}
