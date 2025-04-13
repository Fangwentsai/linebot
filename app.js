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

    console.log('開始查詢天氣:', {
      city: locationInfo.city,
      district: locationInfo.district
    });

    const response = await axios.get('https://opendata.cwa.gov.tw/api/v1/rest/datastore/F-C0032-001', {
      params: {
        Authorization: process.env.CWB_API_KEY,
        locationName: locationInfo.city,
        format: 'JSON'
      }
    });

    if (!response.data?.success || response.data.success !== 'true') {
      throw new Error('API 請求失敗');
    }

    const locations = response.data.records.location;
    const targetLocation = locations.find(loc => loc.locationName === locationInfo.city);

    if (!targetLocation) {
      throw new Error(`找不到 ${locationInfo.city} 的天氣資料`);
    }

    const weatherElements = targetLocation.weatherElement;
    const timeInfo = weatherElements[0].time[0];
    
    // 整理天氣數據
    const weatherData = {
      locationName: locationInfo.district ? 
        `${locationInfo.city}${locationInfo.district}` : 
        locationInfo.city,
      startTime: timeInfo.startTime,
      endTime: timeInfo.endTime,
      description: weatherElements.find(e => e.elementName === 'Wx')?.time[0]?.parameter?.parameterName,
      rainProb: weatherElements.find(e => e.elementName === 'PoP')?.time[0]?.parameter?.parameterName,
      minTemp: weatherElements.find(e => e.elementName === 'MinT')?.time[0]?.parameter?.parameterName,
      maxTemp: weatherElements.find(e => e.elementName === 'MaxT')?.time[0]?.parameter?.parameterName,
      comfort: weatherElements.find(e => e.elementName === 'CI')?.time[0]?.parameter?.parameterName
    };

    // 隨機選擇一種回應風格
    const styles = ['formal', 'casual', 'trendy'];
    const randomStyle = styles[Math.floor(Math.random() * styles.length)];
    
    // 使用對應的模板生成回應
    return RESPONSE_TEMPLATES[randomStyle](weatherData);

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
- 台北市天氣
- 新北市天氣
- 桃園市天氣`;
  }
}

// 定義關鍵字列表
const WEATHER_KEYWORDS = ['天氣', '氣溫', '下雨', '會不會雨', '天氣如何', '氣象'];

// 定義天氣相關的問候語和建議
const WEATHER_GREETINGS = {
  // 依照溫度範圍
  temperature: {
    cold: {
      greetings: [
        "今天真的有夠冷der～要注意保暖喔！🧣",
        "天氣涼涼的，記得多穿一點～",
        "寒流來襲，要穿暖暖的出門！",
        "這麼冷的天，要好好照顧自己哦 🤗"
      ],
      tips: [
        "建議穿上厚外套再出門",
        "要記得戴圍巾手套喔",
        "可以帶個暖暖包在身上",
        "多喝點熱飲暖暖身子"
      ]
    },
    mild: {
      greetings: [
        "今天天氣舒服宜人呢！",
        "這種天氣最適合出門玩啦～",
        "天氣真不錯，心情也好好！",
        "這溫度真的超級舒服的～"
      ],
      tips: [
        "很適合出門走走呢",
        "可以約朋友出去踏青",
        "是個適合運動的好天氣",
        "記得多呼吸新鮮空氣"
      ]
    },
    hot: {
      greetings: [
        "哇～今天熱死了啦！☀️",
        "這天氣熱到快融化了啦～",
        "今天太陽好大，要小心中暑喔",
        "熱熱的天氣要多補充水分～"
      ],
      tips: [
        "記得帶把傘遮陽",
        "多喝水避免中暑",
        "防曬工作要做好",
        "可以帶個小電扇出門"
      ]
    }
  },
  
  // 依照天氣現象
  weather: {
    sunny: {
      emoji: "☀️",
      descriptions: [
        "陽光普照的好天氣",
        "晴朗舒適的一天",
        "陽光燦爛真美好",
        "充滿活力的晴天"
      ]
    },
    cloudy: {
      emoji: "☁️",
      descriptions: [
        "悠閒的多雲天",
        "雲朵飄飄的天氣",
        "涼爽舒適的雲天",
        "溫和的多雲天氣"
      ]
    },
    rainy: {
      emoji: "🌧",
      descriptions: [
        "下雨天也要保持好心情",
        "雨天記得帶把傘喔",
        "濕濕的雨天要小心",
        "雨天路滑要注意安全"
      ]
    }
  },
  
  // 時段問候
  timeGreetings: {
    morning: [
      "早安啊！來看看今天的天氣～",
      "早起的鳥兒有蟲吃，來查查天氣吧！",
      "今天又是嶄新的一天，天氣如何呢？",
      "早安！先看看天氣再出門吧～"
    ],
    afternoon: [
      "午安～看看下午的天氣預報！",
      "吃飽飯了嗎？來看看天氣預報～",
      "下午好！天氣報報來囉！",
      "午安安～帶你看看天氣狀況！"
    ],
    evening: [
      "晚安～來看看明天要準備什麼衣服吧！",
      "晚上好！明天的天氣會如何呢？",
      "夜晚了～來查查明天的天氣吧！",
      "晚安囉！先看看明天的天氣預報～"
    ]
  }
};

// 修改回覆模板
const RESPONSE_TEMPLATES = {
  formal: (data) => {
    const temp = parseInt(data.maxTemp);
    const tempType = temp < 20 ? 'cold' : temp > 28 ? 'hot' : 'mild';
    const weatherType = data.description.includes('雨') ? 'rainy' : 
                       data.description.includes('晴') ? 'sunny' : 'cloudy';
    const hour = new Date(data.startTime).getHours();
    const timeType = hour < 12 ? 'morning' : hour < 18 ? 'afternoon' : 'evening';

    return `親愛的朋友您好：

