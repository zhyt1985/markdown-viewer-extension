import assert from 'node:assert/strict';
import {test} from 'node:test';
import {summaryTree} from '../src/book-tree.ts';
test('SUMMARY AST preserves reference links and nested groups with bounded input and entries',()=>{
  const parsed=summaryTree('- **分组**\n  - [章节][chapter]\n\n[chapter]: sub/C.md#target');
  assert.equal(parsed.entries[0].label,'分组');assert.equal(parsed.entries[0].href,null);
  assert.equal(parsed.entries[0].children[0].href,'sub/C.md#target');
  const bounded=summaryTree('- [chapter](C.md)\n'.repeat(600));assert.equal(bounded.entries.length,500);assert.equal(bounded.truncated,true);
  assert.throws(()=>summaryTree('a'.repeat(256*1024+1)),/256 KiB/);
});
