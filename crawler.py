import time
import os
from selenium import webdriver
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.chrome.service import Service
try:
    from webdriver_manager.chrome import ChromeDriverManager
except ImportError:
    print("找不到webdriver_manager套件，正在嘗試安裝...")
    import subprocess
    subprocess.check_call(["pip3", "install", "webdriver-manager"])
    from webdriver_manager.chrome import ChromeDriverManager
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC
from bs4 import BeautifulSoup
try:
    import pandas as pd
except ImportError:
    print("找不到pandas套件，正在嘗試安裝...")
    import subprocess
    subprocess.check_call(["pip3", "install", "pandas"])
    import pandas as pd
import json

# 設置文件保存路徑為linebot_chatgpt根目錄
current_dir = os.getcwd()
# 檢查當前目錄是否已經是linebot_chatgpt目錄
if os.path.basename(current_dir) != 'linebot_chatgpt':
    # 如果不是，嘗試找到linebot_chatgpt目錄
    linebot_dir = os.path.join(current_dir, 'linebot_chatgpt')
    if os.path.exists(linebot_dir) and os.path.isdir(linebot_dir):
        save_dir = linebot_dir
    else:
        # 如果找不到，就使用當前目錄
        save_dir = current_dir
else:
    save_dir = current_dir

# 修改文件路徑為JSON格式
file_path = os.path.join(save_dir, '165dashboard_yesterday_data.json')

print(f"文件將保存在: {file_path}")

# 設置Selenium - 使用webdriver_manager自動管理驅動程式
chrome_options = Options()
chrome_options.add_argument('--headless')  # 無界面模式
chrome_options.add_argument('--disable-gpu')
chrome_options.add_argument('--no-sandbox')
chrome_options.add_argument('--window-size=1920,1080')  # 設置窗口大小
chrome_options.add_argument('--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36')  # 添加user-agent

