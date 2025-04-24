require('dotenv').config();
const express = require('express');
const line = require('@line/bot-sdk');
const OpenAI = require('openai');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const csv = require('csv-parser'); // 新增CSV解析套件

// 初始化Firebase
const admin = require('firebase-admin');

// 嘗試從環境變量初始化Firebase，如果失敗則從文件讀取
let firebaseInitialized = false;
try {
  // 首先嘗試從環境變量讀取Firebase憑證
  if (process.env.FIREBASE_CREDENTIALS) {
    console.log('從環境變量初始化Firebase');
    try {
      const serviceAccount = JSON.parse(process.env.FIREBASE_CREDENTIALS);
      admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
      });
      console.log('從環境變量成功初始化Firebase');
      firebaseInitialized = true;
    } catch (envError) {
      console.error('環境變量解析失敗:', envError.message);
      console.log('環境變量內容長度:', process.env.FIREBASE_CREDENTIALS ? process.env.FIREBASE_CREDENTIALS.length : 'undefined');
      // 嘗試從文件讀取
      const serviceAccount = require('./firebase-credentials.json');
      admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
      });
      console.log('從文件成功初始化Firebase');
      firebaseInitialized = true;
    }
  } else {
    // 嘗試從文件讀取憑證
    console.log('嘗試從文件初始化Firebase');
    const serviceAccount = require('./firebase-credentials.json');
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount)
    });
    console.log('從文件成功初始化Firebase');
    firebaseInitialized = true;
  }
  console.log('Firebase初始化成功');
  } catch (error) {
  console.error('Firebase初始化失敗:', error.message);
  console.log('將使用内存存儲會話數據');
}

// 如果Firebase初始化成功，使用Firestore；否則使用内存存儲
const db = firebaseInitialized ? admin.firestore() : null;
console.log('使用存儲類型:', firebaseInitialized ? 'Firestore' : '內存存儲');

// 定義常量
const GPT_MODEL = "gpt-4o-mini";
// 中央氣象署開放資料平台API授權碼，請到 https://opendata.cwa.gov.tw/ 申請
// 此金鑰格式為 CWA-XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX
const CWA_API_KEY = "CWA-E3034BF2-AE4B-4D55-B6AA-1BDC01372CF7";  // 使用原來的API金鑰

// 讀取產品數據
let productData = [];
try {
  const productFilePath = path.join(__dirname, 'jh_health_products.json');
  console.log(`嘗試讀取產品數據文件: ${productFilePath}`);
  if (fs.existsSync(productFilePath)) {
    const rawData = fs.readFileSync(productFilePath, 'utf8');
    productData = JSON.parse(rawData);
    console.log(`成功載入 ${productData.length} 個產品數據`);
  } else {
    console.log('產品數據文件不存在，將使用默認空數據');
    // 創建一個基本的產品數據默認值
    productData = [
      {
        name: "醣可淨 BMEP",
        categories: ["三高調節", "健康管理"],
        features: ["專利山苦瓜萃取", "低溫水萃技術", "經醫師與營養師推薦"],
        tags: ["三高", "血糖", "代謝"]
      },
      {
        name: "藻股康 S.B.S",
        categories: ["關節保健", "行動力提升"],
        features: ["褐藻萃取", "小分子SBS", "獨家配方"],
        tags: ["關節", "骨骼", "行動力"]
      },
      {
        name: "衛的勝",
        categories: ["腸胃保健", "免疫調節"],
        features: ["AB克菲爾菌", "5大菌種", "共生發酵技術"],
        tags: ["腸胃", "消化", "益生菌"]
      },
      {
        name: "御薑君",
        categories: ["機能強化", "體力提升"],
        features: ["四合一複方薑黃", "日本沖繩原裝", "高吸收率"],
        tags: ["疲勞", "體力", "活力"]
      },
      {
        name: "靚舒暢 SIRT",
        categories: ["體態管理", "代謝調節"],
        features: ["專業營養師推薦", "獨家專利配方", "促進新陳代謝"],
        tags: ["體重", "代謝", "體態"]
      }
    ];
    console.log(`已創建 ${productData.length} 個默認產品數據`);
  }
} catch (error) {
  console.error('讀取產品數據失敗:', error);
  console.log('將使用基本默認產品數據集');
  // 使用基本默認值
  productData = [
    {
      name: "醣可淨 BMEP",
      categories: ["三高調節"],
      features: ["專利山苦瓜萃取", "調節血糖"],
      tags: ["三高"]
    },
    {
      name: "藻股康 S.B.S",
      categories: ["關節保健"],
      features: ["褐藻萃取", "關節保養"],
      tags: ["關節"]
    },
    {
      name: "衛的勝",
      categories: ["腸胃保健"],
      features: ["益生菌複合配方", "腸道健康"],
      tags: ["腸胃"]
    },
    {
      name: "御薑君",
      categories: ["機能強化"],
      features: ["薑黃萃取", "提升活力"],
      tags: ["疲勞"]
    },
    {
      name: "靚舒暢 SIRT",
      categories: ["體態管理"],
      features: ["促進代謝", "體重管理"],
      tags: ["體重"]
    }
  ];
}

// LINE配置
const lineConfig = {
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
  channelSecret: process.env.LINE_CHANNEL_SECRET
};

// 初始化LINE客戶端
const lineClient = new line.Client(lineConfig);

// 初始化 OpenAI
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const app = express();

// 健康檢查路由
app.get('/', (req, res) => {
  res.status(200).json({ status: 'ok' });
});

app.get('/linebot/webhook', (req, res) => {
  res.status(200).json({ status: 'webhook endpoint ok' });
});

// Webhook路由
app.post('/linebot/webhook', line.middleware(lineConfig), async (req, res) => {
  try {
    const events = req.body.events;
    // 先回應 LINE Platform
    res.status(200).end();
    
    // 非同步處理事件
    for (const event of events) {
      try {
        await handleEvent(event);
      } catch (err) {
        console.error('事件處理錯誤:', err);
      }
    }
  } catch (err) {
    console.error('Webhook處理錯誤:', err);
    // 即使發生錯誤，也要回應 200
    if (!res.headersSent) {
      res.status(200).end();
    }
  }
});

// 確保 Express 可以解析 JSON
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// 錯誤處理中間件
app.use((err, req, res, next) => {
  console.error('Express 錯誤:', err);
  if (!res.headersSent) {
    res.status(200).json({ status: 'error handled' });
  }
});

// 保健品關鍵詞列表
const HEALTH_KEYWORDS = [
  // 產品名稱
  '藻股康', '衛的勝', '御薑君', '醣可淨', '靚舒暢', 
  // 功能需求
  '保健', '健康', '補充營養', '腸胃', '消化', '順暢', 
  '代謝', '體質', '血糖', '三高', '骨關節', '行動力',
  '養生', '薑黃', '益生菌', '腸道健康', '免疫力',
  // 症狀詞
  '腰痠', '關節痛', '便秘', '排便', '疲勞', '沒精神',
  '血糖高', '體重', '減肥', '塑身', '調整', '睡眠',
  // 人群詞
  '銀髮族', '老人家', '年長者', '上班族', '孕婦', '小孩',
  '青少年', '女性', '男性'
];

// 產品圖像陣列
const productImages = {
  '三高': [
    'https://raw.githubusercontent.com/Fangwentsai/linebot/main/product_images/bmep.jpg', 
    'https://raw.githubusercontent.com/Fangwentsai/linebot/main/product_images/bmep-plus.jpg',
    'https://raw.githubusercontent.com/Fangwentsai/linebot/main/product_images/sbh.jpg'  // 妥定 SBH 植萃複方圖像
  ],
  '疲勞': [
    'https://raw.githubusercontent.com/Fangwentsai/linebot/main/product_images/turmeric-king.jpg'
  ],
  '腸胃': [
    'https://raw.githubusercontent.com/Fangwentsai/linebot/main/product_images/probiotic-warlords.jpg'
  ],
  '關節': [
    'https://raw.githubusercontent.com/Fangwentsai/linebot/main/product_images/aos.jpg'
  ],
  '體重': [
    'https://raw.githubusercontent.com/Fangwentsai/linebot/main/product_images/sirt.jpg'
  ]
};

