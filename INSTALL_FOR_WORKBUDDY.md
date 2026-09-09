# 智己小红书运营工作台 · 安装说明书

> 适用版本：**2026-09-09 之后的 commit**（包含白屏修复、supervisor 自动重启、`/api/health` 健康端点、`scripts/verify-tabler-icons.mjs` 自检工具）。
>
> 配套入口：本仓 `INSTALL_FOR_WORKBUDDY.md`，同事双击/解压后可直接阅读。

---

## 0. 速查

| 项 | 值 |
|---|---|
| 仓库地址 | `https://github.com/xiaoluyv-rgb/zhiji-workbench` |
| Node 版本要求 | **22+**（LTS 或更新） |
| 默认端口 | **5173**（dev mode），自动打开 `http://localhost:5173/` |
| 健康检查端点 | `http://localhost:5173/api/health` |
| 一键运行包（备选） | `dist-package/工作台一键运行包.zip`（不含 node_modules） |
| 桌面安装版（备选） | 进入 `electron/` 跑 `npm install && npm run dist` |

---

## 1. 三种分发路径

工作台代码公开在 GitHub，按团队习惯选一种：

| 路径 | 适用场景 | 启动方式 |
|---|---|---|
| **A. GitHub + 一键提示词（推荐）** | 同事有 WorkBuddy / Git，会命令行 | `git clone` → `npm install` → `npm run dev` |
| **B. 一键运行包 zip** | 同事不熟命令行 | 解压 → 双击 `start-workbench.bat` / `.command` / `.sh` |
| **C. Electron 桌面安装版** | 同事要"双击图标启动"的体验 | 跑 `electron/` 的 `npm run dist` 打成 `.exe` |

下面统一讲 A 路径；B/C 在最末段补充差异。

---

## 2. 标准安装流程（10 步，5–10 分钟）

### 第 1 步 · 准备 Node 22+

打开终端（Windows 用 PowerShell / Git Bash，macOS / Linux 用 Terminal），确认 Node 版本：

```bash
node -v
# 必须 v22.x.x 或更高；不够就先到 https://nodejs.org 安装 LTS
```

### 第 2 步 · 把代码下载到本地

路径**避免含中文、空格、`&`**——推荐 `C:/workbench/` 或 `D:/tools/zhiji-workbench/`（macOS/Linux 用 `/Users/yourname/workbench/`）。

```bash
git clone https://github.com/xiaoluyv-rgb/zhiji-workbench.git
cd zhiji-workbench
```

### 第 3 步 · 装依赖（首次 1–3 分钟）

```bash
npm install
```

> 国内网络慢的话，先在项目根目录建一个 `.npmrc`（如果不存在），写入：
> ```
> registry=https://registry.npmmirror.com
> ```
> 再跑 `npm install`。

### 第 4 步 · 配置 .env（交互式，只问两件事）

```bash
node scripts/setup-env.mjs
```

会依次问：

1. **DeepSeek API Key**（必填）→ 去 <https://platform.deepseek.com> 用手机号注册 → 「API Keys」→ 创建新 key（一次性显示，复制保存）。填**你自己**的 Key，每人不共享。DeepSeek 注册送少量额度，不够用最低充值 ¥1 即可。
2. **共享知识库路径**（可回车跳过）→ 想用团队共享 Vault 就填团队维护者指给你的路径；想先用本地默认就直接回车（默认在 `../个人知识库`）。

脚本还会自动探测本机 `lark-cli` 是否已登录飞书——没登录会告诉你第 5 步怎么跑。

> ⚠️ **没有 DeepSeek Key 也能用**——只是内容生成 / 审核 / 热点 AI 创意会走演示模式（占位文案）。填 Key 后自动升级到真实生成。

### 第 5 步 ·（可选）登录飞书账号

只有「**车型资料库**」「**创作知识库**」两个页面依赖飞书 Wiki。如果团队不用这两个页面，可以**跳过这一步**，其他功能不受影响。

需要的话在终端跑：

```bash
lark-cli auth login
```

会弹出浏览器，按提示登录飞书并授予「知识库 / 文档读写权限」。完成后回工作台刷新页面即可。

### 第 6 步 · 启动工作台

```bash
npm run dev
```

启动过程：
1. Vite 编译（首次约 10–15 秒）
2. 浏览器**自动打开** `http://localhost:5173/`（约 7 秒后）
3. 看到左侧导航有 8 项菜单 → 装好了

### 第 7 步 · 验证启动成功

打开浏览器后，立刻能用的功能：

