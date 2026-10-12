import { describe, it, expect } from 'vitest';
import { parseGoldFiles, datasetRowsUrl } from '../src/dataset.js';

describe('datasetRowsUrl', () => {
  it('defaults to SWE-bench Lite', () => {
    expect(datasetRowsUrl(undefined, 100, 100)).toBe(
      'https://datasets-server.huggingface.co/rows?dataset=princeton-nlp%2FSWE-bench_Lite&config=default&split=test&offset=100&length=100',
    );
  });

  it('builds the URL for another dataset id', () => {
    expect(datasetRowsUrl('princeton-nlp/SWE-bench_Verified', 0, 50)).toContain('dataset=princeton-nlp%2FSWE-bench_Verified');
  });
});

describe('dataset', () => {
  it('parses gold files from a patch', () => {
    const patch = `
--- a/django/db/models/query.py
+++ b/django/db/models/query.py
@@ -1,3 +1,4 @@
 import warnings
--- /dev/null
+++ b/django/db/models/new_file.py
@@ -0,0 +1 @@
+pass
--- a/django/db/models/deleted_file.py
+++ /dev/null
@@ -1 +0,0 @@
-pass
`;
    const files = parseGoldFiles(patch);
    expect(files).toContain('django/db/models/query.py');
    expect(files).toContain('django/db/models/new_file.py');
    expect(files).toContain('django/db/models/deleted_file.py');
    expect(files).toHaveLength(3);
  });
});
