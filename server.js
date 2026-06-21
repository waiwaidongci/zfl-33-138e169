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

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const db = await loadDb();

    if (req.method === "GET" && url.pathname === "/") {
      return send(res, 200, routesInfo());
    }

    if (req.method === "GET" && url.pathname === "/tile-status/info") {
      return send(res, 200, getStatusInfo());
    }

    if (req.method === "GET" && url.pathname === "/tiles") {
      const r = await handleListTiles(url, db);
      return send(res, r.status, r.data);
    }

    if (req.method === "POST" && url.pathname === "/tiles") {
      const input = await readJsonBody(req);
      const r = await handleCreateTile(input, db);
      return send(res, r.status, r.data);
    }

    if (req.method === "POST" && url.pathname === "/tiles/similar") {
      const input = await readJsonBody(req);
      const r = await handleSimilarTiles(input, db);
      return send(res, r.status, r.data);
    }

    if (req.method === "POST" && url.pathname === "/tiles/review") {
      const input = await readJsonBody(req);
      const r = await handlePostExperimentReview(input, db);
      return send(res, r.status, r.data);
    }

    if (req.method === "POST" && url.pathname === "/tiles/batch-status") {
      const input = await readJsonBody(req);
      const r = await handleBatchStatusTransition(input, db);
      return send(res, r.status, r.data);
    }

    if (req.method === "POST" && url.pathname === "/import/preview") {
      const r = await handleImportPreview(req);
      return send(res, r.status, r.data);
    }

    if (req.method === "POST" && url.pathname === "/import/commit") {
      const input = await readJsonBody(req);
      const r = await handleImportCommit(input, db);
      return send(res, r.status, r.data);
    }

    const obsMatch = url.pathname.match(/^\/tiles\/([^/]+)\/observations$/);
    if (obsMatch && req.method === "POST") {
      const input = await readJsonBody(req);
      const r = await handleAddObservation(obsMatch[1], input, db);
      return send(res, r.status, r.data);
    }

    const tileStatusHistoryMatch = url.pathname.match(/^\/tiles\/([^/]+)\/status-history$/);
    if (tileStatusHistoryMatch && req.method === "GET") {
      const r = await handleGetStatusHistory(tileStatusHistoryMatch[1], db);
      return send(res, r.status, r.data);
    }

    const tileStatusMatch = url.pathname.match(/^\/tiles\/([^/]+)\/status$/);
    if (tileStatusMatch && req.method === "GET") {
      const r = await handleGetTileStatus(tileStatusMatch[1], db);
      return send(res, r.status, r.data);
    }
    if (tileStatusMatch && req.method === "PATCH") {
      const input = await readJsonBody(req);
      const r = await handleTransitionStatus(tileStatusMatch[1], input, db);
      return send(res, r.status, r.data);
    }

    const tileMatch = url.pathname.match(/^\/tiles\/([^/]+)$/);
    if (tileMatch && req.method === "GET") {
      const r = await handleGetTile(tileMatch[1], db);
      return send(res, r.status, r.data);
    }
    if (tileMatch && req.method === "PATCH") {
      const input = await readJsonBody(req);
      const r = await handleUpdateTile(tileMatch[1], input, db);
      return send(res, r.status, r.data);
    }

    if (req.method === "GET" && url.pathname === "/reports/recipes") {
      const r = await handleRecipesReport(db);
      return send(res, r.status, r.data);
    }

    if (req.method === "POST" && url.pathname === "/firing-plans/calculate") {
      const input = await readJsonBody(req);
      const r = await handleCalcFiringPlan(input, db);
      return send(res, r.status, r.data);
    }

    if (req.method === "GET" && url.pathname === "/firing-plans") {
      const r = await handleListPlans(url, db);
      return send(res, r.status, r.data);
    }

    if (req.method === "POST" && url.pathname === "/firing-plans") {
      const input = await readJsonBody(req);
      const r = await handleCreatePlan(input, db);
      return send(res, r.status, r.data);
    }

    const planApplyMatch = url.pathname.match(/^\/firing-plans\/([^/]+)\/apply$/);
    if (planApplyMatch && req.method === "POST") {
      const input = await readJsonBody(req);
      const r = await handleApplyPlan(planApplyMatch[1], input, db);
      return send(res, r.status, r.data);
    }

    const planMatch = url.pathname.match(/^\/firing-plans\/([^/]+)$/);
    if (planMatch && req.method === "GET") {
      const r = await handleGetPlan(planMatch[1], db);
      return send(res, r.status, r.data);
    }
    if (planMatch && req.method === "PATCH") {
      const input = await readJsonBody(req);
      const r = await handleUpdatePlan(planMatch[1], input, db);
      return send(res, r.status, r.data);
    }
    if (planMatch && req.method === "DELETE") {
      const r = await handleDeletePlan(planMatch[1], db);
      return send(res, r.status, r.data);
    }

    if (req.method === "GET" && url.pathname === "/recipes") {
      const r = await handleListRecipes(url, db);
      return send(res, r.status, r.data);
    }

    if (req.method === "POST" && url.pathname === "/recipes") {
      const input = await readJsonBody(req);
      const r = await handleCreateRecipe(input, db);
      return send(res, r.status, r.data);
    }

    const recipeVersionsDiffMatch = url.pathname.match(/^\/recipes\/([^/]+)\/versions\/diff$/);
    if (recipeVersionsDiffMatch && req.method === "GET") {
      const versionIdA = url.searchParams.get("baseline");
      const versionIdB = url.searchParams.get("target");
      if (!versionIdA || !versionIdB) {
        return send(res, 400, {
          error: "missing_required",
          message: "缺少 baseline 或 target 参数",
          required: ["baseline", "target"]
        });
      }
      const r = await handleGetRecipeVersionDiff(recipeVersionsDiffMatch[1], versionIdA, versionIdB, db);
      return send(res, r.status, r.data);
    }

    const recipeVersionsReportMatch = url.pathname.match(/^\/recipes\/([^/]+)\/versions\/([^/]+)\/report$/);
    if (recipeVersionsReportMatch && req.method === "GET") {
      const r = await handleGetVersionReport(recipeVersionsReportMatch[1], recipeVersionsReportMatch[2], db);
      return send(res, r.status, r.data);
    }

    const recipeVersionsCopyMatch = url.pathname.match(/^\/recipes\/([^/]+)\/versions\/([^/]+)\/copy$/);
    if (recipeVersionsCopyMatch && req.method === "POST") {
      const input = await readJsonBody(req);
      const r = await handleCopyVersion(recipeVersionsCopyMatch[1], recipeVersionsCopyMatch[2], input, db);
      return send(res, r.status, r.data);
    }

    const recipeVersionsMatch = url.pathname.match(/^\/recipes\/([^/]+)\/versions\/([^/]+)$/);
    if (recipeVersionsMatch && req.method === "GET") {
      const r = await handleGetVersion(recipeVersionsMatch[1], recipeVersionsMatch[2], db);
      return send(res, r.status, r.data);
    }

    const recipeReportMatch = url.pathname.match(/^\/recipes\/([^/]+)\/report$/);
    if (recipeReportMatch && req.method === "GET") {
      const r = await handleGetRecipeReport(recipeReportMatch[1], db);
      return send(res, r.status, r.data);
    }

    const recipeVersionsListMatch = url.pathname.match(/^\/recipes\/([^/]+)\/versions$/);
    if (recipeVersionsListMatch && req.method === "GET") {
      const r = await handleListVersions(recipeVersionsListMatch[1], db);
      return send(res, r.status, r.data);
    }
    if (recipeVersionsListMatch && req.method === "POST") {
      const input = await readJsonBody(req);
      const r = await handleCreateVersion(recipeVersionsListMatch[1], input, db);
      return send(res, r.status, r.data);
    }

    const recipeMatch = url.pathname.match(/^\/recipes\/([^/]+)$/);
    if (recipeMatch && req.method === "GET") {
      const r = await handleGetRecipe(recipeMatch[1], db);
      return send(res, r.status, r.data);
    }
    if (recipeMatch && req.method === "PATCH") {
      const input = await readJsonBody(req);
      const r = await handleUpdateRecipe(recipeMatch[1], input, db);
      return send(res, r.status, r.data);
    }
    if (recipeMatch && req.method === "DELETE") {
      const r = await handleDeleteRecipe(recipeMatch[1], db);
      return send(res, r.status, r.data);
    }

    const batchSummaryMatch = url.pathname.match(/^\/batches\/([^/]+)\/summary$/);
    if (batchSummaryMatch && req.method === "GET") {
      const r = await handleGetBatchSummary(batchSummaryMatch[1], db);
      return send(res, r.status, r.data);
    }

    const batchObsMatch = url.pathname.match(/^\/batches\/([^/]+)\/observations$/);
    if (batchObsMatch && req.method === "POST") {
      const input = await readJsonBody(req);
      const r = await handleAddBatchObservation(batchObsMatch[1], input, db);
      return send(res, r.status, r.data);
    }

    const batchStatusMatch = url.pathname.match(/^\/batches\/([^/]+)\/status$/);
    if (batchStatusMatch && req.method === "PATCH") {
      const input = await readJsonBody(req);
      const r = await handleAdvanceBatchStatus(batchStatusMatch[1], input, db);
      return send(res, r.status, r.data);
    }

    const batchTilesMatch = url.pathname.match(/^\/batches\/([^/]+)\/tiles$/);
    if (batchTilesMatch && req.method === "POST") {
      const input = await readJsonBody(req);
      const r = await handleAddBatchTiles(batchTilesMatch[1], input, db);
      return send(res, r.status, r.data);
    }
    if (batchTilesMatch && req.method === "DELETE") {
      const input = await readJsonBody(req);
      const r = await handleRemoveBatchTiles(batchTilesMatch[1], input, db);
      return send(res, r.status, r.data);
    }

    if (req.method === "GET" && url.pathname === "/batches") {
      const r = await handleListBatches(url, db);
      return send(res, r.status, r.data);
    }

    if (req.method === "POST" && url.pathname === "/batches") {
      const input = await readJsonBody(req);
      const r = await handleCreateBatch(input, db);
      return send(res, r.status, r.data);
    }

    const batchMatch = url.pathname.match(/^\/batches\/([^/]+)$/);
    if (batchMatch && req.method === "GET") {
      const r = await handleGetBatch(batchMatch[1], db);
      return send(res, r.status, r.data);
    }

    if (req.method === "GET" && url.pathname === "/inventory") {
      const r = await handleListInventory(url, db);
      return send(res, r.status, r.data);
    }

    if (req.method === "POST" && url.pathname === "/inventory") {
      const input = await readJsonBody(req);
      const r = await handleCreateInventory(input, db);
      return send(res, r.status, r.data);
    }

    if (req.method === "GET" && url.pathname === "/inventory/summary") {
      const r = await handleInventorySummary(db);
      return send(res, r.status, r.data);
    }

    const inventoryBatchNoTilesMatch = url.pathname.match(/^\/inventory\/batch-no\/([^/]+)\/tiles$/);
    if (inventoryBatchNoTilesMatch && req.method === "GET") {
      const r = await handleBatchNoTiles(decodeURIComponent(inventoryBatchNoTilesMatch[1]), db);
      return send(res, r.status, r.data);
    }

    const inventoryBatchSummaryMatch = url.pathname.match(/^\/inventory\/batch-no\/([^/]+)\/summary$/);
    if (inventoryBatchSummaryMatch && req.method === "GET") {
      const r = await handleBatchUsageSummary(decodeURIComponent(inventoryBatchSummaryMatch[1]), db);
      return send(res, r.status, r.data);
    }

    const inventoryTransactionsTileMatch = url.pathname.match(/^\/inventory\/transactions\/tile\/([^/]+)$/);
    if (inventoryTransactionsTileMatch && req.method === "GET") {
      const r = await handleGetTileTransactions(inventoryTransactionsTileMatch[1], db);
      return send(res, r.status, r.data);
    }

    const inventoryTransactionsStockMatch = url.pathname.match(/^\/inventory\/transactions\/stock\/([^/]+)$/);
    if (inventoryTransactionsStockMatch && req.method === "GET") {
      const r = await handleGetStockTransactions(inventoryTransactionsStockMatch[1], db);
      return send(res, r.status, r.data);
    }

    const inventoryMatch = url.pathname.match(/^\/inventory\/([^/]+)$/);
    if (inventoryMatch && req.method === "GET") {
      const r = await handleGetInventory(inventoryMatch[1], db);
      return send(res, r.status, r.data);
    }
    if (inventoryMatch && req.method === "PATCH") {
      const input = await readJsonBody(req);
      const r = await handleUpdateInventory(inventoryMatch[1], input, db);
      return send(res, r.status, r.data);
    }
    if (inventoryMatch && req.method === "DELETE") {
      const r = await handleDeleteInventory(inventoryMatch[1], db);
      return send(res, r.status, r.data);
    }

    if (req.method === "GET" && url.pathname === "/defects/catalog") {
      const r = handleGetDefectCatalog();
      return send(res, r.status, r.data);
    }

    if (req.method === "GET" && url.pathname === "/defects/stats/overall") {
      const r = await handleGetOverallDefectStats(db);
      return send(res, r.status, r.data);
    }

    if (req.method === "GET" && url.pathname === "/defects/stats/by-kiln") {
      const r = await handleGetDefectStatsByKiln(url, db);
      return send(res, r.status, r.data);
    }

    if (req.method === "GET" && url.pathname === "/defects/stats/by-ash-source") {
      const r = await handleGetDefectStatsByAshSource(url, db);
      return send(res, r.status, r.data);
    }

    if (req.method === "GET" && url.pathname === "/defects/high-frequency") {
      const r = await handleGetHighFrequencyDefects(url, db);
      return send(res, r.status, r.data);
    }

    if (req.method === "GET" && url.pathname === "/defects/query/tiles") {
      const r = await handleQueryTilesByDefect(url, db);
      return send(res, r.status, r.data);
    }

    if (req.method === "POST" && url.pathname === "/defects/migrate") {
      const r = await handleRunDefectMigration(db);
      return send(res, r.status, r.data);
    }

    const tileDefectTagsMatch = url.pathname.match(/^\/tiles\/([^/]+)\/defect-tags$/);
    if (tileDefectTagsMatch && req.method === "GET") {
      const r = await handleGetTileDefectTags(tileDefectTagsMatch[1], db);
      return send(res, r.status, r.data);
    }
    if (tileDefectTagsMatch && req.method === "PATCH") {
      const input = await readJsonBody(req);
      const r = await handleUpdateTileDefectTags(tileDefectTagsMatch[1], input, db);
      return send(res, r.status, r.data);
    }
    if (tileDefectTagsMatch && req.method === "POST") {
      const input = await readJsonBody(req);
      const r = await handleAddDefectTag(tileDefectTagsMatch[1], input, db);
      return send(res, r.status, r.data);
    }
    if (tileDefectTagsMatch && req.method === "DELETE") {
      const input = await readJsonBody(req);
      const r = await handleRemoveDefectTag(tileDefectTagsMatch[1], input, db);
      return send(res, r.status, r.data);
    }

    const tileReviewMatch = url.pathname.match(/^\/tiles\/([^/]+)\/review$/);
    if (tileReviewMatch && req.method === "GET") {
      const r = await handleGetExperimentReview(tileReviewMatch[1], url, db);
      return send(res, r.status, r.data);
    }

    if (req.method === "GET" && url.pathname === "/dashboard/overview") {
      const r = await handleGetDashboardOverview(url, db);
      return send(res, r.status, r.data);
    }

    if (req.method === "GET" && url.pathname === "/dashboard/summary") {
      const r = await handleGetDashboardSummary(url, db);
      return send(res, r.status, r.data);
    }

    if (req.method === "GET" && url.pathname === "/dashboard/recent-observations") {
      const r = await handleGetRecentObservations(url, db);
      return send(res, r.status, r.data);
    }

    if (req.method === "GET" && url.pathname === "/dashboard/ash-source-scores") {
      const r = await handleGetAshSourceScores(url, db);
      return send(res, r.status, r.data);
    }

    if (req.method === "GET" && url.pathname === "/dashboard/defects-by-peak-temp") {
      const r = await handleGetDefectsByPeakTemp(url, db);
      return send(res, r.status, r.data);
    }

    if (req.method === "GET" && url.pathname === "/dashboard/low-score-tiles") {
      const r = await handleGetLowScoreTiles(url, db);
      return send(res, r.status, r.data);
    }

    if (req.method === "GET" && url.pathname === "/dashboard/compare") {
      const r = await handleGetDashboardCompare(url, db);
      return send(res, r.status, r.data);
    }

    if (req.method === "GET" && url.pathname === "/events/types") {
      const r = await handleGetEventTypes();
      return send(res, r.status, r.data);
    }

    if (req.method === "GET" && url.pathname === "/events/stats") {
      const r = await handleGetEventStats(db);
      return send(res, r.status, r.data);
    }

    const eventsByTypeMatch = url.pathname.match(/^\/events\/type\/([^/]+)$/);
    if (eventsByTypeMatch && req.method === "GET") {
      const r = await handleGetEventsByType(eventsByTypeMatch[1], url, db);
      return send(res, r.status, r.data);
    }

    const eventTimelineMatch = url.pathname.match(/^\/events\/timeline\/([^/]+)$/);
    if (eventTimelineMatch && req.method === "GET") {
      const r = await handleGetEntityTimeline(decodeURIComponent(eventTimelineMatch[1]), url, db);
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
