import { spawn } from "node:child_process";
import { join, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { rm } from "node:fs/promises";

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = dirname(__dirname);
const testsDir = __dirname;
const testsTmpRoot = join(projectRoot, "tests", "tmp");

const MODULE_GROUPS = {
  migration: {
    label: "数据迁移模块",
    files: ["migration.test.js"],
  },
  status: {
    label: "试片状态工作流",
    files: ["tile-status-workflow.test.js"],
  },
  import: {
    label: "批量导入模块",
    files: ["import-enhanced.test.js"],
  },
  batch: {
    label: "烧成规划与批次",
    files: ["firing-plan-batch-apply.test.js"],
  },
  dashboard: {
    label: "仪表盘与对比分析",
    files: ["dashboard-compare.test.js"],
  },
  recipe: {
    label: "配方版本管理",
    files: ["recipe-version-diff.test.js"],
  },
  inventory: {
    label: "原料库存与预留",
    files: ["inventory-reservation.test.js", "inventory-reservation-regression.test.js"],
  },
  event: {
    label: "事件审计与时间线",
    files: ["event-audit.test.js"],
  },
  review: {
    label: "实验复盘模块",
    files: ["experiment-review.test.js"],
  },
};

const ALL_MODULES = Object.keys(MODULE_GROUPS);

function parseArgs(argv) {
  const args = argv.slice(2);
  const opts = {
    modules: [],
    list: false,
    clean: false,
    keepOnFail: false,
    ci: false,
    help: false,
    verbose: false,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    switch (arg) {
      case "--all":
        opts.modules = [...ALL_MODULES];
        break;
      case "--module":
      case "-m":
        if (i + 1 < args.length) {
          const mod = args[++i];
          if (MODULE_GROUPS[mod]) {
            opts.modules.push(mod);
          } else {
            console.error(`未知模块: ${mod}。可用模块: ${ALL_MODULES.join(", ")}`);
            process.exit(2);
          }
        }
        break;
      case "--list":
      case "-l":
        opts.list = true;
        break;
      case "--clean":
      case "-c":
        opts.clean = true;
        break;
      case "--keep-on-fail":
        opts.keepOnFail = true;
        break;
      case "--ci":
        opts.ci = true;
        break;
      case "--verbose":
      case "-v":
        opts.verbose = true;
        break;
      case "--help":
      case "-h":
        opts.help = true;
        break;
      default:
        if (!arg.startsWith("-")) {
          if (MODULE_GROUPS[arg]) {
            opts.modules.push(arg);
          } else {
            console.error(`未知参数: ${arg}`);
            printUsage();
            process.exit(2);
          }
        }
    }
  }

  if (process.env.CI === "true" || process.env.GITHUB_ACTIONS === "true") {
    opts.ci = true;
  }

  if (opts.modules.length === 0 && !opts.list && !opts.clean && !opts.help) {
    opts.modules = [...ALL_MODULES];
  }

  return opts;
}

function printUsage() {
  console.log(`
香灰釉实验室 API - 测试运行器

用法:
  node tests/runner.js [选项] [模块名...]

选项:
  --all,              运行全部模块
  -m, --module <name> 运行指定模块（可多次指定）
  -l, --list          列出所有可用模块
  -c, --clean         仅清理临时数据目录后退出
  --keep-on-fail      测试失败时保留临时数据（便于调试）
  --ci                CI 模式：输出更简洁，失败立即退出
  -v, --verbose       显示子进程完整输出
  -h, --help          显示此帮助

可用模块:
${ALL_MODULES.map(m => `  ${m.padEnd(12)} ${MODULE_GROUPS[m].label}`).join("\n")}

示例:
  node tests/runner.js --all                     # 运行全部测试
  node tests/runner.js migration inventory       # 运行迁移和库存模块
  node tests/runner.js -m event -v               # 运行事件审计，显示详细输出
  node tests/runner.js --clean                   # 清理临时目录
`);
}

function listModules() {
  console.log("\n可用测试模块:\n");
  for (const mod of ALL_MODULES) {
    const group = MODULE_GROUPS[mod];
    console.log(`  ${mod.padEnd(12)} ${group.label}`);
    for (const f of group.files) {
      console.log(`               ↳ ${f}`);
    }
  }
  console.log();
}

function runTestFile(filePath) {
  return new Promise((resolve, reject) => {
    const child = spawn("node", [filePath], {
      cwd: projectRoot,
      env: { ...process.env },
      stdio: "pipe",
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (data) => {
      const str = data.toString();
      stdout += str;
      process.stdout.write(str);
    });

    child.stderr.on("data", (data) => {
      const str = data.toString();
      stderr += str;
      process.stderr.write(str);
    });

    child.on("close", (code) => {
      resolve({
        code,
        stdout,
        stderr,
        file: basename(filePath),
      });
    });

    child.on("error", (err) => {
      reject(err);
    });
  });
}

function expandModules(modules) {
  const files = [];
  const seen = new Set();
  for (const mod of modules) {
    const group = MODULE_GROUPS[mod];
    if (!group) continue;
    for (const f of group.files) {
      if (!seen.has(f)) {
        seen.add(f);
        files.push({
          module: mod,
          moduleLabel: group.label,
          file: f,
          path: join(testsDir, f),
        });
      }
    }
  }
  return files;
}

async function cleanTmpDirs() {
  console.log(`\n🧹 清理临时测试数据目录: ${testsTmpRoot}`);
  try {
    await rm(testsTmpRoot, { recursive: true, force: true });
    console.log("✅ 清理完成\n");
  } catch (err) {
    console.warn(`⚠️  清理时出错（忽略）: ${err.message}\n`);
  }
}

async function runAll(opts) {
  const testFiles = expandModules(opts.modules);

  if (testFiles.length === 0) {
    console.error("没有可执行的测试文件");
    process.exit(1);
  }

  console.log(`\n${"=".repeat(60)}`);
  console.log(`🧪 开始运行测试`);
  console.log(`   模块: ${opts.modules.join(", ")}`);
  console.log(`   测试文件数: ${testFiles.length}`);
  console.log(`   模式: ${opts.ci ? "CI" : "本地"}`);
  console.log(`${"=".repeat(60)}\n`);

  const totalStart = Date.now();
  const results = [];
  let anyFailed = false;

  for (const item of testFiles) {
    const label = `${item.moduleLabel} / ${item.file}`;
    console.log(`\n${"─".repeat(60)}`);
    console.log(`▶  开始: ${label}`);
    console.log(`${"─".repeat(60)}`);

    const start = Date.now();
    try {
      const r = await runTestFile(item.path);
      const elapsed = ((Date.now() - start) / 1000).toFixed(2);
      const passed = r.code === 0;
      results.push({ ...item, ...r, passed, elapsed });

      if (passed) {
        console.log(`✅ ${label} 通过 (${elapsed}s)`);
      } else {
        anyFailed = true;
        console.log(`❌ ${label} 失败 (退出码 ${r.code}, ${elapsed}s)`);
        if (opts.ci) {
          console.log(`\n⚠️  CI 模式下立即退出，跳过剩余测试`);
          break;
        }
      }
    } catch (err) {
      anyFailed = true;
      const elapsed = ((Date.now() - start) / 1000).toFixed(2);
      results.push({ ...item, passed: false, error: err.message, elapsed });
      console.log(`💥 ${label} 崩溃: ${err.message} (${elapsed}s)`);
      if (opts.ci) break;
    }
  }

  const totalElapsed = ((Date.now() - totalStart) / 1000).toFixed(2);

  console.log(`\n${"=".repeat(60)}`);
  console.log(`📊 测试汇总 (总耗时 ${totalElapsed}s)`);
  console.log(`${"=".repeat(60)}`);

  let passedCount = 0;
  let failedCount = 0;

  for (const r of results) {
    const status = r.passed ? "✅" : r.error ? "💥" : "❌";
    const line = `${status} ${r.module.padEnd(10)} ${r.file.padEnd(42)} ${r.elapsed.padStart(6)}s`;
    console.log(line);
    if (r.passed) passedCount++;
    else failedCount++;
  }

  console.log(`\n   通过: ${passedCount}  失败: ${failedCount}  总计: ${results.length}`);
  console.log(`${"=".repeat(60)}\n`);

  if (anyFailed) {
    if (!opts.keepOnFail) {
      await cleanTmpDirs();
    } else {
      console.log(`📁 保留临时数据目录以便调试: ${testsTmpRoot}\n`);
    }
    process.exit(1);
  } else {
    await cleanTmpDirs();
    console.log(`🎉 全部测试通过！\n`);
    process.exit(0);
  }
}

async function main() {
  const opts = parseArgs(process.argv);

  if (opts.help) {
    printUsage();
    return;
  }

  if (opts.list) {
    listModules();
    return;
  }

  if (opts.clean) {
    await cleanTmpDirs();
    return;
  }

  await runAll(opts);
}

main().catch((err) => {
  console.error(`\n💥 测试运行器崩溃: ${err.message}`);
  console.error(err.stack);
  cleanTmpDirs().finally(() => process.exit(1));
});