| 页面 | 是否需要 DeepSeek | 是否需要飞书 |
|---|---|---|
| 总览 | 否 | 否 |
| **内容生成** | 是（无 Key 走演示模式） | 否 |
| **内容审核** | 是（无 Key 走演示模式） | 否 |
| **每日热点** | 部分（抓取不需要，AI 创意需要） | 否 |
| **社媒洞察** | 是（聚簇需要） | 否 |
| 车型资料库 | 否 | 是 |
| 创作知识库 | 否 | 是 |

**先看「内容生成」或「每日热点」页面——白屏 / 报错 / 加载不出来 = 装坏了**；正常显示 = 装好了。

### 第 8 步 · 两个后台引擎（自动跑，不用手动）

启动后两个引擎**自动运行**：
- 「每日热点」：启动立即抓一次微博热榜 → 之后每 30 分钟一次 → 命中智己/竞品关键词自动入库
- 「社媒洞察」：每 15 分钟检查一次 → 上海时区当天首次调用 DeepSeek 把素材聚簇成《近期风向.md》

⚠️ 这两个引擎读的是**本机 .env**，不传染维护者设置。团队要共享扫描结果，**所有人必须把 `PERSONAL_DASHBOARD_VAULT_ROOT` 填到同一个共享路径**（网络盘 / Syncthing / Git 同步 vault）。

### 第 9 步 · 顺手做一次健康检查

打开新终端窗口，跑：

```bash
curl http://localhost:5173/api/health
```

应返回完整 JSON，包括：

- `pid`、`uptimeSec`、`memory`（rssMB / heapUsedMB）
- `engines.dailyHot.status` 是 `"live"` 或 `"stale"`（说明抓到数据）
- `engines.trendScan.status` 是 `"ok"`（说明跑过扫描）

如果返回 `uptimeSec` 一直很小 / `dailyHot.status="unavailable"` → 详见第 11 节「故障排查」。

### 第 10 步 · 关 / 重启

- 关掉启动 `npm run dev` 的那个终端窗口 → 工作台停了
- 想再用 → `cd` 进项目目录，再跑 `npm run dev`

> **如果用的是一键运行包 / supervisor 启动**（详见第 3 节），关掉终端 = 干净退出；中途 vite 崩了会自动 5 秒后拉起，连续 10 次失败才会停下报错。

---

## 3. 一键运行包 / 桌面版的差异

### 3.1 一键运行包（B 路径）

同事解压 `工作台一键运行包.zip` 后看到：

```
工作台一键运行包/
├── src/  server/  public/  scripts/  ...
├── package.json
├── node_modules/      ← 不含（首次会自动装）
├── .env.example
├── start-workbench.bat       ← Windows 双击
├── start-workbench.command   ← macOS 双击（chmod +x 后）
└── 交接说明.md
```

**首次双击**：自动装依赖 → 弹 .env 配置向导 → 启动并打开浏览器。
**后续双击**：直接启动。

**关键差别**：脚本带 supervisor：
- vite 异常退出 → **5 秒后自动重启**
- 连续 10 次失败 → 停止自动重启并报错（避免循环崩溃）
- 用户主动 Ctrl+C 或关窗口 → 干净退出

### 3.2 桌面安装版（C 路径）

维护者打桌面版发给完全不想碰命令行的同事：

```bash
cd electron
npm install
npm run dist
```

产出 `electron/release/智己运营工作台 Setup x.x.x.exe`（Windows）。首次对外分发建议购买代码签名证书，否则 Windows 会弹 SmartScreen。

> 注意：桌面版的 vite 进程由 Electron 主进程 spawn，supervisor 在 Electron 主进程里实现。

---

## 4. 飞书 / 共享 Vault 详谈

### 4.1 飞书取舍

| 团队情况 | 建议 |
|---|---|
| 团队都有飞书账号 | 跑 `lark-cli auth login`，车型/创作知识库正常工作 |
| 团队没人能登录飞书 | 让维护者把 `server/feishu-sources.json` 里相关源的 `"enabled"` 改成 `false`；车型/创作知识库走本地兜底；其他功能不受影响 |
| 只是个别人没飞书 | 该同事单独把 `feishu-sources.json` 改 `enabled:false`，不影响其他人 |

### 4.2 共享 Vault

工作台启动后 **每个同事**的 `.env` 都需要填：

```
PERSONAL_DASHBOARD_VAULT_ROOT= D:\团队共享\智己知识库    ← Windows
PERSONAL_DASHBOARD_VAULT_ROOT= /Volumes/TeamShare/智己知识库  ← macOS
```

**团队维护者**负责一次性初始化标准目录结构：

```bash
node scripts/init-vault.mjs "D:\团队共享\智己知识库"
```

