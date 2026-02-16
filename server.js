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

// สร้าง table ถ้ายังไม่มี
async function initDB() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS alerts (
      id SERIAL PRIMARY KEY,
      user_id TEXT,
      symbol TEXT,
      target NUMERIC
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

// ================= GET PRICE =================
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
      symbol: key,
      price: data.usd,
      change: data.usd_24h_change
    };

  } catch (err) {
    console.log("PRICE ERROR:", err.message);
    return null;
  }
}

// ================= CHECK ALERTS =================
async function checkAlerts() {
  const result = await pool.query("SELECT * FROM alerts");

  for (const alert of result.rows) {
    const priceData = await getPrice(alert.symbol);
    if (!priceData) continue;

    if (priceData.price >= alert.target) {
      await client.pushMessage(alert.user_id, {
        type: "text",
        text: `🚨 แจ้งเตือน!\n${alert.symbol} ถึง ${priceData.price} USD แล้ว`
      });

      await pool.query("DELETE FROM alerts WHERE id = $1", [alert.id]);
    }
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
    const textUpper = text.toUpperCase();

    // ===== LIST =====
    if (textUpper === "LIST" || text === "รายการแจ้งเตือน") {
      const result = await pool.query(
        "SELECT * FROM alerts WHERE user_id = $1",
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
        message += `${i + 1}. ${a.symbol} ที่ ${a.target} USD\n`;
      });

      return client.replyMessage(event.replyToken, {
        type: "text",
        text: message
      });
    }

    // ===== ALERT =====
    if (textUpper.startsWith("ALERT ") || text.startsWith("แจ้งเตือน ")) {
      const parts = text.split(" ");
      const symbol = parts[1];
      const target = parseFloat(parts[2]);

      if (!symbol || isNaN(target)) {
        return client.replyMessage(event.replyToken, {
          type: "text",
          text: "รูปแบบ: ALERT BTC 70000"
        });
      }

      await pool.query(
        "INSERT INTO alerts (user_id, symbol, target) VALUES ($1, $2, $3)",
        [userId, symbol.toUpperCase(), target]
      );

      return client.replyMessage(event.replyToken, {
        type: "text",
        text: `เพิ่มแจ้งเตือน ${symbol} ที่ ${target} USD แล้ว`
      });
    }

    // ===== PRICE =====
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
        `💰 ${priceData.symbol}\n` +
        `ราคา: ${priceData.price} USD\n` +
        `24h: ${priceData.change.toFixed(2)}%`
    });

  } catch (err) {
    console.log("WEBHOOK ERROR:", err);
    res.sendStatus(500);
  }
});

app.listen(process.env.PORT || 3000, () => {
  console.log("Server running with DB...");
});
