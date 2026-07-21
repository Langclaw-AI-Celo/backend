import assert from "node:assert/strict";
import test from "node:test";

import { runProviderDiscovery } from "./providers";
import { discoverSurf } from "./providers/surf";
import { runLangclawWorkflow } from "./workflow";
import { jsonResponse, mockFetch, withEnv } from "../../test/helpers";

test("Celo workflow exposes Surf and Elfa provider trace when premium discovery is enabled", async () => {
  const restore = mockFetch((url) => {
    const parsed = new URL(url);

    if (
      parsed.hostname === "api.asksurf.ai" &&
      parsed.pathname === "/gateway/v1/search/web"
    ) {
      assert.equal(parsed.searchParams.get("q"), "Celo AI agent market signal");

      return jsonResponse({
        data: [
          {
            content: "Celo AI agent launches are attracting market attention.",
            title: "Celo market signal",
            url: "https://surf.test/celo-market-signal",
          },
        ],
      });
    }

    if (
      parsed.hostname === "api.elfa.ai" &&
      parsed.pathname === "/v2/data/trending-narratives"
    ) {
      return jsonResponse({
        data: {
          trending_narratives: [
            {
              mention_count: 42,
              name: "AI agents on Celo",
              narrative: "AI agents on Celo",
              sentiment: "bullish",
              source_links: ["https://x.com/example/status/1"],
            },
          ],
        },
        success: true,
      });
    }

    if (parsed.hostname === "www.hackquest.io") {
      return new Response("<html><body>Celo builders</body></html>", {
        headers: {
          "Content-Type": "text/html",
        },
      });
    }

    return jsonResponse({ data: [] });
  });

  try {
    await withEnv(
      {
        ELFA_API_KEY: "elfa-test-key",
        ELFA_ENABLED: "true",
        CELO_CHAIN_ENABLED: "false",
        OPENAI_API_KEY: "",
        OPENCLAW_ENABLED: "false",
        SURF_API_KEY: "surf-test-key",
        SURF_ENABLED: "true",
      },
      async () => {
        const payload = await runLangclawWorkflow(
          "Celo AI agent market signal",
          { chain: "celo" }
        );

        assert.ok(payload.sources.some((source) => source.provider === "Surf"));
        assert.ok(payload.sources.some((source) => source.provider === "Elfa"));
        assert.ok(
          payload.providerTrace?.some(
            (entry) => entry.provider === "Surf" && entry.status === "success"
          )
        );
        assert.ok(
          payload.providerTrace?.some(
            (entry) => entry.provider === "Elfa" && entry.status === "success"
          )
        );
      }
    );
  } finally {
    restore();
  }
});

test("premium discovery rejects oversized provider responses", async () => {
  const restore = mockFetch(() =>
    jsonResponse(
      {
        data: [
          {
            content: "Oversized provider result",
            title: "Oversized result",
            url: "https://surf.test/oversized",
          },
        ],
      },
      { headers: { "Content-Length": String(5 * 1024 * 1024 + 1) } },
    ),
  );

  try {
    await withEnv(
      {
        SURF_API_KEY: "surf-test-key",
        SURF_ENABLED: "true",
      },
      async () => {
        const result = await discoverSurf("Celo market pulse");

        assert.equal(result.sources.length, 0);
        assert.match(result.errors[0]?.message ?? "", /5242880 byte limit/);
      },
    );
  } finally {
    restore();
  }
});

test("premium research providers are skipped outside Celo scope", async () => {
  const restore = mockFetch((url) => {
    const parsed = new URL(url);

    if (parsed.hostname === "www.hackquest.io") {
      return new Response("<html><body>Celo builders</body></html>", {
        headers: {
          "Content-Type": "text/html",
        },
      });
    }

    return jsonResponse({ data: [] });
  });

  try {
    const result = await runProviderDiscovery("Find smart money on Mantle", {
      chain: "mantle",
    });

    assert.ok(
      result.providerTrace.some(
        (entry) =>
          entry.provider === "Surf" &&
          entry.status === "skipped" &&
          entry.scope === "out-of-scope"
      )
    );
    assert.ok(
      result.providerTrace.some(
        (entry) =>
          entry.provider === "Elfa" &&
          entry.status === "skipped" &&
          entry.scope === "out-of-scope"
      )
    );
  } finally {
    restore();
  }
});

