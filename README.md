# 香灰釉试片实验室API

运行：

```bash
npm start
```

默认端口`3033`。数据保存在`data/ash-glaze.json`。

---

## Schema 迁移系统

### 概述

系统内置了可回滚的数据迁移引擎，将单一 JSON 数据文件演进为带 `schemaVersion` 的多集合格式，支持 `tiles`、`recipes`、`batches`、`materials` 等集合逐步迁移。

### 数据格式演进

**旧格式 (v0, legacy)**：所有集合平铺在 JSON 根节点

```json
{
  "tiles": [...],
  "firingPlans": [...],
  "recipes": [...]
}
```

**新格式 (v1+)**：带 schemaVersion 和元数据

```json
{
  "schemaVersion": 3,
  "migrations": [
    { "version": 1, "name": "introduce-schema-version", "appliedAt": "2026-..." },
    { "version": 2, "name": "add-tile-status-fields", "appliedAt": "2026-..." },
    { "version": 3, "name": "add-inventory-reservation", "appliedAt": "2026-..." }
  ],
  "collections": {
    "tiles": [...],
    "firingPlans": [...],
    "recipes": [...],
    "recipeVersions": [...],
    "batches": [...],
    "materialStocks": [...],
    "inventoryTransactions": [...]
  }
}
```

### 启动自动迁移

服务启动时会自动检测数据文件版本，若存在待执行迁移则自动执行：

```bash
$ npm start

[startup] Schema migrated from v0 to v1 (1 migration(s) applied)
[startup] Backup created at: /path/to/data/backups/ash-glaze_pre-migrate-v0_....bak.json
Ash glaze lab API listening on http://localhost:3033
```

迁移失败时会自动从备份恢复，不会破坏原文件。

### 命令行工具

| 命令 | 说明 |
|------|------|
| `npm run migrate:status` | 查看当前版本、已应用/待执行迁移、备份列表 |
| `npm run migrate:up` | 执行所有待执行迁移 |
| `npm run migrate:rollback` | 回滚最近一次迁移 |
| `npm run migrate:backups` | 列出所有备份文件 |
| `npm run migrate:restore -- <filename>` | 从指定备份恢复 |
| `npm run test:migrate` | 运行迁移系统回归测试 |

也可直接调用 CLI：

```bash
# 查看状态
node scripts/migrate-cli.js status

# 执行迁移
node scripts/migrate-cli.js up

# 回滚
node scripts/migrate-cli.js rollback

# 查看备份
node scripts/migrate-cli.js list-backups

# 从备份恢复
node scripts/migrate-cli.js restore ash-glaze_pre-migrate_20260101-120000.bak.json
```

### 备份机制

- 迁移前自动创建备份，格式：`ash-glaze_<label>_YYYYMMDD-HHMMSS.bak.json`
- 备份目录：`data/backups/`
- 迁移过程中任何一步失败，自动从备份恢复原文件
- 回滚前同样会先创建备份

### 添加新迁移

在 `lib/migrations/` 目录下新建脚本文件，命名格式为 `NNN-name.js`（NNN 为三位数字版本号）：

```javascript
// lib/migrations/002-example-migration.js
export const version = 2;
export const name = "example-migration";
export const description = "迁移说明";

export function up(db) {
  // db._helpers 提供工具函数：isNewFormat, toNewFormat, toLegacyFormat, getCollections, getSchemaVersion
  const { getCollections } = db._helpers;
  const coll = getCollections(db);
  // 数据转换逻辑...
  return {
    migrated: true,
    collectionsCount: { tiles: coll.tiles.length },
    result: db  // 返回转换后的 db 对象
  };
}

export function down(db) {
  // 反向转换
  return { rolledBack: true, result: db };
}

export function validate(db) {
  const errors = [];
  // 校验逻辑
  return { valid: errors.length === 0, errors };
}
```

### 架构说明

核心模块：