// 產品網址對應表
const productUrls = {
  '三高': 'https://jhhealth.com.tw/product-tag/%e4%b8%89%e9%ab%98%e6%97%8f%e7%be%a4/',
  '疲勞': 'https://jhhealth.com.tw/product/turmeric-king/',
  '腸胃': 'https://jhhealth.com.tw/product/probiotic-warlords/',
  '關節': 'https://jhhealth.com.tw/product/aos/',
  '體重': 'https://jhhealth.com.tw/product/sirt/',
  // 添加通用商城入口
  '賣場': 'https://jhhealth.com.tw/product-category/health-biotech/',
  '官網': 'https://jhhealth.com.tw/'
};

// 詐騙關鍵詞
const FRAUD_KEYWORDS = [
  // 投資詐騙關鍵詞
  '投資', '穩賺', '高報酬', '保證獲利', '配息', '股票', '基金', '虛擬貨幣', '比特幣', '挖礦', '秘方',
  // 求職詐騙關鍵詞
  '求職', '工作', '打工', '兼職', '在家工作', '遠端工作', '賺錢容易', '賺錢快速', '代工', '工讀',
  // 交友詐騙關鍵詞
  '交友', '網戀', '男友', '女友', '約會', '緣分', '手握緣分', '莫逆', '有緣千里來相會',
  // 網購詐騙關鍵詞
  '網購', '團購', '便宜', '限時', '搶購', '特價', '免運費', '賠售', '下單', '匯款',
  // 個資詐騙關鍵詞
  '個資', '資料外洩', '中獎', '領獎', '發票', '對獎', '核對', '中樂透',
  // 一般詐騙指示關鍵詞
  '匯款', '儲值', '轉帳', '代付', '墊付', '提款', '現金', '匯入', '解除分期',
  // 防詐關鍵詞
  '詐騙', '被騙', '165', '反詐', '防詐', '報案', '165專線'
];

// 詐騙類型分類
const FRAUD_TYPES = {
  '假投資詐騙': ['投資', '股票', '基金', '虛擬貨幣', '比特幣', '保證獲利', '穩賺', '高報酬', '挖礦', '配息'],
  '假求職': ['求職', '工作', '打工', '兼職', '在家工作', '遠端工作', '賺錢容易', '賺錢快速', '代工', '工讀'],
  '假交友': ['交友', '網戀', '男友', '女友', '約會', '緣分', '莫逆', '交往', '戀愛'],
  '網路購物詐騙': ['網購', '團購', '便宜', '限時', '搶購', '特價', '免運費', '賠售', '下單', '匯款']
};

// 讀取詐騙案例
let fraudCases = [];
const csvFilePath = path.join(__dirname, '165dashboard_yesterday_data.csv');

// 加載詐騙案例函數
function loadFraudCases() {
  if (!fs.existsSync(csvFilePath)) {
    console.log('詐騙案例檔案不存在：', csvFilePath);
    createDummyFraudCases();
    return;
  }
  
  try {
    // 嘗試直接讀取並解析CSV文件
    const fileContent = fs.readFileSync(csvFilePath, 'utf8');
    const lines = fileContent.split('\n');
    // 忽略標題行
    for (let i = 1; i < lines.length; i++) {
      if (lines[i].trim() === '') continue;
      
      const match = lines[i].match(/([\d-]+),(.*?),(.+)/);
      if (match && match.length >= 4) {
        const date = match[1];
        const title = match[2];
        const content = match[3];
        
        if (title !== '無標題' && content !== '無內容') {
          fraudCases.push({
            '日期': date,
            '標題': title,
            '內容': content
          });
        }
      }
    }
    console.log(`成功載入 ${fraudCases.length} 個詐騙案例`);
    
    // 如果讀取到的案例太少，使用備用方案
    if (fraudCases.length < 5) {
      console.log('有效案例數量太少，使用備用案例');
      createDummyFraudCases();
    }
  } catch (error) {
    console.error('讀取詐騙案例檔案失敗:', error);
    // 創建備用案例
    createDummyFraudCases();
  }
}

// 創建備用詐騙案例
function createDummyFraudCases() {
  // 投資詐騙案例
  fraudCases.push({
    '日期': '114-04-23',
    '標題': '假投資詐騙',
    '內容': '我在【抖音】得知投資廣告訊息並點入廣告內連結，後續加入對方LINE好友【暱稱：幣商科技、D2X、Mr.Liu、Vincent】，對方慫恿我到【D2X網站】平台申請帳號，我後來並依照對方指示至【超商代碼繳費、購買虛擬貨幣並當面交付現金】，後來發現平台虛擬貨幣金額被提領清空，我才驚覺受騙報案。'
  });
  
  fraudCases.push({
    '日期': '114-04-23',
    '標題': '假投資詐騙',
    '內容': '我因為【聽我朋友的介紹】得知投資訊息，在【LINE】以「投資賺錢為前提」認識歹徒，對方慫恿至【假投資網站投資（網站名稱:Phemex）】，誆稱保證獲利、穩賺不賠，我依指示至該網站申請帳號並面交，期間於該平台可見有獲利入金，惟因後來我要提領獲利出金時卻遲遲無法出金，對方還一職要求我匯款保證金才能出金，我才驚覺受騙，期間我還抵押2筆不動產借款，損失慘重。'
  });
  
  // 假求職詐騙案例
  fraudCases.push({
    '日期': '114-04-23',
    '標題': '假求職',
    '內容': '我於網路上看見家庭代工廣告，廣告連結到客服人員【劉馨馨】，後經由對方介紹後加入一個投資群組【Jreeport McMoRan】，該投資群組管理員【kelly】知道我急需金錢借貸，又介紹【林亞妃】貸款人員與其接洽，如要借貸就需要我金融卡寄放在她那邊，我誤信其話術便以【空軍一號客運貨運寄送提款卡並提供密碼，後因金融機構通知我帳戶遭凍結，我才驚覺受騙。'
  });
  
  // 假交友詐騙案例
  fraudCases.push({
    '日期': '114-04-23',
    '標題': '假交友',
    '內容': '我在臉書認識網友【暱稱:姜振威】，聊天後加入【LINE】以「單純交友為前提」認識對方，對方慫恿我至【假投資網站投資（網站名稱LSEG及網址:https://lseg.dfsoppppa.top）】，且誆稱保證獲利、穩賺不賠，我遂依指示至該網站申請帳號，並依照對方指示匯款15次，期間看見有穩定獲利入金，一直到後來要提領獲利出金時，對方卻一直推延遲不出金、一直到該投資網站關閉，我才驚覺受騙。'
  });
  
  // 網購詐騙案例
  fraudCases.push({
    '日期': '114-04-23',
    '標題': '網路購物詐騙',
    '內容': '本來只是個再普通不過的日子。我跟朋友在臉書社團「Jets/Jetsr/Jetsl 各系精品買賣交流版」上發了個貼文，想找一顆機車電腦。我們也不是第一次上這種社團交易，照理說，流程都很熟悉、也沒出什麼事過。凌晨2點左右，有個叫「Xiang Liu」的帳號私訊我們，說他有貨可以出。我們簡單聊了幾句，他看起來態度也算正常，我的朋友就提供了自己的LINE ID給他。很快，一個LINE上名叫「F」的人加了我們，談細節。看起來很順，他講話也還算誠懇，說什麼早上可以寄出。我們當時真的沒想太多，畢竟只是個小小的零件，誰會想到竟然會在這種地方出事。我用自己的國泰世華帳戶轉了6000塊給他。我傳完匯款畫面，他也回了OK，說下午2點前會去寄。當下我心裡其實還是有點忐忑的，畢竟網路交易本來就帶點風險，但我選擇相信人性、相信誠信。結果到了2點，他說要晚一點，大概5點才能寄。好，我等。然後到了6點，他說已經寄出。我朋友問他：「那你拍個寄件單據給我，我好追蹤。」結果人就不見了。'
  });
  
  console.log(`已創建 ${fraudCases.length} 個備用詐騙案例`);
}

// 嘗試載入詐騙案例
loadFraudCases();

// 已發送商品推薦的用戶記錄
const userProductRecommendations = {};

// 用于存储用户会话的内存对象(临时替代Firebase)
const userSessions = {};

// 用戶輪廓資訊
const userProfiles = {};

