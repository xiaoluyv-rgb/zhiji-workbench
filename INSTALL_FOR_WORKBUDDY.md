# 给 WorkBuddy 的安装提示词（同事复制粘贴给 WorkBuddy 即可）

> 维护者把代码推到公开 GitHub 后，把下面整段发给同事。同事**只要在 WorkBuddy 对话框里粘贴这一段，WorkBuddy 会自动完成：clone → 装依赖 → 询问并写入 DeepSeek Key → 启动工作台**。

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

3. 配置 .env（交互式，会问两件事）：
   - DeepSeek API Key：去 https://platform.deepseek.com 申请，填你自己的 Key（每人各自一份，不会共享）
   - 共享知识库路径：先随便填一个本地路径，或者直接回车用默认
   启动命令：node scripts/setup-env.mjs

4. 启动工作台：
   npm run dev
   启动后浏览器会自动打开 http://localhost:5173

5. 使用期间要保持那个命令行窗口开着；关掉它工作台就停了。下次再启动只需重跑第 4 步。

请一步步帮我执行，遇到错误就停下来告诉我。
```

---

## WorkBuddy 执行时要注意的细节

- 路径建议：`C:/workbench/` 或 `D:/tools/zhiji-workbench/`，**避免路径含中文、空格、`&` 等特殊字符**。
- Node 22+ 是必需的；如果同事的 WorkBuddy 环境里 node 版本 < 22，先帮同事装 LTS。
- `npm install` 在国内网络可能慢；可以在 `zhiji-workbench/` 里加一行 `.npmrc` 配置 `registry=https://registry.npmmirror.com`。
- 启动后 WorkBuddy 不需要保持长连——dev server 跑在同事本机，WorkBuddy 跑完就可以离开对话。

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

## 验证安装成功

工作台启动后应当看到：
- 浏览器自动打开 `http://localhost:5173`
- 左侧导航有「总览 / 车型资料库 / 创作知识库 / 内容生成 / 内容审核 / 每日热点 / 社媒洞察 / 系统」
- 顶部不报错、左侧没有「飞书读取失败」红色提示（如果同事自己的飞书账号是空的，那条是正常的，不影响其它功能）

如果同事是 macOS / Linux，命令完全一样（`npm install` / `node scripts/setup-env.mjs` / `npm run dev`），不需要额外的 .bat。

## 进阶：打桌面安装版

如果团队有人更喜欢双击图标运行的体验，参考 `交接说明.md` 里的「进阶：桌面安装版」一节，命令是：

```
cd electron
npm install
npm run dist
```

产出在 `electron/release/智己运营工作台 Setup x.x.x.exe`。首次对外分发前建议做代码签名，否则 Windows 会弹 SmartScreen。
