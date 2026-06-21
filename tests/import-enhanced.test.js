import { mkdir, writeFile, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = dirname(__dirname);
const testDir = join(projectRoot, "tests", "tmp-import");
const testDataDir = join(testDir, "data");
const testDbPath = join(testDataDir, "ash-glaze.json");
const testBackupDir = join(testDataDir, "backups");

process.env.ASH_GLAZE_DATA_DIR = testDataDir;
process.env.ASH_GLAZE_DB_PATH = testDbPath;
process.env.ASH_GLAZE_BACKUP_DIR = testBackupDir;

const { loadDb, saveDb, getExistingIds, insertTiles } = await import("../lib/db.js");
const { parseCSV, parseJSON, parseContent } = await import("../lib/parse.js");
const { validateRows } = await import("../lib/validate.js");
const { handleImportPreview, handleImportCommit, validateTileBusinessRules, buildBusinessValidation } = await import("../lib/routes.js");

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

async function setupTestDb() {
  if (existsSync(testDir)) {
    await rm(testDir, { recursive: true });
  }
  await mkdir(testDataDir, { recursive: true });

  const testDb = {
    schemaVersion: 2,
    migrations: [],
    collections: {
      tiles: [],
      firingPlans: [],
      recipes: [],
      recipeVersions: [
        {
          id: "RCV-0001",
          recipeId: "RC-001",
          version: 1,
          text: "松灰42 长石35 石英18 红土5",
          ingredients: [
            { name: "松灰", percentage: 42 },
            { name: "长石", percentage: 35 },
            { name: "石英", percentage: 18 },
            { name: "红土", percentage: 5 }
          ],
          createdAt: "2026-06-01"
        }
      ],
      batches: [],
      materialStocks: [
        { id: "MAT-001", name: "松灰", batchNo: "SG-2026-001", quantity: 50, unit: "kg", entryDate: "2026-05-15", supplier: "南山灰场", reorderThreshold: 10 },
        { id: "MAT-002", name: "长石", batchNo: "CS-2026-001", quantity: 80, unit: "kg", entryDate: "2026-05-20", supplier: "景德镇矿物站", reorderThreshold: 15 },
        { id: "MAT-003", name: "石英", batchNo: "SY-2026-001", quantity: 60, unit: "kg", entryDate: "2026-05-22", supplier: "景德镇矿物站", reorderThreshold: 10 },
        { id: "MAT-004", name: "红土", batchNo: "HT-2026-001", quantity: 30, unit: "kg", entryDate: "2026-06-01", supplier: "本地采集", reorderThreshold: 5 },
        { id: "MAT-005", name: "松灰", batchNo: "SG-2026-002", quantity: 2, unit: "kg", entryDate: "2026-06-10", supplier: "南山灰场", reorderThreshold: 10 }
      ]
    }
  };

  await writeFile(testDbPath, JSON.stringify(testDb, null, 2));
  return loadDb();
}

async function cleanup() {
  if (existsSync(testDir)) {
    await rm(testDir, { recursive: true });
  }
}

function waitForServer(child, port) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`server did not start on port ${port}`));
    }, 5000);
    const onData = data => {
      const text = data.toString();
      if (text.includes(`http://localhost:${port}`)) {
        clearTimeout(timer);
        child.stdout.off("data", onData);
        resolve();
      }
    };
    child.stdout.on("data", onData);
    child.stderr.on("data", data => {
      const text = data.toString();
      if (text.includes("EADDRINUSE")) {
        clearTimeout(timer);
        reject(new Error(`port ${port} already in use`));
      }
    });
    child.once("exit", code => {
      clearTimeout(timer);
      reject(new Error(`server exited before ready with code ${code}`));
    });
  });
}

function stopServer(child) {
  return new Promise(resolve => {
    if (child.exitCode !== null || child.signalCode) {
      resolve();
      return;
    }
    child.once("exit", resolve);
    child.kill("SIGTERM");
    setTimeout(() => {
      if (child.exitCode === null && !child.signalCode) child.kill("SIGKILL");
    }, 1000);
  });
}

console.log("\n=== 增强批量导入流程测试 ===\n");

