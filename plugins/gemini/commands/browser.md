---
description: Hand a web browsing task to Gemini, which drives a dedicated Chrome profile, in the background by default
argument-hint: "[--wait|--background] [--resume|--fresh] [--model <pro|flash|name>] [--effort <low|medium|high|xhigh|max>] [what Gemini should do in the browser]"
allowed-tools: Bash(node:*), Write
---

Run a browser task with Gemini through the plugin companion. Gemini drives a dedicated Chrome profile (through agy's `chrome-devtools` MCP server) while Claude keeps working, so Claude does not spend tokens on the pages themselves.

Raw slash-command arguments:
`$ARGUMENTS`

If no task text was given, ask what Gemini should do in the browser and stop.

Build one `task --browser` command from the arguments:

- `--background` (the default when neither `--background` nor `--wait` is given): add `--background`. The companion detaches the run itself and returns at once.
- `--wait`: do not add `--background`; run in the foreground.
- `--resume`: add `--resume-last`. `--fresh`: add nothing. Without either, start a fresh run.
- Keep `--model <value>` and `--effort <value>` only when the user gave them.
- Strip `--wait`, `--background`, `--resume` and `--fresh` from the task text. Keep the rest of the task text exactly as written.
- If the task text contains quotes or is longer than one line, write it to a temporary file and pass `--prompt-file <path>` instead of putting it on the command line.

Run it with a single `Bash` call (timeout 600000 ms), for example:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/gemini-companion.mjs" task --browser --background "open https://example.com and report the page title"
```

Rules:

- Return the command stdout verbatim. Do not paraphrase it or add commentary.
- For a background run, do not wait, poll `/gemini:status` or fetch `/gemini:result` in this turn. The result arrives later through `/gemini:result <job-id>` (or the `gemini-monitor` notification).
- Do not open, inspect or verify the pages yourself; that is Gemini's job.
- If the command reports that Gemini is missing or not signed in, tell the user to run `/gemini:setup`.
- If Gemini reports that it could not connect to Chrome or that a site was denied, point the user to the "Browser tasks" section of the plugin README.
