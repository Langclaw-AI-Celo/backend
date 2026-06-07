import assert from "node:assert/strict";
import test from "node:test";

import { withEnv } from "../test/helpers";
import { readPreferredAgentConfig, readPreferredAgentId } from "./agent-id";
import { getProductChain } from "./chain-config";

const celo = getProductChain("celo");

test("preferred agent config uses ERC-8004 agent id before Self agent id", async () => {
  await withEnv(
    {
      CELO_ERC8004_AGENT_ID: "9109",
      CELO_SELF_AGENT_ID: "133",
      LANGCLAW_AGENT_ID: "77",
    },
    async () => {
      const preferredAgent = readPreferredAgentConfig(celo);

      assert.equal(preferredAgent.id, 9109n);
      assert.equal(preferredAgent.label, "CELO_ERC8004_AGENT_ID");
      assert.equal(preferredAgent.source, "erc8004");
      assert.equal(readPreferredAgentId(celo), 9109n);
    }
  );
});

test("preferred agent config falls back to Self agent id when ERC-8004 id is absent", async () => {
  await withEnv(
    {
      CELO_ERC8004_AGENT_ID: undefined,
      CELO_SELF_AGENT_ID: "133",
      LANGCLAW_AGENT_ID: "77",
    },
    async () => {
      const preferredAgent = readPreferredAgentConfig(celo);

      assert.equal(preferredAgent.id, 133n);
      assert.equal(preferredAgent.label, "CELO_SELF_AGENT_ID");
      assert.equal(preferredAgent.source, "self");
    }
  );
});