- [lib/db.js](file:///Users/ali/Desktop/zfl%20%20new%20solo%20coder/zfl-33/lib/db.js) — 存储层，新旧格式双兼容，备份恢复
- [lib/schema-migration.js](file:///Users/ali/Desktop/zfl%20%20new%20solo%20coder/zfl-33/lib/schema-migration.js) — 迁移引擎，加载脚本、执行 up/down、出错回滚
- [lib/migrations/](file:///Users/ali/Desktop/zfl%20%20new%20solo%20coder/zfl-33/lib/migrations) — 各版本迁移脚本
- [scripts/migrate-cli.js](file:///Users/ali/Desktop/zfl%20%20new%20solo%20coder/zfl-33/scripts/migrate-cli.js) — 命令行工具

上层业务代码通过 `getCollections(db)` 统一访问集合数据，新旧格式透明兼容。

## API 端点

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/` | 服务信息与端点列表 |
| GET | `/tiles?ashSource=&minTemp=&maxTemp=&kiln=&minScore=&maxScore=&hasDefects=&sort=&recipeVersionId=&status=&batchId=` | 查询试片列表 |
| POST | `/tiles` | 新增单个试片 |
| GET | `/tiles/:id` | 查询单个试片 |
| POST | `/tiles/:id/observations` | 添加观察记录 |
| POST | `/tiles/similar` | 试片相似度检索 |
| GET | `/reports/recipes` | 配方汇总报告 |
| POST | `/import/preview` | 批量导入预览 |
| POST | `/import/commit` | 确认批量导入写入 |
| POST | `/firing-plans/calculate` | 计算烧成曲线（仅预览，不保存） |
| GET | `/firing-plans?kiln=&status=` | 查询规划草稿列表 |
| POST | `/firing-plans` | 保存烧成规划草稿 |
| GET | `/firing-plans/:id` | 查询单个规划草稿 |
| PATCH | `/firing-plans/:id` | 更新规划草稿 |
| DELETE | `/firing-plans/:id` | 删除规划草稿 |
| POST | `/firing-plans/:id/apply` | 将规划应用为新试片记录 |
| GET | `/batches?kiln=&status=&plannedDate=&targetAtmosphere=` | 查询实验批次列表 |
| POST | `/batches` | 创建实验批次 |
| GET | `/batches/:id` | 查看批次详情 |
| POST | `/batches/:id/tiles` | 向批次追加试片 |
| DELETE | `/batches/:id/tiles` | 从批次移除试片 |
| PATCH | `/batches/:id/status` | 推进批次状态 |
| POST | `/batches/:id/observations` | 添加批次观察记录 |
| GET | `/batches/:id/summary` | 生成批次结果摘要 |
| GET | `/inventory?name=&batchNo=&lowStock=` | 查询原料库存列表 |
| POST | `/inventory` | 新增原料库存记录 |
| GET | `/inventory/summary` | 原料库存汇总（按原料名称分组） |
| GET | `/inventory/:id` | 查询单条库存记录 |
| PATCH | `/inventory/:id` | 更新库存记录 |
| DELETE | `/inventory/:id` | 删除库存记录 |
| GET | `/inventory/batch-no/:batchNo/tiles` | 查询引用指定批号的所有试片 |
| GET | `/inventory/batch-no/:batchNo/summary` | 单个原料批号使用摘要 |
| GET | `/inventory/transactions/tile/:tileId` | 查询指定试片的库存流水 |
| GET | `/inventory/transactions/stock/:stockId` | 查询指定库存记录的流水 |
| GET | `/dashboard/overview?daysBack=&lowScoreThreshold=&lowScoreLimit=&recentObsLimit=&ashSource=&kiln=` | 仪表盘总览 |
| GET | `/dashboard/summary?ashSource=&kiln=` | 核心指标汇总 |
| GET | `/dashboard/recent-observations?daysBack=&limit=&ashSource=&kiln=` | 近期观察记录 |
| GET | `/dashboard/ash-source-scores?ashSource=&kiln=` | 按灰源分组评分 |
| GET | `/dashboard/defects-by-peak-temp?ashSource=&kiln=` | 按温度区间缺陷分布 |
| GET | `/dashboard/low-score-tiles?threshold=&limit=&ashSource=&kiln=` | 低分样砖预警 |
| GET | `/dashboard/compare?baselineType=&baselineValue=&targetType=&targetValue=&lowScoreThreshold=` | **两个scope对比分析**（新增） |
| GET | `/recipes/:id/versions/diff?baseline=&target=` | **配方版本差异对比**（新增） |

---

### 试片列表查询参数

`GET /tiles` 支持以下查询参数，可自由组合：

| 参数 | 类型 | 说明 |
|------|------|------|
| `ashSource` | string | 灰来源模糊匹配（包含即可） |
| `minTemp` | number | 峰值温度下限（≥） |
| `maxTemp` | number | 峰值温度上限（≤） |
| `kiln` | string | 窑号精确匹配 |
| `minScore` | number | 评分下限（≥） |
| `maxScore` | number | 评分上限（≤） |
| `hasDefects` | string | 是否有缺陷：`true` 仅返回有缺陷的试片，`false` 仅返回无缺陷的试片，不传则不过滤 |
| `sort` | string | 排序字段，支持 `score`、`peakTemp`、`id`；字段名前加 `-` 表示降序，如 `-score` |
| `recipeVersionId` | string | 配方版本 id 精确匹配 |
| `status` | string | 试片状态精确匹配 |
| `batchId` | string | 所属批次 id 精确匹配 |

示例：

```bash
# 查询 K-2 窑、温度 1200~1260℃、评分 70~90 之间、有缺陷的试片，按评分降序
curl "http://localhost:3033/tiles?kiln=K-2&minTemp=1200&maxTemp=1260&minScore=70&maxScore=90&hasDefects=true&sort=-score"
```

---

## 批量导入使用示例

### 1. 步骤一：提交数据获取预览

支持 **CSV** 和 **JSON** 两种格式，可以通过 **raw body** 直传，也可以通过 **multipart/form-data 上传文件**。格式通过 `Content-Type`、文件名后缀或内容首字符自动识别。

#### 方式 A：直接上传文件（multipart/form-data，推荐）

```bash
# 准备 CSV 文件
cat > /tmp/tiles.csv << 'EOF'
id,body,recipe,ashSource,peakTemp,color,score
AG-002,粗陶坯,松灰45 长石30 石英20 高岭5,南山松灰,1240,青灰,78
AG-003,细瓷坯,稻灰40 长石40 石英18 红土2,东北稻灰,1260,月白,85
AG-001,粗陶坯,已存在记录,xxx,1200,xx,60
EOF

# 通过 -F file=@路径 上传
curl -X POST http://localhost:3033/import/preview \
  -F "file=@/tmp/tiles.csv"
```

JSON 文件同理：

```bash
curl -X POST http://localhost:3033/import/preview \
  -F "file=@/tmp/tiles.json"
```

> 字段名约定为 `file`。通过文件名后缀 `.csv` / `.json` 自动判定格式，无需额外设置 Content-Type。

#### 方式 B：Raw Body 直接提交 CSV

```bash
curl -X POST http://localhost:3033/import/preview \
  -H "Content-Type: text/csv" \
  -d 'id,body,recipe,ashSource,peakTemp,color,score
AG-002,粗陶坯,松灰45 长石30 石英20 高岭5,南山松灰,1240,青灰,78
AG-003,细瓷坯,稻灰40 长石40 石英18 红土2,东北稻灰,1260,月白,85
AG-001,粗陶坯,已有id记录,xxx,1200,xx,60'
```

#### 方式 C：Raw Body 直接提交 JSON

```bash
curl -X POST http://localhost:3033/import/preview \
  -H "Content-Type: application/json" \
  -d '[
    {"id":"AG-004","body":"粗陶坯","recipe":"竹灰42 长石35 石英18 红土5","ashSource":"莫干山竹灰","peakTemp":1235,"color":"灰青","score":80},
    {"id":"AG-005","body":"细瓷坯","recipe":"木灰50 长石30 石英18 高岭2","ashSource":"果木灰","peakTemp":1250,"color":"乳白","score":88},
    {"id":"AG-001","body":"粗陶坯","recipe":"已存在的id","ashSource":"xx","peakTemp":1200,"color":"","score":0}
  ]'
```

#### 预览返回字段说明

```jsonc
{
  "format": "csv",
  "source": { "type": "file", "name": "tiles.csv" },  // raw 或 file
  "headers": {
    "recognized": ["id","body","recipe","ashSource","peakTemp","color","score"],
    "unrecognized": [],        // 未识别列名（警告，不阻断）
    "missingRequired": []      // 缺失必填列：id, body, recipe
  },
  "counts": {
    "totalRows": 3,
    "importableRows": 3,       // 校验通过、可导入的行数
    "errorRows": 0             // 含错误的行数
  },
  "duplicateIds": ["AG-001"],                     // 全部重复 id 汇总
  "duplicateWithinImport": [],                    // 本次导入文件内部重复的 id（属于错误，不会导入）
  "duplicateWithExisting": ["AG-001"],            // 与数据库已有记录重复的 id（属于警告，可导入时按策略处理）
  "errorSummary": [],
  "errors": [],
  "previewToken": "prev_1_17xxx",                 // 10 分钟内有效
  "previewRows": [ ... ]                          // 前 5 条可导入数据
}
```

> **关于重复 id 的修正说明**：
> - `duplicateWithinImport`（导入内部重复）：同一份提交数据里出现两次相同 id → 视为错误行，不进入 `importableRows`，必须先修正才能导入。
> - `duplicateWithExisting`（与现有重复）：提交数据里的 id 在 `data/ash-glaze.json` 中已存在 → **不是错误**，会计入 `importableRows`，真正写入时根据 `duplicateStrategy` 决定是跳过（`skip`）还是覆盖（`overwrite`）。

---

### 2. 步骤二：确认写入数据库

拿到 `previewToken` 后，调用 `/import/commit` 正式写入 `data/ash-glaze.json`：

```bash
curl -X POST http://localhost:3033/import/commit \
  -H "Content-Type: application/json" \
  -d '{
    "previewToken": "prev_1_17xxxxxxxxx",
    "confirm": true,
    "duplicateStrategy": "skip"
  }'
```

#### 参数说明

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `previewToken` | string | ✅ | 预览接口返回的 token，10 分钟内有效 |
| `confirm` | boolean | ✅ | 必须显式设为 `true` 才会真正写入 |
| `duplicateStrategy` | string | - | 与数据库已有 id 重复时的处理策略：<br>`skip`（默认）重复 id 全部跳过，不修改已有记录<br>`overwrite` 删除数据库中同 id 旧记录后写入新记录 |

#### 写入成功返回

```json
{
  "insertedCount": 2,
  "skippedCount": 1,
  "overwrittenCount": 0,
  "insertedIds": ["AG-002", "AG-003"],
  "skippedIds": ["AG-001"],
  "overwrittenIds": []
}
```

> 若使用 `duplicateStrategy: "overwrite"`，被替换的 id 会出现在 `overwrittenIds` 和 `overwrittenCount` 中，`insertedIds` 同样包含这些被覆盖后重新写入的 id。

---

## 字段定义

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| id | string | ✅ | 试片唯一编号，重复会被跳过或覆盖 |
| body | string | ✅ | 坯体类型 |
| recipe | string | ✅ | 釉方配方 |
| ashSource | string | - | 灰来源 |
| glazeThickness | string | - | 施釉厚度 |
| kiln | string | - | 窑位/窑号 |
| firingCurve | array | - | 烧成曲线（累计时间-温度）`[{temp, minutes}]`，按时间递增排列，`minutes` 为从烧成开始的累计分钟数 |
| peakTemp | number | - | 烧成最高温度 |
| color | string | - | 釉色 |
| defects | string | - | 缺陷描述 |
| score | number | - | 评分 0-100 |
| observations | array | - | 观察记录 `[{at, note}]` |
| fromPlanId | string | - | 若从烧成规划创建，记录规划 id |

> **CSV 提示**：`firingCurve`、`observations` 等数组字段在 CSV 中请以 JSON 字符串表示，并用双引号包裹，例如 `"[{""temp"":900,""minutes"":60}]"`。

---

## 烧成曲线规划模块

### 模块概述

烧成曲线规划模块根据用户提交的目标峰值温度、窑炉编号、升温阶段和保温时间，自动生成规范化的 `firingCurve`，并给出风险提示以及与历史试片相似曲线的对比结果。规划可保存为草稿，确认后可直接应用到新的试片记录。

### 已知窑炉配置

系统内置以下窑炉参数用于风险评估：

| 窑号 | 名称 | 温度范围 | 最大升温速率 |
|------|------|----------|--------------|
| K-1 | 小型电窑 | 1180~1280℃ | 180℃/h |
| K-2 | 中型气窑 | 1200~1300℃ | 200℃/h |
| K-3 | 大型柴窑 | 1220~1320℃ | 220℃/h |

---

### 1. 计算烧成曲线（预览）

`POST /firing-plans/calculate`

仅计算并返回规划结果，**不保存**到数据库。适合前端实时预览。

#### 请求参数

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `peakTemp` | number | ✅ | 目标峰值温度（℃） |
| `kiln` | string | - | 窑炉编号，用于风险评估 |
| `holdMinutes` | number | - | 峰值保温时间（分钟），默认 0 |
| `heatingStages` | array | - | 自定义升温阶段，不提供则使用默认三段升温 |

`heatingStages` 元素结构：

| 字段 | 类型 | 说明 |
|------|------|------|
| `endTemp` 或 `temp` | number | 阶段目标温度（℃） |
| `rate` | number | 升温速率 ℃/h（与 `minutes` 二选一） |
| `minutes` | number | 该阶段总耗时（分钟） |

#### 示例：最简参数（使用默认三段升温）

```bash
curl -X POST http://localhost:3033/firing-plans/calculate \
  -H "Content-Type: application/json" \
  -d '{
    "peakTemp": 1240,
    "kiln": "K-2",
    "holdMinutes": 35
  }'
```

#### 示例：自定义升温阶段

```bash
curl -X POST http://localhost:3033/firing-plans/calculate \
  -H "Content-Type: application/json" \
  -d '{
    "peakTemp": 1260,
    "kiln": "K-2",
    "holdMinutes": 40,
    "heatingStages": [
      { "endTemp": 600, "rate": 150 },
      { "endTemp": 1000, "rate": 120 },
      { "endTemp": 1200, "rate": 80 }
    ]
  }'
