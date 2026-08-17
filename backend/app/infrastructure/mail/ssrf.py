"""SSRF 防护：自定义 IMAP/SMTP 服务器地址校验。

用户自填的 hostname 必须解析到公网地址——禁止：
- 私有/环回/链路本地地址（10.x, 172.16-31.x, 192.168.x, 127.x, 169.254.x）
- 云元数据地址（169.254.169.254 等）
- 保留地址（0.0.0.0, 224.0.0.0/4, ::1, fc00::/7 等）

IPv6 映射的 IPv4（::ffff:10.0.0.1）也会被正确拒绝。
"""

import ipaddress
import socket

from app.core.config import settings

_BLOCKED_NETWORKS = [
    ipaddress.ip_network("0.0.0.0/8"),
    ipaddress.ip_network("10.0.0.0/8"),
    ipaddress.ip_network("100.64.0.0/10"),
    ipaddress.ip_network("127.0.0.0/8"),
    ipaddress.ip_network("169.254.0.0/16"),
    ipaddress.ip_network("172.16.0.0/12"),
    ipaddress.ip_network("192.0.0.0/24"),
    ipaddress.ip_network("192.168.0.0/16"),
    ipaddress.ip_network("198.18.0.0/15"),
    ipaddress.ip_network("224.0.0.0/4"),
    ipaddress.ip_network("240.0.0.0/4"),
    ipaddress.ip_network("::1/128"),
    ipaddress.ip_network("::/128"),
    ipaddress.ip_network("fc00::/7"),
    ipaddress.ip_network("fe80::/10"),
]


def assert_public_host(host: str) -> None:
    """校验 host 可解析且所有解析结果都是公网地址，否则抛 ValueError。"""
    if settings.MAIL_SSRF_CHECK_DISABLED:
        return
    try:
        infos = socket.getaddrinfo(host, None)
    except socket.gaierror as exc:
        raise ValueError(f"无法解析服务器地址：{host}") from exc

    seen = set()
    for info in infos:
        ip = ipaddress.ip_address(info[4][0])
        # IPv4-mapped IPv6 (::ffff:10.0.0.1) -> unwrap to the real IPv4
        if isinstance(ip, ipaddress.IPv6Address) and ip.ipv4_mapped:
            ip = ip.ipv4_mapped
        seen.add(ip)
        for network in _BLOCKED_NETWORKS:
            if ip in network:
                raise ValueError(f"服务器地址 {host} 解析到内网/保留地址（{ip}），已被禁止")


def validate_override_hosts(imap_host: str | None, smtp_host: str | None) -> None:
    """绑定/更新账号前对自定义服务器地址做 SSRF 校验。"""
    for _label, host in (("IMAP", imap_host), ("SMTP", smtp_host)):
        if host:
            assert_public_host(host.strip())
