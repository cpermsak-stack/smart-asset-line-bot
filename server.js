const express = require("express")
const axios = require("axios")

const app = express()
app.use(express.json())

const PORT = process.env.PORT || 10000

// =============================
// ⚡ GLOBAL CACHE SYSTEM
// =============================
const cache = {}
const pending = {}
const CACHE_TTL = 20000 // 20 sec

// =============================
// 🔁 SAFE REQUEST WITH RETRY
// =============================
async function safeRequest(url, retries = 2) {
  try {
    const res = await axios.get(url, { timeout: 5000 })
    return res.data
  } catch (err) {
    if (err.response?.status === 429 && retries > 0) {
      console.log("⚠️ 429 detected, retrying...")
      await new Promise(r => setTimeout(r, 1200))
      return safeRequest(url, retries - 1)
    }
    throw err
  }
}

// =============================
// 🧠 PRICE FETCHER (MULTI FALLBACK)
// =============================
async function getPrice(symbol) {

  const now = Date.now()

  // 1️⃣ CACHE HIT
  if (cache[symbol] && now - cache[symbol].time < CACHE_TTL) {
    return cache[symbol].data
  }

  // 2️⃣ DEDUPLICATION
  if (pending[symbol]) return pending[symbol]

  pending[symbol] = (async () => {

    try {

      let data

      // =============================
      // PRIMARY: BINANCE FUTURES
      // =============================
      try {
        data = await safeRequest(
          `https://fapi.binance.com/fapi/v1/ticker/24hr?symbol=${symbol}`
        )

        return save(symbol, {
          price: parseFloat(data.lastPrice).toFixed(2),
          change: parseFloat(data.priceChangePercent).toFixed(2)
        })

      } catch (e) {
        console.log("⚠️ Futures failed → Trying Spot...")
      }

      // =============================
      // SECONDARY: BINANCE SPOT
      // =============================
      try {
        data = await safeRequest(
          `https://api.binance.com/api/v3/ticker/24hr?symbol=${symbol}`
        )

        return save(symbol, {
          price: parseFloat(data.lastPrice).toFixed(2),
          change: parseFloat(data.priceChangePercent).toFixed(2)
        })

      } catch (e) {
        console.log("⚠️ Spot failed → Trying CoinGecko...")
      }

      // =============================
      // THIRD: COINGECKO FALLBACK
      // =============================
      const cgMap = {
        BTCUSDT: "bitcoin",
        ETHUSDT: "ethereum",
        XAUUSDT: "tether-gold"
      }

      if (!cgMap[symbol]) throw new Error("No fallback available")

      data = await safeRequest(
        `https://api.coingecko.com/api/v3/simple/price?ids=${cgMap[symbol]}&vs_currencies=usd&include_24hr_change=true`
      )

      const coin = data[cgMap[symbol]]

      return save(symbol, {
        price: parseFloat(coin.usd).toFixed(2),
        change: parseFloat(coin.usd_24h_change).toFixed(2)
      })

    } finally {
      delete pending[symbol]
    }

  })()

  return pending[symbol]
}

// =============================
// 💾 SAVE CACHE
// =============================
function save(symbol, result) {
  cache[symbol] = {
    data: result,
    time: Date.now()
  }
  return result
}

// =============================
// 🔎 SYMBOL MAP
// =============================
function mapSymbol(text) {
  const t = text.toLowerCase()

  if (t === "btc") return "BTCUSDT"
  if (t === "eth") return "ETHUSDT"
  if (t === "ทอง" || t === "gold") return "XAUUSDT"

  return null
}

// =============================
// 🤖 LINE WEBHOOK
// =============================
app.post("/webhook", async (req, res) => {

  try {
    const event = req.body.events?.[0]
    if (!event?.message?.text) return res.sendStatus(200)

    const symbol = mapSymbol(event.message.text)
    if (!symbol) return res.sendStatus(200)

    const data = await getPrice(symbol)

    console.log(`🔥 ${symbol} => ${data.price} (${data.change}%)`)

  } catch (err) {
    console.log("❌ GOD MODE ERROR:", err.message)
  }

  res.sendStatus(200)
})

// =============================
app.get("/", (req, res) => {
  res.send("GOD MODE ACTIVE 🔥")
})

app.listen(PORT, () => {
  console.log("🚀 Server running (GOD MODE)")
})
