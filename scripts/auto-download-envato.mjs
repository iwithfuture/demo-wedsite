import { copyFile, mkdir, readFile, readdir, rename, stat, unlink, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import os from "node:os";

const workspace = "D:\\code\\copy-website";
const dataPath = path.join(workspace, "data", "templates.json");
const downloadsDir = path.join(os.homedir(), "Downloads");
const archiveRoot = path.join(workspace, "downloads");

export async function autoDownloadEnvato({ tab, category = null, limit = 3, itemId = null, log = console.log }) {
  if (!tab) throw new Error("A browser tab is required.");

  const data = await readTemplateData();
  const queue = selectQueue(data.templates, { category, limit, itemId });
  const results = [];

  for (const template of queue) {
    log(`Opening ${template.title}`);
    const result = await downloadOne({ tab, template, data, log });
    results.push(result);
    await writeTemplateData(data);
  }

  return results;
}

function selectQueue(templates, { category, limit, itemId }) {
  const filtered = templates.filter((template) => {
    if (itemId) return template.itemId === itemId;
    if (category && template.category !== category) return false;
    return !template.downloaded && template.appUrl;
  });
  return filtered.slice(0, limit);
}

async function downloadOne({ tab, template, data, log }) {
  const before = await latestZipMtime();
  const targetUrl = template.envatoUrl || template.appUrl;
  await tab.goto(targetUrl);
  await tab.playwright.waitForLoadState({ state: "domcontentloaded", timeoutMs: 45000 });
  let detailReady = await waitForDownloadButton(tab, 20000);
  log(`Detail ready after first open: ${detailReady} (${await tab.url()})`);
  if (!detailReady) {
    await tab.goto(targetUrl);
    await tab.playwright.waitForLoadState({ state: "domcontentloaded", timeoutMs: 45000 });
    detailReady = await waitForDownloadButton(tab, 20000);
    log(`Detail ready after retry: ${detailReady} (${await tab.url()})`);
  }

  const title = await tab.title();
  if (/sign in/i.test(title || "")) {
    return { itemId: template.itemId, title: template.title, status: "needs-login" };
  }

  const clicked = await clickDownload(tab);
  if (!clicked) {
    return { itemId: template.itemId, title: template.title, status: "download-button-not-found" };
  }

  const file = await waitForNewZip(before, 120000);
  if (!file) {
    return { itemId: template.itemId, title: template.title, status: "no-new-zip-detected" };
  }

  const archived = await archiveZipForTemplate(file, template);
  const record = data.templates.find((item) => item.itemId === template.itemId);
  if (record) {
    record.downloaded = true;
    record.downloadedAt = new Date().toISOString();
    record.localFile = archived.targetPath;
    record.originalDownloadName = file.name;
  }

  log(`Archived ${template.title} -> ${archived.targetPath}`);
  return {
    itemId: template.itemId,
    title: template.title,
    status: "downloaded",
    file: archived.targetPath,
  };
}

async function readTemplateData() {
  return JSON.parse(await readFile(dataPath, "utf8"));
}

async function writeTemplateData(data) {
  await writeFile(dataPath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

async function clickDownload(tab) {
  const hasDownload = await tab.playwright.evaluate(() => Boolean(document.querySelector('[data-cy="idp-download-button"]')));
  if (!hasDownload) return false;

  const box = await tab.playwright.evaluate(() => {
    const button = document.querySelector('[data-cy="idp-download-button"]');
    button?.scrollIntoView({ block: "center", inline: "center" });
    const rect = button?.getBoundingClientRect();
    if (!rect) return null;
    return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
  });

  if (!box) return false;
  await tab.playwright.waitForTimeout(600);
  await tab.cua.click({ x: Math.round(box.x), y: Math.round(box.y) });
  return true;
}

async function waitForDownloadButton(tab, timeoutMs) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const exists = await tab.playwright.evaluate(() => Boolean(document.querySelector('[data-cy="idp-download-button"]')));
    if (exists) return true;
    await tab.playwright.waitForTimeout(1000);
  }
  return false;
}

async function latestZipMtime() {
  const files = await listZipFiles();
  return files.length > 0 ? files[0].mtimeMs : 0;
}

async function listZipFiles() {
  const entries = await readdir(downloadsDir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.toLowerCase().endsWith(".zip")) continue;
    const fullPath = path.join(downloadsDir, entry.name);
    const info = await stat(fullPath);
    files.push({ fullPath, name: entry.name, mtimeMs: info.mtimeMs, size: info.size });
  }
  return files.sort((a, b) => b.mtimeMs - a.mtimeMs);
}

async function waitForNewZip(afterMtime, timeoutMs) {
  const started = Date.now();
  let lastCandidate = null;

  while (Date.now() - started < timeoutMs) {
    const newest = (await listZipFiles()).find((file) => file.mtimeMs > afterMtime + 500);
    if (newest) {
      if (lastCandidate && lastCandidate.fullPath === newest.fullPath && lastCandidate.size === newest.size) {
        return newest;
      }
      lastCandidate = newest;
    }
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }

  return null;
}

async function archiveZipForTemplate(file, template) {
  const itemId = template.itemId || template.itemUuid || safeName(template.title);
  const targetDir = path.join(archiveRoot, itemId);
  const targetPath = path.join(targetDir, file.name);
  await mkdir(targetDir, { recursive: true });
  if (!existsSync(targetPath)) await moveFile(file.fullPath, targetPath);
  return { targetDir, targetPath };
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

function safeName(value) {
  return value
    .toLowerCase()
    .replace(/['"]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
