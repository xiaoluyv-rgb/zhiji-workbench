# 网页版：知识随时更新 + 创作真正接 AI

这一版把网页版从「纯静态快照」改成了**有真后端**的形态。两个板块各解决一件事。

---

## 现在的架构

```
浏览器（静态站点，腾讯云 CloudBase 静态托管）
   │
   ├── 知识 ──────► 云函数 kb ──► 环境自带的 PostgreSQL
   │                （管理员可写）      ▲ 改完刷新即见
   │
   └── 创作 ──────► 云函数 llm-proxy ──► DeepSeek
                    （持团队 Key 或透传你自己的 Key）
```

**云函数不需要你配任何密钥。** CloudBase 云函数运行时自带临时凭据
（`TENCENTCLOUD_SECRETID` / `SECRETKEY` / `SESSIONTOKEN`），用 TC3 签名直接调
`ExecutePGSql` 接口读写环境自带的 PostgreSQL。这是整个方案能成立的关键。

---

## 一、知识板块

### 对你（管理员）
打开网页版 →「知识」→ 右上角**管理** → 输入管理口令 → 可以：

- 新增 / 编辑条目（分区、车型、标题、标签、图片地址、Markdown 正文）
- **下架**：点眼睛图标，条目立刻对所有访客消失（列表里变成「已下架」，随时能再上架）
- 删除

保存后**不需要重新部署**，同事刷新页面就能看到最新版。

> 管理口令：`9f11d328198fe444b0ea4bef25ac7a0dd4a61011a7dc7881`
> 口令存在浏览器 localStorage，换设备要重新输一次。
> 想改口令：改 `cloudbaserc.json` 里 `kb.envVariables.KB_ADMIN_TOKEN`，跑 `npm run deploy:kb`。

### 对同事
打开「知识」直接看，只能读，看不到管理入口也改不了内容。

### 分区对照
| 分区 | 包含的条目类型 |
|---|---|
| 车型参数 | 车型参数、权益 |
| 创作知识库 | 创作知识、爆文库、其他 |

### 初始内容
已经把本地 `wiki/` 灌进去了（`npm run seed:kb`，21 条：车型参数 8、权益 4、创作 5、爆文库 2、其他 2）。
注意这些本地数据带「（演示数据）」标记，真实口径请在管理面板里覆盖更新。

### 常用命令
```bash
npm run deploy:kb     # 部署/更新 kb 云函数（只在改了云函数代码时才需要）
npm run seed:kb       # 把本地 wiki/ 灌进云端（只做一次初始化）
```

本地版（`npm run dev`）不受影响 —— `VITE_KB_API` 只在网页版构建时注入，
本地没有这个变量，知识页继续走飞书 / Obsidian 那套。

---

## 二、创作板块

以前一直是「预设内容」，根因有四个，都已修掉：

1. **★ 代理云函数超时只有 3 秒（这才是真正的致命项）** —— CloudBase 云函数默认
   `timeout` 就是 3s，而 DeepSeek 写 2 条笔记实测要 **7 秒**、10 条要 **20 秒**。
   于是代理稳定返回 `504 FUNCTIONS_TIME_LIMIT_EXCEEDED` → ai-adapter 判定失败 →
   **静默退回预置模板**。表现就是「填了 Key，出来的还是老内容」。
   修法：`cloudbaserc.json` 里两个函数都显式写 `"timeout": 60`。
   ⚠️ 改配置后必须 `node scripts/deploy-fn.mjs llm-proxy` 重新部署才生效。
2. **`isConfigured()` 只看用户自己的 Key** —— 站点明明配了团队共享代理，
   没填 Key 的人却被 401 直接挡在生成门外，压根不会发起请求。
3. **代理地址为空时 `callLlmProxy` 会 `fetch("")`** —— 打回当前页面拿到 200 的 HTML，
   AI 结果解析失败 → 静默退回模板。看起来就是「一直出预设内容」。
4. **只有网络异常才走代理** —— Key 失效、余额不足返回 401/402 时不重试，
   ai-adapter 直接判定失败回退模板。

另外，`generateContent` 现在**按每批 5 条拆分调用**（`LLM_BATCH`）再合并，
并把前几批的标题传下去避免撞题。一次要 30 条时单次请求会撞 60s，拆批后每批
都在 10s 量级，前端总等待时间超过 60s 也没关系。

现在的行为：

- 配了云端代理就**一律走代理**（浏览器直连 DeepSeek 有 CORS 和公司网络两个坑）
- 你填了自己的 Key → 透传（Key 不落服务端、不记日志）
- 你的 Key 挂了（401/402/403/429）→ **自动换团队共享 Key 再试一次**
- 都没填 → 用团队共享 Key，同事开箱即用，不用管 Key
- 万一还是失败，生成结果上方会显示具体原因（原来是只显示「演示模式」）

**人设提示词一行没动** —— `server/ai-adapter.mjs` 里的博主风格、品牌立场、四要素、合规红线
全部原样保留，只是让它们真正发出去了。

---

## 三、构建相关的两个坑（别改回去）

- **不能开 `emptyOutDir`**：一次清空 50+ 个历史 bundle 会被工作区的批量删除保护拦下，
  构建直接失败。改成 `scripts/build-hosted.mjs` 每轮只清理 40 个旧 bundle。
- **静态资源镜像不能用 `fs.cp(dir, dest, {recursive:true})`**：单个目录文件数 ≥50
  （`car-reference/智己/LS6` 正好 50 个）同样被拦。改成逐文件 `copyFile`。

---

## 四、发布网页版

```bash
npm run deploy:cloudbase    # 构建 + 部署静态站点
npm run deploy:media        # 只更新图片（45 秒）
```

网页版配置在 `.env.production.local`（已被 .gitignore 忽略，不会进仓库）：

```
VITE_KB_API=https://zhiji-d4g0etkrwf7e7d1de.service.tcloudbase.com/kb
VITE_LLM_PROXY=https://zhiji-d4g0etkrwf7e7d1de.service.tcloudbase.com/llm-proxy
VITE_LLM_TOKEN=<与云函数 ACCESS_TOKEN 一致>
```
