#!/usr/bin/env python3
"""MCP skills server — exposes skills from a Git-synced directory as MCP tools.

Each subdirectory under SKILLS_DIR that contains a SKILL.md file with YAML
frontmatter (name, description) is registered as an MCP tool. Tool content is
read from disk on every invocation (lazy reload) so updated skill bodies are
served without a restart. New skills added after startup require a pod restart
to appear in tools/list — this is a known v1 limitation documented in CLAUDE.md.
"""
import os
import sys
import threading
import time
from pathlib import Path

import yaml
from fastmcp import FastMCP

SKILLS_DIR = Path(os.environ.get("SKILLS_DIR", "/skills"))
SERVER_NAME = os.environ.get("SERVER_NAME", "mcp-skills-server")

mcp = FastMCP(SERVER_NAME)

_registered: set[str] = set()


def _parse_skill_file(path: Path) -> tuple[dict, str]:
    """Return (frontmatter_dict, body_text) from a SKILL.md file."""
    content = path.read_text(encoding="utf-8")
    if content.startswith("---"):
        parts = content.split("---", 2)
        if len(parts) >= 3:
            try:
                fm = yaml.safe_load(parts[1]) or {}
            except yaml.YAMLError:
                fm = {}
            return fm, parts[2].strip()
    return {}, content.strip()


def _register_skill(skill_dir: Path) -> None:
    skill_file = skill_dir / "SKILL.md"
    if not skill_file.exists():
        return

    fm, _ = _parse_skill_file(skill_file)
    name = fm.get("name") or skill_dir.name
    description = fm.get("description") or f"Skill: {name}"

    if name in _registered:
        return

    # Capture skill_file path in closure for lazy disk reads on each call.
    def _make_handler(sf: Path, _name: str, _desc: str):
        def handler() -> str:
            _, body = _parse_skill_file(sf)
            return body

        handler.__name__ = _name
        handler.__doc__ = _desc
        return handler

    mcp.tool(name=name, description=description)(_make_handler(skill_file, name, description))
    _registered.add(name)
    print(f"registered skill: {name}", flush=True)


def _scan_skills() -> None:
    if not SKILLS_DIR.exists():
        print(f"SKILLS_DIR {SKILLS_DIR} does not exist — no skills loaded", file=sys.stderr, flush=True)
        return
    for item in sorted(SKILLS_DIR.iterdir()):
        if item.is_dir():
            _register_skill(item)


_scan_skills()
print(f"startup scan complete: {len(_registered)} skill(s) registered", flush=True)


if __name__ == "__main__":
    mcp.run(transport="stdio")
