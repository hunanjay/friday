import os
import re
from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo

_WEEKDAY_INDEX = {
    "一": 0,
    "二": 1,
    "三": 2,
    "四": 3,
    "五": 4,
    "六": 5,
    "日": 6,
    "天": 6,
    "monday": 0,
    "tuesday": 1,
    "wednesday": 2,
    "thursday": 3,
    "friday": 4,
    "saturday": 5,
    "sunday": 6,
}


def _local_today() -> date:
    iana = os.environ.get("TIMEZONE", "Asia/Shanghai")
    try:
        return datetime.now(ZoneInfo(iana)).date()
    except Exception:
        return datetime.now(ZoneInfo("Asia/Shanghai")).date()


def resolve_calendar_day(day: str, *, today: date | None = None) -> date | None:
    """Resolve common zh/en relative day expressions without LLM date math."""
    text = day.strip().lower()
    base = today or _local_today()
    iso_match = re.search(r"\b(\d{4}-\d{2}-\d{2})\b", text)
    if iso_match:
        try:
            return date.fromisoformat(iso_match.group(1))
        except ValueError:
            return None

    relative_days = {
        "今天": 0,
        "today": 0,
        "明天": 1,
        "tomorrow": 1,
        "后天": 2,
    }
    for token, offset in relative_days.items():
        if token in text:
            return base + timedelta(days=offset)

    zh_match = re.search(r"(?:(?:(上|下|本|这)?周)|星期|礼拜)([一二三四五六日天])", text)
    if zh_match:
        qualifier, weekday_text = zh_match.groups()
        target = _WEEKDAY_INDEX[weekday_text]
        week_start = base - timedelta(days=base.weekday())
        if qualifier == "上":
            return week_start - timedelta(days=7) + timedelta(days=target)
        if qualifier == "下":
            return week_start + timedelta(days=7 + target)
        if qualifier in {"本", "这"}:
            return week_start + timedelta(days=target)
        return base + timedelta(days=(target - base.weekday()) % 7)

    en_match = re.search(
        r"\b(?:(last|next|this)\s+)?(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b",
        text,
    )
    if en_match:
        qualifier, weekday_text = en_match.groups()
        target = _WEEKDAY_INDEX[weekday_text]
        week_start = base - timedelta(days=base.weekday())
        if qualifier == "last":
            return week_start - timedelta(days=7) + timedelta(days=target)
        if qualifier == "next":
            return week_start + timedelta(days=7 + target)
        if qualifier == "this":
            return week_start + timedelta(days=target)
        return base + timedelta(days=(target - base.weekday()) % 7)
    return None
