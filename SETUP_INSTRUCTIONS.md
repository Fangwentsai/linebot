# Firebase 憑證設置指南

為了讓LINE Bot能夠正常連接到Firebase服務，您需要設置正確的Firebase服務帳戶憑證。請按照以下步驟操作：

## 1. 獲取Firebase服務帳戶密鑰

1. 登錄到 [Firebase控制台](https://console.firebase.google.com/)
2. 選擇您的專案 "linebot-jesse14"
3. 點擊左側導航欄的 ⚙️ (設置) 圖標，然後選擇 "專案設置"
4. 切換到 "服務帳戶" 標籤
5. 點擊 "產生新的私鑰" 按鈕
6. 保存下載的JSON文件

## 2. 放置憑證文件

1. 將下載的JSON文件重命名為 `firebase-credentials.json`
2. 將該文件放在專案根目錄 (與 app.js 同一層級)
3. 確保文件格式正確 - 您可以參考 `firebase-credentials.example.json` 作為參考

## 3. 驗證憑證

在專案根目錄執行以下命令來驗證憑證是否有效：

```bash
node -e "try { const creds = require('./firebase-credentials.json'); console.log('憑證檔案有效'); } catch (e) { console.error('憑證檔案無效:', e.message); }"
```

如果一切正常，應該會顯示 "憑證檔案有效"。

## 重要注意事項

- 請不要將 `firebase-credentials.json` 提交到Git版本控制系統中
- 該文件已被添加到 .gitignore 中以防止意外提交
- 每個開發環境和部署環境都需要獨立設置此文件 