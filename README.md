# OpenRouter Radar

> 个人自部署的 OpenRouter 模型和 Provider 变化雷达。部署者提供 OpenRouter API Key，访客无需填写。

**网站：** [访问在线网站](https://openrouter-radar.zhajiahe1994.workers.dev) · [健康状态](https://openrouter-radar.zhajiahe1994.workers.dev/api/health) · [源代码](https://github.com/zhajiahe/Openrouter_Radar)

[UI 设计规范](docs/ui-design.md) · [浏览器与移动端验收](docs/browser-qa.md) · [产品 / UX 审计](docs/product-ux-audit.md) · [监控事件能力审计](docs/monitoring-events-audit.md) · [贡献指南](CONTRIBUTING.md) · [Deployment](docs/deployment.md) · [API](docs/api.md) · [D1 免费额度预算](docs/d1-budget.md) · [Security](SECURITY.md)

**后端：Hono + TypeScript + Cloudflare Workers + D1 + Durable Objects。前端：React + Vite。** UI 采用 OpenRouter 式紧凑模型目录与筛选信息架构，但保留独立品牌和原创样式。

**部署者须通过 Cloudflare Secret 配置自己的 OpenRouter API Key；访客及注册用户都不必提供。** 不做代理、调用计费或账单分析。Radar 采集官方 API 元数据，帮助用户关注模型与 Provider，订阅涨价、降价和端点变化。

## 功能

- **Phase 0 / 上游协议**：通过部署者密钥读取 `/api/v1/models` 与 `/api/v1/models/{author}/{slug}/endpoints` 接口；Zod 校验上游响应；保留原始计费字段；Decimal 精确对比输入、输出 Token 报价。
- **Phase 1 / 基础监控**：定时同步模型目录；对所有模型采集 Provider Endpoint，不依赖订阅；首次采集建立基准；记录涨跌、Provider 新增、端点消失（连续两次成功响应确认）及恢复事件；公开历史动态与 RSS。
- **Phase 3 / 个人实例**：部署者 API Key、缓存和多维定价策略差异、模型能力及别名变化、30/7/1 天到期提醒、GitHub Actions 自动部署。
- **Phase 2 / 公开订阅**：邮箱+密码注册、验证邮箱、登录、重置密码、个人订阅规则、可选 Provider 过滤、变化百分比阈值、即时邮件 / 每日摘要、站内通知、邮件重试、用户隔离及简单反滥用限额。
- **部署与运维**：单 Worker + D1，1 分钟 Durable Object Alarm；Hono API；仪表板、健康检查、CI 与开源部署说明。

全量模型和 Provider 数据独立于订阅持续采集、生成历史变更事件；订阅只负责筛选事件和发送站内/邮件通知。全站用户共享一套上游数据采集。**任意用户都不需要在 Web UI 填写任何 Key**；运营者在 Cloudflare Secrets 中配置自己的 OpenRouter API Key 和邮件发送凭证。

**实例说明：** 当前公开站点可查看模型目录与历史事件；账号注册及邮件提醒取决于部署者是否启用邮件服务与开放注册。网站是自部署实例，非 OpenRouter 官方服务。

## 新增的监控体验

- 支持模型作者、模态、能力、上下文、最大输入价和 Provider 筛选；对比至多 3 个模型的基础报价（无虚构性能评分）。
- 公开的价格采样历史只记录首次观察与实际变价，并提供模型级采集成功/失败、时效及价格原始计费细节。历史保留 180 天，从首次采集开始。
- 变更历史支持日期和 Provider 筛选、CSV/JSON 导出（每次至多 1000 条）及 RSS 分页。
- 订阅可编辑、暂停/恢复；支持独立的发送失败统计、重试和邮件幂等键。
- 浏览器支持浅色/深色模式，界面采用中文；包含 SVG/ICO favicon、Apple 主屏幕图标、Web Manifest 和独立品牌社交分享卡片。构建时自动生成 PNG/ICO 资源，不使用 OpenRouter 官方素材。
- 监控事件根据**真实观察**与**历史初始化**分别标注：涨跌、定价策略、Provider 端点和模型元数据 11 类事件；详见 [事件审计](docs/monitoring-events-audit.md)。
- 仅保留邮件、站内提醒和 RSS；不引入 Telegram、Webhook 或多语言系统。

## 快速部署

参见 [自部署指南](docs/deployment.md) 和 [GitHub Actions 部署说明](docs/github-actions-deployment.md)。现有实例统一由 **GitHub Actions** 部署：合并到 `main` 自动执行质量检查、D1 迁移及 Worker 发布；Cloudflare Builds 的仓库构建已停用，避免双重部署。需要 Cloudflare 账号、个人 OpenRouter API Key、可用的 D1 数据库，以及用于邮件通知的 Resend Key。

```bash
npm install
npx wrangler d1 create openrouter-radar
# 将返回的 database_id 写入 wrangler.jsonc
npx wrangler d1 migrations apply DB --remote
npx wrangler secret put OPENROUTER_API_KEY
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
# 代码质量：npm run lint；完整检查：npm run check
```

前端独立热更新：一个终端运行 `npm run dev`，另一个运行 `npx vite --config web/vite.config.ts`，通过 Vite 默认端口打开，`/api` 代理至 8787。

## 使用范围与已知限制

- **不是毫秒级实时行情**：Durable Object Alarm 每分钟唤醒、每批默认扫描 15 个模型；全量目录每小时同步，所有模型 Provider Endpoint 按上次采集时间进入每小时滚动采集队列（实际完成时间受模型规模、速率限制和上游可用性影响）。订阅仅负责筛选与通知，不影响采集。界面显示采集时间，数据源可能暂时过期。
- **首次采集不产生价格变更事件**：所有历史始于部署后的首次采集。上游模型价可能包含限时动态 `overrides`；Phase 3 会对比完整的定价规则；已有优惠时段的开始或结束不是定价政策变更。
- **不支持基于用户实际调用量的计费分析**。
- **仅监控模型/Provider 元数据**，不代理推理请求、不存储用户聊天。
- **官方 API 优先**：HTTP 401/403/429 或格式异常只会记录采集错误，并保留已有快照。不会因 API 故障自动转而抓取 HTML；只有获得许可、遵守访问规则的页面数据才能由未来的独立适配器采集。
- **通知只在邮件发送服务配置后可用**；为避免滥用，未配置发送服务时禁止注册。站内通知与邮件状态保持同步。
- **公开服务需运营者维护**：配置真实的 `APP_ORIGIN`、域名、发信服务和反滥用措施。对大量公众用户还应加 Cloudflare Turnstile / WAF。

## 架构

```text
OpenRouter API (instance owner key) -> 1m DO alarm -> model catalogue (1h)
                              |-> all models (batched) -> endpoint snapshots
                              |-> decimal price diff -> immutable events
                              |-> subscription rules -> notifications -> Resend
React UI -> Hono routes -> D1 (auth + models + endpoints + rules + events)
```

对外接口见 [API 文档](docs/api.md)，本项目遵循仓库现有 [Apache-2.0 LICENSE](LICENSE)。



### 计价维度完整性升级
- 支持缓存读取、缓存写入（包括 1h）、推理、图片、音频和按请求/搜索的报价维度，并标注每项 USD 计费单位。
- 图片模型保存每项图片收费基准及真实变价点；历史图采用阶梯线，窗口开始前的真实观察只以原始时间展示。
- D1 升级使用 `0008_price_observations.sql`：复制既有 input/output 历史到可扩展多单位时间序列表，不改写历史时间。其他已有报价等待后续成功扫描才建立新的可信基准。
- OpenRouter 模型目录查询显式选择全部输出模态，图表可按 Provider、价格维度及聚合报价查看；不引入计费网关。


## Provider 价格稳定性与维度化事件
- 模型详情支持按 7/30 天、价格维度比较该模型各 Provider 的**公开报价稳定性**，同时展示变价次数、上涨/下降、历史覆盖及采集新鲜度。无完整窗口基准或采集过期时不输出误导性高分。
- 事件表、模型详情、站内通知、邮件和 RSS 使用「【输入价格】上涨」「【缓存写入（1h）价格】下降」等明确标题；事件编码和已有订阅语义不变。
- **仅是价格稳定指标**，不能据此宣称 Provider 推理服务的可用率、延迟、吞吐或输出质量。真实服务质量需要独立的请求级监测数据源。

## 防爆破和恶意请求

公开 API、登录、注册、密码找回与历史导出首先使用 Cloudflare Workers 原生边缘限流，避免每次失败请求都修改 D1。账号身份独立限流，密码重置邮件有独立的一小时额度；异常大的请求及缺少同源证明的 Cookie 修改操作会被拒绝。静态站点启用 CSP 等浏览器安全响应头。**这些措施不能替代自定义域名上的 Cloudflare WAF，也不承诺抵御分布式 DDoS**。详见 [Security](SECURITY.md) 与 [部署文档](docs/deployment.md)。
