const express = require("express")
const axios = require("axios")

const app = express()
app.use(express.json())

const PORT = process.env.PORT || 10000

// ==========================
// ⚡ GLOBAL CACHE SYSTEM
// ==========================
const cache = {}
const pending = {}
const CACHE_TTL = 20000

// ==========================
// 🔁 SAFE REQUEST
// ==========================
async function safeRequest(url, retries = 2) {
  try {
    const res = await axios.get(url, { timeout: 5000 })
    return res.data
  } catch (err) {
    if (err.response?.status === 429 && retries > 0) {
      await new Promise(r => setTimeout(r, 1200))
      return safeRequest(url, retries - 1)
    }
    throw err
  }
}

// ==========================
// 🧠 MULTI FALLBACK PRICE
// ==========================
async function getPrice(symbol) {

  const now = Date.now()

  if (cache[symbol] && now - cache[symbol].time < CACHE_TTL) {
    return cache[symbol].data
  }

  if (pending[symbol]) return pending[symbol]

  pending[symbol] = (async () => {

    try {

      let data

      // Futures
      try {
        data = await safeRequest(
          `https://fapi.binance.com/fapi/v1/ticker/24hr?symbol=${symbol}`
        )

        return save(symbol, {
          price: parseFloat(data.lastPrice),
          change: parseFloat(data.priceChangePercent)
        })

      } catch {}

      // Spot
      try {
        data = await safeRequest(
          `https://api.binance.com/api/v3/ticker/24hr?symbol=${symbol}`
        )

        return save(symbol, {
          price: parseFloat(data.lastPrice),
          change: parseFloat(data.priceChangePercent)
        })

      } catch {}

      // CoinGecko
      const cgMap = {
        BTCUSDT: "bitcoin",
        ETHUSDT: "ethereum",
        XAUUSDT: "tether-gold"
      }

      if (!cgMap[symbol]) throw new Error("No fallback")

      data = await safeRequest(
        `https://api.coingecko.com/api/v3/simple/price?ids=${cgMap[symbol]}&vs_currencies=usd&include_24hr_change=true`
      )

      const coin = data[cgMap[symbol]]

      return save(symbol, {
        price: coin.usd,
        change: coin.usd_24h_change
      })

    } finally {
      delete pending[symbol]
    }

  })()

  return pending[symbol]
}

function save(symbol, result) {
  cache[symbol] = {
    data: result,
    time: Date.now()
  }
  return result
}

// ==========================
// 🔎 SYMBOL MAP
// ==========================
function mapSymbol(text) {
  const t = text.toLowerCase()

  if (t === "btc") return "BTCUSDT"
  if (t === "eth") return "ETHUSDT"
  if (t === "ทอง" || t === "gold") return "XAUUSDT"

  return null
}

// ==========================
// 🎨 FLEX MESSAGE BUILDER
// ==========================
function buildFlex(symbol, price, change) {

  const coin = symbol.replace("USDT", "")
  const color = change >= 0 ? "#00C853" : "#D50000"
  const arrow = change >= 0 ? "📈" : "📉"

  return {
    type: "flex",
    altText: `${coin} Price`,
    contents: {
      type: "bubble",
      body: {
        type: "box",
        layout: "vertical",
        contents: [
          {
            type: "text",
            text: `💰 ${coin}`,
            weight: "bold",
            size: "xl"
          },
          {
            type: "text",
            text: `$${price.toFixed(2)} USD`,
            size: "lg",
            margin: "md"
          },
          {
            type: "text",
            text: `${arrow} 24H: ${change.toFixed(2)}%`,
            size: "md",
            color: color,
            margin: "sm"
          }
        ]
      }
    }
  }
}

// ==========================
// 🤖 REPLY TO LINE
// ==========================
async function replyLine(replyToken, message) {
  await axios.post(
    "https://api.line.me/v2/bot/message/reply",
    {
      replyToken: replyToken,
      messages: [message]
    },
    {
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.LINE_CHANNEL_ACCESS_TOKEN}`
      }
    }
  )
}

// ==========================
// 🚀 WEBHOOK
// ==========================
app.post("/webhook", async (req, res) => {

  try {

    const event = req.body.events?.[0]
    if (!event?.message?.text) return res.sendStatus(200)

    const symbol = mapSymbol(event.message.text)
    if (!symbol) return res.sendStatus(200)

    const data = await getPrice(symbol)

    const flex = buildFlex(symbol, data.price, data.change)

    await replyLine(event.replyToken, flex)

  } catch (err) {
    console.log("GOD MODE ERROR:", err.message)
  }

  res.sendStatus(200)
})

app.get("/", (req, res) => {
  res.send("LINE GOD MODE ACTIVE 🔥")
})

app.listen(PORT, () => {
  console.log("🚀 LINE GOD MODE RUNNING")
})
