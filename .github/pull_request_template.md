## 变更摘要

<!-- 描述目的、解决的问题及主要变化 -->

## 验证

- [ ] `npm run check`
- [ ] `npx wrangler d1 migrations apply DB --local`
- [ ] `npx wrangler deploy --dry-run`
- [ ] 若涉及 UI：桌面 / 手机、键盘导航、空态 / 错误态检查

## 风险与兼容性

- [ ] 未提交 API Key、Cookie、凭证或生产个人数据
- [ ] 若涉及 D1：使用新的追加迁移，未修改历史迁移
- [ ] 若涉及上游采集：遵守 API/许可边界，不把失败误报为价格变化
- [ ] 若涉及 UI：遵守 [设计规范](../../docs/ui-design.md)，附相关截图 / 说明
