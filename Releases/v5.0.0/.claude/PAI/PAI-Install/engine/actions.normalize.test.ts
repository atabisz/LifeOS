import { describe, expect, it } from "bun:test";

import { collectHookAllowlist, normalizeHookCommand } from "./actions";

describe("normalizeHookCommand", () => {
  const tsAllowlist = new Set(["X.hook.ts", "statusline-command.sh", "ContextReduction.hook.sh"]);

  const cases: Array<{
    name: string;
    input: string;
    opts: Parameters<typeof normalizeHookCommand>[1];
    expected: string | null;
  }> = [
    {
      name: "win32 bare ts uses home-relative bun when bun lives under .bun/bin",
      input: "$HOME/.claude/hooks/X.hook.ts",
      opts: {
        platform: "win32",
        bunPath: "C:\\Users\\example\\.bun\\bin\\bun.exe",
        bashPath: "C:\\Program Files\\Git\\bin\\bash.exe",
        allowlist: tsAllowlist,
      },
      expected: "\"$HOME/.bun/bin/bun.exe\" $HOME/.claude/hooks/X.hook.ts",
    },
    {
      name: "darwin bare ts stays byte-identical",
      input: "$HOME/.claude/hooks/X.hook.ts",
      opts: {
        platform: "darwin",
        bunPath: "/Users/example/.bun/bin/bun",
        bashPath: "/bin/bash",
        allowlist: tsAllowlist,
      },
      expected: "$HOME/.claude/hooks/X.hook.ts",
    },
    {
      name: "win32 keeps existing home-relative bun prefix stable",
      input: "\"$HOME/.bun/bin/bun.exe\" $HOME/.claude/hooks/X.hook.ts",
      opts: {
        platform: "win32",
        bunPath: "C:\\Users\\example\\.bun\\bin\\bun.exe",
        bashPath: "C:\\Program Files\\Git\\bin\\bash.exe",
        allowlist: tsAllowlist,
      },
      expected: "\"$HOME/.bun/bin/bun.exe\" $HOME/.claude/hooks/X.hook.ts",
    },
    {
      name: "darwin strips home-relative bun prefix",
      input: "\"$HOME/.bun/bin/bun.exe\" $HOME/.claude/hooks/X.hook.ts",
      opts: {
        platform: "darwin",
        bunPath: "/Users/example/.bun/bin/bun",
        bashPath: "/bin/bash",
        allowlist: tsAllowlist,
      },
      expected: "$HOME/.claude/hooks/X.hook.ts",
    },
    {
      name: "win32 rewrites bare bun prefix back to bun.exe",
      input: "bun $HOME/.claude/hooks/X.hook.ts",
      opts: {
        platform: "win32",
        bunPath: "D:\\Tools\\bun.exe",
        bashPath: "C:\\Program Files\\Git\\bin\\bash.exe",
        allowlist: tsAllowlist,
      },
      expected: "\"D:\\Tools\\bun.exe\" $HOME/.claude/hooks/X.hook.ts",
    },
    {
      name: "darwin strips bare bun prefix",
      input: "bun $HOME/.claude/hooks/X.hook.ts",
      opts: {
        platform: "darwin",
        bunPath: "/usr/local/bin/bun",
        bashPath: "/bin/bash",
        allowlist: tsAllowlist,
      },
      expected: "$HOME/.claude/hooks/X.hook.ts",
    },
    {
      name: "win32 rewrites node prefix to bun.exe",
      input: "node $HOME/.claude/hooks/X.hook.ts",
      opts: {
        platform: "win32",
        bunPath: "D:\\Tools\\bun.exe",
        bashPath: "C:\\Program Files\\Git\\bin\\bash.exe",
        allowlist: tsAllowlist,
      },
      expected: "\"D:\\Tools\\bun.exe\" $HOME/.claude/hooks/X.hook.ts",
    },
    {
      name: "darwin strips node prefix",
      input: "node $HOME/.claude/hooks/X.hook.ts",
      opts: {
        platform: "darwin",
        bunPath: "/usr/local/bin/bun",
        bashPath: "/bin/bash",
        allowlist: tsAllowlist,
      },
      expected: "$HOME/.claude/hooks/X.hook.ts",
    },
    {
      name: "win32 rewrites bash prefix on ts to bun.exe",
      input: "bash $HOME/.claude/hooks/X.hook.ts",
      opts: {
        platform: "win32",
        bunPath: "C:\\Users\\example\\.bun\\bin\\bun.exe",
        bashPath: "C:\\Program Files\\Git\\bin\\bash.exe",
        allowlist: tsAllowlist,
      },
      expected: "\"$HOME/.bun/bin/bun.exe\" $HOME/.claude/hooks/X.hook.ts",
    },
    {
      name: "darwin strips bash prefix on ts",
      input: "bash $HOME/.claude/hooks/X.hook.ts",
      opts: {
        platform: "darwin",
        bunPath: "/Users/example/.bun/bin/bun",
        bashPath: "/bin/bash",
        allowlist: tsAllowlist,
      },
      expected: "$HOME/.claude/hooks/X.hook.ts",
    },
    {
      name: "win32 preserves quoted script token with spaces",
      input: "\"$HOME/My Hooks/X.hook.ts\"",
      opts: {
        platform: "win32",
        bunPath: "C:\\Users\\example\\.bun\\bin\\bun.exe",
        bashPath: "C:\\Program Files\\Git\\bin\\bash.exe",
        allowlist: tsAllowlist,
      },
      expected: "\"$HOME/.bun/bin/bun.exe\" \"$HOME/My Hooks/X.hook.ts\"",
    },
    {
      name: "win32 preserves trailing args verbatim",
      input: "$HOME/.claude/hooks/X.hook.ts --flag \"two words\"",
      opts: {
        platform: "win32",
        bunPath: "C:\\Users\\example\\.bun\\bin\\bun.exe",
        bashPath: "C:\\Program Files\\Git\\bin\\bash.exe",
        allowlist: tsAllowlist,
      },
      expected: "\"$HOME/.bun/bin/bun.exe\" $HOME/.claude/hooks/X.hook.ts --flag \"two words\"",
    },
    {
      name: "win32 sh uses bash when available",
      input: "$HOME/.claude/hooks/ContextReduction.hook.sh",
      opts: {
        platform: "win32",
        bunPath: "C:\\Users\\example\\.bun\\bin\\bun.exe",
        bashPath: "C:\\Program Files\\Git\\bin\\bash.exe",
        allowlist: tsAllowlist,
      },
      expected: "bash $HOME/.claude/hooks/ContextReduction.hook.sh",
    },
    {
      name: "win32 sh drops when bash is missing",
      input: "$HOME/.claude/hooks/ContextReduction.hook.sh",
      opts: {
        platform: "win32",
        bunPath: "C:\\Users\\example\\.bun\\bin\\bun.exe",
        bashPath: null,
        allowlist: tsAllowlist,
      },
      expected: null,
    },
    {
      name: "darwin sh stays bare",
      input: "$HOME/.claude/hooks/ContextReduction.hook.sh",
      opts: {
        platform: "darwin",
        bunPath: "/Users/example/.bun/bin/bun",
        bashPath: "/bin/bash",
        allowlist: tsAllowlist,
      },
      expected: "$HOME/.claude/hooks/ContextReduction.hook.sh",
    },
    {
      name: "win32 unexpected allowlisted extension falls back to bun",
      input: "$HOME/.claude/hooks/Weird.hook.zzz",
      opts: {
        platform: "win32",
        bunPath: "C:\\Users\\example\\.bun\\bin\\bun.exe",
        bashPath: "C:\\Program Files\\Git\\bin\\bash.exe",
        allowlist: new Set(["Weird.hook.zzz"]),
      },
      expected: "\"$HOME/.bun/bin/bun.exe\" $HOME/.claude/hooks/Weird.hook.zzz",
    },
    {
      name: "non-allowlisted command stays unchanged on win32",
      input: "bun $HOME/.claude/hooks/UserOwned.hook.ts",
      opts: {
        platform: "win32",
        bunPath: "C:\\Users\\example\\.bun\\bin\\bun.exe",
        bashPath: "C:\\Program Files\\Git\\bin\\bash.exe",
        allowlist: new Set(["X.hook.ts"]),
      },
      expected: "bun $HOME/.claude/hooks/UserOwned.hook.ts",
    },
    {
      name: "non-allowlisted command stays unchanged on darwin",
      input: "bun $HOME/.claude/hooks/UserOwned.hook.ts",
      opts: {
        platform: "darwin",
        bunPath: "/Users/example/.bun/bin/bun",
        bashPath: "/bin/bash",
        allowlist: new Set(["X.hook.ts"]),
      },
      expected: "bun $HOME/.claude/hooks/UserOwned.hook.ts",
    },
    {
      name: "statusline sh normalizes on win32",
      input: "$HOME/.claude/PAI/statusline-command.sh",
      opts: {
        platform: "win32",
        bunPath: "C:\\Users\\example\\.bun\\bin\\bun.exe",
        bashPath: "C:\\Program Files\\Git\\bin\\bash.exe",
        allowlist: tsAllowlist,
      },
      expected: "bash $HOME/.claude/PAI/statusline-command.sh",
    },
  ];

  for (const testCase of cases) {
    it(testCase.name, () => {
      expect(normalizeHookCommand(testCase.input, testCase.opts)).toBe(testCase.expected);
    });
  }

  it("is idempotent on win32", () => {
    const opts: Parameters<typeof normalizeHookCommand>[1] = {
      platform: "win32",
      bunPath: "C:\\Users\\example\\.bun\\bin\\bun.exe",
      bashPath: "C:\\Program Files\\Git\\bin\\bash.exe",
      allowlist: tsAllowlist,
    };
    const once = normalizeHookCommand("$HOME/.claude/hooks/X.hook.ts", opts);
    expect(once).toBe("\"$HOME/.bun/bin/bun.exe\" $HOME/.claude/hooks/X.hook.ts");
    expect(normalizeHookCommand(once!, opts)).toBe(once);
  });
});

