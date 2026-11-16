export default {
  async fetch(request, env, ctx) {
    env = normalizeEnv(env);

    if (request.method !== "POST") {
      // Visit https://<your-worker>/setup once to connect Telegram to this Worker
      if (new URL(request.url).pathname === "/setup") {
        return setupWebhook(request, env);
      }
      return new Response("Bot is active and ready!", { status: 200 });
    }

    // Reject requests that don't come from Telegram (enabled when WEBHOOK_SECRET is set)
    if (env.WEBHOOK_SECRET &&
        request.headers.get("X-Telegram-Bot-Api-Secret-Token") !== env.WEBHOOK_SECRET) {
      return new Response("Unauthorized", { status: 401 });
    }

    try {
      const payload = await request.json();

      // Only process text messages in private chats (ignore groups/channels,
      // so the bot never treats group messages as Bitly tokens)
      if (!payload.message || !payload.message.text || payload.message.chat.type !== "private") {
        return new Response("OK", { status: 200 });
      }

      const chatId = payload.message.chat.id;
      const userId = payload.message.from.id;
      const text = payload.message.text.trim();

      // Basic anti-spam: limit how often one user can use the bot
      if (isRateLimited(userId)) {
        await sendMessage(env, chatId, "<b>⏳ Slow down</b>\n\nToo many requests. Please wait a minute and try again.");
        return new Response("OK", { status: 200 });
      }

      // 1. Verify Channel Membership (optional — only when CHANNEL_ID is set)
      if (env.CHANNEL_ID) {
        const isSubscribed = await checkMembership(env, userId);

        if (!isSubscribed) {
          await sendForceJoinMessage(env, chatId);
          return new Response("OK", { status: 200 });
        }
      }

      // 2. Handle User Input
      if (text === "/start") {
        await sendWelcomeMessage(env, chatId);
      } else {
        // Treat any other text as a Bitly token
        const limitMessage = await getBitlyLimit(text);
        await sendMessage(env, chatId, limitMessage);
      }

      return new Response("OK", { status: 200 });
    } catch (error) {
      console.error("Worker Error:", error);
      // Always return 200 so Telegram doesn't retry the same failed message
      return new Response("OK", { status: 200 });
    }
  }
};

// --- CORE FUNCTIONS ---

// Optional settings left blank or set to "none" are treated as not set
const OPTIONAL_KEYS = ["WEBHOOK_SECRET", "CHANNEL_ID", "CHANNEL_LINK", "CHANNEL_BUTTON_TEXT", "WELCOME_EXTRA"];

function normalizeEnv(env) {
  const out = { ...env };
  for (const key of OPTIONAL_KEYS) {
    const value = typeof out[key] === "string" ? out[key].trim() : out[key];
    out[key] = !value || String(value).toLowerCase() === "none" ? undefined : value;
  }
  return out;
}

// Per-user rate limit: max RATE_LIMIT messages per RATE_WINDOW_MS.
// Stored in memory, so it is best-effort (each Cloudflare instance keeps its own count).
const RATE_LIMIT = 10;
const RATE_WINDOW_MS = 60 * 1000;
const rateBuckets = new Map();

function isRateLimited(userId) {
  const now = Date.now();
  const recent = (rateBuckets.get(userId) || []).filter(t => now - t < RATE_WINDOW_MS);
  recent.push(now);
  rateBuckets.set(userId, recent);

  // Keep memory small
  if (rateBuckets.size > 5000) {
    for (const [id, times] of rateBuckets) {
      if (!times.some(t => now - t < RATE_WINDOW_MS)) rateBuckets.delete(id);
    }
  }
  return recent.length > RATE_LIMIT;
}

async function setupWebhook(request, env) {
  if (!env.BOT_TOKEN) {
    return new Response("BOT_TOKEN is not set. Add it in Worker Settings → Variables and Secrets.", { status: 500 });
  }
  const params = new URLSearchParams({ url: new URL(request.url).origin });
  if (env.WEBHOOK_SECRET) params.set("secret_token", env.WEBHOOK_SECRET);

  const res = await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/setWebhook?${params}`);
  const data = await res.json();
  return new Response(
    data.ok ? "✅ Webhook connected! Send /start to your bot." : `❌ Failed: ${data.description}`,
    { status: data.ok ? 200 : 500, headers: { "Content-Type": "text/plain; charset=utf-8" } }
  );
}

async function checkMembership(env, userId) {
  const url = `https://api.telegram.org/bot${env.BOT_TOKEN}/getChatMember?chat_id=${env.CHANNEL_ID}&user_id=${userId}`;
  try {
    const response = await fetch(url);
    const data = await response.json();

    if (data.ok) {
      const validStatuses = ['member', 'administrator', 'creator'];
      return validStatuses.includes(data.result.status);
    }
    return false;
  } catch (error) {
    console.error("Membership check failed:", error);
    return false;
  }
}

