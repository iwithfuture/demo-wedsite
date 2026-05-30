import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const DEFAULT_SOURCE =
  "https://app.envato.com/search?itemType=wordpress&filter.categories=Template+Kits";

const sourceUrl = process.argv[2] || DEFAULT_SOURCE;
const publicListUrl = normalizeSourceUrl(sourceUrl);
const requestedMaxPages = Number.parseInt(process.argv[3] || "", 10);
const shouldEnrichDemo = process.env.ENRICH_DEMO === "1";
const outputPath = path.resolve("data", "templates.json");

const expectedCategories = [
  { id: "machinery", name: "机械设备外贸网站", keywords: ["factory", "industrial", "industry", "manufacturing", "machinery", "construction", "electric", "plumbing", "roofing"] },
  { id: "parts", name: "工业零部件网站", keywords: ["parts", "hardware", "tools", "repair", "mechanic", "gadget"] },
  { id: "building", name: "家居建材出海网站", keywords: ["interior", "architecture", "furniture", "building", "home", "landscaping", "garden"] },
  { id: "electronics", name: "电子电器外贸网站", keywords: ["electronics", "electric", "tech", "software", "cyber", "hosting", "app"] },
  { id: "beauty", name: "美妆个护品牌出海", keywords: ["beauty", "barber", "hair", "spa", "salon", "fashion"] },
  { id: "medical", name: "医疗器械外贸网站", keywords: ["medical", "clinic", "dentist", "health", "pharma", "laboratory", "science"] },
  { id: "energy", name: "新能源产品出海", keywords: ["energy", "solar", "electric vehicle", "eco", "green"] },
  { id: "ecommerce", name: "跨境电商独立站", keywords: ["ecommerce", "shop", "store", "woocommerce", "jewellery", "supermarket"] },
];

const extraCategoryRules = [
  { id: "education", name: "教育培训网站", keywords: ["education", "school", "university", "course", "kids", "learning"] },
  { id: "finance", name: "金融科技网站", keywords: ["finance", "fintech", "payment", "wallet", "investment", "crypto"] },
  { id: "events", name: "活动会议网站", keywords: ["event", "conference", "wedding"] },
  { id: "food", name: "餐饮食品网站", keywords: ["restaurant", "catering", "bakery", "food", "nutrition"] },
  { id: "automotive", name: "汽车交通网站", keywords: ["automotive", "car", "rental", "movers", "shipping", "logistic"] },
  { id: "creative", name: "创意服务网站", keywords: ["agency", "creative", "portfolio", "artist", "design", "nft", "video", "film"] },
  { id: "services", name: "本地服务网站", keywords: ["cleaning", "plumbing", "roofing", "repair", "landscaping"] },
  { id: "business", name: "企业服务网站", keywords: ["business", "consulting", "marketing", "seo", "coach"] },
];

function normalizeSourceUrl(url) {
  const parsed = new URL(url);
  if (parsed.hostname === "app.envato.com") {
    const itemType = parsed.searchParams.get("itemType");
    const category = parsed.searchParams.get("filter.categories");
    if (itemType === "wordpress" && category?.toLowerCase() === "template kits") {
      return "https://elements.envato.com/wordpress/template-kits";
    }
  }
  return url;
}

function decodeHtml(value) {
  return value
    .replaceAll("&amp;", "&")
    .replaceAll("&quot;", '"')
    .replaceAll("&#x27;", "'")
    .replaceAll("&#39;", "'")
    .replaceAll("&ndash;", "–")
    .replaceAll("&mdash;", "—");
}

function plainText(value) {
  return decodeHtml(value.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
}

function pickCategory(title) {
  const text = title.toLowerCase();
  const rules = [...expectedCategories, ...extraCategoryRules];
  const match = rules.find((rule) => rule.keywords.some((keyword) => text.includes(keyword)));
  return match || { id: "other", name: "其他行业模板" };
}

function itemIdFromHref(href) {
  const match = href.match(/-([A-Z0-9]{6,})$/);
  return match?.[1] || href.split("-").pop();
}

function firstImageFromSrcset(srcset, fallback) {
  const value = fallback || srcset.split(",")[0]?.trim().split(/\s+/)[0] || "";
  return decodeHtml(value);
}

async function fetchText(url) {
  const response = await fetch(url, {
    headers: {
      "user-agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125 Safari/537.36",
      accept: "text/html,application/xhtml+xml",
    },
  });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}: ${url}`);
  return response.text();
}

function parseListPage(html) {
  const cards = [];
  const cardRegex =
    /data-item-uuid="([^"]+)"[\s\S]*?<a title="([^"]+)" data-testid="item-link" href="([^"]+)"[^>]*>[\s\S]*?<img[^>]+(?:srcSet|srcset)="([^"]+)"[^>]+src="([^"]+)"[\s\S]*?<a class="[^"]*" data-testid="title-link" href="([^"]+)"[^>]*>[\s\S]*?<div[^>]*>([\s\S]*?)<\/div>[\s\S]*?<a class="[^"]*" rel="nofollow" href="\/user\/[^"]+"[^>]*>[\s\S]*?<div[^>]*>([\s\S]*?)<\/div>/g;

  for (const match of html.matchAll(cardRegex)) {
    const itemUuid = match[1];
    const href = decodeHtml(match[3]);
    const title = plainText(match[7] || match[2]);
    const author = plainText(match[8]);
    const itemId = itemIdFromHref(href);
    const category = pickCategory(title);

    if (cards.some((card) => card.itemId === itemId)) continue;

    cards.push({
      itemId,
      itemUuid,
      title,
      author,
      category: category.id,
      categoryName: category.name,
      image: firstImageFromSrcset(match[4], match[5]),
      envatoUrl: `https://elements.envato.com${href}`,
      appUrl: `https://app.envato.com/wordpress/${itemUuid}`,
      demoUrl: `https://elements.envato.com${href}`,
      tags: inferTags(title),
      suitableFor: category.name,
      modules: inferModules(title, category.id),
      description: `${title}，适合用于${category.name}的 WordPress Template Kit。`,
    });
  }

  return cards;
}

