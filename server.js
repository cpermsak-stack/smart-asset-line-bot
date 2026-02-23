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
  type TEXT,
  target NUMERIC
)
`)

// ======================
// CACHE
// ======================
const cache = {}
const TTL = 20000

async function safe(url){
  const res = await axios.get(url,{timeout:8000})
  return res.data
}

// ======================
// PRICE FETCHERS
// ======================
async function getGoldYahoo(){
  const d = await safe("https://query1.finance.yahoo.com/v7/finance/quote?symbols=GC=F")
  const r = d.quoteResponse.result[0]
  return {price:r.regularMarketPrice,change24:r.regularMarketChangePercent}
}

async function getGoldCG(){
  const d = await safe("https://api.coingecko.com/api/v3/simple/price?ids=tether-gold&vs_currencies=usd&include_24hr_change=true")
  return {price:d["tether-gold"].usd,change24:d["tether-gold"].usd_24h_change}
}

async function getCrypto(symbol){
  try{
    const d = await safe(`https://api.binance.com/api/v3/ticker/24hr?symbol=${symbol}`)
    return {price:parseFloat(d.lastPrice),change24:parseFloat(d.priceChangePercent)}
  }catch{
    const id = symbol==="BTCUSDT"?"bitcoin":"ethereum"
    const d = await safe(`https://api.coingecko.com/api/v3/simple/price?ids=${id}&vs_currencies=usd&include_24hr_change=true`)
    return {price:d[id].usd,change24:d[id].usd_24h_change}
  }
}

// ======================
// MAIN PRICE
// ======================
async function getPrice(symbol){

  if(cache[symbol] && Date.now()-cache[symbol].time<TTL)
    return cache[symbol].data

  let result

  if(symbol==="GOLD"){
    try{ result=await getGoldYahoo() }
    catch{ result=await getGoldCG() }
  }

  if(symbol==="BTC") result=await getCrypto("BTCUSDT")
  if(symbol==="ETH") result=await getCrypto("ETHUSDT")

  cache[symbol]={data:result,time:Date.now()}
  return result
}

// ======================
// ALERT CHECKER
// ======================
async function checkAlerts(){

  const alerts = await db.query("SELECT * FROM alerts")

  for(const a of alerts.rows){

    const data = await getPrice(a.symbol)
    const price = data.price
    const change = data.change24

    let triggered=false

    if(a.type==="above" && price>=a.target) triggered=true
    if(a.type==="below" && price<=a.target) triggered=true
    if(a.type==="percent_up" && change>=a.target) triggered=true
    if(a.type==="percent_down" && change<=-Math.abs(a.target)) triggered=true

    if(triggered){
      await client.pushMessage(a.user_id,{
        type:"text",
        text:`🚨 ${a.symbol} Triggered!\nราคา: ${price} USD\n24H: ${change}%`
      })
      await db.query("DELETE FROM alerts WHERE id=$1",[a.id])
    }
  }
}
setInterval(checkAlerts,60000)

// ======================
// FLEX
// ======================
function buildFlex(name,data){
  const color=data.change24>=0?"#00C853":"#D50000"
  return{
    type:"flex",
    altText:`${name} Price`,
    contents:{
      type:"bubble",
      body:{
        type:"box",
        layout:"vertical",
        contents:[
          {type:"text",text:`💰 ${name}`,weight:"bold",size:"xl"},
          {type:"text",text:`$${data.price}`,size:"lg",margin:"md"},
          {type:"text",text:`24H: ${data.change24.toFixed(2)}%`,color}
        ]
      }
    }
  }
}

// ======================
// WEBHOOK
// ======================
app.post("/webhook",async(req,res)=>{

  const event=req.body.events?.[0]
  if(!event?.message?.text) return res.sendStatus(200)

  const text=event.message.text.toLowerCase()
  const userId=event.source.userId

  try{

    // ===== PRICE =====
    if(["btc","eth","gold","ทอง"].includes(text)){
      const symbol=text==="btc"?"BTC":text==="eth"?"ETH":"GOLD"
      const data=await getPrice(symbol)
      const flex=buildFlex(symbol,data)
      return client.replyMessage(event.replyToken,flex)
    }

    // ===== ALERT =====
    if(text.startsWith("alert")){
      const p=text.split(" ")
      const symbol=p[1].toUpperCase()
      const type=p[2]
      const value=parseFloat(p[3])

      await db.query(
        "INSERT INTO alerts (user_id,symbol,type,target) VALUES ($1,$2,$3,$4)",
        [userId,symbol,type,value]
      )

      return client.replyMessage(event.replyToken,{
        type:"text",
        text:`ตั้งเตือน ${symbol} ${type} ${value} แล้ว`
      })
    }

    // ===== MY ALERT =====
    if(text==="myalert"){
      const r=await db.query("SELECT symbol,type,target FROM alerts WHERE user_id=$1",[userId])
      if(r.rows.length===0)
        return client.replyMessage(event.replyToken,{type:"text",text:"ไม่มีรายการเตือน"})
      let msg="📌 รายการเตือน:\n\n"
      r.rows.forEach(a=>{
        msg+=`${a.symbol} | ${a.type} | ${a.target}\n`
      })
      return client.replyMessage(event.replyToken,{type:"text",text:msg})
    }

    // ===== CLEAR =====
    if(text==="clearalert"){
      await db.query("DELETE FROM alerts WHERE user_id=$1",[userId])
      return client.replyMessage(event.replyToken,{type:"text",text:"ลบทั้งหมดแล้ว"})
    }

  }catch(err){
    console.log(err.message)
  }

  res.sendStatus(200)
})

app.get("/",(req,res)=>res.send("SMART ASSET PRO MODE ACTIVE 🚀"))
app.listen(PORT,()=>console.log("🚀 PRO MODE RUNNING"))
