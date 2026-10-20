# OC_Radar 产品 / UX 审计（2026-10-20）

> 目标：个人自部署的 **OpenRouter 模型、Provider、价格变化监控 + 订阅提醒**。不是 API 网关、购买/支付平台、模型聊天平台或基准测试网站。

## 调研依据

- [OpenRouter 模型目录](https://openrouter.ai/models)：顶部轻导航、搜索/排序、模态分类、左侧高级筛选、列表数据行和模型详情。
- [OpenRouter Providers](https://openrouter.ai/providers)：服务商维度比对。
- [OpenRouter 模型 API](https://openrouter.ai/docs/api/api-reference/models/get-models)：支持全文搜索、价格、上下文长度、Provider、模态、能力等多维过滤。
- 本仓库：Hono API、React 界面、D1 表结构、Durable Objects 定时器、邮件通知与 CI/CD。

**设计边界**：借鉴布局、密度、信息层级、微交互，不复制上游 logo、商标、图标资源、页面源码、图片和品牌宣传文字。Radar 必须在页面/README 说明「非 OpenRouter 官方服务」。

## 现有能力与建议取舍

| 现有功能 | 判断 | 处理 |
| --- | --- | --- |
| 全站定时采集 / 每小时模型目录、Provider 全量滚动扫描 | 核心，保留 | 明示实际采集时间及覆盖率；不要承诺每条 Provider 恰好 1 小时 |
| 逐 Provider 报价、Decimal 对比、涨跌记录 | 核心，保留 | 把 Provider 报价和最近变更放到模型详情同一屏 |
| 模型、Provider、定价策略、上下文和到期变化 | 有价值，但事件很多 | 预设常用提醒；11 种类型收进高级设置 |
| 邮件验证、密码重置、订阅频率、站内通知 | 订阅必需 | 保留，不引入 OAuth、组织或计费 |
| Radar 的深绿工作台布局、大型雷达 Hero | 视觉噪声 | 替换为紧凑顶栏、空白留白与信息优先 |
| 全站订阅数量作为公开的核心 KPI | 信息价值低 | 从首屏 4 个 KPI 去掉，改为采集覆盖 |
| 首页漂亮却缺少直达模型的可搜索入口 | 路径过长 | 顶部 Models 导航 + / 快捷搜索 |
| 详情中扁平展开 11 种事件 | 认知负担过高 | 默认 5 种常用变化，其余折叠 |
| 单页面选项卡、无可分享模型链接 | 可用性不足 | 增加 #model= 深度链接和分享动作 |
| 模型目录无总量和统一的排序/Provider 过滤 | 核心缺口 | /api/models 返回总量、Provider、价格等，服务端翻页 |
| 历史事件只能显示最新 40–50 条 | 审计用途不足 | /api/events 增加检索、事件类型、服务端翻页 |
| 无模型级历史入口 | 发现流程断裂 | 模型详情显示该模型最近 8 条真实事件 |

## 缺失能力优先级

### P0：数据可信度（下一阶段）

1. **快照健康状态**：在模型详情区分「未采集」「上次成功时间」「过期」「采集失败」。目前仅展示 Endpoint checked_at，服务端 Health 状态仍比较粗；不能把「503 degraded」等同于无状态信息。
2. **端点完整性**：除了全站扫描覆盖率，还应提供每个模型的上游数据完整性与采集失败原因（可公开安全摘要，不泄漏密钥）。
3. **实际历史曲线**：当前 price_events 是*变化事件*，不是持续时序快照，无法据此画忠实的小时价曲线。需设计 D1 历史压缩/留存期，避免无意义的时序膨胀。
4. **上游策略数据标注**：清楚区分基准价、折扣、覆盖规则、按请求/图片等非 token 计费单元，禁止把所有价格映射成 USD/M tokens。
5. **通知幂等与可靠性**：复核重试队列、合并摘要、去重，以及邮件失败时的可观察指标。

### P1：针对监控任务的 UX（迭代）

1. **对比 2–3 个模型的 Provider 报价**：只比较 Radar 真正有的数据，不复制 OpenRouter 的智能榜单。
2. **历史筛选与导出**：按模型、Provider、事件、区间筛选，导出 CSV/JSON；公开 feed 支持分页或游标。
3. **更快的订阅**：支持从价格表一键订阅所选 Provider、编辑现有规则及暂停提醒（目前只支持创建和删除）。
4. **发现变化的上下文**：解释是否为首次采集、是模型级/Provider 级、原始计费维度及数据新鲜度。
5. **订阅送达状态**：订阅列表显示上一次命中、邮件发送情况、下一次摘要时间。

### P2：可选，有需求再做

- 深色模式及用户偏好持久化。
- 模型作者、输入/输出模态、context、价格范围的进一步服务端过滤（前提是快照字段稳定完整）。
- Webhook、Telegram 等额外通知渠道；先验证邮箱与 RSS 是否满足自用。
- 多语言国际化：中文优先，导航目前保留部分 OpenRouter 惯用英文词，正式多语言需要完整词条系统。

## 明确不做

- 聊天 Playground、代理推理请求、用户自己填写 OpenRouter Key。
- Credits、充值、套餐、用量计费和盈利/广告后台。
- OpenRouter 的实时调用量排行榜：Radar 没有其平台级使用量数据，复制排行会误导。
- 人工打分/「最聪明模型」榜单、无数据源的速度/质量比较。
- 复杂组织、RBAC、OAuth/OIDC/SSO、多租户计费；自部署监控产品不需要。
- 大型动效库、3D 雷达、流光动画、不断旋转的加载装饰和无意义的数字滚动。
- 未经许可的数据爬取。官方 API 优先，例外抓取必须遵守上游条款和访问限制。

## 设计验收标准

- 1440 / 1024 / 768 / 390 / 375 px 下目录和详情可操作。
- 所有控件有清晰标签，键盘可达，焦点可见；只做 120–180ms 的 hover / panel state 微交互，并遵循 reduced-motion。
- 排序与筛选为服务端全量数据行为，不能只过滤当前页并伪称全局。
- 真实错误/空态、事件时间与采集时间有不同语义；没有历史就显示没有历史，不用假曲线。
- 访客从任意页面可直接浏览公开数据，登录只作为创建订阅的门槛。
- 不暴露部署者 Key、不在界面要求终端用户填写 Key。
- 执行 CI 的 lint / typecheck / unit tests / prettier / Vite build / Wrangler dry-run；Production 由主分支 GitHub Actions 唯一负责。

## 当前 PR 的范围

本次实现视觉布局、目录服务端过滤/排序/分页、变更流过滤/分页、模型级最近变更和分享链接、11 种事件的渐进展开、首页 KPI 优先级修正。**P0 数据基础建设与 P1/P2 未列入当前 PR 的功能不能当成已完成。**

## Implementation follow-up (2026-10)

The core P0/P1 items are implemented in the monitoring-completeness PR: observed-only sparse history, freshness and error flags, optional pricing metadata inspection, Provider comparison, filtered exports, editable/pausable watches, notification idempotency and retry leases.

P2 browser-local dark mode and a **partial bilingual UI glossary** are implemented. Telegram and signed Webhooks require operator opt-in; no destination is enabled by default. Comprehensive translation coverage, UI visual regression screenshots, and real-world delivery tests with live provider credentials remain operational validation items, not guaranteed by unit tests alone.
