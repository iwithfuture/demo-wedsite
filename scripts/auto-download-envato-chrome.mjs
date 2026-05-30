import { copyFile, mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

const workspace = process.cwd();
const dataPath = path.join(workspace, "data", "templates.json");
const runLogPath = path.join(workspace, "data", "download-run-latest.json");
const archiveRoot = path.join(workspace, "downloads");
const profileDir = path.join(workspace, ".envato-chrome-profile");
const chromePath = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";

const options = parseArgs(process.argv.slice(2));

const require = createRequire(
  "C:\\Users\\dn\\.cache\\codex-runtimes\\codex-primary-runtime\\dependencies\\node\\node_modules\\.pnpm\\playwright@1.60.0\\node_modules\\playwright\\index.js",
);
const { chromium } = require("playwright");
const data = JSON.parse(await readFile(dataPath, "utf8"));
const queue = selectQueue(data.templates, options);
const results = [];
const runLog = {
  startedAt: new Date().toISOString(),
  options: {
    itemId: options.itemId,
    category: options.category,
    limit: options.limit,
    skip: [...options.skip],
  },
  queue: queue.map((template) => ({ itemId: template.itemId, title: template.title })),
  results,
};
await writeRunLog(runLog);

const context = await chromium.launchPersistentContext(profileDir, {
  acceptDownloads: true,
  channel: undefined,
  executablePath: chromePath,
  headless: false,
  viewport: { width: 1280, height: 900 },
});

try {
  const page = context.pages()[0] || (await context.newPage());
  for (const template of queue) {
    console.log(`Starting ${template.itemId} ${template.title}`);
    const result = await withTimeout(downloadOne(page, template, data), 180000, {
      itemId: template.itemId,
      title: template.title,
      status: "item-timeout",
      message: "Timed out after 180000ms",
    });
    results.push(result);
    console.log(JSON.stringify(result));
    await writeFile(dataPath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
    await writeRunLog(runLog);
  }
} finally {
  runLog.finishedAt = new Date().toISOString();
  await writeRunLog(runLog);
  await context.close();
}

console.log(JSON.stringify({ profileDir, results }, null, 2));

function parseArgs(args) {
  const options = { itemId: null, category: null, limit: 1, skip: new Set() };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--limit") {
      options.limit = Number(args[index + 1] || 1);
      index += 1;
    } else if (arg === "--category") {
      options.category = args[index + 1] || null;
      index += 1;
    } else if (arg === "--item") {
      options.itemId = args[index + 1] || null;
      index += 1;
    } else if (arg === "--skip") {
      const values = (args[index + 1] || "").split(",").map((value) => value.trim()).filter(Boolean);
      options.skip = new Set([...options.skip, ...values]);
      index += 1;
    } else if (!arg.startsWith("--") && !options.itemId) {
      options.itemId = arg;
    }
  }

  if (!Number.isFinite(options.limit) || options.limit < 1) options.limit = 1;
  return options;
}

function selectQueue(templates, { itemId, category, limit, skip }) {
  const items = templates.filter((template) => {
    if (skip?.has(template.itemId)) return false;
    if (itemId) return template.itemId === itemId;
    if (category && template.category !== category) return false;
    return !template.downloaded && template.appUrl;
  });
  return items.slice(0, limit);
}

async function downloadOne(page, template, data) {
  const targetUrl = template.appUrl || template.envatoUrl;
  await page.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: 60000 });

  const currentUrl = page.url();
  if (/login|sign[-_]?in|account\.envato\.com/i.test(currentUrl) || currentUrl.startsWith("https://elements.envato.com/")) {
    return { itemId: template.itemId, title: template.title, status: "needs-login", url: currentUrl };
  }

  const button = page.locator('[data-cy="idp-download-button"]');
  try {
    await button.waitFor({ state: "visible", timeout: 45000 });
  } catch {
    const url = page.url();
    return {
      itemId: template.itemId,
      title: template.title,
      status: url.startsWith("https://elements.envato.com/") ? "needs-login" : "download-button-not-found",
      url,
    };
  }

  let download;
  try {
    [download] = await Promise.all([
      page.waitForEvent("download", { timeout: 120000 }),
      button.click(),
    ]);
  } catch (error) {
    return {
      itemId: template.itemId,
      title: template.title,
      status: "download-not-triggered",
      url: page.url(),
      message: error.message,
    };
  }

  const suggested = download.suggestedFilename();
  const targetDir = path.join(archiveRoot, template.itemId);
  const targetPath = path.join(targetDir, suggested);
  await mkdir(targetDir, { recursive: true });

  const tempPath = await download.path();
  if (!tempPath) {
    await download.saveAs(targetPath);
  } else if (!existsSync(targetPath)) {
    await moveFile(tempPath, targetPath);
  }

  const record = data.templates.find((item) => item.itemId === template.itemId);
  if (record) {
    record.downloaded = true;
    record.downloadedAt = new Date().toISOString();
    record.localFile = targetPath;
    record.originalDownloadName = suggested;
  }

  return {
    itemId: template.itemId,
    title: template.title,
    status: "downloaded",
    file: targetPath,
  };
}

async function withTimeout(promise, timeoutMs, fallback) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((resolve) => {
        timer = setTimeout(() => resolve(fallback), timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

async function writeRunLog(runLog) {
  await writeFile(runLogPath, `${JSON.stringify(runLog, null, 2)}\n`, "utf8");
}

async function moveFile(source, target) {
  try {
    await rename(source, target);
  } catch (error) {
    if (error.code !== "EXDEV") throw error;
    await copyFile(source, target);
    await unlink(source);
  }
}
