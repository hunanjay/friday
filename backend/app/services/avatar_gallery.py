import logging
import os

logger = logging.getLogger(__name__)

_FALLBACK_PRESETS = [{"id": "avatar-01.png", "url": "/avatars/avatar-01.png"}]


def list_avatar_presets() -> list[dict]:
    """Preset avatar images a user can pick in Settings.

    Listed from the (public-read) OSS_AVATAR_BUCKET so adding a new preset is
    just uploading an image there - no code change needed. Falls back to the
    single locally-bundled preset (frontend/public/avatars/) if OSS isn't
    configured, mirroring storage.py's local-fallback pattern.
    """
    bucket_name = os.environ.get("OSS_AVATAR_BUCKET") or "friday-avatars"
    access_key_id = os.environ.get("OSS_ACCESS_KEY_ID") or os.environ.get("ALIYUN_ACCESS_KEY_ID")
    access_key_secret = os.environ.get("OSS_ACCESS_KEY_SECRET") or os.environ.get("ALIYUN_ACCESS_KEY_SECRET")
    endpoint = os.environ.get("OSS_ENDPOINT") or os.environ.get("ALIYUN_OSS_ENDPOINT") or "oss-cn-hangzhou.aliyuncs.com"

    if not (access_key_id and access_key_secret):
        return list(_FALLBACK_PRESETS)

    try:
        import oss2

        clean_endpoint = endpoint.replace("https://", "").replace("http://", "")
        auth = oss2.Auth(access_key_id, access_key_secret)
        bucket = oss2.Bucket(auth, f"https://{clean_endpoint}", bucket_name)

        presets = [
            {"id": obj.key, "url": f"https://{bucket_name}.{clean_endpoint}/{obj.key}"}
            for obj in oss2.ObjectIterator(bucket)
            if not obj.key.endswith("/")
        ]
        return presets or list(_FALLBACK_PRESETS)
    except Exception:
        logger.warning(
            "Failed to list avatar presets from OSS bucket %s, using local fallback",
            bucket_name,
            exc_info=True,
        )
        return list(_FALLBACK_PRESETS)