try:
    # 使用webdriver_manager自動安裝和配置ChromeDriver
    service = Service(ChromeDriverManager().install())
    driver = webdriver.Chrome(service=service, options=chrome_options)
    
    # 訪問網站
    url = "https://165dashboard.tw/city-case-summary"
    print(f"正在訪問: {url}")
    driver.get(url)
    
    # 輸出頁面標題，確認頁面是否加載
    print(f"頁面標題: {driver.title}")
    
    # 開始模擬滾動頁面以加載更多內容...
    print("開始模擬滾動頁面以加載更多內容...")
    # 模擬滾動頁面以加載更多內容
    scroll_pause_time = 1.5  # 每次滾動後暫停時間
    screen_height = driver.execute_script("return window.screen.height;")
    i = 1
    records_count = 0
    last_height = driver.execute_script("return document.body.scrollHeight")

    # 滾動直到達到目標記錄數或頁面底部
    while records_count < 200:
        # 滾動到頁面底部
        driver.execute_script(f"window.scrollTo(0, {screen_height * i});")
        i += 1
        time.sleep(scroll_pause_time)
        
        # 檢查是否到達頁面底部
        new_height = driver.execute_script("return document.body.scrollHeight")
        if new_height == last_height:
            # 嘗試再滾動一次確認是否真的到底
            driver.execute_script("window.scrollTo(0, document.body.scrollHeight);")
            time.sleep(scroll_pause_time * 2)
            new_height = driver.execute_script("return document.body.scrollHeight")
            if new_height == last_height:
                print("已到達頁面底部，無法加載更多內容")
                break
        
        last_height = new_height
        
        # 計算目前找到的記錄數（可以基於某些元素計數）
        try:
            # 這裡使用一個可能包含記錄的選擇器，需要根據實際頁面調整
            records = driver.find_elements(By.CSS_SELECTOR, "div.record-item, tr.data-row, div.case-item")
            records_count = len(records)
            print(f"已加載 {records_count} 筆記錄")
        except Exception as e:
            print(f"計算記錄數時發生錯誤: {str(e)}")
        
        # 如果超過10次滾動仍未找到足夠記錄，可能需要調整策略
        if i > 20:
            print("已滾動多次但未找到足夠記錄，停止滾動")
            break

    print(f"完成頁面滾動，共加載約 {records_count} 筆記錄")
    
    # 保存頁面源碼以供分析
    with open(os.path.join(save_dir, "page_source.html"), "w", encoding="utf-8") as f:
        f.write(driver.page_source)
    print(f"已保存頁面源碼到 {os.path.join(save_dir, 'page_source.html')}")
    
    # 使用Beautiful Soup解析頁面來提取數據
    soup = BeautifulSoup(driver.page_source, 'html.parser')
    
    # 收集所有案例數據
    matching_data = []
    
    # 嘗試找出表格或列表容器
    tables = soup.find_all('table')
    print(f"找到 {len(tables)} 個表格")
    
    if tables:
        # 假設找到了表格，嘗試提取行數據
        for table in tables:
            rows = table.find_all('tr')
            print(f"表格中找到 {len(rows)} 行")
            
            # 跳過表頭行
            for row in rows[1:]:
                cells = row.find_all('td')
                if len(cells) >= 3:  # 確保至少有3個單元格
                    date = cells[0].text.strip() if cells[0].text else "無日期"
                    title = cells[1].text.strip() if cells[1].text else "無標題"
                    content = cells[2].text.strip() if cells[2].text else "無內容"
                    
                    matching_data.append({
                        "日期": date,
                        "標題": title,
                        "內容": content
                    })
    else:
        # 如果沒有表格，嘗試查找其他可能的容器
        containers = soup.select('div.case-item, div.record-item, div.data-row')
        print(f"找到 {len(containers)} 個可能的數據容器")
        
        if not containers:
            # 如果仍然找不到，嘗試尋找有規律的div結構
            containers = soup.select('div.row, div.card, div.item, div.list-item')
            print(f"找到 {len(containers)} 個可能的卡片容器")
        
        for container in containers:
            date = "無日期"
            title = "無標題"
            content = "無內容"
            
            # 嘗試找日期
            date_elem = container.select_one('.date, [class*="date"], span:contains("發布"), [class*="time"]')
            if date_elem and date_elem.text.strip():
                date = date_elem.text.strip()
            
            # 嘗試找標題
            title_elem = container.select_one('h1, h2, h3, h4, .title, [class*="title"], .heading, [class*="heading"]')
            if title_elem and title_elem.text.strip():
                title = title_elem.text.strip()
            
            # 嘗試找內容
            content_elem = container.select_one('p, .content, [class*="content"], .desc, [class*="desc"], .body, [class*="body"]')
            if content_elem and content_elem.text.strip():
                content = content_elem.text.strip()
            
            matching_data.append({
                "日期": date,
                "標題": title,
                "內容": content
            })
    
    # 如果以上方法都沒有找到數據，嘗試提取所有可能是記錄的內容
    if not matching_data:
        print("嘗試提取所有可能的記錄內容...")
        # 找出所有可能包含日期的文本
        for date_text in soup.find_all(text=lambda t: "114-" in t or "113-" in t):
            parent = date_text.parent
            date = date_text.strip()
            container = parent
            # 向上查找可能的容器
            for _ in range(3):
                if container.parent:
                    container = container.parent
            
            title = "無標題"
            content = "無內容"
            
            # 嘗試在容器中找標題和內容
            for elem in container.find_all(['h1', 'h2', 'h3', 'h4', 'p', 'div']):
                text = elem.text.strip()
                if text and text != date:
                    if not title or title == "無標題":
                        title = text
                    elif not content or content == "無內容":
                        content = text
            
            matching_data.append({
                "日期": date,
                "標題": title,
                "內容": content
            })
    
    # 關閉瀏覽器
    driver.quit()
    print("瀏覽器已關閉")
    
    # 輸出結果
    if matching_data:
        # 將數據保存為JSON文件
        with open(file_path, 'w', encoding='utf-8') as json_file:
            json.dump(matching_data, json_file, ensure_ascii=False, indent=2)
        print(f"已找到 {len(matching_data)} 筆符合條件的數據，並保存至: {file_path}")
        
        # 檢查文件是否成功創建
        if os.path.exists(file_path):
            print(f"JSON文件成功創建！文件大小: {os.path.getsize(file_path)} 字節")
        else:
            print("文件創建失敗")
        
        # 顯示找到的數據（限制顯示前5筆）
        for i, item in enumerate(matching_data[:5]):
            print("="*50)
            print(f"日期: {item['日期']}")
            print(f"標題: {item['標題']}")
            print(f"內容: {item['內容'][:100]}..." if len(item['內容']) > 100 else f"內容: {item['內容']}")
        
        if len(matching_data) > 5:
            print(f"\n... 還有 {len(matching_data) - 5} 筆數據未顯示 ...")
    else:
        print("未找到任何記錄")
        # 創建一個空的JSON文件
        with open(file_path, 'w', encoding='utf-8') as json_file:
            json.dump([], json_file)
        print(f"已創建空JSON文件: {file_path}")

except Exception as e:
    print(f"發生錯誤: {str(e)}")
    # 記錄錯誤到文件
    with open(os.path.join(save_dir, "crawler_error.log"), "w", encoding="utf-8") as f:
        f.write(f"錯誤時間: {time.strftime('%Y-%m-%d %H:%M:%S')}\n")
        f.write(f"錯誤信息: {str(e)}\n")
    print(f"錯誤日誌已保存到: {os.path.join(save_dir, 'crawler_error.log')}")
