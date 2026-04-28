require("dotenv").config();
const express = require("express");
const { Telegraf, Markup } = require("telegraf");

// ─── ENV ─────────────────────────────────────────────────────────────────────
const BOT_TOKEN        = process.env.BOT_TOKEN;
const WEBHOOK_DOMAIN   = process.env.WEBHOOK_DOMAIN;          // e.g. https://yourapp.railway.app
const WEBHOOK_PATH     = process.env.WEBHOOK_PATH || "/webhook";
const PORT             = process.env.PORT || 3000;
const WEB_ACCESS_LINK  = process.env.WEB_ACCESS_LINK  || "https://viralvideos.cloud/";
const APP_DOWNLOAD_LINK= process.env.APP_DOWNLOAD_LINK|| "https://viralvideos.cloud/download.html";

// 3 required channels (join links + chat IDs from env, or hardcoded fallback)
const CHANNELS = [
  {
    chatId:   process.env.CHAT_ID_1 || "",
    joinLink: process.env.JOIN_LINK_1 || "https://t.me/+IoPOsvouDR01OGE9",
    label:    "Channel 1",
  },
  {
    chatId:   process.env.CHAT_ID_2 || "",
    joinLink: process.env.JOIN_LINK_2 || "https://t.me/+OPZmLSKHu9YxNjBl",
    label:    "Channel 2",
  },
  {
    chatId:   process.env.CHAT_ID_3 || "",
    joinLink: process.env.JOIN_LINK_3 || "https://t.me/+kQYmjEENv9ZjZDU9",
    label:    "Channel 3",
  },
];

// ─── VALIDATION ───────────────────────────────────────────────────────────────
if (!BOT_TOKEN) {
  console.error("[FATAL] Missing BOT_TOKEN");
  process.exit(1);
}

// ─── RATE LIMITER ─────────────────────────────────────────────────────────────
// Prevents users from spamming "Check Again" — a major ban trigger on Telegram
const COOLDOWN_MS = 5000; // 5 seconds between checks per user
const cooldowns   = new Map();

function isOnCooldown(userId) {
  const last = cooldowns.get(userId);
  if (!last) return false;
  return Date.now() - last < COOLDOWN_MS;
}

function setCooldown(userId) {
  cooldowns.set(userId, Date.now());
  // Auto-cleanup after 1 min to prevent memory leak
  setTimeout(() => cooldowns.delete(userId), 60_000);
}

// ─── CHANNEL CHECK ────────────────────────────────────────────────────────────
const JOINED_STATUSES = new Set(["creator", "administrator", "member"]);

async function isUserInChannel(chatId, userId) {
  if (!chatId) return false; // skip unconfigured channels
  try {
    const member = await bot.telegram.getChatMember(chatId, userId);
    return JOINED_STATUSES.has(member.status);
  } catch (err) {
    // Telegram throws if bot isn't in the channel — log but don't crash
    console.warn(`[WARN] Could not check ${chatId}:`, err.description || err.message);
    return false;
  }
}

async function checkAllChannels(userId) {
  const results = await Promise.all(
    CHANNELS.map(async (ch) => ({
      ...ch,
      joined: await isUserInChannel(ch.chatId, userId),
    }))
  );
  return {
    allJoined: results.every((r) => r.joined),
    results,
  };
}

// ─── KEYBOARDS ────────────────────────────────────────────────────────────────
function buildJoinKeyboard(results) {
  const buttons = results.map((ch, i) => {
    const icon = ch.joined ? "✅" : "📌";
    return [Markup.button.url(`${icon} ${ch.label}`, ch.joinLink)];
  });
  buttons.push([Markup.button.callback("🔄 I Joined — Check Again", "check_join")]);
  return Markup.inlineKeyboard(buttons);
}

function buildAccessKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.url("🌐 Watch on Web", WEB_ACCESS_LINK)],
    [Markup.button.url("📱 Download App", APP_DOWNLOAD_LINK)],
  ]);
}

// ─── MESSAGES ─────────────────────────────────────────────────────────────────
function buildLockedMessage(results) {
  const lines = results.map((ch) => {
    const status = ch.joined ? "✅ Joined" : "❌ Not yet";
    return `• ${ch.label}: ${status}`;
  });
  return (
    `🔒 *Access Locked*\n\n` +
    `Sumali muna sa lahat ng channels bago ma-unlock ang access:\n\n` +
    lines.join("\n") +
    `\n\n_Tap a channel button to join, then tap *Check Again*._`
  );
}

