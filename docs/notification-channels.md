# 可选通知渠道（Telegram + 签名 Webhook）

Radar 始终保留邮箱、RSS、站内通知。Telegram 和 Webhook 需要**部署者启用**，用户还须在「账号 → 通知渠道」单独同意。

## Telegram

1. 部署者通过 Telegram BotFather 创建机器人，获得 Bot Token，存入 GitHub Actions Secret **TELEGRAM_BOT_TOKEN**。deploy.yml 将它作为 Worker Secret 上传，不会给浏览器。
2. 订阅用户先与该机器人开始聊天，找到 Chat ID 并输入 Radar 账号页。
3. Radar 发 6 位验证码到 Chat，有效期十分钟。用户验证后才接收提醒；每小时最多申请 4 次，每组验证码最多尝试 5 次。
4. 用户可以随时解除绑定；未发送通知将被抑制。

Telegram 不提供 Radar 用户身份的自动映射，验证码是 Chat ID 控制权确认。不能在网页要求用户输入 Telegram Bot Token。

## 签名 Webhook

1. 部署者在 GitHub Actions Variables 配置 **WEBHOOK_ALLOWED_HOSTS**，例如 alerts.example.com,api.example.com。默认为空，完全关闭。**不支持通配符**。
2. 用户在 Radar 填入 HTTPS Webhook URL。只接受白名单精确主机、443 端口、无 URL 用户信息和 fragment；拒绝 IP literal、localhost、任意重定向。
3. Radar 生成随机 HMAC 密钥，只显示一次。接收端以密钥验证 X-Radar-Signature: sha256=hex；利用 X-Radar-Delivery 作为幂等去重键。
4. 消息体为模型、Provider、变更类型、前后值、观测时间等 JSON。Webhook 返回非 2xx 时指数退避，最多 5 次尝试。
5. 改动 URL 会轮换密钥，关闭后未发送通知被抑制。

**SSRF 防护与局限**：允许主机名必须由实例运营者配置且自己控制 DNS。Worker 没有再对解析后的内网 IP 进行 DNS 层检验；因此不能把用户自定义域名接入白名单当作完全安全的 SSRF 沙盒。千万不要把白名单开放给不受信任的注册用户自行编辑。

## 可靠性与数据保护

- 价格变化事件和全量采集仍独立于订阅；新渠道不会触发额外 OpenRouter 采集。
- 每个新通知按已启用的渠道生成独立排队记录，状态为 pending / sending / sent / failed / suppressed。
- 发送前占用队列，崩溃后能按租期恢复。Resend 邮件有幂等键；Telegram 和 Webhook 是**至少一次投递**，网络超时后仍可能重复，接收端应按 Delivery ID 去重。
- 默认不补发用户绑定渠道之前的历史消息。停用渠道不会影响邮箱和站内通知。
- 不在公开端点泄漏 Telegram Bot Token、Webhook 目标 URL 或签名密钥；发送错误仅记录安全摘要。
- Telegram 与 Webhook 可选且默认关闭。不配置它们不影响核心功能部署。

## 已登录 API

| Method | Path | Purpose |
| --- | --- | --- |
| GET | /api/channels/ | 当前渠道与可用性，不返回完整 webhook URL |
| POST | /api/channels/telegram/start | chat_id，请求验证 |
| POST | /api/channels/telegram/confirm | code，验证绑定 |
| DELETE | /api/channels/telegram | 解除绑定 |
| POST | /api/channels/webhook | url，返回一次性签名密钥 |
| DELETE | /api/channels/webhook | 关闭并抑制待发 |

所有用户均无需填写个人 OpenRouter API Key。本项目不是 OpenRouter 官方产品，不做推理代理或计费。
