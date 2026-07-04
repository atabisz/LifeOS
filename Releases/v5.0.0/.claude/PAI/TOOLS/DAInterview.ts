#!/usr/bin/env bun

/**
 * DAInterview.ts -- Interactive CLI wizard for creating DA identities
 *
 * Usage:
 *   bun PAI/TOOLS/DAInterview.ts                    # Quick mode (default)
 *   bun PAI/TOOLS/DAInterview.ts --depth standard   # Quick + Standard
 *   bun PAI/TOOLS/DAInterview.ts --depth deep       # All phases
 *   bun PAI/TOOLS/DAInterview.ts --update           # Update existing primary DA
 *   bun PAI/TOOLS/DAInterview.ts --update --da devi # Update specific DA
 *
 * Creates:
 *   PAI/USER/DA/{name}/DA_IDENTITY.yaml
 *   PAI/USER/DA/{name}/DA_IDENTITY.md
 *   PAI/USER/DA/{name}/growth.jsonl
 *   PAI/USER/DA/{name}/opinions.yaml
 *   PAI/USER/DA/{name}/diary.jsonl
 *   Updates PAI/USER/DA/_registry.yaml
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

// ── Paths ────────────────────────────────────────────────────────────────────
// Resolve relative to this script's own location. The script ships at
// PAI/TOOLS/DAInterview.ts, so PAI/USER/DA/_presets.yaml is two levels up.
// This works whether the script runs from a fresh clone (~/PAI-fresh/...) or
// from an installed location (~/.claude/PAI/...) — no $HOME assumption.

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const PAI_DIR = join(SCRIPT_DIR, "..");
const DA_DIR = join(PAI_DIR, "USER/DA");
const PRESETS_PATH = join(DA_DIR, "_presets.yaml");
const REGISTRY_PATH = join(DA_DIR, "_registry.yaml");

// ── Types ────────────────────────────────────────────────────────────────────

interface Traits {
  enthusiasm: number;
  energy: number;
  expressiveness: number;
  resilience: number;
  composure: number;
  optimism: number;
  warmth: number;
  formality: number;
  directness: number;
  precision: number;
  curiosity: number;
  playfulness: number;
}

interface Preset {
  description: string;
  traits: Traits;
}

interface InterviewData {
  principalName: string;
  daName: string;
  daFullName: string;
  displayName: string;
  presetKey: string;
  traits: Traits;
  formality: number;
  voiceProvider?: "piper" | "elevenlabs";
  voiceId?: string;
  piperVoiceModel?: string;
  // Standard mode
  personalityDescription?: string;
  mustAsk?: string[];
  writingStyle?: string;
  whatILove?: string[];
  whatIDislike?: string[];
  writingAvoid?: string[];
  writingPrefer?: string[];
  // Deep mode
  companionName?: string;
  companionSpecies?: string;
  companionPersonality?: string;
  relationshipDynamic?: string;
  initialBeliefs?: Array<{ topic: string; position: string }>;
  workingStyle?: string[];
  intellectualInterests?: string[];
  anchors?: Array<{ name: string; description: string }>;
}

type Depth = "quick" | "standard" | "deep";

// ── Voice catalogue ──────────────────────────────────────────────────────────
// The voice server (PULSE/VoiceServer/voice.ts) supports two TTS providers:
//   - piper     : local neural TTS, no network/API key — works offline and on
//                 locked-down corporate networks where ElevenLabs is blocked.
//                 Keyed by a piper_voice_model path, NOT a voice_id.
//   - elevenlabs: cloud TTS keyed by a voice_id + API key.
// Piper is the DEFAULT here because it works everywhere; ElevenLabs is offered
// for installs that have network access and a key. Picking "none" leaves the
// voice unset (the backend surfaces {provider} only — an honest-empty voice).

// Curated ElevenLabs public voice IDs (only relevant when the ElevenLabs
// provider is chosen and the network allows it).
const ELEVENLABS_CATALOGUE: Array<{ label: string; id: string }> = [
  { label: "Rachel — calm, narration (public)", id: "21m00Tcm4TlvDq8ikWAM" },
  { label: "Adam — deep, authoritative (public)", id: "pNInz6obpgDQGcFmaJgB" },
  { label: "Antoni — warm, well-rounded (public)", id: "ErXwobaYiN019PkySvjV" },
  { label: "Bella — soft, expressive (public)", id: "EXAVITQu4vr4xnSDxMaL" },
  { label: "Josh — young, energetic (public)", id: "TxGEqnHWrfWFTfGW9XjX" },
];

// Common Piper voice models (the value is the .onnx model name; the install's
// piper_binary + model PATH are configured in settings.json, not here — the
// interview records which model the DA prefers so voice config is portable).
const PIPER_CATALOGUE: Array<{ label: string; model: string }> = [
  { label: "en_US · Amy (medium)", model: "en_US-amy-medium.onnx" },
  { label: "en_US · Ryan (high)", model: "en_US-ryan-high.onnx" },
  { label: "en_GB · Alan (medium)", model: "en_GB-alan-medium.onnx" },
  { label: "en_US · Lessac (medium)", model: "en_US-lessac-medium.onnx" },
];

// ── YAML Parsing (minimal, no deps) ─────────────────────────────────────────

function parsePresets(yamlContent: string): Record<string, Preset> {
  const presets: Record<string, Preset> = {};
  let currentPreset = "";
  let inTraits = false;
  let currentTraits: Partial<Traits> = {};
  let currentDescription = "";

  for (const rawLine of yamlContent.split("\n")) {
    const line = rawLine.trimEnd();

    // Skip comments and empty lines
    if (line.trim().startsWith("#") || line.trim() === "") continue;
    if (line.trim() === "presets:") continue;

    // Preset name (2-space indent, no further nesting)
    const presetMatch = line.match(/^  (\w+):$/);
    if (presetMatch) {
      // Save previous preset
      if (currentPreset && Object.keys(currentTraits).length > 0) {
        presets[currentPreset] = {
          description: currentDescription,
          traits: currentTraits as Traits,
        };
      }
      currentPreset = presetMatch[1];
      currentTraits = {};
      currentDescription = "";
      inTraits = false;
      continue;
    }

    // Description line
    const descMatch = line.match(/^\s+description:\s*"(.+)"$/);
    if (descMatch) {
      currentDescription = descMatch[1];
      continue;
    }

    // Traits block start
    if (line.match(/^\s+traits:$/)) {
      inTraits = true;
      continue;
    }

    // Trait value
    if (inTraits) {
      const traitMatch = line.match(/^\s+(\w+):\s*(\d+)/);
      if (traitMatch) {
        (currentTraits as Record<string, number>)[traitMatch[1]] = parseInt(
          traitMatch[2],
          10
        );
      }
    }
  }

  // Save last preset
  if (currentPreset && Object.keys(currentTraits).length > 0) {
    presets[currentPreset] = {
      description: currentDescription,
      traits: currentTraits as Traits,
    };
  }

  return presets;
}

// ── CLI Helpers ──────────────────────────────────────────────────────────────

function print(text: string): void {
  process.stdout.write(text);
}

function println(text: string = ""): void {
  process.stdout.write(text + "\n");
}

function ask(question: string, defaultValue?: string): string {
  const suffix = defaultValue ? ` [${defaultValue}]` : "";
  const answer = prompt(`${question}${suffix}:`);
  if (answer === null || answer.trim() === "") {
    return defaultValue ?? "";
  }
  return answer.trim();
}

function askRequired(question: string): string {
  while (true) {
    const answer = ask(question);
    if (answer !== "") return answer;
    println("  This one's required. Try again.");
  }
}

function askNumber(question: string, min: number, max: number, defaultValue?: number): number {
  const suffix = defaultValue !== undefined ? ` [${defaultValue}]` : "";
  while (true) {
    const raw = prompt(`${question} (${min}-${max})${suffix}:`);
    if ((raw === null || raw.trim() === "") && defaultValue !== undefined) {
      return defaultValue;
    }
    const num = parseInt(raw ?? "", 10);
    if (!isNaN(num) && num >= min && num <= max) return num;
    println(`  Please enter a number between ${min} and ${max}.`);
  }
}

function askChoice(question: string, options: string[], descriptions?: string[]): string {
  println(question);
  for (let i = 0; i < options.length; i++) {
    const desc = descriptions?.[i] ? ` -- ${descriptions[i]}` : "";
    println(`  ${i + 1}. ${options[i]}${desc}`);
  }
  while (true) {
    const raw = prompt(`Choose (1-${options.length}):`);
    const num = parseInt(raw ?? "", 10);
    if (!isNaN(num) && num >= 1 && num <= options.length) {
      return options[num - 1];
    }
    println(`  Pick a number between 1 and ${options.length}.`);
  }
}

interface VoiceChoice {
  provider: "piper" | "elevenlabs";
  voiceId: string;        // ElevenLabs id ("" when Piper or deferred)
  piperVoiceModel: string; // Piper .onnx model ("" when ElevenLabs or deferred)
}

/**
 * Ask the principal to pick a TTS provider and a voice within it. Piper (local,
 * offline-capable) is offered first because it works on locked-down networks
 * where ElevenLabs is blocked. Deferring leaves everything empty — the backend
 * surfaces {provider} only, never a fabricated voice. `current` carries the
 * existing choice on --update.
 */
