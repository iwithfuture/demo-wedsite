# WordPress 外贸模板库 — AI 阅读文档

> 项目目的：搭建一个 WordPress 模板市场展示站，用于外贸建站业务——客户可按行业筛选、查看封面、打开官方 Demo，并把感兴趣的模板发给站长确认授权和建站方案。

## 项目概览

| 维度 | 说明 |
|------|------|
| **项目名称** | WordPress 外贸模板库 (WordPress Export Template Library) |
| **项目类型** | 纯静态前端展示站 + Node.js 数据采集/下载自动化脚本 |
| **运行环境** | Node.js (ES Modules .mjs)，Windows 11，PowerShell 5.1，Chrome 浏览器 |
| **启动命令** | `node .preview-server.cjs` → 监听 `http://127.0.0.1:5173` |
| **无框架依赖** | 前端为原生 HTML/CSS/JS，无任何构建步骤或框架 |
| **仓库状态** | 非 git 仓库，本地开发项目 |

---

## 目录结构

```
d:\code\copy-website\
├── index.html                          # 唯一前端页面（SPA）
├── .preview-server.cjs                 # 开发预览 HTTP 服务器 (Node.js)
├── data/
│   ├── templates.json                  # 核心数据：所有模板元数据 (~5MB+)
│   ├── download-loop-state.json        # 下载循环状态跟踪
│   ├── download-run-latest.json        # 最近一次下载运行的详细结果
│   ├── download-failed-queue.json      # 下载失败的 itemId 黑名单
│   └── download-loop.log              # 下载循环运行日志
├── scripts/
│   ├── import-envato-template-kits.mjs # 从 Envato 抓取模板列表并生成 templates.json
│   ├── auto-download-envato-chrome.mjs # Playwright + Chrome 自动化下载模板 zip
│   ├── auto-download-envato.mjs        # CUA(Claude Agent SDK) 版下载器（备用方案）
│   ├── archive-envato-download.mjs     # 将 ~/Downloads 中的 zip 归档到 downloads/ 并更新数据
│   └── run-envato-download-loop.ps1    # PowerShell 持续批量下载循环
├── downloads/                          # 已下载的模板 zip 文件 (833 个子目录)
│   └── {itemId}/                       # 每个模板一个子目录，含 .zip 文件
└── .envato-chrome-profile/             # Chrome 持久化 Profile（保持 Envato 登录态）
```

---

## 核心架构

### 数据流

```
Envato Elements 网站
       │
       ▼
[import-envato-template-kits.mjs]   ← 抓取 50 页模板列表
       │                               解析 HTML → 提取 title/author/image/category
       │                               关键词匹配 → 分配到行业类目
       ▼
data/templates.json                ← 所有模板元数据（~1000+ 条）
       │
       ├─── 前端消费 ──────────────
       │    index.html 加载 templates.json
       │    客户端筛选/搜索/排序
       │    展示模板卡片 + Demo 链接 + 下载链接
       │
       └─── 下载自动化 ────────────
            [run-envato-download-loop.ps1]
              │  循环调用
              ▼
            [auto-download-envato-chrome.mjs]
              │  Playwright + Chrome Profile
              │  逐个访问 app.envato.com → 点击下载按钮
              ▼
            downloads/{itemId}/*.zip
              │  更新 templates.json 中 downloaded/downloadedAt/localFile 字段
              ▼
            前端展示"已下载"状态 + 本地下载链接
```

### 前端架构 (`index.html`)

- **单一 HTML 文件**，内联 `<style>` (~600行) 和 `<script>` (~200行)
- **状态管理**：全局 `state` 对象 `{ category, query, tags: Set, sort, status }`
- **核心函数**：
  - `loadTemplateData()` — fetch `data/templates.json`
  - `matchesTemplate(template)` — 多条件筛选（类目/搜索词/组件标签/下载状态）
  - `renderCategories()` — 渲染侧边栏 + 顶部 chips
  - `renderTemplates()` — 渲染模板卡片网格
  - `getLocalDownloadUrl(template)` — 从 `localFile` 路径构造可访问的下载 URL
- **响应式断点**：1120px (2 列卡片)、820px (单列+隐藏 nav)、430px
- **路由**：通过 `location.hash` (如 `#machinery`) 持久化类目选择

---

## 关键数据模型

### 模板条目 (Template Item) — `templates.json` 中 `templates[]` 的元素

