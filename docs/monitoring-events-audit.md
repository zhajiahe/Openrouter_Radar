# OC_Radar 监控事件能力审计（2026-10-20）

> 目的：审查事件**是否真实、是否可验证、是否值得通知**。本站只做自部署的中文模型 / Provider 监控、邮件与站内通知、RSS，不做多语言、Telegram、Webhook、推理代理、账单。

## 证据与快照

- 上游：[模型目录 API](https://openrouter.ai/docs/api/api-reference/models/get-models)、[逐模型端点 API](https://openrouter.ai/docs/api/api-reference/endpoints/list-endpoints)、[专用图片模型端点 API](https://openrouter.ai/docs/api/api-reference/images/list-image-model-endpoints)、[ZDR 端点能力 API](https://openrouter.ai/docs/api/api-reference/endpoints/list-endpoints-zdr)。
- 仓库代码：src/openrouter.ts、collector.ts、pricing.ts、phase3.ts、history.ts、delivery.ts、index.ts。
- 生产 D1 **本次检查时**：price_events 共 660 条，model.capability_changed 468 条、price.increased 79、price.decreased 52、model.expiring 20、model.alias_changed 19、model.expiration_changed 19、price.policy_changed 2、endpoint.added 1；另 3 种事件暂为 0。subscription 数量 0，不可据此验证实际邮件提醒投递。
- 468 条能力事件在同一秒内产生，old_price 均为 '{}'，新值为完整的 capabilities JSON。19 条别名与 19 条到期日变化也发生于同一次目录同步。**这是历史字段填充，不应展示为真正变化**。
- 价格维度中的 discount 产生过 7 条“降价”记录；折扣值的下降并不等于最终计费额下降。此类变化应归类为定价规则变化。
- 采集队列 470 个模型，检查时 last_success>0 为 278、last_error 非空为 27；其余未形成 post-upgrade 成功标记。该快照不是持续的全量覆盖保证。

## 事件完整矩阵

| Event kind | 目前检测的信号和来源 | 可靠性/问题 | 处理 |
| --- | --- | --- | --- |
| price.increased | 模型目录总价与 Provider Endpoint 的已知数值价格字段上升 | 高（真实 USD 单位且两次成功快照）；0→正值变化率未知 | 保留；只对确认的货币字段产生方向事件 |
| price.decreased | 同上，数值下降 | 高，但不能用 discount 变化冒充最终降价 | 保留；discount 改为 policy_changed |
| price.policy_changed | 非 token 附加费的增加/删除、overrides 动态定价等 | 中；不是最终账单，缓存/图片/按请求单位不同 | 保留，显示字段、原始单位，非金额策略只给策略事件 |
| endpoint.added | 成功获取的 Provider 端点 ID 首次出现（非模型初次扫描） | 中；tag/name/quantization/service_tier 变化可能改变哈希 ID | 保留；将端点身份稳定性列入 P0 |
| endpoint.removed | 同一模型中端点连续两次成功非空快照未出现 | 中；成功时可以判定，失败/空列表不能判定 | 保留，不能把 HTTP 404/429 直接当下线 |
| endpoint.restored | 以前被确认下线的端点重新出现 | 中；同一个哈希身份才能恢复，身份字段变化会拆成新端点 | 保留 |
| model.context_changed | 上下文长度变更（目录） | 高/中；初次空值补齐不能当变化 | 保留；抑制未知→已知的基线噪声 |
| model.capability_changed | architecture、supported_parameters 的规范化 diff | 中；原始架构对象嵌套排序需全面测试；迁移曾制造 468 条噪声 | 保留，但初次 '{}'/空占位→完整元数据不能触发变更 |
| model.alias_changed | alias_target slug 的变更 | 中；对象或字符串形式已规范化；旧 NULL 值可能是历史数据空缺 | 保留、空值补齐不触发变更 |
| model.expiration_changed | expiration_date 的变更 | 中；空值、字符串/时间戳格式归一化 | 保留；空值补齐不触发变更 |
| model.expiring | 到期日期进入 30 / 7 / 1 天范围 | 中；基于当前元数据与扫描时刻，不是上游主动通知 | 保留；按模型 ID + 到期日 + 窗口幂等 |

这些 11 种事件是**类型定义**，不意味着每一种在生产数据中都已经发生，也不意味着通知曾送达。

## 已处理的可靠性问题（当前 PR）

1. **事件分类**：为 price_events 增加 quality（observed / baseline_noise）。历史初始化数据保留审计，但首页、事件列表、RSS、默认导出和订阅匹配只使用 observed。
2. **存量事件校正**：将曾归类为涨跌的 discount 改作 price.policy_changed，并撤销其 change_pct，保留旧值和新值。
3. **新增事件质量门槛**：从 '{}' 或历史未知字段得到第一次完整元数据，不再制造 model.capability_changed / alias_changed / expiration_changed 等变化事件。
4. **未知计费字段**：没有确认过的价格字段，即使是数字，也只产生 price.policy_changed。防止把折扣率、税率或自定义策略参数误当 USD 单价。
5. **缩小产品范围**：移除多语言、Telegram、Webhook UI / API / Worker 调度配置；保留邮件、站内通知、RSS、历史筛选与导出。保留已部署的历史 migration，以免破坏旧数据库的升级链。

## 真正缺失的重要监控能力

### P0：事件可信度和覆盖（优先级最高）

1. **模型加入/下架/恢复**：当前仅能发现端点增删，模型本身新加入只建立基线；目录不再出现的模型仍保留，缺乏 model.added、model.removed、model.restored。要做全量目录快照集合 diff，至少两次独立成功目录采集确认下架，不能因单次 API 异常就下线。
2. **图片模型的实际采集缺口**：专用图片 API 使用 pricing 数组及 unit=image，而当前 Endpoint schema 假设 pricing 为键值对象。应单独适配，不要假设全模型共享 token 单价语义。
3. **端点身份稳定性**：建立 provider + provider_tag + 模型端点 stable key，检查量化类型、service_tier、name/tag 的变化属于身份还是配置，避免伪新增/伪下线。
4. **事件上下文**：保存 source（model aggregate / provider）、计价单位、旧/新值、实际 last_success、检测时刻；明确“发现变化”的时间，不声称上游变更的精确时刻。
5. **生产对账**：每日汇总 last_success、不可达 401/403/429、重复 event、未匹配 event、通知积压。真实电子邮件投递需有可受控的端到端测试。

### P1：减少噪声，增强订阅价值

- **事件去重 / 归并**：一次模型/Provider 同时出现 input + output + cache_read 变化，应允许发送“一条包含三个维度的通知”，而不是三封邮件；同时区分模型聚合价与 Provider 报价，避免重复通知。
- **通知目标**：按“任一 Provider / 指定 Provider / OpenRouter 聚合价”分开规则。现在 provider=null 可能匹配不同来源的同一市场变更。
- **变化过滤**：新增只降价、指定价格字段、绝对金额阈值（目前只有百分比阈值）；0→非零无法计算百分比，不应被阈值误判。
- **订阅规则可观测性**：展示最新命中、最后成功邮件、被抑制的事件数；按真实错误类别解释为何未发送。

### P2：条件满足再考虑

- Provider 延迟、吞吐、uptime / ZDR 等：OpenRouter 有部分当前/窗口数据，但每分钟浮动大，须建立时间窗口、滞回阈值与可接受的数据来源后才设置监控；**不直接按每次浮动发信**。
- 分地域的 Provider 供给、特定缓存费率、批量/长上下文策略：需先确认 API 字段、计费单位与部署成本。
- 性能榜单、token 使用量排名、实际用量/成本：缺少平台级数据或用户调用记录，**不做**。

## 现有采集调度的边界

- Model catalog 每 3600 秒采集一次；Provider job 每 3600 秒后进入待扫描队列，Worker Durable Object 每分钟处理最多 15 模型（可调整至 25），不是所有端点绝对整点完成。
- refreshCatalog 的成功全量列表与 collectModel 的成功且非空 Endpoint 快照可用于变化判定；HTTP/解析失败仅产生采集健康状态，不是模型或 Provider 下线事件。
- event_id 使用随机 UUID（到期事件用确定性 ID），单个 Endpoint 不同维度可在同一次快照产生多条事件；后续对通知层做归并，不应简单删除审计事件。
- price_history 记录观察到的输入/输出报价基线和变动点，保留 180 天。不能据此宣称采集前的历史行情，也不能插值构造每小时数据。

## 结论

**Radar 应优先从“11 类事件”升级为“高置信、可解释、可订阅、可复核的事件系统”。** 下一阶段先做模型上下线、Provider 身份稳定性、图片单价适配和通知归并；其它渠道、英文国际化与模型竞技排名不增加。