console.log("\n1. CSV解析测试 - 新字段识别");
try {
  const csvText = `id,body,recipe,recipeVersionId,defectTags,materialBatchRefs,batchWeight
AG-001,粗陶坯,松灰42 长石35 石英18 红土5,RCV-0001,"[{""name"":""流釉"",""severity"":""mild""}]","[{""ingredientName"":""松灰"",""batchNo"":""SG-2026-001""},{""ingredientName"":""长石"",""batchNo"":""CS-2026-001""}]",10
AG-002,细瓷坯,稻灰40 长石40 石英18 红土2,,流釉:mild,稻灰:DH-2026-001;长石:CS-2026-001,5`;

  const result = parseCSV(csvText);
  assert(result.rows.length === 2, "应解析2行数据");
  assert(Array.isArray(result.rows[0].defectTags), "第一行defectTags应为数组");
  assertEq(result.rows[0].defectTags[0].name, "流釉", "第一行defectTags名称应正确");
  assertEq(result.rows[0].recipeVersionId, "RCV-0001", "第一行recipeVersionId应正确");
  assert(Array.isArray(result.rows[0].materialBatchRefs), "第一行materialBatchRefs应为数组");
  assertEq(result.rows[0].batchWeight, 10, "第一行batchWeight应为数字10");
  assert(Array.isArray(result.rows[1].defectTags), "第二行简化格式defectTags应为数组");
  assertEq(result.rows[1].defectTags[0].name, "流釉", "第二行简化格式defectTags名称应正确");
  assert(Array.isArray(result.rows[1].materialBatchRefs), "第二行简化格式materialBatchRefs应为数组");
  assertEq(result.rows[1].materialBatchRefs[0].ingredientName, "稻灰", "第二行简化格式materialBatchRefs原料名应正确");
  assertEq(result.rows[1].batchWeight, 5, "第二行batchWeight应为数字5");
} catch (e) {
  console.log(`  ✗ CSV解析测试失败: ${e.message}`);
  failed++;
  failures.push(`CSV解析测试: ${e.message}`);
}

console.log("\n2. JSON解析测试 - 新字段识别");
try {
  const jsonText = JSON.stringify([
    {
      id: "AG-001",
      body: "粗陶坯",
      recipe: "松灰42 长石35 石英18 红土5",
      recipeVersionId: "RCV-0001",
      defectTags: [{ name: "流釉", severity: "mild" }, { name: "针孔", severity: "medium" }],
      materialBatchRefs: [
        { ingredientName: "松灰", batchNo: "SG-2026-001" },
        { ingredientName: "长石", batchNo: "CS-2026-001" }
      ],
      batchWeight: 10
    }
  ]);

  const result = parseJSON(jsonText);
  assert(result.rows.length === 1, "应解析1行数据");
  assert(Array.isArray(result.rows[0].defectTags), "defectTags应为数组");
  assertEq(result.rows[0].defectTags.length, 2, "defectTags应包含2个标签");
  assertEq(result.rows[0].recipeVersionId, "RCV-0001", "recipeVersionId应正确");
  assert(Array.isArray(result.rows[0].materialBatchRefs), "materialBatchRefs应为数组");
  assertEq(result.rows[0].materialBatchRefs.length, 2, "materialBatchRefs应包含2个引用");
  assertEq(typeof result.rows[0].batchWeight, "number", "batchWeight应为数字类型");
  assertEq(result.rows[0].batchWeight, 10, "batchWeight应为10");
} catch (e) {
  console.log(`  ✗ JSON解析测试失败: ${e.message}`);
  failed++;
  failures.push(`JSON解析测试: ${e.message}`);
}

console.log("\n3. 解析错误处理测试");
try {
  const csvText = `id,body,recipe,defectTags,batchWeight
AG-001,粗陶坯,松灰42 长石35 石英18 红土5,"[invalid json]",not_a_number`;

  const result = parseCSV(csvText);
  assert(result.parseErrors !== undefined, "应返回parseErrors");
  assert(result.parseErrors.length >= 1, "应至少有1个解析错误");
  const batchWeightError = result.parseErrors.find(e => e.field === "batchWeight");
  assert(batchWeightError !== undefined, "应有batchWeight字段的解析错误");
  assert(batchWeightError.error.includes("必须为数字"), "错误信息应包含'必须为数字'");
} catch (e) {
  console.log(`  ✗ 解析错误处理测试失败: ${e.message}`);
  failed++;
  failures.push(`解析错误处理测试: ${e.message}`);
}

