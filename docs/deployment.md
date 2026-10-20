# Cloudflare Workers + D1 部署

## 运行前提

1. Cloudflare 账号及 `wrangler login`。
2. Node.js 22+，npm。
3. 已验证发信域名的 [Resend](https://resend.com/) 发送权限。仅实例运营者持有 Resend Key。
4. 使用 HTTPS 的公开域名（正式注册验证邮件使用）。
5. 部署者自己的 OpenRouter API Key，必须保存为 Cloudflare Secret。

部署者必须提供自己的 OpenRouter API Key；注册用户不需要填 Key。拥有 Key 不意味着获得任意 HTML 抓取或数据再分发许可。官方 API 发生 401/403/429 错误时不会自动启用网页抓取。

## 1. 创建数据库

```bash
npm install
npx wrangler login
npx wrangler d1 create openrouter-radar
```

编辑 `wrangler.jsonc` 里 `database_id`，使用创建数据库命令返回的真实 UUID。不要保留 `REPLACE_WITH_YOUR_D1_DATABASE_ID`。

## 2. 配置域名、环境变量、机密

在 `wrangler.jsonc` 的 `vars` 中修改：

- `APP_ORIGIN`：`https://radar.example.com`（必须和生产域名一致，验证与重置邮件都使用它）。
- `MAIL_FROM`：Resend 已验证域名的发信身份，例如 `Radar <radar@example.com>`。
- `OPEN_SIGNUP`：默认 `true`，公开注册。如不希望开放则设为 `false`。
- `MAX_MODELS_PER_TICK`：单次定时执行的全量 Provider 模型批次，1–25，默认 15；不随订阅数量变化。
- `ratelimits`：Wrangler 配置中包含 5 组 Workers 原生边缘限流（登录等认证请求、账号身份、公开查询、昂贵查询、写入操作），各自使用独立数字 namespace。部署多个实例时需确保在相同 Cloudflare 账号内不要意外共享 namespace。

机密配置（千万不要放在 `vars` 或提交仓库）：

```bash
npx wrangler secret put OPENROUTER_API_KEY
npx wrangler secret put RESEND_API_KEY
```

把 `APP_ORIGIN` 的域名绑定到 Worker。浏览器 Cookie 基于实际 HTTPS 协议使用 Secure。

## 3. 迁移并部署

```bash
npx wrangler d1 migrations apply DB --remote
npm run deploy
```

应用从第一次访问（例如 /api/health）启动 Durable Object Alarm 后同步模型目录，后续每小时同步一次目录，Provider 全量滚动扫描。用户能搜索模型后即可注册并订阅。*自定义域名与 DNS 配置在 Cloudflare Dashboard 中完成*。

## 4. 运行状况

- `GET /api/health`：模型总数、目录同步时间及最近上游错误。首次同步前返回 HTTP 503 degraded。
- `GET /api/stats`：全站公开统计。
- `GET /api/events`：公开价格事件。
- `GET /feed.xml`：RSS。
- Cloudflare Workers 日志用于查看 Durable Object Alarm 或 Resend 错误；不应输出用户密码或认证 Token。

> 注意：Workers Free 有 CPU、请求和 D1 行读写限制。全量扫描的上游 API 调用量约为每小时模型数 + 1，与订阅用户数无关。默认每分钟最多 15 个 Provider 请求，理论扫描容量约 900 模型/小时；模型更多、响应慢或限流时会出现扫描延迟。Cloudflare 免费计划每次调用最多 50 个外部子请求；达到上游限制时不会删除已有价格，也不会报错成“端点下线”。提升并发前请核实 Cloudflare 当前配额。

## 本地运行

```bash
npm install
npx wrangler d1 migrations apply DB --local
npm run build
npm run dev
```

`wrangler dev` 使用本地 D1；若要实际测试注册，请使用 `.dev.vars` 提供本地测试发信凭证，或部署测试域名。永远不要上传 `.dev.vars`。本地可用 `访问 /api/health 以初始化 Durable Object Alarm（不需要 --test-scheduled）` 触发调度器，查看目录是否同步。

## 个人与公开实例的区别

同一套代码可用一人，也可以开放注册。个人实例设 `OPEN_SIGNUP=false` 会阻止新账号注册，因此至少要在关闭前成功注册并验证你的管理邮箱。当前版本不含可跳过邮箱验证的后台初始管理员，避免产生后门式注册机制。

## 自动化部署

本仓库通过 GitHub Actions 在 `main` 更新后自动部署并执行 D1 迁移。Cloudflare Builds 已断开，避免双重生产发布。详细步骤参见 [GitHub Actions 自部署文档](github-actions-deployment.md)。

## 许可边界

当前仅启用 OpenRouter 官方 API 采集。缺失、不可用或限流的 API 绝不自动回退到 HTML 抓取；如未来实现爬取型补充数据源，必须先获得相关网站许可，并遵守 robots、条款及限流限制。

## 恢复与升级

备份 D1 前先导出数据库并核实恢复计划。升级时先备份，再通过 `d1 migrations apply` 执行新增迁移；代码更新使用 `wrangler deploy`，避免直接修改已有迁移文件。

## 本仓库维护者当前实例（2026-10-19）

- 实例 URL：`https://openrouter-radar.zhajiahe1994.workers.dev`
- D1 名称：`openrouter-radar`；数据库已创建且已执行 `0001_initial.sql`
- 调度：`RadarScheduler` Durable Object Alarm，每 1 分钟；不占用 Workers Free 的 Cron Trigger 名额
- GitHub Actions 已接管 `main` 的自动部署；Cloudflare Builds 不再触发部署
- **目前 `OPEN_SIGNUP=false`**：还未配置实例邮件服务，防止用户注册后无法验证邮箱；不应声称公开注册已可用

### 启用真正的公开注册邮件

在 Cloudflare Workers 的 `openrouter-radar` 项目中：

1. 在 Resend 验证你实际拥有的发信域名。
2. 在 Cloudflare Worker 的 Secrets 中添加 `RESEND_API_KEY`（不要放到 GitHub 或公开配置里）。
3. 将 `wrangler.jsonc` 中的 `MAIL_FROM` 改为已验证的地址。
4. 将 `OPEN_SIGNUP` 设置为 `true`，提交到 `main`，等待 GitHub Actions 部署成功。
5. 用自己的邮箱执行注册、验证、登录、订阅并确认收到测试告警后，再对外公开推广。

公开实例建议启用 Turnstile/WAF、防滥用额度及发信上限。普通订阅者始终无需任何 OpenRouter API Key。

## 防爆破与恶意访问

所有公开 API、RSS、登录与订阅操作都先检查原生 Workers Rate Limiting，再访问 D1。登录、注册、密码重置额外按 SHA-256 摘要的邮箱或重置 Token 限流；密码找回邮件最多两封/小时/已验证地址，阻断后不继续写入 D1。请求超出本地限流将返回 429（附 Retry-After: 60）；限流绑定丢失时返回 503，不允许静默放行。请求体必须是 JSON 且不超过 8 KiB；携带登录 Cookie 的修改操作必须出示同源 Origin 或 Referer。

Workers 限流是**每个 Cloudflare 数据中心本地、最终一致**的，不能完全抵御跨地区分布式攻击，也不会阻止请求进入 Worker 本身。对公开实例建议绑定 Cloudflare 代理的自定义域名，在域名所在 Zone 上启用 WAF 托管规则、Bot 保护，并为 `/api/auth/*` 及高负载 `/api/*` 配置挑战/限流规则。当前 `workers.dev` 域名不应被视为已经具有此类 Zone WAF。

静态资产在 `web/public/_headers` 增加 CSP、X-Frame-Options、nosniff 等响应头。身份验证、强 CSP、边缘限流和 WAF 是多层防护；开启公开注册前仍推荐 Cloudflare Turnstile 和告警。见 [Cloudflare Workers Rate Limiting](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/) 与 [Static Assets headers](https://developers.cloudflare.com/workers/static-assets/headers/)。