test("Celo discovery preserves Surf results when Elfa fails", async () => {
  const restore = mockFetch((url) => {
    const parsed = new URL(url);

    if (parsed.hostname === "api.asksurf.ai") {
      return jsonResponse({
        data: [
          {
            content: "Celo stablecoin activity is increasing.",
            title: "Celo stablecoin pulse",
            url: "https://surf.test/celo-pulse-1",
          },
          {
            content: "Celo liquidity remains active.",
            title: "Celo liquidity pulse",
            url: "https://surf.test/celo-pulse-2",
          },
          {
            content: "Celo social activity is growing.",
            title: "Celo social pulse",
            url: "https://surf.test/celo-pulse-3",
          },
        ],
      });
    }

    if (parsed.hostname === "api.elfa.ai") {
      return new Response("Elfa unavailable", {
        status: 502,
        statusText: "Bad Gateway",
      });
    }

    assert.fail(`Unexpected provider request: ${url}`);
  });

  try {
    await withEnv(
      {
        ELFA_API_KEY: "elfa-test-key",
        ELFA_ENABLED: "true",
        SURF_API_KEY: "surf-test-key",
        SURF_ENABLED: "true",
      },
      async () => {
        const result = await runProviderDiscovery("Celo market pulse", {
          chain: "celo",
        });

        assert.equal(result.sources.length, 3);
        assert.ok(result.sources.every((source) => source.provider === "Surf"));
        assert.ok(
          result.errors.some(
            (error) =>
              error.provider === "Elfa" && /Elfa unavailable/.test(error.message)
          )
        );
        assert.ok(
          result.providerTrace.some(
            (entry) =>
              entry.provider === "Elfa" &&
              entry.scope === "celo-premium" &&
              entry.status === "failed"
          )
        );
        assert.ok(
          result.providerTrace.some(
            (entry) =>
              entry.provider === "Tavily" &&
              entry.scope === "legacy-fallback" &&
              entry.status === "skipped"
          )
        );
      }
    );
  } finally {
    restore();
  }
});

test("Celo legacy discovery enriches a neutral topic with on-chain context", async () => {
  const queries: string[] = [];
  const restore = mockFetch((url) => {
    const parsed = new URL(url);

    if (parsed.hostname === "www.hackquest.io") {
      return new Response(
        '<html><body><a href="/hackathons/celo-builders">Celo builders</a></body></html>',
        { headers: { "Content-Type": "text/html" } }
      );
    }

    assert.equal(parsed.hostname, "api.search.brave.com");
    const query = parsed.searchParams.get("q") ?? "";
    queries.push(query);

    if (query.startsWith("site:x.com")) {
      return jsonResponse({
        web: {
          results: [
            {
              description: "ReFi adoption discussion",
              title: "Celo ReFi discussion",
              url: "https://x.com/celo/status/123",
            },
          ],
        },
      });
    }

    if (query.includes("Celo on-chain data")) {
      return jsonResponse({
        web: {
          results: [
            {
              description: "Celo on-chain ReFi documentation",
              title: "Celo ReFi documentation",
              url: "https://docs.celo.org/refi",
            },
          ],
        },
      });
    }

    assert.match(query, /site:hackquest\.io/);
    return jsonResponse({
      web: {
        results: [
          {
            description: "Celo ReFi builder project",
            title: "Celo ReFi project",
            url: "https://www.hackquest.io/projects/celo-refi",
          },
        ],
      },
    });
  });

  try {
    await withEnv(
      {
        BRAVE_SEARCH_API_KEY: "brave-test-key",
        ELFA_API_KEY: undefined,
        ELFA_ENABLED: "false",
        GITHUB_TOKEN: undefined,
        SURF_API_KEY: undefined,
        SURF_ENABLED: "false",
        TAVILY_API_KEY: undefined,
        X_DISCOVERY_PROVIDER: "brave",
      },
      async () => {
        const result = await runProviderDiscovery("Regenerative finance", {
          chain: "celo",
        });

        assert.ok(
          queries.includes(
            "Regenerative finance Celo on-chain data AI agent documentation"
          )
        );
        assert.ok(
          result.sources.some(
            (source) => source.url === "https://docs.celo.org/refi"
          )
        );
        assert.ok(
          result.sources.some(
            (source) =>
              source.provider === "X" && source.type === "x_post"
          )
        );
        assert.ok(
          result.errors.some((error) => error.provider === "GitHub")
        );
      }
    );
  } finally {
    restore();
  }
});

