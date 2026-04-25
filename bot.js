require("dotenv").config();

const express = require("express");
const { Telegraf, Markup } = require("telegraf");

const BOT_TOKEN = process.env.BOT_TOKEN;
const REQUIRED_CHAT_IDS = (process.env.REQUIRED_CHAT_IDS || "")
  .split(",")
  .map((id) => id.trim())
  .filter(Boolean);

const JOIN_LINKS = (process.env.JOIN_LINKS || "")
  .split(",")
  .map((link) => link.trim())
  .filter(Boolean);

const FINAL_ACCESS_LINK = process.env.FINAL_ACCESS_LINK;
const PORT = process.env.PORT || 3000;

if (!BOT_TOKEN) {
  console.error("Missing BOT_TOKEN");
  process.exit(1);
}

if (!REQUIRED_CHAT_IDS.length) {
  console.error("Missing REQUIRED_CHAT_IDS");
  process.exit(1);
}

if (!FINAL_ACCESS_LINK) {
  console.error("Missing FINAL_ACCESS_LINK");
  process.exit(1);
}

const bot = new Telegraf(BOT_TOKEN);

/**
 * Simple health server for Railway.
 */
const app = express();

app.get("/", (req, res) => {
  res.send("Force Join Bot is running.");
});

app.get("/health", (req, res) => {
  res.json({
    ok: true,
    requiredChats: REQUIRED_CHAT_IDS.length,
    joinLinks: JOIN_LINKS.length
  });
});

app.listen(PORT, () => {
  console.log(`Health server running on port ${PORT}`);
});

function isJoinedStatus(status) {
  return ["creator", "administrator", "member"].includes(status);
}

async function isUserJoined(chatId, userId) {
  try {
    const member = await bot.telegram.getChatMember(chatId, userId);
    return isJoinedStatus(member.status);
  } catch (error) {
    console.error(`Failed checking chat ${chatId}:`, error.description || error.message);
    return false;
  }
}

async function checkAccess(userId) {
  const checks = [];

  for (const chatId of REQUIRED_CHAT_IDS) {
    const joined = await isUserJoined(chatId, userId);

    checks.push({
      chatId,
      joined
    });
  }

  return {
    allJoined: checks.every((item) => item.joined),
    checks
  };
}

function buildJoinKeyboard() {
  const buttons = [];

  JOIN_LINKS.forEach((link, index) => {
    buttons.push([
      Markup.button.url(`Join Here ${index + 1}`, link)
    ]);
  });

  buttons.push([
    Markup.button.callback("✅ I Joined — Check Again", "check_join")
  ]);

  return Markup.inlineKeyboard(buttons);
}

async function sendAccessResult(ctx) {
  const userId = ctx.from.id;
  const result = await checkAccess(userId);

  if (!result.allJoined) {
    return ctx.reply(
      "🔒 Access locked.\n\nNeed to join here muna before access.\n\nAfter joining, tap “I Joined — Check Again”.",
      buildJoinKeyboard()
    );
  }

  return ctx.reply(
    "✅ Verified! Access granted.",
    Markup.inlineKeyboard([
      [Markup.button.url("Open Access", FINAL_ACCESS_LINK)]
    ])
  );
}

bot.start(async (ctx) => {
  const text = ctx.message?.text || "";
  const payload = text.split(" ")[1];

  if (payload === "check_access") {
    return sendAccessResult(ctx);
  }

  return ctx.reply(
    "Welcome! Complete the required steps first, then check your access here.",
    Markup.inlineKeyboard([
      [Markup.button.callback("Check Access", "check_join")]
    ])
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

process.once("SIGINT", () => {
  bot.stop("SIGINT");
  process.exit(0);
});

process.once("SIGTERM", () => {
  bot.stop("SIGTERM");
  process.exit(0);
});
