#!/usr/bin/env python3

import os
import sys
import unittest
from unittest.mock import patch

backend_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
sys.path.insert(0, backend_dir)

from app.core.config import resolve_llm_provider, settings  # noqa: E402
from app.core.llm import make_chat_model  # noqa: E402


class TestLLMProviderConfig(unittest.TestCase):
    def test_qwen_profile_selects_agent_safe_defaults(self):
        config = resolve_llm_provider(
            {
                "LLM_PROVIDER": "qwen",
                "QWEN_API_KEY": "qwen-secret",
                "QWEN_BASE_URL": "https://workspace.maas.aliyuncs.com/compatible-mode/v1",
            }
        )

        self.assertEqual(config.provider, "qwen")
        self.assertEqual(config.model, "qwen3.6-flash")
        self.assertFalse(config.enable_thinking)
        self.assertEqual(config.embedding_model, "qwen3.7-text-embedding")
        self.assertEqual(config.embedding_api_key, "qwen-secret")

    def test_zhipu_profile_selects_free_flash_defaults(self):
        config = resolve_llm_provider(
            {
                "LLM_PROVIDER": "zhipu",
                "ZHIPU_API_KEY": "zhipu-secret",
            }
        )

        self.assertEqual(config.provider, "zhipu")
        self.assertEqual(config.model, "glm-4-flash")
        self.assertIsNone(config.enable_thinking)
        self.assertEqual(config.embedding_model, "embedding-3")
        self.assertEqual(config.api_key, "zhipu-secret")
        self.assertIn("bigmodel.cn", config.base_url)

    def test_selected_provider_never_reuses_another_providers_legacy_key(self):
        config = resolve_llm_provider(
            {
                "LLM_PROVIDER": "zhipu",
                "OPENAI_API_KEY": "qwen-secret",
                "OPENAI_BASE_URL": "https://workspace.maas.aliyuncs.com/compatible-mode/v1",
            }
        )

        self.assertEqual(config.api_key, "")
        self.assertNotEqual(config.embedding_api_key, "qwen-secret")

    def test_matching_legacy_configuration_is_migrated_safely(self):
        config = resolve_llm_provider(
            {
                "LLM_PROVIDER": "qwen",
                "OPENAI_API_KEY": "legacy-qwen-secret",
                "OPENAI_BASE_URL": "https://workspace.maas.aliyuncs.com/compatible-mode/v1",
            }
        )

        self.assertEqual(config.api_key, "legacy-qwen-secret")
        self.assertEqual(config.embedding_api_key, "legacy-qwen-secret")

    def test_custom_profile_preserves_openai_compatible_settings(self):
        config = resolve_llm_provider(
            {
                "LLM_PROVIDER": "custom",
                "OPENAI_API_KEY": "custom-secret",
                "OPENAI_BASE_URL": "https://example.test/v1",
                "OPENAI_MODEL": "custom-model",
                "OPENAI_ENABLE_THINKING": "true",
            }
        )

        self.assertEqual(config.model, "custom-model")
        self.assertTrue(config.enable_thinking)
        self.assertEqual(config.embedding_api_key, "custom-secret")

    def test_blank_custom_thinking_override_is_not_sent(self):
        config = resolve_llm_provider({"LLM_PROVIDER": "custom", "OPENAI_ENABLE_THINKING": ""})
        self.assertIsNone(config.enable_thinking)

    def test_unknown_provider_fails_fast(self):
        with self.assertRaisesRegex(ValueError, "qwen, zhipu, custom"):
            resolve_llm_provider({"LLM_PROVIDER": "mystery"})

    def test_model_factory_does_not_fall_back_to_another_provider_key(self):
        with (
            patch.object(settings, "LLM_PROVIDER", "zhipu"),
            patch.object(settings, "OPENAI_API_KEY", ""),
            self.assertRaisesRegex(RuntimeError, "ZHIPU_API_KEY"),
        ):
            make_chat_model()

    def test_model_factory_applies_qwen_tool_calling_compatibility(self):
        with (
            patch.object(settings, "LLM_PROVIDER", "qwen"),
            patch.object(settings, "OPENAI_API_KEY", "qwen-secret"),
            patch.object(settings, "OPENAI_BASE_URL", "https://workspace.maas.aliyuncs.com/v1"),
            patch.object(settings, "OPENAI_MODEL", "qwen3.6-flash"),
            patch.object(settings, "OPENAI_ENABLE_THINKING", False),
            patch("app.core.llm.ChatOpenAI") as chat_model,
        ):
            make_chat_model(temperature=0)

        self.assertEqual(chat_model.call_args.kwargs["extra_body"], {"enable_thinking": False})


if __name__ == "__main__":
    unittest.main()
