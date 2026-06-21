import { mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = dirname(__dirname);
const testDir = join(projectRoot, "tests", "tmp");
const testDataDir = join(testDir, "data");
const testDbPath = join(testDataDir, "ash-glaze.json");
const testBackupDir = join(testDataDir, "backups");
const testMigrationsDir = join(testDir, "migrations");

process.env.ASH_GLAZE_DATA_DIR = testDataDir;
process.env.ASH_GLAZE_DB_PATH = testDbPath;
process.env.ASH_GLAZE_BACKUP_DIR = testBackupDir;

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
    failed++;
    failures.push(`${msg}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
    console.log(`  ✗ ${msg}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

const legacySample = {
  tiles: [
    { id: "AG-TEST-1", body: "粗陶坯", recipe: "松灰42 长石35", ashSource: "南山松灰", peakTemp: 1240, score: 82 },
    { id: "AG-TEST-2", body: "细瓷坯", recipe: "稻灰50 长石30", ashSource: "东北稻灰", peakTemp: 1260, score: 90 }
  ],
  firingPlans: [
    { id: "FP-TEST-1", name: "测试规划", peakTemp: 1240, kiln: "K-2" }
  ],
  recipes: [],
  recipeVersions: [],
  batches: [],
  materialStocks: [
    { id: "MAT-TEST-1", name: "松灰", quantity: 50, unit: "kg" }
  ]
};

async function setupTestEnv() {
  await rm(testDir, { recursive: true, force: true });
  await mkdir(testBackupDir, { recursive: true });
  delete process.env.ASH_GLAZE_MIGRATIONS_DIR;
  await writeFile(testDbPath, JSON.stringify(legacySample, null, 2));
}

async function resetLegacyDb() {
  await writeFile(testDbPath, JSON.stringify(legacySample, null, 2));
}

async function cleanupTestEnv() {
  await rm(testDir, { recursive: true, force: true });
}

async function test1_formatDetection() {
  console.log("\nTest 1: 格式检测与版本识别");

  const { getSchemaVersion, toNewFormat, toLegacyFormat, getCollections } = await import("../lib/db.js");

  const rawLegacy = JSON.parse(await readFile(testDbPath, "utf8"));
  assertEq(getSchemaVersion(rawLegacy), 0, "旧格式 schemaVersion 应为 0");

  const converted = toNewFormat(rawLegacy);
  assert(typeof converted.schemaVersion === "number", "转换后有 schemaVersion 字段");
  assertEq(converted.schemaVersion, 3, "转换后 schemaVersion 为 3");
  assert(Array.isArray(converted.migrations), "有 migrations 数组");
  assert(typeof converted.collections === "object", "有 collections 对象");

  const coll = getCollections(converted);
  assertEq(coll.tiles.length, 2, "tiles 集合有 2 条记录");
  assertEq(coll.firingPlans.length, 1, "firingPlans 集合有 1 条记录");
  assertEq(coll.materialStocks.length, 1, "materialStocks 集合有 1 条记录");

  const back = toLegacyFormat(converted);
  assertEq(back.tiles.length, 2, "反向转换后 tiles 数量一致");
  assertEq(back.tiles[0].id, "AG-TEST-1", "反向转换保留数据");

  const legacyColl = getCollections(rawLegacy);
  assertEq(legacyColl.tiles.length, 2, "旧格式 getCollections 也能正常工作");
}

async function test2_backupMechanism() {
  console.log("\nTest 2: 备份与恢复机制");

  const { createBackup, restoreFromBackup, listBackups, getLatestBackup, deleteBackup } = await import("../lib/db.js");

  const backups1 = await listBackups();
  assert(Array.isArray(backups1), "listBackups 返回数组");

  const backupPath = await createBackup("test-label");
  assert(backupPath !== null, "createBackup 返回备份路径");
  assert(existsSync(backupPath), "备份文件实际存在");
  assert(backupPath.includes("test-label"), "备份文件名包含 label");

  const backups2 = await listBackups();
  assertEq(backups2.length, backups1.length + 1, "备份列表增加 1 条");

  const latest = await getLatestBackup();
  assert(latest !== null, "getLatestBackup 返回结果");
  assert(latest.path === backupPath, "最新备份即为刚创建的备份");

  const content = JSON.parse(await readFile(backupPath, "utf8"));
  assertEq(content.tiles.length, 2, "备份文件内容完整");

  await writeFile(testDbPath, JSON.stringify({ corrupted: true }, null, 2));
  await restoreFromBackup(backupPath);
  const restored = JSON.parse(await readFile(testDbPath, "utf8"));
  assertEq(restored.tiles.length, 2, "restoreFromBackup 正确恢复数据");

  await deleteBackup(backupPath);
  assert(!existsSync(backupPath), "deleteBackup 后文件不存在");
}

async function test3_migrationUp() {
  console.log("\nTest 3: 迁移执行 migrateToLatest");

  await resetLegacyDb();

  const { loadMigrationScripts, getPendingMigrations, migrateToLatest } = await import("../lib/schema-migration.js");
  const { loadDb, getSchemaVersion, getMigrations, getCollections } = await import("../lib/db.js");

  const scripts = await loadMigrationScripts();
  assert(scripts.length >= 1, "至少加载到 1 个迁移脚本");
  assertEq(scripts[0].version, 1, "第一个脚本版本号为 1");
  assert(typeof scripts[0].up === "function", "脚本有 up 函数");
  assert(typeof scripts[0].down === "function", "脚本有 down 函数");
  assert(typeof scripts[0].validate === "function", "脚本有 validate 函数");

  const dbBefore = await loadDb();
  const pending = await getPendingMigrations(dbBefore);
  assert(pending.length >= 1, "存在待执行迁移");

  const upResult = await migrateToLatest({ autoBackup: true });
  assert(upResult.success, "migrateToLatest 执行成功");
  assertEq(upResult.fromVersion, 0, "迁移起始版本为 0");
  assertEq(upResult.toVersion, 3, "迁移目标版本为 3");
  assert(upResult.backupPath !== null, "迁移前创建了备份");
  assert(existsSync(upResult.backupPath), "备份文件存在");

  const dbAfter = await loadDb();
  assertEq(getSchemaVersion(dbAfter), 3, "迁移后 schemaVersion=3");
  assertEq(getMigrations(dbAfter).length, 3, "迁移记录有 3 条");
  assertEq(getMigrations(dbAfter)[0].version, 1, "第一条迁移记录版本正确");
  assertEq(getMigrations(dbAfter)[1].version, 2, "第二条迁移记录版本正确");
  assertEq(getMigrations(dbAfter)[2].version, 3, "第三条迁移记录版本正确");

  const coll = getCollections(dbAfter);
  assertEq(coll.tiles.length, 2, "迁移后 tiles 数据完整");
  assertEq(coll.tiles[0].id, "AG-TEST-1", "迁移后 tile id 正确");
  assertEq(coll.firingPlans.length, 1, "迁移后 firingPlans 完整");
  assertEq(coll.materialStocks.length, 1, "迁移后 materialStocks 完整");
}

async function test4_migrationRollback() {
  console.log("\nTest 4: 回滚 rollbackLastMigration");

  const { rollbackLastMigration } = await import("../lib/schema-migration.js");
  const { getSchemaVersion } = await import("../lib/db.js");

  const rbResult = await rollbackLastMigration({ autoBackup: true });
  assert(rbResult.success, "rollbackLastMigration 执行成功");
  assertEq(rbResult.rolledBack.version, 3, "回滚的版本为 3");
  assertEq(rbResult.previousVersion, 2, "回滚后版本为 2");

  const dbRolled = JSON.parse(await readFile(testDbPath, "utf8"));
  assert("schemaVersion" in dbRolled, "回滚后仍有 schemaVersion 字段（从 v3 回滚到 v2）");
  assertEq(dbRolled.schemaVersion, 2, "回滚后 schemaVersion 为 2");
  assertEq(dbRolled.migrations.length, 2, "回滚后迁移记录有 2 条");
  assertEq(dbRolled.collections.tiles.length, 2, "回滚后 tiles 数据完整");

  const rbResult2 = await rollbackLastMigration({ autoBackup: true });
  assert(rbResult2.success, "第二次回滚执行成功");
  assertEq(rbResult2.rolledBack.version, 2, "回滚的版本为 2");
  assertEq(rbResult2.previousVersion, 1, "回滚后版本为 1");

  const dbRolled2 = JSON.parse(await readFile(testDbPath, "utf8"));
  assert("schemaVersion" in dbRolled2, "回滚后仍有 schemaVersion 字段（从 v2 回滚到 v1）");
  assertEq(dbRolled2.schemaVersion, 1, "回滚后 schemaVersion 为 1");
  assertEq(dbRolled2.migrations.length, 1, "回滚后迁移记录有 1 条");
}

async function test5_migrationFailurePreservesOriginal() {
  console.log("\nTest 5: 迁移失败时原文件不被破坏（真实失败场景）");

  await resetLegacyDb();
  const beforeContent = await readFile(testDbPath, "utf8");
  const beforeHash = JSON.stringify(JSON.parse(beforeContent));

  const { migrateToLatest } = await import("../lib/schema-migration.js");
  const { loadDb, getSchemaVersion, listBackups } = await import("../lib/db.js");

  const dbBefore = await loadDb();
  assertEq(getSchemaVersion(dbBefore), 0, "迁移前版本为 0");

  await rm(testMigrationsDir, { recursive: true, force: true });
  await mkdir(testMigrationsDir, { recursive: true });
  await writeFile(join(testMigrationsDir, "001-failing.js"), `
export const version = 1;
export const name = "simulated-failure";
export const description = "模拟失败的迁移脚本";

export function up(db) {
  const result = db._helpers.toNewFormat(db);
  result.collections.tiles[0].body = "THIS_IS_DIRTY_DATA_THAT_SHOULD_NEVER_BE_SAVED";
  result.collections.tiles.push({ id: "INVALID_TILE_SHOULD_BE_ROLLED_BACK", body: "bad" });
  throw new Error("simulated migration failure - should trigger rollback");
}

export function down(db) {
  return { result: db };
}

export function validate() {
  return { valid: true, errors: [] };
}
`);

  process.env.ASH_GLAZE_MIGRATIONS_DIR = testMigrationsDir;
  const failedResult = await migrateToLatest({ autoBackup: true });
  delete process.env.ASH_GLAZE_MIGRATIONS_DIR;

  assert(failedResult.success === false, "真实失败迁移返回 success=false");
  assert(failedResult.error.includes("simulated migration failure"), "错误信息包含失败原因");
  assert(failedResult.backupPath !== null, "失败前创建了备份");
  assert(failedResult.restoredFromBackup === true, "标记为已从备份恢复");

  const afterContent = await readFile(testDbPath, "utf8");
  const afterHash = JSON.stringify(JSON.parse(afterContent));
  assertEq(beforeHash, afterHash, "从备份恢复后数据文件完全还原，脏数据已清除");

  const dbAfter = await loadDb();
  assertEq(getSchemaVersion(dbAfter), 0, "恢复后版本仍为 0");

  const realUpResult = await migrateToLatest({ autoBackup: true });
  assert(realUpResult.success === true, "正常迁移可以成功执行");
  assert(realUpResult.fromVersion === 0, "正常迁移起始版本正确");
  assert(realUpResult.toVersion === 3, "正常迁移目标版本正确");

  const allBackups = await listBackups();
  assert(allBackups.length >= 2, "至少有 2 个备份（失败场景+正常迁移）");

  console.log("  ✓ 失败迁移保护机制验证通过 - 备份创建 → 失败 → 从备份恢复 → 数据完整无损坏");
}

async function test6_cliStatus() {
  console.log("\nTest 6: 状态查询接口");

  await resetLegacyDb();
  const { getMigrationStatus } = await import("../lib/schema-migration.js");

  const status = await getMigrationStatus();
  assert(typeof status.current === "object", "status.current 存在");
  assertEq(status.current.currentSchemaVersion, 0, "当前版本为 0（旧格式）");
  assert(status.current.isLegacy === true, "isLegacy=true");
  assert(Array.isArray(status.availableMigrations), "availableMigrations 是数组");
  assert(status.availableMigrations.length >= 1, "至少有 1 个可用迁移");
  assert(status.availableMigrations[0].applied === false, "v1 迁移状态为未应用");
  assert(Array.isArray(status.backups), "backups 是数组");
}

async function test7_startupAutoMigration() {
  console.log("\nTest 7: 启动时自动迁移");

  await resetLegacyDb();
  const { autoMigrateOnStartup } = await import("../lib/schema-migration.js");
  const { loadDb, getSchemaVersion } = await import("../lib/db.js");

  const result = await autoMigrateOnStartup();
  assert(result.needed === true, "检测到需要迁移");
  assert(result.result.success === true, "自动迁移成功");

  const db = await loadDb();
  assertEq(getSchemaVersion(db), 3, "自动迁移后版本为 3");

  const result2 = await autoMigrateOnStartup();
  assert(result2.needed === false, "第二次启动无需迁移");
}

async function run() {
  try {
    await setupTestEnv();
    await test1_formatDetection();
    await test2_backupMechanism();
    await test3_migrationUp();
    await test4_migrationRollback();
    await test5_migrationFailurePreservesOriginal();
    await test6_cliStatus();
    await test7_startupAutoMigration();

    console.log(`\n========== Results: ${passed} passed, ${failed} failed ==========`);
    if (failed > 0) {
      console.log("\nFailures:");
      for (const f of failures) console.log(`  - ${f}`);
      process.exit(1);
    }
    console.log("\nAll tests passed!");
  } finally {
    await cleanupTestEnv();
  }
}

run().catch(err => {
  console.error(`Test runner crashed: ${err.message}`);
  console.error(err.stack);
  process.exit(1);
});
