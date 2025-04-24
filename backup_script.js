/**
 * 定期備份晶璽健康產品數據的腳本
 * 使用方法: node backup_script.js
 */

const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');

// 配置
const SOURCE_FILE = 'jh_health_products.json';
const BACKUP_DIR = path.join(__dirname, 'backup');
const SAMPLE_FILE = 'sample_products.json';
const MAX_BACKUPS = 5; // 最多保留的備份數量

// 創建備份目錄（如果不存在）
if (!fs.existsSync(BACKUP_DIR)) {
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  console.log(`已創建備份目錄: ${BACKUP_DIR}`);
}

// 檢查源文件是否存在
if (!fs.existsSync(SOURCE_FILE)) {
  console.log(`源文件 ${SOURCE_FILE} 不存在，嘗試運行爬蟲...`);
  
  // 運行Python爬蟲腳本
  exec('python jh_health_scraper.py', (error, stdout, stderr) => {
    if (error) {
      console.error(`爬蟲執行錯誤: ${error.message}`);
      // 使用樣本文件作為備用
      if (fs.existsSync(SAMPLE_FILE)) {
        fs.copyFileSync(SAMPLE_FILE, SOURCE_FILE);
        console.log(`已使用樣本文件 ${SAMPLE_FILE} 作為備份源`);
        performBackup();
      } else {
        console.error('樣本文件也不存在，無法執行備份');
        process.exit(1);
      }
      return;
    }
    
    if (stderr) {
      console.error(`爬蟲輸出錯誤: ${stderr}`);
    }
    
    console.log(`爬蟲輸出: ${stdout}`);
    performBackup();
  });
} else {
  performBackup();
}

// 執行備份操作
function performBackup() {
  const now = new Date();
  const timestamp = `${now.getFullYear()}${(now.getMonth() + 1).toString().padStart(2, '0')}${now.getDate().toString().padStart(2, '0')}_${now.getHours().toString().padStart(2, '0')}${now.getMinutes().toString().padStart(2, '0')}`;
  const backupFileName = `jh_health_products_${timestamp}.json`;
  const backupPath = path.join(BACKUP_DIR, backupFileName);
  
  try {
    // 複製源文件到備份目錄
    fs.copyFileSync(SOURCE_FILE, backupPath);
    console.log(`備份成功: ${backupPath}`);
    
    // 清理舊備份
    cleanupOldBackups();
  } catch (err) {
    console.error(`備份失敗: ${err.message}`);
  }
}

// 清理舊備份文件，只保留最新的幾個
function cleanupOldBackups() {
  fs.readdir(BACKUP_DIR, (err, files) => {
    if (err) {
      console.error(`讀取備份目錄失敗: ${err.message}`);
      return;
    }
    
    // 過濾出備份文件
    const backups = files
      .filter(file => file.startsWith('jh_health_products_') && file.endsWith('.json'))
      .map(file => ({
        name: file,
        path: path.join(BACKUP_DIR, file),
        time: fs.statSync(path.join(BACKUP_DIR, file)).mtime.getTime()
      }))
      .sort((a, b) => b.time - a.time); // 按時間降序排序
    
    // 如果備份數量超過最大值，刪除最舊的
    if (backups.length > MAX_BACKUPS) {
      const toDelete = backups.slice(MAX_BACKUPS);
      toDelete.forEach(backup => {
        fs.unlinkSync(backup.path);
        console.log(`已刪除舊備份: ${backup.name}`);
      });
    }
  });
}

console.log('備份過程已啟動...'); 