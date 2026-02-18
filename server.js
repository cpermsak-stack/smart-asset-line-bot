const express = require("express")
const axios = require("axios")

const app = express()
app.use(express.json())

const PORT = process.env.PORT || 10000

// =========================
// GLOBAL CACHE SYSTEM
// =========================
const cache = {}
const pending = {}
const CACHE_TTL = 20000

// =========================
// SAFE REQUEST (Retry 429)
// =========================
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

// =========================
// SYMBOL MAP
// =========================
function mapSymbol(text) {
  const t = text.toLowerCase().trim()

  if (t === "btc") return "BTCUSDT"
  if (t === "eth") return "ETHUSDT"
  if (t === "ทอง" || t === "gold") return "XAU"

  return null
}

// =========================
// SAVE CACHE
// =========================
function save(symbol, result) {
  cache[symbol] = {
    data: result,
    time: Date.now()
  }
  return result
}

// =========================
// PRICE FETCHER
// =========================
async function getPrice(symbol) {

  const now = Date.now()

  if (cache[symbol] && now - cache[symbol].time < CACHE_TTL) {
    return cache[symbol].data
  }

  if (pending[symbol]) return pending[symbol]

  pending[symbol] = (async () => {

    try {

      // =====================
      // GOLD (Separate API)
      // =====================
      if (symbol === "XAU") {
        const data = await safeRequest("https://api.metals.live/v1/spot")
        const gold = data.find(x => x.gold)

        return save(symbol, {
          price: gold.gold,
          change: 0
        })
      }

      // =====================
      // CRYPTO (Binance)
      // =====================
      let data

      try {
        data = await safeRequest(
          `https://fapi.binance.com/fapi/v1/ticker/24hr?symbol=${symbol}`
        )

        return save(symbol, {
          price: parseFloat(data.lastPrice),
          change: parseFloat(data.priceChangePercent)
        })

      } catch {}

      data = await safeRequest(
        `https://api.binance.com/api/v3/ticker/24hr?symbol=${symbol}`
      )

      return save(symbol, {
        price: parseFloat(data.lastPrice),
        change: parseFloat(data.priceChangePercent)
      })

    } finally {
      delete pending[symbol]
    }

  })()

  return pending[symbol]
}

// =========================
// FLEX MESSAGE BUILDER
// =========================
function buildFlex(symbol, price, change) {

  const name = symbol === "XAU" ? "GOLD" : symbol.replace("USDT", "")
  const color = change >= 0 ? "#00C853" : "#D50000"
  const arrow = change >= 0 ? "📈" : "📉"

  return {
    type: "flex",
    altText: `${name} Price`,
    contents: {
      type: "bubble",
      body: {
        type: "box",
        layout: "vertical",
        contents: [
          {
            type: "text",
            text: `💰 ${name}`,
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

// =========================
// REPLY LINE
// =========================
async function replyLine(replyToken, message) {
  await axios.post(
    "https://api.line.me/v2/bot/message/reply",
    {
      replyToken,
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

// =========================
// WEBHOOK
// =========================
app.post("/webhook", async (req, res) => {

  const event = req.body.events?.[0]
  if (!event?.message?.text) return res.sendStatus(200)

  try {

    const symbol = mapSymbol(event.message.text)
    if (!symbol) return res.sendStatus(200)

    const data = await getPrice(symbol)

    const flex = buildFlex(symbol, data.price, data.change)

    await replyLine(event.replyToken, flex)

  } catch (err) {

    console.log("FINAL ERROR:", err.message)

    await replyLine(event.replyToken, {
      type: "text",
      text: "⚠️ ระบบกำลังโหลดข้อมูล กรุณาลองใหม่อีกครั้ง"
    })
  }

  res.sendStatus(200)
})

app.get("/", (req, res) => {
  res.send("FINAL CLEAN VERSION ACTIVE 🚀")
})

app.listen(PORT, () => {
  console.log("🚀 FINAL CLEAN VERSION RUNNING")
})
