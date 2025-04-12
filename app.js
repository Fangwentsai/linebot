require('dotenv').config();
const express = require('express');
const line = require('@line/bot-sdk');
const OpenAI = require('openai');
const axios = require('axios');

// LINE配置
const lineConfig = {
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
  channelSecret: process.env.LINE_CHANNEL_SECRET
};

// 初始化LINE客户端
const lineClient = new line.Client(lineConfig);

// 初始化 OpenAI
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// 中央氣象署 API 設定
const CWB_API_KEY = process.env.CWB_API_KEY;
const CWB_API_URL = 'https://opendata.cwb.gov.tw/api/v1/rest/datastore';

const app = express();

// 健康检查路由
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
        console.error('事件处理错误:', err);
      }
    });
  } catch (err) {
    console.error('Webhook处理错误:', err);
  }
});

// 定義常量
const GPT_MODEL = "gpt-4-mini";  // 將模型名稱定義為常量

// 事件处理函数
async function handleEvent(event) {
  if (event.type !== 'message' || event.message.type !== 'text') {
    return null;
  }

  const userMessage = event.message.text;
  
  try {
    // 處理天氣查詢
    if (userMessage.includes('天氣')) {
      let city = userMessage.replace('天氣', '').trim();
      
      // 如果沒有指定城市，使用 GPT-4-mini 處理
      if (!city) {
        const response = await openai.chat.completions.create({
          model: GPT_MODEL,  // 使用正確的模型
          messages: [
            {
              role: "system",
              content: "你是一個天氣助手。當用戶沒有指定具體城市時，請友善地詢問他們想查詢哪個城市的天氣，並告訴他們可以查詢的城市列表。"
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

      // 處理台/臺的差異
      if (city.includes('台')) {
        city = city.replace('台', '臺');
      }

      // 檢查是否為有效的縣市名稱
      if (!CITIES.includes(city)) {
        // 使用 GPT 處理無效的城市名稱
        const response = await openai.chat.completions.create({
          model: "gpt-4-mini",
          messages: [
            {
              role: "system",
              content: `你是一個天氣助手。用戶輸入了無效的城市名稱「${city}」。請友善地告訴他正確的城市名稱格式，並提供可查詢的城市列表：${CITIES.join('、')}`
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
      
      // 使用 GPT 生成天氣描述時也使用正確的模型
      const response = await openai.chat.completions.create({
        model: GPT_MODEL,  // 使用正確的模型
        messages: [
          {
            role: "system",
            content: "你是一個天氣播報員。請用自然且友善的語氣描述天氣預報信息。加入一些生活建議。"
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
      model: GPT_MODEL,  // 使用正確的模型
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
    
    // 錯誤處理
    try {
      const response = await openai.chat.completions.create({
        model: GPT_MODEL,  // 使用正確的模型
        messages: [
          {
            role: "system",
            content: "請用友善的方式告訴用戶發生了錯誤，並給出一些建議。"
          },
          {
            role: "user",
            content: `發生錯誤：${error.message}`
          }
        ],
        temperature: 0.7
      });

      return lineClient.replyMessage(event.replyToken, {
        type: 'text',
        text: response.choices[0].message.content
      });
    } catch (gptError) {
      return lineClient.replyMessage(event.replyToken, {
        type: 'text',
        text: '抱歉，系統暫時無法提供服務，請稍後再試。'
      });
    }
  }
}

async function getWeather(city) {
  try {
    // 獲取天氣預報
    const response = await axios.get(`${CWB_API_URL}/F-C0032-001`, {
      params: {
        Authorization: CWB_API_KEY,
        locationName: city
      }
    });

    const weatherData = response.data.records.location[0];
    const elements = weatherData.weatherElement;
    
    // 整理天氣資訊
    const wx = elements.find(e => e.elementName === 'Wx').time[0].parameter.parameterName;
    const minT = elements.find(e => e.elementName === 'MinT').time[0].parameter.parameterName;
    const maxT = elements.find(e => e.elementName === 'MaxT').time[0].parameter.parameterName;
    const pop = elements.find(e => e.elementName === 'PoP').time[0].parameter.parameterName;

    return `${city}天氣預報：
天氣狀況：${wx}
溫度：${minT}°C - ${maxT}°C
降雨機率：${pop}%`;

  } catch (error) {
    console.error('獲取天氣資訊失敗:', error);
    return '抱歉，無法獲取天氣資訊。';
  }
}

// 错误处理中间件
app.use((err, req, res, next) => {
  console.error('Error:', err);
  res.status(500).json({ error: 'Internal Server Error' });
});

// 启动服务器
app.listen(process.env.PORT || 3000, () => {
  console.log('服务器已启动');
});