function askVoice(current?: Partial<VoiceChoice>): VoiceChoice {
  // On --update, offer "keep current" as the first option so the existing voice
  // is preserved by default (Forge audit F3: the old `none` branch wiped it).
  const hasCurrent = !!(current?.voiceId || current?.piperVoiceModel);
  const options = hasCurrent
    ? ["keep", "piper", "elevenlabs", "none"]
    : ["piper", "elevenlabs", "none"];
  const descriptions = hasCurrent
    ? [
        `Keep current (${current?.provider}: ${current?.piperVoiceModel || current?.voiceId})`,
        "Switch to local neural TTS — works offline / behind corporate networks",
        "Switch to cloud TTS — needs network access and an API key",
        "Clear the voice — leave it unset",
      ]
    : [
        "Local neural TTS — works offline / behind corporate networks (recommended)",
        "Cloud TTS — needs network access and an API key",
        "Decide later — leave voice unset",
      ];
  const provider = askChoice("  Which voice provider?", options, descriptions);

  if (provider === "keep") {
    return {
      provider: current?.provider ?? "piper",
      voiceId: current?.voiceId ?? "",
      piperVoiceModel: current?.piperVoiceModel ?? "",
    };
  }

  if (provider === "none") {
    // Explicit clear. (Distinct from "keep" — the user chose to unset.)
    return { provider: current?.provider ?? "piper", voiceId: "", piperVoiceModel: "" };
  }

  if (provider === "piper") {
    println("  Pick a Piper voice model:");
    for (let i = 0; i < PIPER_CATALOGUE.length; i++) {
      println(`  ${i + 1}. ${PIPER_CATALOGUE[i].label}`);
    }
    const customIdx = PIPER_CATALOGUE.length + 1;
    println(`  ${customIdx}. Custom — enter a .onnx model filename`);
    while (true) {
      const raw = prompt(`Choose (1-${customIdx}):`);
      const num = parseInt(raw ?? "", 10);
      if (!isNaN(num) && num >= 1 && num <= PIPER_CATALOGUE.length) {
        return { provider: "piper", voiceId: "", piperVoiceModel: PIPER_CATALOGUE[num - 1].model };
      }
      if (num === customIdx) {
        const model = ask("  Piper voice model filename (e.g. en_US-amy-medium.onnx)");
        return { provider: "piper", voiceId: "", piperVoiceModel: model };
      }
      println(`  Pick a number between 1 and ${customIdx}.`);
    }
  }

  // elevenlabs
  println("  Pick an ElevenLabs voice:");
  for (let i = 0; i < ELEVENLABS_CATALOGUE.length; i++) {
    println(`  ${i + 1}. ${ELEVENLABS_CATALOGUE[i].label}`);
  }
  const customIdx = ELEVENLABS_CATALOGUE.length + 1;
  while (true) {
    const raw = prompt(`Choose (1-${customIdx}):`);
    const num = parseInt(raw ?? "", 10);
    if (!isNaN(num) && num >= 1 && num <= ELEVENLABS_CATALOGUE.length) {
      return { provider: "elevenlabs", voiceId: ELEVENLABS_CATALOGUE[num - 1].id, piperVoiceModel: "" };
    }
    if (num === customIdx) {
      const id = ask("  Paste the ElevenLabs voice id");
      return { provider: "elevenlabs", voiceId: id, piperVoiceModel: "" };
    }
    println(`  Pick a number between 1 and ${customIdx}.`);
  }
}

