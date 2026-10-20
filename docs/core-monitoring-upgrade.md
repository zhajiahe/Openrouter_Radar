# 核心事件升级：模型生命周期、端点身份、图片计费和邮件归并

## 目录来源与可靠性

- 普通模型使用 GET /api/v1/models；独立图片模型使用 GET /api/v1/images/models。每种目录有自己的 sync_state 成功同步时间，避免一种接口失败导致另一种类型错误下架。
- 首次成功目录同步只建立基线。后续扫描的新模型产生 model.added。
- 连续两次**成功且通过异常规模检测**的同源目录未出现模型，才产生 model.removed。若成功目录数量低于此前活跃数量的 80%（且已有至少 10 个活跃模型），暂不推断下架，并标记目录错误。再次出现产生 model.restored。所有事件发生时间是 Radar 发现时间，不是上游真实发布时间。
- 下架模型保留在历史数据库和查询中，并暂时退出 Provider 定期采集。订阅下架模型的规则依然可以接收恢复事件。
- 模型预计到期（model.expiring）只在官方 expiration_date 存在时触发 30/7/1 天的提前预警，不代表下架。默认订阅不勾选，属高级可选事件。

## Provider 端点 ID

- 优先使用稳定的 provider_slug/name 与 provider_tag/tag 组合；不把显示名称、量化精度、service_tier 视为端点身份。
- 兼容旧数据库：以 provider+tag 寻找历史端点并复用原 ID，保留 price_events、price_history 的外键和价格历史。
- 若旧逻辑为同一 provider/tag 创建了多个 ID，冗余 ID 标记为 superseded，不产生虚假的下线事件。
- 注意：当上游不提供稳定 tag 且同一 provider 有多个未区分的端点，存在合并风险。此时应扩展更可信的稳定标识，不宜用经常变化的 name 替代。

## 专用图片计价

- 图片目录、逐图片模型 Provider 接口和普通文本 API 是独立数据源。
- 图片定价为 [{billable,unit,cost_usd,...conditions}]；按 **billable + unit + 所有其他条件** 配对。仅成本金额变化发 image.price_increased / image.price_decreased；计费项目增删、单位或条件改变发 image.price_policy_changed。
- 例如从 USD/image 改为 USD/megapixel **不能比较为百分比降价**。图片计费详情保留原始结构，UI 不再伪装为 USD/百万 Token。
- 图片价格详情独立存入 endpoints.pricing_json.image_pricing，不写入只支持 input/output token 价格的 price_history 表。历史价格事件在 price_events 仍可查询。

## 多维事件邮件

- 某次端点成功扫描生成的输入、输出、缓存或图片计价变更共用 snapshot_id。
- 每条规则仍逐维匹配价格涨跌阈值；站内通知逐条保留审计信息。**邮件只对同一用户、同一订阅、同一端点和同一扫描的事件归并为一封**。不同扫描、不同订阅互不误合并。
- 即时邮件有 120 秒的归并等待窗口；每日摘要仍按用户每日聚合。使用原有重试/租约/邮件幂等键，降低重复发送风险，但不承诺在不可控外部邮件系统中实现 exactly-once。

## 本次验收与保留边界

- 单元测试覆盖模型两次下架确认和恢复、Provider 稳定 ID、图片金额/单位/条件变化、多维邮件归并。
- 必须通过 lint、typecheck、tests、format:check、Vite build、D1 迁移验证和 Cloudflare Worker dry-run。
- 真正 OpenRouter 上游波动与 Resend 送达需运营者的有效配额和订阅记录验证；无法通过单元测试假称已经送达。