console.log("\n4. 缺陷标签校验测试 (validateTileBusinessRules)");
try {
  const db = await setupTestDb();

  const validInput = {
    body: "粗陶坯",
    recipe: "松灰42 长石35 石英18 红土5",
    defectTags: [{ name: "流釉", severity: "mild" }]
  };
  const validResult = await validateTileBusinessRules(db, validInput, { autoCreateRecipe: false });
  assert(validResult.valid === true, "有效缺陷标签应通过校验");
  assertEq(validResult.defectTags[0].name, "流釉", "缺陷标签名称应被标准化");
  assertEq(validResult.defectTags[0].severity, "mild", "缺陷标签严重程度应正确");

  const invalidInput = {
    body: "粗陶坯",
    recipe: "松灰42 长石35 石英18 红土5",
    defectTags: [{ name: "未知缺陷", severity: "invalid" }]
  };
  const invalidResult = await validateTileBusinessRules(db, invalidInput, { autoCreateRecipe: false });
  assert(invalidResult.valid === false, "无效缺陷标签应校验失败");
  assert(invalidResult.errors.some(e => e.includes("defectTags校验失败")), "错误信息应包含defectTags校验失败");
} catch (e) {
  console.log(`  ✗ 缺陷标签校验测试失败: ${e.message}`);
  failed++;
  failures.push(`缺陷标签校验测试: ${e.message}`);
}

console.log("\n5. 配方版本匹配测试");
try {
  const db = await setupTestDb();

  const matchedInput = {
    body: "粗陶坯",
    recipe: "松灰42 长石35 石英18 红土5",
    recipeVersionId: "RCV-0001"
  };
  const matchedResult = await validateTileBusinessRules(db, matchedInput, { autoCreateRecipe: false });
  assert(matchedResult.valid === true, "存在的recipeVersionId应通过校验");
  assert(matchedResult.recipeVersion !== null, "应返回匹配的配方版本");
  assertEq(matchedResult.recipeVersion.id, "RCV-0001", "配方版本ID应正确");

  const unmatchedInput = {
    body: "粗陶坯",
    recipe: "松灰42 长石35 石英18 红土5",
    recipeVersionId: "RCV-9999"
  };
  const unmatchedResult = await validateTileBusinessRules(db, unmatchedInput, { autoCreateRecipe: false });
  assert(unmatchedResult.recipeVersion === null, "不存在的recipeVersionId应返回null");
} catch (e) {
  console.log(`  ✗ 配方版本匹配测试失败: ${e.message}`);
  failed++;
  failures.push(`配方版本匹配测试: ${e.message}`);
}

console.log("\n6. 库存扣减风险测试");
try {
  const db = await setupTestDb();

  const sufficientInput = {
    body: "粗陶坯",
    recipe: "松灰42 长石35 石英18 红土5",
    recipeVersionId: "RCV-0001",
    materialBatchRefs: [
      { ingredientName: "松灰", batchNo: "SG-2026-001" },
      { ingredientName: "长石", batchNo: "CS-2026-001" },
      { ingredientName: "石英", batchNo: "SY-2026-001" },
      { ingredientName: "红土", batchNo: "HT-2026-001" }
    ],
    batchWeight: 10
  };
  const sufficientResult = await validateTileBusinessRules(db, sufficientInput, { autoCreateRecipe: false });
  assert(sufficientResult.valid === true, "库存充足时应通过校验");
  assert(sufficientResult.materialBatchRefs !== null, "应返回处理后的materialBatchRefs");
  assert(sufficientResult.materialBatchRefs[0].unit !== undefined, "应包含计量单位（预留模式下不再预设 deducted）");

  const insufficientInput = {
    body: "粗陶坯",
    recipe: "松灰42 长石35 石英18 红土5",
    recipeVersionId: "RCV-0001",
    materialBatchRefs: [
      { ingredientName: "松灰", batchNo: "SG-2026-002" },
      { ingredientName: "长石", batchNo: "CS-2026-001" },
      { ingredientName: "石英", batchNo: "SY-2026-001" },
      { ingredientName: "红土", batchNo: "HT-2026-001" }
    ],
    batchWeight: 10
  };
  const insufficientResult = await validateTileBusinessRules(db, insufficientInput, { autoCreateRecipe: false });
  assert(insufficientResult.valid === false, "库存不足时应校验失败");
  assert(insufficientResult.errors.some(e => e.includes("库存不足")), "错误信息应包含'库存不足'");
} catch (e) {
  console.log(`  ✗ 库存扣减风险测试失败: ${e.message}`);
  failed++;
  failures.push(`库存扣减风险测试: ${e.message}`);
}