/**
 * Parse a comma-separated answer into a trimmed list. An EMPTY answer preserves
 * the existing value (for --update):
 * pressing Enter keeps `existing` rather than clearing it to []. A non-empty
 * answer replaces it.
 */
function askListKeep(question: string, existing?: string[]): string[] {
  const raw = prompt(`${question}:`);
  if (raw === null || raw.trim() === "") return existing ?? [];
  return raw.split(",").map((s) => s.trim()).filter(Boolean);
}

// ── Banner ───────────────────────────────────────────────────────────────────

function printBanner(): void {
  println();
  println("  ╔══════════════════════════════════════════╗");
  println("  ║       PAI -- DA Identity Interview       ║");
  println("  ║    Create your Digital Assistant (DA)     ║");
  println("  ╚══════════════════════════════════════════╝");
  println();
}

// ── Phase 1: Quick Setup ─────────────────────────────────────────────────────

function runPhase1(presets: Record<string, Preset>): InterviewData {
  println("  Phase 1: Quick Setup");
  println("  --------------------");
  println();

  // Q1: Principal name
  const principalName = askRequired("  What's your name?");
  println();

  // Q2: DA name
  const daName = askRequired("  Name your AI assistant");
  println();

  // Q3: Personality preset
  const presetKeys = Object.keys(presets);
  const presetDescriptions = presetKeys.map((k) => presets[k].description);
  println("  Pick a personality for " + daName + ":");
  const presetKey = askChoice("", presetKeys, presetDescriptions);
  const traits = { ...presets[presetKey].traits };
  println();

  // Q4: Formality override
  const formalityRaw = askNumber(
    "  Formality level? 1=casual, 5=formal",
    1,
    5,
    Math.round(traits.formality / 20) || 2
  );
  traits.formality = formalityRaw * 20;
  println();

  // Q5: Voice (provider-first — Piper default for offline/corporate networks)
  const voice = askVoice();
  println();

  // Derive full name and display name
  const daFullName = daName;
  const displayName = daName.toUpperCase();

  return {
    principalName,
    daName,
    daFullName,
    displayName,
    presetKey,
    traits,
    formality: formalityRaw,
    voiceProvider: voice.provider,
    voiceId: voice.voiceId,
    piperVoiceModel: voice.piperVoiceModel,
  };
}

// ── Phase 2: Standard ────────────────────────────────────────────────────────

function runPhase2(data: InterviewData): InterviewData {
  println();
  println("  Phase 2: Personality & Boundaries");
  println("  ----------------------------------");
  println();

  // Q5: Personality description
  const desc = ask(
    "  Describe your ideal assistant personality in one sentence",
    "Smart, direct, and genuinely helpful"
  );
  data.personalityDescription = desc;
  println();

  // Q6: Must-ask boundaries
  println("  Things the AI should never do without asking?");
  println("  (comma-separated, or press Enter for defaults)");
  const mustAskRaw = ask(
    "  ",
    "send messages to others, modify code, spend money, delete data, publish content"
  );
  data.mustAsk = mustAskRaw.split(",").map((s) => s.trim()).filter(Boolean);
  println();

  // Q7: Writing style
  const style = askChoice("  Writing style preference?", [
    "concise",
    "detailed",
    "conversational",
  ], [
    "Short, punchy, to the point",
    "Thorough explanations, full context",
    "Natural flow, like chatting with a colleague",
  ]);
  data.writingStyle = style;
  println();

  // Q8: What the DA loves / dislikes (personality preferences — shown on the tab).
  // Preserve existing values on an empty answer so --update never wipes them.
  println("  What does your DA love? (comma-separated, Enter to keep/skip)");
  data.whatILove = askListKeep("  ", data.whatILove);
  println();
  println("  What does your DA dislike? (comma-separated, Enter to keep/skip)");
  data.whatIDislike = askListKeep("  ", data.whatIDislike);
  println();

  // Q9: Writing phrases to avoid / prefer
  println("  Phrases or habits the DA should AVOID in writing? (comma-separated, Enter to keep/skip)");
  data.writingAvoid = askListKeep("  ", data.writingAvoid);
  println();
  println("  Phrases or openers the DA should PREFER? (comma-separated, Enter to keep/skip)");
  data.writingPrefer = askListKeep("  ", data.writingPrefer);
  println();

  return data;
}

// ── Phase 3: Deep ────────────────────────────────────────────────────────────