// 事件處理函數
async function handleEvent(event) {
  // 處理用戶加入好友事件
  if (event.type === 'follow') {
    // 發送歡迎詞
    return lineClient.replyMessage(event.replyToken, {
      type: 'text',
      text: `嗨～👋 感謝您加入小晶為好友！

我是晶璽健康的專業AI保健顧問「小晶」✨，很高興認識您！

【我能為您做什麼】
✅ 提供專業保健知識
✅ 針對您的健康需求給予建議
✅ 推薦適合您的晶璽健康產品
✅ 回答產品相關問題

您可以直接問我關於：
💡 三高問題的調理方式
💡 腸胃保健的方法
💡 關節保養的建議
💡 提升精力的秘訣
💡 體重管理的方案

只要告訴我您的健康需求，我就能提供最適合的建議喔！😊

方便請問您怎麼稱呼呢？這樣我能更親切地稱呼您～`
    });
  }
  
  if (event.type !== 'message' || event.message.type !== 'text') {
    return Promise.resolve(null);
  }

  const userInput = event.message.text;
  const userId = event.source.userId;
  console.log(`收到用戶輸入: ${userInput}`);
  
  try {
    // 获取用户会话
    const userSession = await getUserSession(userId);
    
    // 獲取用戶輪廓 (如果存在)
    const userProfile = await getUserProfile(userId);
    
    // 檢查是否需要收集用戶資訊
    const profileCollection = await handleProfileCollection(userId, userInput, event.replyToken);
    if (profileCollection) {
      return profileCollection; // 若已由資料收集處理，直接返回
    }
    
    // 添加用户消息
    userSession.messages.push({
      role: "user",
      content: userInput
    });
    
    // 處理用戶對產品鏈接的請求
    if ((userInput.match(/^(好|可以|好的|請給我|是的|鏈接|連結|網址|官網|網站|購買|買|了解更多|賣場|想看|提供|網頁)/i) && 
        (userInput.includes('連結') || userInput.includes('鏈接') || userInput.includes('網址') || 
         userInput.includes('官網') || userInput.includes('網站') || userInput.includes('購買') || 
         userInput.includes('賣場') || userInput.includes('商城'))) || 
        userInput === '好的' || userInput === '網頁' || userInput === '好' || 
        userInput === '連結' || userInput === '網址') {
      
      // 檢查是否有推薦過產品，如果有則提供該產品的連結
      if (userProductRecommendations[userId]) {
        const productType = userProductRecommendations[userId];
        const productUrl = productUrls[productType] || 'https://jhhealth.com.tw/';
        
        // 根據用戶資料客製化稱呼
        const greeting = getPersonalizedGreeting(userProfile);
        
        // 更新对话历史
        userSession.messages.push({
          role: "assistant",
          content: `這是我們的${productType}產品連結，${greeting}可以點擊查看更多詳情和購買方式：\n\n${productUrl}\n\n🚚 全館滿2,000即享免運服務，東西直接送到家！😊\n\n如果有其他問題，隨時都可以問我喔！😊`
        });
        
        // 保存对话历史
        await updateUserSession(userId, userSession.messages);
        
        return lineClient.replyMessage(event.replyToken, {
          type: 'text',
          text: `這是我們的${productType}產品連結，${greeting}可以點擊查看更多詳情和購買方式：\n\n${productUrl}\n\n🚚 全館滿2,000即享免運服務，東西直接送到家！😊\n\n如果有其他問題，隨時都可以問我喔！😊`
        });
      } 
      // 沒有推薦過產品，提供通用賣場連結
      else {
        // 根據用戶資料客製化稱呼
        const greeting = getPersonalizedGreeting(userProfile);
        
        // 更新对话历史
        userSession.messages.push({
          role: "assistant",
          content: `這是晶璽健康的官方商城，${greeting}可以瀏覽所有產品：\n\n${productUrls['賣場']}\n\n🚚 全館滿2,000即享免運服務，東西直接送到家！😊\n\n${greeting}有特定想了解的健康需求嗎？我可以為您推薦最適合的產品！😊`
        });
        
        // 保存对话历史
        await updateUserSession(userId, userSession.messages);
        
      return lineClient.replyMessage(event.replyToken, {
        type: 'text',
          text: `這是晶璽健康的官方商城，${greeting}可以瀏覽所有產品：\n\n${productUrls['賣場']}\n\n🚚 全館滿2,000即享免運服務，東西直接送到家！😊\n\n${greeting}有特定想了解的健康需求嗎？我可以為您推薦最適合的產品！😊`
        });
      }
    }
    
    // 處理簡單問候
    if (userInput.match(/^(你好|哈囉|嗨|hi|hello)/i)) {
      try {
        // 獲取天氣數據
        const weatherInfo = await getWeatherInfo();
        
        // 根據用戶資料客製化稱呼
        const greeting = getPersonalizedGreeting(userProfile);
        
        const replyText = `你好！👋 ${greeting}，我是「小晶」，晶璽健康的專業AI諮詢員 ✨\n\n${weatherInfo}\n\n很高興為您服務！我可以為您介紹各種保健品知識，並根據您的需求推薦最適合的產品。\n\n有什麼保健需求想了解的嗎？😊`;
        
        // 更新对话历史
        userSession.messages.push({
          role: "assistant",
          content: replyText
        });
        
        // 保存对话历史
        await updateUserSession(userId, userSession.messages);
        
        return lineClient.replyMessage(event.replyToken, {
          type: 'text',
          text: replyText
        });
      } catch (error) {
        console.error('獲取天氣信息失敗:', error);
        // 如果無法獲取天氣，仍然返回問候
        
        // 根據用戶資料客製化稱呼
        const greeting = getPersonalizedGreeting(userProfile);
        
        const replyText = `你好！👋 ${greeting}，我是「小晶」，晶璽健康的專業AI諮詢員 ✨\n\n很高興為您服務！我可以為您介紹各種保健品知識，並根據您的需求推薦最適合的產品。\n\n有什麼保健需求想了解的嗎？😊`;
        
        // 更新对话历史
        userSession.messages.push({
          role: "assistant",
          content: replyText
        });
        
        // 保存对话历史
        await updateUserSession(userId, userSession.messages);
        
        return lineClient.replyMessage(event.replyToken, {
          type: 'text',
          text: replyText
        });
      }
    }
    
    // 檢查是否是詐騙相關查詢
    if (isFraudQuery(userInput)) {
      console.log(`詐騙相關查詢: ${userInput}`);
      
      // 使用OpenAI解析用戶詐騙問題的具體類型
      const fraudTypeResponse = await openai.chat.completions.create({
        model: GPT_MODEL,
        messages: [
          {
            role: "system",
            content: `你是一位專業的防詐騙顧問。請仔細分析用戶的問題，並判斷他們可能面臨的詐騙類型。
僅從以下選項中選擇一個最相關的類型：
1. 假投資詐騙
2. 假求職
3. 假交友
4. 網路購物詐騙
5. 其他詐騙類型

只回覆類型名稱，不要添加任何其他文字。`
          },
          {
            role: "user",
            content: userInput
          }
        ],
        temperature: 0.3,
        max_tokens: 10
      });
      
      const fraudType = fraudTypeResponse.choices[0].message.content.trim();
      console.log(`判斷詐騙類型: ${fraudType}`);
      
      // 根據詐騙類型獲取相關案例
      const relatedCases = getRelatedFraudCases(fraudType, 2);
      
      // 生成防詐騙建議
      const antifraudResponse = await openai.chat.completions.create({
        model: GPT_MODEL,
        messages: [
          {
            role: "system",
            content: `你是「小晶」，一位專業的防詐騙顧問。用戶正在詢問關於${fraudType}的問題。
請提供一段專業、有溫度的回應，內容包含：
1. 對用戶情況的關心與理解(約50字)
2. 針對${fraudType}的辨識方法(約100字)
3. 如何預防此類詐騙的具體建議(約100字)

語氣要溫暖專業，表現出對用戶的關心，使用適度的emoji表情符號增加親和力。
請確保建議是具體可行的，並提醒用戶可以撥打165反詐騙專線尋求協助。`
          },
          {
            role: "user",
            content: userInput
          }
        ],
        temperature: 0.7,
        max_tokens: 500
      });
      
      const antifraudAdvice = antifraudResponse.choices[0].message.content;
      
      // 構建案例分享文本
      let caseSharingText = "";
      if (relatedCases.length > 0) {
        caseSharingText = `\n\n【近期相關詐騙案例分享】\n`;
        relatedCases.forEach((c, index) => {
          caseSharingText += `\n案例${index+1}：\n${c.內容.substring(0, 300)}${c.內容.length > 300 ? '...' : ''}\n`;
        });
        caseSharingText += `\n以上案例是否跟您遇到的情況類似？如果有類似情形請提高警覺，有任何疑問都可以隨時向我詢問。`;
      }
      
      // 構建完整回覆
      const fullResponse = antifraudAdvice + caseSharingText;
      
      // 更新对话历史
      userSession.messages.push({
        role: "assistant",
        content: fullResponse
      });
      
      // 保存对话历史
      await updateUserSession(userId, userSession.messages);
      
      return lineClient.replyMessage(event.replyToken, {
        type: 'text',
        text: fullResponse
      });
    }
    
    // 檢查是否是產品查詢
    if (isProductQuery(userInput)) {
      console.log(`產品查詢: ${userInput}`);
      
      // 第一步：使用OpenAI生成關懷回應
      const careResponse = await openai.chat.completions.create({
      model: GPT_MODEL,
      messages: [
        {
          role: "system",
            content: `你是「小晶」，晶璽健康的專業AI保健顧問。用戶即將詢問健康問題。
請提供大約50-70字左右的溫暖關懷回應，內容應包含：
1. 簡短的健康建議
2. 日常照顧提醒
3. 鼓勵性的話語

語氣要親切活潑，多使用emoji表情符號增加親和力，如：😊 💪 ✨ 🌿 💡。
自稱「小晶」，像位親切的朋友給予建議。
不要推薦任何產品，只關注健康建議和關懷。保持簡潔。`
        },
        {
          role: "user",
          content: userInput
        }
      ],
        temperature: 0.7,
        max_tokens: 200
      });
      
      // 第二步：附加產品推薦
      const careText = careResponse.choices[0].message.content;
      const productText = getDirectRecommendation(userInput);
      
      // 更新对话历史
      userSession.messages.push({
        role: "assistant",
        content: careText + "\n\n" + productText
      });
      
      // 保存对话历史
      await updateUserSession(userId, userSession.messages);
      
      // 先發送關懷回應
      await lineClient.replyMessage(event.replyToken, {
        type: 'text',
        text: careText
      });
      
      // 找出推薦的產品名稱
      let recommendedProduct = '';
      
      if (userInput.includes('三高')) {
        recommendedProduct = '三高';
      }
      else if (userInput.includes('疲勞') || userInput.includes('機能強化')) {
        recommendedProduct = '疲勞';
      }
      else if (userInput.includes('腸胃')) {
        recommendedProduct = '腸胃';
      }
      else if (userInput.includes('關節')) {
        recommendedProduct = '關節';
      }
      else if (userInput.includes('體重')) {
        recommendedProduct = '體重';
      }
      
      // 記錄已向該用戶推薦的產品類型，用於後續處理鏈接請求
      if (recommendedProduct) {
        userProductRecommendations[userId] = recommendedProduct;
      }
      
      // 客製化稱呼
      const greeting = getPersonalizedGreeting(userProfile);
      const greetingSuffix = greeting ? `${greeting}參考` : '參考';
      
      // 延遲一秒後再發送產品推薦
      setTimeout(async () => {
        try {
          await lineClient.pushMessage(event.source.userId, {
            type: 'text',
            text: productText + `\n\n請${greetingSuffix}一下，如果有需要我再提供網頁連結讓您參考😊`
          });
        } catch (err) {
          console.error('發送產品推薦失敗:', err);
        }
      }, 1000);
      
      return;
    }
    
    // 一般對話處理
    // 添加用戶輪廓信息到系統提示中
    if (userProfile && (userProfile.nickname || userProfile.age || userProfile.gender)) {
      // 找到當前系統提示
      const systemPromptIndex = userSession.messages.findIndex(msg => msg.role === 'system');
      if (systemPromptIndex !== -1) {
        // 確保用戶輪廓信息被加入系統提示
        const currentSystemPrompt = userSession.messages[systemPromptIndex].content;
        if (!currentSystemPrompt.includes('用戶輪廓信息')) {
          const profileInfo = `
用戶輪廓信息：
${userProfile.nickname ? `暱稱: ${userProfile.nickname}` : ''}
${userProfile.gender ? `性別: ${userProfile.gender}` : ''}
${userProfile.age ? `年齡: ${userProfile.age}` : ''}
${userProfile.location ? `地區: ${userProfile.location}` : ''}

根據上述用戶信息，使用適當的稱呼和語氣與用戶交流。`;
          
          userSession.messages[systemPromptIndex].content = currentSystemPrompt + profileInfo;
        }
      }
    }
    
    const response = await openai.chat.completions.create({
      model: GPT_MODEL,
      messages: userSession.messages,
      temperature: 0.7
    });
    
    // 将AI回复添加到会话历史
    userSession.messages.push({
      role: "assistant",
      content: response.choices[0].message.content
    });
    
    // 如果消息太多，裁剪会话
    if (userSession.messages.length > 20) {
      userSession.messages = [
        userSession.messages[0], // 保留系统提示
        ...userSession.messages.slice(-19) // 保留最近19条消息
      ];
    }
    
    // 更新Firestore中的会话
    await updateUserSession(userId, userSession.messages);

    return lineClient.replyMessage(event.replyToken, {
      type: 'text',
      text: response.choices[0].message.content
    });
  } catch (error) {
    console.error('處理事件時發生錯誤:', error);
    // 如果錯誤是產品查詢，嘗試直接推薦
    if (isProductQuery(userInput)) {
      return lineClient.replyMessage(event.replyToken, {
        type: 'text',
        text: "抱歉，我現在遇到了一些技術問題。" + getDirectRecommendation(userInput)
      });
    }
    return lineClient.replyMessage(event.replyToken, {
      type: 'text',
      text: '抱歉，系統發生錯誤。請稍後再試。'
    });
  }
}

