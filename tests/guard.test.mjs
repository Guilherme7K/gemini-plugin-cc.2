// Decisions of the agy PreToolUse guard, fed the same JSON agy sends on stdin.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const guard = path.join(root, "plugins", "gemini", "agy-plugins", "claude-companion-guard", "guard.cjs");
const workspace = path.join(os.tmpdir(), "guard-test-workspace");

function decide(policy, name, args) {
  const env = { ...process.env };
  delete env.GEMINI_COMPANION_POLICY;
  if (policy) {
    env.GEMINI_COMPANION_POLICY = policy;
  }
  const result = spawnSync(process.execPath, [guard], {
    input: JSON.stringify({ toolCall: { name, args }, workspacePaths: [workspace] }),
    env,
    encoding: "utf8"
  });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim() ? JSON.parse(result.stdout) : null;
}

const run = (command) => ({ CommandLine: command });

test("stays silent outside companion runs", () => {
  assert.equal(decide(null, "run_command", run("git push origin main")), null);
  assert.equal(decide(null, "write_to_file", { TargetFile: "/etc/hosts" }), null);
});

test("read-only runs allow read commands and deny everything else", () => {
  assert.equal(decide("read-only", "run_command", run("git status --short")), null);
  assert.equal(decide("read-only", "run_command", run("git diff HEAD~1")), null);
  assert.equal(decide("read-only", "run_command", run("npm test"))?.decision, "deny");
  assert.equal(decide("read-only", "write_to_file", { TargetFile: path.join(workspace, "a.txt") })?.decision, "deny");
});

test("write runs allow the dev allowlist", () => {
  assert.equal(decide("write", "run_command", run("npx vitest run src/a.test.ts")), null);
  assert.equal(decide("write", "run_command", run("git commit -m fix")), null);
  assert.equal(decide("write", "replace_file_content", { TargetFile: path.join(workspace, "src", "a.ts") }), null);
});

test("write runs deny dangerous commands", () => {
  for (const command of ["git push origin main", "git switch -c x", "git config user.name x", "ssh host", "docker ps", "npx prisma migrate deploy", "gh pr merge 1"]) {
    assert.equal(decide("write", "run_command", run(command))?.decision, "deny", command);
  }
});

test("write runs deny compound commands and commands outside the allowlist", () => {
  assert.equal(decide("write", "run_command", run("npm test && git push"))?.decision, "deny");
  assert.equal(decide("write", "run_command", run("node -e \"1\""))?.decision, "deny");
  assert.equal(decide("write", "run_command", run("curl https://example.com"))?.decision, "deny");
});

test("edits under .git and paths outside the workspace are denied", () => {
  assert.equal(decide("write", "write_to_file", { TargetFile: path.join(workspace, ".git", "config") })?.decision, "deny");
  assert.equal(decide("write", "write_to_file", { TargetFile: path.join(os.tmpdir(), "elsewhere.txt") })?.decision, "deny");
  assert.equal(decide("read-only", "view_file", { AbsolutePath: path.join(os.tmpdir(), "elsewhere.txt") })?.decision, "deny");
  assert.equal(decide("read-only", "run_command", run("ls .."))?.decision, "deny");
});

test("tools with effects outside the repository are denied", () => {
  for (const name of ["send_message", "call_mcp_tool", "read_url_content", "schedule"]) {
    assert.equal(decide("write", name, {})?.decision, "deny", name);
  }
});

test("browser tools are denied outside browser runs", () => {
  for (const policy of ["read-only", "write"]) {
    for (const name of ["open_browser_url", "browser_click_element", "capture_browser_screenshot", "execute_browser_javascript", "mcp_chrome_devtools_navigate_page"]) {
      assert.equal(decide(policy, name, {})?.decision, "deny", `${policy} ${name}`);
    }
    assert.equal(decide(policy, "invoke_subagent", { TypeName: "browser" })?.decision, "deny", policy);
  }
});

test("read-only browser runs drive pages only through the chrome-devtools-ro MCP server", () => {
  assert.equal(decide("browser", "call_mcp_tool", { ServerName: "chrome-devtools-ro", ToolName: "take_snapshot" }), null);
  assert.equal(decide("browser", "call_mcp_tool", { ServerName: "chrome-devtools-ro", ToolName: "new_page", Arguments: { url: "https://ads.google.com" } }), null);
  assert.equal(decide("browser", "read_url_content", {}), null);
  // The profile that can make changes is only for execution runs.
  assert.equal(decide("browser", "call_mcp_tool", { ServerName: "chrome-devtools", ToolName: "click" })?.decision, "deny");
  assert.equal(decide("browser", "call_mcp_tool", { ServerName: "\"chrome-devtools\"", ToolName: "click" })?.decision, "deny");
  // agy's own browser tools attach to the user's main Chrome profile.
  for (const name of ["open_browser_url", "browser_click_element", "read_browser_page", "mcp_chrome_devtools_new_page", "mcp_chrome_devtools_ro_click"]) {
    assert.equal(decide("browser", name, {})?.decision, "deny", name);
  }
  assert.equal(decide("browser", "invoke_subagent", { TypeName: "browser", Role: "Browser Agent" })?.decision, "deny");
  assert.equal(decide("browser", "call_mcp_tool", { ServerName: "github", ToolName: "create_issue" })?.decision, "deny");
  assert.equal(decide("browser", "send_message", {})?.decision, "deny");
  assert.equal(decide("browser", "send_message", { Recipient: "someone@example.com", Message: "hi" })?.decision, "deny");
  assert.equal(decide("browser", "write_to_file", { TargetFile: path.join(workspace, "a.txt") })?.decision, "deny");
  assert.equal(decide("browser", "run_command", run("git status")), null);
  assert.equal(decide("browser", "run_command", run("npm test"))?.decision, "deny");
});

test("browser execution runs drive pages only through the chrome-devtools MCP server", () => {
  assert.equal(decide("browser-execute", "call_mcp_tool", { ServerName: "chrome-devtools", ToolName: "click" }), null);
  assert.equal(decide("browser-execute", "call_mcp_tool", { ServerName: "chrome-devtools-ro", ToolName: "click" })?.decision, "deny");
  assert.equal(decide("browser-execute", "call_mcp_tool", { ServerName: "github", ToolName: "create_issue" })?.decision, "deny");
  assert.equal(decide("browser-execute", "open_browser_url", {})?.decision, "deny");
  assert.equal(decide("browser-execute", "write_to_file", { TargetFile: path.join(workspace, "a.txt") })?.decision, "deny");
  assert.equal(decide("browser-execute", "run_command", run("npm test"))?.decision, "deny");
});

test("chrome-devtools servers are denied outside browser runs", () => {
  for (const policy of ["read-only", "write"]) {
    for (const server of ["chrome-devtools", "chrome-devtools-ro"]) {
      assert.equal(decide(policy, "call_mcp_tool", { ServerName: server, ToolName: "take_snapshot" })?.decision, "deny", `${policy} ${server}`);
    }
  }
});

test("subagents may report back to the agent that started them", () => {
  const recipient = "5298129d-16b1-487b-b1db-e67b24605af3";
  for (const policy of ["read-only", "write", "browser", "browser-execute"]) {
    assert.equal(decide(policy, "send_message", { Recipient: recipient, Message: "done" }), null, policy);
    assert.equal(decide(policy, "send_message", { Recipient: `"${recipient}"`, Message: "done" }), null, policy);
  }
});