const ACCESS_GRANTED_MSG =
  `✅ *Access Granted!*\n\n` +
  `Verified ka na! Piliin kung paano mo gustong manood:\n\n` +
  `🌐 *Watch on Web* — sa browser\n` +
  `📱 *Download App* — para sa mas magandang experience`;

const WELCOME_MSG =
  `👋 *Welcome to Viral Videos!*\n\n` +
  `Para ma-unlock ang access, sumali muna sa aming mga channels.\n\n` +
  `I-tap ang *Check Access* pagkatapos mag-join.`;

// ─── CORE HANDLER ─────────────────────────────────────────────────────────────
async function handleAccessCheck(ctx, isCallback = false) {
  const userId = ctx.from?.id;
  if (!userId) return;

  // Rate limit — prevents spam detection by Telegram
  if (isOnCooldown(userId)) {
    if (isCallback) {
      await ctx.answerCbQuery("⏳ Wait a moment before checking again.", { show_alert: false });
    }
    return;
  }
  setCooldown(userId);

  if (isCallback) {
    await ctx.answerCbQuery("Checking your membership...");
  }

  const { allJoined, results } = await checkAllChannels(userId);

  const replyFn = isCallback
    ? (text, opts) => ctx.editMessageText(text, opts).catch(() => ctx.reply(text, opts))
    : (text, opts) => ctx.reply(text, opts);

  if (!allJoined) {
    return replyFn(buildLockedMessage(results), {
      parse_mode: "Markdown",
      ...buildJoinKeyboard(results),
    });
  }

  return replyFn(ACCESS_GRANTED_MSG, {
    parse_mode: "Markdown",
    ...buildAccessKeyboard(),
  });
}

// ─── BOT SETUP ────────────────────────────────────────────────────────────────
const bot = new Telegraf(BOT_TOKEN);

// /start command
bot.start(async (ctx) => {
  const payload = ctx.startPayload; // text after /start (e.g. /start check_access)
  if (payload === "check_access") {
    return handleAccessCheck(ctx, false);
  }
  return ctx.reply(WELCOME_MSG, {
    parse_mode: "Markdown",
    ...Markup.inlineKeyboard([
      [Markup.button.callback("🔍 Check Access", "check_join")],
    ]),
  });
});

// Inline button callback
bot.action("check_join", (ctx) => handleAccessCheck(ctx, true));

// Global error handler — never let uncaught errors crash the bot
bot.catch((err, ctx) => {
  console.error(`[BOT ERROR] Update ${ctx?.update?.update_id}:`, err.message || err);
});

// ─── EXPRESS + WEBHOOK ────────────────────────────────────────────────────────
const app = express();
app.use(express.json());

app.get("/", (_req, res) => res.send("Viral Videos Force Join Bot is running."));
app.get("/health", (_req, res) =>
  res.json({ ok: true, channels: CHANNELS.length, mode: WEBHOOK_DOMAIN ? "webhook" : "polling" })
);

async function startBot() {
  if (WEBHOOK_DOMAIN) {
    // ── WEBHOOK MODE (recommended for production / Railway) ──
    const webhookUrl = `${WEBHOOK_DOMAIN}${WEBHOOK_PATH}`;

    // Register webhook with Telegram
    await bot.telegram.setWebhook(webhookUrl);
    console.log(`[INFO] Webhook set: ${webhookUrl}`);

    // Express handles incoming updates from Telegram
    app.use(WEBHOOK_PATH, (req, res) => bot.handleUpdate(req.body, res));

    app.listen(PORT, () => console.log(`[INFO] Server on port ${PORT}`));
  } else {
    // ── LONG POLLING MODE (for local dev only) ──
    console.warn("[WARN] No WEBHOOK_DOMAIN set — falling back to long polling (dev only)");
    await bot.telegram.deleteWebhook();
    app.listen(PORT, () => console.log(`[INFO] Health server on port ${PORT}`));
    await bot.launch();
    console.log("[INFO] Bot launched via polling.");
  }
}

startBot().catch((err) => {
  console.error("[FATAL] Failed to start bot:", err);
  process.exit(1);
});

process.once("SIGINT",  () => { bot.stop("SIGINT");  process.exit(0); });
process.once("SIGTERM", () => { bot.stop("SIGTERM"); process.exit(0); });
