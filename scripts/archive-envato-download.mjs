import { copyFile, mkdir, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import os from "node:os";

const workspace = process.cwd();
const dataPath = path.join(workspace, "data", "templates.json");
const downloadsDir = path.join(os.homedir(), "Downloads");
const archiveRoot = path.join(workspace, "downloads");

const args = new Set(process.argv.slice(2));
const archiveAll = args.has("--all");
const dryRun = args.has("--dry-run");

function slugify(value) {
  return value
    .toLowerCase()
    .replace(/['"]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function normalizeZipName(name) {
  return name
    .replace(/\.zip$/i, "")
    .replace(/-\d{4}-\d{2}-\d{2}-\d{2}-\d{2}-\d{2}-utc$/i, "")
    .replace(/-templ$/i, "-template")
    .replace(/-temp$/i, "-template")
    .replace(/-ki$/i, "-kit");
}

function scoreMatch(fileSlug, template) {
  const titleSlug = slugify(template.title);
  const shortTitleSlug = titleSlug
    .replace(/-elementor(-pro)?-template-kit$/i, "")
    .replace(/-wordpress-template-kit$/i, "");

  if (fileSlug === titleSlug) return 100;
  if (fileSlug === shortTitleSlug) return 95;
  if (titleSlug.startsWith(fileSlug) || fileSlug.startsWith(shortTitleSlug)) return 80;
  if (titleSlug.includes(fileSlug) || fileSlug.includes(shortTitleSlug)) return 65;
  return 0;
}

async function loadTemplateData() {
  const data = JSON.parse(await readFile(dataPath, "utf8"));
  data.templates ||= [];
  return data;
}

async function findCandidateFiles() {
  const { readdir } = await import("node:fs/promises");
  const entries = await readdir(downloadsDir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.toLowerCase().endsWith(".zip")) continue;
    const fullPath = path.join(downloadsDir, entry.name);
    const info = await stat(fullPath);
    files.push({ fullPath, name: entry.name, mtimeMs: info.mtimeMs, size: info.size });
  }

  files.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return archiveAll ? files : files.slice(0, 1);
}

async function archiveFile(file, data) {
  const fileSlug = normalizeZipName(slugify(file.name));
  const ranked = data.templates
    .map((template) => ({ template, score: scoreMatch(fileSlug, template) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score);

  if (ranked.length === 0) {
    return {
      archived: false,
      reason: "no-template-match",
      file: file.fullPath,
      fileSlug,
    };
  }

  const match = ranked[0].template;
  const itemId = match.itemId || slugify(match.title);
  const targetDir = path.join(archiveRoot, itemId);
  const targetPath = path.join(targetDir, file.name);

  if (!dryRun) {
    await mkdir(targetDir, { recursive: true });
    if (!existsSync(targetPath)) {
      await moveFile(file.fullPath, targetPath);
    }
    match.downloaded = true;
    match.downloadedAt = new Date().toISOString();
    match.localFile = targetPath;
    match.originalDownloadName = file.name;
    await writeFile(dataPath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
  }

  return {
    archived: true,
    file: file.fullPath,
    targetPath,
    itemId,
    title: match.title,
    score: ranked[0].score,
  };
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

const data = await loadTemplateData();
const files = await findCandidateFiles();
const results = [];

for (const file of files) {
  results.push(await archiveFile(file, data));
}

console.log(JSON.stringify({ dryRun, archiveAll, downloadsDir, archiveRoot, results }, null, 2));