```typescript
interface Template {
  itemId: string;              // Envato 商品 ID，如 "LMGLUAR"，唯一标识
  itemUuid: string;            // Envato 内部 UUID
  title: string;               // 模板标题（英文）
  author: string;              // 作者用户名
  category: string;            // 分类 ID，如 "machinery", "electronics"
  categoryName: string;        // 分类中文名，如 "机械设备外贸网站"
  image: string;               // 封面图 URL (envatousercontent.com CDN)
  envatoUrl: string;           // Envato Elements 商品页 URL
  appUrl: string;              // Envato App 管理页 URL (app.envato.com)
  demoUrl: string;             // 官方 Demo 预览链接
  tags: string[];              // 标签，如 ["Template Kit", "Elementor", "WooCommerce"]
  suitableFor: string;         // 适合行业（中文）
  modules: string[];           // 页面模块，如 ["首页", "关于我们", "服务介绍", "联系表单"]
  description: string;         // 描述文本（中文）
  downloaded?: boolean;        // 是否已下载到本地
  downloadedAt?: string;       // ISO 8601 下载时间
  localFile?: string;          // 本地 zip 文件绝对路径
  originalDownloadName?: string; // 原始下载文件名
}
```

### 分类系统 (Categories)

分类通过关键词匹配自动分配。优先级顺序即 `expectedCategories` 数组顺序：

| ID | 名称 | 核心关键词 |
|----|------|-----------|
| `machinery` | 机械设备外贸网站 | factory, industrial, industry, manufacturing, machinery, construction |
| `parts` | 工业零部件网站 | parts, hardware, tools, repair, mechanic, gadget |
| `building` | 家居建材出海网站 | interior, architecture, furniture, building, home, landscaping |
| `electronics` | 电子电器外贸网站 | electronics, electric, tech, software, cyber, hosting, app |
| `beauty` | 美妆个护品牌出海 | beauty, barber, hair, spa, salon, fashion |
| `medical` | 医疗器械外贸网站 | medical, clinic, dentist, health, pharma, laboratory |
| `energy` | 新能源产品出海 | energy, solar, electric vehicle, eco, green |
| `ecommerce` | 跨境电商独立站 | ecommerce, shop, store, woocommerce, jewellery, supermarket |
| `education` | 教育培训网站 | education, school, university, course, kids, learning |
| `finance` | 金融科技网站 | finance, fintech, payment, wallet, investment, crypto |
| `events` | 活动会议网站 | event, conference, wedding |
| `food` | 餐饮食品网站 | restaurant, catering, bakery, food, nutrition |
| `automotive` | 汽车交通网站 | automotive, car, rental, movers, shipping, logistic |
| `creative` | 创意服务网站 | agency, creative, portfolio, artist, design, nft, video, film |
| `services` | 本地服务网站 | cleaning, plumbing, roofing, repair, landscaping |
| `business` | 企业服务网站 | business, consulting, marketing, seo, coach |
| `other` | 其他行业模板 | 兜底分类 |

---

## 脚本详解

### 1. `import-envato-template-kits.mjs` — 数据导入

**功能**：从 Envato Elements 抓取 WordPress Template Kits 列表并生成 `templates.json`

**用法**：
```powershell
node scripts/import-envato-template-kits.mjs [envato_url] [max_pages]
# 默认抓取 https://elements.envato.com/wordpress/template-kits，最多 80 页
```

**关键逻辑**：
- 逐页抓取 HTML → 正则提取卡片数据（itemUuid, title, href, srcset, author）
- `pickCategory(title)` — 按关键词匹配分类（按 `expectedCategories` 优先级顺序）
- `inferTags(title)` / `inferModules(title, categoryId)` — 自动推断标签和模块
- 可选 `ENRICH_DEMO=1` 环境变量 → 逐个访问商品详情页提取真实 Demo URL
- 连续 2 页无新数据时停止
- 输出 `data/templates.json`（包含 sourceUrl, pagesImported, importedAt, categories, templates）

### 2. `auto-download-envato-chrome.mjs` — Chrome 自动化下载 (主方案)

**功能**：使用 Playwright + 持久化 Chrome Profile 自动下载模板 zip

**用法**：
```powershell
node scripts/auto-download-envato-chrome.mjs [--limit N] [--category id] [--item ITEMID] [--skip id1,id2]
```

