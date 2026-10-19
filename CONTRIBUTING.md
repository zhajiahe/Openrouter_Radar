# 贡献指南

感谢参与 OpenRouter Radar。项目聚焦**模型 / Provider 元数据监控与通知**，不做推理代理、账单、计费分析或面向终端用户的 API Key 管理。

## 开发流程

使用 Node.js 22+ 和 npm。Fork 后新建功能分支，进行最小范围修改，再创建 Pull Request。

```bash
npm install
npm run lint
npm run typecheck
npm test
npm run format:check
npm run build
npx wrangler d1 migrations apply DB --local
npx wrangler deploy --dry-run
```

也可以运行 `npm run check` 执行核心质量门禁。开发时使用 `npm run format` 对源代码和文档应用 Prettier；目前历史代码存在压缩排版，自动格式化全仓可能产生较大 diff。CI 的 `format:check` 先覆盖新增规范/配置文件，旧代码由独立 PR 逐步迁移。

## 代码与测试

- TypeScript 保持严格类型检查。新增代码避免 `any`；已有 `any` 和未使用声明以 ESLint warning 跟踪，后续逐步清理。
- Hono API 输入需要验证，鉴权与用户隔离不允许回退；错误不能泄露密钥、Cookie、邮箱或内部调用栈。
- OpenRouter Key 仅存 Cloudflare Worker Secret，永远不发往浏览器、不记录日志。
- 更新采集 / 价格语义时添加回归测试。首次快照不是价格变化；401/403/429 或上游异常不能被误报成下线。
- D1 migration 只增量追加，不改写已经部署的历史迁移；变更需记录回滚 / 恢复思路。
- UI 改动遵守 [UI 设计规范](docs/ui-design.md)，包括设计 Token、可访问性、响应式和状态准确性。
- 不接入未经授权的 HTML 抓取，不通过爬虫绕过上游访问限制。

## 自动化

Pull Request 与 `main` push 执行 ESLint、TypeScript、Node 测试、格式门禁、Vite build、D1 本地迁移及 Wrangler dry-run。依赖审计作为建议性报告，不阻止因上游审计服务不可用导致的正常开发。生产部署仅由已有部署流程在 `main` 更新时触发；不在 PR 中使用生产凭证。

提交 PR 时描述动机、关键改动、验证结果、UI 截图（如涉及视觉）和对部署 / Migration 的影响。敏感漏洞请参阅 [SECURITY.md](SECURITY.md)，不要直接提交公开 Issue。