// 處理用戶輪廓收集
async function handleProfileCollection(userId, userInput, replyToken) {
  if (!userProfiles[userId]) {
    userProfiles[userId] = { 
      state: 'askingName',
      // 初始化其他屬性
      nickname: null,
      gender: null,
      age: null,
      location: null,
      ageGroup: null
    };
  }
  
  const profile = userProfiles[userId];
  
  // 根據當前狀態處理用戶輸入
  switch (profile.state) {
    case 'askingName':
      // 解析用戶名字
      profile.nickname = userInput.replace(/我是|我叫|叫我|稱呼我|我的名字是|名字|you can call me/gi, '').trim();
      
      // 嘗試根據名字猜測性別（僅為初步判斷，後續會確認）
      const maleNameIndicators = ['先生', '男', '哥', '弟', '爸', 'boy', 'man', 'male', 'Mr'];
      const femaleNameIndicators = ['女士', '小姐', '媽', '姐', '妹', 'girl', 'woman', 'female', 'Miss', 'Mrs', 'Ms'];
      
      let probableGender = null;
      for (const indicator of maleNameIndicators) {
        if (userInput.includes(indicator)) {
          probableGender = '男性';
          break;
        }
      }
      
      if (!probableGender) {
        for (const indicator of femaleNameIndicators) {
          if (userInput.includes(indicator)) {
            probableGender = '女性';
            break;
          }
        }
      }
      
      profile.gender = probableGender; // 可能是null
      profile.state = 'askingGender';
      
      // 根據是否已猜測性別返回不同的回應
      if (probableGender) {
        // 確認猜測的性別
        await lineClient.replyMessage(replyToken, {
          type: 'text',
          text: `謝謝您，${profile.nickname}！我猜您是${probableGender}，對嗎？（請回答是/否）`
        });
      } else {
        // 直接詢問性別
        await lineClient.replyMessage(replyToken, {
          type: 'text',
          text: `謝謝您，${profile.nickname}！方便告訴我您的性別嗎？`
        });
      }
      return true;
      
    case 'askingGender':
      // 確認或取得性別
      const maleKeywords = ['男', '先生', '男性', '爸爸', '哥哥', '弟弟', 'male', 'man', 'boy', 'yes', '是', '對', '沒錯'];
      const femaleKeywords = ['女', '小姐', '女士', '女性', '媽媽', '姐姐', '妹妹', 'female', 'woman', 'girl'];
      const otherKeywords = ['其他', '不方便', '不想', '不願', 'other', 'no', '否', '不是'];
      
      // 如果已有可能的性別，用戶可能是在確認
      if (profile.gender) {
        if (maleKeywords.some(k => userInput.toLowerCase().includes(k))) {
          profile.gender = '男性';
        } else if (femaleKeywords.some(k => userInput.toLowerCase().includes(k))) {
          profile.gender = '女性';
        } else if (otherKeywords.some(k => userInput.toLowerCase().includes(k))) {
          // 如果否定了我們的猜測，詢問正確的性別
          profile.gender = null;
          await lineClient.replyMessage(replyToken, {
            type: 'text',
            text: `抱歉弄錯了！請問您的性別是？`
          });
          return true;
        }
      } else {
        // 直接從回答中判斷性別
        if (maleKeywords.some(k => userInput.toLowerCase().includes(k))) {
          profile.gender = '男性';
        } else if (femaleKeywords.some(k => userInput.toLowerCase().includes(k))) {
          profile.gender = '女性';
        } else if (otherKeywords.some(k => userInput.toLowerCase().includes(k))) {
          profile.gender = '其他';
        } else {
          // 無法判斷，假設為"其他"
          profile.gender = '其他';
        }
      }
      
      // 性別處理完畢，進入下一步
      profile.state = 'askingAge';
      await lineClient.replyMessage(replyToken, {
        type: 'text',
        text: `感謝您的回答！請問您的年齡大約是幾歲呢？（可以回答範圍，如20多歲、30-40歲）`
      });
      return true;
      
    case 'askingAge':
      // 解析年齡
      const ageMatches = userInput.match(/\d+/g);
      if (ageMatches) {
        // 如果用戶輸入包含數字，取第一個數字作為年齡
        profile.age = parseInt(ageMatches[0]);
      } else {
        // 嘗試從文字描述中提取年齡範圍
        if (userInput.includes('20多') || userInput.includes('二十多')) {
          profile.age = 25;
        } else if (userInput.includes('30多') || userInput.includes('三十多')) {
          profile.age = 35;
        } else if (userInput.includes('40多') || userInput.includes('四十多')) {
          profile.age = 45;
        } else if (userInput.includes('50多') || userInput.includes('五十多')) {
          profile.age = 55;
        } else if (userInput.includes('60多') || userInput.includes('六十多')) {
          profile.age = 65;
        } else if (userInput.includes('70') || userInput.includes('七十')) {
          profile.age = 75;
        } else if (userInput.includes('青少年') || userInput.includes('teen')) {
          profile.age = 18;
        } else {
          // 無法判斷，設置為null
          profile.age = null;
        }
      }
      
      // 設置年齡組別
      if (profile.age) {
        if (profile.age < 25) {
          profile.ageGroup = 'young';
        } else if (profile.age < 60) {
          profile.ageGroup = 'adult';
        } else {
          profile.ageGroup = 'senior';
        }
      }
      
      // 完成資料收集
      profile.state = 'complete';
      
      // 更新Firebase中的用戶資料
      if (firebaseInitialized && db) {
        try {
          await db.collection('userProfiles').doc(userId).set({
            nickname: profile.nickname,
            gender: profile.gender,
            age: profile.age,
            ageGroup: profile.ageGroup,
            lastUpdated: admin.firestore.FieldValue.serverTimestamp()
          }, { merge: true });
          console.log(`成功儲存用戶 ${userId} 的輪廓資訊`);
        } catch (error) {
          console.error(`儲存用戶輪廓資訊失敗:`, error);
        }
      }
      
      // 使用客製化稱呼
      const greeting = getPersonalizedGreeting(profile);
      
      // 完成收集後的回應
      await lineClient.replyMessage(replyToken, {
        type: 'text',
        text: `非常感謝您的分享，${greeting}！我現在可以為您提供更加個人化的健康建議了。\n\n您有什麼健康方面的問題想了解，或是對哪些保健品有興趣呢？😊`
      });
      return true;
  }
  
  return false; // 不需要收集資料
}

