const express = require("express")
const axios = require("axios")
const { Client } = require("pg")
const line = require("@line/bot-sdk")

const app = express()
app.use(express.json())

const PORT = process.env.PORT || 10000

// ======================
// LINE CONFIG
// ======================
const lineConfig = {
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
  channelSecret: process.env.LINE_CHANNEL_SECRET
}
const client = new line.Client(lineConfig)

// ======================
// DATABASE
// ======================
const db = new Client({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
})
db.connect()

db.query(`
CREATE TABLE IF NOT EXISTS alerts (
  id SERIAL PRIMARY KEY,
  user_id TEXT,
  symbol TEXT,
  target NUMERIC
)
`)

// ======================
// CACHE
// ======================
const cache = {}
const TTL = 20000

// ======================
// SAFE REQUEST
// ======================
async function safe(url) {
  const res = await axios.get(url, { timeout: 8000 })
  return res.data
}

// ======================
// PRICE FETCHERS
// ======================
async function getGoldYahoo() {
  const data = await safe(
    "https://query1.finance.yahoo.com/v7/finance/quote?symbols=GC=F"
  )
  const r = data.quoteResponse.result[0]
  return {
    price: r.regularMarketPrice,
    change24: r.regularMarketChangePercent
  }
}

async function getGoldCG() {
  const data = await safe(
    "https://api.coingecko.com/api/v3/simple/price?ids=tether-gold&vs_currencies=usd&include_24hr_change=true"
  )
  return {
    price: data["tether-gold"].usd,
    change24: data["tether-gold"].usd_24h_change
  }
}

async function getCrypto(symbol) {
  try {
    const data = await safe(
      `https://api.binance.com/api/v3/ticker/24hr?symbol=${symbol}`
    )
    return {
      price: parseFloat(data.lastPrice),
      change24: parseFloat(data.priceChangePercent)
    }
  } catch {
    const id = symbol === "BTCUSDT" ? "bitcoin" : "ethereum"
    const data = await safe(
      `https://api.coingecko.com/api/v3/simple/price?ids=${id}&vs_currencies=usd&include_24hr_change=true`
    )
    return {
      price: data[id].usd,
      change24: data[id].usd_24h_change
    }
  }
}

// ======================
// MAIN PRICE
// ======================
async function getPrice(symbol) {

  if (cache[symbol] && Date.now() - cache[symbol].time < TTL)
    return cache[symbol].data

  let result

  if (symbol === "GOLD") {
    try {
      result = await getGoldYahoo()
    } catch {
      result = await getGoldCG()
    }
  }

  if (symbol === "BTC") {
    result = await getCrypto("BTCUSDT")
  }

  if (symbol === "ETH") {
    result = await getCrypto("ETHUSDT")
  }

  cache[symbol] = { data: result, time: Date.now() }
  return result
}

// ======================
// ALERT CHECKER
// ======================
async function checkAlerts() {

  const alerts = await db.query("SELECT * FROM alerts")

  for (const a of alerts.rows) {

    const priceData = await getPrice(a.symbol)
    const price = priceData.price

    if (price >= a.target) {

      await client.pushMessage(a.user_id, {
        type: "text",
        text: `🚨 ${a.symbol} ถึง ${price} USD แล้ว!`
      })

      await db.query("DELETE FROM alerts WHERE id=$1", [a.id])
    }
  }
}

setInterval(checkAlerts, 60000)

// ======================
// FLEX
// ======================
function buildFlex(name, data) {

  const color = data.change24 >= 0 ? "#00C853" : "#D50000"

  return {
    type: "flex",
    altText: `${name} Price`,
    contents: {
      type: "bubble",
      body: {
        type: "box",
        layout: "vertical",
        contents: [
          { type: "text", text: `💰 ${name}`, weight: "bold", size: "xl" },
          { type: "text", text: `$${data.price}`, size: "lg", margin: "md" },
          { type: "text", text: `24H: ${data.change24.toFixed(2)}%`, color }
        ]
      }
    }
  }
}

// ======================
// WEBHOOK
// ======================
app.post("/webhook", async (req, res) => {

  const event = req.body.events?.[0]
  if (!event?.message?.text) return res.sendStatus(200)

  const text = event.message.text.toLowerCase()

  try {

    if (text === "btc" || text === "eth" || text === "gold" || text === "ทอง") {

      const symbol =
        text === "btc" ? "BTC" :
        text === "eth" ? "ETH" :
        "GOLD"

      const data = await getPrice(symbol)
      const flex = buildFlex(symbol, data)

      await client.replyMessage(event.replyToken, flex)
    }

    if (text.startsWith("alert")) {

      const parts = text.split(" ")
      const symbol = parts[1].toUpperCase()
      const target = parseFloat(parts[2])

      await db.query(
        "INSERT INTO alerts (user_id, symbol, target) VALUES ($1,$2,$3)",
        [event.source.userId, symbol, target]
      )

      await client.replyMessage(event.replyToken, {
        type: "text",
        text: `ตั้งเตือน ${symbol} ที่ ${target} USD แล้ว`
      })
    }

  } catch (err) {
    console.log(err.message)
  }

  res.sendStatus(200)
})

app.get("/", (req, res) => {
  res.send("HYBRID BOT ACTIVE 🚀")
})

app.listen(PORT, () => {
  console.log("🚀 HYBRID BOT RUNNING")
})
