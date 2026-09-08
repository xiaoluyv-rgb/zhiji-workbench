# 给 WorkBuddy 的安装提示词（同事复制粘贴给 WorkBuddy 即可）

> 维护者把代码推到公开 GitHub 后，把下面整段发给同事。同事**只要在 WorkBuddy 对话框里粘贴这一段，WorkBuddy 会自动完成：clone → 装依赖 → 询问并写入 DeepSeek Key → 探测 / 引导登录飞书 → 启动工作台**。

---

## 给同事的「复制即用」安装提示词

把下面这一整块发给同事：

```
请帮我安装并启动「智己小红书运营工作台」：

1. 把代码下载到本地（不要放含中文/空格的路径）：
   git clone https://github.com/<你的用户名>/zhiji-workbench.git
   cd zhiji-workbench

2. 安装依赖（首次会装 1–3 分钟）：
   npm install

3. 配置 .env（交互式，会问一件主事 + 自动探测飞书）：
   - DeepSeek API Key：去 https://platform.deepseek.com 申请，填你自己的 Key（每人各自一份，不会共享）
   - 共享知识库路径：先随便填一个本地路径，或者直接回车用默认
   - 飞书登录：脚本会自动探测 lark-cli 是否已登录，未登录会告诉你下一条命令怎么跑
   启动命令：node scripts/setup-env.mjs

4. （仅当团队使用车型资料库 / 创作知识库时执行）
   在终端运行：
     lark-cli auth login
   会弹出浏览器，按提示登录飞书账号并授予知识库 / 文档读写权限。完成后回到工作台刷新页面（车型资料库 / 创作知识库 这两个页就能正常加载了）。
   ⚠️ 如果团队不需要这两个页面，可以跳过这一步——内容生成 / 内容审核 / 每日热点 / 社媒洞察 仍然能正常工作。

5. 启动工作台：
   npm run dev
   启动后浏览器会自动打开 http://localhost:5173

6. 启动后两个引擎自动运行（不需要手动点任何按钮）：
   - 「每日热点」：启动后立即抓一次微博热榜，之后每 30 分钟一次；命中智己/竞品关键词自动入库到「每日热点」页。要出 AI 创意选题需要 DeepSeek Key，没配就只展示抓取结果 + 占位文案。
   - 「社媒洞察」：启动后每 15 分钟检查一次，上海时区当天首次自动调用 DeepSeek 把抓到的素材聚簇成《近期风向.md》写到你的 .env 里 PERSONAL_DASHBOARD_VAULT_ROOT 指向的目录。没配 DeepSeek Key 不会出报告。
   - ⚠️ 这两个引擎读的都是**你这台机器**的 .env，不传染维护者的设置。如果团队要共享扫描结果，所有人必须把 PERSONAL_DASHBOARD_VAULT_ROOT 填到同一个共享路径（网络盘 / Syncthing / Git 同步 vault 等）。

7. 装好之后顺手验证两件主事（决定引擎能不能出真实内容）：
   - 打开「每日热点」页：能看到「上次抓取时间」且不是「—」。如果一直是「—」，是本机网络把微博/抖音/百度/新浪拦了（不影响 AI 创意按钮，只影响抓取）。
   - 打开「社媒洞察」页：能看到「上次自动扫描时间」或者「未配置 OPENAI_API_KEY」提示。如果一直空白，去补 .env 里的 OPENAI_API_KEY 然后重启 npm run dev。
   - 如果团队要共享扫描结果：去和同事确认你们 .env 里的 PERSONAL_DASHBOARD_VAULT_ROOT 是不是指向同一个共享路径；不一致的话扫描结果会散在各自的机器上。

8. 使用期间要保持那个命令行窗口开着；关掉它工作台就停了。下次再启动只需重跑第 5 步。

请一步步帮我执行，遇到错误就停下来告诉我。
```

---

## WorkBuddy 执行时要注意的细节

