// ===================================
// IMPORT
// ===================================
const express = require("express");
const axios = require("axios");
const line = require("@line/bot-sdk");

// ===================================
// CONFIG
// ===================================
const config = {
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
  channelSecret: process.env.LINE_CHANNEL_SECRET
};

const client = new line.Client(config);
const app = express();

// ===================================
// MEMORY STORAGE
// ===================================
const userAlerts = {};

// ===================================
// CRYPTO MAP (รองรับไทย + อังกฤษ)
// ===================================
const cryptoMap = {
  BTC: "bitcoin",
  ETH: "ethereum",
  SOL: "solana",
  BNB: "binancecoin",
  XRP: "ripple",

  // ภาษาไทย
  บิทคอยน์: "bitcoin",
  บิทคอย: "bitcoin",
  อีเธอเรียม: "ethereum",
  ทองคำดิจิทัล: "bitcoin"
};

// ===================================
// NORMALIZE TEXT
// ===================================
function normalizeText(text) {
  return text.trim().toUpperCase();
}

// ===================================
// GET CRYPTO
// ===================================
async function getCrypto(symbolInput) {
  try {
    const key = normalizeText(symbolInput);

    let id = cryptoMap[key];

    // ถ้าไม่เจอใน map ให้ลองตรง ๆ (เช่น btc)
    if (!id && cryptoMap[key.toUpperCase()]) {
      id = cryptoMap[key.toUpperCase()];
    }

    if (!id) return null;

    const response = await axios.get(
      "https://api.coingecko.com/api/v3/simple/price",
      {
        params: {
          ids: id,
          vs_currencies: "usd",
          include_24hr_change: true
        }
      }
    );

    const data = response.data[id];
    if (!data) return null;

    return {
      price: data.usd,
      change: data.usd_24h_change
    };

  } catch (err) {
    console.log("CRYPTO ERROR:", err.message);
    return null;
  }
}

// ===================================
// GET GOLD
// ===================================
async function getGold() {
  try {
    const response = await axios.get(
      "https://api.metals.live/v1/spot/gold"
    );

    if (!response.data || !response.data[0]) return null;

    return response.data[0].price;

  } catch (err) {
    console.log("GOLD ERROR:", err.message);
    return null;
  }
}

// ===================================
// ALERT CHECK
// ===================================
async function checkAlerts() {
  for (const userId in userAlerts) {
    const alert = userAlerts[userId];

    const crypto = await getCrypto(alert.symbol);
    if (!crypto) continue;

    if (crypto.price >= alert.target) {
      await client.pushMessage(userId, {
        type: "text",
        text: `🚨 แจ้งเตือน!\n${alert.symbol} ถึง ${crypto.price} USD แล้ว`
      });

      delete userAlerts[userId];
    }
  }
}

setInterval(checkAlerts, 60000);

// ===================================
// WEBHOOK
// ===================================
app.post("/webhook", line.middleware(config), async (req, res) => {
  try {
    const event = req.body.events[0];
    if (!event || event.type !== "message") return res.sendStatus(200);

    const rawText = event.message.text;
    const text = rawText.trim();
    const textUpper = text.toUpperCase();
    const userId = event.source.userId;

    console.log("USER:", text);

    // ================= GOLD =================
    if (
      textUpper === "GOLD" ||
      text === "ทอง" ||
      text === "ราคาทอง"
    ) {
      const price = await getGold();

      if (!price) {
        return client.replyMessage(event.replyToken, {
          type: "text",
          text: "ดึงราคาทองไม่ได้"
        });
      }

      return client.replyMessage(event.replyToken, {
        type: "text",
        text: `🥇 ราคาทอง: ${price} USD`
      });
    }

    // ================= ALERT =================
    if (
      textUpper.startsWith("ALERT ") ||
      text.startsWith("แจ้งเตือน ")
    ) {
      const parts = text.split(" ");

      const symbol = parts[1];
      const target = parseFloat(parts[2]);

      if (!symbol || isNaN(target)) {
        return client.replyMessage(event.replyToken, {
          type: "text",
          text: "รูปแบบ: ALERT BTC 70000\nหรือ แจ้งเตือน BTC 70000"
        });
      }

      userAlerts[userId] = {
        symbol: symbol,
        target: target
      };

      return client.replyMessage(event.replyToken, {
        type: "text",
        text: `ตั้งแจ้งเตือน ${symbol} ที่ ${target} USD แล้ว`
      });
    }

    // ================= CRYPTO =================
    const crypto = await getCrypto(text);

    if (!crypto) {
      return client.replyMessage(event.replyToken, {
        type: "text",
        text: "ไม่พบข้อมูล"
      });
    }

    return client.replyMessage(event.replyToken, {
      type: "text",
      text:
        `💰 ${text.toUpperCase()}\n` +
        `ราคา: ${crypto.price} USD\n` +
        `24h: ${crypto.change.toFixed(2)}%`
    });

  } catch (err) {
    console.log("WEBHOOK ERROR:", err.message);
    res.sendStatus(500);
  }
});

app.listen(process.env.PORT || 3000, () => {
  console.log("Server running...");
});
