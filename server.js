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

    send(res, 404, { error: "not_found" });
  } catch (error) {
    send(res, 500, { error: error.message });
  }
});

server.listen(port, () => console.log(`Ash glaze lab API listening on http://localhost:${port}`));
