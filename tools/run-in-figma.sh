#!/usr/bin/env bash
# Executes a plugin-API script from this repo against the FigmaCPU file through the
# Figma MCP `use_figma` tool, using a headless Claude Code run.
# Usage: tools/run-in-figma.sh <script.js> "<what it does>"
# Requires: `claude mcp add --transport http figma https://mcp.figma.com/mcp` + `claude mcp login figma`.
set -euo pipefail

FILE_KEY="${FIGMA_FILE_KEY:-l2JmsK7AEQkfo3Cvx67NgN}"
SCRIPT="$1"
DESC="${2:-Run $SCRIPT}"
[ -f "$SCRIPT" ] || { echo "no such script: $SCRIPT" >&2; exit 1; }

claude -p "You are a relay. Steps:
1. Read the figma-use guidance (the skill://figma/figma-use/SKILL.md MCP resource) if available.
2. Call mcp__figma__create_session for fileKey $FILE_KEY with description \"$DESC\".
3. Read the file $SCRIPT with the Read tool. Call mcp__figma__use_figma with fileKey $FILE_KEY, the sessionId, description \"$DESC\", and code set to the file's contents EXACTLY, byte for byte. Do not edit, shorten, reformat or 'fix' the code.
4. If use_figma reports an error, do NOT retry with modified code. Print the exact error.
5. Finally print one line starting with RESULT: followed by the tool's return value or error." \
  --allowedTools "mcp__figma" "Read" "ReadMcpResourceTool" "ListMcpResourcesTool"
