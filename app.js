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
async function getWeatherForecast(locationInfo) {
  try {
    // 檢查輸入是否是有效的位置信息對象
    if (!locationInfo || typeof locationInfo !== 'object') {
      console.error('Invalid locationInfo:', locationInfo);
      throw new Error('無效的位置信息');
    }

    if (!locationInfo.city) {
      throw new Error('無法識別地區');
    }

    const cityData = LOCATION_MAPPING[locationInfo.city];
    if (!cityData) {
      throw new Error(`抱歉，目前不支援 ${locationInfo.city} 的天氣查詢`);
    }

    console.log('正在查詢天氣資料:', {
      city: locationInfo.city,
      district: locationInfo.district,
      cityId: cityData.id
    });

    // API 請求
    const response = await axios.get('https://opendata.cwa.gov.tw/api/v1/rest/datastore/F-D0047-093', {
      params: {
        Authorization: process.env.CWB_API_KEY,
        locationId: cityData.id,
        locationName: locationInfo.district ? cityData.districts[locationInfo.district] : '',
        elementName: 'T,Wx,PoP12h,RH,CI',
        sort: 'time'
      },
      headers: {
        'accept': 'application/json'
      }
    });

    console.log('API 請求參數:', {
      locationId: cityData.id,
      locationName: locationInfo.district ? cityData.districts[locationInfo.district] : '',
      elementName: 'T,Wx,PoP12h,RH,CI'
    });

    // 檢查 API 響應
    if (!response.data || response.data.success !== 'true') {
      console.error('API 響應無效:', response.data);
      throw new Error('API 請求失敗');
    }

    // 檢查資料結構
    const locationsData = response.data.records?.Locations?.[0];
    if (!locationsData || !locationsData.Location) {
      console.error('無效的資料結構:', response.data);
      throw new Error('無效的天氣數據格式');
    }

    console.log('位置資料:', {
      cityName: locationsData.LocationsName,
      locationCount: locationsData.Location.length
    });

    // 尋找目標地區
    let targetLocation;
    if (locationInfo.district) {
      const fullDistrictName = cityData.districts[locationInfo.district];
      console.log('尋找地區:', {
        searchFor: fullDistrictName,
        available: locationsData.Location.map(loc => loc.LocationName)
      });
      targetLocation = locationsData.Location.find(loc => loc.LocationName === fullDistrictName);
      if (!targetLocation) {
        throw new Error(`找不到 ${locationInfo.district} 的天氣資料`);
      }
    } else {
      // 如果沒有指定地區，使用第一個地區的資料
      targetLocation = locationsData.Location[0];
    }

    console.log('目標地點資料:', {
      locationName: targetLocation.LocationName,
      hasWeatherElement: !!targetLocation.WeatherElement,
      elementCount: targetLocation.WeatherElement?.length
    });

    const weatherElements = targetLocation.WeatherElement;

    // 使用正確的天氣要素代碼進行解析
    const temp = weatherElements.find(e => e.ElementName === 'T');
    const weather = weatherElements.find(e => e.ElementName === 'Wx');
    const pop = weatherElements.find(e => e.ElementName === 'PoP12h');
    const humidity = weatherElements.find(e => e.ElementName === 'RH');
    const comfort = weatherElements.find(e => e.ElementName === 'CI');

    console.log('天氣要素:', {
      hasTemp: !!temp?.Time?.[0],
      hasWeather: !!weather?.Time?.[0],
      hasPop: !!pop?.Time?.[0],
      hasHumidity: !!humidity?.Time?.[0],
      hasComfort: !!comfort?.Time?.[0]
    });

    // 確保有必要的資料
    if (!temp?.Time?.[0] || !weather?.Time?.[0]) {
      throw new Error('天氣數據不完整');
    }

    const currentTime = temp.Time[0];
    
    // 格式化回應訊息
    const locationName = locationInfo.district ? `${locationInfo.city}${locationInfo.district}` : locationInfo.city;
    const weatherInfo = `${locationName}天氣預報：
時間：${new Date(currentTime.StartTime).toLocaleString('zh-TW')} 至 ${new Date(currentTime.EndTime).toLocaleString('zh-TW')}
溫度：${temp.Time[0].ElementValue[0].Value}°C
天氣：${weather.Time[0].ElementValue[0].Value}
降雨機率：${pop?.Time?.[0]?.ElementValue?.[0]?.Value ? pop.Time[0].ElementValue[0].Value + '%' : '無資料'}
相對濕度：${humidity?.Time?.[0]?.ElementValue?.[0]?.Value ? humidity.Time[0].ElementValue[0].Value + '%' : '無資料'}
舒適度：${comfort?.Time?.[0]?.ElementValue?.[0]?.Value || '無資料'}`;

    return weatherInfo;

  } catch (error) {
    console.error('獲取天氣預報失敗:', error);
    if (error.response) {
      console.error('API 響應錯誤:', {
        status: error.response.status,
        data: error.response.data
      });
    }
    
    // 錯誤訊息處理
    if (error.message.includes('找不到') || error.message.includes('無法識別')) {
      return `抱歉，我無法提供${locationInfo.district || locationInfo.city}的天氣資訊。
請確認地區名稱是否正確，或試試其他地區：
- 台北天氣
- 中和區天氣
- 信義區天氣`;
    } else if (error.message.includes('API')) {
      return '抱歉，氣象資料暫時無法取得，請稍後再試。';
    } else {
      return '抱歉，系統發生錯誤，請稍後再試。如果問題持續發生，請聯繫系統管理員。';
    }
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
  
  try {
    // 檢查是否是天氣相關查詢
    if (isWeatherQuery(userInput)) {
      const locationInfo = parseLocation(userInput);
      
      if (locationInfo.error) {
        // 如果有錯誤訊息，直接回傳給使用者
        return lineClient.replyMessage(event.replyToken, {
          type: 'text',
          text: locationInfo.error
        });
      }

      const weatherData = await getWeatherForecast(locationInfo);
      return lineClient.replyMessage(event.replyToken, {
        type: 'text',
        text: weatherData
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
    return lineClient.replyMessage(event.replyToken, {
      type: 'text',
      text: '抱歉，系統發生錯誤。請稍後再試。'
    });
  }
}

// 判斷是否為天氣查詢的函數
function isWeatherQuery(input) {
  const weatherKeywords = [
    '天氣', '下雨', '氣溫', '溫度', '濕度', '降雨', 
    '會不會雨', '天氣如何', '天氣怎樣',
    // 增加更多口語化表達
    '天氣ㄋ', '天氣ㄇ', '會下雨ㄇ', '會下雨嗎',
    '天氣好嗎', '天氣好ㄇ', '天氣咧', '天氣勒',
    '下雨ㄇ', '下雨嗎', '會不會下', '會不會降雨'
  ];

  return weatherKeywords.some(keyword => input.includes(keyword));
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
  // 確保 input 是字符串
  if (typeof input !== 'string') {
    console.error('Invalid input type:', typeof input, input);
    return {
      city: null,
      district: null,
      error: '抱歉，我無法理解您的輸入。請試著直接輸入地區名稱，例如：台北天氣、中和區天氣'
    };
  }

  // 擴充移除的詞彙，包含網路用語和口語表達
  const removeWords = [
    // 一般問句詞
    '嗨', '你好', '請問', '問一下', '想知道', '可以告訴我',
    '天氣', '氣溫', '溫度', '下雨', '降雨', '濕度', '會不會雨', '如何', '嗎',
    // 網路用語和口語
    '欸', '欸欸', '誒', '誒誒', '欸幫', '幫我', '幫查', '查查', '查個',
    '好ㄇ', '好嗎', '好不好', '如何', '怎樣', '咧', '勒', '啦',
    '拜託', '感恩', '感謝', 'thx', '謝謝', '感恩der', '感恩低',
    '現在', '等等', '待會', '等一下',
    '我想', '想要', '要看', '看看', '幫忙', '拜託', 
    '今天', '明天', '後天', '早上', '中午', '晚上',
    // 語氣詞
    'der', 'ㄉ', 'ㄋ', 'ㄇ', '喔', '唷', '耶', '呢', '啊', '欸', '誒',
    // 表情符號（如果有的話也會被移除）
    '😊', '😂', '🤔', '👍', '🙏'
  ];

  try {
    // 建立正則表達式，移除所有指定詞彙
    const removePattern = new RegExp(removeWords.join('|'), 'g');
    input = input.replace(removePattern, '').trim();

    // 如果清理後的輸入為空，回傳錯誤訊息
    if (!input) {
      return {
        city: null,
        district: null,
        error: '請告訴我您想查詢哪個地區的天氣喔！例如：台北天氣、中和區天氣'
      };
    }

    let cityName = null;
    let districtName = null;

    // 先檢查是否為鄉鎮市區名稱
    for (const [city, data] of Object.entries(LOCATION_MAPPING)) {
      for (const [district, fullName] of Object.entries(data.districts)) {
        if (input.includes(district)) {
          cityName = city;
          districtName = district;
          break;
        }
      }
      if (cityName) break;
    }

    // 如果沒找到，檢查別名
    if (!cityName) {
      for (const [alias, district] of Object.entries(DISTRICT_ALIASES)) {
        if (input.includes(alias)) {
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

    // 如果還是沒找到，檢查是否只有城市名
    if (!cityName) {
      // 先檢查完整城市名
      for (const city of Object.keys(LOCATION_MAPPING)) {
        if (input.includes(city)) {
          cityName = city;
          break;
        }
      }

      // 如果沒找到完整城市名，檢查別名
      if (!cityName) {
        for (const [alias, city] of Object.entries(CITY_ALIASES)) {
          if (input.includes(alias)) {
            cityName = city;
            break;
          }
        }
      }
    }

    // 如果都沒找到對應的地區，給出更友善的提示
    if (!cityName && !districtName) {
      return {
        city: null,
        district: null,
        error: `抱歉，我看不懂「${input}」是哪個地方耶！可以試試：
1. 直接說地名：台北、中和
2. 完整區名：信義區、板橋區
3. 簡單問句：中和天氣、北投區天氣`
      };
    }

    return {
      city: cityName,
      district: districtName
    };
  } catch (error) {
    console.error('Error in parseLocation:', error);
    return {
      city: null,
      district: null,
      error: '抱歉，處理您的請求時發生錯誤。請試著用更簡單的方式詢問，例如：台北天氣'
    };
  }
}