// 测试用的样例：虚构的 Go 支付服务 api-service（test/fixtures/build-fixture.mjs 生成）和它的一份走读。
// 测试被打包到 dist-test/ 下运行，所以从 __dirname 往上一级找仓库根目录。
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const FIXTURES = path.join(path.resolve(__dirname, '..'), 'test', 'fixtures');

/** 样例仓库名、分支、走读的 base / head（短哈希） */
export const REPO_NAME = 'api-service';
export const BRANCH = 'feature/payment-lock';
export const BASE8 = 'dfca5cf3';
export const HEAD8 = 'f2c3bced';
/** base 与 head 之间的第一个提交：给支付加锁 */
export const LOCK8 = 'f4b49541';

/** 样例走读目录（相当于「走读目录/仓库名」） */
export const WALKTHROUGHS = path.join(FIXTURES, 'walkthroughs', REPO_NAME);
/** 样例走读文件 */
export const SAMPLE = path.join(WALKTHROUGHS, 'code', `${BASE8}..${HEAD8}.json`);

let repo: string | undefined;
/** 把样例仓库克隆到临时目录（每个测试进程只克隆一次），并建好本地分支 feature/payment-lock */
export function fixtureRepo(): string {
  if (repo) return repo;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wt-fixture-'));
  execFileSync('git', ['clone', '--quiet', path.join(FIXTURES, `${REPO_NAME}.bundle`), dir]);
  execFileSync('git', ['-C', dir, 'branch', '--quiet', BRANCH, `origin/${BRANCH}`]);
  repo = dir;
  return dir;
}

/** 样例仓库的本地路径 */
export const REPO = fixtureRepo();
