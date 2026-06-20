import http from "node:http";
import { loadDb } from "./lib/db.js";
import {
  routesInfo,
  readJsonBody,
  handleListTiles,
  handleCreateTile,
  handleGetTile,
  handleAddObservation,
  handleRecipesReport,
  handleImportPreview,
  handleImportCommit,
  handleCalcFiringPlan,
  handleListPlans,
  handleCreatePlan,
  handleGetPlan,
  handleUpdatePlan,
  handleDeletePlan,
  handleApplyPlan
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
  handleGetVersionReport
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
  handleBatchNoTiles
} from "./lib/inventory-routes.js";

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

    if (req.method === "GET" && url.pathname === "/tiles") {
      const r = await handleListTiles(url, db);
      return send(res, r.status, r.data);
    }

    if (req.method === "POST" && url.pathname === "/tiles") {
      const input = await readJsonBody(req);
      const r = await handleCreateTile(input, db);
      return send(res, r.status, r.data);
    }

    if (req.method === "POST" && url.pathname === "/import/preview") {
      const r = await handleImportPreview(req);
      return send(res, r.status, r.data);
    }

    if (req.method === "POST" && url.pathname === "/import/commit") {
      const input = await readJsonBody(req);
      const r = await handleImportCommit(input);
      return send(res, r.status, r.data);
    }

    const obsMatch = url.pathname.match(/^\/tiles\/([^/]+)\/observations$/);
    if (obsMatch && req.method === "POST") {
      const input = await readJsonBody(req);
      const r = await handleAddObservation(obsMatch[1], input, db);
      return send(res, r.status, r.data);
    }

    const tileMatch = url.pathname.match(/^\/tiles\/([^/]+)$/);
    if (tileMatch && req.method === "GET") {
      const r = await handleGetTile(tileMatch[1], db);
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

    send(res, 404, { error: "not_found" });
  } catch (error) {
    send(res, 500, { error: error.message });
  }
});

server.listen(port, () => console.log(`Ash glaze lab API listening on http://localhost:${port}`));
