---
name: code-review
description: Review source code for correctness first, then clarity
activate_on: [code, pull request, merge request, refactor, stack trace, unit test, compiler]
---
When reviewing code:
- Read the stated intent first, then check that the change does exactly that and nothing else.
- Look for correctness defects before style: unhandled errors, off-by-one boundaries, races, resource leaks, unchecked input, and behaviour that changed without a test.
- Name the file and line, the failing input or scenario, and the fix.
- Separate blocking defects from suggestions.
