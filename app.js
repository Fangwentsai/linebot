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

    // 輸出完整的 API 響應以進行調試
    console.log('API 完整響應:', JSON.stringify(response.data, null, 2));

    // 檢查基本響應結構
    if (!response.data || response.data.success !== 'true') {
      console.error('API 響應無效:', response.data);
      throw new Error('API 請求失敗');
    }

    // 檢查並獲取位置資料
    const locationsData = response.data.records?.Locations?.[0];
    if (!locationsData || !Array.isArray(locationsData.Location)) {
      console.error('無效的位置資料結構:', locationsData);
      throw new Error('無效的天氣數據格式');
    }

    console.log('城市資訊:', {
      name: locationsData.LocationsName,
      description: locationsData.DatasetDescription,
      locationCount: locationsData.Location.length
    });

    // 尋找目標地區
    let targetLocation;
    if (locationInfo.district) {
      const fullDistrictName = cityData.districts[locationInfo.district];
      console.log('搜尋地區:', {
        district: locationInfo.district,
        fullName: fullDistrictName,
        availableLocations: locationsData.Location.map(loc => loc.LocationName)
      });
      
      targetLocation = locationsData.Location.find(loc => 
        loc.LocationName === fullDistrictName
      );

      if (!targetLocation) {
        throw new Error(`找不到 ${locationInfo.district} 的天氣資料`);
      }
    } else {
      // 如果沒有指定地區，使用第一個地區的資料
      targetLocation = locationsData.Location[0];
    }

    console.log('找到的地區資料:', {
      name: targetLocation.LocationName,
      elements: targetLocation.WeatherElement?.map(e => e.ElementName)
    });

    // 取得天氣要素
    const weatherElements = targetLocation.WeatherElement;
    if (!Array.isArray(weatherElements)) {
      throw new Error('天氣要素資料格式錯誤');
    }

    // 解析天氣要素
    const elements = {
      temp: weatherElements.find(e => e.ElementName === 'T'),
      weather: weatherElements.find(e => e.ElementName === 'Wx'),
      pop: weatherElements.find(e => e.ElementName === 'PoP12h'),
      humidity: weatherElements.find(e => e.ElementName === 'RH'),
      comfort: weatherElements.find(e => e.ElementName === 'CI')
    };

    // 檢查必要的天氣要素是否存在
    if (!elements.temp?.Time?.[0] || !elements.weather?.Time?.[0]) {
      console.error('缺少必要的天氣要素:', elements);
      throw new Error('天氣數據不完整');
    }

    const currentTime = elements.temp.Time[0];
    
    // 格式化天氣資訊
    const locationName = locationInfo.district ? 
      `${locationInfo.city}${locationInfo.district}` : 
      locationInfo.city;

    const weatherInfo = `${locationName}天氣預報：
時間：${new Date(currentTime.StartTime).toLocaleString('zh-TW')} 至 ${new Date(currentTime.EndTime).toLocaleString('zh-TW')}
溫度：${elements.temp.Time[0].ElementValue[0].Value}°C
天氣：${elements.weather.Time[0].ElementValue[0].Value}
降雨機率：${elements.pop?.Time?.[0]?.ElementValue?.[0]?.Value ? elements.pop.Time[0].ElementValue[0].Value + '%' : '無資料'}
相對濕度：${elements.humidity?.Time?.[0]?.ElementValue?.[0]?.Value ? elements.humidity.Time[0].ElementValue[0].Value + '%' : '無資料'}
舒適度：${elements.comfort?.Time?.[0]?.ElementValue?.[0]?.Value || '無資料'}`;

    return weatherInfo;

  } catch (error) {
    console.error('獲取天氣預報失敗:', error);
    if (error.response) {
      console.error('API 錯誤詳情:', {
        status: error.response.status,
        data: error.response.data
      });
    }

    // 根據錯誤類型返回友善的錯誤訊息
    if (error.message.includes('找不到') || error.message.includes('無法識別')) {
      return `抱歉，我無法提供${locationInfo.district || locationInfo.city}的天氣資訊。
您可以試試：
- 直接輸入城市名：台北天氣
- 輸入完整區名：中和區天氣
- 或是其他地區：信義區天氣`;
    } else if (error.message.includes('API')) {
      return '抱歉，目前無法取得氣象資料，請稍後再試。';
    } else {
      return '抱歉，系統發生問題，請稍後再試。如果問題持續發生，請通知管理員。';
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