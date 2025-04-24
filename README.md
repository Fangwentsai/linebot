# 晶璽健康 Line聊天機器人

這是一個為晶璽健康（JH Health）開發的Line聊天機器人，專門提供保健品諮詢和推薦服務。

## 功能特點

- 基於網站產品數據提供精準的保健品推薦
- 根據用戶健康需求和症狀給出相應建議
- 使用OpenAI的GPT模型提供專業、自然的對話體驗
- 自動爬取晶璽健康網站最新產品資訊

## 系統需求

- Node.js 14.x 或更高版本
- Python 3.8 或更高版本 (用於爬蟲功能)
- 有效的Line Channel (Messaging API)
- OpenAI API 密鑰

## 安裝步驟

1. 克隆此專案:
```
git clone [repository_url]
cd linebot_chatgpt
```

2. 安裝Node.js依賴:
```
npm install
```

3. 安裝Python依賴:
```
pip install requests beautifulsoup4
```

4. 創建環境變數文件`.env`並填入以下內容:
```
LINE_CHANNEL_SECRET=your_line_channel_secret
LINE_CHANNEL_ACCESS_TOKEN=your_line_channel_access_token
OPENAI_API_KEY=your_openai_api_key
```

## 使用方法

1. 爬取最新產品資訊:
```
python jh_health_scraper.py
```
這將創建或更新`jh_health_products.json`文件，其中包含所有產品信息。

2. 啟動Line Bot服務器:
```
npm start
```
或者使用開發模式:
```
npm run dev
```

3. 設置Line webhook URL為:
```
https://your-server-domain/linebot/webhook
```

## 開發和定制

### 添加新的產品關鍵詞

在`app.js`文件中找到`HEALTH_KEYWORDS`數組，並添加新的關鍵詞：

```javascript
const HEALTH_KEYWORDS = [
  // 在這裡添加新關鍵詞
  '新產品名稱', '新症狀', '新功效'
];
```

### 修改爬蟲邏輯

如果網站結構發生變化，您可能需要調整`jh_health_scraper.py`中的爬蟲邏輯。主要需要關注的函數有：

- `extract_product_links_from_category`: 從分類頁面提取產品鏈接
- `extract_product_info`: 從產品頁面提取產品信息

### 自定義回覆模板

您可以在`getProductRecommendation`函數中修改系統提示詞來自定義機器人的回覆風格。

## 錯誤排除

- **產品數據無法載入**: 檢查`jh_health_products.json`文件是否存在且格式正確。如果爬蟲失敗，系統會使用`sample_products.json`作為備用數據。

- **Line Bot無法連接**: 確保LINE_CHANNEL_SECRET和LINE_CHANNEL_ACCESS_TOKEN設置正確。

- **OpenAI API錯誤**: 檢查OPENAI_API_KEY是否有效，以及API用量是否超限。

## 授權信息

此專案僅供晶璽健康內部使用，未經授權不得用於商業目的。
