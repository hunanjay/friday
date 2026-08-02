import base64
import json
import logging
import os
import pypdf
import docx
from langchain_openai import ChatOpenAI
from langchain_core.messages import HumanMessage

logger = logging.getLogger(__name__)


def _get_aliyun_ocr_client():
    access_key_id = os.environ.get("OSS_ACCESS_KEY_ID") or os.environ.get("ALIYUN_ACCESS_KEY_ID")
    access_key_secret = os.environ.get("OSS_ACCESS_KEY_SECRET") or os.environ.get("ALIYUN_ACCESS_KEY_SECRET")
    if not access_key_id or not access_key_secret:
        return None

    try:
        from alibabacloud_ocr_api20210707.client import Client as OcrClient
        from alibabacloud_tea_openapi import models as open_api_models

        endpoint = os.environ.get("ALIYUN_OCR_ENDPOINT", "ocr-api.cn-hangzhou.aliyuncs.com")
        config = open_api_models.Config(
            access_key_id=access_key_id,
            access_key_secret=access_key_secret,
            endpoint=endpoint,
        )
        return OcrClient(config)
    except Exception as exc:
        logger.warning("Failed to initialize Alibaba Cloud OCR Client: %s", exc)
        return None


class DocumentParser:
    @classmethod
    async def parse_file(cls, file_path: str, mime_type: str, file_name: str) -> str:
        """Extract text content from an uploaded image or document."""
        mime = (mime_type or "").lower()
        ext = os.path.splitext(file_name)[1].lower()

        try:
            if mime.startswith("image/") or ext in [".png", ".jpg", ".jpeg", ".webp"]:
                return await cls._parse_image(file_path, mime_type)
            elif ext == ".pdf" or "pdf" in mime:
                return await cls._parse_pdf(file_path)
            elif ext == ".docx" or "wordprocessingml" in mime:
                return cls._parse_docx(file_path)
            elif ext in [".txt", ".md", ".json", ".csv"] or "text/" in mime:
                return cls._parse_text(file_path)
            else:
                return cls._parse_text(file_path)
        except Exception as exc:
            logger.warning("DocumentParser failed for %s (%s): %s", file_name, mime_type, exc)
            return f"[Attachment: {file_name}]"

    @classmethod
    async def _parse_image(cls, file_path: str, mime_type: str) -> str:
        """Attempt Alibaba Cloud OCR first if configured; fallback to OpenAI Vision LLM."""
        # 1. Try Alibaba Cloud OCR if credentials exist
        aliyun_text = await cls._parse_image_via_aliyun_ocr(file_path)
        if aliyun_text and len(aliyun_text.strip()) > 5:
            logger.info("Successfully parsed image via Alibaba Cloud OCR")
            return aliyun_text

        # 2. Fallback to OpenAI Vision LLM
        return await cls._parse_image_via_vision_llm(file_path, mime_type)

    @classmethod
    async def _parse_image_via_aliyun_ocr(cls, file_path: str) -> str:
        """Call Alibaba Cloud OCR General Text Recognition API."""
        try:
            client = _get_aliyun_ocr_client()
            if client is None:
                return ""

            from alibabacloud_ocr_api20210707 import models as ocr_models
            from alibabacloud_tea_util import models as util_models

            with open(file_path, "rb") as f:
                request = ocr_models.RecognizeGeneralRequest(body=f)
                runtime = util_models.RuntimeOptions()
                response = client.recognize_general_with_options(request, runtime)

                if response and response.body and response.body.data:
                    data_dict = json.loads(response.body.data)
                    content = data_dict.get("content", "")
                    if content:
                        clean_lines = [l.strip() for l in content.split("\n") if l.strip()]
                        return "\n".join(clean_lines)
        except Exception as exc:
            logger.warning("Alibaba Cloud OCR recognition failed, falling back: %s", exc)
        return ""

    @classmethod
    async def _parse_image_via_vision_llm(cls, file_path: str, mime_type: str) -> str:
        """Use Multimodal Vision LLM to extract text and details from an image."""
        try:
            with open(file_path, "rb") as f:
                image_bytes = f.read()
            base64_img = base64.b64encode(image_bytes).decode("utf-8")
            media_type = mime_type if mime_type.startswith("image/") else "image/jpeg"

            llm = ChatOpenAI(
                model="gpt-4o-mini",
                max_tokens=1000,
                base_url=os.environ.get("OPENAI_BASE_URL") or None,
                timeout=60.0,
                max_retries=3,
            )

            message = HumanMessage(
                content=[
                    {
                        "type": "text",
                        "text": "Please extract and summarize all readable text, tables, headers, and key details from this image accurately in clean text format.",
                    },
                    {
                        "type": "image_url",
                        "image_url": {"url": f"data:{media_type};base64,{base64_img}"},
                    },
                ]
            )

            response = await llm.ainvoke([message])
            return response.content.strip()
        except Exception as exc:
            logger.exception("Failed to parse image via Vision LLM: %s", exc)
            return ""

    @classmethod
    async def _parse_pdf(cls, file_path: str) -> str:
        """Extract text from PDF using pypdf."""
        extracted_text = []
        try:
            reader = pypdf.PdfReader(file_path)
            for i, page in enumerate(reader.pages):
                page_text = page.extract_text() or ""
                if page_text.strip():
                    extracted_text.append(f"--- Page {i+1} ---\n{page_text.strip()}")
            full_text = "\n\n".join(extracted_text)

            if len(full_text.strip()) < 20:
                logger.info("PDF text extraction empty/minimal, falling back to basic placeholder")
                return f"[Scanned PDF File: {os.path.basename(file_path)}]"
            return full_text
        except Exception as exc:
            logger.warning("pypdf extraction failed for %s: %s", file_path, exc)
            return ""

    @classmethod
    def _parse_docx(cls, file_path: str) -> str:
        """Extract text from Word DOCX file."""
        try:
            doc = docx.Document(file_path)
            paragraphs = [p.text for p in doc.paragraphs if p.text.strip()]
            return "\n".join(paragraphs)
        except Exception as exc:
            logger.warning("docx extraction failed for %s: %s", file_path, exc)
            return ""

    @classmethod
    def _parse_text(cls, file_path: str) -> str:
        """Extract plain text or markdown."""
        try:
            with open(file_path, "r", encoding="utf-8", errors="ignore") as f:
                return f.read().strip()
        except Exception as exc:
            logger.warning("Text read failed for %s: %s", file_path, exc)
            return ""
