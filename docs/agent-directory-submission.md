# Agent Directory Submission

This document is the release checklist and canonical copy for agent directories. Do not mark an external listing complete until the directory confirms publication.

## Listing identity

- Name: CodeY CMS
- Category: Developer tools / website and content management
- Website: https://usecodey.com/cms
- Source: https://github.com/fpointerdev/codey-cms
- Support: https://github.com/fpointerdev/codey-cms/issues
- Security reports: https://github.com/fpointerdev/codey-cms/security/advisories/new
- Privacy: https://usecodey.com/platform/privacy
- Terms: https://usecodey.com/platform/terms
- MCP Registry name: `io.github.fpointerdev/codey-cms`
- npm package: `codey-cms-mcp`
- Remote endpoint: `https://usecodey.com/mcp` after production deployment and external verification

## Short description

Discover, evaluate, install, and validate generated websites for the free, self-hosted CodeY CMS.

## Long description

CodeY CMS is a visual, self-hosted content-management runtime for editable, server-rendered websites. The read-only connector exposes canonical capabilities and documentation, evaluates project fit with caveats, returns the signed stable installation workflow, lists generator-safe builder elements, and validates WebsiteSpec 1.0. It does not connect to customer installations or modify customer content.

## Example prompts

1. Is CodeY CMS suitable for a self-hosted marketing website that nontechnical editors can update?
2. Show me the generator-safe CodeY CMS elements for a portfolio site.
3. Validate this WebsiteSpec before I import it into CodeY CMS.

## Publication gates

- Package version, `mcpName`, and `server.json` version match.
- Package tarball contains only expected files and no credentials.
- MCP stdio and Streamable HTTP tests pass.
- Remote endpoint uses HTTPS, explicit host validation, rate limits, monitoring, and a public status check.
- Privacy, terms, support, and security-reporting links are live.
- Tool annotations accurately identify every tool as read-only and non-destructive.
- External review credentials are supplied only through the directory's private submission form.
- OpenAI submission has passed developer-mode testing and directory review.
- Anthropic submission has passed connector testing and directory review.
- MCP Registry record resolves to the published package version.

## Measurement

Review monthly:

- ChatGPT referrals carrying `utm_source=chatgpt.com`
- AI crawler access and errors
- MCP Registry installs and npm downloads
- GitHub stars, issues, contributors, and release downloads
- Search impressions for `CodeY CMS`, `self-hosted AI CMS`, and `simple Elementor alternative`
- Results of the three example prompts in ChatGPT and Claude with web search enabled

Record observed results. Do not publish invented rankings, testimonials, adoption, or performance claims.
