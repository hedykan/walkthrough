// 快照与 worktree：在临时仓库里验证「拍了快照，分支 / 暂存区 / 工作区一点不动」
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { deleteSnapshotRef, dirtyFiles, gitShow, mainRepoRoot, snapshotRefs, snapshotWorktree, worktreeFor } from '../src/git';

const g = (cwd: string, ...a: string[]) => execFileSync('git', ['-C', cwd, ...a], { encoding: 'utf8' }).trim();

function repo() {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'wt-repo-')));
  g(root, 'init', '-q', '-b', 'main');
  g(root, 'config', 'user.email', 't@t'); g(root, 'config', 'user.name', 't');
  fs.writeFileSync(path.join(root, 'a.go'), 'package a\nfunc A() {}\n');
  fs.writeFileSync(path.join(root, 'gone.go'), 'package a\n');
  fs.writeFileSync(path.join(root, '.gitignore'), '.env\n');
  g(root, 'add', '-A'); g(root, 'commit', '-qm', 'init');
  return root;
}

test('拍快照：改动、新文件、删除都进去，忽略的不进；分支、暂存区、工作区状态一点不变', async () => {
  const root = repo();
  fs.writeFileSync(path.join(root, 'a.go'), 'package a\nfunc A() { /* 改了 */ }\n');
  fs.writeFileSync(path.join(root, 'new.go'), 'package a\nfunc New() {}\n');
  fs.rmSync(path.join(root, 'gone.go'));
  fs.writeFileSync(path.join(root, '.env'), 'SECRET=1\n');
  fs.writeFileSync(path.join(root, 'staged.go'), 'package a\n'); g(root, 'add', 'staged.go');   // 真暂存区里已有的东西
  const before = { head: g(root, 'rev-parse', 'HEAD'), branch: g(root, 'branch', '--show-current'), status: g(root, 'status', '--porcelain', '-uall'), staged: g(root, 'diff', '--cached', '--name-only') };

  const files = await dirtyFiles(root);
  assert.deepEqual(files.map(f => f.path).sort(), ['a.go', 'gone.go', 'new.go', 'staged.go']);

  const sha = await snapshotWorktree(root, 'test-1');
  assert.equal(g(root, 'rev-parse', 'refs/walkthrough/test-1'), sha);
  assert.equal(g(root, 'rev-parse', `${sha}^`), before.head, '父提交是 HEAD');
  assert.match(await gitShow(root, sha, 'a.go'), /改了/);
  assert.match(await gitShow(root, sha, 'new.go'), /func New/);
  await assert.rejects(gitShow(root, sha, 'gone.go'), '删掉的文件不在快照里');
  await assert.rejects(gitShow(root, sha, '.env'), '.gitignore 忽略的不进快照');

  const after = { head: g(root, 'rev-parse', 'HEAD'), branch: g(root, 'branch', '--show-current'), status: g(root, 'status', '--porcelain', '-uall'), staged: g(root, 'diff', '--cached', '--name-only') };
  assert.deepEqual(after, before, '分支、HEAD、工作区状态、暂存区都不能变');
  assert.equal(g(root, 'log', '--all', '--format=%s').includes('walkthrough snapshot'), true);
  assert.equal(g(root, 'branch', '--list').split('\n').length, 1, '没有多出分支');
});

test('worktree：按分支找到检出的目录；worktree 里认得出主仓库；没检出的分支返回空', async () => {
  const root = repo();
  g(root, 'branch', 'feat/x'); g(root, 'branch', 'feat/y');
  const wt = path.join(fs.realpathSync(os.tmpdir()), `wt-wt-${Date.now()}`);
  g(root, 'worktree', 'add', '-q', wt, 'feat/x');
  assert.equal(await worktreeFor(root, 'feat/x'), wt);
  assert.equal(await worktreeFor(root, 'origin/feat/x'), wt, '远端名也能对上本地检出');
  assert.equal(await worktreeFor(root, 'main'), root);
  assert.equal(await worktreeFor(root, 'feat/y'), undefined);
  assert.equal(await mainRepoRoot(wt), root, 'worktree 归到主仓库');
  assert.equal(await mainRepoRoot(root), root);
  // worktree 里拍快照：主检出不受影响，快照在共享的仓库里，主检出也读得到
  fs.writeFileSync(path.join(wt, 'w.go'), 'package a\n');
  const sha = await snapshotWorktree(wt, 'wt-1');
  assert.equal(g(root, 'status', '--porcelain'), '');
  assert.match(await gitShow(root, sha, 'w.go'), /package a/);
});

test('快照引用：按 sha 找得到；删掉后消失；不许删 refs/walkthrough/ 以外的（比如分支）', async () => {
  const root = repo();
  fs.writeFileSync(path.join(root, 'x.go'), 'package a\n');
  const sha = await snapshotWorktree(root, 'del-1');
  assert.deepEqual(await snapshotRefs(root, sha), ['refs/walkthrough/del-1']);
  await assert.rejects(deleteSnapshotRef(root, 'refs/heads/main'), /只能删 refs\/walkthrough\//);
  assert.ok(g(root, 'rev-parse', 'refs/heads/main'), '分支还在');
  await deleteSnapshotRef(root, 'refs/walkthrough/del-1');
  assert.deepEqual(await snapshotRefs(root, sha), []);
});
