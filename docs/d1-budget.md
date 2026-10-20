# D1 免费额度预算与降本策略

Radar 主要以 **D1 rows read / rows written** 而不是 SQL 请求数计费。Cloudflare Workers Free 当前每天包含 **5,000,000 读取行** 和 **100,000 写入行**，午夜 UTC 重置；超额后 D1 可能拒绝查询。以 Cloudflare 最新文档为准：

- https://developers.cloudflare.com/d1/platform/pricing/
- https://developers.cloudflare.com/d1/platform/limits/
- https://developers.cloudflare.com/d1/observability/metrics-analytics/

## 保护措施

1. 每小时照常从 OpenRouter 获取模型列表；仅当模型属性/报价/生命周期实际变化时写 `models` / 模型聚合 `endpoints`，新增模型才创建 `collection_jobs`。不伪造每小时历史点。
2. Provider 检查一次读取该模型全部已知端点，匹配旧快照时不再对每个端点发起单独 SELECT。Provider 报价未变化不更新 `endpoints`；每次扫描仅更新一次 `collection_jobs` 以保留真实采集时间和结果。因为扫描由单个 Durable Object 串行调度，不再对每个任务重复修改 D1 租约。
3. 每分钟只查待扫描任务、待匹配事件和待投递通知。到期提醒、会话/令牌/速率限制清理和 180 天历史裁剪移至每 UTC 日一次（由 DO storage 保存运行水位，失败会重试）。
4. 为待匹配事件和价格历史裁剪增加针对性索引；同一模型同批事件复用订阅列表。邮件多条状态变更合并提交，失败时直接在 SQL 中递增重试计数。
5. 仅允许匿名公开数据 API 进入 Cache API：目录、模型详情、Provider、统计、事件、分析及价格历史。TTL 60–300 秒；任意携带 Cookie/Authorization 的请求都不读写共享缓存。健康检查、注册登录、通知及订阅永不缓存。缓存是边缘区域本地的，首次访问或缓存失效仍会访问 D1。

## 配额估算和观测

默认每分钟扫描最多 15 个模型，理论最多每天 **21,600 次模型 Provider 扫描**（实际受模型冷却时间、API 超时和模型数量制约）。每次成功扫描保留一次任务状态写；如果任务行有 `last_checked` 索引，相关索引写入也占行额度。目录及端点未变动的数据不再额外写入。实际读写还取决于用户流量、订阅事件、索引写入和首次导入数量，因此 **不能保证任意规模实例绝不超额**。

请在 Cloudflare Dashboard → D1 → Metrics → Row Metrics 观察 `Rows read` / `Rows written`，对照 24 小时趋势。必要时降低 `MAX_MODELS_PER_TICK`（不会影响目录每小时拉取，但可能使所有 Provider 扫描周期超过一小时），或升级 Workers Paid。不要误把 `DB.batch()` 当作减少计费行数：它减少往返而不是实际读取/写入行数。

**部署说明：** 本次新增索引迁移 `0009_d1_budget_indexes.sql`，由已有 GitHub Actions 部署流程自动执行。首次迁移创建索引会消耗一次性的 D1 操作和存储。首次目录导入仍不可避免产生大量新增行。
