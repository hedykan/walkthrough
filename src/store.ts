// 走读目录里有哪些走读：认两种结构——旧的平铺 code/<base8>..<head8>.json，和一份一个文件夹的 <名字>/walkthrough.json。
// 不依赖 vscode，方便单测。
import * as fs from 'fs';
import * as path from 'path';

export interface Entry {
  key: string;            // base8..head8，用来认「这个范围生成过没有」
  file: string;
  title: string;
  base: string; head: string;
  branch: string;         // 去掉了 origin/ 前缀
  at: string;             // 生成时间（ISO）；旧文件没记就用文件修改时间
  items: number;
}

const RANGE = /([0-9a-f]{8})\.\.([0-9a-f]{8})/;

function read(file: string): Entry | undefined {
  try {
    const w = JSON.parse(fs.readFileSync(file, 'utf8'));
    const a = w?.meta?.anchor ?? {};
    if (!a.head || !Array.isArray(w.items)) return undefined;
    const base = String(a.base ?? ''), head = String(a.head);
    return {
      key: `${base.slice(0, 8)}..${head.slice(0, 8)}`, file,
      title: String(w.meta.title ?? ''), base, head,
      branch: String(a.branch ?? '').replace(/^origin\//, ''),
      at: String(w.meta.generatedBy?.at ?? fs.statSync(file).mtime.toISOString()),
      items: w.items.length,
    };
  } catch { return undefined; }   // 坏文件跳过，不影响其他
}

/** 某个仓库目录下的全部走读，新的在前 */
export function listWalkthroughs(repoDir: string): Entry[] {
  const out: Entry[] = [];
  const scan = (dir: string, depth: number) => {
    let names: string[];
    try { names = fs.readdirSync(dir); } catch { return; }
    for (const n of names) {
      const p = path.join(dir, n);
      let st: fs.Stats;
      try { st = fs.statSync(p); } catch { continue; }
      if (st.isDirectory() && depth > 0) {
        const wt = path.join(p, 'walkthrough.json');
        if (fs.existsSync(wt)) { const e = read(wt); if (e) out.push(e); }
        else scan(p, depth - 1);                                   // 旧结构的 code/ 这一层
      } else if (st.isFile() && n.endsWith('.json') && !n.endsWith('.answers.json') && RANGE.test(n)) {
        const e = read(p); if (e) out.push(e);
      }
    }
  };
  scan(repoDir, 2);
  return out.sort((a, b) => b.at.localeCompare(a.at));
}

/** 属于当前分支：记的分支名一致，或者终点提交在当前分支的提交列表里 */
export function forBranch(all: Entry[], branch: string, shas: string[]): Entry[] {
  const b = branch.replace(/^origin\//, '');
  const set = new Set(shas);
  return all.filter(e => (b && e.branch === b) || set.has(e.head));
}
