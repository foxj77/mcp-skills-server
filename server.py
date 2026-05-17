#!/usr/bin/env python3
"""MCP skills server — exposes skills from a Git-synced directory as MCP tools.

Each subdirectory under SKILLS_DIR that contains a SKILL.md file with YAML
frontmatter (name, description) is registered as an MCP tool. Tool content is
read from disk on every invocation (lazy reload) so updated skill bodies are
served without a restart. New skills added after startup require a pod restart
to appear in tools/list — this is a known v1 limitation documented in CLAUDE.md.
"""
import asyncio
import os
import sys
from pathlib import Path

import yaml
from mcp.server import Server
from mcp.server.stdio import stdio_server
import mcp.types as types

SKILLS_DIR = Path(os.environ.get("SKILLS_DIR", "/skills"))
SERVER_NAME = os.environ.get("SERVER_NAME", "mcp-skills-server")

app = Server(SERVER_NAME)


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


def _load_skills() -> dict[str, tuple[str, Path]]:
    """Scan SKILLS_DIR and return {name: (description, skill_file_path)}."""
    skills: dict[str, tuple[str, Path]] = {}
    if not SKILLS_DIR.exists():
        print(f"SKILLS_DIR {SKILLS_DIR} does not exist — no skills loaded", file=sys.stderr, flush=True)
        return skills
    for item in sorted(SKILLS_DIR.iterdir()):
        if item.is_dir():
            skill_file = item / "SKILL.md"
            if skill_file.exists():
                fm, _ = _parse_skill_file(skill_file)
                name = fm.get("name") or item.name
                description = fm.get("description") or f"Skill: {name}"
                skills[name] = (description, skill_file)
                print(f"registered skill: {name}", flush=True)
    return skills


_skills = _load_skills()
print(f"startup scan complete: {len(_skills)} skill(s) registered", flush=True)


@app.list_tools()
async def list_tools() -> list[types.Tool]:
    return [
        types.Tool(
            name=name,
            description=description,
            inputSchema={"type": "object", "properties": {}, "required": []},
        )
        for name, (description, _) in _skills.items()
    ]


@app.call_tool()
async def call_tool(name: str, arguments: dict) -> list[types.TextContent]:
    if name not in _skills:
        raise ValueError(f"Unknown skill: {name}")
    _, skill_file = _skills[name]
    # Lazy reload: re-read from disk on every call so updated content is served
    # without a restart.
    _, body = _parse_skill_file(skill_file)
    return [types.TextContent(type="text", text=body)]


async def _main() -> None:
    async with stdio_server() as (read_stream, write_stream):
        await app.run(read_stream, write_stream, app.create_initialization_options())


if __name__ == "__main__":
    asyncio.run(_main())
