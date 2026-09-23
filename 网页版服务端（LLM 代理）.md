# 网页版的服务端：LLM 代理云函数

纯静态站点没有后端，只能浏览器直连大模型，一旦跨域/网络受限就整站退回模板，
而且每个人都要自己填 Key。加了云函数之后这两种模式都能跑。

## 两种模式

| 模式 | Key 在哪 | 谁付额度 | 同事要不要填 Key |
| --- | --- | --- | --- |
| A 自带 Key（透传） | 浏览器 localStorage | 各人自己 | 要（填一次） |
| B 团队共享 | 云函数环境变量 | 你一个人 | **不用填** |

B 必须校验访问口令，否则等于把 Key 挂在公网上任人刷。

## 部署（一次）

在你自己的终端跑（沙箱里 COS 上传会 60 秒超时，得本机跑）：

```bash
npm run deploy:llm-proxy
```

然后到 **CloudBase 控制台 → 云函数 → llm-proxy → 配置 → 环境变量** 填：

| 变量 | 值 |
| --- | --- |
| `LLM_API_KEY` | 你的 DeepSeek Key（`sk-...`） |
| `LLM_BASE_URL` | `https://api.deepseek.com/v1`（默认就是这个） |
| `ACCESS_TOKEN` | `29f8d5e2673ad52ab0ad9f82de82439f9e08882d`（已写进站点，别改） |
| `ALLOWED_ORIGIN` | 站点域名，默认 `*` |

只填 `LLM_API_KEY` 不填 `ACCESS_TOKEN` → 共享模式关闭，大家各自填 Key。

## 访问地址

```
https://zhiji-d4g0etkrwf7e7d1de.service.tcloudbase.com/llm-proxy
```

自检：

```bash
curl "https://zhiji-d4g0etkrwf7e7d1de.service.tcloudbase.com/llm-proxy" \
  -H "Content-Type: application/json" \
  -H "x-access-token: 29f8d5e2673ad52ab0ad9f82de82439f9e08882d" \
  -H "x-llm-target: https://api.deepseek.com/v1/chat/completions" \
  -d '{"model":"deepseek-chat","messages":[{"role":"user","content":"回复两个字：正常"}],"max_tokens":16}'
```

返回 402 = 共享 Key 没配；403 = 口令不对；正常则是 DeepSeek 的回答。

## 前端怎么用的

- `VITE_LLM_PROXY` / `VITE_LLM_TOKEN` 在构建时注入（已写进当前线上版本）
- 没填自己的 Key → 直接走共享服务
- 填了自己的 Key → 先浏览器直连（更快），失败才走代理
- 设置页会显示当前用的是哪一种

## 改配置后要重新构建

```bash
VITE_LLM_PROXY=https://zhiji-d4g0etkrwf7e7d1de.service.tcloudbase.com/llm-proxy \
VITE_LLM_TOKEN=29f8d5e2673ad52ab0ad9f82de82439f9e08882d \
node scripts/build-hosted.mjs
node scripts/deploy-cloudbase.mjs
```

（Windows 上 `VAR=x cmd` 这种写法不能用，环境变量用上面这种分开导出，或用 node 脚本传。）

## 回退

不传 `VITE_LLM_PROXY` 重新构建即可回到纯静态模式。

## 安全

- 云函数不记录请求体，也不记录任何 Key
- 目标地址白名单：`api.deepseek.com` / `api.openai.com` / `open.bigmodel.cn` / `api.moonshot.cn` / `dashscope.aliyuncs.com` / `api.siliconflow.cn`
- 口令会打进前端包里（不可避免，浏览器端总要有凭据），真正拦人的是它 + 你自己的额度监控；
  发现异常就去控制台把 `LLM_API_KEY` 删掉，立刻回到各人自带 Key