test("legacy discovery normalizes X, GitHub, Tavily, and HackQuest results", async () => {
  const restore = mockFetch((url, init) => {
    const parsed = new URL(url);

    if (parsed.hostname === "api.x.com") {
      assert.match(parsed.searchParams.get("query") ?? "", /Mantle developer activity/);

      return jsonResponse({
        data: [
          {
            author_id: "user-1",
            created_at: "2026-07-18T10:00:00.000Z",
            id: "tweet-1",
            public_metrics: {
              like_count: 12,
              quote_count: 2,
              reply_count: 3,
              retweet_count: 4,
            },
            text: "Mantle builders shipped a new agent integration.",
          },
          {
            id: "tweet-2",
            text: "A second Mantle developer update.",
          },
        ],
        includes: {
          users: [{ id: "user-1", name: "Builder", username: "builder" }],
        },
      });
    }

    if (parsed.hostname === "api.github.com") {
      return jsonResponse({
        items: [
          {
            description: "Agent tooling for Mantle",
            forks_count: 5,
            full_name: "mantle/agent-tooling",
            html_url: "https://github.com/mantle/agent-tooling",
            id: 101,
            language: "TypeScript",
            open_issues_count: 2,
            owner: { login: "mantle" },
            stargazers_count: 40,
            updated_at: "2026-07-18T09:00:00.000Z",
          },
          {
            description: null,
            full_name: "community/minimal-agent",
            html_url: "https://github.com/community/minimal-agent",
            id: 102,
            language: null,
          },
        ],
      });
    }

    if (parsed.hostname === "api.tavily.com") {
      const body = JSON.parse(String(init?.body)) as { query: string };

      if (body.query.includes("site:hackquest.io")) {
        return jsonResponse({
          results: [
            {
              content: "Mantle hackathon project",
              score: 0.8,
              title: "Mantle project",
              url: "https://www.hackquest.io/projects/mantle-agent",
            },
          ],
        });
      }

      assert.match(body.query, /Celo on-chain data AI agent documentation/);
      return jsonResponse({
        results: [
          {
            content: "Cross-chain agent documentation",
            score: 0.9,
            title: "Agent documentation",
            url: "https://docs.example.test/agents",
          },
          {
            raw_content: "Documentation without optional title and URL",
          },
        ],
      });
    }

    assert.equal(parsed.hostname, "www.hackquest.io");
    return new Response(
      [
        "<html><style>.hidden{display:none}</style><body>",
        "Registration 2 days left ",
        '<a href="/hackathons/mantle-turing">Mantle Turing Test Hackathon</a> ',
        "Participants 1,234 Total Prizes: 50,000 USD &amp; builder support",
        "<script>ignore()</script></body></html>",
      ].join(""),
      { headers: { "Content-Type": "text/html" } }
    );
  });

  try {
    await withEnv(
      {
        BRAVE_SEARCH_API_KEY: undefined,
        GITHUB_TOKEN: "github-test-key",
        TAVILY_API_KEY: "tavily-test-key",
        X_BEARER_TOKEN: "x-test-key",
        X_DISCOVERY_PROVIDER: "x-api",
      },
      async () => {
        const result = await runProviderDiscovery("Mantle developer activity", {
          chain: "mantle",
        });

        assert.ok(
          result.sources.some(
            (source) =>
              source.provider === "X" &&
              source.url === "https://x.com/builder/status/tweet-1"
          )
        );
        assert.ok(
          result.sources.some(
            (source) =>
              source.provider === "X" &&
              source.url === "https://x.com/i/web/status/tweet-2"
          )
        );
        assert.ok(
          result.sources.some(
            (source) =>
              source.provider === "GitHub" &&
              source.title === "community/minimal-agent"
          )
        );
        assert.ok(
          result.sources.some(
            (source) =>
              source.provider === "Tavily" &&
              source.title === "Documentation result"
          )
        );
        assert.ok(
          result.sources.some(
            (source) =>
              source.provider === "HackQuest" &&
              source.title === "Mantle Turing Test Hackathon"
          )
        );
      }
    );
  } finally {
    restore();
  }
});

