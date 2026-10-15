// git diff -U0 → head 侧逐行标记。同一处改动里删与加按顺序配对：配上的算修改，多出来的算新增 / 删除。

export type LineMark = { kind: 'added' } | { kind: 'modified'; old: string };
export interface FileDiff {
  lines: Map<number, LineMark>;
  /** 删除点：key = 删在 head 的哪一行之后（0 = 文件开头），value = 被删的原文 */
  deleted: Map<number, string[]>;
}

const HUNK = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

export function parseDiff(text: string): FileDiff {
  const out: FileDiff = { lines: new Map(), deleted: new Map() };
  const rows = text.split('\n');
  for (let i = 0; i < rows.length; i++) {
    const m = rows[i].match(HUNK);
    if (!m) continue;
    const newStart = +m[3];
    const olds: string[] = [], news: string[] = [];
    for (let j = i + 1; j < rows.length && !rows[j].startsWith('@@'); j++) {
      if (rows[j].startsWith('-')) olds.push(rows[j].slice(1));
      else if (rows[j].startsWith('+')) news.push(rows[j].slice(1));
    }
    const paired = Math.min(olds.length, news.length);
    news.forEach((_, k) => out.lines.set(newStart + k, k < paired ? { kind: 'modified', old: olds[k] } : { kind: 'added' }));
    if (olds.length > news.length) {
      const after = news.length ? newStart + news.length - 1 : newStart;
      out.deleted.set(after, [...(out.deleted.get(after) ?? []), ...olds.slice(paired)]);
    }
  }
  return out;
}

/** 某个范围内的改动，按行号排好，给面板画内嵌 diff 用 */
export type RangeRow =
  | { kind: 'added'; line: number }
  | { kind: 'modified'; line: number; old: string }
  | { kind: 'deleted'; after: number; text: string[] };

export function rowsInRange(d: FileDiff, start: number, end: number): RangeRow[] {
  const rows: RangeRow[] = [];
  for (let n = start - 1; n <= end; n++) {
    const del = d.deleted.get(n);
    if (del && n >= start - 1) rows.push({ kind: 'deleted', after: n, text: del });
    const mark = n >= start ? d.lines.get(n) : undefined;
    if (mark) rows.push(mark.kind === 'added' ? { kind: 'added', line: n } : { kind: 'modified', line: n, old: mark.old });
  }
  // 删除点排在它后面那一行之前
  return rows.sort((a, b) => key(a) - key(b));
}
const key = (r: RangeRow) => r.kind === 'deleted' ? r.after + 0.5 : r.line;
