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
    if (!locationInfo?.city) {
      throw new Error('無法識別地區');
    }

    const cityData = LOCATION_MAPPING[locationInfo.city];
    if (!cityData) {
      throw new Error(`抱歉，目前不支援 ${locationInfo.city} 的天氣查詢`);
    }

    console.log('開始查詢天氣:', {
      city: locationInfo.city,
      district: locationInfo.district,
      id: cityData.id
    });

    // API 請求
    const response = await axios.get('https://opendata.cwa.gov.tw/api/v1/rest/datastore/' + cityData.id, {
      params: {
        Authorization: process.env.CWB_API_KEY,
        format: 'JSON',
        locationName: locationInfo.district ? cityData.districts[locationInfo.district] : '',
        elementName: 'MinT,MaxT,PoP12h,Wx,RH,CI',
        sort: 'time'
      }
    });

    // 輸出完整響應以進行調試
    console.log('API 響應結構:', {
      success: response.data?.success,
      hasRecords: !!response.data?.records,
      hasLocations: !!response.data?.records?.locations,
      locationsData: response.data?.records?.locations
    });

    // 檢查響應
    if (!response.data?.success || response.data.success !== 'true') {
      throw new Error('API 請求失敗');
    }

    // 檢查資料結構
    if (!response.data?.records?.locations) {
      console.error('無效的資料結構:', response.data);
      throw new Error('資料結構錯誤');
    }

    // 獲取地點資料
    const locationsData = response.data.records.locations;
    console.log('位置資料:', {
      count: locationsData.length,
      firstLocation: locationsData[0]
    });

    if (!Array.isArray(locationsData) || !locationsData[0]?.location) {
      throw new Error('無效的位置資料格式');
    }

    const locations = locationsData[0].location;
    console.log('可用地點:', locations.map(loc => loc.locationName));

    // 找到目標地區
    let targetLocation;
    if (locationInfo.district) {
      const fullDistrictName = cityData.districts[locationInfo.district];
      console.log('搜尋地區:', {
        searching: fullDistrictName,
        available: locations.map(loc => loc.locationName)
      });
      targetLocation = locations.find(loc => loc.locationName === fullDistrictName);
    } else {
      targetLocation = locations[0];
    }

    if (!targetLocation) {
      throw new Error(`找不到 ${locationInfo.district || locationInfo.city} 的天氣資料`);
    }

    console.log('目標地區資料:', {
      name: targetLocation.locationName,
      elements: targetLocation.weatherElement.map(e => e.elementName)
    });

    // 解析天氣資料
    const weather = {
      minTemp: targetLocation.weatherElement.find(e => e.elementName === 'MinT')?.time[0]?.elementValue[0]?.value,
      maxTemp: targetLocation.weatherElement.find(e => e.elementName === 'MaxT')?.time[0]?.elementValue[0]?.value,
      description: targetLocation.weatherElement.find(e => e.elementName === 'Wx')?.time[0]?.elementValue[0]?.value,
      rainProb: targetLocation.weatherElement.find(e => e.elementName === 'PoP12h')?.time[0]?.elementValue[0]?.value,
      humidity: targetLocation.weatherElement.find(e => e.elementName === 'RH')?.time[0]?.elementValue[0]?.value,
      comfort: targetLocation.weatherElement.find(e => e.elementName === 'CI')?.time[0]?.elementValue[0]?.value
    };

    console.log('解析到的天氣資料:', weather);

    // 取得時間資訊
    const timeInfo = targetLocation.weatherElement[0].time[0];
    if (!timeInfo?.startTime || !timeInfo?.endTime) {
      throw new Error('無法獲取時間資訊');
    }
    
    // 格式化回應
    const locationName = locationInfo.district ? 
      `${locationInfo.city}${locationInfo.district}` : 
      locationInfo.city;

    return `${locationName}天氣預報：
時間：${new Date(timeInfo.startTime).toLocaleString('zh-TW')} 至 ${new Date(timeInfo.endTime).toLocaleString('zh-TW')}
溫度：${weather.minTemp}°C ~ ${weather.maxTemp}°C
天氣：${weather.description}
降雨機率：${weather.rainProb ? weather.rainProb + '%' : '無資料'}
相對濕度：${weather.humidity ? weather.humidity + '%' : '無資料'}
舒適度：${weather.comfort || '無資料'}`;

  } catch (error) {
    console.error('天氣查詢失敗:', error);
    if (error.response) {
      console.error('API 錯誤詳情:', {
        status: error.response.status,
        data: error.response.data
      });
    }
    return `抱歉，無法取得${locationInfo.district || locationInfo.city}的天氣資訊。
您可以試試：
- 直接查詢：台北天氣
- 查詢區域：中和區天氣
- 其他地區：信義區天氣`;
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