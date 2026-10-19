// git 操作。代码内容一律来自 `git show <sha>:<path>`，从不碰工作区。
// 唯一会写东西的是 snapshotWorktree：只新增提交对象和一个隐藏引用，分支、暂存区、工作区都不动。
import { execFile } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

function run(cwd: string, args: string[], env?: Record<string, string>): Promise<{ code: number; out: string; err: string }> {
  return new Promise(resolve => {
    execFile('git', ['-C', cwd, ...args], { maxBuffer: 64 * 1024 * 1024, env: env ? { ...process.env, ...env } : process.env }, (e, out, err) => {
      resolve({ code: e ? (typeof (e as any).code === 'number' ? (e as any).code : 1) : 0, out, err });
    });
  });
}

export async function gitShow(repoRoot: string, sha: string, relPath: string): Promise<string> {
  const r = await run(repoRoot, ['show', `${sha}:${relPath}`]);
  if (r.code !== 0) throw new Error(`git show ${sha.slice(0, 8)}:${relPath} 失败：${r.err.trim()}`);
  return r.out;
}

export async function gitDiff(repoRoot: string, base: string, head: string, relPath: string): Promise<string> {
  const r = await run(repoRoot, ['diff', '-U0', '--no-color', base, head, '--', relPath]);
  if (r.code !== 0) throw new Error(`git diff ${relPath} 失败：${r.err.trim()}`);
  return r.out;
}

/** head 时刻仓库里的全部文件（相对路径），用来把回答里的「文件名:行号」解析成真实路径 */
export async function listFiles(repoRoot: string, sha: string): Promise<string[]> {
  const r = await run(repoRoot, ['ls-tree', '-r', '--name-only', sha]);
  if (r.code !== 0) throw new Error(`git ls-tree ${sha.slice(0, 8)} 失败：${r.err.trim()}`);
  return r.out.split('\n').filter(Boolean);
}

export async function hasCommit(repoRoot: string, sha: string): Promise<boolean> {
  const r = await run(repoRoot, ['cat-file', '-e', `${sha}^{commit}`]);
  return r.code === 0;
}

export async function isGitRepo(dir: string): Promise<boolean> {
  const r = await run(dir, ['rev-parse', '--is-inside-work-tree']);
  return r.code === 0 && r.out.trim() === 'true';
}

/** 拉取远端全部分支（--prune 清掉远端已删的），只更新远端引用，不动工作区 */
export async function fetchAll(repoRoot: string): Promise<{ ok: boolean; message: string }> {
  const r = await run(repoRoot, ['fetch', '--prune', 'origin']);
  return { ok: r.code === 0, message: (r.err || r.out).trim() };
}

/** 只拉引用不改工作区 —— 项目宪法允许 AI 执行 fetch，但这里仍由人点按钮触发 */
export async function fetchRef(repoRoot: string, ref: string): Promise<{ ok: boolean; message: string }> {
  const r = await run(repoRoot, ['fetch', 'origin', ref]);
  return { ok: r.code === 0, message: (r.err || r.out).trim() };
}

export interface BranchInfo { name: string; date: number }
export interface CommitInfo { sha: string; short: string; subject: string; author: string; ago: string; merge: boolean }

