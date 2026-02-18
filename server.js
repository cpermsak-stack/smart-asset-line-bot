const express = require("express")
const axios = require("axios")
require("dotenv").config()

const app = express()
app.use(express.json())

const PORT = process.env.PORT || 10000

// ===== GLOBAL CACHE =====
const priceCache = {}
const pendingRequests = {}
const CACHE_TTL = 15000 // 15 sec

// ===== SAFE FETCH FUNCTION =====
async function fetchWithRetry(url, retries = 2) {
  try {
    const res = await axios.get(url, { timeout: 5000 })
    return res.data
  } catch (err) {
    if (err.response && err.response.status === 429 && retries > 0) {
      console.log("⚠️ Hit 429, retrying...")
      await new Promise(r => setTimeout(r, 1000))
      return fetchWithRetry(url, retries - 1)
    }
    throw err
  }
}

// ===== BINANCE PRICE FETCHER =====
async function getBinancePrice(symbol) {

  const now = Date.now()

  // 1️⃣ Use cache if fresh
  if (priceCache[symbol] && now - priceCache[symbol].time < CACHE_TTL) {
    return priceCache[symbol].data
  }

  // 2️⃣ If already fetching → return same promise
  if (pendingRequests[symbol]) {
    return pendingRequests[symbol]
  }

  // 3️⃣ Create new fetch promise
  pendingRequests[symbol] = (async () => {
    try {
      const data = await fetchWithRetry(
        `https://api.binance.com/api/v3/ticker/24hr?symbol=${symbol}`
      )

      const result = {
        price: parseFloat(data.lastPrice).toFixed(2),
        change: parseFloat(data.priceChangePercent).toFixed(2)
      }

      priceCache[symbol] = {
        data: result,
        time: Date.now()
      }

      return result

    } finally {
      delete pendingRequests[symbol]
    }
  })()

  return pendingRequests[symbol]
}

// ===== SYMBOL MAPPER =====
function mapSymbol(text) {
  const t = text.toLowerCase()

  if (t === "btc") return "BTCUSDT"
  if (t === "eth") return "ETHUSDT"
  if (t === "ทอง" || t === "gold") return "XAUUSDT"

  return null
}

// ===== LINE WEBHOOK =====
app.post("/webhook", async (req, res) => {
  try {
    const event = req.body.events?.[0]
    if (!event) return res.sendStatus(200)

    const text = event.message?.text
    if (!text) return res.sendStatus(200)

    const symbol = mapSymbol(text)
    if (!symbol) return res.sendStatus(200)

    const data = await getBinancePrice(symbol)

    console.log(`✅ ${symbol} => ${data.price}`)

  } catch (err) {
    console.log("❌ ULTRA ERROR:", err.message)
  }

  res.sendStatus(200)
})

// ===== HEALTH CHECK =====
app.get("/", (req, res) => {
  res.send("ULTRA STABLE V2 🚀")
})

app.listen(PORT, () => {
  console.log("🚀 Server running (ULTRA STABLE V2)")
})
