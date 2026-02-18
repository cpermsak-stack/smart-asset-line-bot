const express = require("express");
const axios = require("axios");
const line = require("@line/bot-sdk");
const { Pool } = require("pg");

const config = {
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
  channelSecret: process.env.LINE_CHANNEL_SECRET
};

const client = new line.Client(config);
const app = express();

// ================= DATABASE =================
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function initDB() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS alerts (
      id SERIAL PRIMARY KEY,
      user_id TEXT,
      symbol TEXT,
      target NUMERIC,
      condition TEXT DEFAULT 'above'
    );
  `);
}
initDB();

// ================= SYMBOL MAP =================
const cryptoMap = {
  BTC: "BTCUSDT",
  ETH: "ETHUSDT",
  BNB: "BNBUSDT"
};

function normalize(text) {
  return text.trim().toUpperCase();
}

// ================= GET PRICE =================
async function getPrices(symbols) {
  const result = {};

  for (const sym of symbols) {
    const symbol = normalize(sym);

    try {
      // ===== CRYPTO (Spot) =====
      if (cryptoMap[symbol]) {
        const response = await axios.get(
          "https://api.binance.com/api/v3/ticker/24hr",
          { params: { symbol: cryptoMap[symbol] } }
        );

        result[symbol] = {
          price: parseFloat(response.data.lastPrice),
          change: parseFloat(response.data.priceChangePercent)
        };
      }

      // ===== GOLD (Binance Futures) =====
      else if (symbol === "ทอง" || symbol === "GOLD") {
        const response = await axios.get(
          "https://fapi.binance.com/fapi/v1/ticker/24hr",
          { params: { symbol: "XAUUSDT" } }
        );

        result[symbol] = {
          price: parseFloat(response.data.lastPrice),
          change: parseFloat(response.data.priceChangePercent)
        };
      }

    } catch (err) {
      console.log("PRICE ERROR for", symbol, err.response?.status);
    }
  }

  return result;
}

// ================= CHECK ALERTS =================
async function checkAlerts() {
  try {
    const result = await pool.query("SELECT * FROM alerts");
    if (result.rows.length === 0) return;

    const symbols = [
      ...new Set(result.rows.map(a => normalize(a.symbol)))
    ];

    const prices = await getPrices(symbols);
    if (!prices || Object.keys(prices).length === 0) return;

    for (const alert of result.rows) {
      const current = prices[normalize(alert.symbol)];
      if (!current) continue;

      const hit =
        (alert.condition === "above" && current.price >= alert.target) ||
        (alert.condition === "below" && current.price <= alert.target);

      if (hit) {
        await client.pushMessage(alert.user_id, {
          type: "text",
          text:
            `🚨 แจ้งเตือน!\n` +
            `${alert.symbol}\n` +
            `ราคา: ${current.price} USD`
        });

        await pool.query("DELETE FROM alerts WHERE id = $1", [alert.id]);
      }
    }

  } catch (err) {
    console.log("CHECK ALERT ERROR:", err.message);
  }
}

setInterval(checkAlerts, 60000);

// ================= WEBHOOK =================
app.post("/webhook", line.middleware(config), async (req, res) => {
  try {
    const event = req.body.events[0];
    if (!event || event.type !== "message") return res.sendStatus(200);

    const text = event.message.text.trim();
    const userId = event.source.userId;

    // ===== ALERT =====
    if (text.toUpperCase().startsWith("ALERT ")) {
      const parts = text.split(" ");
      const symbol = parts[1];
      const target = parseFloat(parts[2]);

      if (!symbol || isNaN(target)) {
        return client.replyMessage(event.replyToken, {
          type: "text",
          text: "ตัวอย่าง: ALERT BTC 70000"
        });
      }

      await pool.query(
        "INSERT INTO alerts (user_id, symbol, target) VALUES ($1,$2,$3)",
        [userId, normalize(symbol), target]
      );

      return client.replyMessage(event.replyToken, {
        type: "text",
        text: "เพิ่มแจ้งเตือนเรียบร้อยแล้ว"
      });
    }

    // ===== PRICE =====
    const prices = await getPrices([text]);
    const data = prices[normalize(text)];

    if (!data) {
      return client.replyMessage(event.replyToken, {
        type: "text",
        text: "ไม่พบข้อมูล"
      });
    }

    return client.replyMessage(event.replyToken, {
      type: "text",
      text:
        `💰 ${normalize(text)}\n` +
        `ราคา: ${data.price} USD\n` +
        `24h: ${data.change}%`
    });

  } catch (err) {
    console.log("WEBHOOK ERROR:", err);
    res.sendStatus(500);
  }
});

app.listen(process.env.PORT || 3000, () => {
  console.log("Server running (Binance Futures Gold FIX) 🚀");
});
