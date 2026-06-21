import { mkdir, writeFile, readFile, rm, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = dirname(__dirname);
const testsTmpRoot = join(projectRoot, "tests", "tmp");

export function getProjectRoot() {
  return projectRoot;
}

export function getTestsTmpRoot() {
  return testsTmpRoot;
}

export function createTestContext(testFileUrl) {
  const testFilePath = fileURLToPath(testFileUrl);
  const testFileName = basename(testFilePath, ".js");
  const testDir = join(testsTmpRoot, testFileName);
  const testDataDir = join(testDir, "data");
  const testDbPath = join(testDataDir, "ash-glaze.json");
  const testBackupDir = join(testDataDir, "backups");
  const testMigrationsDir = join(testDir, "migrations");

  return {
    testFileName,
    testDir,
    testDataDir,
    testDbPath,
    testBackupDir,
    testMigrationsDir,
  };
}

export function applyTestEnv(ctx) {
  process.env.ASH_GLAZE_DATA_DIR = ctx.testDataDir;
  process.env.ASH_GLAZE_DB_PATH = ctx.testDbPath;
  process.env.ASH_GLAZE_BACKUP_DIR = ctx.testBackupDir;
  delete process.env.ASH_GLAZE_MIGRATIONS_DIR;
}

export function createTestStats() {
  let passed = 0;
  let failed = 0;
  const failures = [];

  function assert(cond, msg) {
    if (cond) {
      passed++;
      console.log(`  ✓ ${msg}`);
    } else {
      failed++;
      failures.push(msg);
      console.log(`  ✗ ${msg}`);
    }
  }

  function assertEq(actual, expected, msg) {
    const ok = JSON.stringify(actual) === JSON.stringify(expected);
    if (ok) {
      passed++;
      console.log(`  ✓ ${msg}`);
    } else {
      const detail = `${msg}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`;
      failed++;
      failures.push(detail);
      console.log(`  ✗ ${detail}`);
    }
  }

  function assertThrows(fn, msg) {
    let threw = false;
    try {
      fn();
    } catch (err) {
      threw = true;
    }
    if (threw) {
      passed++;
      console.log(`  ✓ ${msg}`);
    } else {
      failed++;
      failures.push(`${msg}: expected to throw but did not`);
      console.log(`  ✗ ${msg}: expected to throw but did not`);
    }
  }

  function getStats() {
    return { passed, failed, failures: [...failures] };
  }

  function hasFailures() {
    return failed > 0;
  }

  function resetStats() {
    passed = 0;
    failed = 0;
    failures.length = 0;
  }

  function printSummary(label) {
    console.log(`\n--- ${label}: ${passed} passed, ${failed} failed ---`);
    if (failed > 0) {
      for (const f of failures) console.log(`  - ${f}`);
    }
  }

  return {
    assert,
    assertEq,
    assertThrows,
    getStats,
    hasFailures,
    resetStats,
    printSummary,
  };
}

export async function setupTestDir(ctx) {
  await rm(ctx.testDir, { recursive: true, force: true });
  await mkdir(ctx.testBackupDir, { recursive: true });
  if (!existsSync(ctx.testMigrationsDir)) {
    await mkdir(ctx.testMigrationsDir, { recursive: true });
  }
  applyTestEnv(ctx);
}

export async function cleanupTestDir(ctx) {
  await rm(ctx.testDir, { recursive: true, force: true });
}

export async function writeDb(ctx, data) {
  await writeFile(ctx.testDbPath, JSON.stringify(data, null, 2));
}

export async function readDb(ctx) {
  return JSON.parse(await readFile(ctx.testDbPath, "utf8"));
}

export async function cleanAllTmpDirs() {
  const entries = await readdir(__dirname, { withFileTypes: true });
  const tmpDirs = entries
    .filter(entry => entry.isDirectory() && entry.name.startsWith("tmp"))
    .map(entry => join(__dirname, entry.name));

  for (const dir of tmpDirs) {
    await rm(dir, { recursive: true, force: true });
  }
}

export function isCI() {
  return process.env.CI === "true" ||
    process.env.GITHUB_ACTIONS === "true" ||
    process.env.GITLAB_CI === "true" ||
    process.env.JENKINS_HOME !== undefined ||
    process.env.TRAVIS === "true";
}

export function withTiming(label, fn) {
  return async (...args) => {
    const start = Date.now();
    try {
      return await fn(...args);
    } finally {
      const elapsed = ((Date.now() - start) / 1000).toFixed(2);
      console.log(`  [${label} took ${elapsed}s]`);
    }
  };
}
