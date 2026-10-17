import { build, context } from 'esbuild';
import { copyFileSync, mkdirSync } from 'fs';
const watch = process.argv.includes('--watch');
const test = process.argv.includes('--test');

const common = { bundle: true, platform: 'node', format: 'cjs', target: 'node18', sourcemap: true, logLevel: 'info' };

if (test) {
  // 只打包纯逻辑模块的测试（不依赖 vscode）
  await build({ ...common, entryPoints: ['test/markdown.test.ts', 'test/model.test.ts', 'test/git.test.ts', 'test/diff.test.ts', 'test/panel.test.ts', 'test/ask.test.ts', 'test/panel-click.test.ts', 'test/finalize.test.ts', 'test/gen.test.ts', 'test/sidebar.test.ts', 'test/panel-focus.test.ts', 'test/store.test.ts', 'test/snapshot.test.ts'],
                outdir: 'dist-test', sourcemap: false, external: ['jsdom'] });
} else {
  const opts = { ...common, entryPoints: ['src/extension.ts'], outfile: 'dist/extension.js', external: ['vscode'] };
  if (watch) { const ctx = await context(opts); await ctx.watch(); }
  else { await build(opts); }
}

// 生成规范随插件一起发：同事没有本地那份时用它
mkdirSync('dist', { recursive: true });
copyFileSync('GENERATE.md', 'dist/GENERATE.md');