```

#### 返回字段说明

```jsonc
{
  "peakTemp": 1240,
  "kiln": "K-2",
  "holdMinutes": 35,
  "heatingStages": [],
  "firingCurve": [                    // 规范化后的烧成曲线
    { "temp": 25, "minutes": 0 },
    { "temp": 600, "minutes": 192 },
    { "temp": 900, "minutes": 312 },
    { "temp": 1100, "minutes": 412 },
    { "temp": 1240, "minutes": 496 },
    { "temp": 1240, "minutes": 531 }
  ],
  "totalDurationMinutes": 531,          // 总烧成时间（分钟）
  "totalDurationHours": 8.85,           // 总烧成时间（小时）
  "heatingRates": [                          // 各阶段实际升温速率
    { "from": 25, "to": 600, "rateCelsiusPerHour": 180 },
    { "from": 600, "to": 900, "rateCelsiusPerHour": 150 },
    { "from": 900, "to": 1100, "rateCelsiusPerHour": 120 },
    { "from": 1100, "to": 1240, "rateCelsiusPerHour": 100 }
  ],
  "risks": [                               // 风险提示列表
    {
      "level": "warning",
      "code": "INITIAL_HEATING_FAST",
      "message": "低温阶段升温速率 180℃/h 偏快，坯体残余水分可能导致开裂"
    },
    {
      "level": "info",                     // danger / warning / info
      "code": "USING_DEFAULT_STAGES",
      "message": "未提供升温阶段，使用默认三段升温曲线"
    }
  ],
  "riskCount": { "danger": 0, "warning": 1, "info": 1 },
  "similarCurves": [                        // 历史相似曲线 Top3
    {
      "tileId": "AG-001",
      "tileRecipe": "松灰42 长石35 石英18 红土5",
      "tileKiln": "K-2",
      "tilePeakTemp": 1240,
      "tileScore": 82,
      "tileColor": "青灰带油滴",
      "tileDefects": "边缘流釉",
      "tileFiringCurve": [
        { "temp": 25, "minutes": 0 },
        { "temp": 600, "minutes": 180 },
        { "temp": 900, "minutes": 300 },
        { "temp": 1240, "minutes": 510 },
        { "temp": 1240, "minutes": 545 }
      ],
      "similarity": 95.7,                    // 相似度 0-100
      "peakTempDiff": 0                      // 峰值温差
    }
  ]
}
```

---

### 2. 保存规划草稿

`POST /firing-plans`

将规划保存为草稿，参数与 `/calculate` 相同，额外支持：

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | string | 自定义规划 id，不填则自动生成 `FP-{timestamp}` |
| `name` | string | 规划名称 |
| `notes` | string | 备注 |

#### 示例

```bash
curl -X POST http://localhost:3033/firing-plans \
  -H "Content-Type: application/json" \
  -d '{
    "id": "FP-TEST-001",
    "name": "K-2标准1240℃松灰釉",
    "peakTemp": 1240,
    "kiln": "K-2",
    "holdMinutes": 35,
    "notes": "测试用标准曲线"
  }'
```

---

### 3. 查询规划列表

`GET /firing-plans?kiln=K-2&status=draft`

支持查询参数：`kiln`（窑号）、`status`（状态：draft / applied）。

```bash
curl http://localhost:3033/firing-plans
```

---

### 4. 查询单个规划

`GET /firing-plans/:id`

```bash
curl http://localhost:3033/firing-plans/FP-TEST-001
```

---

### 5. 更新规划

`PATCH /firing-plans/:id`

可部分更新，若修改 `peakTemp`、`holdMinutes`、`heatingStages`、`kiln` 会自动重新计算 `firingCurve`、`risks`、`similarCurves`。

```bash
curl -X PATCH http://localhost:3033/firing-plans/FP-TEST-001 \
  -H "Content-Type: application/json" \
  -d '{
    "holdMinutes": 45,
    "notes": "延长保温至45分钟"
  }'
