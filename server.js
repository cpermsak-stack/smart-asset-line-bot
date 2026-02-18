const express = require("express")
const axios = require("axios")

const app = express()
app.use(express.json())

const PORT = process.env.PORT || 10000

// =========================
// GLOBAL CACHE
// =========================
const cache = {}
const pending = {}
const CACHE_TTL = 20000

// =========================
// SAFE REQUEST
// =========================
async function safeRequest(url, retries = 2) {
  try {
    const res = await axios.get(url, { timeout: 8000 })
    return res.data
  } catch (err) {
    if (err.response?.status === 429 && retries > 0) {
      await new Promise(r => setTimeout(r, 1500))
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
// GET 7 DAY CHANGE
// =========================
async function get7DayChange(id) {

  const data = await safeRequest(
    `https://api.coingecko.com/api/v3/coins/${id}/market_chart?vs_currency=usd&days=7`
  )

  const prices = data.prices
  const first = prices[0][1]
  const last = prices[prices.length - 1][1]

  return ((last - first) / first) * 100
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
      // GOLD (CoinGecko)
      // =====================
      if (symbol === "XAU") {

        const data = await safeRequest(
          "https://api.coingecko.com/api/v3/simple/price?ids=tether-gold&vs_currencies=usd&include_24hr_change=true"
        )

        const price = data["tether-gold"].usd
        const change24 = data["tether-gold"].usd_24h_change
        const change7 = await get7DayChange("tether-gold")

        return save(symbol, {
          price,
          change24,
          change7
        })
      }

      // =====================
      // CRYPTO
      // =====================
      let data

      try {
        data = await safeRequest(
          `https://fapi.binance.com/fapi/v1/ticker/24hr?symbol=${symbol}`
        )
      } catch {
        data = await safeRequest(
          `https://api.binance.com/api/v3/ticker/24hr?symbol=${symbol}`
        )
      }

      const price = parseFloat(data.lastPrice)
      const change24 = parseFloat(data.priceChangePercent)

      const cgId = symbol === "BTCUSDT" ? "bitcoin" : "ethereum"
      const change7 = await get7DayChange(cgId)

      return save(symbol, {
        price,
        change24,
        change7
      })

    } finally {
      delete pending[symbol]
    }

  })()

  return pending[symbol]
}

// =========================
// FLEX BUILDER
// =========================
function buildFlex(symbol, data) {

  const name = symbol === "XAU" ? "GOLD" : symbol.replace("USDT", "")

  const color24 = data.change24 >= 0 ? "#00C853" : "#D50000"
  const color7 = data.change7 >= 0 ? "#00C853" : "#D50000"

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
            text: `$${data.price.toFixed(2)} USD`,
            size: "lg",
            margin: "md"
          },
          {
            type: "text",
            text: `📊 24H: ${data.change24.toFixed(2)}%`,
            size: "md",
            color: color24,
            margin: "sm"
          },
          {
            type: "text",
            text: `📅 7D: ${data.change7.toFixed(2)}%`,
            size: "md",
            color: color7,
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

    const flex = buildFlex(symbol, data)

    await replyLine(event.replyToken, flex)

  } catch (err) {

    console.log("FINAL V2 ERROR:", err.message)

    await replyLine(event.replyToken, {
      type: "text",
      text: "⚠️ ระบบกำลังโหลดข้อมูล กรุณาลองใหม่อีกครั้ง"
    })
  }

  res.sendStatus(200)
})

app.get("/", (req, res) => {
  res.send("FINAL V2 ACTIVE 🚀")
})

app.listen(PORT, () => {
  console.log("🚀 FINAL V2 RUNNING")
})
