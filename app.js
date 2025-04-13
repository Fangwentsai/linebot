require('dotenv').config();
const express = require('express');
const line = require('@line/bot-sdk');
const OpenAI = require('openai');
const axios = require('axios');
const https = require('https');
const { LOCATION_MAPPING, DISTRICT_ALIASES, CITY_ALIASES } = require('./locationMapping');

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
async function getWeatherForecast(input) {
  try {
    // 解析輸入的地區名稱
    const location = parseLocation(input);
    
    if (!location.city) {
      throw new Error(`抱歉，無法識別地區 "${input}"`);
    }

    const cityData = LOCATION_MAPPING[location.city];
    if (!cityData) {
      throw new Error(`抱歉，目前不支援 ${location.city} 的天氣查詢`);
    }

    // 改用 F-D0047-093 API
    const response = await axios.get('https://opendata.cwa.gov.tw/api/v1/rest/datastore/F-D0047-093', {
      params: {
        Authorization: process.env.CWB_API_KEY,
        locationId: cityData.id,
        elementName: '溫度,天氣現象,降雨機率,相對濕度,舒適度',
        format: 'JSON'
      },
      headers: {
        'accept': 'application/json'
      }
    });

    if (!response.data.success) {
      throw new Error('API 請求失敗');
    }

    const locations = response.data.records.locations[0].location;
    let targetLocation;

    // 如果有指定區域，找到對應的區域資料
    if (location.district) {
      const fullDistrictName = cityData.districts[location.district];
      targetLocation = locations.find(loc => loc.locationName === fullDistrictName);
      if (!targetLocation) {
        throw new Error(`找不到 ${location.district} 的天氣資料`);
      }
    } else {
      // 如果只有城市名，使用第一個區域的資料
      targetLocation = locations[0];
    }

    const weatherElements = targetLocation.weatherElement;
    
    // 取得各項天氣要素
    const temp = weatherElements.find(e => e.elementName === '溫度');
    const weather = weatherElements.find(e => e.elementName === '天氣現象');
    const pop = weatherElements.find(e => e.elementName === '降雨機率');
    const humidity = weatherElements.find(e => e.elementName === '相對濕度');
    const comfort = weatherElements.find(e => e.elementName === '舒適度');

    // 取得最新的預報資料
    const currentTime = temp.time[0];
    
    // 格式化天氣數據
    return {
      location: targetLocation.locationName,
      forecast: [{
        period: `${new Date(currentTime.startTime).toLocaleString('zh-TW')} 至 ${new Date(currentTime.endTime).toLocaleString('zh-TW')}`,
        temperature: temp.time[0].elementValue[0].value,
        weather: weather.time[0].elementValue[0].value,
        pop: pop ? pop.time[0].elementValue[0].value : '無資料',
        humidity: humidity.time[0].elementValue[0].value,
        comfort: comfort.time[0].elementValue[0].value
      }]
    };
  } catch (error) {
    console.error('獲取天氣預報失敗:', error);
    if (error.message.includes('找不到') || error.message.includes('無法識別')) {
      return {
        error: true,
        message: `抱歉，我無法提供${input}的天氣資訊。不過，我可以協助查詢其他地區的天氣。

您可以試著這樣提問：
- 直接說地區名：中和天氣？
- 完整地區名：中和區天氣
- 詢問方式：淡水會不會下雨？
- 簡單提問：新莊氣溫

請告訴我您想查詢的其他地區，我將很樂意幫助您！`
      };
    }
    throw error;
  }
}

// 定義關鍵字列表
const WEATHER_KEYWORDS = ['天氣', '氣溫', '下雨', '會不會雨', '天氣如何', '氣象'];

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
    return Promise.resolve(null);
  }

  const userInput = event.message.text;
  
  // 檢查是否為天氣相關查詢
  if (isWeatherQuery(userInput)) {
    try {
      const weatherData = await getWeatherForecast(userInput);
      
      // 如果有錯誤訊息，直接回傳友善提示
      if (weatherData.error) {
        return lineClient.replyMessage(event.replyToken, {
          type: 'text',
          text: weatherData.message
        });
      }

      // 正常回傳天氣資訊
      const forecast = weatherData.forecast[0];
      return lineClient.replyMessage(event.replyToken, {
        type: 'text',
        text: `${weatherData.location}天氣預報：\n` +
              `時間：${forecast.period}\n` +
              `天氣狀況：${forecast.weather}\n` +
              `溫度：${forecast.temperature}°C\n` +
              `降雨機率：${forecast.pop}%\n` +
              `相對濕度：${forecast.humidity}%\n` +
              `舒適度：${forecast.comfort}`
      });
    } catch (error) {
      console.error('處理天氣查詢時發生錯誤:', error);
      return lineClient.replyMessage(event.replyToken, {
        type: 'text',
        text: '抱歉，取得天氣資訊時發生錯誤，請稍後再試。'
      });
    }
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
        content: userInput
      }
    ],
    temperature: 0.7
  });

  return lineClient.replyMessage(event.replyToken, {
    type: 'text',
    text: response.choices[0].message.content
  });
}

// 判斷是否為天氣查詢的函數
function isWeatherQuery(text) {
  const weatherKeywords = ['天氣', '氣溫', '溫度', '下雨', '降雨', '濕度', '會不會雨'];
  return weatherKeywords.some(keyword => text.includes(keyword));
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

// 地區名稱處理函數
function parseLocation(input) {
  // 移除所有空格
  input = input.trim();
  
  let cityName = null;
  let districtName = null;

  // 1. 先檢查完整城市名稱
  for (const [city, data] of Object.entries(LOCATION_MAPPING)) {
    if (input.includes(city)) {
      cityName = city;
      break;
    }
  }

  // 2. 如果沒找到完整城市名，檢查別名
  if (!cityName) {
    for (const [alias, city] of Object.entries(CITY_ALIASES)) {
      if (input.includes(alias)) {
        cityName = city;
        break;
      }
    }
  }

  // 3. 尋找地區名稱
  if (cityName) {
    const cityData = LOCATION_MAPPING[cityName];
    // 先檢查完整地區名（包含「區」字）
    for (const district of Object.keys(cityData.districts)) {
      if (input.includes(district)) {
        districtName = district;
        break;
      }
    }

    // 如果沒找到完整地區名，檢查別名
    if (!districtName) {
      for (const [alias, district] of Object.entries(DISTRICT_ALIASES)) {
        if (input.includes(alias)) {
          // 確認該區域確實屬於這個城市
          if (cityData.districts[district]) {
            districtName = district;
            break;
          }
        }
      }
    }
  } else {
    // 4. 如果沒有找到城市名，嘗試從地區名反推
    for (const [alias, district] of Object.entries(DISTRICT_ALIASES)) {
      if (input.includes(alias) || input.includes(district)) {
        // 找出這個地區屬於哪個城市
        for (const [city, data] of Object.entries(LOCATION_MAPPING)) {
          if (data.districts[district]) {
            cityName = city;
            districtName = district;
            break;
          }
        }
        if (cityName) break;
      }
    }
  }

  return {
    city: cityName,
    district: districtName
  };
}