console.log("\n7. buildBusinessValidation 预览校验测试");
try {
  const db = await setupTestDb();

  const rows = [
    {
      __line: 2,
      id: "AG-001",
      body: "粗陶坯",
      recipe: "松灰42 长石35 石英18 红土5",
      recipeVersionId: "RCV-0001",
      defectTags: [{ name: "流釉", severity: "mild" }],
      materialBatchRefs: [
        { ingredientName: "松灰", batchNo: "SG-2026-001" },
        { ingredientName: "长石", batchNo: "CS-2026-001" },
        { ingredientName: "石英", batchNo: "SY-2026-001" },
        { ingredientName: "红土", batchNo: "HT-2026-001" }
      ],
      batchWeight: 10
    },
    {
      __line: 3,
      id: "AG-002",
      body: "细瓷坯",
      recipe: "松灰42 长石35 石英18 红土5",
      recipeVersionId: "RCV-9999",
      defectTags: [{ name: "未知缺陷", severity: "invalid" }],
      materialBatchRefs: [
        { ingredientName: "松灰", batchNo: "SG-2026-002" },
        { ingredientName: "长石", batchNo: "CS-2026-001" }
      ],
      batchWeight: 100
    }
  ];

  const result = buildBusinessValidation(rows, db);

  assert(result.summary !== undefined, "应包含summary");
  assert(result.summary.overallRisk !== undefined, "应包含overallRisk");
  assert(result.summary.overallRiskLabel !== undefined, "应包含overallRiskLabel");

  assert(result.defectTagResults.validCount === 1, "应有1个有效缺陷标签行");
  assert(result.defectTagResults.invalidCount === 1, "应有1个无效缺陷标签行");
  assert(result.defectTagResults.details[0].tags[0].severityLabel !== undefined, "缺陷标签应包含severityLabel");

  assert(result.recipeVersionMatches.matchedCount === 1, "应有1个匹配的配方版本");
  assert(result.recipeVersionMatches.unmatchedCount === 1, "应有1个不匹配的配方版本");

  assert(result.inventoryRisks.rowsWithRefs === 2, "应有2行包含库存引用");
  assert(result.inventoryRisks.riskFreeCount === 1, "应有1行无风险");
  assert(result.inventoryRisks.atRiskCount === 1, "应有1行有风险");
  assert(result.inventoryRisks.details[0].deductions[0].riskLevel !== undefined, "扣减明细应包含riskLevel");
  assert(result.inventoryRisks.details[0].deductions[0].riskLabel !== undefined, "扣减明细应包含riskLabel");
  assert(result.inventoryRisks.details[0].overallRiskLevel !== undefined, "行应包含overallRiskLevel");
  assert(result.inventoryRisks.details[1].riskType !== undefined, "风险行应包含riskType");
} catch (e) {
  console.log(`  ✗ buildBusinessValidation测试失败: ${e.message}`);
  failed++;
  failures.push(`buildBusinessValidation测试: ${e.message}`);
}

