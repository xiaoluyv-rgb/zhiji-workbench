# 网页版部署说明（Cloudflare Workers）

> 目标：给同事一个网址，他自己填一次 API Key 就能用；你推 git 或跑一条命令，全员立刻更新。

---

## 一、它现在是什么形态

网页版 = **纯静态站点 + 一个转发函数**，没有后端服务器、没有数据库。

| 部分 | 落在哪 | 说明 |
| --- | --- | --- |
| 页面 / 车型参数 / 知识库 / 参考图 | 静态文件 | 构建期打包，随站点发布 |
| 内容生成 / 内容审核 | 浏览器本地执行 | 复用 `server/ai-adapter.mjs`，靠虚拟文件系统跑在浏览器里 |
| 大模型调用 | 直连 DeepSeek（失败自动走同域代理） | **Key 由使用者自己填，只存在他自己的浏览器** |
| 每日热点 / 社媒洞察 / 总览 | 构建期快照 | 你本地抓完随站点发布，所以「你更新 → 同事刷新」 |

### 网页版能做什么 / 不能做什么

**能用**：内容生成、内容审核、车型参数、创作知识库、车型参考图、每日热点、社媒洞察（快照）、总览。

**不能用**：本地 Vault 读写、飞书同步与在线文档、实时扫描、本地文件打开 —— 这些依赖你本机的文件和凭据，只能在本地版用。前端会显示「网页版不可用」而不是报错。

---

## 二、部署（Cloudflare Workers + 静态资源）

> 注意：Cloudflare 现在「Create an app → 选仓库」走的是 **Workers** 流程
> （界面上是 Build command / Deploy command / Preview command），
> 不是老的 Pages 流程。仓库里的 `wrangler.toml` 已按 Workers 配好，照下面填即可。

### 2.1 首次创建

1. Cloudflare Dashboard → **Create an app** → **Select a repository** → 选 `xiaoluyv-rgb/zhiji-workbench`
2. 在「Set up your application」这一页**只改一个字段**：

   | 字段 | 填什么 |
   | --- | --- |
   | Project name | `zhiji-workbench`（默认即可） |
   | **Build command** | **`npm run build:hosted`** ← 只改这个 |
   | Deploy command | `npx wrangler deploy`（保持默认） |
   | Preview command | `npx wrangler preview`（保持默认） |

3. 点 **Deploy**，等两三分钟

### 2.2 ⚠️ 如果 Build command 显示成 `None`

项目建好之后进入的是 **Builds / Deployments** 页面，那个一次性表单就不再出现了。
如果发现 **Build command 那一行是 `None`**，Cloudflare 会**完全跳过构建阶段**，
直接跑 `npx wrangler deploy` —— 它找不到 `dist/client`，于是报错：

```
Build command: None
Deploying ✗   ← 失败在这一步，日志里一条构建输出都没有
```

补法（两个入口任选其一）：

- **入口 A（推荐）**：项目页顶部 **Settings** → 找 **Build** 区块 → **Build command** 填
  `npm run build:hosted` → 保存 → 回 **Deployments** → 点右上角 **Retry build**
- **入口 B**：把 **Deploy command** 从 `npx wrangler deploy` 改成
  `npm run build:hosted && npx wrangler deploy`（构建与部署合并，一样能跑）

判断有没有生效：构建成功后，Builds 页面会多出一个绿色的 **Building** 阶段，
且日志里能看到 `[hosted] node v... / cwd=...` 这一行。

不需要填输出目录、也不需要填 Node 版本 —— `wrangler.toml` 里已经写死了：

```toml
main    = "worker/index.js"        # 承接 /api/llm-proxy 转发
[assets]
directory = "dist/client"          # 构建产物目录
not_found_handling = "single-page-application"   # 刷新子页面不 404
```

Node 版本由仓库根目录的 `.node-version`（22）指定。

之后你每次 `git push`，Cloudflare 自动重新构建发布 —— **同事刷新页面就是最新版**。

---

## 三、同事怎么用（发给他们的三句话）

1. 打开网址（部署完 Cloudflare 会给，形如 `https://zhiji-xhs-workbench.pages.dev`）
2. 左侧「设置 → API Key」填自己的 DeepSeek Key（DeepSeek 控制台申请，几块钱能用很久）
3. 回「内容生成」选车型 → 生成

Key 只写进他自己的浏览器，不会传给我们、不会进仓库、别人看不到。换电脑或清缓存后重填一次即可。

---

## 四、你后续怎么更新

| 改什么 | 怎么做 |
| --- | --- |
| 改功能 / 改界面 | 改代码 → `git push` → 自动部署（方式 A） |
| 更新车型参数 | 改 `个人知识库/wiki/` → `node scripts/build-hosted-snapshot.mjs` → `git push` |
| 更新每日热点 / 社媒洞察快照 | 确保本地 dev server 在跑（5173）→ `WORKBENCH_SNAPSHOT_API=http://127.0.0.1:5173 node scripts/build-hosted-snapshot.mjs` → `git push` |

`build:hosted` 已经把生成快照放进构建流程，所以接了 Git 之后，**推 git 就是完整更新**。

---

## 五、安全提醒（上线前请确认）

- **默认生成的网址是公开的**，任何拿到链接的人都能打开。里面含车型参数、权益与创作知识库内容。
  - 建议：Cloudflare Dashboard → 该项目 → **Settings → Access** → 加一条策略，只允许公司邮箱/指定邮箱访问（Cloudflare Access 免费额度足够小团队用）。
- `worker/index.js` 里的 `/api/llm-proxy` 只允许转发到白名单域名（DeepSeek / OpenAI / 智谱 / Moonshot / 通义 / SiliconFlow），且**不保存任何 Key、不写日志**。要新增厂商，改这个文件里的 `ALLOWED_HOSTS`。
- `.env` 里的 Key 不会被打进网页版（托管构建只从浏览器 localStorage 读 Key）。

---

## 六、常见问题

**Q：填了 Key 仍然生成失败？**
先看「设置」页的「测试连接」。大概率是接口地址填错（必须是 `https://api.deepseek.com/v1`，末尾不要带 `/chat/completions`）。

**Q：同事打开是空白页？**
先看浏览器控制台。如果报某个 `IconXxx` 找不到，跑一次 `node scripts/verify-tabler-icons.mjs` 检查图标导出。

**Q：每日热点数据是空的？**
那是构建时没抓到（本地 dev server 没开）。按第四节重新生成快照再推一次。

**Q：页面刷新后 404？**
SPA 兜底由 `wrangler.toml` 的 `not_found_handling = "single-page-application"` + `worker/index.js` 共同负责，确认 `wrangler.toml` 已推到仓库。

**Q：部署报错 `Could not resolve "dist/client"`？**
说明构建命令没跑成功。确认 Build command 填的是 `npm run build:hosted`（不是默认的 `npm run build`）。
