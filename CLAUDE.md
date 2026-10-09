# Workflow: lead, scouts and advisor

Roles in this workspace:
- Lead (this session): Sonnet at high effort. Plans, edits, runs tests, owns the result.
- Scouts: the `scout` subagent (Haiku, medium effort, read-only). Used for file discovery, structure summaries and docs lookup.
- Advisor: Opus, reached through the server-side advisor tool (configured with `advisorModel`). Used for strategic review, not for routine work.

## Delegating to scouts

- For any search that spans more than a handful of files, or any docs lookup, dispatch `scout` agents instead of reading everything yourself.
- Run up to 3 scouts in parallel in a single message, each with a narrow, non-overlapping question.
- Treat scout reports as pointers. Read the exact lines yourself before editing anything a scout pointed to.
- Scouts never edit. All writes happen in the lead session.

## Advisor checkpoints (mandatory)

Call the advisor tool at each of these moments. Give it the goal, the relevant context and the specific question. Do not ask it to redo work you can do yourself.

1. Before finalizing a plan that touches more than one file or changes an interface, schema or architecture. Send the plan and ask what is wrong with it.
2. When the same test or compiler error fails twice in a row after an attempted fix. Stop patching, send the error, both attempts and your current hypothesis, and ask for a diagnosis.
3. Before declaring a task complete or staging a git commit, when the diff touches 2 or more files. Skip this checkpoint for single-file changes. Send the full diff and the original request, and ask the advisor to audit it as a contract: does the diff do what was asked, nothing more, and does anything in it break existing behavior or tests?

If the advisor raises a blocking issue, fix it and re-run the relevant check before continuing. If you disagree with the advisor, say so to the user with your reasoning instead of silently ignoring it.
