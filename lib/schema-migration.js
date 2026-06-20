import { readdir } from "node:fs/promises";
import { dirname, join, basename } from "node:path";
import { fileURLToPath } from "node:url";
import {
  loadDb,
  saveDb,
  getSchemaVersion,
  getCurrentSchemaVersion,
  createBackup,
  restoreFromBackup,
  listBackups,
  getLatestBackup,
  toNewFormat,
  toLegacyFormat,
  getCollections,
  getMigrations,
  addMigrationRecord,
  removeMigrationRecord,
  setSchemaVersion,
  getLatestMigration,
  readRawDb,
  writeRawDb
} from "./db.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(__dirname, "migrations");

function isNewFormatLocal(db) {
  return typeof db === "object"
    && db !== null
    && typeof db.schemaVersion === "number"
    && "collections" in db;
}

const helpers = {
  isNewFormat: isNewFormatLocal,
  toNewFormat,
  toLegacyFormat,
  getCollections,
  getSchemaVersion
};

function attachHelpers(db) {
  if (db && typeof db === "object") {
    Object.defineProperty(db, "_helpers", { value: helpers, enumerable: false, writable: false });
  }
  return db;
}

export async function loadMigrationScripts() {
  const files = await readdir(migrationsDir);
  const scripts = [];
  for (const f of files) {
    if (!f.match(/^\d+-.*\.js$/)) continue;
    const mod = await import(join(migrationsDir, f));
    scripts.push({
      file: f,
      version: Number(mod.version),
      name: mod.name || basename(f, ".js"),
      description: mod.description || "",
      up: mod.up,
      down: mod.down,
      validate: mod.validate
    });
  }
  scripts.sort((a, b) => a.version - b.version);
  return scripts;
}

export async function getPendingMigrations(db) {
  const all = await loadMigrationScripts();
  const current = getSchemaVersion(db);
  return all.filter(s => s.version > current);
}

export async function getAppliedVersions(db) {
  const migrations = getMigrations(db);
  return new Set(migrations.map(m => m.version));
}

export function getVersionInfo(db) {
  return {
    currentSchemaVersion: getSchemaVersion(db),
    latestSupportedVersion: getCurrentSchemaVersion(),
    migrations: getMigrations(db),
    latestMigration: getLatestMigration(db),
    isLegacy: getSchemaVersion(db) === 0
  };
}

export async function migrateToLatest(options = {}) {
  const { dryRun = false, autoBackup = true, onProgress = null } = options;

  const db = await loadDb();
  const pending = await getPendingMigrations(db);

  if (pending.length === 0) {
    return { success: true, alreadyLatest: true, migrations: [], backupPath: null };
  }

  let backupPath = null;
  if (autoBackup && !dryRun) {
    backupPath = await createBackup(`pre-migrate-v${getSchemaVersion(db)}`);
  }

  let workingDb = db;
  const applied = [];

  try {
    for (const script of pending) {
      if (onProgress) onProgress({ type: "before", version: script.version, name: script.name });

      attachHelpers(workingDb);
      const result = script.up(workingDb);

      if (!result || !result.result) {
        throw new Error(`Migration v${script.version} (${script.name}) did not return a result object`);
      }

      const newDb = result.result;
      attachHelpers(newDb);

      if (script.validate) {
        const validation = script.validate(newDb);
        if (!validation.valid) {
          throw new Error(`Migration v${script.version} validation failed: ${validation.errors.join("; ")}`);
        }
      }

      const appliedAt = new Date().toISOString();
      addMigrationRecord(newDb, {
        version: script.version,
        name: script.name,
        description: script.description,
        appliedAt,
        backupPath
      });
      setSchemaVersion(newDb, script.version);

      if (!dryRun) {
        await saveDb(newDb);
      }

      applied.push({
        version: script.version,
        name: script.name,
        description: script.description,
        appliedAt,
        stats: result.collectionsCount || {}
      });

      workingDb = newDb;

      if (onProgress) onProgress({ type: "after", version: script.version, name: script.name, stats: result.collectionsCount || {} });
    }

    return {
      success: true,
      alreadyLatest: false,
      migrations: applied,
      backupPath,
      fromVersion: getSchemaVersion(db),
      toVersion: getSchemaVersion(workingDb)
    };
  } catch (error) {
    if (backupPath && !dryRun && applied.length > 0) {
      try {
        await restoreFromBackup(backupPath);
      } catch (restoreError) {
        error.message = `${error.message}. Additionally, restore from backup failed: ${restoreError.message}`;
      }
    }
    return {
      success: false,
      error: error.message,
      migrations: applied,
      backupPath,
      restoredFromBackup: backupPath !== null && applied.length > 0
    };
  }
}

