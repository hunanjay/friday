#!/usr/bin/env python3

import os
import sys

backend_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
sys.path.insert(0, backend_dir)

# Importing the agent tools initializes application settings in this project.
for variable, fallback in (
    ("SUPABASE_URL", "https://test.supabase.co"),
    ("SUPABASE_ANON_KEY", "test-anon-key"),
    ("SUPABASE_SERVICE_ROLE_KEY", "test-service-key"),
):
    os.environ[variable] = os.environ.get(variable) or fallback

from app.agents.routing import AGENT_NAMES  # noqa: E402
from app.agents.supervisor import (  # noqa: E402
    _HITL_RULES,
    _LANGUAGE_RULE,
    _agent_prompts,
    _supervisor_prompt,
)


def check(label: str, condition: bool) -> None:
    if not condition:
        raise AssertionError(label)
    print(f"PASS: {label}")


prompts = _agent_prompts("Friday", "2026-01-01")
parent_prompt = _supervisor_prompt("Friday", "2026-01-01")
all_prompts = {**prompts, "parent": parent_prompt}

check("prompt registry covers every agent", set(prompts) == set(AGENT_NAMES))
for name, prompt in all_prompts.items():
    rules = prompt.split("\n- ")
    check(f"{name} has no empty rules", all(rule.strip() for rule in rules))
    check(
        f"{name} rules end with punctuation",
        all(rule.rstrip().endswith((".", "。")) for rule in rules),
    )

hitl_block = "\n- ".join(_HITL_RULES)
check("mail prompt contains the shared protected-write rules", hitl_block in prompts["mail_agent"])
check("calendar prompt contains the identical protected-write rules", hitl_block in prompts["calendar_agent"])

check(
    "every agent and parent prompt contains the language rule",
    all(_LANGUAGE_RULE in prompt for prompt in all_prompts.values()),
)

internal_terms = ("ToolMessage", "internal_event_id", "HITL middleware", "resumed tool result")
check(
    "prompts contain no internal implementation terms",
    all(term not in prompt for prompt in all_prompts.values() for term in internal_terms),
)

example_names = ("张明", "Zhang Ming")
check(
    "prompts contain no hard-coded example person",
    all(name not in prompt for prompt in all_prompts.values() for name in example_names),
)

check(
    "only the parent prompt carries the assistant identity",
    "You are Friday" in parent_prompt
    and all("You are Friday" not in prompt for prompt in prompts.values()),
)
