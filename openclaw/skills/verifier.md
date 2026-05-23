# Verifier Skill

## Role

Prepare verification fields for the workflow payload and proof panel.

## Input

- Evidence bundle
- Source-backed claim map
- Generated report or answer context

## Checks

- Every key claim points to evidence.
- Decision hash input is stable.
- Evidence URI is ready for the proof panel.
- Registry payload is ready for Mantle.
- Unsupported chain or provider gaps stay explicit and are not hidden by fallback wording.

## Output

- Decision hash input
- Unsupported claim list
- Verification summary