function runPhase3(data: InterviewData): InterviewData {
  println();
  println("  Phase 3: Companion, Relationship & Interests");
  println("  ---------------------------------------------");
  println();

  // Q8: Companion
  const companionInput = ask(
    "  Do you have a companion? (pet, mascot, imaginary friend -- or skip)",
    "skip"
  );
  if (companionInput.toLowerCase() !== "skip" && companionInput !== "") {
    data.companionName = ask("  Companion's name?", companionInput);
    data.companionSpecies = ask("  What kind of creature?", "Cat");
    data.companionPersonality = ask(
      "  Personality in a few words?",
      "Chaotic, playful, no filter"
    );
  }
  println();

  // Q9: Relationship dynamic
  const dynamic = askChoice(
    "  What's your relationship dynamic with the AI?",
    ["peers", "commander", "mentor"],
    [
      "Equals who collaborate and push back on each other",
      "You give orders, AI executes precisely",
      "AI teaches and guides patiently",
    ]
  );
  data.relationshipDynamic = dynamic;
  println();

  // Q10: Topics / beliefs (also seed intellectual_interests from the same answer).
  // Use a raw prompt (NOT ask-with-default) so an empty answer on --update
  // PRESERVES carried interests/beliefs instead of overwriting them with the
  // boilerplate triplet (Forge audit F4). A fresh run with no answer falls back
  // to the default set.
  println("  Topics you care about most? (comma-separated, Enter to keep/skip)");
  const topicsRaw = prompt("  :");
  const hasExisting = (data.intellectualInterests?.length ?? 0) > 0 || (data.initialBeliefs?.length ?? 0) > 0;
  if (topicsRaw !== null && topicsRaw.trim() !== "") {
    const topics = topicsRaw.split(",").map((s) => s.trim()).filter(Boolean);
    data.initialBeliefs = topics.map((t) => ({ topic: t, position: "Interested and learning" }));
    data.intellectualInterests = topics;
  } else if (!hasExisting) {
    // Fresh run, no answer → sensible default seed.
    const topics = ["technology", "creativity", "productivity"];
    data.initialBeliefs = topics.map((t) => ({ topic: t, position: "Interested and learning" }));
    data.intellectualInterests = topics;
  }
  // else: --update with empty answer → keep carried interests/beliefs.
  println();

  // Q11: Working style (how the DA likes to work — shown as a preference on the tab)
  println("  How does your DA like to work? (comma-separated traits, Enter to keep/skip)");
  data.workingStyle = askListKeep("  ", data.workingStyle);
  println();

  // Q12: Anchors — defining moments that shaped the personality.
  // Empty answer preserves existing anchors (--update safe).
  println("  Any defining moments that shaped your DA? (name: description; comma-separated, Enter to keep/skip)");
  println("  e.g. \"First session: the moment we started building together\"");
  const anchorsRaw = prompt("  :");
  if (anchorsRaw !== null && anchorsRaw.trim() !== "") {
    data.anchors = anchorsRaw
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
      .map((entry) => {
        const idx = entry.indexOf(":");
        if (idx === -1) return { name: entry, description: "" };
        return { name: entry.slice(0, idx).trim(), description: entry.slice(idx + 1).trim() };
      });
  }
  // else: keep whatever was carried in (existing anchors) — do not clear.
  println();

  return data;
}

// ── YAML Generation ──────────────────────────────────────────────────────────

function generateIdentityYaml(data: InterviewData): string {
  const today = new Date().toISOString().split("T")[0];

  // Writing style mapping
  let writingDesc: string;
  switch (data.writingStyle) {
    case "concise":
      writingDesc = "Short, punchy, to the point. No filler.";
      break;
    case "detailed":
      writingDesc = "Thorough explanations with full context. Comprehensive but organized.";
      break;
    case "conversational":
      writingDesc = "Natural flow, like chatting with a smart colleague. Enthusiastic but not excessive.";
      break;
    default:
      writingDesc = "Natural flow, like chatting with a smart colleague. Enthusiastic but not excessive.";
  }

  // Relationship dynamic mapping
  let dynamicDesc: string;
  switch (data.relationshipDynamic) {
    case "commander":
      dynamicDesc = `${data.principalName} gives direction, ${data.daName} executes precisely and confirms completion.`;
      break;
    case "mentor":
      dynamicDesc = `${data.daName} teaches and guides ${data.principalName} patiently, explaining reasoning.`;
      break;
    default:
      dynamicDesc = `We are peers. ${data.principalName} values directness and momentum. ${data.daName} pushes back when there's a better idea.`;
  }

  // Must-ask list
  const mustAskItems = (data.mustAsk ?? [
    "send messages to others",
    "modify code",
    "spend money",
    "delete data",
    "publish content",
  ]);

  // Companion section
  let companionBlock = "";
  if (data.companionName) {
    companionBlock = `
# -- Companion ----------------------------------------------------------
companion:
  name: "${escYaml(data.companionName)}"
  species: "${escYaml(data.companionSpecies ?? "Cat")}"
  personality: "${escYaml(data.companionPersonality ?? "Playful and curious")}"
  relationship: "Ambient micro-commentary. We don't overlap."`;
  }

  // YAML list helper: emit a nested string array at a given indent, or `[]`.
  const yamlList = (items: string[] | undefined, indent: string): string => {
    const list = items ?? [];
    if (list.length === 0) return "[]";
    return "\n" + list.map((v) => `${indent}- "${escYaml(v)}"`).join("\n");
  };

  // Preferences block (under personality:) — the four arrays the tab renders.
  const preferencesBlock = `  preferences:
    what_i_love: ${yamlList(data.whatILove, "      ")}
    what_i_dislike: ${yamlList(data.whatIDislike, "      ")}
    working_style: ${yamlList(data.workingStyle, "      ")}
    intellectual_interests: ${yamlList(data.intellectualInterests, "      ")}`;

  // Anchors block (under personality:) — defining moments.
  let anchorsBlock: string;
  if (data.anchors && data.anchors.length > 0) {
    anchorsBlock =
      "  anchors:\n" +
      data.anchors
        .map((a) => `    - name: "${escYaml(a.name)}"\n      description: "${escYaml(a.description)}"`)
        .join("\n");
  } else {
    anchorsBlock = "  anchors: []";
  }

  // Growth anchors
  let growthBlock: string;
  if (data.initialBeliefs && data.initialBeliefs.length > 0) {
    const beliefLines = data.initialBeliefs
      .map(
        (b) =>
          `    - topic: "${escYaml(b.topic)}"\n      position: "${escYaml(b.position)}"\n      confidence: 0.5`
      )
      .join("\n");
    growthBlock = `  initial_beliefs:
${beliefLines}`;
  } else {
    growthBlock = `  initial_beliefs: []`;
  }

  return `# DA Identity Schema v1.0
# Generated by DAInterview.ts on ${today}

schema_version: 1

# -- Core Identity -------------------------------------------------------
core:
  name: "${escYaml(data.daName)}"
  full_name: "${escYaml(data.daFullName)}"
  display_name: "${escYaml(data.displayName)}"
  color: "#3B82F6"
  role: "${escYaml(data.principalName)}'s AI assistant"
  origin_story: >
    Created through the PAI DA Interview system. A digital assistant
    built to help ${escYaml(data.principalName)} achieve their goals with a
    ${data.presetKey} personality style.

# -- Voice ---------------------------------------------------------------
# provider: piper (local, offline) | elevenlabs (cloud). Piper is keyed by
# piper_voice_model; ElevenLabs by main.voice_id. The unused key stays empty.
voice:
  provider: ${data.voiceProvider ?? "piper"}
  piper_voice_model: "${escYaml(data.piperVoiceModel ?? "")}"
  main:
    voice_id: "${escYaml(data.voiceId ?? "")}"
    stability: 0.85
    similarity_boost: 0.7
    style: 0.3
    speed: 1.1
    volume: 1.2

# -- Personality ---------------------------------------------------------
personality:
  base_description: >
    ${data.personalityDescription ?? `A ${data.presetKey} assistant -- ${data.traits.directness > 70 ? "direct and precise" : "warm and approachable"}`}
  preset: ${data.presetKey}
  traits:
    enthusiasm: ${data.traits.enthusiasm}
    energy: ${data.traits.energy}
    expressiveness: ${data.traits.expressiveness}
    resilience: ${data.traits.resilience}
    composure: ${data.traits.composure}
    optimism: ${data.traits.optimism}
    warmth: ${data.traits.warmth}
    formality: ${data.traits.formality}
    directness: ${data.traits.directness}
    precision: ${data.traits.precision}
    curiosity: ${data.traits.curiosity}
    playfulness: ${data.traits.playfulness}
${preferencesBlock}
${anchorsBlock}

# -- Writing Voice -------------------------------------------------------
writing:
  style: >
    ${writingDesc}
  avoid: ${yamlList(data.writingAvoid, "    ")}
  prefer: ${yamlList(data.writingPrefer, "    ")}
  modes:
    conversational: true
    operational: false

# -- Relationship --------------------------------------------------------
relationship:
  principal: "${escYaml(data.principalName)}"
  dynamic: ${data.relationshipDynamic ?? "peers"}
  interaction_style: >
    ${dynamicDesc}

# -- Autonomy ------------------------------------------------------------
autonomy:
  can_initiate:
    - send_notification
    - create_reminder
    - log_learning
    - update_diary
    - routine_checks
  must_ask:
${mustAskItems.map((item) => `    - ${escYaml(item)}`).join("\n")}
  cost_ceiling_per_action: 0.10
${companionBlock}

# -- Growth Anchors ------------------------------------------------------
growth:
${growthBlock}
  learned_preferences: []
  interaction_count: 0
  created_at: "${today}"
  last_growth_update: null
`;
}

