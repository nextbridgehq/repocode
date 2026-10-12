import fs from 'fs';
import path from 'path';
import { execFile, execFileSync } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

/**
 * Whether a cached checkout is actually usable, rather than merely present.
 *
 * `git init` followed by an interrupted `git add .` leaves a directory that exists, has a
 * .git, and holds every source file — but has no index, no commit, and a stale lock. Callers
 * that only checked for the directory treated that as a cache hit forever, and every arm
 * depending on `git ls-files` silently returned nothing for that instance.
 */
export function isUsableRepo(repoDir: string): boolean {
  if (!fs.existsSync(path.join(repoDir, '.git'))) return false;
  // A leftover lock means a git process died mid-write; the index cannot be trusted.
  if (fs.existsSync(path.join(repoDir, '.git', 'index.lock'))) return false;
  try {
    execFileSync('git', ['rev-parse', '--verify', 'HEAD'], { cwd: repoDir, stdio: 'ignore' });
    const tracked = execFileSync('git', ['ls-files'], {
      cwd: repoDir, encoding: 'utf-8', maxBuffer: 1024 * 1024 * 50,
    });
    return tracked.trim().length > 0;
  } catch {
    return false;
  }
}

/** Files the arms themselves leave behind in the checkout. They are untracked, so `git ls-files`
 *  hides them, but repocode discovers them from the filesystem — a stale 18 MB
 *  repomix-output.xml sitting in the tree gets ranked and packed as if it were source. */
const ARM_ARTIFACTS = ['repomix-output.xml', 'repocode-output.xml', '.repocode'];

function removeArmArtifacts(repoDir: string): void {
  for (const artifact of ARM_ARTIFACTS) {
    fs.rmSync(path.join(repoDir, artifact), { recursive: true, force: true });
  }
}

export async function ensureRepo(repoFullName: string, baseCommit: string, cacheDir: string): Promise<string> {
  const repoDirName = `${repoFullName.replace('/', '_')}_${baseCommit}`;
  const repoDir = path.join(cacheDir, 'repos', repoDirName);

  if (fs.existsSync(repoDir)) {
    if (isUsableRepo(repoDir)) {
      removeArmArtifacts(repoDir);
      return repoDir;
    }
    console.log(`Cached checkout for ${repoFullName}@${baseCommit} is unusable; re-extracting...`);
    fs.rmSync(repoDir, { recursive: true, force: true });
  }

  console.log(`Downloading tarball for ${repoFullName} at ${baseCommit}...`);
  fs.mkdirSync(repoDir, { recursive: true });

  const tarUrl = `https://github.com/${repoFullName}/archive/${baseCommit}.tar.gz`;
  const tarPath = path.join(cacheDir, 'repos', `${repoDirName}.tar.gz`);

  try {
    // Download tarball using curl
    await execFileAsync('curl', ['-sL', '-o', tarPath, tarUrl]);

    // Extract tarball
    console.log(`Extracting tarball for ${repoFullName}...`);
    // GitHub tarballs extract to a folder like "astropy-d16bfe05a744909de4b27f5875fe0d4ed41ce607"
    // We want to strip the first component.
    //
    // Extraction runs out-of-process. The in-process `tar` package took the whole harness down
    // twice on large archives (django, matplotlib) with no error written to the log and no JS
    // exception to catch — a batch run just vanished mid-extract. A child process can fail
    // loudly and be caught; a native crash inside our own process cannot.
    // Windows ships bsdtar at System32; it takes native paths as-is. The GNU tar on PATH under
    // git-bash does not: it reads the colon in "D:\..." as a host:path remote specifier
    // ("Cannot connect to D: resolve failed"), and --force-local only moves the problem to the
    // -C destination, which it then mangles. Either use bsdtar with native paths or GNU tar
    // with /d/-style paths; mixing them silently fails on every repo.
    const bsdtar = 'C:\\Windows\\System32\\tar.exe';
    const useBsdtar = process.platform === 'win32' && fs.existsSync(bsdtar);
    const toPosix = (p: string) =>
      p.replace(/\\/g, '/').replace(/^([A-Za-z]):/, (_, d: string) => `/${d.toLowerCase()}`);
    const [tarBin, archiveArg, destArg] = useBsdtar
      ? [bsdtar, tarPath, repoDir]
      : ['tar', toPosix(tarPath), toPosix(repoDir)];

    // A non-zero exit does not mean nothing was extracted. Some repos (matplotlib among them)
    // ship symlinks, which Windows refuses to create without elevation: tar writes every real
    // file, complains about each link, and exits non-zero. Those links are image assets —
    // irrelevant to ranking — so extraction is judged on what landed on disk rather than on the
    // exit code, and only a genuinely empty tree is treated as a failure.
    try {
      await execFileAsync(
        tarBin,
        ['-xzf', archiveArg, '-C', destArg, '--strip-components=1'],
        { maxBuffer: 1024 * 1024 * 50 },
      );
    } catch (tarError) {
      const extracted = fs.readdirSync(repoDir).length;
      if (extracted === 0) throw tarError;
      const message = tarError instanceof Error ? tarError.message : String(tarError);
      const links = (message.match(/Cannot create symlink/g) ?? []).length;
      console.log(
        `  tar exited non-zero but extracted ${extracted} top-level entries`
        + (links ? ` (${links} symlinks skipped — expected on Windows)` : '')
        + '; continuing.'
      );
    }

    // Clean up tarball
    fs.unlinkSync(tarPath);

    // Initialize a dummy git repo so repocode and repomix think it's a git repo.
    // Identity is supplied inline: the benchmark must not depend on the machine's git config,
    // and a commit that fails here leaves exactly the half-initialised repo described above.
    const identity = ['-c', 'user.email=bench@repocode.local', '-c', 'user.name=repocode-bench'];
    await execFileAsync('git', ['init'], { cwd: repoDir });
    await execFileAsync('git', ['add', '.'], { cwd: repoDir, maxBuffer: 1024 * 1024 * 50 });
    await execFileAsync('git', [...identity, 'commit', '-m', 'Initial commit'], { cwd: repoDir, maxBuffer: 1024 * 1024 * 50 });

    if (!isUsableRepo(repoDir)) {
      throw new Error(`checkout for ${repoFullName}@${baseCommit} is still unusable after extraction`);
    }
  } catch (error) {
    fs.rmSync(repoDir, { recursive: true, force: true });
    if (fs.existsSync(tarPath)) fs.unlinkSync(tarPath);
    throw error;
  }

  return repoDir;
}
