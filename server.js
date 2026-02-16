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

const userWatchlist = {};
const userAlerts = {};

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

app.post("/webhook", async (req, res) => {
  try {
    const events = req.body.events;

    await Promise.all(events.map(async (event) => {
      if (event.type !== "message" || event.message.type !== "text") return;

      const userId = event.source.userId;
      const text = event.message.text.toUpperCase();

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

      if (text.startsWith("ADD ")) {
        const symbol = text.split(" ")[1];
        userWatchlist[userId] = userWatchlist[userId] || [];
        userWatchlist[userId].push(symbol);

        return client.replyMessage(event.replyToken, {
          type: "text",
          text: `เพิ่ม ${symbol} แล้ว`
        });
      }

      if (text === "LIST") {
        const list = userWatchlist[userId] || [];
        return client.replyMessage(event.replyToken, {
          type: "text",
          text: list.length ? list.join("\n") : "Watchlist ว่าง"
        });
      }

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

app.get("/", (req, res) => {
  res.send("Smart Asset Bot V2 Running");
});

app.listen(10000, () => {
  console.log("Server running on port 10000");
});