function pageNumber(url) {
  const match = url.match(/\/pg-(\d+)/);
  return match ? Number(match[1]) : 1;
}

function pageUrl(baseUrl, page) {
  if (page === 1) return baseUrl;
  return new URL(`/wordpress/template-kits/pg-${page}`, baseUrl).toString();
}

function inferTags(title) {
  const text = title.toLowerCase();
  const tags = ["Template Kit"];
  if (text.includes("elementor pro")) tags.push("Elementor Pro");
  else if (text.includes("elementor")) tags.push("Elementor");
  if (text.includes("woocommerce") || text.includes("ecommerce") || text.includes("shop")) tags.push("WooCommerce");
  return tags;
}

function inferModules(title, categoryId) {
  const base = ["首页", "关于我们", "服务介绍", "联系表单"];
  const byCategory = {
    machinery: ["产品展示", "工厂实力", "项目案例", "询盘入口"],
    ecommerce: ["商品列表", "促销区块", "购物流程", "品牌介绍"],
    medical: ["产品分类", "资质证书", "应用场景", "预约咨询"],
    education: ["课程介绍", "师资团队", "报名入口", "学员评价"],
    finance: ["方案介绍", "数据展示", "安全说明", "咨询入口"],
    creative: ["作品集", "服务流程", "团队介绍", "联系入口"],
  };
  return byCategory[categoryId] || base;
}

async function enrichDemoUrl(template) {
  try {
    const html = await fetchText(template.envatoUrl);
    const patterns = [
      /href="([^"]+)"[^>]*>\s*Live preview/i,
      /href="([^"]+)"[^>]*aria-label="Live preview"/i,
      /"livePreviewUrl":"([^"]+)"/i,
    ];
    for (const pattern of patterns) {
      const match = html.match(pattern);
      if (match?.[1]) {
        template.demoUrl = decodeHtml(match[1]);
        break;
      }
    }
  } catch {
    template.demoUrl = template.envatoUrl;
  }
  return template;
}

function buildCategories(templates) {
  const known = [...expectedCategories, ...extraCategoryRules, { id: "other", name: "其他行业模板" }];
  return known
    .map(({ id, name }) => ({
      id,
      name,
      count: templates.filter((template) => template.category === id).length,
    }))
    .filter((category) => category.count > 0 || expectedCategories.some((item) => item.id === category.id));
}

const firstPageHtml = await fetchText(publicListUrl);
const parsedById = new Map();
const pageUrls = [];
const maxPages = Number.isFinite(requestedMaxPages) && requestedMaxPages > 0 ? requestedMaxPages : 80;
let emptyStreak = 0;

for (let page = 1; page <= maxPages; page += 1) {
  const currentPageUrl = pageUrl(publicListUrl, page);
  let html;
  try {
    html = page === 1 ? firstPageHtml : await fetchText(currentPageUrl);
  } catch {
    break;
  }

  const before = parsedById.size;
  const pageItems = parseListPage(html);
  for (const item of pageItems) {
    if (!parsedById.has(item.itemId)) parsedById.set(item.itemId, item);
  }
  const added = parsedById.size - before;

  if (pageItems.length > 0) pageUrls.push(currentPageUrl);
  if (pageItems.length === 0 || added === 0) {
    emptyStreak += 1;
  } else {
    emptyStreak = 0;
  }

  console.log(`Page ${page}: ${pageItems.length} items, ${added} new`);
  if (emptyStreak >= 2) break;
}

const parsed = [...parsedById.values()];
const templates = [];

if (shouldEnrichDemo) {
  for (const item of parsed) {
    templates.push(await enrichDemoUrl(item));
  }
} else {
  templates.push(...parsed);
}

const payload = {
  sourceUrl,
  publicListUrl,
  pagesImported: pageUrls,
  importedAt: new Date().toISOString(),
  categories: buildCategories(templates),
  templates,
};

await mkdir(path.dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");

console.log(`Imported ${templates.length} templates`);
console.log(`Pages: ${pageUrls.length}`);
console.log(`Demo enrichment: ${shouldEnrichDemo ? "on" : "off"}`);
console.log(`Source: ${sourceUrl}`);
console.log(`Public list: ${publicListUrl}`);
console.log(`Output: ${outputPath}`);
