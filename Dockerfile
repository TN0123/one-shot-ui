# Container for Glama MCP listing checks: starts the one-shot-ui MCP server over
# stdio and responds to introspection (tools/list). Chromium is only needed when
# a capture/converge tool is actually invoked, not for introspection, so the
# browser download is skipped to keep the image small and the build reliable.
FROM node:20-slim

ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
RUN npm install -g one-shot-ui

ENTRYPOINT ["one-shot-ui-mcp"]
