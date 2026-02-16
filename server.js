const express = require("express");
const axios = require("axios");
const crypto = require("crypto");

const app = express();
app.use(express.json());

// ===== ใส่จาก Render Environment ทีหลัง =====
const CHANNEL_SECRET = process.env.CHANNEL_SECRET;
const CHANNEL_ACCESS_TOKEN = process.env.CHANNEL_ACCESS_TOKEN;

// ===== ตรวจสอบลายเซ็น LINE =====
function verifySignature(req) {
  const signature = req.headers["x-line-signature"];
  const body = JSON.stringify(req.body);

  const hash = crypto
    .createHmac("SHA256", CHANNEL_SECRET)
    .update(body)
    .digest("base64");

  return hash === signature;
}

// ===== ดึงราคา Crypto จาก CoinGecko =====
async function getCryptoPrice(symbol) {
  const map = {
    BTC: "bitcoin",
    ETH: "ethereum",
  };

  if (!map[symbol]) return null;

  const url = `https://api.coingecko.com/api/v3/simple/price?ids=${map[symbol]}&vs_currencies=usd`;
  const res = await axios.get(url);
  return res.data[map[symbol]].usd;
}

// ===== ดึงราคาหุ้นจาก Yahoo Finance =====
async function getStockPrice(symbol) {
  try {
    const url = `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${symbol}`;
    const res = await axios.get(url);
    return res.data.quoteResponse.result[0].regularMarketPrice;
  } catch {
    return null;
  }
}

// ===== webhook =====
app.post("/webhook", async (req, res) => {
  if (!verifySignature(req)) {
    return res.status(401).send("Unauthorized");
  }

  const events = req.body.events;

  for (let event of events) {
    if (event.type === "message" && event.message.type === "text") {
      const userText = event.message.text.toUpperCase();
      let replyText = "ไม่พบข้อมูล";

      // ===== GOLD (สมมุติใช้ราคาทองโลกจาก Yahoo) =====
      if (userText === "GOLD") {
        const gold = await getStockPrice("GC=F");
        if (gold) replyText = `ราคาทองคำโลก: ${gold} USD`;
      }

      // ===== Crypto =====
      const cryptoPrice = await getCryptoPrice(userText);
      if (cryptoPrice) {
        replyText = `${userText} ราคา: ${cryptoPrice} USD`;
      }

      // ===== หุ้น =====
      const stockPrice = await getStockPrice(userText);
      if (stockPrice) {
        replyText = `${userText} ราคา: ${stockPrice}`;
      }

      await axios.post(
        "https://api.line.me/v2/bot/message/reply",
        {
          replyToken: event.replyToken,
          messages: [{ type: "text", text: replyText }],
        },
        {
          headers: {
            Authorization: `Bearer ${CHANNEL_ACCESS_TOKEN}`,
            "Content-Type": "application/json",
          },
        }
      );
    }
  }

  res.sendStatus(200);
});

app.get("/", (req, res) => {
  res.send("Smart Asset Bot Running");
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("Server running on port " + PORT));