async function getBitlyLimit(token) {
  try {
    const headers = { 'Authorization': `Bearer ${token}` };
    const orgResponse = await fetch('https://api-ssl.bitly.com/v4/organizations', { headers });

    if (!orgResponse.ok) {
      return "<b>⚠️ Token Error</b>\n\nThis Bitly token seems invalid or blocked.\nPlease double-check it and try again.";
    }

    const orgData = await orgResponse.json();
    const guid = orgData?.organizations?.[0]?.guid;

    if (!guid) {
      return "<b>⚠️ System Error</b>\n\nWe couldn't find an organization linked to this token.";
    }

    const limitUrl = `https://api-ssl.bitly.com/v4/organizations/${guid}/plan_limits`;
    const limitResponse = await fetch(limitUrl, { headers });
    const limitData = await limitResponse.json();

    // Pick the link-creation limit by name/description; fall back to the first item.
    // (Bitly's API docs don't list the possible names, so match loosely.)
    const limits = Array.isArray(limitData?.plan_limits) ? limitData.plan_limits : [];
    const limitInfo =
      limits.find(l => /encode/i.test(l.name || "")) ||
      limits.find(l => /link/i.test(`${l.name || ""} ${l.description || ""}`)) ||
      limits[0];
    if (!limitInfo) {
      return "<b>⚠️ System Error</b>\n\nBitly didn't return plan limits for this token.";
    }
    const remaining = limitInfo.limit - limitInfo.count;

    return `<b>📊 Your Bitly Limits</b>\n\n` +
           `🔹 <b>Total Limit:</b> <code>${limitInfo.limit}</code>\n` +
           `🔸 <b>Used Links:</b> <code>${limitInfo.count}</code>\n` +
           `🟩 <b>Remaining:</b> <code>${remaining}</code>`;

  } catch (error) {
    return "<b>⚠️ Network Error</b>\n\nCould not connect to Bitly right now. Please try again in a moment.";
  }
}

// --- TELEGRAM MESSAGE SENDERS ---

// Project credit shown at the end of the /start message. Please keep it if you deploy this bot. 🙏
const REPO_URL = "https://github.com/Affiliaters/bitly_limit_checker_telegram_bot";
const CREDIT = `<i><a href="${REPO_URL}">Open source on GitHub</a></i>`;

async function sendMessage(env, chatId, text, replyMarkup = null) {
  const url = `https://api.telegram.org/bot${env.BOT_TOKEN}/sendMessage`;

  const payload = {
    chat_id: chatId,
    text: text,
    parse_mode: "HTML",
    link_preview_options: { is_disabled: true },
  };

  if (replyMarkup) {
    payload.reply_markup = replyMarkup;
  }

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });

  const result = await response.json();
  if (!result.ok) {
    console.error("Telegram API Error:", result.description);
  }
}

async function sendWelcomeMessage(env, chatId) {
  let text = `<b>Hi! Welcome to the Bitly Limit Checker</b> ✨\n\n` +
             `Just send me your Bitly token and I'll fetch your usage limits instantly. <i>(Your tokens are never stored)</i>.`;

  // Optional: your own promo text / links (Telegram HTML; write \n for new lines)
  if (env.WELCOME_EXTRA) {
    text += `\n\n` + env.WELCOME_EXTRA.replace(/\\n/g, "\n");
  }

  text += `\n\n` + CREDIT;

  await sendMessage(env, chatId, text);
}

async function sendForceJoinMessage(env, chatId) {
  const text = `<b>Welcome! Let's get you set up.</b> 🌟\n\n` +
               `To unlock this free tool, simply join our channel first.\n\n` +
               `Tap the button below to join, then send your token again!`;

  // Grab the URL from env variables
  // Fall back to a t.me link built from CHANNEL_ID when it's an @username
  let rawUrl = env.CHANNEL_LINK ||
    (String(env.CHANNEL_ID).startsWith("@") ? `https://t.me/${env.CHANNEL_ID.slice(1)}` : "https://telegram.org");

  // FAIL-SAFE: If the URL has markdown brackets like [url](url), extract just the pure link
  if (rawUrl.includes("](") && rawUrl.endsWith(")")) {
      rawUrl = rawUrl.split("](")[1].replace(")", "");
  }

  const replyMarkup = {
    inline_keyboard: [
      [{ text: env.CHANNEL_BUTTON_TEXT || "✨ Join Channel", url: rawUrl }]
    ]
  };

  await sendMessage(env, chatId, text, replyMarkup);
}
