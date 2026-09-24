// 知识库云端服务（CloudBase HTTP 云函数）
//
// 为什么要有它：
//   以前「知识」是构建期打包进站点的静态快照 —— 改一个字都要重新构建 + 全量部署，
//   同事还不一定看得到。现在知识存在云端的 PostgreSQL 表里：
//     · 管理员在网页上新增 / 编辑 / 下架，几秒内生效
//     · 所有人打开站点就拉到最新内容，不需要重新部署
//
// 存储怎么来的：云函数运行时自带临时凭据（TENCENTCLOUD_SECRETID/KEY/SESSIONTOKEN），
// 用 TC3 签名直接调 CloudBase 的 ExecutePGSql 接口读写数据库，不需要额外配任何密钥。
//
// 接口：
//   GET  /kb/list           公开读，只返回 status=online 的条目
//   POST /kb/admin          管理端写操作，需要 x-admin-token
//                           { action: "upsert" | "status" | "delete" | "seed", ... }
//
// 环境变量：
//   KB_ADMIN_TOKEN   管理口令（必填，不填则写接口全部关闭）
const crypto = require("crypto");

const SERVICE = "tcb";
const HOST = "tcb.tencentcloudapi.com";
const REGION = "ap-shanghai";
const ENV = process.env.SCF_NAMESPACE || process.env.ENV_ID;
const ADMIN_TOKEN = process.env.KB_ADMIN_TOKEN || "";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type,x-admin-token",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  "Access-Control-Max-Age": "86400",
};

const json = (code, obj) => ({
  statusCode: code,
  headers: { "Content-Type": "application/json; charset=utf-8", ...CORS },
  body: JSON.stringify(obj),
});

// ---------- 腾讯云 API（TC3-HMAC-SHA256）----------
function sha256hex(s) {
  return crypto.createHash("sha256").update(s).digest("hex");
}
function hmac(key, s) {
  return crypto.createHmac("sha256", key).update(s).digest();
}