- 路径建议：`C:/workbench/` 或 `D:/tools/zhiji-workbench/`，**避免路径含中文、空格、`&` 等特殊字符**。
- Node 22+ 是必需的；如果同事的 WorkBuddy 环境里 node 版本 < 22，先帮同事装 LTS。
- `npm install` 在国内网络可能慢；可以在 `zhiji-workbench/` 里加一行 `.npmrc` 配置 `registry=https://registry.npmmirror.com`。
- 启动后 WorkBuddy 不需要保持长连——dev server 跑在同事本机，WorkBuddy 跑完就可以离开对话。
- **首次进入「车型资料库」或「创作知识库」时如果看到顶部的飞书登录引导横幅**，按横幅里的步骤跑 `lark-cli auth login` 后点「重新检测」即可刷新；不要把这种情况当成"工作台坏了"来找维护者。

## 飞书登录的取舍

| 模块 | 是否需要飞书 | 备注 |
|---|---|---|
| 内容生成 | ❌ | 用 DeepSeek Key |
| 内容审核 | ❌ | 用 DeepSeek Key + 本地权益库 |
| 每日热点 | ❌ | 用 LLM 聚簇，可走演示模式 |
| 社媒洞察 | ❌ | 应用内真实扫描，可走演示模式 |
| **车型资料库** | ✅ | 飞书 Wiki 是真相源 |
| **创作知识库** | ✅ | 飞书 Wiki 是真相源 |

如果团队同事没有飞书账号 / 不想登录飞书，只需把 `server/feishu-sources.json` 里的全部 `enabled` 字段改成 `false`，并把车型本地参考图直接放到 `public/car-reference/<品牌>/<车型>/`，刷新工作台即可看到本地兜底图（无飞书文档预览）。

## 共享 Vault 的补充说明

工作台启动后需要把 `PERSONAL_DASHBOARD_VAULT_ROOT` 指向**团队共享**的 Vault 目录（飞书知识库 / 网盘同步盘 / 局域网共享盘）。每个同事的机器上路径可能不同，按本机实际位置填。

团队维护者负责先用下面命令初始化一份标准 Vault（**只做一次**）：

```
node scripts/init-vault.mjs "D:\团队共享\智己知识库"
```

然后把整个目录放进共享位置，同事把 `.env` 里的 `PERSONAL_DASHBOARD_VAULT_ROOT` 改成同一份路径即可。

## 同事拿不到 Key 怎么办

如果同事没有 DeepSeek 账号：
- 去 <https://platform.deepseek.com> 用手机号注册（不需要企业认证）
- 进入「API Keys」→ 创建新 key（一次性显示，复制保存）
- 充值（DeepSeek 注册送少量额度，足够体验；不够用最低充值 ¥1 即可）
- 也可以改用 OpenAI：把 `.env` 里的 `OPENAI_BASE_URL` 改成 `https://api.openai.com/v1`、`OPENAI_MODEL` 改成 `gpt-4o-mini`，再填 OpenAI Key

## 同事拿不到飞书账号怎么办

如果团队里有人没有飞书账号 / 不方便登录飞书：
- 让维护者把 `server/feishu-sources.json` 里相关源改成 `"enabled": false`，车型/创作知识库走本地兜底
- 内容生成 / 内容审核 / 每日热点 / 社媒洞察 仍可正常用（不依赖飞书）

## 验证安装成功

工作台启动后应当看到：
- 浏览器自动打开 `http://localhost:5173`
- 左侧导航有「总览 / 车型资料库 / 创作知识库 / 内容生成 / 内容审核 / 每日热点 / 社媒洞察 / 系统」
- 「内容生成」「内容审核」「每日热点」页面正常（不依赖飞书）
- 「车型资料库」「创作知识库」页面顶部可能显示飞书登录横幅（按提示登录即可），不会卡死或超时

如果同事是 macOS / Linux，命令完全一样（`npm install` / `node scripts/setup-env.mjs` / `npm run dev`），不需要额外的 .bat。

## 进阶：打桌面安装版

如果团队有人更喜欢双击图标运行的体验，参考 `交接说明.md` 里的「进阶：桌面安装版」一节，命令是：

```
cd electron
npm install
npm run dist
```

产出在 `electron/release/智己运营工作台 Setup x.x.x.exe`。首次对外分发前建议做代码签名，否则 Windows 会弹 SmartScreen。