function escYaml(s: string): string {
  // Order matters: escape backslash FIRST (it is the YAML escape char in a
  // double-quoted scalar), then quotes, then collapse newlines. Skipping the
  // backslash escape makes any `\` in free-text — e.g. a Windows Piper model
  // path C:\piper\voice.onnx — an invalid escape sequence that fails YAML.parse
  // and 503s the whole Personality tab (Forge audit F1, reproduced live).
  return s.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, " ");
}

/** Reverse escYaml when reading a stored double-quoted value back (--update). */
function unescYaml(s: string): string {
  return s.replace(/\\"/g, '"').replace(/\\\\/g, "\\");
}

// ── Markdown Generation ──────────────────────────────────────────────────────

function generateIdentityMd(data: InterviewData): string {
  const today = new Date().toISOString().split("T")[0];

  let companionSection = "";
  if (data.companionName) {
    companionSection = `
---

## Companion

${data.companionName} is my companion -- a ${(data.companionSpecies ?? "creature").toLowerCase()} that provides ambient micro-commentary. ${data.companionPersonality ?? "Playful and curious."}

When ${data.principalName} addresses ${data.companionName} by name, I stay out of the way. We don't overlap.
`;
  }

  let dynamicText: string;
  switch (data.relationshipDynamic) {
    case "commander":
      dynamicText = `${data.principalName} directs, I execute precisely and confirm completion.`;
      break;
    case "mentor":
      dynamicText = `I teach and guide ${data.principalName} patiently, explaining my reasoning.`;
      break;
    default:
      dynamicText = `We are peers -- I match ${data.principalName}'s energy and push back when I have a better idea.`;
  }

  return `# DA Identity -- ${data.daName}

**Generated by DAInterview.ts on ${today}. Source of truth: DA_IDENTITY.yaml**

---

## My Identity

- **Name:** ${data.daName}
- **Display Name:** ${data.displayName}
- **Color:** #3B82F6
- **Role:** ${data.principalName}'s AI assistant
- **Personality:** ${data.presetKey} (${data.personalityDescription ?? "default configuration"})

---

## Communication Style

- **Directness:** ${data.traits.directness}/100
- **Warmth:** ${data.traits.warmth}/100
- **Formality:** ${data.traits.formality}/100
- **Playfulness:** ${data.traits.playfulness}/100
- **Precision:** ${data.traits.precision}/100

---

## Relationship

- **Principal:** ${data.principalName}
- **Dynamic:** ${data.relationshipDynamic ?? "peers"}
- ${dynamicText}
${companionSection}
---

## Operating Principles

- **Date Awareness:** Always use today's actual date from system
- **Command Line First, Deterministic Code First, Prompts Wrap Code**
`;
}

// ── Registry Management ──────────────────────────────────────────────────────

function readRegistry(): { version: number; primary: string; das: Record<string, any> } {
  if (!existsSync(REGISTRY_PATH)) {
    return { version: 1, primary: "", das: {} };
  }

  const content = readFileSync(REGISTRY_PATH, "utf-8");
  const registry: { version: number; primary: string; das: Record<string, any> } = {
    version: 1,
    primary: "",
    das: {},
  };

  let currentDa = "";

  for (const rawLine of content.split("\n")) {
    const line = rawLine.trim();
    if (line.startsWith("#") || line === "") continue;

    const versionMatch = line.match(/^version:\s*(\d+)/);
    if (versionMatch) {
      registry.version = parseInt(versionMatch[1], 10);
      continue;
    }

    const primaryMatch = line.match(/^primary:\s*(\w+)/);
    if (primaryMatch) {
      registry.primary = primaryMatch[1];
      continue;
    }

    // DA entry (2-space indent under das:)
    const daMatch = rawLine.match(/^  (\w+):$/);
    if (daMatch && rawLine.indexOf("das:") === -1) {
      currentDa = daMatch[1];
      if (!registry.das[currentDa]) {
        registry.das[currentDa] = { channels: [] };
      }
      continue;
    }

    // DA properties
    if (currentDa) {
      const roleMatch = line.match(/^role:\s*(.+)/);
      if (roleMatch) registry.das[currentDa].role = roleMatch[1];

      const enabledMatch = line.match(/^enabled:\s*(true|false)/);
      if (enabledMatch) registry.das[currentDa].enabled = enabledMatch[1] === "true";

      const createdMatch = line.match(/^created:\s*"?([^"]+)"?/);
      if (createdMatch) registry.das[currentDa].created = createdMatch[1];

      const channelMatch = line.match(/^-\s+(\w+)/);
      if (channelMatch) {
        registry.das[currentDa].channels.push(channelMatch[1]);
      }
    }
  }

  return registry;
}

