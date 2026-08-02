import logging
import os

logger = logging.getLogger(__name__)


def save_attachment_file(file_bytes: bytes, safe_filename: str, mime_type: str) -> tuple[str, str]:
    """Save attachment file to Aliyun OSS (if configured) or local disk.

    Returns:
        tuple[file_url, file_path_for_parsing]
    """
    upload_dir = os.path.join(os.getcwd(), "uploads", "memos")
    os.makedirs(upload_dir, exist_ok=True)
    local_path = os.path.join(upload_dir, safe_filename)

    # Always write local copy for local OCR / parser inspection
    with open(local_path, "wb") as f:
        f.write(file_bytes)

    bucket_name = os.environ.get("OSS_BUCKET") or os.environ.get("ALIYUN_OSS_BUCKET")
    access_key_id = os.environ.get("OSS_ACCESS_KEY_ID") or os.environ.get("ALIYUN_ACCESS_KEY_ID")
    access_key_secret = os.environ.get("OSS_ACCESS_KEY_SECRET") or os.environ.get("ALIYUN_ACCESS_KEY_SECRET")
    endpoint = os.environ.get("OSS_ENDPOINT") or os.environ.get("ALIYUN_OSS_ENDPOINT") or "oss-cn-hangzhou.aliyuncs.com"

    if bucket_name and access_key_id and access_key_secret:
        try:
            import oss2

            # Clean endpoint prefix if user included http:// or https://
            clean_endpoint = endpoint.replace("https://", "").replace("http://", "")
            auth = oss2.Auth(access_key_id, access_key_secret)
            bucket = oss2.Bucket(auth, f"https://{clean_endpoint}", bucket_name)

            oss_key = f"memos/{safe_filename}"
            headers = {"Content-Type": mime_type} if mime_type else None
            bucket.put_object(oss_key, file_bytes, headers=headers)

            # Generate signed URL valid for 1 year (365 days) to bypass bucket private ACL
            oss_url = bucket.sign_url("GET", oss_key, 3600 * 24 * 365)
            logger.info("Successfully uploaded file %s to Aliyun OSS signed URL: %s", safe_filename, oss_url)
            return oss_url, local_path
        except Exception as exc:
            logger.warning("Aliyun OSS upload failed for %s, fallback to local URL: %s", safe_filename, exc)

    # Fallback to local static route
    return f"/uploads/memos/{safe_filename}", local_path
