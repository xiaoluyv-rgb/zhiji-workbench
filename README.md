# 智己小红书运营工作台

一个本地优先的智己汽车小红书内容运营工作台：内容生成、内容审核、每日热点三层级扫描、社媒洞察、车型资料库、知识库。**所有数据保存在你自己电脑上，不联网上传。**

后端走 Node + Vite 中间件，前端 React 19；内容生成和每日热点 AI 创意共用一个 OpenAI 兼容的 LLM 端点（默认接 DeepSeek）。

## 一键启动（30 秒）

需要 Node 22+。已经装过 Node 的同事直接：

```bash
npm install
npm run dev
```

浏览器自动打开 `http://localhost:5173`。

> 没装 Node？到 <https://nodejs.org> 装 LTS 版即可。

## 首次使用：填两件事 + 登录飞书

第一次跑会让你填（或直接编辑 `.env`）：

| 项 | 说明 |
|---|---|
| `OPENAI_API_KEY` | 你的 DeepSeek（或 OpenAI）Key。**每人各自一份**，不会上传共享。留空则内容生成/审核/热点走演示模式 |
| `PERSONAL_DASHBOARD_VAULT_ROOT` | 团队共享 Vault 的绝对路径（没有可先用默认） |
| **本机飞书登录（lark-cli）** | 「车型资料库」「创作知识库」依赖飞书为真相源，需要同事在本机跑一次 `lark-cli auth login`。其它四个模块不依赖飞书，不登录也能正常使用。脚本 `node scripts/setup-env.mjs` 跑完会探测，没登录会给出明确提示。 |

`.env` 样例见 `.env.example`。任何时候改 `.env` 后重启 `npm run dev` 生效。

## 主要功能

| 模块 | 能力 |
|---|---|
| **总览** | 工作台 + Vault + 内容生成多维概览 |
| **内容生成** | 单篇小红书笔记生成；5 位真实博主风格 chip（小朋友管理员 / 冷静的饺子 / 兔子警官 / 发财小销售 / 极速小驰）；4 个爆文公式钩子；支持 LLM 兜底；自带历史记录 |
| **内容审核** | 关键词锚定 + LLM 校对（产品点 / 政策权益 / 平台规范 / 四要素）；标题力独立维度打分 + 3 条参考标题 |
| **每日热点** | 三层级：平台原始热点（微博/抖音）→ 汽车筛选（按智己车型） → AI 创意产出 |
| **社媒洞察** | 应用内真实扫描（聚簇分析 + 自动报告落 Vault） |
| **车型资料库** | 飞书车型图库实时镜像，刷新即重新发现并同步 |
| **知识库** | Obsidian 风格 Vault 实时索引、阅读、批注、搜索 |

## 目录约定

```text
.
├── src/                # React 前端
├── server/             # Vite 中间件 + 全部 API（含 AI 适配、Vault 索引、飞书镜像等）
├── shared/             # 前后端共享类型
├── config/             # 默认配置（注意力策略等）
├── scripts/            # 维护者工具（build-package / setup-env / init-vault / 验证脚本等）
├── templates/          # 抖音/小红书契约模板
├── public/             # 静态资源（图标、飞书镜像 manifest）
├── docs/               # 公开边界说明、API 文档
├── worker/             # 后台 worker
├── tests/              # 单元测试
├── electron/           # 可选：把工作台打包成桌面 .exe
├── start-workbench.*   # 一键启动脚本
└── .env / .env.example
```

## Vault 结构（团队共享）

`PERSONAL_DASHBOARD_VAULT_ROOT` 指向的目录建议长这样（用 `node scripts/init-vault.mjs <路径>` 一键初始化）：

```text
your-vault/
├── 10_raw/                       # 原始材料（文章 / 书摘 / 个人想法 / 社媒洞察）
├── 30_self_media/douyin/         # 抖音数据层
├── 40_topics/ideas/              # 选题与灵感
├── 50_scripts/                   # 内容成果
└── wiki/
    ├── car-model/                # 车型参数（内容生成的真相源）
    ├── benefits/                 # 最新权益（审核的口径）
    ├── policy/                   # 广告法 / 平台规范
    ├── concepts/                 # 概念卡
    ├── frameworks/               # 方法论框架
    └── viral-formula/            # 爆文库 / 标题钩子公式
```

## 进阶：给同事的三种分发方式

| 方式 | 一句话 | 适合 |
|---|---|---|
| **GitHub + WorkBuddy 安装** | 推到公开 GitHub，同事在 WorkBuddy 里贴一段 prompt 即可自动 clone + install + 填 Key + 启动 | 你和同事都用 WorkBuddy |
| **一键运行包** | `node scripts/build-package.mjs --with-node "<node.zip>"` 打 zip 同事解压双击 bat | 同事不熟命令行 |
| **Electron 桌面 .exe** | `cd electron && npm install && npm run dist` 出 Setup.exe | 同事想要双击图标 |

完整说明见 [INSTALL_FOR_WORKBUDDY.md](./INSTALL_FOR_WORKBUDDY.md) 和 [交接说明.md](./交接说明.md)。

## 维护者命令

```bash
npm run dev          # 本地开发
npm run build        # 静态构建（Cloudflare Pages 部署用）
npm run privacy:scan # 公开前隐私扫描
npm run demo:generate # 重新生成抖音演示数据

node scripts/build-package.mjs --with-node "<node.zip>"   # 打一键运行包
node scripts/init-vault.mjs "<vault 路径>"                # 初始化团队 Vault
node scripts/setup-env.mjs                                # 重新配置 .env
```

## 隐私边界

- 工作台默认监听 `127.0.0.1`，不暴露公网。
- `.env` 含个人 Key，**已在 `.gitignore`，不会进仓库**。
- 推公开仓库前建议跑 `npm run privacy:scan` 扫一遍；人工还要再检查 Vault 目录、测试夹具、构建产物。

## 许可证

代码许可证未由版权所有者最终确认。在明确选定许可证之前，不应把仓库对外宣称为已完成法律意义上的开源发行。
