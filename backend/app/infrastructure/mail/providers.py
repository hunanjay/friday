"""Preset IMAP/SMTP provider definitions.

Server addresses for known mail providers live here (backend config), not in
the database - mail_accounts.imap_*/smtp_* columns only store CUSTOM overrides.
Adding a new provider is one entry in this dict.

security: "ssl" (implicit TLS, usually port 993/465) or "starttls" (usually 587).
"""

MAIL_PROVIDERS: dict[str, dict] = {
    "netease": {
        "name": "163 邮箱",
        "imap_host": "imap.163.com",
        "imap_port": 993,
        "imap_security": "ssl",
        "smtp_host": "smtp.163.com",
        "smtp_port": 465,
        "smtp_security": "ssl",
    },
    "qq": {
        "name": "QQ 邮箱",
        "imap_host": "imap.qq.com",
        "imap_port": 993,
        "imap_security": "ssl",
        "smtp_host": "smtp.qq.com",
        "smtp_port": 465,
        "smtp_security": "ssl",
    },
    "gmail": {
        "name": "Gmail",
        "imap_host": "imap.gmail.com",
        "imap_port": 993,
        "imap_security": "ssl",
        "smtp_host": "smtp.gmail.com",
        "smtp_port": 465,
        "smtp_security": "ssl",
    },
    "icloud": {
        "name": "iCloud Mail",
        "imap_host": "imap.mail.me.com",
        "imap_port": 993,
        "imap_security": "ssl",
        "smtp_host": "smtp.mail.me.com",
        "smtp_port": 587,
        "smtp_security": "starttls",
    },
    "outlook": {
        "name": "Outlook (IMAP)",
        "imap_host": "outlook.office365.com",
        "imap_port": 993,
        "imap_security": "ssl",
        "smtp_host": "smtp.office365.com",
        "smtp_port": 587,
        "smtp_security": "starttls",
    },
}

CUSTOM_PROVIDER = "custom"


def resolve_provider_settings(provider: str, account_row: dict) -> dict:
    """Merge preset server settings with per-account overrides.

    account_row may carry imap_host/port/security etc. (custom overrides);
    preset values are the default for everything else. Returns a dict with
    imap_host/imap_port/imap_security/smtp_host/smtp_port/smtp_security.
    """
    preset = MAIL_PROVIDERS.get(provider, {})
    settings = {
        "imap_host": preset.get("imap_host"),
        "imap_port": preset.get("imap_port"),
        "imap_security": preset.get("imap_security", "ssl"),
        "smtp_host": preset.get("smtp_host"),
        "smtp_port": preset.get("smtp_port"),
        "smtp_security": preset.get("smtp_security", "ssl"),
    }
    for key in settings:
        override = account_row.get(key)
        if override is not None:
            settings[key] = override
    return settings
