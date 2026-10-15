import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseDiff, rowsInRange } from '../src/diff';

const D = `diff --git a/x.go b/x.go
@@ -3,2 +3,3 @@ func a()
-old3
-old4
+new3
+new4
+new5
@@ -10,3 +11,1 @@ func b()
-gone10
-gone11
-gone12
+kept11
@@ -20,2 +18,0 @@ func c()
-x20
-x21
`;

test('删加配对：配上的算修改，多出的算新增 / 删除', () => {
  const d = parseDiff(D);
  assert.deepEqual(d.lines.get(3), { kind: 'modified', old: 'old3' });
  assert.deepEqual(d.lines.get(5), { kind: 'added' });
  assert.deepEqual(d.lines.get(11), { kind: 'modified', old: 'gone10' });
  assert.deepEqual(d.deleted.get(11), ['gone11', 'gone12']);
  assert.deepEqual(d.deleted.get(18), ['x20', 'x21'], '纯删除：+18,0 表示删在第 18 行之后');
});

test('范围内的改动按行序排列，删除点排在它后面那行之前', () => {
  const rows = rowsInRange(parseDiff(D), 11, 19);
  assert.deepEqual(rows.map(r => r.kind), ['modified', 'deleted', 'deleted']);
  assert.deepEqual(rowsInRange(parseDiff(D), 1, 2), [], '范围外的改动不算');
});
