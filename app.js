require('dotenv').config();
const express = require('express');
const line = require('@line/bot-sdk');
const OpenAI = require('openai');
const axios = require('axios');
const https = require('https');

// 定義常量
const GPT_MODEL = "gpt-4o-mini-2024-07-18";
const CITIES = [
  '基隆市', '臺北市', '新北市', '桃園市', '新竹市', '新竹縣', 
  '苗栗縣', '臺中市', '彰化縣', '南投縣', '雲林縣', '嘉義市', 
  '嘉義縣', '臺南市', '高雄市', '屏東縣', '宜蘭縣', '花蓮縣', 
  '臺東縣', '澎湖縣', '金門縣', '連江縣'
];

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

// 天氣預報 API 實現
async function getWeatherForecast(cityName) {
  try {
    const response = await axios.get('https://opendata.cwa.gov.tw/api/v1/rest/datastore/F-C0032-001', {
      params: {
        Authorization: process.env.CWB_API_KEY,
        locationName: cityName
      },
      headers: {
        'accept': 'application/json'
      }
    });

    if (!response.data.success) {
      throw new Error('API 請求失敗');
    }

    const location = response.data.records.location[0];
    const elements = location.weatherElement;
    
    // 取得最新的預報資料（第一個時間段）
    const currentPeriod = {
      wx: elements.find(e => e.elementName === 'Wx').time[0],      // 天氣現象
      pop: elements.find(e => e.elementName === 'PoP').time[0],    // 降雨機率
      minT: elements.find(e => e.elementName === 'MinT').time[0],  // 最低溫度
      maxT: elements.find(e => e.elementName === 'MaxT').time[0],  // 最高溫度
      ci: elements.find(e => e.elementName === 'CI').time[0]       // 舒適度
    };

    // 格式化天氣數據
    const weatherData = {
      city: location.locationName,
      forecast: [{
        period: `${new Date(currentPeriod.wx.startTime).toLocaleString('zh-TW')} 至 ${new Date(currentPeriod.wx.endTime).toLocaleString('zh-TW')}`,
        wx: currentPeriod.wx.parameter.parameterName,
        pop: currentPeriod.pop.parameter.parameterName,
        minT: currentPeriod.minT.parameter.parameterName,
        maxT: currentPeriod.maxT.parameter.parameterName,
        ci: currentPeriod.ci.parameter.parameterName
      }]
    };

    return weatherData;
  } catch (error) {
    console.error('獲取天氣預報失敗:', error);
    
    if (error.response) {
      console.error('錯誤狀態碼:', error.response.status);
      console.error('錯誤信息:', error.response.data);
    } else if (error.request) {
      console.error('沒有收到回應');
    } else {
      console.error('錯誤:', error.message);
    }
    
    throw error;
  }
}

// 定義關鍵字列表
const WEATHER_KEYWORDS = ['天氣', '氣溫', '下雨', '會不會雨', '天氣如何', '氣象'];

// 定義縣市和其對應的鄉鎮區，包含多種可能的輸入方式
const DISTRICT_TO_CITY = {
  // 新北市
  '中和': '新北市', '中和區': '新北市',
  '永和': '新北市', '永和區': '新北市',
  '板橋': '新北市', '板橋區': '新北市',
  '三重': '新北市', '三重區': '新北市',
  '新莊': '新北市', '新莊區': '新北市',
  '土城': '新北市', '土城區': '新北市',
  '蘆洲': '新北市', '蘆洲區': '新北市',
  '汐止': '新北市', '汐止區': '新北市',
  '樹林': '新北市', '樹林區': '新北市',
  '淡水': '新北市', '淡水區': '新北市',

  // 台北市
  '信義': '臺北市', '信義區': '臺北市',
  '大安': '臺北市', '大安區': '臺北市',
  '松山': '臺北市', '松山區': '臺北市',
  '內湖': '臺北市', '內湖區': '臺北市',
  '南港': '臺北市', '南港區': '臺北市',
  '中山': '臺北市', '中山區': '臺北市',
  '萬華': '臺北市', '萬華區': '臺北市',
  '文山': '臺北市', '文山區': '臺北市',
  '北投': '臺北市', '北投區': '臺北市',
  '士林': '臺北市', '士林區': '臺北市',

  // 可以繼續添加其他縣市的地區...
};

// 健康檢查路由
app.get('/', (req, res) => {
  res.status(200).json({ status: 'ok' });
});

app.get('/linebot/webhook', (req, res) => {
  res.status(200).json({ status: 'webhook endpoint ok' });
});

// Webhook路由
app.post('/linebot/webhook', line.middleware(lineConfig), async (req, res) => {
  res.status(200).end();
  
  try {
    const events = req.body.events;
    events.forEach(async (event) => {
      try {
        await handleEvent(event);
      } catch (err) {
        console.error('事件處理錯誤:', err);
      }
    });
  } catch (err) {
    console.error('Webhook處理錯誤:', err);
  }
});