describe("collectHookAllowlist", () => {
  it("collects bundled hook and status line basenames", () => {
    const allowlist = collectHookAllowlist({
      hooks: {
        PreToolUse: [
          {
            matcher: "Bash",
            hooks: [
              { type: "command", command: "$HOME/.claude/hooks/SecurityPipeline.hook.ts" },
              { type: "command", command: "$HOME/.claude/hooks/ContextReduction.hook.sh" },
              { type: "http", url: "http://localhost:31337/hooks/skill-guard" },
            ],
          },
        ],
      },
      statusLine: {
        type: "command",
        command: "$HOME/.claude/PAI/statusline-command.sh",
      },
    });

    expect(allowlist).toEqual(
      new Set([
        "SecurityPipeline.hook.ts",
        "ContextReduction.hook.sh",
        "statusline-command.sh",
      ]),
    );
  });

  // Regression: on Windows RE-install the on-disk file is already normalized
  // (`"$HOME/.bun/bin/bun.exe" X.hook.ts`). The allowlist must still key on the
  // SCRIPT token, not the first (interpreter) token — else it collects
  // "bun.exe" and re-normalization double-prefixes. See ISA ISC-4 / ISC-11.3.
  it("collects the script basename from an already-prefixed command", () => {
    const allowlist = collectHookAllowlist({
      hooks: {
        PreToolUse: [
          {
            hooks: [
              { type: "command", command: "\"$HOME/.bun/bin/bun.exe\" $HOME/.claude/hooks/SecurityPipeline.hook.ts" },
              { type: "command", command: "bash $HOME/.claude/hooks/ContextReduction.hook.sh" },
            ],
          },
        ],
      },
    });

    expect(allowlist).toEqual(
      new Set(["SecurityPipeline.hook.ts", "ContextReduction.hook.sh"]),
    );
    expect(allowlist.has("bun.exe")).toBe(false);
  });

  it("re-install of an already-normalized win32 command is idempotent", () => {
    const settings = {
      hooks: {
        PreToolUse: [
          { hooks: [ { type: "command", command: "\"$HOME/.bun/bin/bun.exe\" $HOME/.claude/hooks/SecurityPipeline.hook.ts" } ] },
        ],
      },
    };
    const allowlist = collectHookAllowlist(settings);
    const cmd = settings.hooks.PreToolUse[0].hooks[0].command;
    const out = normalizeHookCommand(cmd, {
      platform: "win32",
      bunPath: "C:\\Users\\example\\.bun\\bin\\bun.exe",
      bashPath: null,
      allowlist,
    });
    expect(out).toBe("\"$HOME/.bun/bin/bun.exe\" $HOME/.claude/hooks/SecurityPipeline.hook.ts");
    expect((out!.match(/bun\.exe/g) || []).length).toBe(1);
  });
});
