# OpenRouter Radar

> 开源、自托管、无用户 API Key 的 OpenRouter 模型价格监控与邮件订阅平台。

[English](#english) · [Deployment](docs/deployment.md) · [API](docs/api.md) · [Security](SECURITY.md)

**后端：Hono + TypeScript + Cloudflare Workers + D1 + Durable Objects。前端：React + Vite。**

**绝不要求注册用户填写 OpenRouter API Key，也不包含模型调用代理、调用计费、账单或成本计算。** Radar 只采集公开报价元数据，帮助用户关注模型与 Provider，订阅涨价、降价和端点变化。

## 功能

- **Phase 0 / 上游协议**：基于公开 `/api/v1/models` 与 `/api/v1/models/{author}/{slug}/endpoints` 接口；Zod 校验上游响应；保留原始计费字段；Decimal 精确对比输入、输出 Token 报价。
- **Phase 1 / 基础监控**：定时同步模型目录；只对被订阅的模型采集 Provider Endpoint；首次采集建立基准；记录涨跌、Provider 新增、端点消失（连续两次成功响应确认）及恢复事件；公开历史动态与 RSS。
- **Phase 2 / 公开订阅**：邮箱+密码注册、验证邮箱、登录、重置密码、个人订阅规则、可选 Provider 过滤、变化百分比阈值、即时邮件 / 每日摘要、站内通知、邮件重试、用户隔离及简单反滥用限额。
- **部署与运维**：单 Worker + D1，15 分钟 Durable Object Alarm；Hono API；仪表板、健康检查、CI 与开源部署说明。

全站用户共享一套上游数据采集。**任意用户都不需要在 Web UI 填写任何 Key**；运营者自行配置邮件发送服务的后台凭证。

## 快速部署

参见 [自部署指南](docs/deployment.md)。需要 Cloudflare 账号、已验证的邮件发送域名以及一个用于发送邮件的 Resend API Key（**仅管理员配置为 Cloudflare Secret**）。

```bash
npm install
npx wrangler d1 create openrouter-radar
# 将返回的 database_id 写入 wrangler.jsonc
npx wrangler d1 migrations apply DB --remote
npx wrangler secret put RESEND_API_KEY
# 将 APP_ORIGIN 和 MAIL_FROM 改为自己的生产域名
npm run deploy
```

首次模型目录同步在第一次页面打开触发调度器后启动；部署完成后最多等到下一次定时触发。不要手动修改或删掉生产库的 migration 历史。

### 本地开发

```bash
npm install
npx wrangler d1 migrations apply DB --local
npm run build
npm run dev
# 测试：npm run check
```

前端独立热更新：一个终端运行 `npm run dev`，另一个运行 `npx vite --config web/vite.config.ts`，通过 Vite 默认端口打开，`/api` 代理至 8787。

## 使用范围与已知限制

- **不是毫秒级实时行情**：Cron 每 15 分钟触发，已订阅模型默认至少每小时抓取一次；目录每 6 小时同步一次。界面显示采集时间，数据源可能暂时过期。
- **首次采集不产生价格变更事件**：所有历史始于部署后的首次采集。上游模型价可能包含限时动态 `overrides`；首版比较的是基础 `prompt` / `completion` 报价，暂不把时段优惠建模为价格变更。
- **不支持基于用户实际调用量的计费分析**。
- **仅监控模型/Provider 元数据**，不代理推理请求、不存储用户聊天。
- **上游 API 可能调整公开访问政策**；若元数据接口出现鉴权错误，采集显示错误并保留最后成功快照，绝不要求注册用户提交密钥。
- **通知只在邮件发送服务配置后可用**；为避免滥用，未配置发送服务时禁止注册。站内通知与邮件状态保持同步。
- **公开服务需运营者维护**：配置真实的 `APP_ORIGIN`、域名、发信服务和反滥用措施。对大量公众用户还应加 Cloudflare Turnstile / WAF。

## 架构

```text
OpenRouter public API -> 15m DO alarm -> model catalogue (6h)
                              |-> subscribed models -> endpoint snapshots
                              |-> decimal price diff -> immutable events
                              |-> subscription rules -> notifications -> Resend
React UI -> Hono routes -> D1 (auth + models + endpoints + rules + events)
```

对外接口见 [API 文档](docs/api.md)，本项目遵循仓库现有 [Apache-2.0 LICENSE](LICENSE)。

## English

OpenRouter Radar is a **self-hosted, open-source model/provider price monitoring and subscription service** built with Hono, Cloudflare Workers and D1. It has an open email/password sign-up flow with email verification, model catalogue, per-provider endpoint snapshots, price change history, RSS, in-app notices and email notifications. No end-user OpenRouter API key is required. No inference proxy, billing, usage accounting or cost calculator is included.

See [deployment](docs/deployment.md) for setup and [security](SECURITY.md) for responsible disclosure.