```

---

### 6. 删除规划

`DELETE /firing-plans/:id`

```bash
curl -X DELETE http://localhost:3033/firing-plans/FP-TEST-001
```

---

### 7. 将规划应用为新试片

`POST /firing-plans/:id/apply`

根据规划创建一条新的试片记录，自动填入 `firingCurve`、`peakTemp`、`kiln` 字段，并在 `observations` 中添加来源说明。

#### 请求参数

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `body` | string | ✅ | 坯体类型 |
| `recipe` | string | ✅ | 釉方配方 |
| `id` | string | - | 自定义试片 id |
| `ashSource` | string | - | 灰来源 |
| `glazeThickness` | string | - | 施釉厚度 |
| `color` | string | - | 釉色（烧成后填） |
| `defects` | string | - | 缺陷（烧成后填） |
| `score` | number | - | 评分（烧成后填） |

#### 示例

```bash
curl -X POST http://localhost:3033/firing-plans/FP-TEST-001/apply \
  -H "Content-Type: application/json" \
  -d '{
    "id": "AG-099",
    "body": "粗陶坯",
    "recipe": "松灰42 长石35 石英18 红土5",
    "ashSource": "南山松灰",
    "glazeThickness": "0.8mm"
  }'
```

#### 返回

```jsonc
{
  "tile": {
    "id": "AG-099",
    "body": "粗陶坯",
    "recipe": "松灰42 长石35 石英18 红土5",
    "ashSource": "南山松灰",
    "glazeThickness": "0.8mm",
    "kiln": "K-2",
    "firingCurve": [
      { "temp": 25, "minutes": 0 },
      { "temp": 600, "minutes": 192 },
      { "temp": 900, "minutes": 312 },
      { "temp": 1100, "minutes": 412 },
      { "temp": 1240, "minutes": 496 },
      { "temp": 1240, "minutes": 531 }
    ],
    "peakTemp": 1240,
    "color": "",
    "defects": "",
    "score": 0,
    "observations": [
      {
        "at": "2026-06-20",
        "note": "本试片基于烧成规划 FP-TEST-001 (K-2标准1240℃松灰釉) 创建..."
      }
    ],
    "fromPlanId": "FP-TEST-001"
  },
  "planId": "FP-TEST-001"
}
```

---

### 8. 将规划应用为实验批次（applyMode=batch）

`POST /firing-plans/:id/apply` 支持 `applyMode=batch` 参数，可一键生成实验批次，自动创建批次、生成或关联试片，并将所有试片推进到待烧成状态。

#### 请求参数

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `applyMode` | string | ✅ | 必须为 `"batch"` |
| `batchName` | string | ✅ | 批次名称 |
| `plannedDate` | string | ✅ | 计划烧成日期，格式 `YYYY-MM-DD` |
| `targetAtmosphere` | string | ✅ | 目标气氛，如 `"氧化"`、`"还原"` |
| `tiles` | array | ✅ | 试片列表，每个元素为试片数据对象 |
| `operator` | string | - | 操作人，默认 `"system"` |

**`tiles` 数组元素结构**：

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `tileId` | string | - | 关联现有试片的 id（与 `body`/`recipe` 二选一） |
| `body` | string | - | 坯体类型（新建试片时必填） |
| `recipe` | string | - | 釉方配方（新建试片时必填） |
| `id` | string | - | 自定义试片 id（新建时可选） |
| `ashSource` | string | - | 灰来源 |
| `glazeThickness` | string | - | 施釉厚度 |
| `materialBatchRefs` | array | - | 原料批次引用，用于库存扣减 `[{ingredientName, batchNo}]` |
| `batchWeight` | number | - | 总重量（与 `materialBatchRefs` 同时提供时触发库存扣减） |

> **提示**：`tiles` 数组中的每个元素可以是：
> 1. **新建试片**：提供 `body`、`recipe` 等字段，系统自动创建
> 2. **关联现有试片**：提供 `tileId`，系统将已有的草稿状态试片加入批次

#### 示例：一键生成批次

```bash
curl -X POST http://localhost:3033/firing-plans/FP-TEST-001/apply \
  -H "Content-Type: application/json" \
  -d '{
    "applyMode": "batch",
    "batchName": "K-2还原气氛松灰釉实验批次",
    "plannedDate": "2026-06-25",
    "targetAtmosphere": "还原",
    "operator": "lab_tech",
    "tiles": [
      {
        "body": "粗陶坯",
        "recipe": "松灰42 长石35 石英18 红土5",
        "ashSource": "南山松灰",
        "glazeThickness": "0.8mm",
        "materialBatchRefs": [
          { "ingredientName": "松灰", "batchNo": "SG-2026-001" },
          { "ingredientName": "长石", "batchNo": "CS-2026-001" },
          { "ingredientName": "石英", "batchNo": "SY-2026-001" },
          { "ingredientName": "红土", "batchNo": "HT-2026-001" }
        ],
        "batchWeight": 10
      },
      {
        "tileId": "AG-EXISTING-001",
        "materialBatchRefs": [
          { "ingredientName": "松灰", "batchNo": "SG-2026-001" },
          { "ingredientName": "长石", "batchNo": "CS-2026-001" },
          { "ingredientName": "石英", "batchNo": "SY-2026-001" },
          { "ingredientName": "红土", "batchNo": "HT-2026-001" }
        ],
        "batchWeight": 8
      }
    ]
  }'
