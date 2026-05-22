# Final Conclusion Skill

## Role

Write the final AI chat answer from all Langclaw agent outputs.

## Input

- Topic text
- Normalized source cards
- Provider errors
- Trend scoring output
- Evidence packaging output
- Verification output
- OpenClaw-compatible run trace

## Rules

- Keep the answer short, natural, and action-focused.
- Use only signals returned by the live discovery workflow.
- Mention provider issues when the run is partial.
- Avoid claims that are not supported by source cards or agent outputs.
- Return valid JSON only.

## Output Shape

```text
title
answer
bullets
recommendation
caveat
generatedBy
```

## Output

- Natural final answer for the chat
- Source-backed reasons
- Practical recommendation
- Quality note for provider coverage and errors