// 獲取用戶資料
async function getUserProfile(userId) {
  // 內存中已有資料
  if (userProfiles[userId] && userProfiles[userId].state === 'complete') {
    return userProfiles[userId];
  }
  
  // 從Firebase獲取
  if (firebaseInitialized && db) {
    try {
      const doc = await db.collection('userProfiles').doc(userId).get();
      if (doc.exists) {
        const data = doc.data();
        userProfiles[userId] = {
          state: 'complete',
          nickname: data.nickname,
          gender: data.gender,
          age: data.age,
          location: data.location,
          ageGroup: data.ageGroup
        };
        return userProfiles[userId];
      }
    } catch (error) {
      console.error(`獲取用戶輪廓資訊失敗:`, error);
    }
  }
  
  // 返回空資料
  return { state: 'askingName' };
}

// 獲取個人化稱呼
function getPersonalizedGreeting(profile) {
  // 檢查profile是否存在
  if (!profile) {
    return '';
  }
  
  let greeting = '';
  
  // 有暱稱優先使用暱稱
  if (profile.nickname) {
    greeting = profile.nickname;
    return greeting; // 有暱稱直接返回，不添加先生/小姐等稱呼
  }
  
  // 根據性別提供基本稱呼
  if (profile.gender) {
    if (profile.gender === '男性') {
      greeting = '先生';
    } else if (profile.gender === '女性') {
      greeting = '小姐';
    }
    return greeting;
  }
  
  // 如果有設置年齡組別和性別，提供更精確的稱呼
  if (profile.ageGroup && profile.gender) {
    if (profile.ageGroup === 'young') {
      // 年輕群體
      if (profile.gender === '男性') {
        greeting = '弟弟';
      } else if (profile.gender === '女性') {
        greeting = '妹妹';
      }
    } else if (profile.ageGroup === 'adult') {
      // 成年群體
      if (profile.gender === '男性') {
        greeting = '先生';
      } else if (profile.gender === '女性') {
        greeting = '小姐';
      }
    } else if (profile.ageGroup === 'senior') {
      // 銀髮族
      if (profile.gender === '男性') {
        greeting = '爸爸';
      } else if (profile.gender === '女性') {
        greeting = '媽媽';
      }
    }
  }
  
  return greeting;
}

// 获取用户会话
async function getUserSession(userId) {
  console.log(`獲取用戶 ${userId} 的會話`);
  // 如果Firebase初始化成功，使用Firestore
  if (firebaseInitialized && db) {
    try {
      console.log(`嘗試從Firestore獲取用戶 ${userId} 的會話`);
      const doc = await db.collection('sessions').doc(userId).get();
      if (doc.exists) {
        console.log(`成功獲取用戶 ${userId} 的既有會話`);
        return doc.data();
      } else {
        console.log(`用戶 ${userId} 沒有既有會話，創建新會話`);
        // 新用户，创建默认会话
        const defaultSession = {
          messages: [
            { role: "system", content: getSystemPrompt() }
          ],
          lastActive: admin.firestore.FieldValue.serverTimestamp()
        };
        await db.collection('sessions').doc(userId).set(defaultSession);
        console.log(`已為用戶 ${userId} 創建新會話`);
        return defaultSession;
      }
    } catch (error) {
      console.error(`從Firestore獲取用戶 ${userId} 會話失敗:`, error);
      // 返回默认会话，避免错误影响用户体验
    return {
        messages: [{ role: "system", content: getSystemPrompt() }],
        lastActive: new Date()
      };
    }
  } else {
    // 使用内存存储
    console.log(`使用內存存儲獲取用戶 ${userId} 的會話`);
    if (!userSessions[userId]) {
      console.log(`用戶 ${userId} 沒有內存會話，創建新會話`);
      userSessions[userId] = {
        messages: [{ role: "system", content: getSystemPrompt() }],
        lastActive: new Date()
      };
    } else {
      console.log(`成功獲取用戶 ${userId} 的內存會話，消息數量: ${userSessions[userId].messages.length}`);
    }
    return userSessions[userId];
  }
}