/** 本地 + 远端分支，按最近提交时间排序；远端的去掉 origin/HEAD，和本地同名的只留本地 */
export async function listBranches(repoRoot: string): Promise<BranchInfo[]> {
  const r = await run(repoRoot, ['for-each-ref', '--sort=-committerdate', '--format=%(refname:short)%09%(committerdate:unix)', 'refs/heads', 'refs/remotes']);
  if (r.code !== 0) throw new Error(`列分支失败：${r.err.trim()}`);
  const seen = new Set<string>();
  const out: BranchInfo[] = [];
  for (const line of r.out.split('\n').filter(Boolean)) {
    const [name, ts] = line.split('\t');
    if (name.endsWith('/HEAD') || name === 'origin') continue;
    const short = name.replace(/^origin\//, '');
    if (seen.has(short)) continue;
    seen.add(short);
    out.push({ name, date: +ts });
  }
  return out;
}

/** 当前检出的分支名；detached 时返回 undefined */
export async function currentBranch(repoRoot: string): Promise<string | undefined> {
  const r = await run(repoRoot, ['rev-parse', '--abbrev-ref', 'HEAD']);
  const b = r.out.trim();
  return r.code === 0 && b && b !== 'HEAD' ? b : undefined;
}

/** 解析成完整 sha；不存在返回 undefined */
export async function revParse(repoRoot: string, ref: string): Promise<string | undefined> {
  const r = await run(repoRoot, ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`]);
  return r.code === 0 ? r.out.trim() : undefined;
}

export async function mergeBase(repoRoot: string, a: string, b: string): Promise<string | undefined> {
  const r = await run(repoRoot, ['merge-base', a, b]);
  return r.code === 0 ? r.out.trim() : undefined;
}

/** base..head 之间的提交，沿第一父提交往下（不把合进来的主干提交列进来），新的在前 */
export async function logRange(repoRoot: string, base: string, head: string, limit = 100): Promise<CommitInfo[]> {
  const r = await run(repoRoot, ['log', '--first-parent', `-n${limit}`, '--format=%H%x1f%h%x1f%s%x1f%an%x1f%ar%x1f%P', `${base}..${head}`]);
  if (r.code !== 0) throw new Error(`git log 失败：${r.err.trim()}`);
  return r.out.split('\n').filter(Boolean).map(l => {
    const [sha, short, subject, author, ago, parents] = l.split('\x1f');
    return { sha, short, subject, author, ago, merge: parents.trim().split(' ').length > 1 };
  });
}

/** 从 head 往下沿第一父提交取最近 limit 个（分支已合入、没有独有提交时用） */
export async function logFrom(repoRoot: string, head: string, limit = 100): Promise<CommitInfo[]> {
  const r = await run(repoRoot, ['log', '--first-parent', `-n${limit}`, '--format=%H%x1f%h%x1f%s%x1f%an%x1f%ar%x1f%P', head, '--']);
  if (r.code !== 0) throw new Error(`git log 失败：${r.err.trim()}`);
  return r.out.split('\n').filter(Boolean).map(l => {
    const [sha, short, subject, author, ago, parents] = l.split('\x1f');
    return { sha, short, subject, author, ago, merge: parents.trim().split(' ').length > 1 };
  });
}

export async function commitInfo(repoRoot: string, sha: string): Promise<CommitInfo | undefined> {
  const r = await run(repoRoot, ['log', '-1', '--format=%H%x1f%h%x1f%s%x1f%an%x1f%ar%x1f%P', sha]);
  if (r.code !== 0 || !r.out.trim()) return undefined;
  const [s, short, subject, author, ago, parents] = r.out.trim().split('\x1f');
  return { sha: s, short, subject, author, ago, merge: parents.trim().split(' ').length > 1 };
}

export async function diffStat(repoRoot: string, base: string, head: string): Promise<string> {
  const r = await run(repoRoot, ['diff', '--stat=200', '--no-color', base, head]);
  return r.code === 0 ? r.out.trim() : '';
}

export async function remoteUrl(repoRoot: string): Promise<string | undefined> {
  const r = await run(repoRoot, ['remote', 'get-url', 'origin']);
  return r.code === 0 ? r.out.trim() : undefined;
}

// ---- worktree 与未提交的改动 ----

/** 这个目录（主检出或 worktree）属于哪个主仓库：返回主仓库的根目录 */
export async function mainRepoRoot(dir: string): Promise<string | undefined> {
  const r = await run(dir, ['rev-parse', '--path-format=absolute', '--git-common-dir']);
  if (r.code !== 0) return undefined;
  const common = r.out.trim();                       // …/api-service/.git
  return path.basename(common) === '.git' ? path.dirname(common) : common;
}

/** 分支检出在哪个目录（主检出或某个 worktree）；没检出返回 undefined。一个分支同一时间只能在一处检出 */
export async function worktreeFor(repoRoot: string, branch: string): Promise<string | undefined> {
  const r = await run(repoRoot, ['worktree', 'list', '--porcelain']);
  if (r.code !== 0) return undefined;
  const want = `refs/heads/${branch.replace(/^origin\//, '')}`;
  let cur = '';
  for (const line of r.out.split('\n')) {
    if (line.startsWith('worktree ')) cur = line.slice(9);
    else if (line === `branch ${want}`) return cur;
  }
  return undefined;
}

export interface DirtyFile { status: string; path: string }

/** 工作区里没提交的改动（含还没 add 的新文件，.gitignore 忽略的不算） */
export async function dirtyFiles(dir: string): Promise<DirtyFile[]> {
  const r = await run(dir, ['status', '--porcelain=v1', '-uall', '-z']);
  if (r.code !== 0) throw new Error(`git status 失败：${r.err.trim()}`);
  const parts = r.out.split('\0').filter(Boolean);
  const out: DirtyFile[] = [];
  for (let i = 0; i < parts.length; i++) {
    const status = parts[i].slice(0, 2), p = parts[i].slice(3);
    out.push({ status, path: p });
    if (status[0] === 'R' || status[0] === 'C') i++;   // 改名会多带一个原路径
  }
  return out;
}

/** 给工作区拍快照：用临时暂存区把当前文件存成一个提交（父 = HEAD），挂在 refs/walkthrough/<label>。
 *  不挪分支、不碰真正的暂存区、不改工作区；也不会被 push。返回快照的 sha */
export async function snapshotWorktree(dir: string, label: string): Promise<string> {
  const index = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'wt-snap-')), 'index');
  const env = { GIT_INDEX_FILE: index };
  try {
    const step = async (args: string[], what: string) => {
      const r = await run(dir, args, env);
      if (r.code !== 0) throw new Error(`拍快照失败（${what}）：${r.err.trim()}`);
      return r.out.trim();
    };
    await step(['read-tree', 'HEAD'], '读 HEAD');
    await step(['add', '-A'], '收集改动');
    const tree = await step(['write-tree'], '写目录树');
    const sha = await step(['commit-tree', tree, '-p', 'HEAD', '-m', `walkthrough snapshot ${label}`], '写提交');
    await step(['update-ref', `refs/walkthrough/${label}`, sha], '挂引用');
    return sha;
  } finally {
    fs.rmSync(path.dirname(index), { recursive: true, force: true });
  }
}

/** 指向某个快照提交的隐藏引用（refs/walkthrough/*） */
export async function snapshotRefs(repoRoot: string, sha: string): Promise<string[]> {
  const r = await run(repoRoot, ['for-each-ref', '--points-at', sha, '--format=%(refname)', 'refs/walkthrough/']);
  return r.code === 0 ? r.out.split('\n').filter(Boolean) : [];
}

/** 删掉一个快照引用；只允许 refs/walkthrough/ 下的，防止误删分支 */
export async function deleteSnapshotRef(repoRoot: string, ref: string): Promise<void> {
  if (!ref.startsWith('refs/walkthrough/')) throw new Error(`只能删 refs/walkthrough/ 下的引用：${ref}`);
  const r = await run(repoRoot, ['update-ref', '-d', ref]);
  if (r.code !== 0) throw new Error(`删除快照引用失败：${r.err.trim()}`);
}