export async function rollbackLastMigration(options = {}) {
  const { dryRun = false, autoBackup = true, onProgress = null } = options;

  const db = await loadDb();
  const currentVersion = getSchemaVersion(db);

  if (currentVersion === 0) {
    return { success: false, error: "No migrations to roll back (schema version is 0)" };
  }

  const allScripts = await loadMigrationScripts();
  const currentScript = allScripts.find(s => s.version === currentVersion);

  if (!currentScript) {
    return { success: false, error: `No migration script found for version ${currentVersion}` };
  }

  if (!currentScript.down) {
    return { success: false, error: `Migration v${currentVersion} does not support rollback` };
  }

  let backupPath = null;
  if (autoBackup && !dryRun) {
    backupPath = await createBackup(`pre-rollback-v${currentVersion}`);
  }

  try {
    if (onProgress) onProgress({ type: "before-rollback", version: currentScript.version, name: currentScript.name });

    attachHelpers(db);
    const result = currentScript.down(db);

    if (!result || !result.result) {
      throw new Error(`Rollback of v${currentScript.version} did not return a result object`);
    }

    const newDb = result.result;
    attachHelpers(newDb);

    const previousVersion = currentVersion - 1;
    if (previousVersion > 0) {
      setSchemaVersion(newDb, previousVersion);
    }
    removeMigrationRecord(newDb, currentVersion);

    if (!dryRun) {
      await writeRawDb(newDb);
    }

    if (onProgress) onProgress({ type: "after-rollback", version: currentScript.version, name: currentScript.name });

    return {
      success: true,
      rolledBack: {
        version: currentScript.version,
        name: currentScript.name,
        description: currentScript.description
      },
      previousVersion,
      backupPath,
      stats: result.collectionsCount || {}
    };
  } catch (error) {
    if (backupPath && !dryRun) {
      try {
        await restoreFromBackup(backupPath);
      } catch (restoreError) {
        error.message = `${error.message}. Additionally, restore from backup failed: ${restoreError.message}`;
      }
    }
    return {
      success: false,
      error: error.message,
      backupPath
    };
  }
}

export async function getMigrationStatus() {
  const db = await loadDb();
  const scripts = await loadMigrationScripts();
  const applied = getMigrations(db);
  const appliedSet = new Set(applied.map(m => m.version));

  return {
    current: getVersionInfo(db),
    availableMigrations: scripts.map(s => ({
      version: s.version,
      name: s.name,
      description: s.description,
      applied: appliedSet.has(s.version)
    })),
    backups: await listBackups()
  };
}

export async function autoMigrateOnStartup() {
  const db = await loadDb();
  const pending = await getPendingMigrations(db);

  if (pending.length === 0) {
    return { needed: false, result: null };
  }

  const result = await migrateToLatest({
    autoBackup: true,
    onProgress: ({ type, version, name }) => {
      if (type === "before") console.log(`[schema-migration] Applying migration v${version}: ${name}...`);
      if (type === "after") console.log(`[schema-migration] Applied migration v${version}: ${name} successfully`);
    }
  });

  return { needed: true, result };
}

export {
  createBackup,
  restoreFromBackup,
  listBackups,
  getLatestBackup,
  loadDb,
  saveDb
};
