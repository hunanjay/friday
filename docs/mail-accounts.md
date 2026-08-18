# 绑定第三方邮箱（IMAP + SMTP）

Friday 支持通过 **IMAP（收）+ SMTP（发）** 绑定任意邮箱（163 / QQ / Gmail / iCloud / Outlook 及自定义服务器），与 Microsoft Graph 邮箱并存显示、互不影响。所有邮箱走同一套通用实现，新增邮箱只需在 `backend/app/infrastructure/mail/providers.py` 加一条预设。

## 如何开启 IMAP/SMTP 并获取授权码

各邮箱需先在网页端开启 IMAP/SMTP 服务，生成**授权码**（应用专用密码）。授权码不是登录密码，是邮箱发给第三方客户端用的专用凭证。

### 163 邮箱（网易）

1. 登录 [mail.163.com](https://mail.163.com)
2. **设置 → POP3/SMTP/IMAP**（或"客户端设置"）
3. 开启 **IMAP/SMTP 服务**（需要短信验证）
4. 点击"**新增授权码**"，按提示生成 16 位授权码

服务器（预设，无需手填）：
- IMAP：`imap.163.com:993`（SSL）
- SMTP：`smtp.163.com:465`（SSL）

### QQ 邮箱

1. 登录 [mail.qq.com](https://mail.qq.com)
2. **设置 → 账号**（或"账户"）
3. 找到 **POP3/IMAP/SMTP/Exchange/CardDAV/CalDAV 服务**
4. 开启 **IMAP/SMTP 服务**，按提示发送短信验证
5. 点击"**生成授权码**"

服务器（预设）：
- IMAP：`imap.qq.com:993`（SSL）
- SMTP：`smtp.qq.com:465`（SSL）

### Gmail

1. 登录 Google 账号 → [Google 账户安全设置](https://myaccount.google.com/security)
2. 开启**两步验证**（必须）
3. 搜索并进入"**应用专用密码**"→ 生成 16 位密码

服务器（预设）：
- IMAP：`imap.gmail.com:993`（SSL）
- SMTP：`smtp.gmail.com:465`（SSL）

> ⚠️ Gmail API 在国内网络可能无法直连，需要代理。

### iCloud Mail

1. 登录 [appleid.apple.com](https://appleid.apple.com) → 安全 → 应用专用密码
2. 生成 16 位应用专用密码

服务器（预设）：
- IMAP：`imap.mail.me.com:993`（SSL）
- SMTP：`smtp.mail.me.com:587`（STARTTLS）

### 自定义服务器

选择"自定义服务器"，手填 IMAP/SMTP 主机、端口与安全模式（SSL / STARTTLS / None）。
自定义地址会经过 **SSRF 防护**：内网、环回、云元数据地址（如 `169.254.169.254`）会被拒绝。

## 绑定流程

1. 登录 Friday（Supabase 账号）
2. **登录页**点击"绑定其他邮箱"，或 **设置 → 邮箱账号 → 绑定邮箱**
3. 选择邮箱类型 → 填邮箱地址 + 授权码 →（自定义时填服务器）→ **验证并绑定**
4. 后端会先验证 IMAP 连接（必选）和 SMTP 认证（可选），全部通过才保存

绑定后：

- **Email 页面**：微软邮箱与所有绑定邮箱的邮件**合并显示**（收件箱/已发送/搜索/未读数）
- **写邮件**：顶部"发送账户"下拉选择用哪个邮箱发送
- **设置页**：可查看账号状态、测试连接、解绑

## 安全说明

- 授权码使用 **Fernet 对称加密**（`MAIL_ENCRYPTION_KEY`）后存储，数据库层面（RLS）与加密双层防护
- API 响应永远**脱敏**，不返回授权码
- 解绑时删除整行记录（凭据随行删除）
- 授权码不进日志、不进 URL

## 开发配置

后端需要设置 `MAIL_ENCRYPTION_KEY`（`.env`），生成方式：

```bash
python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
```

> ⚠️ 密钥必须保持稳定；更换后已存凭据将无法解密，需要重新绑定。

## 限制（当前版本）

- IMAP 删除为物理删除（`\Deleted + EXPUNGE`），IMAP 无回收站概念——删除前 UI/AI 会提示
- 跨邮箱的邮件线程不合并（163 回复 QQ 邮件的场景不会归入同一线程）
- IMAP 邮件搜索对中文支持不稳定，后端有降级方案（拉取后本地过滤）
