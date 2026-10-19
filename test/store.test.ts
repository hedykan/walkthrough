import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { forBranch, listWalkthroughs } from '../src/store';
import { BASE8, BRANCH, HEAD8, WALKTHROUGHS } from './fixtures';

const W = (base: string, head: string, branch: string, at: string | undefined, items = 2, title = 't') =>
  JSON.stringify({ schemaVersion: '2', meta: { title, anchor: { base, head, branch }, ...(at ? { generatedBy: { at } } : {}) }, items: Array(items).fill({}) });

test('走读目录扫描：认旧的 code/*.json 和新的「一份一个文件夹」；跳过 answers 和坏文件；新的在前', () => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'wt-store-'));
  fs.mkdirSync(path.join(repo, 'code'));
  fs.writeFileSync(path.join(repo, 'code', 'aaaaaaaa..bbbbbbbb.json'), W('a'.repeat(40), 'b'.repeat(40), 'origin/feat/x', '2026-10-10T00:00:00Z', 5, '旧结构'));
  fs.writeFileSync(path.join(repo, 'code', 'aaaaaaaa..bbbbbbbb.answers.json'), '{"answers":[]}');
  fs.writeFileSync(path.join(repo, 'code', 'cccccccc..dddddddd.json'), '{坏');
  const folder = path.join(repo, '2026-10-14_feat-x_aaaaaaaa..eeeeeeee');
  fs.mkdirSync(folder);
  fs.writeFileSync(path.join(folder, 'walkthrough.json'), W('a'.repeat(40), 'e'.repeat(40), 'feat/x', '2026-10-14T00:00:00Z', 3, '新结构'));
  const all = listWalkthroughs(repo);
  assert.deepEqual(all.map(e => [e.key, e.title, e.branch, e.items]), [['aaaaaaaa..eeeeeeee', '新结构', 'feat/x', 3], ['aaaaaaaa..bbbbbbbb', '旧结构', 'feat/x', 5]]);
  assert.deepEqual(listWalkthroughs(path.join(repo, 'nope')), [], '目录不存在不报错');
});

test('属于当前分支：分支名一致（忽略 origin/），或终点在提交列表里', () => {
  const e = (key: string, branch: string, head: string) => ({ key, file: key, title: '', base: '', head, branch, at: '', items: 1 });
  const all = [e('1', 'feat/x', 'h1'), e('2', 'unknown', 'h2'), e('3', 'feat/y', 'h3')];
  assert.deepEqual(forBranch(all, 'origin/feat/x', []).map(x => x.key), ['1']);
  assert.deepEqual(forBranch(all, 'feat/x', ['h2']).map(x => x.key), ['1', '2'], '分支名没记对的，靠终点提交找回来');
  assert.deepEqual(forBranch(all, 'feat/z', []).map(x => x.key), []);
});

test('样例走读目录：feature/payment-lock 能找到那份走读', () => {
  const all = listWalkthroughs(WALKTHROUGHS);
  assert.ok(forBranch(all, BRANCH, []).some(x => x.key === `${BASE8}..${HEAD8}`));
});