async function tc3(action, payload) {
  const secretId = process.env.TENCENTCLOUD_SECRETID;
  const secretKey = process.env.TENCENTCLOUD_SECRETKEY;
  const body = JSON.stringify(payload);
  const now = Math.floor(Date.now() / 1000);
  const date = new Date(now * 1000).toISOString().slice(0, 10);
  const signedHeaders = "content-type;host;x-tc-action";
  const canonicalRequest = [
    "POST",
    "/",
    "",
    "content-type:application/json",
    `host:${HOST}`,
    `x-tc-action:${action.toLowerCase()}`,
    "",
    signedHeaders,
    sha256hex(body),
  ].join("\n");
  const stringToSign = [
    "TC3-HMAC-SHA256",
    String(now),
    `${date}/${SERVICE}/tc3_request`,
    sha256hex(canonicalRequest),
  ].join("\n");
  const d = hmac(`TC3${secretKey}`, date);
  const s = hmac(d, SERVICE);
  const sg = hmac(s, "tc3_request");
  const signature = crypto.createHmac("sha256", sg).update(stringToSign).digest("hex");

  const resp = await fetch(`https://${HOST}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-TC-Action": action,
      "X-TC-Version": "2018-06-08",
      "X-TC-Region": REGION,
      "X-TC-Timestamp": String(now),
      "X-TC-Token": process.env.TENCENTCLOUD_SESSIONTOKEN,
      Authorization:
        `TC3-HMAC-SHA256 Credential=${secretId}/${date}/${SERVICE}/tc3_request, ` +
        `SignedHeaders=${signedHeaders}, Signature=${signature}`,
    },
    body,
  });
  const text = await resp.text();
  let parsed;
  try {
    parsed = JSON.parse(text).Response;
  } catch {
    throw new Error(`云端返回非 JSON：${text.slice(0, 200)}`);
  }
  if (parsed?.Error) throw new Error(`${parsed.Error.Code}: ${parsed.Error.Message}`);
  return parsed;
}

// 执行 SQL，返回 [{列名: 值}]。Rows 里每行是一个 JSON 数组字符串。
async function sql(statement) {
  const r = await tc3("ExecutePGSql", { EnvId: ENV, Sql: statement });
  const columns = r.Columns || [];
  const rows = (r.Rows || []).map((raw) => {
    let cells;
    try {
      cells = JSON.parse(raw);
    } catch {
      cells = [raw];
    }
    const obj = {};
    columns.forEach((c, i) => {
      obj[c] = cells[i] ?? null;
    });
    return obj;
  });
  return rows;
}

// PG 里没有现成的转义，单引号加倍即可；管理端才用它，且不接受拼接用户表名。
function esc(v) {
  return String(v ?? "").replace(/'/g, "''");
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS kb_items (
  id          text PRIMARY KEY,
  type        text NOT NULL DEFAULT 'note',
  model       text NOT NULL DEFAULT '',
  title       text NOT NULL DEFAULT '',
  summary     text NOT NULL DEFAULT '',
  content     text NOT NULL DEFAULT '',
  tags        text NOT NULL DEFAULT '',
  images      text NOT NULL DEFAULT '[]',
  status      text NOT NULL DEFAULT 'online',
  sort        integer NOT NULL DEFAULT 0,
  updated_at  text NOT NULL DEFAULT '',
  updated_by  text NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS kb_items_type_idx ON kb_items (type);
CREATE INDEX IF NOT EXISTS kb_items_status_idx ON kb_items (status);
`;

let schemaReady = false;
async function ensureSchema() {
  if (schemaReady) return;
  await sql(SCHEMA);
  schemaReady = true;
}

// ---------- 读 ----------
async function listItems(includeOffline) {
  await ensureSchema();
  const where = includeOffline ? "" : "WHERE status = 'online'";
  const rows = await sql(
    `SELECT id, type, model, title, summary, content, tags, images, status, sort, updated_at, updated_by
     FROM kb_items ${where} ORDER BY sort ASC, updated_at DESC`,
  );
  return rows.map((r) => normalize(r));
}

function normalize(r) {
  let images = [];
  try {
    images = JSON.parse(r.images || "[]");
  } catch {
    images = [];
  }
  return {
    id: r.id,
    type: r.type,
    model: r.model || "",
    title: r.title,
    summary: r.summary || "",
    content: r.content || "",
    tags: String(r.tags || "")
      .split(/[,，\s]+/)
      .filter(Boolean),
    images,
    status: r.status,
    sort: Number(r.sort) || 0,
    updatedAt: r.updated_at || "",
    updatedBy: r.updated_by || "",
  };
}

// ---------- 写 ----------
function requireAdmin(headers) {
  if (!ADMIN_TOKEN) return json(503, { error: "服务端未配置 KB_ADMIN_TOKEN，知识库管理功能已关闭。" });
  const got = String(headers?.["x-admin-token"] || headers?.["X-Admin-Token"] || "").trim();
  if (!got || got !== ADMIN_TOKEN) return json(401, { error: "管理口令不正确。" });
  return null;
}

async function upsert(item) {
  const id = String(item.id || "").trim() || `kb_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const images = JSON.stringify(Array.isArray(item.images) ? item.images : []);
  const tags = Array.isArray(item.tags) ? item.tags.join(",") : String(item.tags || "");
  await sql(
    `INSERT INTO kb_items (id, type, model, title, summary, content, tags, images, status, sort, updated_at, updated_by)
     VALUES ('${esc(id)}','${esc(item.type || "note")}','${esc(item.model || "")}','${esc(item.title || "未命名")}',
             '${esc(item.summary || "")}','${esc(item.content || "")}','${esc(tags)}','${esc(images)}',
             '${esc(item.status || "online")}',${Number(item.sort) || 0},
             '${esc(new Date().toISOString())}','${esc(item.updatedBy || "admin")}')
     ON CONFLICT (id) DO UPDATE SET
       type = EXCLUDED.type, model = EXCLUDED.model, title = EXCLUDED.title,
       summary = EXCLUDED.summary, content = EXCLUDED.content, tags = EXCLUDED.tags,
       images = EXCLUDED.images, status = EXCLUDED.status, sort = EXCLUDED.sort,
       updated_at = EXCLUDED.updated_at, updated_by = EXCLUDED.updated_by`,
  );
  return { id };
}

async function setStatus(id, status) {
  await sql(
    `UPDATE kb_items SET status = '${esc(status)}', updated_at = '${esc(new Date().toISOString())}'
     WHERE id = '${esc(id)}'`,
  );
  return { id, status };
}

async function remove(id) {
  await sql(`DELETE FROM kb_items WHERE id = '${esc(id)}'`);
  return { id, deleted: true };
}

async function seed(items) {
  if (!Array.isArray(items) || !items.length) return { seeded: 0 };
  let n = 0;
  for (const item of items) {
    // eslint-disable-next-line no-await-in-loop
    await upsert(item);
    n += 1;
  }
  return { seeded: n };
}

// ---------- 入口 ----------
exports.main = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: CORS, body: "" };

  const path = String(event.path || event.requestContext?.path || "").replace(/\/kb\/?/, "").replace(/^\//, "");
  const method = (event.httpMethod || "POST").toUpperCase();
  const headers = event.headers || {};

  try {
    if (method === "GET" && (path === "" || path === "list")) {
      const items = await listItems(false);
      return json(200, { items, total: items.length, generatedAt: new Date().toISOString() });
    }

    if (method === "GET" && path === "health") {
      await ensureSchema();
      return json(200, { ok: true, env: ENV });
    }

    // 管理端要看全部条目（含已下架）。GET 也放行，凭 x-admin-token 鉴权。
    if (method === "GET" && path === "all") {
      const denied = requireAdmin(headers);
      if (denied) return denied;
      return json(200, { items: await listItems(true), total: (await listItems(true)).length });
    }

    if (method === "POST") {
      const denied = requireAdmin(headers);
      if (denied) return denied;

      let body = event.body || "{}";
      if (event.isBase64Encoded) body = Buffer.from(body, "base64").toString("utf8");
      const payload = typeof body === "string" ? JSON.parse(body || "{}") : body;

      if (path === "admin" || path === "" || path === "list") {
        const { action, item, id, status, items } = payload;
        if (action === "ping") return json(200, { ok: true });
        if (action === "upsert" && item) return json(200, await upsert(item));
        if (action === "seed" && items) return json(200, await seed(items));
        if ((action === "status" || action === "toggle") && id) {
          return json(200, await setStatus(id, status || "online"));
        }
        if (action === "offline" && id) return json(200, await setStatus(id, "offline"));
        if (action === "online" && id) return json(200, await setStatus(id, "online"));
        if (action === "delete" && id) return json(200, await remove(id));
      }

      return json(400, { error: `不支持的操作：${method} /${path}` });
    }

    return json(405, { error: "只支持 GET / POST" });
  } catch (e) {
    return json(500, { error: e?.message || "知识库服务内部错误" });
  }
};
