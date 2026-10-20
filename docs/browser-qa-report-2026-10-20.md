# 2026-10-20 浏览器与移动端验收结果

关联：[PR #30](https://github.com/zhajiahe/Openrouter_Radar/pull/30) · [最终 Chromium workflow](https://github.com/zhajiahe/Openrouter_Radar/actions/runs/39362937922)

## 验收事实

- **CI**：TypeScript、lint、单元测试、格式、前端构建、D1 本地迁移及 Wrangler dry-run 通过。
- **真实浏览器**：GitHub Actions 的 Linux Chromium 运行 20 项场景（其中 2 项使用 `isMobile + hasTouch + 2× DPR`），所有测试通过；不依赖生产 API 或部署者密钥。
- **尺寸**：375、390、768、1024、1440px。所有测试页的 `documentElement.scrollWidth` / `body.scrollWidth` 未超过视口 + 2px。
- **功能覆盖**：导航可达、模型搜索与详情、Provider 表格、真实 Token 和图片计费历史、事件与账户表单、深色模式、触控模型定位、筛选展开、/ 快捷键与 Escape。
- **截图**：PR 当前版本共生成 38 张截图，与 main 参考版截图按同一 mock 与 Chromium 比较；差异及图片保存在 Workflow Artifact（保留 14 天）。

## 从实际截图发现并修复的问题

| 问题 | 修复 | 可观察变化 |
| --- | --- | --- |
| 手机模型筛选默认展开，用户需要滑动很久才能看到结果 | 手机端高级筛选改为可访问的 Disclosure，默认折叠，已选过滤数量仍显示 | 390px 模型目录整页高度从 1982px 降到 1186px（约减少 40%） |
| 模型未选中时，详情空态在手机占据过高位置 | 只在手机收紧空态与详情区域高度 | 390px 选中模型后的页面总高度从 3404px 降到 2899px |
| 手机顶部导航只有部分标签可见，用户不容易发现可以横向滑动 | 增加向右/向左的导航滚动按钮（保留手势横滑） | 新触控用例通过导航翻页并进入通知/模型页 |
| 事件和报价表格横向滚动没有提示 | 手机宽表增加“向左滑动查看更多”的辅助文字 | 能看到滚动提示，表格内部滚动不导致整页横向溢出 |

## 仍需要真实设备验证

- **iOS Safari 和 Android Chrome** 上的手势、状态栏安全区、页面缩放与输入法软键盘行为。
- 更严格的 WCAG 对比度 / 屏幕阅读器语义审核。
- 生产 Cloudflare Worker 真实实时数据、发送邮件与登录后的高权限操作（此轮全部 mock，不做破坏性线上测试）。

**结论：** 当前 PR 已通过 Chromium 本地页面、五尺寸和触控模拟门禁；未把“浏览器模拟通过”解释为“所有真机和生产环境完全验收”。
