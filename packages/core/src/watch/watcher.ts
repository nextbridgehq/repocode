import chokidar, { type FSWatcher } from 'chokidar';
import path from 'path';
import type { RepoCodeConfig, PackResult } from '../types.js';
import { buildIgnoreFilter } from '../discovery/ignoreRules.js';
import { runPipeline } from '../pipeline.js';
import { FileCache } from '../cache/fileCache.js';

export interface WatchOptions {
  config: RepoCodeConfig;
  debounceMs?: number;
  onRepack: (result: PackResult, changedPaths: string[]) => void | Promise<void>;
  onError?: (err: Error) => void;
}

export interface WatchHandle {
  stop: () => Promise<void>;
}

const DEFAULT_DEBOUNCE_MS = 2000;

export async function startWatch(options: WatchOptions): Promise<WatchHandle> {
  const { config, onRepack } = options;
  const debounceMs = options.debounceMs ?? DEFAULT_DEBOUNCE_MS;
  const cache = FileCache.load(config.root);

  const shouldInclude = await buildIgnoreFilter(config.root, config.ignore);
  // chokidar's `ignored` callback receives an absolute, platform-native path.
  // buildIgnoreFilter (like the rest of the ignore-rules machinery) expects a
  // root-relative, forward-slash path, so we convert before delegating.
  //
  // buildIgnoreFilter uses gitignore-style semantics, where a pattern like
  // `node_modules/**` matches everything *inside* node_modules but not the
  // `node_modules` directory entry itself. chokidar, however, asks `ignored`
  // about each directory before descending into it — if we only checked the
  // directory's own path, `node_modules` would report "not ignored", chokidar
  // would watch it, and events for files inside it (matched one level later)
  // would still have already produced an `addDir` event for `node_modules`
  // itself. To prune the whole subtree, we also treat a path as ignored when
  // a synthetic child of it would be ignored.
  function isIgnoredByFilter(filePath: string): boolean {
    const relative = path.relative(config.root, filePath);
    if (relative === '' || relative.startsWith('..')) return false;
    const normalized = relative.replace(/\\/g, '/');
    // runPipeline persists FileCache to <root>/.repocode/cache.json on
    // every run. That write is a real filesystem event inside the watched
    // tree, and the default ignore patterns don't know about it — without
    // this exclusion, every repack would write the cache file, which would
    // trigger another debounced repack, forever.
    if (normalized === '.repocode' || normalized.startsWith('.repocode/')) {
      return true;
    }
    if (!shouldInclude(normalized)) return true;
    return !shouldInclude(`${normalized}/__repocode_probe__`);
  }
  const watcher: FSWatcher = chokidar.watch(config.root, {
    ignored: (filePath: string) => isIgnoredByFilter(filePath),
    ignoreInitial: true,
    persistent: true,
  });

  const pendingChanges = new Set<string>();
  let debounceTimer: NodeJS.Timeout | null = null;
  let repacking = false;
  let pendingAfterRepack = false;
  let stopped = false;
  let inFlight: Promise<void> | null = null;

  function scheduleDebounce(): void {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      debounceTimer = null;
      void doRepack();
    }, debounceMs);
  }

  async function doRepack(): Promise<void> {
    if (repacking) {
      pendingAfterRepack = true;
      return;
    }
    repacking = true;
    const changed = [...pendingChanges];
    pendingChanges.clear();
    inFlight = (async () => {
      const result = await runPipeline(config, { cache });
      await onRepack(result, changed);
    })();
    try {
      await inFlight;
    } catch (err) {
      options.onError?.(err instanceof Error ? err : new Error(String(err)));
    } finally {
      inFlight = null;
      repacking = false;
    }
    if (pendingAfterRepack && !stopped) {
      pendingAfterRepack = false;
      if (debounceTimer) {
        clearTimeout(debounceTimer);
        debounceTimer = null;
      }
      scheduleDebounce();
    }
  }

  watcher.on('all', (_event, filePath) => {
    if (stopped) return;
    pendingChanges.add(filePath);
    scheduleDebounce();
  });

  watcher.on('error', (err: unknown) => {
    const error = err instanceof Error ? err : new Error(String(err));
    options.onError?.(error);
  });

  // Listeners are attached above before the initial pack runs, so any
  // filesystem events firing during the initial pack are queued in
  // pendingChanges instead of being lost.
  const initialResult = await runPipeline(config, { cache });
  await onRepack(initialResult, []);

  return {
    async stop(): Promise<void> {
      stopped = true;
      if (debounceTimer) clearTimeout(debounceTimer);
      if (inFlight) await inFlight;
      await watcher.close();
    },
  };
}