console.log("\n8. handleImportCommit 业务规则复用测试");
try {
  const db = await setupTestDb();
  const existingIds = getExistingIds(db);

  const validRows = [
    {
      __line: 2,
      id: "AG-IMPORT-001",
      body: "粗陶坯",
      recipe: "松灰42 长石35 石英18 红土5",
      recipeVersionId: "RCV-0001",
      defectTags: [{ name: "流釉", severity: "mild" }],
      materialBatchRefs: [
        { ingredientName: "松灰", batchNo: "SG-2026-001" },
        { ingredientName: "长石", batchNo: "CS-2026-001" },
        { ingredientName: "石英", batchNo: "SY-2026-001" },
        { ingredientName: "红土", batchNo: "HT-2026-001" }
      ],
      batchWeight: 10
    }
  ];

  const parsedData = { headers: Object.keys(validRows[0]).filter(k => k !== "__line"), rows: validRows, format: "json" };
  const validatedResult = validateRows(parsedData, existingIds);
  const previewToken = "test_token_123";

  const mod = await import("../lib/routes.js");
  mod.previewCacheSet(previewToken, validatedResult.importable);

  const commitResult = await handleImportCommit({
    previewToken,
    confirm: true,
    duplicateStrategy: "skip"
  }, db);

  assert(commitResult.status === 200, "导入提交应成功");
  assertEq(commitResult.data.insertedCount, 1, "应成功插入1条记录");
  assertEq(commitResult.data.businessErrorCount, 0, "不应有业务错误");

  const insertedTile = db.collections.tiles.find(t => t.id === "AG-IMPORT-001");
  assert(insertedTile !== undefined, "应找到插入的试片");
  assertEq(insertedTile.recipeVersionId, "RCV-0001", "recipeVersionId应正确");
  assert(insertedTile.defectTags.length === 1, "defectTags应被正确设置");
  assert(insertedTile.materialBatchRefs.length === 4, "materialBatchRefs应被正确设置");
  assert(insertedTile.materialBatchRefs[0].deducted === undefined, "草稿试片不预设 deducted（预留模式下确认消耗时设置）");
  assert(insertedTile.inventoryDeducted === false, "草稿试片 inventoryDeducted 为 false（预留模式下进入待烧成时预留）");

  const stockAfter = db.collections.materialStocks.find(s => s.id === "MAT-001");
  assertEq(stockAfter.quantity, 50, "松灰库存未即时扣减（预留模式下进入待烧成时才预留）");

  mod.previewCacheDelete(previewToken);
} catch (e) {
  console.log(`  ✗ handleImportCommit测试失败: ${e.message}`);
  console.log(e.stack);
  failed++;
  failures.push(`handleImportCommit测试: ${e.message}`);
}

console.log("\n9. handleImportCommit 业务约束测试 (阻止非法导入)");
try {
  const db = await setupTestDb();
  const existingIds = getExistingIds(db);

  const invalidRows = [
    {
      __line: 2,
      id: "AG-IMPORT-002",
      body: "粗陶坯",
      recipe: "松灰42 长石35 石英18 红土5",
      recipeVersionId: "RCV-0001",
      defectTags: [{ name: "流釉", severity: "mild" }],
      materialBatchRefs: [
        { ingredientName: "松灰", batchNo: "SG-2026-001" }
      ],
      batchWeight: 10
    }
  ];

  const parsedData = { headers: Object.keys(invalidRows[0]).filter(k => k !== "__line"), rows: invalidRows, format: "json" };
  const validatedResult = validateRows(parsedData, existingIds);
  assertEq(validatedResult.importable.length, 1, "结构校验应通过，行应进入importable");

  const previewToken = "test_token_456";

  const mod = await import("../lib/routes.js");
  mod.previewCacheSet(previewToken, validatedResult.importable);

  const commitResult = await handleImportCommit({
    previewToken,
    confirm: true,
    duplicateStrategy: "skip"
  }, db);

  assert(commitResult.status === 200, "请求应成功但包含业务错误");
  assertEq(commitResult.data.insertedCount, 0, "不应插入记录");
  assertEq(commitResult.data.businessErrorCount, 1, "应有1个业务错误");
  assert(commitResult.data.businessErrors[0].errors.some(e => e.includes("库存不足")), "错误应包含库存不足（缺少原料批号引用）");

  const tileCount = db.collections.tiles.filter(t => t.id === "AG-IMPORT-002").length;
  assertEq(tileCount, 0, "非法试片不应被写入数据库");

  mod.previewCacheDelete(previewToken);
} catch (e) {
  console.log(`  ✗ handleImportCommit业务约束测试失败: ${e.message}`);
  console.log(e.stack);
  failed++;
  failures.push(`handleImportCommit业务约束测试: ${e.message}`);
}

