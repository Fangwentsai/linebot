# Firebase 憑證設置指南

為了讓LINE Bot能夠正常連接到Firebase服務，您需要設置正確的Firebase服務帳戶憑證。根據環境不同，有兩種設置方式。

## 本地開發環境設置

### 1. 獲取Firebase服務帳戶密鑰

1. 登錄到 [Firebase控制台](https://console.firebase.google.com/)
2. 選擇您的專案 "linebot-jesse14"
3. 點擊左側導航欄的 ⚙️ (設置) 圖標，然後選擇 "專案設置"
4. 切換到 "服務帳戶" 標籤
5. 點擊 "產生新的私鑰" 按鈕
6. 保存下載的JSON文件

### 2. 放置憑證文件

1. 將下載的JSON文件重命名為 `firebase-credentials.json`
2. 將該文件放在專案根目錄 (與 app.js 同一層級)
3. 確保文件格式正確 - 您可以參考 `firebase-credentials.example.json` 作為參考

### 3. 驗證憑證

在專案根目錄執行以下命令來驗證憑證是否有效：

```bash
node -e "try { const creds = require('./firebase-credentials.json'); console.log('憑證檔案有效'); } catch (e) { console.error('憑證檔案無效:', e.message); }"
```

如果一切正常，應該會顯示 "憑證檔案有效"。

## 部署環境設置 (Render, Heroku 等)

在部署環境中，不建議使用文件來存儲敏感憑證。相反，應該使用環境變量。

### 1. 獲取Firebase服務帳戶密鑰

按照上述本地開發環境的步驟1獲取Firebase服務帳戶密鑰JSON文件。

### 2. 設置環境變量

1. 將整個JSON文件的內容複製為單行文本（移除所有換行符）
   - 在macOS/Linux，可以使用命令：`cat firebase-credentials.json | tr -d '\n\r'`
   - 在Windows，可以使用PowerShell：`(Get-Content firebase-credentials.json -Raw).Replace("\r\n", "").Replace("\n", "")`

2. 在您的部署平台上設置環境變量：
   - 變量名稱：`FIREBASE_CREDENTIALS`
   - 變量值：上一步產生的單行JSON文本

#### Render平台設置步驟

1. 登錄到Render儀表板
2. 選擇您的Web Service
3. 點擊 "Environment" 標籤
4. 點擊 "Add Environment Variable"
5. 名稱輸入：`FIREBASE_CREDENTIALS`
6. 值輸入：您的單行JSON文本
7. 點擊 "Save Changes"
8. 重新部署您的服務

### 3. 確認設置

部署完成後，查看日志確認是否有"從環境變量初始化Firebase"和"Firebase初始化成功"的訊息。

## 重要注意事項

- 請不要將 `firebase-credentials.json` 提交到Git版本控制系統中
- 該文件已被添加到 .gitignore 中以防止意外提交
- 在本地開發環境使用文件，在部署環境使用環境變量是最佳實踐
- 您的應用程序已經更新為優先使用環境變量，如果沒有環境變量，則回退到使用文件 