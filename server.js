import http from "node:http";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const dbPath = join(__dirname, "data", "ash-glaze.json");
const port = Number(process.env.PORT || 3033);

const seed = {
  tiles: [
    {
      id: "AG-001",
      body: "粗陶坯",
      recipe: "松灰42 长石35 石英18 红土5",
      ashSource: "南山松灰",
      glazeThickness: "0.8mm",
      kiln: "K-2",
      firingCurve: [{ temp: 900, minutes: 60 }, { temp: 1240, minutes: 35 }],
      peakTemp: 1240,
      color: "青灰带油滴",
      defects: "边缘流釉",
      score: 82,
      observations: [{ at: "2026-06-10", note: "还原气氛后半段偏强" }]
    }
  ]
};

async function loadDb() {
  if (!existsSync(dbPath)) {
    await mkdir(dirname(dbPath), { recursive: true });
    await writeFile(dbPath, JSON.stringify(seed, null, 2));
  }
  return JSON.parse(await readFile(dbPath, "utf8"));
}
async function saveDb(db) { await writeFile(dbPath, JSON.stringify(db, null, 2)); }
async function body(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {};
}
function send(res, status, data) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(data, null, 2));
}
function routes() {
  return {
    service: "香灰釉试片实验室API",
    endpoints: ["GET /tiles?ashSource=&minTemp=", "POST /tiles", "GET /tiles/:id", "POST /tiles/:id/observations", "GET /reports/recipes"]
  };
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const db = await loadDb();
    if (req.method === "GET" && url.pathname === "/") return send(res, 200, routes());
    if (req.method === "GET" && url.pathname === "/tiles") {
      let rows = db.tiles;
      const ashSource = url.searchParams.get("ashSource");
      const minTemp = Number(url.searchParams.get("minTemp") || 0);
      if (ashSource) rows = rows.filter(t => t.ashSource.includes(ashSource));
      if (minTemp) rows = rows.filter(t => Number(t.peakTemp) >= minTemp);
      return send(res, 200, rows);
    }
    if (req.method === "POST" && url.pathname === "/tiles") {
      const input = await body(req);
      const tile = { id: input.id || `AG-${Date.now()}`, body: input.body, recipe: input.recipe, ashSource: input.ashSource, glazeThickness: input.glazeThickness, kiln: input.kiln, firingCurve: input.firingCurve || [], peakTemp: Number(input.peakTemp || 0), color: input.color || "", defects: input.defects || "", score: Number(input.score || 0), observations: [] };
      db.tiles.push(tile);
      await saveDb(db);
      return send(res, 201, tile);
    }
    const obsMatch = url.pathname.match(/^\/tiles\/([^/]+)\/observations$/);
    if (obsMatch && req.method === "POST") {
      const tile = db.tiles.find(t => t.id === obsMatch[1]);
      if (!tile) return send(res, 404, { error: "tile_not_found" });
      const input = await body(req);
      tile.observations.push({ at: input.at || new Date().toISOString().slice(0, 10), note: input.note });
      if (input.score !== undefined) tile.score = Number(input.score);
      await saveDb(db);
      return send(res, 201, tile);
    }
    const tileMatch = url.pathname.match(/^\/tiles\/([^/]+)$/);
    if (tileMatch && req.method === "GET") {
      const tile = db.tiles.find(t => t.id === tileMatch[1]);
      return tile ? send(res, 200, tile) : send(res, 404, { error: "tile_not_found" });
    }
    if (req.method === "GET" && url.pathname === "/reports/recipes") {
      const grouped = {};
      for (const tile of db.tiles) {
        grouped[tile.recipe] ||= { recipe: tile.recipe, count: 0, totalScore: 0, ashSources: new Set() };
        grouped[tile.recipe].count += 1;
        grouped[tile.recipe].totalScore += Number(tile.score || 0);
        grouped[tile.recipe].ashSources.add(tile.ashSource);
      }
      return send(res, 200, Object.values(grouped).map(g => ({ recipe: g.recipe, count: g.count, averageScore: Number((g.totalScore / g.count).toFixed(1)), ashSources: [...g.ashSources] })));
    }
    send(res, 404, { error: "not_found" });
  } catch (error) {
    send(res, 500, { error: error.message });
  }
});

server.listen(port, () => console.log(`Ash glaze lab API listening on http://localhost:${port}`));
