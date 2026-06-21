import http from "node:http";
import { loadDb } from "./lib/db.js";
import { autoMigrateOnStartup } from "./lib/schema-migration.js";
import {
  routesInfo,
  readJsonBody,
  handleListTiles,
  handleCreateTile,
  handleGetTile,
  handleUpdateTile,
  handleAddObservation,
  handleSimilarTiles,
  handleRecipesReport,
  handleImportPreview,
  handleImportCommit,
  handleCalcFiringPlan,
  handleListPlans,
  handleCreatePlan,
  handleGetPlan,
  handleUpdatePlan,
  handleDeletePlan,
  handleApplyPlan,
  handleGetExperimentReview,
  handlePostExperimentReview
} from "./lib/routes.js";
import {
  handleListRecipes,
  handleCreateRecipe,
  handleGetRecipe,
  handleUpdateRecipe,
  handleDeleteRecipe,
  handleListVersions,
  handleCreateVersion,
  handleGetVersion,
  handleCopyVersion,
  handleGetRecipeReport,
  handleGetVersionReport,
  handleGetRecipeVersionDiff
} from "./lib/recipe-routes.js";
import {
  handleListBatches,
  handleCreateBatch,
  handleGetBatch,
  handleAddBatchTiles,
  handleRemoveBatchTiles,
  handleAdvanceBatchStatus,
  handleAddBatchObservation,
  handleGetBatchSummary
} from "./lib/batch-routes.js";
import {
  handleListInventory,
  handleCreateInventory,
  handleGetInventory,
  handleUpdateInventory,
  handleDeleteInventory,
  handleInventorySummary,
  handleBatchNoTiles,
  handleBatchUsageSummary,
  handleGetTileTransactions,
  handleGetStockTransactions
} from "./lib/inventory-routes.js";
import {
  handleGetDefectCatalog,
  handleGetOverallDefectStats,
  handleGetDefectStatsByKiln,
  handleGetDefectStatsByAshSource,
  handleGetTileDefectTags,
  handleUpdateTileDefectTags,
  handleAddDefectTag,
  handleRemoveDefectTag,
  handleRunDefectMigration,
  handleQueryTilesByDefect,
  handleGetHighFrequencyDefects
} from "./lib/defect-routes.js";
import {
  handleGetDashboardOverview,
  handleGetDashboardSummary,
  handleGetRecentObservations,
  handleGetAshSourceScores,
  handleGetDefectsByPeakTemp,
  handleGetLowScoreTiles,
  handleGetDashboardCompare
} from "./lib/dashboard-routes.js";
import {
  getStatusInfo,
  handleGetTileStatus,
  handleTransitionStatus,
  handleUpdateTileWithStatus,
  handleGetStatusHistory,
  handleBatchStatusTransition
} from "./lib/tile-status-routes.js";
import {
  handleGetEntityTimeline,
  handleGetEventsByType,
  handleGetEventStats,
  handleGetEventTypes
} from "./lib/event-routes.js";

const port = Number(process.env.PORT || 3033);

function send(res, status, data) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(data, null, 2));
}

