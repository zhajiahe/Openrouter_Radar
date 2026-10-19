# GitHub Actions 部署 OpenRouter Radar

工作流：`.github/workflows/deploy.yml`。本仓库已经连接 **Cloudflare Builds**，默认由 Cloudflare Builds 在 `main` 合并 / 推送后自动部署。为避免一份代码被两套工作流重复部署，**GitHub Actions 的 Deploy job 默认跳过**；PR 仍运行 `.github/workflows/ci.yml`。

如需改为 **GitHub Actions 唯一部署通道**，先在 Cloudflare 后台停用该仓库的自动 Build/Deploy，再在 GitHub Actions Variables 设置 `DEPLOY_VIA_GITHUB_ACTIONS=true` 并提供所需 Secrets。之后 `main` push 自动通过 GitHub Actions 部署；使用 Actions → Deploy Cloudflare Worker → Run workflow 手动触发也会执行（即使变量未启用），但同样需要相应密钥。

## 现有站点与 Fork

当前仓库的 `wrangler.jsonc` 已包含实例所用 Worker 名称、HTTPS URL、D1 database ID 和 Durable Object 调度器配置。**维护现有实例不要重新创建 D1，也不要删除 Durable Object 绑定或其 migrations。**

其他人 Fork 自部署时，须在 `wrangler.jsonc` 中修改 Worker 名称、`database_id`、`APP_ORIGIN` 和 `MAIL_FROM`；数据库可用 `npx wrangler d1 create <your-database-name>` 创建，并保证 `database_name` 和 `database_id` 对应。

## 配置 GitHub Actions Secrets

进入仓库 **Settings → Secrets and variables → Actions**（也可以设置 `production` Environment Secrets）。

| Secret | 是否必需 | 用途 |
| --- | --- | --- |
| `CLOUDFLARE_API_TOKEN` | 必需 | 有 Worker 及 D1 部署权限的 Cloudflare API Token |
| `CLOUDFLARE_ACCOUNT_ID` | 必需 | Cloudflare Account ID |
| `OPENROUTER_API_KEY` | 必需 | 运营者个人 OpenRouter Key，用于所有元数据 API 请求 |
| `RESEND_API_KEY` | 可选 | 邮件通知发送 Key；不填则保留 Cloudflare Worker 已有的同名 Secret（若已配置） |

Workflow 不会读取或输出任何密钥明文，也不会把密钥放在 `wrangler.jsonc` 的 `vars` 或前端变量里。临时 JSON 密钥文件仅在 GitHub Action runner 中生成，在单次部署后删除；Wrangler 通过 `--secrets-file` 与 Worker 版本一同部署，未包含的已有 Secret 会保留。

## 可选 GitHub Actions Variables

| Variable | 作用 |
| --- | --- |
| `D1_DATABASE_ID` | 覆盖 `wrangler.jsonc` 的 D1 UUID；默认使用仓库现有 UUID |
| `APP_ORIGIN` | 覆盖公开的 HTTPS URL；默认使用仓库配置 |
| `MAIL_FROM` | 覆盖邮件发信身份；需要与 Resend 的验证域名一致 |
| `OPEN_SIGNUP` | 覆盖开放注册状态（`true` / `false`）；默认遵循仓库配置 |
| `DEPLOY_VIA_GITHUB_ACTIONS` | 默认不设置（Cloudflare Builds 负责部署）；若迁移到 GitHub Actions 唯一部署通道则设为 `true` |

`OPEN_SIGNUP=false` 只适合已有已验证账号的个人实例。如果还没有账号，应先改为 `true` 完成注册和邮箱验证，再切回 `false`。

## 首次部署

1. 在 GitHub Settings 配齐必需 Secrets，并确认 Cloudflare Token 拥有正确权限。
2. 在 Cloudflare 确认现有 D1 数据库及 Worker；新 Fork 须先创建自己的数据库。
3. 使用项目已配置的 HTTPS URL，准备好 Resend Key 和经验证的 `MAIL_FROM` 才能正常发送邮件。
4. 若使用 **Cloudflare Builds**：合并 PR 至 `main` 即可自动构建，检查 Cloudflare 部署记录。若使用 **GitHub Actions**：先开启 `DEPLOY_VIA_GITHUB_ACTIONS=true`，再推送 `main`，或在 Actions → Deploy Cloudflare Worker → Run workflow 手动触发。
5. 工作流依次完成 `npm run check`、`wrangler d1 migrations apply DB --remote`、`wrangler deploy --secrets-file ...`。
6. 访问站点的 `/api/health` 检查状态。首次扫描由第一次访问健康接口触发 Durable Object Alarm 初始化（此时可能返回 503），之后 Alarm 每 15 分钟唤醒。

## 故障排查

- **Missing required GitHub Actions secret**：确认是 Actions Secrets（而非 Variables），并检查当前 workflow 是否能读取 Environment Secrets。特别是 `CLOUDFLARE_API_TOKEN`、`CLOUDFLARE_ACCOUNT_ID`、`OPENROUTER_API_KEY`；Cloudflare Builds 模式不需要配置这些 GitHub Secrets。
- **Deploy job 为 skipped**：属于默认预期行为；仓库由 Cloudflare Builds 部署。只有将 `DEPLOY_VIA_GITHUB_ACTIONS` 设为 `true` 或手动触发 workflow 才会运行 GitHub 部署。
- **D1 migration failed**：确认 `database_id` 指向已有数据库、Cloudflare Token 权限和 D1 配额，绝不能为了通过 CI 删除旧迁移。
- **OpenRouter 401/403/429**：检查部署者 Key 与 API 访问权限；遵守限流，默认不通过网页抓取绕过。
- **注册失败**：检查 `OPEN_SIGNUP`、已验证的 Resend 邮件发送配置、`MAIL_FROM`、用户邮箱。
- **页面与验证邮件 URL 不一致**：配置 `APP_ORIGIN` 为实际访问的 HTTPS Origin。

## 安全与许可

OpenRouter API Key 仅用于服务端数据采集。已配置密钥不等于获得无限批量采集或网页爬虫权利。当前不开启自动 HTML 回退；任何额外页面采集必须先确认获得许可，遵守网站条款和 robots 约束。