```

#### 成功返回

```jsonc
{
  "batch": {
    "id": "BATCH-001",
    "name": "K-2还原气氛松灰釉实验批次",
    "kiln": "K-2",
    "plannedDate": "2026-06-25",
    "targetAtmosphere": "还原",
    "tileIds": ["AG-1234567890000-0", "AG-EXISTING-001"],
    "status": "planned",
    "observations": [...],
    "createdAt": "2026-06-21",
    "updatedAt": "2026-06-21"
  },
  "planId": "FP-TEST-001",
  "tiles": [
    { /* 试片1详情 */ },
    { /* 试片2详情 */ }
  ],
  "transitions": [
    {
      "id": "AG-1234567890000-0",
      "from": "draft",
      "to": "pending_firing",
      "statusRecord": { /* 状态变更记录 */ }
    }
  ],
  "stockDeductions": [
    {
      "tileId": "AG-1234567890000-0",
      "deductions": [
        { "stockId": "MAT-001", "ingredientName": "松灰", "batchNo": "SG-2026-001", "requiredQuantity": 4.2, "unit": "kg" }
      ]
    }
  ]
}
```

#### 错误处理

| HTTP 状态码 | error 字段 | 触发条件 |
|-------------|------------|----------|
| 400 | `missing_required` | 缺少必填字段 |
| 400 | `tile_validation_failed` | 一个或多个试片验证失败（详情见 errors 数组） |
| 409 | `plan_already_applied` | 该规划已应用于某个批次，不可重复应用 |
| 409 | `insufficient_stock` | 某个试片的原料库存不足 |
| 409 | `status_transition_failed` | 某个试片状态推进失败 |

**重复应用防护**：每个烧成规划只能应用为一个批次，已应用的规划会返回 409 错误。

**状态校验**：关联现有试片时，仅草稿（`draft`）状态的试片可加入批次。

**库存扣减**：提供 `materialBatchRefs` 和 `batchWeight` 时，系统会自动校验库存并扣减。

---

### 烧成规划草稿字段定义

| 字段 | 类型 | 说明 |
|------|------|------|
| id | string | 规划唯一编号 |
| name | string | 规划名称 |
| status | string | `draft` 草稿 / `applied` 已应用 |
| kiln | string | 窑炉编号 |
| peakTemp | number | 峰值温度 |
| holdMinutes | number | 保温时间（分钟） |
| heatingStages | array | 输入的升温阶段配置 |
| firingCurve | array | 规范化后烧成曲线 `[{temp, minutes}]` |
| totalDurationMinutes | number | 总烧成时间（分钟） |
| heatingRates | array | 各阶段升温速率 `[{from, to, rateCelsiusPerHour}]` |
| risks | array | 风险列表 `[{level, code, message}]` |
| riskCount | object | 风险统计 `{danger, warning, info}` |
| similarCurves | array | 历史相似曲线 Top3 |
| notes | string | 备注 |
| createdAt | string | 创建日期 |
| updatedAt | string | 更新日期 |
| appliedTileId | string | 单试片应用时关联的试片 id |
| appliedBatchId | string | 批次应用时关联的批次 id |
| appliedTileIds | array | 批次应用时关联的所有试片 id 列表 |

---

## 实验批次模块

### 模块概述

实验批次用于把多个香灰釉试片组织成一次烧成实验。批次记录窑炉、计划日期、目标气氛、试片 id 列表、当前状态和批次观察记录，并可基于批次内试片生成结果摘要。

批次状态按以下顺序推进：

```text
planned -> loading -> firing -> cooling -> completed
```

### 批次字段定义

| 字段 | 类型 | 说明 |
|------|------|------|
| id | string | 批次唯一编号，不传时自动生成 `BATCH-001` 形式编号 |
| name | string | 批次名称 |
| kiln | string | 窑炉编号 |
| plannedDate | string | 计划烧成日期，格式建议为 `YYYY-MM-DD` |
| targetAtmosphere | string | 目标气氛，例如 `氧化`、`还原` |
| tileIds | array | 批次包含的试片 id 列表 |
| status | string | 当前状态：`planned`、`loading`、`firing`、`cooling`、`completed` |
| observations | array | 批次观察记录 `[{at, note}]` |
| createdAt | string | 创建日期 |
| updatedAt | string | 更新日期 |

### 1. 创建批次

`POST /batches`

#### 请求参数

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `kiln` | string | ✅ | 窑炉编号 |
| `id` | string | - | 自定义批次 id |
| `name` | string | - | 批次名称 |
| `plannedDate` | string | - | 计划日期，默认当天 |
| `targetAtmosphere` | string | - | 目标气氛，默认 `氧化` |
| `tileIds` | array | - | 初始试片 id 列表 |

```bash
curl -X POST http://localhost:3033/batches \
  -H "Content-Type: application/json" \
  -d '{
    "name": "K-2还原气氛松灰釉实验",
    "kiln": "K-2",
    "plannedDate": "2026-06-25",
    "targetAtmosphere": "还原",
    "tileIds": ["AG-001"]
  }'
```

### 2. 查询批次列表

`GET /batches?kiln=K-2&status=loading&plannedDate=2026-06-25&targetAtmosphere=还原`

支持按 `kiln`、`status`、`plannedDate`、`targetAtmosphere` 过滤。

```bash
curl "http://localhost:3033/batches?kiln=K-2&status=loading"
```

### 3. 查看批次详情

`GET /batches/:id`

返回批次基础信息，并在 `tiles` 字段中展开已匹配到的试片详情。

```bash
curl http://localhost:3033/batches/BATCH-001
```

### 4. 追加试片

`POST /batches/:id/tiles`

`tileIds` 必须为非空数组。若传入不存在的试片 id，会返回 `tile_not_found`。

```bash
curl -X POST http://localhost:3033/batches/BATCH-001/tiles \
  -H "Content-Type: application/json" \
  -d '{
    "tileIds": ["AG-001"]
  }'
```

返回中的 `added` 表示本次新增的试片，`duplicated` 表示已在批次中的试片。

### 5. 移除试片

`DELETE /batches/:id/tiles`

```bash
curl -X DELETE http://localhost:3033/batches/BATCH-001/tiles \
  -H "Content-Type: application/json" \
  -d '{
    "tileIds": ["AG-001"]
  }'
```

返回中的 `removed` 表示已移除的试片，`notInBatch` 表示原本不在批次中的试片。

### 6. 推进批次状态

`PATCH /batches/:id/status`

状态只能保持当前阶段或推进到下一阶段，不能跳级或回退。传入 `note` 时会同时写入一条批次观察记录。

```bash
curl -X PATCH http://localhost:3033/batches/BATCH-001/status \
  -H "Content-Type: application/json" \
  -d '{
    "status": "firing",
    "note": "开始升温"
  }'
```

### 7. 添加批次观察记录

`POST /batches/:id/observations`

```bash
curl -X POST http://localhost:3033/batches/BATCH-001/observations \
  -H "Content-Type: application/json" \
  -d '{
    "at": "2026-06-25",
    "note": "还原气氛稳定"
  }'
```

### 8. 生成批次结果摘要

`GET /batches/:id/summary`

摘要会统计批次内已匹配试片的数量、评分、缺陷分布、釉色分布、缺失试片 id、批次观察记录，以及按多维度的分组统计。

**基础字段**（保持向后兼容）：
| 字段 | 类型 | 说明 |
|------|------|------|
| `batchId` | string | 批次 id |
| `batchName` | string | 批次名称 |
| `kiln` | string | 窑号 |
| `plannedDate` | string | 计划日期 |
| `targetAtmosphere` | string | 目标气氛 |
| `status` | string | 批次状态 |
| `totalTiles` | number | 批次内试片总数 |
| `scoredTiles` | number | 已评分数 |
| `avgScore` / `maxScore` / `minScore` | number | 评分统计 |
| `defectSummary` | object | 按缺陷名称的旧版文本统计（兼容旧入口） |
| `colorSummary` | object | 按釉色分组计数 |
| `missingTileIds` | array | 批次中引用但不存在的试片 id |
| `observations` | array | 批次观察记录 |
| `tiles` | array | 批次内所有试片的精简信息（含 `recipeVersionId`） |

**新增分组统计字段**：
| 字段 | 类型 | 说明 |
|------|------|------|
| `defectBySeverity` | array | 按缺陷严重度统计（轻度 `mild`、中度 `medium`、重度 `severe`），每项含 `key`、`label`（中文标签）、`count` |
| `groupByAshSource` | array | 按灰源分组，每组含 `tileCount`、`tilesWithDefects`、`defectRate`（%）、`defectCounts`（缺陷明细）、`severityCounts`（严重度分布） |
| `groupByRecipeVersion` | array | 按配方版本分组，每组含 `recipeVersionId`、`recipeVersion`（版本号）、`recipeText`、`label`、评分统计（`avgScore`/`maxScore`/`minScore`）、缺陷率、缺陷明细及严重度分布 |
| `groupByScoreRange` | array | 按评分区间分组（未评分 / <60 / 60-69 / 70-79 / 80-89 / ≥90），每组含 `key`、`label`、`tileCount`、`tileIds`（区间内试片 id 列表） |

```bash
curl http://localhost:3033/batches/BATCH-001/summary
```

---

## 原料库存模块

### 模块概述

原料库存模块用于管理釉方原料的入库、库存预警、批号追踪以及原料消耗统计。系统支持按原料名称、批号过滤，低库存预警，并提供原料批号与试片的关联追踪。

### 库存字段定义

| 字段 | 类型 | 说明 |
|------|------|------|
| id | string | 库存记录唯一编号，自动生成 `MAT-001` 形式 |
| name | string | 原料名称 |
| batchNo | string | 原料批号，唯一 |
| quantity | number | 当前库存数量 |
| unit | string | 计量单位，默认 `kg` |
| entryDate | string | 入库日期 |
| supplier | string | 供应商 |
| reorderThreshold | number | 预警阈值，库存低于此值触发低库存预警 |
| notes | string | 备注 |
| createdAt | string | 创建日期 |
| updatedAt | string | 更新日期 |

### 1. 查询库存列表

`GET /inventory?name=&batchNo=&lowStock=`

支持查询参数：
- `name`：按原料名称精确匹配
- `batchNo`：按批号精确匹配
- `lowStock`：设为 `true` 仅返回库存低于预警阈值的记录

```bash
curl "http://localhost:3033/inventory?lowStock=true"
```

### 2. 新增库存记录

`POST /inventory`

```bash
curl -X POST http://localhost:3033/inventory \
  -H "Content-Type: application/json" \
  -d '{
    "name": "长石",
    "batchNo": "CS-2026-002",
    "quantity": 100,
    "unit": "kg",
    "reorderThreshold": 20,
    "supplier": "景德镇陶瓷原料厂"
  }'
