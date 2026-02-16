const express = require("express");
const axios = require("axios");
const line = require("@line/bot-sdk");

const app = express();

const config = {
  channelSecret: process.env.CHANNEL_SECRET,
  channelAccessToken: process.env.CHANNEL_ACCESS_TOKEN
};

const client = new line.Client(config);

app.use("/webhook", line.middleware(config));
app.use(express.json());

// ===== MEMORY STORAGE (Watchlist + Alerts) =====
const userWatchlist = {};
const userAlerts = {};

// ===== Helper: Get Crypto Price =====
async function getCrypto(symbol) {
  const idMap = {
    BTC: "bitcoin",
    ETH: "ethereum"
  };

  if (!idMap[symbol]) return null;

  const url = `https://api.coingecko.com/api/v3/simple/price?ids=${idMap[symbol]}&vs_currencies=usd&include_24hr_change=true`;

  const res = await axios.get(url);
  const data = res.data[idMap[symbol]];

  return {
    price: data.usd,
    change: data.usd_24h_change.toFixed(2)
  };
}

// ===== Helper: Gold Price (via BTC proxy for demo) =====
async function getGold() {
  const url = `https://api.coingecko.com/api/v3/simple/price?ids=tether-gold&vs_currencies=usd&include_24hr_change=true`;
  const res = await axios.get(url);
  const data = res.data["tether-gold"];

  return {
    price: data.usd,
    change: data.usd_24h_change.toFixed(2)
  };
}

// ===== Alert Checker =====
async function checkAlerts() {
  for (const userId in userAlerts) {
    const alert = userAlerts[userId];
    const crypto = await getCrypto(alert.symbol);
    if (crypto && crypto.price >= alert.target) {
      await client.pushMessage(userId, {
        type: "text",
        text: `🚨 ${alert.symbol} ถึง ${crypto.price} USD แล้ว`
      });
      delete userAlerts[userId];
    }
  }
}

setInterval(checkAlerts, 60000); // เช็คทุก 1 นาที

// ===== Webhook =====
app.post("/webhook", async (req, res) => {
  const events = req.body.events;

  for (const event of events) {
    if (event.type !== "message" || event.message.type !== "text") continue;

    const userId = event.source.userId;
    const text = event.message.text.toUpperCase();

    // ===== GOLD =====
    if (text === "GOLD") {
      const gold = await getGold();
      await client.replyMessage(event.replyToken, {
        type: "text",
        text: `ทองคำ: ${gold.price} USD\n24h: ${gold.change}%`
      });
      continue;
    }

    // ===== WATCHLIST =====
    if (text.startsWith("ADD ")) {
      const symbol = text.split(" ")[1];
      userWatchlist[userId] = userWatchlist[userId] || [];
      userWatchlist[userId].push(symbol);

      await client.replyMessage(event.replyToken, {
        type: "text",
        text: `เพิ่ม ${symbol} ใน Watchlist แล้ว`
      });
      continue;
    }

    if (text === "LIST") {
      const list = userWatchlist[userId] || [];
      await client.replyMessage(event.replyToken, {
        type: "text",
        text: list.length ? `Watchlist:\n${list.join("\n")}` : "ไม่มีรายการ"
      });
      continue;
    }

    // ===== ALERT =====
    if (text.startsWith("ALERT ")) {
      const parts = text.split(" ");
      const symbol = parts[1];
      const target = parseFloat(parts[2]);

      userAlerts[userId] = { symbol, target };

      await client.replyMessage(event.replyToken, {
        type: "text",
        text: `ตั้งแจ้งเตือน ${symbol} ที่ ${target} USD แล้ว`
      });
      continue;
    }

    // ===== CRYPTO =====
    const crypto = await getCrypto(text);
    if (crypto) {
      await client.replyMessage(event.replyToken, {
        type: "text",
        text: `${text} ราคา: ${crypto.price} USD\n24h: ${crypto.change}%`
      });
    }
  }

  res.sendStatus(200);
});

app.get("/", (req, res) => {
  res.send("Smart Asset Bot Running V2");
});

app.listen(10000, () => {
  console.log("Server running on port 10000");
});
