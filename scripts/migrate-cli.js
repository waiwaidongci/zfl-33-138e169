#!/usr/bin/env node
import {
  getMigrationStatus,
  migrateToLatest,
  rollbackLastMigration
} from "../lib/schema-migration.js";
import {
  listBackups,
  restoreFromBackup,
  getDbPath,
  getDataDir,
  getBackupDir,
  getCurrentSchemaVersion
} from "../lib/db.js";

const args = process.argv.slice(2);
const command = args[0];

function printHelp() {
  console.log(`Ash Glaze Lab - Schema Migration CLI

Usage:
  node scripts/migrate-cli.js <command> [options]

Commands:
  status              Show current schema version, migrations, and backups
  up                  Run all pending migrations
  rollback            Roll back the last applied migration
  list-backups        List all backup files
  restore <file>      Restore from a specific backup file
  help                Show this help message

Examples:
  node scripts/migrate-cli.js status
  node scripts/migrate-cli.js up
  node scripts/migrate-cli.js rollback
  node scripts/migrate-cli.js restore ash-glaze_pre-migrate_20260101-120000.bak.json
`);
}

function formatDate(d) {
  if (!d) return "-";
  const date = d instanceof Date ? d : new Date(d);
  return date.toLocaleString("zh-CN", { hour12: false });
}

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

async function cmdStatus() {
  const status = await getMigrationStatus();
  const c = status.current;

  console.log("=== Schema Migration Status ===\n");

  console.log(`Current Schema Version : v${c.currentSchemaVersion}`);
  console.log(`Latest Supported       : v${c.latestSupportedVersion}`);
  console.log(`Data File              : ${getDbPath()}`);
  console.log(`Data Directory         : ${getDataDir()}`);
  console.log(`Backup Directory       : ${getBackupDir()}`);
  console.log(`Format                 : ${c.isLegacy ? "Legacy (v0)" : "New format"}`);

  console.log("\n--- Applied Migrations ---");
  if (c.migrations.length === 0) {
    console.log("  (none)");
  } else {
    for (const m of c.migrations) {
      console.log(`  v${m.version}  ${m.name}`);
      console.log(`         applied : ${formatDate(m.appliedAt)}`);
      if (m.description) console.log(`         desc    : ${m.description}`);
    }
  }

  console.log("\n--- Available Migrations ---");
  for (const m of status.availableMigrations) {
    const mark = m.applied ? "[applied]" : "[pending]";
    console.log(`  ${mark} v${m.version}  ${m.name}`);
    if (m.description) console.log(`             ${m.description}`);
  }

  console.log("\n--- Backups ---");
  if (status.backups.length === 0) {
    console.log("  (none)");
  } else {
    for (const b of status.backups) {
      console.log(`  ${b.file}`);
      console.log(`         created : ${formatDate(b.createdAt)}  size: ${formatSize(b.size)}`);
    }
  }

  if (c.currentSchemaVersion < c.latestSupportedVersion) {
    console.log(`\n⚠ There are pending migrations. Run 'migrate-cli.js up' to apply.`);
  }
}

async function cmdUp() {
  console.log("Running pending migrations...\n");

  const result = await migrateToLatest({
    autoBackup: true,
    onProgress: ({ type, version, name, stats }) => {
      if (type === "before") {
        console.log(`  → Applying v${version}: ${name}...`);
      }
      if (type === "after") {
        const parts = Object.entries(stats || {})
          .map(([k, v]) => `${k}=${v}`)
          .join(", ");
        console.log(`  ✓ Applied v${version}: ${name}  (${parts || "ok"})`);
      }
    }
  });

  if (result.success) {
    if (result.alreadyLatest) {
      console.log("\n✓ Schema is already at latest version.");
    } else {
      console.log(`\n✓ Migrated from v${result.fromVersion} to v${result.toVersion}`);
      console.log(`  Applied ${result.migrations.length} migration(s)`);
      if (result.backupPath) console.log(`  Backup: ${result.backupPath}`);
    }
    process.exit(0);
  } else {
    console.error(`\n✗ Migration failed: ${result.error}`);
    if (result.restoredFromBackup) {
      console.error(`  Restored from backup: ${result.backupPath}`);
    }
    process.exit(1);
  }
}

async function cmdRollback() {
  console.log("Rolling back last migration...\n");

  const result = await rollbackLastMigration({
    autoBackup: true,
    onProgress: ({ type, version, name }) => {
      if (type === "before-rollback") {
        console.log(`  → Rolling back v${version}: ${name}...`);
      }
      if (type === "after-rollback") {
        console.log(`  ✓ Rolled back v${version}: ${name}`);
      }
    }
  });

  if (result.success) {
    console.log(`\n✓ Rolled back v${result.rolledBack.version}: ${result.rolledBack.name}`);
    console.log(`  Previous version: v${result.previousVersion}`);
    if (result.backupPath) console.log(`  Pre-rollback backup: ${result.backupPath}`);
    process.exit(0);
  } else {
    console.error(`\n✗ Rollback failed: ${result.error}`);
    process.exit(1);
  }
}

async function cmdListBackups() {
  const backups = await listBackups();
  if (backups.length === 0) {
    console.log("No backup files found.");
    return;
  }
  console.log(`Backup directory: ${getBackupDir()}\n`);
  for (const b of backups) {
    console.log(`${b.file}`);
    console.log(`  path    : ${b.path}`);
    console.log(`  created : ${formatDate(b.createdAt)}`);
    console.log(`  size    : ${formatSize(b.size)}`);
    console.log();
  }
}

async function cmdRestore(fileName) {
  if (!fileName) {
    console.error("Error: backup file name required.");
    console.error("Usage: migrate-cli.js restore <file>");
    process.exit(1);
  }
  const { join } = await import("node:path");
  const { existsSync } = await import("node:fs");
  const backupPath = join(getBackupDir(), fileName);

  if (!existsSync(backupPath)) {
    console.error(`Error: backup not found: ${backupPath}`);
    process.exit(1);
  }

  console.log(`Restoring from backup: ${backupPath}`);
  try {
    await restoreFromBackup(backupPath);
    console.log("✓ Restore successful.");
    process.exit(0);
  } catch (err) {
    console.error(`✗ Restore failed: ${err.message}`);
    process.exit(1);
  }
}

async function main() {
  switch (command) {
    case "status":
      await cmdStatus();
      break;
    case "up":
      await cmdUp();
      break;
    case "rollback":
      await cmdRollback();
      break;
    case "list-backups":
      await cmdListBackups();
      break;
    case "restore":
      await cmdRestore(args[1]);
      break;
    case "help":
    case "--help":
    case "-h":
    case undefined:
      printHelp();
      break;
    default:
      console.error(`Unknown command: ${command}\n`);
      printHelp();
      process.exit(1);
  }
}

main().catch(err => {
  console.error(`Unexpected error: ${err.message}`);
  process.exit(1);
});
