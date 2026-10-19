# Cloudflare Workers + D1 部署

## 运行前提

1. Cloudflare 账号及 `wrangler login`。
2. Node.js 22+，npm。
3. 已验证发信域名的 [Resend](https://resend.com/) 发送权限。仅实例运营者持有 Resend Key。
4. 使用 HTTPS 的公开域名（正式注册验证邮件使用）。

无需注册用户提供 OpenRouter API Key。OpenRouter 的模型目录和 Endpoint 元数据按 2026-10-19 的公开接口访问；如果上游改变策略，会显示采集错误。应提前确认上游的 API 使用政策。

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
- `MAX_MODELS_PER_TICK`：单次定时执行的最大订阅模型处理数量，1–25，默认 10。

机密配置（千万不要放在 `vars` 或提交仓库）：

```bash
npx wrangler secret put RESEND_API_KEY
```

把 `APP_ORIGIN` 的域名绑定到 Worker。浏览器 Cookie 基于实际 HTTPS 协议使用 Secure。

## 3. 迁移并部署

```bash
npx wrangler d1 migrations apply DB --remote
npm run deploy
```

应用从第一次访问（例如 /api/health）启动 Durable Object Alarm 后同步模型目录，后续约每 6 小时一次。用户能搜索模型后即可注册并订阅。*自定义域名与 DNS 配置在 Cloudflare Dashboard 中完成*。

## 4. 运行状况

- `GET /api/health`：模型总数、目录同步时间及最近上游错误。首次同步前返回 HTTP 503 degraded。
- `GET /api/stats`：全站公开统计。
- `GET /api/events`：公开价格事件。
- `GET /feed.xml`：RSS。
- Cloudflare Workers 日志用于查看 Durable Object Alarm 或 Resend 错误；不应输出用户密码或认证 Token。

> 注意：Workers Free 有 CPU、请求和 D1 行读写限制。公共实例按关注模型数量而非注册用户数量进行采集；达到上游限制时不会删除已有价格，也不会报错成“端点下线”。提升并发前请核实 Cloudflare 当前配额。

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

## 恢复与升级

备份 D1 前先导出数据库并核实恢复计划。升级时先备份，再通过 `d1 migrations apply` 执行新增迁移；代码更新使用 `wrangler deploy`，避免直接修改已有迁移文件。

## 本仓库维护者当前实例（2026-10-19）

- 实例 URL：`https://openrouter-radar.zhajiahe1994.workers.dev`
- D1 名称：`openrouter-radar`；数据库已创建且已执行 `0001_initial.sql`
- 调度：`RadarScheduler` Durable Object Alarm，每 15 分钟；不占用 Workers Free 的 Cron Trigger 名额
- Cloudflare Builds 已连接 GitHub `main`，合并或推送后自动构建部署
- **目前 `OPEN_SIGNUP=false`**：还未配置实例邮件服务，防止用户注册后无法验证邮箱；不应声称公开注册已可用

### 启用真正的公开注册邮件

在 Cloudflare Workers 的 `openrouter-radar` 项目中：

1. 在 Resend 验证你实际拥有的发信域名。
2. 在 Cloudflare Worker 的 Secrets 中添加 `RESEND_API_KEY`（不要放到 GitHub 或公开配置里）。
3. 将 `wrangler.jsonc` 中的 `MAIL_FROM` 改为已验证的地址。
4. 将 `OPEN_SIGNUP` 设置为 `true`，提交到 `main`，等待 Cloudflare Builds 成功。
5. 用自己的邮箱执行注册、验证、登录、订阅并确认收到测试告警后，再对外公开推广。

公开实例建议启用 Turnstile/WAF、防滥用额度及发信上限。普通订阅者始终无需任何 OpenRouter API Key。