// 更新用户会话
async function updateUserSession(userId, messages) {
  console.log(`更新用戶 ${userId} 的會話，消息數量: ${messages.length}`);
  // 如果Firebase初始化成功，使用Firestore
  if (firebaseInitialized && db) {
    try {
      console.log(`嘗試更新用戶 ${userId} 的Firestore會話`);
      await db.collection('sessions').doc(userId).update({
        messages: messages,
        lastActive: admin.firestore.FieldValue.serverTimestamp()
      });
      console.log(`成功更新用戶 ${userId} 的Firestore會話`);
    } catch (error) {
      console.error(`更新用戶 ${userId} Firestore會話失敗:`, error);
      // 嘗試創建而不是更新
      try {
        console.log(`嘗試創建用戶 ${userId} 的Firestore會話`);
        await db.collection('sessions').doc(userId).set({
          messages: messages,
          lastActive: admin.firestore.FieldValue.serverTimestamp()
        });
        console.log(`成功創建用戶 ${userId} 的Firestore會話`);
      } catch (setError) {
        console.error(`創建用戶 ${userId} Firestore會話失敗:`, setError);
      }
    }
  } else {
    // 使用内存存储
    console.log(`使用內存存儲更新用戶 ${userId} 的會話`);
    if (userSessions[userId]) {
      userSessions[userId].messages = messages;
      userSessions[userId].lastActive = new Date();
      console.log(`成功更新用戶 ${userId} 的內存會話`);
    } else {
      console.log(`用戶 ${userId} 沒有內存會話，創建新會話`);
      userSessions[userId] = {
        messages: messages,
        lastActive: new Date()
      };
    }
  }
}

// 清理长时间不活跃的会话
async function cleanupOldSessions() {
  // 如果Firebase初始化成功，使用Firestore
  if (firebaseInitialized && db) {
    try {
      // 计算30天前的时间戳
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - 30);
      
      const oldSessions = await db.collection('sessions')
        .where('lastActive', '<', cutoffDate)
        .get();
        
      const batch = db.batch();
      oldSessions.forEach(doc => {
        batch.delete(doc.ref);
      });
      
      await batch.commit();
      console.log(`清理了 ${oldSessions.size} 个过期会话`);
    } catch (error) {
      console.error('清理旧会话失败:', error);
    }
  } else {
    // 内存存储版本的清理
    const now = new Date();
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - 30);
    
    let cleanedCount = 0;
    for (const userId in userSessions) {
      if (userSessions[userId].lastActive < cutoffDate) {
        delete userSessions[userId];
        cleanedCount++;
      }
    }
    if (cleanedCount > 0) {
      console.log(`清理了 ${cleanedCount} 个过期内存会话`);
    }
  }
}

// 定期清理旧会话(每天一次)
setInterval(cleanupOldSessions, 24 * 60 * 60 * 1000);

// 系統提示詞
function getSystemPrompt() {
  const productSummary = productData.map(p => 
    `產品名稱: ${p.name}\n類別: ${p.categories.join(', ')}\n特點: ${p.features.join('; ')}`
  ).join('\n\n');
  
  return `你是「小晶」，晶璽健康（JH Health）的專業AI顧問，擁有豐富的營養、保健和防詐騙知識。
你的職責是了解用戶的需求，並根據不同的查詢提供相應的服務：

1. 健康保健顧問：提供營養建議和推薦適合的保健產品
2. 防詐騙顧問：提供防詐騙建議和案例分享

個性特點：
1. 親切友善，像朋友般交流
2. 專業可靠，提供科學依據的建議
3. 活潑開朗，使用emoji增加對話活力
4. 自稱「小晶」，建立親密感

健康保健顧問角色時，你應該：
1. 用專業但親切的語氣回答問題
2. 了解用戶的健康需求和症狀
3. 根據用戶需求推薦適合的產品
4. 提供科學的保健知識和建議

防詐騙顧問角色時，你應該：
1. 用專業、穩重的語氣進行溝通
2. 表達對用戶處境的關心和理解
3. 提供具體的防詐騙方法和建議
4. 分享相關詐騙案例，幫助用戶辨識風險

避免：
1. 做出醫療診斷或治療建議
2. 誇大產品功效或做出不實承諾
3. 推薦不相關的產品
4. 使用過於正式或冷淡的語氣

晶璽健康的產品資訊：
${productSummary}

請根據用戶的問題，適時切換角色，提供最專業、最適合的建議。`;
}

// 判斷是否為產品查詢的函數
function isProductQuery(input) {
  return HEALTH_KEYWORDS.some(keyword => input.includes(keyword));
}

// 添加一個直接回應產品推薦的函數
function getDirectRecommendation(query) {
  console.log(`使用直接推薦回應: ${query}`);
  
  if (query.includes('維生素') || query.includes('營養素')) {
    return `🌟 產品推薦 🌟\n
【多維營養素 - 全方位保健】
✨ 特點：完整的維生素B群、維生素C、維生素D3和礦物質組合；
      🔬 科學配方比例，強化吸收率；
      💪 適合日常營養補充、增強免疫力。
      
【晶璽綜合維他命】
✨ 獨特配方，含有抗氧化成分；
🌿 天然來源，無人工色素；
⏰ 每日一顆，滿足基礎營養需求。
      
💡 維生素最好飯後服用，效果更佳！`;
  }
  
  if (query.includes('三高')) {
    return `🌟 產品推薦 🌟\n
【日常三高健康管理重點】
1️⃣ 均衡飲食：減少精緻澱粉和糖分攝取，多吃蔬果和優質蛋白
2️⃣ 規律運動：每週至少150分鐘中等強度運動，幫助代謝
3️⃣ 良好作息：充足睡眠，避免熬夜，減少身體壓力
4️⃣ 定期檢查：每3-6個月監測一次血壓、血糖和血脂數值

【醣可淨 BMEP – 安唐神器】
✨ 特點：專利山苦瓜萃取，低溫水萃技術，經醫師與營養師雙推薦；
      🔬 螯合鋅、酵母鉻成分提升利用率及吸收率。
      
【醣可淨 PLUS – 鋅醣高手】
✨ 加強版配方，提供更全面的保健效果。

【妥定 – SBH 植萃複方】
✨ 資深藝人黃建群代言推薦
✨ 獨創SBH配方：全方位調整、修護三高問題
✨ 專利藤黃果萃取：高活性HCA、有助代謝調節
✨ 專利棕梠果萃取：富含維生素E，增加Q10合成
✨ 高達28篇專利認證，科學實證有效
      
💡 搭配均衡飲食與規律運動，效果更佳！`;
  }
  
  if (query.includes('疲勞') || query.includes('累') || query.includes('機能強化')) {
    return `🌟 產品推薦 🌟\n
【改善疲勞關鍵要點】
1️⃣ 規律作息：固定時間睡眠，每天7-8小時為佳
2️⃣ 均衡營養：多攝取高蛋白、優質脂肪和複合碳水化合物
3️⃣ 適當運動：每天30分鐘有氧運動，增強體力
4️⃣ 減壓放鬆：學習減壓技巧，如深呼吸、冥想等
5️⃣ 補充水分：每天保持2000-2500ml水分攝取

【御薑君】
特點：黃金比例四合一複方薑黃，日本沖繩原裝進口；
      四氫薑黃素含量高達35倍，吸收率高！
      有助於滋補強身、增強體力、提升活力。
      
💡 每日一包，是忙碌生活的能量補給！`;
  }
  
  if (query.includes('腸胃') || query.includes('消化') || query.includes('順暢') || query.includes('腸道') || query.includes('腸道健康')) {
    return `🌟 產品推薦 🌟\n
【腸胃保健基礎要點】
1️⃣ 飲食規律：定時定量進食，避免暴飲暴食
2️⃣ 細嚼慢嚥：充分咀嚼食物，減輕腸胃負擔
3️⃣ 多纖維少油：增加膳食纖維攝取，減少油膩食物
4️⃣ 適量喝水：飯前飯後適量喝水，幫助消化
5️⃣ 保持運動：溫和運動促進腸胃蠕動

【衛的勝 – 5 大護衛軍】
✨ 特點：AB克菲爾菌組成，全球唯一「完全共生發酵技術」
✨ 每包含270億專利特有菌數，遠超一般益生菌產品
✨ 五大菌種協同作用，全面呵護腸道健康
✨ 可有效調整體質、促進消化道機能、增強免疫力
✨ 獨特配方可耐胃酸環境，活菌直達腸道

【腸道特別保養套組】
✨ 衛的勝 + 專業腸道酵素
✨ 雙管齊下：補充好菌 + 提升消化吸收
✨ 特別添加水果酵素，幫助分解食物
✨ 改善腸道蠕動，解決便秘困擾
      
💡 腸道是人體最大的免疫器官，照顧好腸道就是照顧好整體健康！`;
  }
  
  if (query.includes('骨') || query.includes('關節')) {
    return `🌟 產品推薦 🌟\n
【關節保健重要指南】
1️⃣ 維持理想體重：減輕關節負擔
2️⃣ 適度鍛鍊：加強肌肉力量，保護關節
3️⃣ 正確姿勢：避免不良姿勢導致關節磨損
4️⃣ 溫養關節：避免長時間同一姿勢，適時熱敷

【藻股康 S.B.S – 護股 SBS】
特點：80公斤褐藻僅能萃取1克珍貴SBS，天然精華；
      小分子褐藻，營養直入好吸收；
      獨家SBS雙向調節專利成份。
      
💡 給關節最溫柔的照顧！`;
  }
  
  if (query.includes('窈窕') || query.includes('代謝') || query.includes('體重')) {
    return `🌟 產品推薦 🌟\n
【健康體重管理重點】
1️⃣ 均衡飲食：控制熱量攝取，增加蛋白質和纖維素比例
2️⃣ 多元運動：有氧+肌力訓練，每週至少150分鐘
3️⃣ 充足睡眠：保持7-8小時優質睡眠，促進代謝
4️⃣ 喝足夠水：每天至少2000ml，加速新陳代謝
5️⃣ 定期監測：記錄體重變化，及時調整計劃

【靚舒暢 SIRT 體控方】
特點：專業營養師推薦，獨家專利配方；
      含有薑黃素、綠茶萃取物等成分；
      促進新陳代謝，調整體質。
      
💡 輕鬆保持健康體態！`;
  }
  
  // 默認推薦
  return `🌟 產品推薦 🌟\n
【日常健康管理要點】
1️⃣ 均衡飲食：五穀雜糧為主，蔬果優質蛋白為輔
2️⃣ 規律運動：每天30分鐘，提升心肺功能
3️⃣ 充足睡眠：夜間7-8小時高品質睡眠
4️⃣ 適當休息：適時放鬆身心，減少壓力
5️⃣ 定期檢查：每年健康檢查，預防勝於治療

晶璽健康擁有多款優質保健品可供選擇：

【🦴 藻股康 SBS】- 骨關節保健
【🌿 衛的勝】- 腸道健康
【🔥 御薑君】- 機能強化
【🍵 醣可淨】- 代謝調節
【⚡ 靚舒暢】- 體態管理
【💊 多維營養素】- 全方位營養補充

📱 歡迎告訴我更具體的需求，讓我為您提供更精準的建議！`;
}

