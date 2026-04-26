require("dotenv").config();

const express  = require("express");
const { Telegraf, Markup } = require("telegraf");

// ─── ENV ──────────────────────────────────────────────────────────────────────
const BOT_TOKEN = process.env.BOT_TOKEN;

const REQUIRED_CHAT_IDS = (process.env.REQUIRED_CHAT_IDS || "")
  .split(",")
  .map((id) => id.trim())
  .filter(Boolean);

const JOIN_LINKS = (process.env.JOIN_LINKS || "")
  .split(",")
  .map((link) => link.trim())
  .filter(Boolean);

// Web access URL (can override via env, defaults to viralvideos.cloud)
const WEB_ACCESS_LINK = process.env.WEB_ACCESS_LINK || "https://viralvideos.cloud/";

// Optional: direct app download link (set in Railway if you have one)
const APP_DOWNLOAD_LINK = process.env.APP_DOWNLOAD_LINK || "https://viralvideos.cloud/download.html";

const PORT = process.env.PORT || 3000;

// ─── VALIDATION ───────────────────────────────────────────────────────────────
if (!BOT_TOKEN) {
  console.error("Missing BOT_TOKEN");
  process.exit(1);
}

if (!REQUIRED_CHAT_IDS.length) {
  console.error("Missing REQUIRED_CHAT_IDS");
  process.exit(1);
}

// ─── EXPRESS HEALTH SERVER ────────────────────────────────────────────────────
const app = express();

app.get("/", (_req, res) => res.send("Force Join Bot is running."));

app.get("/health", (_req, res) =>
  res.json({
    ok: true,
    requiredChats: REQUIRED_CHAT_IDS.length,
    joinLinks: JOIN_LINKS.length,
  })
);

app.listen(PORT, () => console.log(`Health server running on port ${PORT}`));

// ─── BOT ──────────────────────────────────────────────────────────────────────
const bot = new Telegraf(BOT_TOKEN);

function isJoinedStatus(status) {
  return ["creator", "administrator", "member"].includes(status);
}

async function isUserJoined(chatId, userId) {
  try {
    const member = await bot.telegram.getChatMember(chatId, userId);
    return isJoinedStatus(member.status);
  } catch (error) {
    console.error(
      `Failed checking chat ${chatId}:`,
      error.description || error.message
    );
    return false;
  }
}

async function checkAccess(userId) {
  const checks = [];
  for (const chatId of REQUIRED_CHAT_IDS) {
    const joined = await isUserJoined(chatId, userId);
    checks.push({ chatId, joined });
  }
  return {
    allJoined: checks.every((item) => item.joined),
    checks,
  };
}

function buildJoinKeyboard() {
  const buttons = JOIN_LINKS.map((link, index) => [
    Markup.button.url(`📌 Join Here ${index + 1}`, link),
  ]);
  buttons.push([Markup.button.callback("✅ I Joined — Check Again", "check_join")]);
  return Markup.inlineKeyboard(buttons);
}

function buildAccessKeyboard() {
  const buttons = [
    [Markup.button.url("🌐 Watch on Web", WEB_ACCESS_LINK)],
  ];

  if (APP_DOWNLOAD_LINK) {
    buttons.push([Markup.button.url("📱 Download the App", APP_DOWNLOAD_LINK)]);
  }

  return Markup.inlineKeyboard(buttons);
}

async function sendAccessResult(ctx) {
  const userId = ctx.from.id;   // fixed — was markdown-corrupted
  const result  = await checkAccess(userId);

  if (!result.allJoined) {
    return ctx.reply(
      "🔒 *Access Locked*\n\nSumali muna sa lahat ng required channels bago mag-access.\n\nTapos i-tap ang *I Joined — Check Again*.",
      { parse_mode: "Markdown", ...buildJoinKeyboard() }
    );
  }

  return ctx.reply(
    "✅ *Verified! Access Granted.*\n\nPiliin kung paano mo gustong manood:\n\n🌐 *Watch on Web* — buksan sa browser\n📱 *Download the App* — para sa mas magandang experience",
    { parse_mode: "Markdown", ...buildAccessKeyboard() }
  );
}

// ─── HANDLERS ─────────────────────────────────────────────────────────────────
bot.start(async (ctx) => {
  const text    = ctx.message?.text || "";
  const payload = text.split(" ")[1];

  if (payload === "check_access") {
    return sendAccessResult(ctx);
  }

  return ctx.reply(
    "👋 *Welcome!*\n\nSumali muna sa required channels para ma-unlock ang access.\n\nTapos i-tap ang *Check Access* button.",
    {
      parse_mode: "Markdown",
      ...Markup.inlineKeyboard([
        [Markup.button.callback("🔍 Check Access", "check_join")],
      ]),
    }
  );
});

bot.action("check_join", async (ctx) => {
  try {
    await ctx.answerCbQuery("Checking...");
    return sendAccessResult(ctx);
  } catch (error) {
    console.error("check_join error:", error.description || error.message);
    return ctx.reply("Something went wrong. Please try again.");
  }
});

bot.catch((error) => {
  console.error("Bot error:", error);
});

// ─── START ────────────────────────────────────────────────────────────────────
async function startBot() {
  try {
    await bot.launch();
    console.log("Telegram bot is running.");
  } catch (error) {
    console.error("Failed to launch bot:", error);
    process.exit(1);
  }
}

startBot();

process.once("SIGINT",  () => { bot.stop("SIGINT");  process.exit(0); });
process.once("SIGTERM", () => { bot.stop("SIGTERM"); process.exit(0); });
