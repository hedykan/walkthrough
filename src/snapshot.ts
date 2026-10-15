// 只读快照：walkthrough-snap:/<相对路径>?<查询>，内容 = git show <sha>:<相对路径>。
// URI 的 path 保留真实文件名，VS Code 据此自动识别语言、给语法高亮。
import * as vscode from 'vscode';
import { gitShow } from './git';

export const SCHEME = 'walkthrough-snap';

/** missingOk：base 侧可能还没有这个文件（本次新增），此时当作空文件 */
export function snapUri(repoRoot: string, sha: string, relPath: string, missingOk = false): vscode.Uri {
  const q: Record<string, string> = { root: repoRoot, sha };
  if (missingOk) q.missingOk = '1';
  return vscode.Uri.from({ scheme: SCHEME, path: '/' + relPath, query: new URLSearchParams(q).toString() });
}

export function parseSnapUri(uri: vscode.Uri): { root: string; sha: string; relPath: string } {
  const q = new URLSearchParams(uri.query);
  return { root: q.get('root') ?? '', sha: q.get('sha') ?? '', relPath: uri.path.replace(/^\//, '') };
}

export class SnapshotProvider implements vscode.TextDocumentContentProvider {
  private cache = new Map<string, string>();

  async provideTextDocumentContent(uri: vscode.Uri): Promise<string> {
    const key = uri.toString();
    const hit = this.cache.get(key);
    if (hit !== undefined) return hit;
    const { root, sha, relPath } = parseSnapUri(uri);
    let text: string;
    try { text = await gitShow(root, sha, relPath); }
    catch (e) { if (new URLSearchParams(uri.query).get('missingOk') !== '1') throw e; text = ''; }
    this.cache.set(key, text);
    return text;
  }
}
