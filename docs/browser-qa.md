# 浏览器视觉回归与移动端验收

此仓库对 React + Vite 前端使用 Playwright **真实 Chromium**，验证 375、390、768、1024、1440px 视口。测试使用固定 API 响应，不访问生产用户数据，不触发邮件或变更订阅规则。

## 运行

```bash
npm install
npx playwright install chromium
npm run test:visual
```

脚本会启动本地 Vite（127.0.0.1:4173），独立拦截 `/api/**` 并返回确定性模型、Provider、事件、图片计费和历史点。无需本地 D1、Cloudflare Token 或 OpenRouter Key。

## 自动门禁

- 首页：市场趋势与图表容器可见、深色模式能切换，捕获未处理的浏览器异常。
- 模型目录：长 ID 不使整个页面横向溢出；筛选结果来自 mock 的完整响应；Provider 报价按表格容器局部滚动。
- 模型详情：真实价格历史、采集状态与时间、Provider 表格、图片计费单位及详情跳转可用。
- 变化事件 / 账户：导航可达、事件明细正常呈现，未登录时可访问账户表单。
- 视口：每页断言 `documentElement.scrollWidth` 和 `body.scrollWidth` 未超过当前视口（允许 2px 浏览器误差）。
- 在这五个视口下分别保存首页明暗模式、目录、模型详情、变化事件、账户截图，另外在 390 / 1440px 保存图片模型详情。

PR 触发的 `Browser Visual QA` 工作流会签出 `main` 作为基准，使用相同 mock 和浏览器渲染基线截图；然后测试 PR 代码，并对等尺寸截图执行像素差异统计。**像素变化报告是评审辅助项，不会把所有产品设计变更视为测试失败。** 页面横向溢出、主要流程失效或 JavaScript 崩溃为 CI 阻断项。

GitHub Actions Artifacts 存储 `artifacts/current/`、`artifacts/baseline/`、`artifacts/diff/`、`artifacts/visual-diff.md`、Playwright trace 与 HTML 报告，保留 14 天。

## 人工验收事项

自动化不替代真实视觉评审。每轮修改都应检查：导航滑动与安全区、可触达的主要按钮、筛选项弹出层遮挡、长模型 ID 换行、表格右边缘、图表提示和焦点、暗色主题对比度、浏览器缩放 200%、`prefers-reduced-motion`，以及 iOS Safari / Android Chrome 的实际触控操作。

**范围说明：** 当前测试验证运行中的本地 PR 构建和确定性数据，不代表生产接口可用性、邮件到达率、移动 Safari 兼容性或远程 Cloudflare 部署已经被验证。线上部署仍由独立的 GitHub Actions Smoke Test 负责。