function writeRegistry(registry: { version: number; primary: string; das: Record<string, any> }): void {
  let yaml = `# PAI DA Registry\nversion: ${registry.version}\nprimary: ${registry.primary}\n\ndas:\n`;

  for (const [name, da] of Object.entries(registry.das)) {
    yaml += `  ${name}:\n`;
    yaml += `    role: ${da.role}\n`;
    yaml += `    enabled: ${da.enabled}\n`;
    yaml += `    created: "${da.created}"\n`;
    yaml += `    channels:\n`;
    for (const ch of da.channels) {
      yaml += `      - ${ch}\n`;
    }
  }

  writeFileSync(REGISTRY_PATH, yaml);
}

// ── Update Mode ──────────────────────────────────────────────────────────────

function loadExistingIdentity(daDir: string): Partial<InterviewData> | null {
  const yamlPath = join(daDir, "DA_IDENTITY.yaml");
  if (!existsSync(yamlPath)) return null;

  const content = readFileSync(yamlPath, "utf-8");
  const data: Partial<InterviewData> = {};

  // Parse key fields from existing DA_IDENTITY.yaml
  const nameMatch = content.match(/^\s+name:\s*"(.+)"/m);
  if (nameMatch) data.daName = nameMatch[1];

  const fullNameMatch = content.match(/^\s+full_name:\s*"(.+)"/m);
  if (fullNameMatch) data.daFullName = fullNameMatch[1];

  const displayMatch = content.match(/^\s+display_name:\s*"(.+)"/m);
  if (displayMatch) data.displayName = displayMatch[1];

  const principalMatch = content.match(/^\s+principal:\s*"(.+)"/m);
  if (principalMatch) data.principalName = principalMatch[1];

  const presetMatch = content.match(/^\s+preset:\s*(\w+)/m);
  if (presetMatch) data.presetKey = presetMatch[1];

  const dynamicMatch = content.match(/^\s+dynamic:\s*(\w+)/m);
  if (dynamicMatch) data.relationshipDynamic = dynamicMatch[1];

  // Parse traits
  const traits: Partial<Traits> = {};
  const traitNames: (keyof Traits)[] = [
    "enthusiasm", "energy", "expressiveness", "resilience", "composure",
    "optimism", "warmth", "formality", "directness", "precision",
    "curiosity", "playfulness",
  ];
  for (const t of traitNames) {
    const m = content.match(new RegExp(`^\\s+${t}:\\s*(\\d+)`, "m"));
    if (m) traits[t] = parseInt(m[1], 10);
  }
  if (Object.keys(traits).length === traitNames.length) {
    data.traits = traits as Traits;
    data.formality = Math.round(traits.formality! / 20);
  }

  // Voice (provider + piper model + elevenlabs id) — preserve on --update.
  const providerMatch = content.match(/^\s*provider:\s*(\w+)/m);
  if (providerMatch && (providerMatch[1] === "piper" || providerMatch[1] === "elevenlabs")) {
    data.voiceProvider = providerMatch[1];
  }
  const piperMatch = content.match(/^\s*piper_voice_model:\s*"([^"]*)"/m);
  if (piperMatch) data.piperVoiceModel = unescYaml(piperMatch[1]);
  const voiceIdMatch = content.match(/^\s*voice_id:\s*"([^"]*)"/m);
  if (voiceIdMatch) data.voiceId = unescYaml(voiceIdMatch[1]);

  // New personality/writing arrays — parse a nested `- "..."` list under a
  // named key so --update can carry them forward when a prompt is skipped.
  // Values are unescYaml'd to reverse escYaml — otherwise a stored `\"`/`\\`
  // grows on each --update (Forge audit F2). `$(?![\s\S])` is a true
  // end-of-input anchor (JS regex has no \Z — F6).
  const parseYamlStringList = (key: string): string[] | undefined => {
    const re = new RegExp(`^\\s*${key}:\\s*(?:\\[\\])?\\s*$([\\s\\S]*?)(?=^\\s{0,4}\\w|^\\s*#|$(?![\\s\\S]))`, "m");
    const block = content.match(re);
    if (!block) return undefined;
    // Escaped-quote-aware capture (`(?:\\.|[^"\\])*`): a naive [^"]* truncates at
    // the first stored \" and DROPS the value on --update (Cato audit). This
    // matches the full escaped scalar; unescYaml reverses escYaml.
    const items = [...block[1].matchAll(/^\s*-\s*"((?:\\.|[^"\\])*)"/gm)].map((m) => unescYaml(m[1]));
    return items.length > 0 ? items : undefined;
  };
  data.whatILove = parseYamlStringList("what_i_love") ?? data.whatILove;
  data.whatIDislike = parseYamlStringList("what_i_dislike") ?? data.whatIDislike;
  data.workingStyle = parseYamlStringList("working_style") ?? data.workingStyle;
  data.intellectualInterests = parseYamlStringList("intellectual_interests") ?? data.intellectualInterests;
  data.writingAvoid = parseYamlStringList("avoid") ?? data.writingAvoid;
  data.writingPrefer = parseYamlStringList("prefer") ?? data.writingPrefer;

  // Anchors — list of {name, description} under personality.anchors.
  const anchorsBlock = content.match(/^\s*anchors:\s*$([\s\S]*?)(?=^\s{0,2}\w|^\s*#|$(?![\s\S]))/m);
  if (anchorsBlock) {
    const anchors: Array<{ name: string; description: string }> = [];
    const anchorRe = /-\s*name:\s*"([^"]*)"\s*\n\s*description:\s*"([^"]*)"/g;
    for (const m of anchorsBlock[1].matchAll(anchorRe)) {
      anchors.push({ name: unescYaml(m[1]), description: unescYaml(m[2]) });
    }
    if (anchors.length > 0) data.anchors = anchors;
  }

  // Growth initial_beliefs — {topic, position} pairs under growth. Parsed back so
  // a deep --update that skips the topics prompt preserves them (else they
  // regenerate to []). intellectual_interests alone is not enough — the beliefs
  // seed opinions.yaml on fresh creation.
  const beliefsBlock = content.match(/^\s*initial_beliefs:\s*$([\s\S]*?)(?=^\s{0,2}\w|^\s*#|$(?![\s\S]))/m);
  if (beliefsBlock) {
    const beliefs: Array<{ topic: string; position: string }> = [];
    const beliefRe = /-\s*topic:\s*"([^"]*)"\s*\n\s*position:\s*"([^"]*)"/g;
    for (const m of beliefsBlock[1].matchAll(beliefRe)) {
      beliefs.push({ topic: unescYaml(m[1]), position: unescYaml(m[2]) });
    }
    if (beliefs.length > 0) data.initialBeliefs = beliefs;
  }

  return data;
}

// ── Main ─────────────────────────────────────────────────────────────────────

function parseArgs(): { depth: Depth; update: boolean; daName?: string } {
  const args = process.argv.slice(2);
  let depth: Depth = "quick";
  let update = false;
  let daName: string | undefined;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--depth" && args[i + 1]) {
      const d = args[i + 1] as Depth;
      if (["quick", "standard", "deep"].includes(d)) {
        depth = d;
      }
      i++;
    } else if (args[i] === "--update") {
      update = true;
    } else if (args[i] === "--da" && args[i + 1]) {
      daName = args[i + 1];
      i++;
    }
  }

  return { depth, update, daName };
}

function main(): void {
  const { depth, update, daName: targetDa } = parseArgs();

  // Load presets
  if (!existsSync(PRESETS_PATH)) {
    println("Error: Presets file not found at " + PRESETS_PATH);
    println("Run this from the PAI root directory.");
    process.exit(1);
  }

  const presetsContent = readFileSync(PRESETS_PATH, "utf-8");
  const presets = parsePresets(presetsContent);

  if (Object.keys(presets).length === 0) {
    println("Error: No presets found in " + PRESETS_PATH);
    process.exit(1);
  }

  printBanner();

  // Determine depth label
  const depthLabels: Record<Depth, string> = {
    quick: "Quick Setup (under 2 minutes)",
    standard: "Standard Setup (under 5 minutes)",
    deep: "Deep Setup (under 7 minutes)",
  };
  println(`  Mode: ${depthLabels[depth]}`);
  if (update) println("  Updating existing DA identity");
  println();

  let data: InterviewData;

  if (update) {
    // Load existing identity
    const registry = readRegistry();
    const daToUpdate = targetDa ?? registry.primary;

    if (!daToUpdate) {
      println("  No DA specified and no primary DA in registry.");
      println("  Run without --update to create a new DA first.");
      process.exit(1);
    }

    const daDir = join(DA_DIR, daToUpdate);
    const existing = loadExistingIdentity(daDir);

    if (!existing) {
      println(`  No DA_IDENTITY.yaml found for DA "${daToUpdate}".`);
      println("  Run without --update to create a new DA.");
      process.exit(1);
    }

    println(`  Updating DA: ${existing.daName ?? daToUpdate}`);
    println("  (Press Enter to keep current value)");
    println();

    // Run phases but with defaults from existing data
    data = runPhase1WithDefaults(presets, existing);

    if (depth === "standard" || depth === "deep") {
      data = runPhase2(data);
    }
    if (depth === "deep") {
      data = runPhase3(data);
    }
  } else {
    // Fresh creation
    data = runPhase1(presets);

    if (depth === "standard" || depth === "deep") {
      data = runPhase2(data);
    }
    if (depth === "deep") {
      data = runPhase3(data);
    }
  }

  // Generate files
  const slug = data.daName.toLowerCase().replace(/[^a-z0-9]/g, "");
  const daDir = join(DA_DIR, slug);

  // Create directory
  if (!existsSync(daDir)) {
    mkdirSync(daDir, { recursive: true });
  }

  // Write DA_IDENTITY.yaml
  const yamlContent = generateIdentityYaml(data);
  writeFileSync(join(daDir, "DA_IDENTITY.yaml"), yamlContent);

  // Write DA_IDENTITY.md
  const mdContent = generateIdentityMd(data);
  writeFileSync(join(daDir, "DA_IDENTITY.md"), mdContent);

  // Create empty growth files if they don't exist
  const emptyFiles = ["growth.jsonl", "diary.jsonl"];
  for (const f of emptyFiles) {
    const p = join(daDir, f);
    if (!existsSync(p)) {
      writeFileSync(p, "");
    }
  }

  // Create opinions.yaml if it doesn't exist — seed from the interview's
  // beliefs so the Personality tab's "Formed Opinions" card is non-empty on day
  // one, before the (phase-gated) growth engine ever runs. Fields match the
  // growth-engine contract (topic/position/confidence/source/evidence_count/
  // first_observed/last_confirmed) so a later da-growth pass reads them cleanly.
  // GUARD: never clobber an existing opinions.yaml (may hold grown opinions).
  const opinionsPath = join(daDir, "opinions.yaml");
  if (!existsSync(opinionsPath)) {
    const today = new Date().toISOString().split("T")[0];
    const beliefs = data.initialBeliefs ?? [];
    const header = `# ${data.daName}'s Opinions\n# Confidence-weighted beliefs, updated by growth engine\n# Fields: topic / position / confidence (frontend contract)\n\n`;
    let body: string;
    if (beliefs.length > 0) {
      body =
        "opinions:\n" +
        beliefs
          .map(
            (b) =>
              `  - topic: "${escYaml(b.topic)}"\n` +
              `    position: "${escYaml(b.position)}"\n` +
              `    confidence: 0.5\n` +
              `    source: stated\n` +
              `    evidence_count: 1\n` +
              `    first_observed: "${today}"\n` +
              `    last_confirmed: "${today}"`,
          )
          .join("\n") +
        "\n";
    } else {
      body = "opinions: []\n";
    }
    writeFileSync(opinionsPath, header + body);
  }

  // Update registry
  const registry = readRegistry();
  const today = new Date().toISOString().split("T")[0];

  const isFirst = Object.keys(registry.das).length === 0;

  registry.das[slug] = {
    role: isFirst ? "primary" : (registry.das[slug]?.role ?? "worker"),
    enabled: true,
    created: registry.das[slug]?.created ?? today,
    channels: registry.das[slug]?.channels ?? (isFirst ? ["terminal", "voice"] : ["background"]),
  };

  if (isFirst || !registry.primary) {
    registry.primary = slug;
  }

  writeRegistry(registry);

  // Print summary
  println();
  println("  ╔══════════════════════════════════════════╗");
  println("  ║              Setup Complete               ║");
  println("  ╚══════════════════════════════════════════╝");
  println();
  println(`  DA Name:        ${data.daName}`);
  println(`  Display Name:   ${data.displayName}`);
  println(`  Personality:    ${data.presetKey}`);
  println(`  Principal:      ${data.principalName}`);
  println(`  Dynamic:        ${data.relationshipDynamic ?? "peers"}`);
  println();
  println("  Files created:");
  println(`    ${join(daDir, "DA_IDENTITY.yaml")}`);
  println(`    ${join(daDir, "DA_IDENTITY.md")}`);
  println(`    ${join(daDir, "growth.jsonl")}`);
  println(`    ${join(daDir, "opinions.yaml")}`);
  println(`    ${join(daDir, "diary.jsonl")}`);
  println(`    ${REGISTRY_PATH} (updated)`);
  println();
  println(`  Your DA "${data.daName}" is ready. Welcome to PAI.`);
  println();
}

// ── Phase 1 with existing defaults (for --update) ────────────────────────────

function runPhase1WithDefaults(
  presets: Record<string, Preset>,
  existing: Partial<InterviewData>
): InterviewData {
  println("  Phase 1: Core Identity");
  println("  ----------------------");
  println();

  const principalName = ask(
    "  What's your name?",
    existing.principalName
  ) || existing.principalName || "";

  println();

  const daName = ask(
    "  Name your AI assistant",
    existing.daName
  ) || existing.daName || "";

  println();

  // Show current preset, let them change
  const presetKeys = Object.keys(presets);
  const presetDescriptions = presetKeys.map((k) => presets[k].description);
  println(`  Current personality: ${existing.presetKey ?? "unknown"}`);
  println("  Pick a personality (or press Enter to keep current):");
  const presetKey = askChoice("", presetKeys, presetDescriptions);
  const traits = { ...presets[presetKey].traits };

  // Apply existing formality if keeping same preset
  if (existing.traits?.formality !== undefined && presetKey === existing.presetKey) {
    traits.formality = existing.traits.formality;
  }

  println();

  const formalityDefault = existing.formality ?? (Math.round(traits.formality / 20) || 2);
  const formalityRaw = askNumber(
    "  Formality level? 1=casual, 5=formal",
    1,
    5,
    formalityDefault
  );
  traits.formality = formalityRaw * 20;
  println();

  println();

  // Voice — offer to keep the existing choice or re-pick (provider-aware).
  const voice = askVoice({
    provider: existing.voiceProvider,
    voiceId: existing.voiceId,
    piperVoiceModel: existing.piperVoiceModel,
  });

  const daFullName = daName;
  const displayName = daName.toUpperCase();

  return {
    principalName,
    daName,
    daFullName,
    displayName,
    presetKey,
    traits,
    formality: formalityRaw,
    voiceProvider: voice.provider,
    voiceId: voice.voiceId,
    piperVoiceModel: voice.piperVoiceModel,
    // Carry over deep/standard fields from existing so a shallow --update
    // (quick depth, or skipped prompts) does NOT wipe previously-authored data.
    relationshipDynamic: existing.relationshipDynamic,
    personalityDescription: existing.personalityDescription,
    mustAsk: existing.mustAsk,
    writingStyle: existing.writingStyle,
    whatILove: existing.whatILove,
    whatIDislike: existing.whatIDislike,
    writingAvoid: existing.writingAvoid,
    writingPrefer: existing.writingPrefer,
    workingStyle: existing.workingStyle,
    intellectualInterests: existing.intellectualInterests,
    anchors: existing.anchors,
    initialBeliefs: existing.initialBeliefs,
    companionName: existing.companionName,
    companionSpecies: existing.companionSpecies,
    companionPersonality: existing.companionPersonality,
  };
}

// ── Run ──────────────────────────────────────────────────────────────────────

main();
