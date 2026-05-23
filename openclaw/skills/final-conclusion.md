# Final Conclusion Skill

## Role

Write the final user-facing chat answer from all Langclaw agent outputs.

## Input

- Topic text
- Normalized source cards
- Provider errors
- Trend scoring output
- Evidence packaging output
- Verification output
- OpenClaw-compatible run trace
- Structured report, if present
- On-chain enrichment summary, if present
- Chain context with `productChain` and prompt-inferred `analysisChain`

## Rules

- Keep the answer short, natural, and action-focused.
- If the research workflow is running through OpenClaw and final synthesis is enabled, this step should also run through OpenClaw before any fallback path is used.
- Prefer plain chat-style Markdown, not an internal report template.
- Treat the structured report as supporting context, not the answer format.
- Use only signals returned by the live discovery workflow.
- Mention provider issues when the run is partial.
- If `analysisChain` differs from `productChain`, say so plainly when it matters.
- If the requested chain is unsupported for on-chain analysis, state that explicitly instead of silently falling back.
- Avoid claims that are not supported by source cards or agent outputs.
- Do not claim proof upload, anchoring, transaction submission, or chain-write status inside the answer body.
- Keep the caveat singular and coverage-focused.
- Return valid JSON only.

## Output Shape

```text
conclusion
```

## Output

- Natural final answer for the chat
- Source-backed reasons
- Practical recommendation
- Quality note for provider coverage and errors
