#!/usr/bin/env bash
# tests/smoke-test.sh — post-deployment smoke test for mcp-skills-server
#
# Verifies that the MCP server starts, registers skills from SKILLS_DIR, and
# returns correct tool content on invocation.
#
# Usage:
#   ./tests/smoke-test.sh
#   MCP_URL=http://mcp-skills-server.my-namespace.svc.cluster.local:3000/mcp ./tests/smoke-test.sh
#
# Requires: curl, jq
# Exit code: 0 = all tests passed, 1 = one or more failures

MCP_URL="${MCP_URL:-http://localhost:3000/mcp}"
PASS=0
FAIL=0
CALL_ID=1
SESSION_ID=""

GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

_pass()   { printf "${GREEN}✓${NC} %s\n" "$1";  PASS=$((PASS + 1)); }
_fail()   { printf "${RED}✗${NC} %s\n" "$*";   FAIL=$((FAIL + 1)); }
_info()   { printf "  ${CYAN}→${NC} %s\n" "$1"; }
_header() { printf "\n${YELLOW}━━ %s${NC}\n" "$1"; }

for cmd in curl jq; do
    if ! command -v "$cmd" &>/dev/null; then
        printf "${RED}Error:${NC} '%s' is required but not installed.\n" "$cmd" >&2
        exit 1
    fi
done

# ── Helper: call an MCP tool, return the raw JSON-RPC response ────────────────
mcp_call() {
    local tool="$1" args_json="$2"
    CALL_ID=$((CALL_ID + 1))
    local payload
    payload=$(jq -nc \
        --arg   t   "$tool" \
        --argjson a "$args_json" \
        --argjson id "$CALL_ID" \
        '{jsonrpc:"2.0", id:$id, method:"tools/call", params:{name:$t, arguments:$a}}')
    curl -sf -X POST "$MCP_URL" \
        -H "Content-Type: application/json" \
        -H "Accept: application/json, text/event-stream" \
        -H "mcp-session-id: $SESSION_ID" \
        -d "$payload" 2>/dev/null \
        | grep '^data:' | head -1 | cut -c7-
}

# ── 1. Initialize session ────────────────────────────────────────────────────
_header "1  Initialize session"
_info "Connecting to $MCP_URL"

INIT_RESP=$(curl -siSf -X POST "$MCP_URL" \
    -H "Content-Type: application/json" \
    -H "Accept: application/json, text/event-stream" \
    -d '{"jsonrpc":"2.0","id":0,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"smoke-test","version":"1.0"}}}' 2>&1) || {
    printf "${RED}Cannot reach %s${NC} — is the server running?\n" "$MCP_URL" >&2
    exit 1
}

SESSION_ID=$(printf '%s' "$INIT_RESP" \
    | grep -i '^mcp-session-id:' \
    | awk '{print $2}' \
    | tr -d '\r\n')

if [[ -n "$SESSION_ID" ]]; then
    _pass "Session established (id: ${SESSION_ID:0:20}…)"
else
    printf "${RED}✗ No mcp-session-id returned${NC} — unexpected server response.\n" >&2
    exit 1
fi

# ── 2. List tools and verify test-skill is registered ────────────────────────
_header "2  List tools"

CALL_ID=$((CALL_ID + 1))
TOOLS_RESP=$(curl -sf -X POST "$MCP_URL" \
    -H "Content-Type: application/json" \
    -H "Accept: application/json, text/event-stream" \
    -H "mcp-session-id: $SESSION_ID" \
    -d "{\"jsonrpc\":\"2.0\",\"id\":$CALL_ID,\"method\":\"tools/list\",\"params\":{}}" 2>/dev/null \
    | grep '^data:' | head -1 | cut -c7-)

TOOL_COUNT=$(printf '%s' "$TOOLS_RESP" | jq '.result.tools | length' 2>/dev/null || echo 0)
TOOL_NAMES=$(printf '%s' "$TOOLS_RESP" | jq -r '[.result.tools[].name] | join(", ")' 2>/dev/null || echo "")

if [[ "$TOOL_COUNT" -ge 1 ]]; then
    _pass "$TOOL_COUNT tool(s) registered"
    _info "$TOOL_NAMES"
else
    _fail "Expected ≥1 tool, got $TOOL_COUNT — check that SKILLS_DIR contains SKILL.md files"
fi

HAS_TEST_SKILL=$(printf '%s' "$TOOLS_RESP" \
    | jq -r '.result.tools[].name' 2>/dev/null \
    | grep -c '^test-skill$' || true)

if [[ "$HAS_TEST_SKILL" -ge 1 ]]; then
    _pass "'test-skill' is registered"
else
    _fail "'test-skill' not found in tools list — fixture not loaded"
fi

# ── 3. Verify tool description ───────────────────────────────────────────────
_header "3  Tool description"

DESCRIPTION=$(printf '%s' "$TOOLS_RESP" \
    | jq -r '.result.tools[] | select(.name=="test-skill") | .description' 2>/dev/null || echo "")

if [[ -n "$DESCRIPTION" ]]; then
    _pass "Description present"
    _info "$DESCRIPTION"
else
    _fail "test-skill has no description — frontmatter may not be parsed correctly"
fi

# ── 4. Call the skill tool and verify body is returned ───────────────────────
_header "4  Invoke test-skill"
_info "Calling test-skill — expects the SKILL.md body text to be returned"

CALL_RESP=$(mcp_call "test-skill" '{}')

BODY=$(printf '%s' "$CALL_RESP" \
    | jq -r '.result.content[0].text' 2>/dev/null || echo "")

if [[ -n "$BODY" ]]; then
    _pass "Skill body returned"
    _info "${BODY:0:80}…"
else
    _fail "Skill body was empty or call failed: $CALL_RESP"
fi

# ── Summary ───────────────────────────────────────────────────────────────────
printf "\n%s\n" "────────────────────────────────────────"
TOTAL=$((PASS + FAIL))
if [[ $FAIL -eq 0 ]]; then
    printf "${GREEN}All %d tests passed.${NC} The skills server is working correctly.\n" "$TOTAL"
    exit 0
else
    printf "${RED}%d of %d tests failed.${NC}\n" "$FAIL" "$TOTAL"
    exit 1
fi