——不覆盖任何已有文件，重复跑只补缺失目录。然后把整个目录放进飞书知识库 / 网盘 / 局域网共享盘。

---

## 5. Key 与凭据的安全约束

- ✅ `.env`、个人 Vault、飞书 token（`~/.lark-cli`）**都已在 `.gitignore`**
- ✅ Key 是**个人**密钥，不要写进 zip / git / 飞书文档明文分发
- ✅ 推公开仓前维护者跑 `npm run privacy:scan` 扫一遍
- ❌ 不要把 DeepSeek Key 共享给同事（额度/限速/泄露风险）

---

## 6. 故障排查（同事碰到先看这一节）

### 6.1 启动后白屏 / 一直加载

**第一步**：跑自检工具

```bash
node scripts/verify-tabler-icons.mjs
```

如果输出 `不存在的导出：N (N>0)`，把报错里的图标名发给维护者——这是图标导入的运行时错误（2026-09-09 那次白屏就是这个原因）。

**第二步**：健康检查

```bash
curl http://localhost:5173/api/health
```

看返回的 `dailyHot.status` / `trendScan.status` / `vault.status`，哪个不是 `live` / `ok` / `watching` 就贴给维护者。

**第三步**：看浏览器控制台

按 `F12` 打开 DevTools → Console 标签，把红色 Uncaught 错误截图发维护者。

### 6.2 「每日热点」一直显示「上次抓取时间：—」

说明本机网络把微博 / 抖音 / 百度 / 新浪拦了。**不影响 AI 创意按钮，只影响抓取**。如果团队需要热点抓取数据，换台能直连外网的机器跑，或在维护者协助下配代理。

### 6.3 「社媒洞察」空白 / 一直显示「未配置 OPENAI_API_KEY」

`.env` 里的 `OPENAI_API_KEY` 没填或填错了。修改后**重启 `npm run dev`** 让它重新读 .env。

### 6.4 vite 一直挂、supervisor 反复重启

观察终端里的 `[supervisor] vite 退出 code=...（第 N 次）` 提示：
- 如果 N 累计到 10 次会自动停下 → 把最后看到的 vite 报错信息截图给维护者
- 如果连续 5–10 次都报相同错误，多半是某个中间件或 LLM Key 问题

### 6.5 飞书相关页面一直显示「飞书读取失败」

**第一步**：`curl -fsSL http://localhost:5173/api/feishu/sources | head` 看返回的 message
**第二步**：看 `~/.lark-cli/locks/` 是否残留锁文件

```bash
ls "C:/Users/28691/.lark-cli/locks/" 2>/dev/null
```

如果有 `*.lock` 文件且 `tasklist` 里没有 lark-cli 进程 → 残留锁导致 `failed to acquire token storage lock`。删除锁即可（不要动 `cache/` 与 `config.json`）：

```bash
python -c "import ctypes, glob; [ctypes.windll.kernel32.DeleteFileW(p) for p in glob.glob(r'C:/Users/28691/.lark-cli/locks/*.lock')]"
```

然后重启 dev server。

### 6.6 npm install 卡住 / 失败

通常是网络问题。改 `.npmrc` 用 npmmirror：

```
registry=https://registry.npmmirror.com
```

再重跑 `npm install`。

### 6.7 supervisor / dev server 退出码不是 0，但同事是手动 Ctrl+C 终止的

Ctrl+C 在 Windows 上会让 vite 以非 0 码退出，supervisor 会试图重启。要彻底停：
- Windows：关掉终端窗口
- macOS / Linux：按一次 Ctrl+C，等几秒，supervisor 看到 vite 退出后会停

或者直接 `taskkill /F /PID <vite的pid>` / `kill <pid>`。

---

## 7. 版本更新（维护者一次，同事一行）

维护者改完代码 push 后，同事升级：

```bash
# 主路径：git clone 装的
cd zhiji-workbench
git pull
npm install
npm run dev

# 一键包：重新解压新 zip；老的 node_modules 会被覆盖，依赖自动重装
```

---

## 8. 进阶参考

| 文档 | 路径 | 内容 |
|---|---|---|
| 工作台打包部署方案 | `工作台打包部署方案.md` | 三种分发方案的设计取舍 |
| README | `README.md` | 项目整体说明 + 关键能力 |
| 交接说明 | `交接说明.md` | 简短版交接清单 |
| 内容审核 | `src/pages/ContentReviewPage.jsx` | 四层审核 + 标题力评分 |
| 飞书 API | `server/feishu.mjs` | lark-cli 调用封装 |

---

> 最后更新：2026-09-09（与 `xiaoluyv-rgb/zhiji-workbench` commit `0f948bc` 同步）
