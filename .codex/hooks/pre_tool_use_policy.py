#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Warn before potentially destructive Codex shell commands.

This hook is intentionally advisory. It emits additional context when it sees
a dangerous pattern, but it does not block the command.
"""

from __future__ import annotations

import json
import re
import sys
from typing import Any


SAMPLE_EVENTS: list[dict[str, Any]] = [
    {
        "hook_event_name": "PreToolUse",
        "cwd": "/tmp/example",
        "tool_name": "Bash",
        "tool_input": {"cmd": "rm -rf build"},
    },
    {
        "hook_event_name": "PreToolUse",
        "cwd": "/tmp/example",
        "tool_name": "Bash",
        "tool_input": {"cmd": "git status --short"},
    },
]


DANGEROUS_PATTERNS: list[tuple[str, re.Pattern[str]]] = [
    ("rm -rf", re.compile(r"(^|[;&|()\s])rm\s+-(?:[^\s-]*r[^\s-]*f|[^\s-]*f[^\s-]*r)\b")),
    ("git reset --hard", re.compile(r"\bgit\s+reset\b(?=[^\n;&|]*\s--hard\b)")),
    ("git clean -fd", re.compile(r"\bgit\s+clean\b(?=[^\n;&|]*\s-(?:[^\s-]*f[^\s-]*d|[^\s-]*d[^\s-]*f)\b)")),
    (
        "Vercel project delete",
        re.compile(
            r"\bvercel\b(?=[^\n;&|]*(?:project|projects))(?=[^\n;&|]*\b(?:delete|remove|rm)\b)"
        ),
    ),
    (
        "Supabase data or storage delete",
        re.compile(
            r"\bsupabase\b(?=[^\n;&|]*(?:db|database|storage|bucket|object|file|files))"
            r"(?=[^\n;&|]*\b(?:delete|remove|rm|drop|truncate|reset)\b)"
        ),
    ),
]


COMMAND_KEYS = {"cmd", "command", "script", "shell_command"}


def collect_command_strings(value: Any) -> list[str]:
    commands: list[str] = []

    if isinstance(value, dict):
      for key, nested_value in value.items():
          if key in COMMAND_KEYS and isinstance(nested_value, str):
              commands.append(nested_value)
          else:
              commands.extend(collect_command_strings(nested_value))
    elif isinstance(value, list):
        for item in value:
            commands.extend(collect_command_strings(item))

    return commands


def find_dangerous_matches(commands: list[str]) -> list[str]:
    matches: list[str] = []

    for command in commands:
        normalized = " ".join(command.split())
        for label, pattern in DANGEROUS_PATTERNS:
            if pattern.search(command):
                matches.append(f"{label}: {normalized}")

    return matches


def build_warning() -> str:
    return (
        "경고: 위험하거나 복구하기 어려운 명령이 감지되었습니다. 실행 전에 대상과 이유를 "
        "사용자에게 설명하고 명시적인 승인을 받아야 합니다."
    )


def evaluate_event(event: dict[str, Any]) -> dict[str, Any] | None:
    commands = collect_command_strings(event)
    matches = find_dangerous_matches(commands)

    if not matches:
        return None

    return {
        "hookSpecificOutput": {
            "hookEventName": "PreToolUse",
            "additionalContext": build_warning(),
        }
    }


def run_self_test() -> int:
    results = [evaluate_event(event) for event in SAMPLE_EVENTS]

    if results[0] is None:
        print("self-test failed: dangerous sample was not detected", file=sys.stderr)
        return 1

    if results[1] is not None:
        print("self-test failed: safe sample produced a warning", file=sys.stderr)
        return 1

    print("self-test passed: dangerous sample warned, safe sample stayed quiet")
    return 0


def main() -> int:
    if "--self-test" in sys.argv:
        return run_self_test()

    try:
        event = json.load(sys.stdin)
    except json.JSONDecodeError as error:
        print(f"hook input was not valid JSON: {error}", file=sys.stderr)
        return 0

    if not isinstance(event, dict):
        return 0

    result = evaluate_event(event)
    if result:
        print(json.dumps(result, ensure_ascii=False))

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
