---
name: structured-output
description: Produce machine-readable output that parses on the first try
activate_on: [json, yaml, csv, markdown table, as a table, in a table, schema, structured]
---
When the task asks for structured output:
- Emit exactly the requested format and nothing around it: no preamble, no code fence unless asked.
- Keep every field name and type the task or schema specifies; use null for an unknown value rather than inventing one.
- One record per item, in a stable order.
- Check that the output parses before you answer.
