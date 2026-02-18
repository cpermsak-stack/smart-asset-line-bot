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

// ================= MAP =================
const cryptoMap = {
  BTC: "bitcoin",
  ETH: "ethereum",
  GOLD: "pax-gold",
  ทอง: "pax-gold",
  บิทคอยน์: "bitcoin"
};

function normalize(text) {
  return text.trim().toUpperCase();
}

// ================= GET MULTI PRICE =================
async function getPrices(symbols) {
  try {
    const normalized = symbols.map(s => normalize(s));

    const ids = normalized
      .map(sym => cryptoMap[sym])
      .filter(Boolean);

    if (ids.length === 0) {
      return {};
    }

    const uniqueIds = [...new Set(ids)].join(",");

    const response = await axios.get(
      "https://api.coingecko.com/api/v3/simple/price",
      {
        params: {
          ids: uniqueIds,
          vs_currencies: "usd",
          include_24hr_change: true
        }
      }
    );

    const result = {};

    normalized.forEach(sym => {
      const id = cryptoMap[sym];
      if (response.data[id]) {
        result[sym] = {
          price: response.data[id].usd,
          change: response.data[id].usd_24h_change
        };
      }
    });

    return result;

  } catch (err) {
    if (err.response?.status === 429) {
      console.log("RATE LIMIT HIT (429)");
    } else {
      console.log("PRICE ERROR:", err.message);
    }
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
            `${alert.symbol} ราคา ${current.price} USD`
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
  console.log("Server running (Version 3 Fixed) 🚀");
});
