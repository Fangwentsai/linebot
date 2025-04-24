require('dotenv').config();
const express = require('express');
const line = require('@line/bot-sdk');
const OpenAI = require('openai');
const fs = require('fs');
const path = require('path');
const axios = require('axios');

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
  const rawData = fs.readFileSync(path.join(__dirname, 'jh_health_products.json'), 'utf8');
  productData = JSON.parse(rawData);
  console.log(`成功載入 ${productData.length} 個產品數據`);
} catch (error) {
  console.error('讀取產品數據失敗:', error);
  console.log('將使用空的產品數據集');
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

// 已發送商品推薦的用戶記錄
const userProductRecommendations = {};

// 用于存储用户会话的内存对象(临时替代Firebase)
const userSessions = {};

// 事件處理函數
async function handleEvent(event) {
  // 處理用戶加入好友事件
  if (event.type === 'follow') {
    // 發送歡迎詞
    return lineClient.replyMessage(event.replyToken, {
      type: 'text',
      text: `嗨～👋 感謝{Nickname}爸爸/媽媽加入小晶為好友！

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

現在，有什麼我能幫您的嗎？`
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
        
        // 更新对话历史
        userSession.messages.push({
          role: "assistant",
          content: `這是我們的${productType}產品連結，您可以點擊查看更多詳情和購買方式：\n\n${productUrl}\n\n🚚 全館滿2,000即享免運服務，東西直接送到家！😊\n\n如果有其他問題，隨時都可以問我喔！😊`
        });
        
        // 保存对话历史
        await updateUserSession(userId, userSession.messages);
        
        return lineClient.replyMessage(event.replyToken, {
          type: 'text',
          text: `這是我們的${productType}產品連結，您可以點擊查看更多詳情和購買方式：\n\n${productUrl}\n\n🚚 全館滿2,000即享免運服務，東西直接送到家！😊\n\n如果有其他問題，隨時都可以問我喔！😊`
        });
      } 
      // 沒有推薦過產品，提供通用賣場連結
      else {
        // 更新对话历史
        userSession.messages.push({
          role: "assistant",
          content: `這是晶璽健康的官方商城，您可以瀏覽所有產品：\n\n${productUrls['賣場']}\n\n🚚 全館滿2,000即享免運服務，東西直接送到家！😊\n\n您有特定想了解的健康需求嗎？我可以為您推薦最適合的產品！😊`
        });
        
        // 保存对话历史
        await updateUserSession(userId, userSession.messages);
        
        return lineClient.replyMessage(event.replyToken, {
          type: 'text',
          text: `這是晶璽健康的官方商城，您可以瀏覽所有產品：\n\n${productUrls['賣場']}\n\n🚚 全館滿2,000即享免運服務，東西直接送到家！😊\n\n您有特定想了解的健康需求嗎？我可以為您推薦最適合的產品！😊`
        });
      }
    }
    
    // 處理簡單問候
    if (userInput.match(/^(你好|哈囉|嗨|hi|hello)/i)) {
      try {
        // 獲取天氣數據
        const weatherInfo = await getWeatherInfo();
        
        const replyText = `你好！👋 我是「小晶」，晶璽健康的專業AI諮詢員 ✨\n\n${weatherInfo}\n\n很高興為您服務！我可以為您介紹各種保健品知識，並根據您的需求推薦最適合的產品。\n\n有什麼保健需求想了解的嗎？😊`;
        
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
        const replyText = `你好！👋 我是「小晶」，晶璽健康的專業AI諮詢員 ✨\n\n很高興為您服務！我可以為您介紹各種保健品知識，並根據您的需求推薦最適合的產品。\n\n有什麼保健需求想了解的嗎？😊`;
        
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
      
      // 延遲一秒後再發送產品推薦
      setTimeout(async () => {
        try {
          await lineClient.pushMessage(event.source.userId, {
            type: 'text',
            text: productText + '\n\n請爸爸/媽媽參考一下，如果有需要我再提供網頁連結讓您參考😊'
          });
        } catch (err) {
          console.error('發送產品推薦失敗:', err);
        }
      }, 1000);
      
      return;
    }
    
    // 一般對話處理
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
  
  return `你是「小晶」，晶璽健康（JH Health）的專業保健品顧問，擁有豐富的營養和保健知識。
你的職責是了解用戶的健康需求，並從晶璽健康的產品中提供最適合的推薦。

個性特點：
1. 親切友善，像朋友般交流
2. 專業可靠，提供科學依據的建議
3. 活潑開朗，使用emoji增加對話活力
4. 自稱「小晶」，建立親密感

你應該：
1. 用專業但親切的語氣回答問題
2. 了解用戶的健康需求和症狀
3. 根據用戶需求推薦適合的產品
4. 提供科學的保健知識和建議
5. 適當使用emoji表情符號增加親和力(如：😊 💪 ✨ 🌿 💡 等)
6. 在合適的時機提到自己是「小晶」

避免：
1. 做出醫療診斷或治療建議
2. 誇大產品功效或做出不實承諾
3. 推薦不相關的產品
4. 使用過於正式或冷淡的語氣

晶璽健康的產品資訊：
${productSummary}

請以專業健康顧問的身份，協助用戶找到最適合的保健品。`;
}

// 判斷是否為產品查詢的函數
function isProductQuery(input) {
  return HEALTH_KEYWORDS.some(keyword => input.includes(keyword));
}

// 添加一個直接回應產品推薦的函數
function getDirectRecommendation(query) {
  console.log(`使用直接推薦回應: ${query}`);
  
  if (query.includes('維生素') || query.includes('營養素')) {
    return `🌟 產品推薦 ��\n
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
    
    // 獲取全臺天氣預報 (F-C0032-001)
    const response = await axios.get(
      'https://opendata.cwa.gov.tw/api/v1/rest/datastore/F-C0032-001',
      {
        params: {
          Authorization: CWA_API_KEY,
          format: 'JSON',
          locationName: '臺北市,新北市,桃園市,臺中市,臺南市,高雄市', // 主要城市
          elementName: 'Wx,PoP,MinT,MaxT', // 天氣現象, 降雨機率, 最低溫度, 最高溫度
          sort: 'time'
        },
        timeout: 10000, // 設定超時時間為10秒
      }
    );
    
    console.log('成功獲取天氣數據');
    console.log('天氣數據狀態碼:', response.status);
    
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
    
    // 針對不同錯誤類型提供更具體的處理
    if (error.code === 'ENOTFOUND' || error.code === 'EAI_AGAIN') {
      console.error('網絡連接問題：無法解析域名，可能是DNS服務器問題或網絡連接中斷');
      return '抱歉，目前無法獲取天氣信息，網絡連接出現問題。您可以直接詢問我有關健康產品的問題！';
    }
    
    if (error.code === 'ECONNREFUSED') {
      console.error('連接被拒絕，服務器可能未運行或拒絕接受連接');
      return '抱歉，目前無法獲取天氣信息，氣象服務暫時不可用。您可以直接詢問我有關健康產品的問題！';
    }
    
    if (error.code === 'ETIMEDOUT' || error.code === 'ESOCKETTIMEDOUT') {
      console.error('連接超時，服務器回應時間過長');
      return '抱歉，氣象服務回應超時，暫時無法獲取天氣信息。您可以直接詢問我有關健康產品的問題！';
    }
    
    // Axios特定錯誤處理
    if (error.response) {
      // 服務器回應了錯誤狀態碼
      console.error(`服務器返回錯誤狀態碼: ${error.response.status}`);
      return '抱歉，氣象服務器出現問題，暫時無法獲取天氣信息。您可以直接詢問我有關健康產品的問題！';
    }
    
    // 默認返回信息
    return '抱歉，目前無法獲取天氣信息。您可以直接詢問我有關健康產品的問題！';
  }
}

// 啟動服務器
const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`服務器已啟動，監聽端口 ${port}`);
});