**关键逻辑**：
- `selectQueue()` — 从 templates.json 中筛选未下载且有 appUrl 的模板
- 使用 `.envato-chrome-profile` 持久化目录保持登录态
- 调用 `chromium.launchPersistentContext()` 启动 Chrome (headless: false)
- 访问 `appUrl` → 等待 `[data-cy="idp-download-button"]` 出现 → 点击 → 监听 download 事件
- `withTimeout()` — 每个模板 180s 超时
- 下载的 zip 保存到 `downloads/{itemId}/`
- 每完成一个就立即更新 `templates.json` 和 `download-run-latest.json`
- 依赖：Playwright 通过 `createRequire` 从 codex 缓存目录加载

### 3. `auto-download-envato.mjs` — CUA 版下载器 (备用方案)

**功能**：与 Chrome 版相同功能，但使用 CUA (Computer Use Agent) 接口操作浏览器

**差异**：
- 接收 `tab` 对象作为参数（由外部 Agent 框架注入）
- 使用 `tab.playwright.evaluate()` / `tab.cua.click()` 操作页面
- 通过监控 `~/Downloads` 目录检测新 zip 文件
- `archive-envato-download.mjs` 的归档逻辑内嵌于此

### 4. `archive-envato-download.mjs` — 手动归档工具

**功能**：将浏览器下载目录(`~/Downloads`)中的 Envato zip 文件匹配并移动到 `downloads/`

**用法**：
```powershell
node scripts/archive-envato-download.mjs [--all] [--dry-run]
# 默认只处理最新的 1 个文件
# --all 处理所有 Downloads 中的 zip
# --dry-run 仅预览不实际操作
```

**匹配算法**：
- 对文件名做 `slugify()` + `normalizeZipName()`（移除日期后缀、标准化拼写）
- 与每个模板 title 的 slug 计算 `scoreMatch()`（100=完全匹配, 95=短标题匹配, 80=前缀匹配, 65=包含匹配）

### 5. `run-envato-download-loop.ps1` — 持续下载循环

**功能**：无限循环执行批量下载，直到无新下载或全部失败

**用法**：
```powershell
.\scripts\run-envato-download-loop.ps1
```

**关键逻辑**：
- 每次批量下载 `${BatchSize}` 个模板（默认 3）
- 每次间隔 `${WaitSeconds}` 秒（默认 60）
- 自动维护失败黑名单 `download-failed-queue.json`
- 退出条件：下载数量不再增长，或 node 进程退出码非 0
- 当前状态：已运行 71 轮后因全部剩余模板下载失败而停止 (`skipped-failed-items`)

---

## 运行状态 (截至最后运行)

| 指标 | 数值 |
|------|------|
| 已录入模板总数 | ~1000+ |
| 行业类目 | 16 |
| 已下载模板 | 833 |
| 下载循环运行轮次 | 71 |
| 下载失败模板 | 27 个 |
| 失败原因 | `download-not-triggered`（点击下载按钮超时无 download 事件） |

---

## 关键路径约定

- **数据文件**：`data/templates.json` （所有脚本读写此文件）
- **下载目录**：`downloads/{itemId}/*.zip`
- **Chrome Profile**：`.envato-chrome-profile/` （持久化登录态，须保持有效）
- **日志/状态**：`data/download-loop.log`, `data/download-loop-state.json`, `data/download-run-latest.json`, `data/download-failed-queue.json`

---

## 技术注意事项

1. **无 package.json**：项目无依赖声明文件。脚本通过 `createRequire` 从硬盘路径(`~/.cache/codex-runtimes/`)加载 Playwright，属于特殊的运行时注入方式。

2. **Chrome 路径硬编码**：`auto-download-envato-chrome.mjs` 中 `chromePath` 硬编码为 `C:\Program Files\Google\Chrome\Application\chrome.exe`。

3. **工作区路径硬编码**：`run-envato-download-loop.ps1` 中 `$Workspace` 硬编码为 `D:\code\copy-website`。

4. **前端无构建步骤**：直接编辑 `index.html` 即可生效。所有 CSS 和 JS 内联在单个文件中。

5. **本地下载 URL 构造规则**：前端通过 `getLocalDownloadUrl()` 解析 `localFile` 字段（绝对路径），提取 `itemId/文件名` 拼接为相对 URL `downloads/{itemId}/{fileName}`。预览服务器直接映射文件系统路径，因此这些 URL 可正常访问。

6. **Envato 登录依赖**：下载自动化依赖 `.envato-chrome-profile` 中的登录态。如登录过期，脚本会返回 `needs-login` 状态。

7. **模板数据不自动更新**：需手动运行 `import-envato-template-kits.mjs` 重新抓取。已下载的模板记录（`downloaded`, `downloadedAt`, `localFile`, `originalDownloadName`）在重新导入时会被覆盖丢失。
