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

// ================= CACHE =================
const priceCache = {
  data: {},
  timestamp: 0
};

const CACHE_TTL = 60000; // 60 วินาที

// ================= GET PRICE =================
async function getPrices(symbols) {
  const now = Date.now();

  // ===== ใช้ cache ถ้ายังไม่หมดอายุ =====
  if (now - priceCache.timestamp < CACHE_TTL) {
    return priceCache.data;
  }

  const result = {};
  const normalized = symbols.map(s => normalize(s));

  try {
    // ===== 1. CRYPTO (Batch Request Binance) =====
    const cryptoSymbols = normalized.filter(s => cryptoMap[s]);

    if (cryptoSymbols.length > 0) {
      const response = await axios.get(
        "https://api.binance.com/api/v3/ticker/24hr"
      );

      cryptoSymbols.forEach(sym => {
        const pair = cryptoMap[sym];
        const found = response.data.find(t => t.symbol === pair);

        if (found) {
          result[sym] = {
            price: parseFloat(found.lastPrice),
            change: parseFloat(found.priceChangePercent)
          };
        }
      });
    }

    // ===== 2. GOLD (Yahoo Finance - XAUUSD) =====
    if (normalized.includes("ทอง") || normalized.includes("GOLD")) {
      const goldRes = await axios.get(
        "https://query1.finance.yahoo.com/v7/finance/quote",
        { params: { symbols: "GC=F" } }
      );

      const goldData = goldRes.data.quoteResponse.result[0];

      result["ทอง"] = {
        price: goldData.regularMarketPrice,
        change: goldData.regularMarketChangePercent
      };

      result["GOLD"] = result["ทอง"];
    }

    // บันทึก cache
    priceCache.data = result;
    priceCache.timestamp = now;

    return result;

  } catch (err) {
    console.log("ULTRA PRICE ERROR:", err.response?.status || err.message);
    return {};
  }
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
        `24h: ${data.change.toFixed(2)}%`
    });

  } catch (err) {
    console.log("WEBHOOK ERROR:", err);
    res.sendStatus(500);
  }
});

app.listen(process.env.PORT || 3000, () => {
  console.log("Server running (ULTRA STABLE) 🚀");
});
