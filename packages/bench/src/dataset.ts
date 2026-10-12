export interface SWEBenchInstance {
  instance_id: string;
  repo: string;
  base_commit: string;
  problem_statement: string;
  patch: string;
  gold_files: string[];
}

export function parseGoldFiles(patch: string): string[] {
  const files = new Set<string>();
  const lines = patch.split('\n');

  for (const line of lines) {
    if (line.startsWith('--- a/') || line.startsWith('+++ b/')) {
      const path = line.slice(6).trim();
      if (path && path !== '/dev/null') {
        files.add(path);
      }
    }
  }

  return Array.from(files);
}

export const SWEBENCH_LITE = 'princeton-nlp/SWE-bench_Lite';

/** One page of dataset rows from the Hugging Face datasets server. */
export function datasetRowsUrl(dataset: string | undefined, offset: number, length: number): string {
  const id = encodeURIComponent(dataset ?? SWEBENCH_LITE);
  return `https://datasets-server.huggingface.co/rows?dataset=${id}&config=default&split=test&offset=${offset}&length=${length}`;
}

/** Fetch instances of a SWE-bench dataset (Lite by default; pass e.g. princeton-nlp/SWE-bench_Verified
 *  to take a held-out set). Stops at the end of the split. */
export async function fetchSWEBench(dataset?: string, limit?: number): Promise<SWEBenchInstance[]> {
  const instances: SWEBenchInstance[] = [];
  const chunk = 100;

  for (let offset = 0; ; offset += chunk) {
    console.log(`Fetching ${dataset ?? SWEBENCH_LITE} (offset ${offset})...`);

    const res = await fetch(datasetRowsUrl(dataset, offset, chunk));
    if (!res.ok) {
      throw new Error(`Failed to fetch dataset: ${res.statusText}`);
    }

    const data = await res.json();
    for (const item of data.rows) {
      const row = item.row;
      instances.push({
        instance_id: row.instance_id,
        repo: row.repo,
        base_commit: row.base_commit,
        problem_statement: row.problem_statement,
        patch: row.patch,
        gold_files: parseGoldFiles(row.patch)
      });

      if (limit && instances.length >= limit) {
        return instances;
      }
    }
    if (data.rows.length < chunk) return instances;
  }
}

export async function fetchSWEBenchLite(limit?: number): Promise<SWEBenchInstance[]> {
  return fetchSWEBench(undefined, limit);
}
