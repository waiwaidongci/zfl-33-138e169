# 香灰釉试片实验室API

运行：

```bash
npm start
```

默认端口`3033`。数据保存在`data/ash-glaze.json`。

## API 端点

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/` | 服务信息与端点列表 |
| GET | `/tiles?ashSource=&minTemp=` | 查询试片列表 |
| POST | `/tiles` | 新增单个试片 |
| GET | `/tiles/:id` | 查询单个试片 |
| POST | `/tiles/:id/observations` | 添加观察记录 |
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
| appliedTileId | string | 已应用时关联的试片 id |