const routes = [
  { method: "GET", path: "/", handler: () => ({ status: 200, data: routesInfo() }) },
  { method: "GET", path: "/tile-status/info", handler: () => ({ status: 200, data: getStatusInfo() }) },
  { method: "GET", path: "/tiles", handler: (url, db) => handleListTiles(url, db) },
  { method: "POST", path: "/tiles", handler: (url, db, input) => handleCreateTile(input, db), needBody: true },
  { method: "POST", path: "/tiles/similar", handler: (url, db, input) => handleSimilarTiles(input, db), needBody: true },
  { method: "POST", path: "/tiles/review", handler: (url, db, input) => handlePostExperimentReview(input, db), needBody: true },
  { method: "POST", path: "/tiles/batch-status", handler: (url, db, input) => handleBatchStatusTransition(input, db), needBody: true },
  { method: "POST", path: "/import/preview", handler: (url, db, input, req) => handleImportPreview(req), needBody: false, rawHandler: true },
  { method: "POST", path: "/import/commit", handler: (url, db, input) => handleImportCommit(input, db), needBody: true },

  { method: "POST", pattern: /^\/tiles\/([^/]+)\/observations$/, handler: (url, db, input, req, match) => handleAddObservation(match[1], input, db), needBody: true },
  { method: "GET", pattern: /^\/tiles\/([^/]+)\/status-history$/, handler: (url, db, input, req, match) => handleGetStatusHistory(match[1], db) },
  { method: "GET", pattern: /^\/tiles\/([^/]+)\/status$/, handler: (url, db, input, req, match) => handleGetTileStatus(match[1], db) },
  { method: "PATCH", pattern: /^\/tiles\/([^/]+)\/status$/, handler: (url, db, input, req, match) => handleTransitionStatus(match[1], input, db), needBody: true },

  { method: "GET", pattern: /^\/tiles\/([^/]+)\/defect-tags$/, handler: (url, db, input, req, match) => handleGetTileDefectTags(match[1], db) },
  { method: "PATCH", pattern: /^\/tiles\/([^/]+)\/defect-tags$/, handler: (url, db, input, req, match) => handleUpdateTileDefectTags(match[1], input, db), needBody: true },
  { method: "POST", pattern: /^\/tiles\/([^/]+)\/defect-tags$/, handler: (url, db, input, req, match) => handleAddDefectTag(match[1], input, db), needBody: true },
  { method: "DELETE", pattern: /^\/tiles\/([^/]+)\/defect-tags$/, handler: (url, db, input, req, match) => handleRemoveDefectTag(match[1], input, db), needBody: true },

  { method: "GET", pattern: /^\/tiles\/([^/]+)\/review$/, handler: (url, db, input, req, match) => handleGetExperimentReview(match[1], url, db) },
  { method: "GET", pattern: /^\/tiles\/([^/]+)$/, handler: (url, db, input, req, match) => handleGetTile(match[1], db) },
  { method: "PATCH", pattern: /^\/tiles\/([^/]+)$/, handler: (url, db, input, req, match) => handleUpdateTile(match[1], input, db), needBody: true },

  { method: "GET", path: "/reports/recipes", handler: (url, db) => handleRecipesReport(db) },

  { method: "POST", path: "/firing-plans/calculate", handler: (url, db, input) => handleCalcFiringPlan(input, db), needBody: true },
  { method: "GET", path: "/firing-plans", handler: (url, db) => handleListPlans(url, db) },
  { method: "POST", path: "/firing-plans", handler: (url, db, input) => handleCreatePlan(input, db), needBody: true },
  { method: "POST", pattern: /^\/firing-plans\/([^/]+)\/apply$/, handler: (url, db, input, req, match) => handleApplyPlan(match[1], input, db), needBody: true },
  { method: "GET", pattern: /^\/firing-plans\/([^/]+)$/, handler: (url, db, input, req, match) => handleGetPlan(match[1], db) },
  { method: "PATCH", pattern: /^\/firing-plans\/([^/]+)$/, handler: (url, db, input, req, match) => handleUpdatePlan(match[1], input, db), needBody: true },
  { method: "DELETE", pattern: /^\/firing-plans\/([^/]+)$/, handler: (url, db, input, req, match) => handleDeletePlan(match[1], db) },

  { method: "GET", path: "/recipes", handler: (url, db) => handleListRecipes(url, db) },
  { method: "POST", path: "/recipes", handler: (url, db, input) => handleCreateRecipe(input, db), needBody: true },

  { method: "GET", pattern: /^\/recipes\/([^/]+)\/versions\/diff$/, handler: async (url, db, input, req, match) => {
    const versionIdA = url.searchParams.get("baseline");
    const versionIdB = url.searchParams.get("target");
    if (!versionIdA || !versionIdB) {
      return {
        status: 400,
        data: {
          error: "missing_required",
          message: "缺少 baseline 或 target 参数",
          required: ["baseline", "target"]
        }
      };
    }
    return handleGetRecipeVersionDiff(match[1], versionIdA, versionIdB, db);
  }},

  { method: "GET", pattern: /^\/recipes\/([^/]+)\/versions\/([^/]+)\/report$/, handler: (url, db, input, req, match) => handleGetVersionReport(match[1], match[2], db) },
  { method: "POST", pattern: /^\/recipes\/([^/]+)\/versions\/([^/]+)\/copy$/, handler: (url, db, input, req, match) => handleCopyVersion(match[1], match[2], input, db), needBody: true },
  { method: "GET", pattern: /^\/recipes\/([^/]+)\/versions\/([^/]+)$/, handler: (url, db, input, req, match) => handleGetVersion(match[1], match[2], db) },
  { method: "GET", pattern: /^\/recipes\/([^/]+)\/report$/, handler: (url, db, input, req, match) => handleGetRecipeReport(match[1], db) },
  { method: "GET", pattern: /^\/recipes\/([^/]+)\/versions$/, handler: (url, db, input, req, match) => handleListVersions(match[1], db) },
  { method: "POST", pattern: /^\/recipes\/([^/]+)\/versions$/, handler: (url, db, input, req, match) => handleCreateVersion(match[1], input, db), needBody: true },
  { method: "GET", pattern: /^\/recipes\/([^/]+)$/, handler: (url, db, input, req, match) => handleGetRecipe(match[1], db) },
  { method: "PATCH", pattern: /^\/recipes\/([^/]+)$/, handler: (url, db, input, req, match) => handleUpdateRecipe(match[1], input, db), needBody: true },
  { method: "DELETE", pattern: /^\/recipes\/([^/]+)$/, handler: (url, db, input, req, match) => handleDeleteRecipe(match[1], db) },

  { method: "GET", pattern: /^\/batches\/([^/]+)\/summary$/, handler: (url, db, input, req, match) => handleGetBatchSummary(match[1], db) },
  { method: "POST", pattern: /^\/batches\/([^/]+)\/observations$/, handler: (url, db, input, req, match) => handleAddBatchObservation(match[1], input, db), needBody: true },
  { method: "PATCH", pattern: /^\/batches\/([^/]+)\/status$/, handler: (url, db, input, req, match) => handleAdvanceBatchStatus(match[1], input, db), needBody: true },
  { method: "POST", pattern: /^\/batches\/([^/]+)\/tiles$/, handler: (url, db, input, req, match) => handleAddBatchTiles(match[1], input, db), needBody: true },
  { method: "DELETE", pattern: /^\/batches\/([^/]+)\/tiles$/, handler: (url, db, input, req, match) => handleRemoveBatchTiles(match[1], input, db), needBody: true },
  { method: "GET", path: "/batches", handler: (url, db) => handleListBatches(url, db) },
  { method: "POST", path: "/batches", handler: (url, db, input) => handleCreateBatch(input, db), needBody: true },
  { method: "GET", pattern: /^\/batches\/([^/]+)$/, handler: (url, db, input, req, match) => handleGetBatch(match[1], db) },

  { method: "GET", path: "/inventory", handler: (url, db) => handleListInventory(url, db) },
  { method: "POST", path: "/inventory", handler: (url, db, input) => handleCreateInventory(input, db), needBody: true },
  { method: "GET", path: "/inventory/summary", handler: (url, db) => handleInventorySummary(db) },

  { method: "GET", pattern: /^\/inventory\/batch-no\/([^/]+)\/tiles$/, handler: (url, db, input, req, match) => handleBatchNoTiles(decodeURIComponent(match[1]), db) },
  { method: "GET", pattern: /^\/inventory\/batch-no\/([^/]+)\/summary$/, handler: (url, db, input, req, match) => handleBatchUsageSummary(decodeURIComponent(match[1]), db) },
  { method: "GET", pattern: /^\/inventory\/transactions\/tile\/([^/]+)$/, handler: (url, db, input, req, match) => handleGetTileTransactions(match[1], db) },
  { method: "GET", pattern: /^\/inventory\/transactions\/stock\/([^/]+)$/, handler: (url, db, input, req, match) => handleGetStockTransactions(match[1], db) },
  { method: "GET", pattern: /^\/inventory\/([^/]+)$/, handler: (url, db, input, req, match) => handleGetInventory(match[1], db) },
  { method: "PATCH", pattern: /^\/inventory\/([^/]+)$/, handler: (url, db, input, req, match) => handleUpdateInventory(match[1], input, db), needBody: true },
  { method: "DELETE", pattern: /^\/inventory\/([^/]+)$/, handler: (url, db, input, req, match) => handleDeleteInventory(match[1], db) },

  { method: "GET", path: "/defects/catalog", handler: () => handleGetDefectCatalog() },
  { method: "GET", path: "/defects/stats/overall", handler: (url, db) => handleGetOverallDefectStats(db) },
  { method: "GET", path: "/defects/stats/by-kiln", handler: (url, db) => handleGetDefectStatsByKiln(url, db) },
  { method: "GET", path: "/defects/stats/by-ash-source", handler: (url, db) => handleGetDefectStatsByAshSource(url, db) },
  { method: "GET", path: "/defects/high-frequency", handler: (url, db) => handleGetHighFrequencyDefects(url, db) },
  { method: "GET", path: "/defects/query/tiles", handler: (url, db) => handleQueryTilesByDefect(url, db) },
  { method: "POST", path: "/defects/migrate", handler: (url, db) => handleRunDefectMigration(db) },

  { method: "GET", path: "/dashboard/overview", handler: (url, db) => handleGetDashboardOverview(url, db) },
  { method: "GET", path: "/dashboard/summary", handler: (url, db) => handleGetDashboardSummary(url, db) },
  { method: "GET", path: "/dashboard/recent-observations", handler: (url, db) => handleGetRecentObservations(url, db) },
  { method: "GET", path: "/dashboard/ash-source-scores", handler: (url, db) => handleGetAshSourceScores(url, db) },
  { method: "GET", path: "/dashboard/defects-by-peak-temp", handler: (url, db) => handleGetDefectsByPeakTemp(url, db) },
  { method: "GET", path: "/dashboard/low-score-tiles", handler: (url, db) => handleGetLowScoreTiles(url, db) },
  { method: "GET", path: "/dashboard/compare", handler: (url, db) => handleGetDashboardCompare(url, db) },

  { method: "GET", path: "/events/types", handler: () => handleGetEventTypes() },
  { method: "GET", path: "/events/stats", handler: (url, db) => handleGetEventStats(db) },
  { method: "GET", pattern: /^\/events\/type\/([^/]+)$/, handler: (url, db, input, req, match) => handleGetEventsByType(match[1], url, db) },
  { method: "GET", pattern: /^\/events\/timeline\/([^/]+)$/, handler: (url, db, input, req, match) => handleGetEntityTimeline(decodeURIComponent(match[1]), url, db) }
];

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const db = await loadDb();

    for (const route of routes) {
      if (route.method !== req.method) continue;

      let match = null;
      if (route.path) {
        if (url.pathname !== route.path) continue;
      } else if (route.pattern) {
        match = url.pathname.match(route.pattern);
        if (!match) continue;
      } else {
        continue;
      }

      let input = {};
      if (route.needBody) {
        input = await readJsonBody(req);
      }

      const r = await route.handler(url, db, input, req, match);
      return send(res, r.status, r.data);
    }

    send(res, 404, { error: "not_found" });
  } catch (error) {
    send(res, 500, { error: error.message });
  }
});

async function startServer() {
  const migration = await autoMigrateOnStartup();
  if (migration.needed) {
    const r = migration.result;
    if (r.success) {
      console.log(`[startup] Schema migrated from v${r.fromVersion} to v${r.toVersion} (${r.migrations.length} migration(s) applied)`);
      if (r.backupPath) console.log(`[startup] Backup created at: ${r.backupPath}`);
    } else {
      console.error(`[startup] Schema migration failed: ${r.error}`);
      if (r.restoredFromBackup) console.error(`[startup] Restored from backup: ${r.backupPath}`);
      process.exit(1);
    }
  } else {
    console.log(`[startup] Schema is up to date`);
  }
  server.listen(port, () => console.log(`Ash glaze lab API listening on http://localhost:${port}`));
}

startServer().catch(err => {
  console.error(`[startup] Failed to start server: ${err.message}`);
  process.exit(1);
});
