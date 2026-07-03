#!/usr/bin/env bun
/**
 * VoiceSummary.hook.ts — Voice the PAI task-completion summary line aloud
 *
 * PURPOSE:
 * On every Stop, extract the speaker summary line from the final assistant
 * response (the "🗣️ {DA}: ..." line that closes a PAI format block) and
 * speak it via the local voice server. Fires ONLY when that line exists, so
 * natural greetings / replies without a format block stay silent.
 *
 * TRIGGER: Stop
 * NEEDS TRANSCRIPT: Falls back to transcript when last_assistant_message absent
 */

import { readHookInput, parseTranscriptFromInput } from './lib/hook-io';

const NOTIFY_URL = 'http://127.0.0.1:31337/notify'; // IPv4 explicit: localhost can resolve ::1 first on Windows
const MAIN_VOICE_ID = '21m00Tcm4TlvDq8ikWAM'; // Rachel (daidentity.voices.main)
const SPEAKER_EMOJI = '\u{1F5E3}'; // 🗣 (may be followed by U+FE0F variation selector)

/**
 * Pull the spoken summary out of a response. The PAI format closes with a
 * line like "🗣️ PAI: <8-16 word summary>". Return the text after the first
 * colon that follows the speaker emoji, or null if there is no such line.
 */
function extractSummary(response: string): string | null {
  for (const line of response.split('\n')) {
    const emojiIdx = line.indexOf(SPEAKER_EMOJI);
    if (emojiIdx === -1) continue;
    const colonIdx = line.indexOf(':', emojiIdx);
    if (colonIdx === -1) continue;
    const summary = line.slice(colonIdx + 1).trim();
    if (summary) return summary;
  }
  return null;
}

async function main() {
  const input = await readHookInput();
  if (!input) process.exit(0);

  let lastResponse = input.last_assistant_message;
  if (!lastResponse) {
    const parsed = await parseTranscriptFromInput(input);
    lastResponse = parsed.lastMessage;
  }
  if (!lastResponse) process.exit(0);

  const summary = extractSummary(lastResponse);
  if (!summary) process.exit(0); // bare ack / greeting — stay silent

  try {
    await fetch(NOTIFY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: summary,
        voice_id: MAIN_VOICE_ID,
        voice_enabled: true,
      }),
      signal: AbortSignal.timeout(8000),
    });
  } catch (err) {
    console.error('[VoiceSummary] Failed to send:', err);
  }

  process.exit(0);
}

main().catch((err) => {
  console.error('[VoiceSummary] Fatal:', err);
  process.exit(0);
});