console.log("\n10. handleImportCommit 库存不足阻止测试");
try {
  const db = await setupTestDb();
  const existingIds = getExistingIds(db);

  const insufficientStockRows = [
    {
      __line: 2,
      id: "AG-IMPORT-003",
      body: "粗陶坯",
      recipe: "松灰42 长石35 石英18 红土5",
      recipeVersionId: "RCV-0001",
      defectTags: [],
      materialBatchRefs: [
        { ingredientName: "松灰", batchNo: "SG-2026-002" },
        { ingredientName: "长石", batchNo: "CS-2026-001" },
        { ingredientName: "石英", batchNo: "SY-2026-001" },
        { ingredientName: "红土", batchNo: "HT-2026-001" }
      ],
      batchWeight: 10
    }
  ];

  const parsedData = { headers: Object.keys(insufficientStockRows[0]).filter(k => k !== "__line"), rows: insufficientStockRows, format: "json" };
  const validatedResult = validateRows(parsedData, existingIds);
  const previewToken = "test_token_789";

  const mod = await import("../lib/routes.js");
  mod.previewCacheSet(previewToken, validatedResult.importable);

  const commitResult = await handleImportCommit({
    previewToken,
    confirm: true,
    duplicateStrategy: "skip"
  }, db);

  assert(commitResult.status === 200, "请求应成功但包含业务错误");
  assertEq(commitResult.data.insertedCount, 0, "库存不足时不应插入记录");
  assertEq(commitResult.data.businessErrorCount, 1, "应有1个业务错误");
  assert(commitResult.data.businessErrors[0].errors.some(e => e.includes("库存不足")), "错误应包含'库存不足'");

  mod.previewCacheDelete(previewToken);
} catch (e) {
  console.log(`  ✗ handleImportCommit库存不足测试失败: ${e.message}`);
  console.log(e.stack);
  failed++;
  failures.push(`handleImportCommit库存不足测试: ${e.message}`);
}

console.log("\n11. HTTP /import/preview -> /import/commit 路由集成测试");
try {
  await setupTestDb();
  const port = 43217;
  const child = spawn("node", ["server.js"], {
    cwd: projectRoot,
    env: {
      ...process.env,
      PORT: String(port),
      ASH_GLAZE_DATA_DIR: testDataDir,
      ASH_GLAZE_DB_PATH: testDbPath,
      ASH_GLAZE_BACKUP_DIR: testBackupDir
    },
    stdio: ["ignore", "pipe", "pipe"]
  });

  try {
    await waitForServer(child, port);
    const importRows = [
      {
        id: "AG-HTTP-001",
        body: "粗陶坯",
        recipe: "松灰42 长石35 石英18 红土5",
        recipeVersionId: "RCV-0001",
        defectTags: [{ name: "流釉", severity: "mild" }],
        materialBatchRefs: [
          { ingredientName: "松灰", batchNo: "SG-2026-001" },
          { ingredientName: "长石", batchNo: "CS-2026-001" },
          { ingredientName: "石英", batchNo: "SY-2026-001" },
          { ingredientName: "红土", batchNo: "HT-2026-001" }
        ],
        batchWeight: 10
      }
    ];

    const previewRes = await fetch(`http://localhost:${port}/import/preview`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(importRows)
    });
    const preview = await previewRes.json();
    assertEq(previewRes.status, 200, "HTTP预览应返回200");
    assert(preview.previewToken, "HTTP预览应返回previewToken");
    assertEq(preview.businessValidation.summary.canCommit, true, "HTTP预览应允许提交");

    const commitRes = await fetch(`http://localhost:${port}/import/commit`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ previewToken: preview.previewToken, confirm: true })
    });
    const commit = await commitRes.json();
    assertEq(commitRes.status, 200, "HTTP提交应返回200");
    assertEq(commit.insertedCount, 1, "HTTP提交应插入1条记录");
    assertEq(commit.businessErrorCount, 0, "HTTP提交不应有业务错误");

    const db = await loadDb();
    const insertedTile = db.collections.tiles.find(t => t.id === "AG-HTTP-001");
    assert(insertedTile !== undefined, "HTTP提交后应写入试片");
    assertEq(insertedTile.inventoryDeducted, false, "HTTP提交后草稿试片 inventoryDeducted 为 false（预留模式下需进入待烧成才预留）");
  } finally {
    await stopServer(child);
  }
} catch (e) {
  console.log(`  ✗ HTTP路由集成测试失败: ${e.message}`);
  failed++;
  failures.push(`HTTP路由集成测试: ${e.message}`);
}

await cleanup();

console.log(`\n=== 测试结果: ${passed} 通过, ${failed} 失败 ===`);
if (failures.length > 0) {
  console.log("\n失败详情:");
  failures.forEach((f, i) => console.log(`${i + 1}. ${f}`));
  process.exit(1);
} else {
  console.log("\n所有测试通过!");
  process.exit(0);
}
