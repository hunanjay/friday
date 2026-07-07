import re
from html.parser import HTMLParser

# Ported from a Node MCP reference implementation: strips content an email
# author hid from human readers (display:none, off-screen positioning, etc.)
# before HTML email bodies reach the model, so a malicious sender can't smuggle
# invisible instructions into the agent's context (prompt injection via email).

_INVISIBLE_CODEPOINTS = (
    list(range(0x200B, 0x200E))
    + [0x2060]
    + list(range(0x2061, 0x2065))
    + list(range(0x206A, 0x2070))
    + [0xFEFF, 0x00AD, 0x034F, 0x061C, 0x180E, 0x2028, 0x2029]
    + list(range(0x202A, 0x202F))
)
_INVISIBLE_CHARS_RE = re.compile("[" + "".join(chr(c) for c in _INVISIBLE_CODEPOINTS) + "]")

_HIDING_CSS_PATTERNS = [
    re.compile(p, re.IGNORECASE)
    for p in (
        r"display\s*:\s*none",
        r"visibility\s*:\s*hidden",
        r"opacity\s*:\s*0\b",
        r"font-size\s*:\s*0(?:px|em|rem|%|pt)?\s*[;}\"']",
        r"height\s*:\s*0(?:px|em|rem|%|pt)?\s*[;}\"']",
        r"width\s*:\s*0(?:px|em|rem|%|pt)?\s*[;}\"']",
        r"text-indent\s*:\s*-\d{3,}",
        r"left\s*:\s*-\d{4,}",
        r"top\s*:\s*-\d{4,}",
        r"clip\s*:\s*rect\s*\(\s*0",
        r"color\s*:\s*(?:transparent|rgba?\s*\([^)]*,\s*0\s*\))",
        r"font-size\s*:\s*[01]px",
    )
]

_REMOVE_ELEMENTS = {
    "script", "style", "head", "meta", "link", "noscript",
    "template", "iframe", "object", "embed", "applet",
    "svg", "math", "canvas", "audio", "video", "source", "track",
}

_BLOCK_ELEMENTS = {
    "p", "div", "br", "hr", "h1", "h2", "h3", "h4", "h5", "h6",
    "ul", "ol", "li", "table", "tr", "td", "th", "thead", "tbody",
    "blockquote", "pre", "address", "article", "aside", "section",
    "header", "footer", "nav", "main", "figure", "figcaption",
}


def _is_hidden(attrs: dict) -> bool:
    style = attrs.get("style") or ""
    if any(p.search(style) for p in _HIDING_CSS_PATTERNS):
        return True
    if attrs.get("aria-hidden") == "true" or attrs.get("hidden") is not None:
        return True
    return False


class _VisibleTextExtractor(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self._skip_depth = 0  # inside a removed element (script/style/hidden)
        self.chunks: list[str] = []

    def handle_starttag(self, tag, attrs_list):
        attrs = dict(attrs_list)
        if self._skip_depth > 0:
            self._skip_depth += 1
            return
        if tag in _REMOVE_ELEMENTS or _is_hidden(attrs):
            self._skip_depth = 1
            return
        if tag in _BLOCK_ELEMENTS:
            self.chunks.append("\n")

    def handle_startendtag(self, tag, attrs_list):
        if tag in _BLOCK_ELEMENTS and self._skip_depth == 0:
            self.chunks.append("\n")

    def handle_endtag(self, tag):
        if self._skip_depth > 0:
            self._skip_depth -= 1
            return
        if tag in _BLOCK_ELEMENTS:
            self.chunks.append("\n")

    def handle_data(self, data):
        if self._skip_depth == 0:
            self.chunks.append(data)


def sanitize_html_to_text(html: str) -> str:
    parser = _VisibleTextExtractor()
    parser.feed(html)
    text = "".join(parser.chunks)
    text = _INVISIBLE_CHARS_RE.sub("", text)
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r"\n\s*\n+", "\n\n", text)
    return text.strip()
