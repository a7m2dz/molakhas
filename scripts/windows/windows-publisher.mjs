import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const runtime = path.join(root, '.runtime');
fs.mkdirSync(runtime, { recursive: true });
const logPath = path.join(runtime, 'publisher.log');

process.env.PUBLIC_SITE_URL ||= 'https://mulakhas.com';
process.env.OMNIROUTE_BASE_URL ||= 'http://127.0.0.1:20128/v1';
process.env.OMNIROUTE_API_KEY = '';
process.env.OMNIROUTE_MODEL = 'auto/best-free';
process.env.OMNIROUTE_FALLBACK_MODEL ||= 'auto';
process.env.OMNIROUTE_TIMEOUT_MS ||= '90000';

function log(message) {
  const line = `[${new Date().toISOString()}] ${message}`;
  console.log(line);
  fs.appendFileSync(logPath, `${line}\n`);
}

function execute(command, args, { timeout = 0 } = {}) {
  const result = spawnSync(command, args, {
    cwd: root,
    env: process.env,
    encoding: 'utf8',
    shell: process.platform === 'win32',
    timeout: timeout || undefined,
    maxBuffer: 20 * 1024 * 1024
  });
  if (result.stdout) fs.appendFileSync(logPath, result.stdout);
  if (result.stderr) fs.appendFileSync(logPath, result.stderr);
  return {
    code: result.status ?? (result.error ? 1 : 0),
    stdout: String(result.stdout || ''),
    stderr: String(result.stderr || ''),
    error: result.error
  };
}

function run(command, args, { allowFailure = false, timeout = 0 } = {}) {
  log(`RUN ${command} ${args.join(' ')}`);
  const result = execute(command, args, { timeout });
  if (result.code !== 0 && !allowFailure) {
    throw new Error(`${command} exited with ${result.code}: ${result.error?.message || result.stderr.slice(-500)}`);
  }
  return result.code;
}

function capture(command, args) {
  return execute(command, args).stdout.trim();
}

async function omniServerReady() {
  try {
    const response = await fetch(`${process.env.OMNIROUTE_BASE_URL.replace(/\/$/, '')}/models`, {
      method: 'HEAD',
      signal: AbortSignal.timeout(5000)
    });
    return response.ok;
  } catch {
    return false;
  }
}

async function main() {
  log(`Windows publisher cycle start; model=${process.env.OMNIROUTE_MODEL}; auth=anonymous-loopback`);
  if (!(await omniServerReady())) throw new Error('OmniRoute server HEAD /v1/models is not ready.');

  log('Running deep OmniRoute test: model catalog + real inference.');
  run('node', ['scripts/newsroom/omniroute-test.mjs'], { timeout: 3 * 60_000 });
  log(`Deep OmniRoute test passed with model=${process.env.OMNIROUTE_MODEL}.`);

  run('git', ['fetch', 'origin', 'main']);
  const pull = run('git', ['pull', '--rebase', '--autostash', 'origin', 'main'], { allowFailure: true });
  if (pull !== 0) {
    run('git', ['rebase', '--abort'], { allowFailure: true });
    throw new Error('Could not synchronize main safely.');
  }

  run('npm', ['install', '--no-audit', '--no-fund'], { timeout: 8 * 60_000 });
  run('npm', ['run', 'newsroom'], { allowFailure: true, timeout: 25 * 60_000 });
  run('npm', ['run', 'build'], { timeout: 15 * 60_000 });
  run('npm', ['run', 'audit:prelaunch'], { timeout: 8 * 60_000 });

  run('git', ['add', '-A', '--', 'src/data', 'public/news-images', 'public/brand']);
  if (run('git', ['diff', '--cached', '--quiet'], { allowFailure: true }) === 0) {
    log('No publishable changes.');
    return;
  }

  run('git', ['config', 'user.name', 'molakhas-windows[bot]']);
  run('git', ['config', 'user.email', 'actions@users.noreply.github.com']);
  const stamp = new Date().toISOString().slice(0, 16).replace('T', ' ');
  run('git', ['commit', '-m', `newsroom: windows refresh ${stamp} UTC`]);

  let stashedLocalEdits = false;
  if (capture('git', ['status', '--porcelain'])) {
    const stashCode = run('git', ['stash', 'push', '--include-untracked', '-m', `molakhas-publisher-${Date.now()}`], { allowFailure: true });
    stashedLocalEdits = stashCode === 0;
    if (stashedLocalEdits) log('Temporarily stashed non-newsroom local edits before publishing.');
  }

  let published = false;
  try {
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      const rebased = run('git', ['pull', '--rebase', '--autostash', 'origin', 'main'], { allowFailure: true });
      if (rebased === 0 && run('git', ['push', 'origin', 'HEAD:main'], { allowFailure: true }) === 0) {
        published = true;
        break;
      }
      run('git', ['rebase', '--abort'], { allowFailure: true });
      await new Promise((resolve) => setTimeout(resolve, attempt * 10_000));
    }
  } finally {
    if (stashedLocalEdits) {
      const restore = run('git', ['stash', 'pop'], { allowFailure: true });
      log(restore === 0 ? 'Restored local edits after publishing.' : 'Local edits remain safely stored in git stash; manual restore may be needed.');
    }
  }

  if (!published) throw new Error('Push failed after three attempts; local commit is preserved.');

  log('Published changes to main.');
  run('npm', ['run', 'indexnow'], { allowFailure: true, timeout: 4 * 60_000 });
  log('Windows publisher cycle complete.');
}

main().catch((error) => {
  log(`Cycle failed: ${error.message}`);
  process.exitCode = 1;
});
