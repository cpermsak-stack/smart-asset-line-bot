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

      // ======================
      // 🥇 GOLD FIX (NO BINANCE)
      // ======================
      if (symbol === "XAUUSDT") {

        const data = await safeRequest(
          "https://api.metals.live/v1/spot"
        )

        const gold = data.find(x => x.gold)

        return save(symbol, {
          price: gold.gold,
          change: 0
        })
      }

      // ======================
      // 🪙 CRYPTO (BINANCE)
      // ======================
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
