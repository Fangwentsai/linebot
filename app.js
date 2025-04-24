require('dotenv').config();
const express = require('express');
const line = require('@line/bot-sdk');
const OpenAI = require('openai');
const fs = require('fs');
const path = require('path');

// 定義常量
const GPT_MODEL = "gpt-4o-mini";

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

// 事件處理函數
async function handleEvent(event) {
  if (event.type !== 'message' || event.message.type !== 'text') {
    return Promise.resolve(null);
  }

  const userInput = event.message.text;
  console.log(`收到用戶輸入: ${userInput}`);
  
  try {
    // 處理簡單問候
    if (userInput.match(/^(你好|哈囉|嗨|hi|hello)/i)) {
      return lineClient.replyMessage(event.replyToken, {
        type: 'text',
        text: `你好！👋 我是「小晶」，晶璽健康的專業AI諮詢員 ✨\n\n很高興為您服務！我可以為您介紹各種保健品知識，並根據您的需求推薦最適合的產品。\n\n有什麼保健需求想了解的嗎？😊`
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
      
      // 先發送關懷回應
      await lineClient.replyMessage(event.replyToken, {
        type: 'text',
        text: careText
      });
      
      // 延遲一秒後再發送產品推薦
      setTimeout(async () => {
        try {
          await lineClient.pushMessage(event.source.userId, {
            type: 'text',
            text: productText
          });
        } catch (err) {
          console.error('發送產品推薦失敗:', err);
        }
      }, 1000);
      
      // 找出推薦的產品名稱
      let recommendedProduct = '';
      let productImages = [];
      
      if (userInput.includes('三高')) {
        recommendedProduct = '醣可淨';
        productImages = [
          'https://jhhealth.com.tw/wp-content/uploads/2024-1225-%E5%B0%B1%E5%A6%A5%E5%AE%9A%E7%94%A2%E5%93%81%E9%A0%81-%E8%AA%BF%E6%95%B4%E8%A8%AD%E8%A8%88-%E4%BF%AE%E6%94%B9%E7%89%881.jpg',
          'https://jhhealth.com.tw/wp-content/uploads/2023/03/231222-%E5%B0%B1%E5%A6%A5%E5%AE%9A%E5%95%86%E5%93%81%E9%A0%812.jpg'
        ];
      }
      else if (userInput.includes('疲勞') || userInput.includes('機能強化')) recommendedProduct = '御薑君';
      else if (userInput.includes('腸胃')) recommendedProduct = '衛的勝';
      else if (userInput.includes('骨') || userInput.includes('關節')) recommendedProduct = '藻股康';
      else if (userInput.includes('窈窕') || userInput.includes('代謝')) recommendedProduct = '靚舒暢';
      
      // 發送產品圖片(如果有)
      if (productImages.length > 0) {
        setTimeout(async () => {
          try {
            for (const imageUrl of productImages) {
              await lineClient.pushMessage(event.source.userId, {
                type: 'image',
                originalContentUrl: imageUrl,
                previewImageUrl: imageUrl
              });
              // 多張圖片間隔發送
              await new Promise(resolve => setTimeout(resolve, 500));
            }
          } catch (err) {
            console.error('發送圖片失敗:', err);
          }
        }, 2000);
      }
      // 舊版本的發送圖片代碼（保留作為備份）
      else if (recommendedProduct) {
        setTimeout(async () => {
          try {
            await lineClient.pushMessage(event.source.userId, {
              type: 'image',
              originalContentUrl: `https://jhhealth.com.tw/product-images/${recommendedProduct}.jpg`,
              previewImageUrl: `https://jhhealth.com.tw/product-images/${recommendedProduct}-preview.jpg`
            });
          } catch (err) {
            console.error('發送圖片失敗:', err);
          }
        }, 2000);
      }
      
      return;
    }
    
    // 一般對話處理
    const response = await openai.chat.completions.create({
      model: GPT_MODEL,
      messages: [
        {
          role: "system",
          content: getSystemPrompt()
        },
        {
          role: "user",
          content: userInput
        }
      ],
      temperature: 0.7
    });

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
    return `\n\n🌟 產品推薦 🌟\n
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
    return `\n\n🌟 產品推薦 🌟\n
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
    return `\n\n🌟 產品推薦 🌟\n
【御薑君】
特點：黃金比例四合一複方薑黃，日本沖繩原裝進口；
      四氫薑黃素含量高達35倍，吸收率高！
      有助於滋補強身、增強體力、提升活力。
      
💡 每日一包，是忙碌生活的能量補給！`;
  }
  
  if (query.includes('腸胃') || query.includes('消化') || query.includes('順暢')) {
    return `\n\n🌟 產品推薦 🌟\n
【衛的勝 – 5 大護衛軍】
特點：AB克菲爾菌組成，全球唯一「完全共生發酵技術」；
      每包含270億專利特有菌數；
      有助於調整體質、促進消化道機能。
      
💡 適合現代人的日常保健選擇！`;
  }
  
  if (query.includes('骨') || query.includes('關節')) {
    return `\n\n🌟 產品推薦 🌟\n
【藻股康 S.B.S – 護股 SBS】
特點：80公斤褐藻僅能萃取1克珍貴SBS，天然精華；
      小分子褐藻，營養直入好吸收；
      獨家SBS雙向調節專利成份。
      
💡 給關節最溫柔的照顧！`;
  }
  
  if (query.includes('窈窕') || query.includes('代謝') || query.includes('體重')) {
    return `\n\n🌟 產品推薦 🌟\n
【靚舒暢 SIRT 體控方】
特點：專業營養師推薦，獨家專利配方；
      含有薑黃素、綠茶萃取物等成分；
      促進新陳代謝，調整體質。
      
💡 輕鬆保持健康體態！`;
  }
  
  // 默認推薦
  return `\n\n🌟 產品推薦 🌟\n
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

// 啟動服務器
const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`服務器已啟動，監聽端口 ${port}`);
});