```

### 3. 库存汇总

`GET /inventory/summary`

按原料名称分组汇总，显示各原料总库存量和所有批次信息。

```bash
curl http://localhost:3033/inventory/summary
```

### 4. 查询引用指定批号的试片

`GET /inventory/batch-no/:batchNo/tiles`

返回所有使用了该原料批号的试片列表。

```bash
curl http://localhost:3033/inventory/batch-no/CS-2026-001/tiles
```

### 5. 单个原料批号使用摘要

`GET /inventory/batch-no/:batchNo/summary`

返回指定原料批号的完整使用摘要，包含：

- 当前库存、预警阈值、是否低库存
- 被哪些试片引用，每个试片扣用量
- 按配方成分汇总的消耗量

#### 返回字段说明

```jsonc
{
  "batchNo": "SG-2026-001",              // 原料批号
  "materialName": "松灰",                 // 原料名称
  "unit": "kg",                           // 计量单位
  "currentStock": 45.8,                   // 当前库存
  "reorderThreshold": 10,                 // 预警阈值
  "supplier": "南山林场",                 // 供应商
  "entryDate": "2026-05-15",              // 入库日期
  "isLowStock": false,                    // 是否低于预警阈值
  "totalUsed": 4.2,                       // 累计使用量
  "tileCount": 2,                         // 引用试片数量
  "tiles": [                              // 各试片扣用详情
    {
      "tileId": "AG-001",
      "body": "粗陶坯",
      "recipe": "松灰42 长石35 石英18 红土5",
      "batchWeight": 10,
      "ingredientName": "松灰",
      "deducted": 4.2,
      "unit": "kg",
      "status": "fired"
    }
  ],
  "consumptionByIngredient": [            // 按配方成分汇总消耗
    {
      "ingredientName": "松灰",
      "totalDeducted": 4.2,
      "unit": "kg",
      "tileCount": 2
    }
  ]
}
```

#### 示例

```bash
curl http://localhost:3033/inventory/batch-no/SG-2026-001/summary
```

#### 错误响应

| HTTP 状态码 | error 字段 | 触发条件 |
|-------------|------------|----------|
| 404 | `batch_not_found` | 指定的批号不存在 |

---

## 试片相似度检索模块

### 模块概述

试片相似度检索模块根据用户输入的查询条件（坯体、香灰来源、峰值温度、配方、颜色关键词、缺陷关键词、评分），在历史试片库中进行多维度加权匹配，返回最相似的试片列表，并提供每条匹配结果的可解释原因。相似度计算完全在本地完成，**不依赖任何外部 AI 服务**。

### 计算公式

综合相似度采用**加权平均**，公式如下：

```
similarityScore = Σ(维度得分 × 维度权重) / Σ(维度权重)
```

仅用户实际提供的查询条件参与计算，未提供的条件不纳入分子和分母。峰值温度维度额外引入温差衰减权重，温差越大，该维度在总分中的实际占比越低。

### 相似度评分规则

| 维度 | 权重 | 评分规则 |
|------|------|----------|
| 坯体 (body) | 20 | 完全匹配 100 分；字符串互相包含 70 分；否则 0 分 |
| 香灰来源 (ashSource) | 20 | 完全匹配 100 分；分词后计算 Dice 系数 × 80 分；否则 0 分 |
| 峰值温度 (peakTemp) | 25 | 温差 0℃ = 100 分；≤20℃ 线性递减至 70 分；20~50℃ 递减至 30 分；>50℃ 继续递减 |
| 配方 (recipe) | 20 | 分词提取原料名称后计算重合比例，重合度 × 100 分 |
| 颜色关键词 (colorKeywords) | 7 | 命中关键词数 / 关键词总数 × 100 分 |
| 缺陷关键词 (defectKeywords) | 5 | 命中关键词数 / 关键词总数 × 100 分 |
| 评分 (score) | 3 | max(0, 100 - 评分差 × 2) |

#### 峰值温度权重衰减

峰值温度维度在加权平均中引入温差衰减系数，温差越大该维度实际权重越低：

| 温差范围 | 衰减系数 | 实际权重 |
|----------|----------|----------|
| 0 ~ 20℃ | 1.0 | 25 |
| 21 ~ 50℃ | 0.5 | 12.5 |
| > 50℃ | 0.1 | 2.5 |

#### 配方原料提取规则

配方文本按空格和标点分词后，取每段前缀中非数字部分作为原料名称。例如 `"松灰42 长石35 石英18 红土5"` 提取为 `["松灰", "长石", "石英", "红土"]`。匹配时支持子串包含（如 `"松灰"` 可匹配 `"南山松灰"`）。

#### 香灰来源分词匹配

香灰来源字段按空格和标点分词，不做中文自动切词，再计算 Dice 系数：`Dice = 2 × 共有词数 / (查询词数 + 历史词数)`，得分 = `Dice × 80`。例如查询 `"南山 松灰"` 与历史 `"北山 松灰"` 共有词 `["松灰"]`，Dice = 2×1/(2+2) = 0.5，得分 = 40；若输入为连续文本 `"南山松灰"` 与 `"北山松灰"`，会按各自整体词处理，不会自动拆出 `"松灰"`。

### 1. 相似度检索接口

`POST /tiles/similar`

#### 请求参数

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `body` | string | - | 坯体类型 |
| `ashSource` | string | - | 香灰来源 |
| `peakTemp` | number | - | 目标峰值温度（℃），必须 > 0 |
| `recipe` | string | - | 釉方配方文本，用于原料重合度计算 |
| `colorKeywords` | string / string[] | - | 颜色关键词，支持空格分隔字符串或字符串数组 |
| `color` | string | - | 颜色关键词（与 `colorKeywords` 效果相同，同时传入时 `colorKeywords` 优先） |
| `defectKeywords` | string / string[] | - | 缺陷关键词，支持空格分隔字符串或字符串数组 |
| `defects` | string | - | 缺陷关键词（与 `defectKeywords` 效果相同，同时传入时 `defectKeywords` 优先） |
| `score` | number | - | 目标评分 0-100，必须 > 0 |
| `topN` | number | - | 返回条数，默认 5，范围 1-50 |
| `minScore` | number | - | 最低相似度阈值 0-100，低于此值的结果不返回，默认 0 |

> 至少需要提供一个查询条件，否则返回 400 错误。

#### 错误响应

| HTTP 状态码 | error 字段 | 触发条件 |
|-------------|------------|----------|
| 400 | `empty_query` | 未提供任何查询条件 |

```json
{
  "error": "empty_query",
  "message": "至少提供一个查询条件：body, ashSource, peakTemp, recipe, colorKeywords/color, defectKeywords/defects, score"
}
```

#### 示例：按坯体 + 温度 + 配方检索

```bash
curl -X POST http://localhost:3033/tiles/similar \
  -H "Content-Type: application/json" \
  -d '{
    "body": "粗陶坯",
    "peakTemp": 1240,
    "recipe": "松灰42 长石35 石英18 红土5",
    "topN": 3
  }'
