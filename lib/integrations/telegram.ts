/** Telegram Bot API sendMessage — https://core.telegram.org/bots/api#sendmessage */
import { env, need } from "../env";
import { q } from "../db";
import { fetchJson } from "./http";

export const esc = (s: unknown) =>
  String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const LIMIT = 4096;

export async function sendTelegram(html: string): Promise<{ message_id: number | null }> {
  const text = html.length > LIMIT ? html.slice(0, LIMIT - 40) + "\n…(truncated, see dashboard)" : html;
  if (env.mockFails("telegram")) throw new Error("MOCK_FAIL: telegram");
  if (env.mock) {
    await q(`INSERT INTO mock_outbox (channel, payload) VALUES ('telegram', $1)`, [JSON.stringify({ text })]);
    return { message_id: null };
  }
  const token = need(env.telegramToken, "TELEGRAM_BOT_TOKEN");
  const res = await fetchJson<{ ok: boolean; result: { message_id: number } }>(
    `https://api.telegram.org/bot${token}/sendMessage`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: need(env.telegramChatId, "TELEGRAM_CHAT_ID"),
        text, parse_mode: "HTML", link_preview_options: { is_disabled: true },
      }),
    },
  );
  return { message_id: res.result?.message_id ?? null };
}

/** Best-effort alert used when something fails mid-call. Never throws. */
export async function alertSafe(html: string) {
  try { await sendTelegram(html); } catch (err) { console.error("[telegram] alert failed", err); }
}