test("legacy web discovery falls back from Tavily to Brave and keeps partial results", async () => {
  const restore = mockFetch((url) => {
    const parsed = new URL(url);

    if (parsed.hostname === "api.tavily.com") {
      return new Response("Tavily quota exceeded", {
        status: 429,
        statusText: "Too Many Requests",
      });
    }

    if (parsed.hostname === "api.github.com") {
      return jsonResponse({ message: "GitHub denied the request" }, { status: 403 });
    }

    if (parsed.hostname === "www.hackquest.io") {
      return new Response("HackQuest unavailable", { status: 503 });
    }

    assert.equal(parsed.hostname, "api.search.brave.com");
    const query = parsed.searchParams.get("q") ?? "";
    const urlValue = query.startsWith("site:x.com")
      ? "https://twitter.com/celo/status/456"
      : query.includes("site:hackquest.io")
        ? "https://www.hackquest.io/hackathons/celo"
        : "https://docs.celo.org/build";

    return jsonResponse({
      web: {
        results: [
          {
            age: "1 day ago",
            description: "Brave fallback result",
            extra_snippets: ["Additional context"],
            title: "Brave result",
            url: urlValue,
          },
        ],
      },
    });
  });

  try {
    await withEnv(
      {
        BRAVE_SEARCH_API_KEY: "brave-test-key",
        ELFA_API_KEY: undefined,
        ELFA_ENABLED: "false",
        GITHUB_TOKEN: "github-test-key",
        SURF_API_KEY: undefined,
        SURF_ENABLED: "false",
        TAVILY_API_KEY: "tavily-test-key",
        X_DISCOVERY_PROVIDER: "brave",
      },
      async () => {
        const result = await runProviderDiscovery("Celo fallback research", {
          chain: "celo",
        });

        assert.ok(result.sources.some((source) => source.provider === "X"));
        assert.ok(
          result.sources.some(
            (source) =>
              source.provider === "Tavily" &&
              source.url === "https://docs.celo.org/build"
          )
        );
        assert.ok(
          result.errors.some(
            (error) =>
              error.provider === "GitHub" && /denied/.test(error.message)
          )
        );
        assert.ok(
          result.errors.some(
            (error) =>
              error.provider === "HackQuest" && /unavailable/.test(error.message)
          )
        );
      }
    );
  } finally {
    restore();
  }
});

test("Celo workflow returns combined live signals for broad prompts that now run on-chain enrichment", async () => {
  const restore = mockFetch((url) => {
    const parsed = new URL(url);

    if (
      parsed.hostname === "api.asksurf.ai" &&
      parsed.pathname === "/gateway/v1/search/web"
    ) {
      return jsonResponse({
        data: [
          {
            content: "Celo AI agent market narratives are active.",
            title: "Celo market context",
            url: "https://surf.test/celo-market-context-1",
          },
          {
            content: "Celo liquidity is improving across major pools.",
            title: "Celo liquidity context",
            url: "https://surf.test/celo-market-context-2",
          },
          {
            content: "Celo builders are shipping new agent tooling.",
            title: "Celo builder context",
            url: "https://surf.test/celo-market-context-3",
          },
        ],
      });
    }

    if (
      parsed.hostname === "api.elfa.ai" &&
      parsed.pathname === "/v2/data/trending-narratives"
    ) {
      return jsonResponse({
        data: {
          trending_narratives: [
            {
              mention_count: 18,
              name: "Celo AI agents",
              narrative: "Celo AI agents",
              sentiment: "bullish",
              source_links: ["https://x.com/example/status/2"],
            },
          ],
        },
        success: true,
      });
    }

    if (
      parsed.hostname === "api.dexscreener.com" &&
      parsed.pathname === "/latest/dex/search"
    ) {
      return jsonResponse({
        pairs: [
          {
            baseToken: { symbol: "CELO" },
            chainId: "celo",
            dexId: "ubeswap",
            liquidity: { usd: 245000 },
            priceUsd: "1.03",
          },
        ],
      });
    }

    if (parsed.hostname === "www.hackquest.io") {
      return new Response("<html><body>Celo builders</body></html>", {
        headers: {
          "Content-Type": "text/html",
        },
      });
    }

    return jsonResponse({
      data: [],
      pairs: [],
      results: [],
      web: { results: [] },
    });
  });

  try {
    await withEnv(
      {
        ELFA_API_KEY: "elfa-test-key",
        ELFA_ENABLED: "true",
        CELO_CHAIN_ENABLED: "false",
        OPENAI_API_KEY: "",
        OPENCLAW_ENABLED: "false",
        SURF_API_KEY: "surf-test-key",
        SURF_ENABLED: "true",
      },
      async () => {
        const payload = await runLangclawWorkflow(
          "Celo AI agent market narrative",
          { chain: "celo" }
        );

        assert.ok(payload.onChain);
        assert.equal(payload.onChainSkippedReason, undefined);
        assert.equal(payload.signals.social.status, "success");
        assert.equal(payload.signals.onchain.status, "success");
        assert.equal(payload.signals.combined.status, "success");
        assert.ok(payload.signals.social.providers.includes("Elfa"));
        assert.ok(payload.signals.onchain.providers.includes("Surf"));
        assert.ok(payload.signals.onchain.toolIds.length > 0);
        assert.match(payload.signals.combined.summary, /converg/i);
      }
    );
  } finally {
    restore();
  }
});
