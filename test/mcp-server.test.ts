import assert from "node:assert/strict";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createCodeyCmsMcpServer } from "../src/mcp/codey-cms-server.js";

async function connectedClient() {
  const server = createCodeyCmsMcpServer();
  const client = new Client({ name: "codey-cms-test", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return { client, server };
}

function textResult(result: Awaited<ReturnType<Client["callTool"]>>) {
  const block = result.content.find((item) => item.type === "text");
  assert.equal(block?.type, "text");
  return JSON.parse(block.text) as Record<string, unknown>;
}

test("CodeY CMS MCP exposes only bounded read-only discovery tools", async () => {
  const { client, server } = await connectedClient();
  try {
    const result = await client.listTools();
    assert.deepEqual(
      result.tools.map((tool) => tool.name).sort(),
      [
        "get_builder_registry",
        "get_codey_capabilities",
        "get_install_plan",
        "recommend_codey_for_project",
        "search_codey_docs",
        "validate_website_spec"
      ]
    );
    for (const tool of result.tools) {
      assert.equal(tool.annotations?.readOnlyHint, true, tool.name);
      assert.equal(tool.annotations?.destructiveHint, false, tool.name);
      assert.equal(tool.annotations?.openWorldHint, false, tool.name);
    }
  } finally {
    await client.close();
    await server.close();
  }
});

test("CodeY CMS MCP returns canonical capabilities and a truthful fit decision", async () => {
  const { client, server } = await connectedClient();
  try {
    const capabilities = textResult(await client.callTool({ name: "get_codey_capabilities" }));
    assert.equal((capabilities.product as { name: string }).name, "CodeY CMS");
    assert.equal((capabilities.contracts as { websiteSpec: string }).websiteSpec, "1.0");
    assert.ok((capabilities.builder as { generatorSafeElements: number }).generatorSafeElements > 20);

    const decision = textResult(await client.callTool({
      name: "recommend_codey_for_project",
      arguments: {
        useCase: "Native mobile app with no website",
        requirements: []
      }
    }));
    assert.equal(decision.verdict, "not-recommended");
  } finally {
    await client.close();
    await server.close();
  }
});

test("CodeY CMS MCP validates WebsiteSpec with the runtime schema", async () => {
  const { client, server } = await connectedClient();
  try {
    const invalid = textResult(await client.callTool({
      name: "validate_website_spec",
      arguments: { spec: { version: "1.0" } }
    }));
    assert.equal(invalid.valid, false);
    assert.ok((invalid.issues as unknown[]).length > 0);

    const valid = textResult(await client.callTool({
      name: "validate_website_spec",
      arguments: {
        spec: {
          version: "1.0",
          intent: "presentation",
          project: {
            name: "Studio",
            slug: "studio",
            summary: "A focused portfolio website.",
            locale: "en",
            timezone: "UTC",
            currency: "EUR"
          },
          style: {
            theme: "clean",
            colorPalette: { primary: "#111827", accent: "#2563eb" }
          },
          pages: [{
            title: "Home",
            slug: "home",
            purpose: "home",
            sections: [{ key: "hero", type: "hero", heading: "Studio work" }]
          }]
        }
      }
    }));
    assert.equal(valid.valid, true);
    assert.equal((valid.summary as { pages: number }).pages, 1);
  } finally {
    await client.close();
    await server.close();
  }
});
