/**
 * EgressInspector — Monitors outbound data exfiltration patterns in Bash commands.
 * Priority 90: runs after PatternInspector (100), before RulesInspector (50).
 */
import type { Inspector, InspectionContext, InspectionResult } from '../types.ts';
import { ALLOW, deny, alert } from '../types.ts';
import { stripEnvVarPrefix, hasRawSocketEgress, stripShellQuoting } from '../command-normalize.ts';

const OUTBOUND_TOOLS = /\b(curl|wget|nc|ncat|fetch|http)\b/i;

const CREDENTIAL_PATTERNS: [RegExp, string][] = [
  [/sk_live_/i, 'Stripe live key'],
  [/sk_test_/i, 'Stripe test key'],
  [/sk-ant-/i, 'Anthropic API key'],
  [/sk-proj-/i, 'OpenAI project key'],
  [/PRIVATE KEY/i, 'Private key material'],
  [/whsec_/i, 'Webhook secret'],
];

const EGRESS_ALERTS: [RegExp, string][] = [
  [/curl.*(-X POST|--data|\s-d\s)/i, 'HTTP POST via curl'],
  [/wget.*(--post-data|--post-file)/i, 'HTTP POST via wget'],
  [/\bnc\s/i, 'Netcat usage'],
  [/\bncat\s/i, 'Ncat usage'],
  [/\bsocat\s/i, 'Socat usage'],
  [/sendmail\b/i, 'Sendmail usage'],
  [/^(printenv|env)\s*$/i, 'Environment variable dump'],
  [/^set\s*$/i, 'Shell variable dump'],
  [/python3?\s+-c\s/i, 'Python inline execution'],
  [/node\s+-e\s/i, 'Node inline execution'],
  [/ruby\s+-e\s/i, 'Ruby inline execution'],
  [/perl\s+-e\s/i, 'Perl inline execution'],
];

const PIPE_TO_SHELL = /\|\s*(sh|bash|zsh)\b/i;

class EgressInspector implements Inspector {
  name = 'EgressInspector';
  priority = 90;

  inspect(ctx: InspectionContext): InspectionResult {
    if (ctx.toolName !== 'Bash') return ALLOW;

    const raw =
      typeof ctx.toolInput === 'string'
        ? ctx.toolInput
        : (ctx.toolInput.command as string | undefined) ?? '';

    if (!raw) return ALLOW;

    // Normalize away env-var scaffolding so `FOO=x curl …` and `env FOO=x curl …`
    // can't hide an outbound tool or a credential string from the matchers below.
    // ALSO match a dequoted view so quote/escape evasion (`cu\rl`, `"curl"`,
    // `c'url'`) can't hide the outbound tool. Egress matching is "anywhere" by
    // threat model (an outbound tool + a credential present at all is the
    // signal), so the dequoted view is purely additive — it can only expose
    // evasion, never erase a prior match. `test(c)` below = "either view".
    const normalized = stripEnvVarPrefix(raw);
    const dequoted = stripEnvVarPrefix(stripShellQuoting(raw));
    const test = (re: RegExp) => re.test(normalized) || re.test(dequoted);

    // Raw-socket egress: `> /dev/tcp/HOST/PORT` opens a TCP socket without any
    // outbound tool, so it must be denied on its own. Checked against the raw
    // command (the redirection is never part of an env prefix).
    if (hasRawSocketEgress(raw)) {
      return deny('Raw-socket egress blocked: /dev/tcp//dev/udp redirection');
    }

    // Credential exfiltration — only when combined with outbound tools
    if (test(OUTBOUND_TOOLS)) {
      for (const [pattern, label] of CREDENTIAL_PATTERNS) {
        if (test(pattern)) {
          return deny(`Credential exfiltration blocked: ${label} sent via outbound tool`);
        }
      }
    }

    // Pipe to shell interpreter
    if (test(PIPE_TO_SHELL)) {
      return deny('Piping output to shell interpreter');
    }

    // Egress monitoring — alert but allow
    for (const [pattern, label] of EGRESS_ALERTS) {
      if (test(pattern)) {
        return alert(`Egress detected: ${label}`);
      }
    }

    return ALLOW;
  }
}

export function createEgressInspector(): Inspector {
  return new EgressInspector();
}