// 事件處理函數
async function handleEvent(event) {
  if (event.type !== 'message' || event.message.type !== 'text') {
    return null;
  }

  const userMessage = event.message.text;
  
  try {
    // 檢查是否包含天氣相關關鍵字
    const hasWeatherKeyword = WEATHER_KEYWORDS.some(keyword => userMessage.includes(keyword));
    
    if (hasWeatherKeyword) {
      // 移除所有天氣關鍵字，獲取地區名稱
      let query = userMessage;
      WEATHER_KEYWORDS.forEach(keyword => {
        query = query.replace(keyword, '');
      });
      query = query.replace(/的|是|如何|怎樣|嗎/g, '').trim(); // 移除常見的語氣詞

      let city = query;

      // 檢查是否是地區查詢
      for (const [district, cityName] of Object.entries(DISTRICT_TO_CITY)) {
        if (query.includes(district)) {
          city = cityName;
          query = district; // 保存原始查詢的地區名
          break;
        }
      }

      // 處理台/臺的差異
      if (city.includes('台')) {
        city = city.replace('台', '臺');
      }

      if (!query) {
        const response = await openai.chat.completions.create({
          model: GPT_MODEL,
          messages: [
            {
              role: "system",
              content: `你是一個天氣助手。當用戶詢問天氣但沒有指定地區時，請友善地詢問他們想查詢哪個地區的天氣。
你可以告訴他們可以直接說地區名稱，例如：
- 中和天氣如何？
- 我想知道信義區的天氣
- 淡水會不會下雨
- 新莊氣溫`
            },
            {
              role: "user",
              content: userMessage
            }
          ],
          temperature: 0.7
        });

        return lineClient.replyMessage(event.replyToken, {
          type: 'text',
          text: response.choices[0].message.content
        });
      }

      // 檢查是否為有效的縣市名稱
      if (!CITIES.includes(city)) {
        const response = await openai.chat.completions.create({
          model: GPT_MODEL,
          messages: [
            {
              role: "system",
              content: `你是一個天氣助手。用戶想查詢「${query}」的天氣，但這個地區不在支援範圍內。
請友善地告訴他可以查詢的地區範圍，並舉例說明幾種提問方式：
- 直接說地區名：中和天氣？
- 完整地區名：中和區天氣
- 詢問方式：淡水會不會下雨？
- 簡單提問：新莊氣溫`
            },
            {
              role: "user",
              content: userMessage
            }
          ],
          temperature: 0.7
        });

        return lineClient.replyMessage(event.replyToken, {
          type: 'text',
          text: response.choices[0].message.content
        });
      }

      // 獲取天氣數據
      const weatherData = await getWeatherForecast(city);
      
      // 在天氣數據中添加查詢的地區信息
      if (query !== city) {
        weatherData.district = query;
      }
      
      // 使用 GPT 生成更自然的天氣描述
      const response = await openai.chat.completions.create({
        model: GPT_MODEL,
        messages: [
          {
            role: "system",
            content: "你是一個天氣播報員。請用自然且友善的語氣描述天氣預報信息。" + 
                    (weatherData.district ? `這是${weatherData.district}的天氣預報，位於${weatherData.city}。` : "") +
                    "請加入一些生活建議，口語化一點，就像在跟朋友聊天一樣。"
          },
          {
            role: "user",
            content: JSON.stringify(weatherData)
          }
        ],
        temperature: 0.7
      });

      return lineClient.replyMessage(event.replyToken, {
        type: 'text',
        text: response.choices[0].message.content
      });
    }

    // 一般對話處理
    const response = await openai.chat.completions.create({
      model: GPT_MODEL,
      messages: [
        {
          role: "system",
          content: `你是一個智能助手，可以回答問題並提供幫助。如果用戶想查詢天氣，請建議他們直接輸入城市名稱加上「天氣」，例如「台北天氣」。
可查詢的城市列表：${CITIES.join('、')}`
        },
        {
          role: "user",
          content: userMessage
        }
      ],
      temperature: 0.7
    });

    return lineClient.replyMessage(event.replyToken, {
      type: 'text',
      text: response.choices[0].message.content
    });
    
  } catch (error) {
    console.error('處理訊息失敗:', error);
    return lineClient.replyMessage(event.replyToken, {
      type: 'text',
      text: `抱歉，獲取天氣信息時發生錯誤：${error.message}`
    });
  }
}

// 錯誤處理中間件
app.use((err, req, res, next) => {
  console.error('Error:', err);
  res.status(500).json({ error: 'Internal Server Error' });
});

// 啟動服務器
const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`服務器已啟動，監聽端口 ${port}`);
});