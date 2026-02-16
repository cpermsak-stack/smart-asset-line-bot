// ===================================
const express = require("express");
const axios = require("axios");
const line = require("@line/bot-sdk");

// ===================================
const config = {
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
  channelSecret: process.env.LINE_CHANNEL_SECRET
};

const client = new line.Client(config);
const app = express();

// ===================================
const userAlerts = {};

// ===================================
// MAP รองรับ ไทย + อังกฤษ
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

  // GOLD ใช้ PAXG
  GOLD: "pax-gold",
  ทอง: "pax-gold",
  ราคาทอง: "pax-gold"
};

// ===================================
function normalize(text) {
  return text.trim().toUpperCase();
}

// ===================================
async function getPrice(symbolInput) {
  try {
    const key = normalize(symbolInput);
    const id = cryptoMap[key];

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
      name: key,
      price: data.usd,
      change: data.usd_24h_change
    };

  } catch (err) {
    console.log("PRICE ERROR:", err.message);
    return null;
  }
}

// ===================================
async function checkAlerts() {
  for (const userId in userAlerts) {
    const alert = userAlerts[userId];
    const priceData = await getPrice(alert.symbol);

    if (!priceData) continue;

    if (priceData.price >= alert.target) {
      await client.pushMessage(userId, {
        type: "text",
        text: `🚨 แจ้งเตือน!\n${alert.symbol} ถึง ${priceData.price} USD แล้ว`
      });

      delete userAlerts[userId];
    }
  }
}

setInterval(checkAlerts, 60000);

// ===================================
app.post("/webhook", line.middleware(config), async (req, res) => {
  try {
    const event = req.body.events[0];
    if (!event || event.type !== "message") return res.sendStatus(200);

    const text = event.message.text.trim();
    const textUpper = text.toUpperCase();
    const userId = event.source.userId;

    console.log("USER:", text);

    // ===== ALERT =====
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

      userAlerts[userId] = { symbol, target };

      return client.replyMessage(event.replyToken, {
        type: "text",
        text: `ตั้งแจ้งเตือน ${symbol} ที่ ${target} USD แล้ว`
      });
    }

    // ===== GET PRICE =====
    const priceData = await getPrice(text);

    if (!priceData) {
      return client.replyMessage(event.replyToken, {
        type: "text",
        text: "ไม่พบข้อมูล"
      });
    }

    return client.replyMessage(event.replyToken, {
      type: "text",
      text:
        `💰 ${priceData.name}\n` +
        `ราคา: ${priceData.price} USD\n` +
        `24h: ${priceData.change.toFixed(2)}%`
    });

  } catch (err) {
    console.log("WEBHOOK ERROR:", err.message);
    res.sendStatus(500);
  }
});

app.listen(process.env.PORT || 3000, () => {
  console.log("Server running...");
});