// 獲取產品推薦
async function getProductRecommendation(query) {
  try {
    // 整理產品數據以便提供給GPT
    const productInfo = productData.map(p => ({
      name: p.name,
      categories: p.categories,
      features: p.features,
      tags: p.tags,
      description: p.description.substring(0, 200) // 限制長度
    }));
    
    // 將完整產品數據轉換為字符串
    const productDataStr = JSON.stringify(productInfo);
    
    const response = await openai.chat.completions.create({
      model: GPT_MODEL,
      messages: [
        {
          role: "system",
          content: `你是晶璽健康（JH Health）的專業保健品顧問，擁有豐富的營養和保健知識。
你的職責是了解用戶的健康需求，並從晶璽健康的產品中提供最適合的推薦。

你應該：
1. 用專業但親切的語氣回答問題
2. 了解用戶的健康需求和症狀
3. 根據用戶需求推薦最適合的1-2個產品
4. 提供科學的保健知識和建議
5. 解釋為什麼推薦這些產品
6. 回答格式應包含：問題理解、產品推薦、推薦理由、使用建議

避免：
1. 做出醫療診斷或治療建議
2. 誇大產品功效或做出不實承諾
3. 推薦不相關的產品

以下是晶璽健康的產品數據：
${productDataStr}

請根據用戶的詢問，推薦最適合的產品，並提供專業的健康建議。`
        },
        {
          role: "user",
          content: query
        }
      ],
      temperature: 0.7
    });

    return response.choices[0].message.content;
  } catch (error) {
    console.error('獲取產品推薦時發生錯誤:', error);
    return `抱歉，我暫時無法提供產品推薦。您可以直接聯繫我們的客服人員或瀏覽晶璽健康官網獲取更多資訊：https://jhhealth.com.tw/`;
  }
}

// 發送圖片示例
/*
function sendProductImage(replyToken, productName) {
  // 根據產品名稱找到對應圖片URL
  let imageUrl = '';
  
  if (productName.includes('藻股康')) {
    imageUrl = 'https://jhhealth.com.tw/wp-content/uploads/2022/07/aos.jpg';
  } else if (productName.includes('衛的勝')) {
    imageUrl = 'https://jhhealth.com.tw/wp-content/uploads/2022/07/probiotic-warlords.jpg';
  } else if (productName.includes('御薑君')) {
    imageUrl = 'https://jhhealth.com.tw/wp-content/uploads/2022/07/turmeric-king.jpg';
  } else if (productName.includes('醣可淨')) {
    imageUrl = 'https://jhhealth.com.tw/wp-content/uploads/2022/07/bmep.jpg';
  } else if (productName.includes('靚舒暢')) {
    imageUrl = 'https://jhhealth.com.tw/wp-content/uploads/2022/07/sirt.jpg';
  } else {
    // 默認圖片
    imageUrl = 'https://jhhealth.com.tw/wp-content/uploads/2022/07/company-logo.jpg';
  }

  return lineClient.replyMessage(replyToken, {
    type: 'image',
    originalContentUrl: imageUrl,
    previewImageUrl: imageUrl
  });
}
*/

