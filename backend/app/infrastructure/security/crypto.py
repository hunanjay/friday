"""Mail account credential encryption.

Credentials (IMAP/SMTP app passwords, OAuth refresh tokens) are encrypted at
rest with Fernet (AES-128-CBC + HMAC) before touching Supabase. RLS keeps
client roles out, encryption protects against DB-level exposure.

The key comes from MAIL_ENCRYPTION_KEY (base64, 32 bytes) - generate one with:
    python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
It must be stable across restarts or stored credentials become undecryptable.
"""

import os

from cryptography.fernet import Fernet, InvalidToken

_fernet: Fernet | None = None


def _get_fernet() -> Fernet:
    global _fernet
    if _fernet is None:
        key = os.environ.get("MAIL_ENCRYPTION_KEY", "")
        if not key:
            raise RuntimeError(
                "MAIL_ENCRYPTION_KEY is not set - cannot encrypt mail credentials. "
                "Generate one with `python -c \"from cryptography.fernet import Fernet; "
                "print(Fernet.generate_key().decode())\"` and add it to backend/.env"
            )
        _fernet = Fernet(key.encode())
    return _fernet


def encrypt_credential(plaintext: str) -> str:
    """Encrypt a credential for storage. Never log the result."""
    return _get_fernet().encrypt(plaintext.encode()).decode()


def decrypt_credential(ciphertext: str) -> str:
    """Decrypt a stored credential. Never log the result."""
    try:
        return _get_fernet().decrypt(ciphertext.encode()).decode()
    except (InvalidToken, ValueError) as exc:
        raise RuntimeError("Failed to decrypt mail credential (key mismatch?)") from exc