${WEATHER_GREETINGS.timeGreetings[timeType][Math.floor(Math.random() * 4)]}

${data.locationName}天氣預報：
預報時段：${data.startTime} 至 ${data.endTime}
氣溫範圍：${data.minTemp}°C 至 ${data.maxTemp}°C
天氣狀況：${WEATHER_GREETINGS.weather[weatherType].emoji} ${data.description}
降雨機率：${data.rainProb}%
體感溫度：${data.comfort}

貼心提醒：${WEATHER_GREETINGS.temperature[tempType].tips[Math.floor(Math.random() * 4)]}
祝您有個愉快的一天！

資料來源：中央氣象署`;
  },

  casual: (data) => {
    const temp = parseInt(data.maxTemp);
    const tempType = temp < 20 ? 'cold' : temp > 28 ? 'hot' : 'mild';
    const weatherType = data.description.includes('雨') ? 'rainy' : 
                       data.description.includes('晴') ? 'sunny' : 'cloudy';

    return `${WEATHER_GREETINGS.temperature[tempType].greetings[Math.floor(Math.random() * 4)]}

${data.locationName}今天的天氣是：
${WEATHER_GREETINGS.weather[weatherType].descriptions[Math.floor(Math.random() * 4)]}

🕐 時間：${data.startTime.split(' ')[1]} - ${data.endTime.split(' ')[1]}
🌡 溫度：${data.minTemp}°C 到 ${data.maxTemp}°C
${WEATHER_GREETINGS.weather[weatherType].emoji} 天氣：${data.description}
☔️ 降雨機率：${data.rainProb}% ${parseInt(data.rainProb) > 30 ? '（記得帶傘喔！）' : '（應該不會下雨啦）'}
😊 體感：${data.comfort}

小提醒：${WEATHER_GREETINGS.temperature[tempType].tips[Math.floor(Math.random() * 4)]}

⚡️ 資料來源：中央氣象署`;
  },

  trendy: (data) => {
    const temp = parseInt(data.maxTemp);
    const tempType = temp < 20 ? 'cold' : temp > 28 ? 'hot' : 'mild';
    const weatherType = data.description.includes('雨') ? 'rainy' : 
                       data.description.includes('晴') ? 'sunny' : 'cloudy';

    return `${WEATHER_GREETINGS.temperature[tempType].greetings[Math.floor(Math.random() * 4)]}

${WEATHER_GREETINGS.weather[weatherType].emoji} ${data.locationName}天氣懶人包 ${WEATHER_GREETINGS.weather[weatherType].emoji}

⏰ ${data.startTime.split(' ')[1].slice(0, 5)} - ${data.endTime.split(' ')[1].slice(0, 5)}
🌡 溫度：${data.minTemp}-${data.maxTemp}°C
${WEATHER_GREETINGS.weather[weatherType].emoji} 天氣：${data.description}
☔️ 降雨機率：${data.rainProb}% ${parseInt(data.rainProb) > 30 ? '（快拿傘啦！）' : '（暫時不用擔心啦）'}
😊 體感：${data.comfort}

小建議：${WEATHER_GREETINGS.temperature[tempType].tips[Math.floor(Math.random() * 4)]}

#${data.locationName}天氣 #${data.description} #${data.comfort}
⚡️ Powered by 中央氣象署`;
  }
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