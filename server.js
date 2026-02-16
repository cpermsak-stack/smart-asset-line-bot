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

// ===============================
// MEMORY STORAGE
// ===============================
const userWatchlist = {};
const userAlerts = {};

// ===============================
// GET CRYPTO PRICE
// ===============================
async function getCrypto(symbol) {
  const idMap = {
    BTC: "bitcoin",
    ETH: "ethereum"
  };

  if (!idMap[symbol]) return null;

  try {
    const url = `https://api.coingecko.com/api/v3/simple/price?ids=${idMap[symbol]}&vs_currencies=usd&include_24hr_change=true`;
    const res = await axios.get(url);
    const data = res.data[idMap[symbol]];

    return {
      price: data.usd,
      change: data.usd_24h_change.toFixed(2)
    };
  } catch (err) {
    console.log("Crypto error:", err.message);
    return null;
  }
}

// ===============================
// GET GOLD PRICE (Tether Gold)
// ===============================
async function getGold() {
  try {
    const url = `https://api.coingecko.com/api/v3/simple/price?ids=tether-gold&vs_currencies=usd&include_24hr_change=true`;
    const res = await axios.get(url);
    const data = res.data["tether-gold"];

    return {
      price: data.usd,
      change: data.usd_24h_change.toFixed(2)
    };
  } catch (err) {
    console.log("Gold error:", err.message);
    return null;
  }
}

// ===============================
// ALERT ENGINE
// ===============================
async function checkAlerts() {
  for (const userId in userAlerts) {
    const alert = userAlerts[userId];
    const crypto = await getCrypto(alert.symbol);

    if (!crypto) continue;

    if (crypto.price >= alert.target) {
      await client.pushMessage(userId, {
        type: "text",
        text: `🚨 ALERT!\n${alert.symbol} ถึง ${crypto.price} USD แล้ว`
      });

      delete userAlerts[userId];
    }
  }
}

// เช็คทุก 60 วินาที
setInterval(checkAlerts, 60000);

// ===============================
// WEBHOOK
// ===============================
app.post("/webhook", async (req, res) => {
  try {
    const events = req.body.events;

    await Promise.all(events.map(async (event) => {
      if (event.type !== "message" || event.message.type !== "text") return;

      const userId = event.source.userId;
      const text = event.message.text.toUpperCase();

      // ===== GOLD =====
      if (text === "GOLD") {
        const gold = await getGold();
        if (!gold) {
          return client.replyMessage(event.replyToken, {
            type: "text",
            text: "ดึงราคาทองไม่ได้"
          });
        }

        return client.replyMessage(event.replyToken, {
          type: "text",
          text: `ทองคำ: ${gold.price} USD\n24h: ${gold.change}%`
        });
      }

      // ===== ADD WATCHLIST =====
      if (text.startsWith("ADD ")) {
        const symbol = text.split(" ")[1];
        userWatchlist[userId] = userWatchlist[userId] || [];
        userWatchlist[userId].push(symbol);

        return client.replyMessage(event.replyToken, {
          type: "text",
          text: `เพิ่ม ${symbol} ใน Watchlist แล้ว`
        });
      }

      // ===== LIST WATCHLIST =====
      if (text === "LIST") {
        const list = userWatchlist[userId] || [];
        return client.replyMessage(event.replyToken, {
          type: "text",
          text: list.length ? `Watchlist:\n${list.join("\n")}` : "Watchlist ว่าง"
        });
      }

      // ===== ALERT =====
      if (text.startsWith("ALERT ")) {
        const parts = text.split(" ");
        const symbol = parts[1];
        const target = parseFloat(parts[2]);

        if (!symbol || isNaN(target)) {
          return client.replyMessage(event.replyToken, {
            type: "text",
            text: "รูปแบบ: ALERT BTC 70000"
          });
        }

        userAlerts[userId] = { symbol, target };

        return client.replyMessage(event.replyToken, {
          type: "text",
          text: `ตั้งแจ้งเตือน ${symbol} ที่ ${target} USD แล้ว`
        });
      }

      // ===== CRYPTO =====
      const crypto = await getCrypto(text);
      if (crypto) {
        return client.replyMessage(event.replyToken, {
          type: "text",
          text: `${text} ราคา: ${crypto.price} USD\n24h: ${crypto.change}%`
        });
      }

      return client.replyMessage(event.replyToken, {
        type: "text",
        text: "ไม่พบข้อมูล"
      });
    }));

    res.sendStatus(200);
  } catch (err) {
    console.log("Webhook error:", err.message);
    res.sendStatus(500);
  }
});

// ===============================
app.get("/", (req, res) => {
  res.send("Smart Asset Bot V3 Running");
});

app.listen(10000, () => {
  console.log("Server running on port 10000");
});
