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

// ================= CACHE =================
const priceCache = {};
const CACHE_TTL = 30000;

// ================= GET MULTI PRICE =================
async function getPrices(symbols) {
  try {
    const ids = symbols
      .map(sym => cryptoMap[normalize(sym)])
      .filter(Boolean);

    if (ids.length === 0) return {};

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

    symbols.forEach(sym => {
      const key = normalize(sym);
      const id = cryptoMap[key];
      if (response.data[id]) {
        result[key] = {
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
            `${alert.symbol.toUpperCase()} ราคา ${current.price} USD`
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
    const textUpper = text.toUpperCase();
    const userId = event.source.userId;

    // ===== LIST =====
    if (textUpper === "LIST" || text === "รายการแจ้งเตือน") {
      const result = await pool.query(
        "SELECT * FROM alerts WHERE user_id = $1 ORDER BY id",
        [userId]
      );

      if (result.rows.length === 0) {
        return client.replyMessage(event.replyToken, {
          type: "text",
          text: "ยังไม่มีการตั้งแจ้งเตือน"
        });
      }

      let message = "📌 แจ้งเตือนของคุณ\n";
      result.rows.forEach((a, i) => {
        const sign = a.condition === "above" ? "≥" : "≤";
        message += `${i + 1}. ${a.symbol} ${sign} ${a.target}\n`;
      });

      return client.replyMessage(event.replyToken, {
        type: "text",
        text: message
      });
    }

    // ===== DELETE ALL =====
    if (textUpper === "DELETE ALL" || text === "ลบทั้งหมด") {
      await pool.query("DELETE FROM alerts WHERE user_id = $1", [userId]);
      return client.replyMessage(event.replyToken, {
        type: "text",
        text: "ลบแจ้งเตือนทั้งหมดแล้ว"
      });
    }

    // ===== DELETE INDEX =====
    if (textUpper.startsWith("DELETE ") || text.startsWith("ลบ ")) {
      const index = parseInt(text.split(" ")[1]);
      if (isNaN(index)) return res.sendStatus(200);

      const result = await pool.query(
        "SELECT * FROM alerts WHERE user_id = $1 ORDER BY id",
        [userId]
      );

      if (!result.rows[index - 1]) {
        return client.replyMessage(event.replyToken, {
          type: "text",
          text: "ไม่พบรายการ"
        });
      }

      await pool.query("DELETE FROM alerts WHERE id = $1", [
        result.rows[index - 1].id
      ]);

      return client.replyMessage(event.replyToken, {
        type: "text",
        text: "ลบแจ้งเตือนแล้ว"
      });
    }

    // ===== ALERT =====
    if (textUpper.startsWith("ALERT ") || text.startsWith("แจ้งเตือน ")) {
      const parts = text.split(" ");
      const symbol = parts[1];
      let condition = "above";
      let target;

      if (parts.includes("below") || parts.includes("ต่ำกว่า")) {
        condition = "below";
        target = parseFloat(parts[parts.length - 1]);
      } else {
        target = parseFloat(parts[2]);
      }

      if (!symbol || isNaN(target)) {
        return client.replyMessage(event.replyToken, {
          type: "text",
          text: "ตัวอย่าง: ALERT BTC 70000 หรือ ALERT BTC BELOW 65000"
        });
      }

      await pool.query(
        "INSERT INTO alerts (user_id, symbol, target, condition) VALUES ($1,$2,$3,$4)",
        [userId, symbol.toUpperCase(), target, condition]
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
  console.log("Server running (Version 3) 🚀");
});
