// ===============================
// CONFIG
// ===============================
const LINE_TOKEN = "ใส่_LINE_CHANNEL_ACCESS_TOKEN";
const SHEET_NAME = "DATA";
const COINGECKO = "https://api.coingecko.com/api/v3/simple/price";

// ===============================
// WEBHOOK
// ===============================
function doPost(e) {
  if (!e || !e.postData) {
    return ContentService.createTextOutput("OK");
  }

  const data = JSON.parse(e.postData.contents);
  const event = data.events[0];
  if (!event.message || !event.message.text) return;

  const userId = event.source.userId;
  const text = event.message.text.trim().toLowerCase();

  if (text === "myalert") {
    showMyAssets(userId);
    return;
  }

  if (text === "ทอง" || text === "gold") {
    sendGoldPrice(userId);
    saveAsset(userId, "gold");
    return;
  }

  // crypto
  sendCryptoPrice(userId, text);
  saveAsset(userId, text);
}

// ===============================
// SAVE USER ASSET
// ===============================
function saveAsset(userId, asset) {
  const sheet = getSheet();
  sheet.appendRow([new Date(), userId, asset]);
}

// ===============================
// SHOW MY ASSET
// ===============================
function showMyAssets(userId) {
  const sheet = getSheet();
  const data = sheet.getDataRange().getValues();

  const myAssets = data
    .filter(r => r[1] === userId)
    .map(r => r[2]);

  const unique = [...new Set(myAssets)];

  if (unique.length === 0) {
    reply(userId, "ยังไม่มีรายการที่ติดตาม");
    return;
  }

  reply(userId, "คุณติดตาม:\n" + unique.join("\n"));
}

// ===============================
// SEND CRYPTO PRICE
// ===============================
function sendCryptoPrice(userId, coin) {
  try {
    const url = COINGECKO + "?ids=" + coin + "&vs_currencies=usd&include_24hr_change=true";
    const res = UrlFetchApp.fetch(url);
    const data = JSON.parse(res.getContentText());

    if (!data[coin]) {
      reply(userId, "ไม่พบเหรียญนี้");
      return;
    }

    const price = data[coin].usd;
    const change = data[coin].usd_24h_change.toFixed(2);

    const msg =
      coin.toUpperCase() +
      "\n$" + price +
      "\n24H: " + change + "%";

    reply(userId, msg);

  } catch (err) {
    reply(userId, "ระบบดึงราคาไม่ได้");
  }
}

// ===============================
// SEND GOLD PRICE
// ===============================
function sendGoldPrice(userId) {
  try {
    const url = COINGECKO + "?ids=tether-gold&vs_currencies=usd";
    const res = UrlFetchApp.fetch(url);
    const data = JSON.parse(res.getContentText());

    const price = data["tether-gold"].usd;

    reply(userId, "GOLD\n$" + price);

  } catch (err) {
    reply(userId, "ระบบดึงราคาทองไม่ได้");
  }
}

// ===============================
// HOURLY AUTO BROADCAST
// ===============================
function sendHourlyUpdate() {
  const sheet = getSheet();
  const data = sheet.getDataRange().getValues();

  const users = [...new Set(data.map(r => r[1]))];

  users.forEach(userId => {
    const userAssets = data
      .filter(r => r[1] === userId)
      .map(r => r[2]);

    const uniqueAssets = [...new Set(userAssets)];

    if (uniqueAssets.length === 0) return;

    let msg = "📊 รายงานราคาล่าสุด\n\n";

    uniqueAssets.forEach(asset => {
      if (asset === "gold") {
        try {
          const url = COINGECKO + "?ids=tether-gold&vs_currencies=usd";
          const res = UrlFetchApp.fetch(url);
          const data = JSON.parse(res.getContentText());
          msg += "GOLD $" + data["tether-gold"].usd + "\n\n";
        } catch {}
      } else {
        try {
          const url = COINGECKO + "?ids=" + asset + "&vs_currencies=usd&include_24hr_change=true";
          const res = UrlFetchApp.fetch(url);
          const data = JSON.parse(res.getContentText());

          if (data[asset]) {
            msg += asset.toUpperCase() +
              " $" + data[asset].usd +
              " (" + data[asset].usd_24h_change.toFixed(2) + "%)\n\n";
          }
        } catch {}
      }
    });

    push(userId, msg);
  });
}

// ===============================
// LINE REPLY
// ===============================
function reply(userId, text) {
  const url = "https://api.line.me/v2/bot/message/push";

  const payload = {
    to: userId,
    messages: [{ type: "text", text: text }]
  };

  UrlFetchApp.fetch(url, {
    method: "post",
    contentType: "application/json",
    headers: { Authorization: "Bearer " + LINE_TOKEN },
    payload: JSON.stringify(payload)
  });
}

function push(userId, text) {
  reply(userId, text);
}

// ===============================
// SHEET
// ===============================
function getSheet() {
  const ss = SpreadsheetApp.getActive();
  let sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME);
  }
  return sheet;
}