// 獲取天氣信息的函數
async function getWeatherInfo() {
  try {
    console.log('正在獲取天氣信息...');
    console.log(`使用API金鑰: ${CWA_API_KEY}`);
    
    // 使用正確的CWA網址
    const apiUrl = 'https://opendata.cwa.gov.tw/api/v1/rest/datastore/F-C0032-001';
    
    console.log(`天氣API請求URL: ${apiUrl}`);
    
    // 獲取全臺天氣預報 (F-C0032-001)
    const response = await axios.get(
      apiUrl,
      {
        params: {
          Authorization: CWA_API_KEY,
          format: 'JSON'
          // locationName保持為空，獲取所有縣市的資料
        },
        timeout: 15000, // 延長超時時間為15秒
        headers: {
          'accept': 'application/json',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
        },
        // 移除代理設置
        proxy: false
      }
    );
    
    console.log('成功獲取天氣數據');
    console.log('天氣數據狀態碼:', response.status);
    console.log('天氣數據樣本:', JSON.stringify(response.data).substr(0, 200) + '...');
    
    // 如果API金鑰無效，這裡會返回401錯誤
    if (response.status !== 200) {
      console.error(`獲取天氣數據失敗，狀態碼: ${response.status}`);
      return '抱歉，目前無法獲取天氣信息。您可以直接詢問我有關健康產品的問題！';
    }

    // 解析數據
    const data = response.data;
    if (!data || !data.success || !data.records || !data.records.location || data.records.location.length === 0) {
      console.error('天氣數據格式不正確:', JSON.stringify(data).substring(0, 200) + '...');
      throw new Error('無法獲取天氣數據或資料格式錯誤');
    }

    // 輸出部分天氣數據用於調試
    if (data.records.location[0] && data.records.location[0].weatherElement) {
      const sampleLocation = data.records.location[0].locationName;
      const sampleTime = data.records.location[0].weatherElement[0]?.time[0]?.startTime || 'unknown';
      console.log(`天氣數據樣本: ${sampleLocation}, 時間: ${sampleTime}`);
    }

    // 準備天氣信息
    let weatherSummary = '📅 今日全台天氣概況 📅\n';
    
    // 北中南東代表性城市的天氣
    const regions = {
      '北部': ['臺北市', '新北市'],
      '中部': ['臺中市'],
      '南部': ['臺南市', '高雄市'],
      '桃竹苗': ['桃園市']
    };
    
    // 記錄最高和最低溫度
    let overallMinTemp = 100;
    let overallMaxTemp = -100;
    
    // 統計各區域天氣
    for (const [region, cities] of Object.entries(regions)) {
      // 尋找該區域的城市數據
      const cityData = data.records.location.filter(loc => cities.includes(loc.locationName));
      
      if (cityData.length > 0) {
        // 用於該區域的天氣描述統計
        const weatherTypes = {};
        let regionMinTemp = 100;
        let regionMaxTemp = -100;
        let maxRainProb = 0;
        
        // 分析區域內各城市天氣數據
        cityData.forEach(city => {
          // 獲取第一個時間段的數據 (通常是最近的)
          const weatherElement = city.weatherElement;
          
          // 天氣現象 (Wx)
          const wxElement = weatherElement.find(el => el.elementName === 'Wx');
          if (wxElement && wxElement.time && wxElement.time.length > 0) {
            const weatherDesc = wxElement.time[0].parameter.parameterName;
            weatherTypes[weatherDesc] = (weatherTypes[weatherDesc] || 0) + 1;
          }
          
          // 溫度 (MinT, MaxT)
          const minTElement = weatherElement.find(el => el.elementName === 'MinT');
          const maxTElement = weatherElement.find(el => el.elementName === 'MaxT');
          
          if (minTElement && minTElement.time && minTElement.time.length > 0) {
            const minTemp = parseInt(minTElement.time[0].parameter.parameterName);
            regionMinTemp = Math.min(regionMinTemp, minTemp);
            overallMinTemp = Math.min(overallMinTemp, minTemp);
          }
          
          if (maxTElement && maxTElement.time && maxTElement.time.length > 0) {
            const maxTemp = parseInt(maxTElement.time[0].parameter.parameterName);
            regionMaxTemp = Math.max(regionMaxTemp, maxTemp);
            overallMaxTemp = Math.max(overallMaxTemp, maxTemp);
          }
          
          // 降雨機率 (PoP)
          const popElement = weatherElement.find(el => el.elementName === 'PoP');
          if (popElement && popElement.time && popElement.time.length > 0) {
            const rainProb = parseInt(popElement.time[0].parameter.parameterName);
            maxRainProb = Math.max(maxRainProb, rainProb);
          }
        });
        
        // 獲取該區域最常見的天氣現象
        const weatherEntries = Object.entries(weatherTypes);
        if (weatherEntries.length > 0) {
          const mostCommonWeather = weatherEntries.sort((a, b) => b[1] - a[1])[0][0];
          
          // 選擇天氣emoji
          let weatherEmoji = '🌤️';
          if (mostCommonWeather.includes('晴') && !mostCommonWeather.includes('雨')) {
            weatherEmoji = '☀️';
          } else if (mostCommonWeather.includes('雨')) {
            weatherEmoji = '🌧️';
          } else if (mostCommonWeather.includes('雲')) {
            weatherEmoji = '☁️';
          } else if (mostCommonWeather.includes('陰')) {
            weatherEmoji = '🌥️';
          } else if (mostCommonWeather.includes('雪')) {
            weatherEmoji = '❄️';
          } else if (mostCommonWeather.includes('霧')) {
            weatherEmoji = '🌫️';
          }
          
          // 添加區域天氣摘要
          weatherSummary += `${weatherEmoji} ${region}: ${mostCommonWeather}, ${regionMinTemp}°C-${regionMaxTemp}°C`;
          
          // 添加降雨機率(如果有顯著機率)
          if (maxRainProb >= 30) {
            weatherSummary += `, 降雨機率${maxRainProb}%`;
          }
          
          weatherSummary += '\n';
        }
      }
    }
    
    // 添加全台溫度範圍和健康提醒
    weatherSummary += `🌡️ 全台溫度: ${overallMinTemp}°C - ${overallMaxTemp}°C\n`;
    
    // 根據天氣狀況提供健康建議
    const avgTemp = (overallMinTemp + overallMaxTemp) / 2;
    if (avgTemp < 15) {
      weatherSummary += '❄️ 今日偏涼，外出記得添加衣物保暖，多喝溫水護胃！';
    } else if (avgTemp > 28) {
      weatherSummary += '🔆 今日偏熱，記得多補充水分，避免長時間曝曬於陽光下！';
    } else {
      weatherSummary += '🍃 今日溫度適宜，記得適時補充水分，保持健康作息！';
    }
    
    return weatherSummary;
  } catch (error) {
    console.error('獲取天氣信息失敗:', error);
    
    // 使用更簡化的備用方法
    try {
      console.log('嘗試使用備用簡化方法獲取天氣信息...');
      
      // 直接使用完整URL
      const simpleUrl = `https://opendata.cwa.gov.tw/api/v1/rest/datastore/F-C0032-001?Authorization=${CWA_API_KEY}&format=JSON`;
      
      console.log(`備用API請求URL: ${simpleUrl}`);
      
      const backupResponse = await axios.get(simpleUrl, {
        headers: {
          'accept': 'application/json',
          'User-Agent': 'Mozilla/5.0'
        },
        timeout: 10000
      });
      
      if (backupResponse.status === 200 && backupResponse.data && backupResponse.data.success) {
        console.log('備用簡化方法成功獲取天氣信息');
        
        // 簡單提取出臺北市的資訊作為代表
        const data = backupResponse.data;
        if (data.records && data.records.location) {
          const tpe = data.records.location.find(loc => loc.locationName === '臺北市');
          if (tpe) {
            let weatherDesc = '晴時多雲';
            let minTemp = '?';
            let maxTemp = '?';
            
            const weatherElements = tpe.weatherElement || [];
            for (const element of weatherElements) {
              if (element.elementName === 'Wx' && element.time && element.time[0]) {
                weatherDesc = element.time[0].parameter.parameterName;
              }
              if (element.elementName === 'MinT' && element.time && element.time[0]) {
                minTemp = element.time[0].parameter.parameterName;
              }
              if (element.elementName === 'MaxT' && element.time && element.time[0]) {
                maxTemp = element.time[0].parameter.parameterName;
              }
            }
            
            return `📅 今日天氣概況：${weatherDesc}，氣溫${minTemp}°C - ${maxTemp}°C，建議保持良好作息，多喝水，維持健康生活！`;
          }
        }
        
        return '📅 今日天氣舒適，建議保持良好作息，多喝水，維持健康生活！';
      }
    } catch (backupError) {
      console.error('備用簡化方法也失敗:', backupError);
    }
    
    // 默認返回信息
    return '📅 今日天氣舒適，建議保持良好作息，多喝水，維持健康生活！';
  }
}

// 啟動服務器
const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`服務器已啟動，監聽端口 ${port}`);
});

// 判斷是否為詐騙查詢
function isFraudQuery(input) {
  return FRAUD_KEYWORDS.some(keyword => input.includes(keyword));
}

// 取得相關詐騙案例
function getRelatedFraudCases(fraudType, count = 2) {
  // 檢查詐騙案例是否已載入
  if (fraudCases.length === 0) {
    console.log('警告：詐騙案例尚未載入');
    return [];
  }
  
  // 根據詐騙類型篩選案例
  const typeRelatedCases = fraudCases.filter(c => c.標題 === fraudType);
  
  // 如果找不到該類型的案例，則返回任意案例
  if (typeRelatedCases.length === 0) {
    console.log(`找不到${fraudType}類型的案例，返回隨機案例`);
    // 篩選有效案例
    const validCases = fraudCases.filter(c => c.標題 !== '無標題' && c.內容 !== '無內容');
    // 隨機選擇案例
    const randomCases = [];
    for (let i = 0; i < Math.min(count, validCases.length); i++) {
      const randomIndex = Math.floor(Math.random() * validCases.length);
      randomCases.push(validCases[randomIndex]);
      // 避免重複選擇同一個案例
      validCases.splice(randomIndex, 1);
    }
    return randomCases;
  }
  
  // 如果案例不足，則返回所有找到的案例
  if (typeRelatedCases.length <= count) {
    return typeRelatedCases;
  }
  
  // 隨機選擇指定數量的案例
  const selectedCases = [];
  const casesCopy = [...typeRelatedCases];
  for (let i = 0; i < count; i++) {
    const randomIndex = Math.floor(Math.random() * casesCopy.length);
    selectedCases.push(casesCopy[randomIndex]);
    casesCopy.splice(randomIndex, 1);
  }
  
  return selectedCases;
}
