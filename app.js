require('dotenv').config();
const express = require('express');
const line = require('@line/bot-sdk');
const OpenAI = require('openai');
const axios = require('axios');

// 定義常量
const GPT_MODEL = "gpt-4-mini";
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
    const response = await axios.get('https://opendata.cwb.gov.tw/api/v1/rest/datastore/F-C0032-001', {
      params: {
        Authorization: process.env.CWB_API_KEY,
        locationName: cityName,
        sort: 'time'
      }
    });

    if (!response.data.success) {
      throw new Error('API 請求失敗');
    }

    const location = response.data.records.location[0];
    const elements = location.weatherElement;

    const weatherData = {
      city: location.locationName,
      forecast: []
    };

    const timeIntervals = elements[0].time;
    
    timeIntervals.forEach((interval, index) => {
      const startTime = new Date(interval.startTime);
      const endTime = new Date(interval.endTime);
      
      const timeData = {
        period: `${startTime.getMonth() + 1}/${startTime.getDate()} ${startTime.getHours()}:00 - ${endTime.getMonth() + 1}/${endTime.getDate()} ${endTime.getHours()}:00`,
        wx: elements.find(e => e.elementName === 'Wx').time[index].parameter.parameterName,
        pop: elements.find(e => e.elementName === 'PoP').time[index].parameter.parameterName,
        minT: elements.find(e => e.elementName === 'MinT').time[index].parameter.parameterName,
        maxT: elements.find(e => e.elementName === 'MaxT').time[index].parameter.parameterName,
        ci: elements.find(e => e.elementName === 'CI').time[index].parameter.parameterName
      };
      
      weatherData.forecast.push(timeData);
    });

    return weatherData;
  } catch (error) {
    console.error('獲取天氣預報失敗:', error);
    throw error;
  }
}

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
    // 處理天氣查詢
    if (userMessage.includes('天氣')) {
      let city = userMessage.replace('天氣', '').trim();
      
      // 如果沒有指定城市
      if (!city) {
        const response = await openai.chat.completions.create({
          model: GPT_MODEL,
          messages: [
            {
              role: "system",
              content: `你是一個天氣助手。當用戶沒有指定具體城市時，請友善地詢問他們想查詢哪個城市的天氣。
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
      }

      // 處理台/臺的差異
      if (city.includes('台')) {
        city = city.replace('台', '臺');
      }

      // 檢查是否為有效的縣市名稱
      if (!CITIES.includes(city)) {
        const response = await openai.chat.completions.create({
          model: GPT_MODEL,
          messages: [
            {
              role: "system",
              content: `你是一個天氣助手。用戶輸入了無效的城市名稱「${city}」。請友善地告訴他正確的城市名稱格式。
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
      }

      // 獲取天氣數據
      const weatherData = await getWeatherForecast(city);
      
      // 使用 GPT 生成更自然的天氣描述
      const response = await openai.chat.completions.create({
        model: GPT_MODEL,
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
    
    try {
      const response = await openai.chat.completions.create({
        model: GPT_MODEL,
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