```

#### 示例：按颜色和缺陷关键词检索

```bash
curl -X POST http://localhost:3033/tiles/similar \
  -H "Content-Type: application/json" \
  -d '{
    "colorKeywords": ["青灰", "油滴"],
    "defectKeywords": "流釉 针孔",
    "ashSource": "南山松灰",
    "topN": 5
  }'
```

#### 示例：多条件综合检索（带最低阈值过滤）

```bash
curl -X POST http://localhost:3033/tiles/similar \
  -H "Content-Type: application/json" \
  -d '{
    "body": "细瓷坯",
    "ashSource": "东北稻灰",
    "peakTemp": 1260,
    "recipe": "稻灰40 长石40 石英18",
    "colorKeywords": "月白",
    "score": 85,
    "minScore": 40
  }'
```

#### 示例：只按坯体检索最接近的试片

```bash
curl -X POST http://localhost:3033/tiles/similar \
  -H "Content-Type: application/json" \
  -d '{
    "body": "粗陶坯",
    "topN": 10
  }'
```

### 返回字段说明

```jsonc
{
  "query": {                          // 实际参与计算的查询条件
    "body": "粗陶坯",
    "peakTemp": 1240,
    "recipe": "松灰42 长石35 石英18 红土5"
  },
  "totalCandidates": 13,              // 数据库中候选试片总数
  "resultCount": 3,                   // 本次返回的结果数
  "weights": {                        // 当前使用的权重配置
    "body": 20,
    "ashSource": 20,
    "peakTemp": 25,
    "recipe": 20,
    "colorKeywords": 7,
    "defectKeywords": 5,
    "score": 3
  },
  "results": [
    {
      "tile": { /* 完整试片数据，同 GET /tiles/:id */ },
      "similarityScore": 100,         // 综合相似度 0-100
      "reasons": [                    // 人类可读的匹配原因列表
        "坯体完全匹配: \"粗陶坯\"",
        "峰值温度完全一致: 查询1240℃ vs 历史1240℃，温差0℃",
        "配方原料重合: 共有[松灰、长石、石英、红土]，重合度100% (查询4种 vs 历史4种)"
      ],
      "fieldMatches": {               // 各字段命中详情（便于程序化判断）
        "body": true,                 // boolean，坯体是否匹配
        "ashSource": false,           // boolean，香灰来源是否匹配
        "peakTemp": 0,                // number | null，温差（℃），null 表示未查询
        "recipe": ["松灰","长石","石英","红土"],  // string[]，重合的原料名称
        "colorKeywords": [],          // string[]，命中的颜色关键词
        "defectKeywords": [],         // string[]，命中的缺陷关键词
        "score": null                 // number | null，评分差，null 表示未查询
      },
      "details": {                    // 各维度细项得分（便于前端绘制雷达图等可视化）
        "bodyScore": 100,             // 坯体匹配得分 0-100
        "ashSourceScore": 0,          // 香灰来源匹配得分 0-100
        "peakTempScore": 100,         // 峰值温度得分 0-100
        "peakTempDiff": 0,            // 峰值温差（℃），null 表示未查询
        "recipeScore": 100,           // 配方重合度得分 0-100
        "recipeOverlapRatio": 1.0,    // 配方原料重合比例 0-1
        "colorKeywordsScore": 0,      // 颜色关键词匹配得分 0-100
        "defectKeywordsScore": 0,     // 缺陷关键词匹配得分 0-100
        "scoreDiff": null,            // 评分差，null 表示未查询
        "scoreDiffScore": 0           // 评分差维度得分 0-100
      }
    }
  ]
}
```

### `fieldMatches` 字段类型说明

| 字段 | 类型 | 说明 |
|------|------|------|
| `body` | boolean | 坯体是否匹配（完全匹配或互相包含） |
| `ashSource` | boolean | 香灰来源是否匹配（完全匹配或词有交集） |
| `peakTemp` | number / null | 温差绝对值（℃），仅查询了 peakTemp 时有值，否则 null |
| `recipe` | string[] | 命中的共同原料名称列表 |
| `colorKeywords` | string[] | 在试片颜色中命中的关键词列表 |
| `defectKeywords` | string[] | 在试片缺陷中命中的关键词列表 |
| `score` | number / null | 评分差的绝对值，仅查询了 score 时有值，否则 null |

### `details` 字段类型说明

| 字段 | 类型 | 范围 | 说明 |
|------|------|------|------|
| `bodyScore` | number | 0-100 | 坯体维度得分 |
| `ashSourceScore` | number | 0-100 | 香灰来源维度得分 |
| `peakTempScore` | number | 0-100 | 峰值温度维度得分 |
| `peakTempDiff` | number / null | - | 峰值温差（℃），未查询时为 null |
| `recipeScore` | number | 0-100 | 配方重合度得分 |
| `recipeOverlapRatio` | number | 0-1 | 配方原料重合比例 |
| `colorKeywordsScore` | number | 0-100 | 颜色关键词维度得分 |
| `defectKeywordsScore` | number | 0-100 | 缺陷关键词维度得分 |
| `scoreDiff` | number / null | - | 评分差绝对值，未查询时为 null |
| `scoreDiffScore` | number | 0-100 | 评分差维度得分 |

### 结果解释示例

假设查询条件为 `{ body: "粗陶坯", peakTemp: 1240, colorKeywords: "青灰 油滴" }`：

| reasons 文本 | 解释 |
|-------------|------|
| `坯体完全匹配: "粗陶坯"` | 坯体字段完全一致 |
| `峰值温度非常接近: 查询1240℃ vs 历史1245℃，温差5℃` | 温差在 20℃ 以内，属于"非常接近"区间 |
| `颜色关键词命中[青灰]，覆盖率50%` | 提供了 2 个关键词，命中 1 个 |

峰值温度的描述级别对应关系：

| 温差 | 描述级别 |
|------|----------|
| 0℃ | 完全一致 |
| 1 ~ 20℃ | 非常接近 |
| 21 ~ 50℃ | 接近 |
| > 50℃ | 差异较大 |

---

## 仪表盘对比分析模块

### 模块概述

对比分析接口支持按 **灰源(ashSource)、窑炉(kiln)、温度区间(tempRange)** 三个维度任选两个 scope 进行横向对比，输出：
- 试片数量、已评分数、未评分数
- 平均分与评分分布（excellent/good/pass/low/unscored）
- 缺陷率、缺陷总数、每片平均缺陷数
- 高频缺陷 Top5 及其 baseline/target/delta/deltaPct
- 严重度分布（轻微/中等/严重）差异
- 低分样砖（低于阈值）的交集、仅 baseline、仅 target

返回结构严格按照 **baseline、target、delta** 三层组织，可直接用于柱状图、条形图、热力图等可视化渲染。

### 1. 对比分析接口

`GET /dashboard/compare`

#### 查询参数

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `baselineType` | string | ✅ | baseline 维度：`ashSource` / `kiln` / `tempRange` |
| `baselineValue` | string | ✅ | baseline 值（如 `"南山松灰"`、`"K-1"`、`"1200-1220°C"`） |
| `targetType` | string | ✅ | target 维度：`ashSource` / `kiln` / `tempRange` |
| `targetValue` | string | ✅ | target 值 |
| `lowScoreThreshold` | number | - | 低分样砖阈值，默认 `75`，范围 `0-100` |

> baseline 和 target 的 type **可以不同**（例如 cross-type：灰源 vs 窑炉）。

#### 示例 A：对比两种灰源（南山松灰 vs 东北稻灰）

```bash
curl "http://localhost:3033/dashboard/compare?baselineType=ashSource&baselineValue=%E5%8D%97%E5%B1%B1%E6%9D%BE%E7%81%B0&targetType=ashSource&targetValue=%E4%B8%9C%E5%8C%97%E7%A8%BB%E7%81%B0"
```

#### 示例 B：对比两个窑炉（K-1 vs K-2）

```bash
curl "http://localhost:3033/dashboard/compare?baselineType=kiln&baselineValue=K-1&targetType=kiln&targetValue=K-2"
```

#### 示例 C：对比两个温度区间（1200-1220°C vs 1240-1260°C）

温度区间取值需与 `getPeakTempRanges()` 完全一致：
- `< 1200°C`
- `1200-1220°C`
- `1220-1240°C`
- `1240-1260°C`
- `1260-1280°C`
- `≥ 1280°C`

```bash
curl "http://localhost:3033/dashboard/compare?baselineType=tempRange&baselineValue=1200-1220%C2%B0C&targetType=tempRange&targetValue=1240-1260%C2%B0C"
```

#### 示例 D：跨维度对比 + 自定义低分阈值

```bash
curl "http://localhost:3033/dashboard/compare?baselineType=ashSource&baselineValue=%E5%8D%97%E5%B1%B1%E6%9D%BE%E7%81%B0&targetType=kiln&targetValue=K-3&lowScoreThreshold=60"
```

#### 返回结构（节选）

```jsonc
{
  "generatedAt": "2026-06-21T00:00:00.000Z",
  "scope": {
    "baseline": { "type": "ashSource", "value": "南山松灰", "tileCount": 3 },
    "target":   { "type": "ashSource", "value": "东北稻灰", "tileCount": 3 },
    "lowScoreThreshold": 75
  },

  "baseline": {
    "tileCount": 3,
    "scoredCount": 3,
    "unscoredCount": 0,
    "averageScore": 71.7,
    "scoreDistribution": { "excellent": 0, "good": 2, "pass": 0, "low": 1, "unscored": 0 },
    "tilesWithDefects": 3,
    "defectRate": 100.0,
    "totalDefectCount": 6,
    "averageDefectsPerTile": 2.0,
    "topDefects": [ { "name": "针孔", "count": 3 }, ... ],
    "severityCounts": [ { "key": "severe", "label": "严重", "count": 2 }, ... ],
    "lowScoreTileCount": 1,
    "lowScoreTiles": [ { "id": "AG-003", "score": 55, "defectCount": 2, "hasSevere": true, ... } ]
  },

  "target": { /* 与 baseline 同结构 */ },

  "delta": {
    "tileCount": { "baseline": 3, "target": 3, "delta": 0 },
    "scoredCount": { "baseline": 3, "target": 3, "delta": 0 },
    "averageScore": {
      "baseline": 71.7, "target": 82.7,
      "delta": 11.0,         // 绝对差值
      "deltaPct": 15.3       // 相对变化百分比（baseline 为 null/0 时为 null）
    },
    "defectRate": {
      "baseline": 100.0, "target": 66.7,
      "delta": -33.3, "deltaPct": -33.3
    },
    "tilesWithDefects": { "baseline": 3, "target": 2, "delta": -1 },
    "totalDefectCount":  { "baseline": 6, "target": 3, "delta": -3 },
    "lowScoreTileCount": { "baseline": 1, "target": 0, "delta": -1 },

    "severityDelta": [
      { "key": "severe", "label": "严重", "baseline": 2, "target": 0, "delta": -2 }
    ],

    "topDefectsDelta": [
      {
        "name": "针孔",
        "baseline": 3, "target": 1,
        "delta": -2,
        "deltaPct": -66.7     // baseline=0 时为 null
      }
    ],

    "lowScoreTilesDiff": {
      "commonCount": 0,
      "onlyInBaselineCount": 1,
      "onlyInTargetCount": 0,
      "common": [],
      "onlyInBaseline": [ { "id": "AG-003", "score": 55, ... } ],
      "onlyInTarget": []
    },

    "scoreDistribution": {
      "baseline": { "excellent": 0, "good": 2, "pass": 0, "low": 1, "unscored": 0 },
      "target":   { "excellent": 2, "good": 1, "pass": 0, "low": 0, "unscored": 0 }
    }
  }
}
```

#### 前端图表绑定建议

| 图表类型 | 推荐绑定字段 |
|---------|-------------|
| 双柱对比图（核心指标） | `delta.tileCount`、`delta.scoredCount`、`delta.averageScore.delta`、`delta.defectRate.delta` |
| 评分分布堆叠柱 | `delta.scoreDistribution.baseline` vs `.target` |
| 高频缺陷双向条形图 | `delta.topDefectsDelta[].baseline` / `.target` / `.delta` |
| 严重度差异雷达图 | `delta.severityDelta[].delta` |
| 低分样砖交集 Venn | `lowScoreTilesDiff.commonCount` / `onlyInBaselineCount` / `onlyInTargetCount` |

#### 空数据 / 单边无评分 / 缺陷标签缺失 的处理

- **空数据（两边都无匹配试片）**：`baseline.tileCount=0`、`target.tileCount=0`、`averageScore=null`、`topDefects=[]`、`topDefectsDelta=[]`，所有 `delta` 为 `0` 或 `null`（不会抛错）。
- **单边无评分**：无评分一侧的 `averageScore=null`、`scoredCount=0`、`scoreDistribution.unscored=N`；`delta.averageScore.deltaPct=null`（避免除零），但 `delta` 仍会按 0 兜底计算绝对值。
- **缺陷标签缺失（`defectTags=null`/`undefined`/空数组/只有 `defects` 文本）**：统一复用 `collectAllTileDefects()` 的行为 — 只认结构化 `defectTags[]`，不认纯文本 `defects`。缺失侧的 `tilesWithDefects=0`、`totalDefectCount=0`、`topDefects=[]`，delta 仍可正确计算差值与百分比（baseline=0 时 `deltaPct=null`）。

### 2. 参数校验与错误码

| HTTP | error 字段 | 触发条件 |
|------|-----------|---------|
| 400 | `missing_required` | 缺少 `baselineType` / `baselineValue` / `targetType` / `targetValue`，返回 `required` 数组说明 |
| 400 | `invalid_baseline_type` | `baselineType` 不是三种合法值之一 |
| 400 | `invalid_target_type` | `targetType` 不是三种合法值之一 |

---

## 测试命令

| 命令 | 说明 |
|------|------|
| `npm run test:compare` | 仅运行仪表盘对比分析测试（10 组用例，覆盖空数据/单边无评分/缺陷标签缺失/跨维度/路由等场景） |
| `npm run test:recipe-diff` | 仅运行配方版本差异对比测试（覆盖缺失版本/跨配方/无试片数据/成分变化/缺陷变化等场景） |
| `npm run test:all` | 运行全部回归测试（迁移 + 状态机 + 导入 + 批次 + 对比 + 配方差异） |
