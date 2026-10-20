# OpenRouter Radar UI 设计规范（2026-10 V3）

> 独立产品、OpenRouter 式信息架构。只借鉴目录布局、信息密度、搜索和微交互，**不复制其商标、图像、Logo、站点 CSS/JS 或营销文案**。

## 设计目标

- **价格与变化优先**：产品核心是公开模型和 Provider 的真实快照、价格变化，以及订阅提醒。
- **轻量目录结构**：固定高度的紧凑顶栏，主内容白底，模型页采用 Filter / Models / Details 三段式桌面布局。
- **克制动效**：只使用轻量 hover、focus、状态过渡，不做 3D / 自转雷达 / 大面积跳动数字。
- **源数据诚实**：每个时间戳说明是采集时间还是事件发现时间；不存在快照历史时绝不画虚构曲线。
- **品牌独立**：OpenRouter Radar 是第三方自部署项目，并非官方产品。禁止直接采用 OpenRouter 的品牌资源。

## 颜色 / 字体 / 排版

- 基础 Token 在 web/src/tokens.css；V3 中性浅色主题覆盖在 web/src/router-inspired.css，由 main.tsx 最后引入。
- 页面与面板均采用白/中性色；文字 #22212a，弱文字 #64636c，边框 #e8e7ed。紫色 #6b50c9 用于链接、筛选选中态，黑色用于主要操作；涨跌绿色与红色表达语义。
- 品牌标记为 Radar 自有的抽象图形，不使用上游 OpenRouter logo。基础字体系 Inter / PingFang SC / Noto Sans SC / system-ui。
- 间距 4px 基线；面板圆角 8–10px；正文 12–14px，重点数据 15px+，不用 9px 文案承载关键价格、告警。
- 价格数字采用 tabular-nums，**Token 报价才标记 USD / 1M tokens**，非 Token 价格保持原始单位。
- 能力和故障不能仅用颜色传达：上涨/下降保留文字、事件类型和前后值。

## 布局

1. **全站顶栏**：Logo + 概览、Models、Changes、Watchlist、通知。右侧账号入口在次级工具栏。移动端顶栏导航可横向滑动。
2. **首页**：一句话价值主张，直接进入模型目录；真实 KPI 简洁排布，接着是最近事件和全站采集覆盖。取消无用的雷达装饰。
3. **模型目录**：筛选组件与排序作用于完整服务端数据集。左侧 Filter、中间可滚动模型列表、右侧价格/历史/订阅详情。详情优先报价、再显示最近变化，订阅配置靠后并将不常用的事件类型折叠。
4. **变化事件**：提供模型/Provider 搜索、事件类型筛选、总量及服务端分页。上游故障不能伪装成端点下线。
5. **账户与订阅**：访客无需 Key、无需登录即可浏览；登录只解锁创建规则、通知查看。高风险删除操作二次确认。

## 交互与动效

- 聚焦态 focus-visible 必须明确；选中状态有 aria-current / aria-pressed。
- 桌面支持 / 快速聚焦模型搜索；Escape 退出搜索焦点。表单必须可用键盘完成。
- Hover 仅用细微背景/边框/阴影和最多 180ms 的过渡；页面切换不增加大幅滑动与布局抖动。
- 尊重 prefers-reduced-motion: reduce。
- 异步采集、搜索和通知操作必须体现实际等待、失败、成功、空结果。不能显示「实时」但没有可证实的时间数据。
- 有分享按钮时，必须复制真实可打开的模型链接，剪贴板失败不可报成功。
- 手机页面若列表/详情为上下布局，确保用户点击模型后能到达详情且订阅操作可触达。

## QA 清单

- 1440、1024、768、390、375px 上检查横向溢出、导航可达、模型长 ID 换行、宽表滚动。
- Tab / Shift+Tab、Enter / Space、/ 搜索、Escape、焦点样式与 reduced-motion。
- 首次未同步、全部同步、已过期、上游错误、筛选无结果、未登录、邮件未配置等状态。
- 价格单位、事件发现时间、Provider 检查时间在页面 / RSS / 邮件解释一致。
- Safari、Firefox 与 Chromium 基础测试；无大图与外部前端资产依赖。
- 提交前运行 npm run check，并检查 GitHub Actions 中的 Worker dry-run / 部署 Smoke Test。

详细功能取舍及下一步优先级见 [产品 UX 审计](product-ux-audit.md)。

## 成熟组件优先（Mantine v8）

- 新增交互控件优先使用 `@mantine/core`，包括 Button、Select、TextInput、NumberInput、Checkbox、Pagination、Alert、Modal、Loader；需要防抖时复用 `@mantine/hooks` 的 `useDebouncedValue`。
- 原有页面布局、数据可视化可保留独立样式；不要为表单、弹窗、分页、消息框再重复造原生控件。UI 外观覆写集中在 `web/src/component-library.css`，不要在业务 TSX 中散落行内样式。
- MantineProvider 通过当前用户主题偏好同步 `forceColorScheme`；组件颜色遵守语义（危险操作红色、成功状态绿色、主操作中性色或 violet），且确保暗色对比度。
- 下拉框支持键盘、搜索和清除；空值必须显式映射为 API 所需的空字符串；过滤参数的服务器端语义和数据源单位不能因替换 UI 组件而改变。
- 破坏性操作用 Modal 确认而不是 `window.confirm`；提交按钮呈现真实 `loading`；不能在请求仍失败时把对话框关闭当作成功。
- 搜索需要防抖、忽略过期响应；移动端点选模型后应能直接到达详情；所有交互须尊重 reduced motion。
- 跨页面 UI 组件以同等密度为准：控件高度约 42px，键盘 focus-visible 明确、分隔线低对比、正文和标签不低于 12px（特殊时间/辅助文本除外）。
