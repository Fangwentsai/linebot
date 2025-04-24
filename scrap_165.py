#!/usr/bin/env python3
# -*- coding: utf-8 -*-

import os
import json
import requests
from bs4 import BeautifulSoup
import firebase_admin
from firebase_admin import credentials
from firebase_admin import firestore
from datetime import datetime
import time
import random
from dotenv import load_dotenv

# 加载环境变量
load_dotenv()

def initialize_firebase():
    """初始化Firebase连接"""
    try:
        # 首先尝试从环境变量获取凭证
        if os.environ.get('FIREBASE_CREDENTIALS'):
            cred_dict = json.loads(os.environ.get('FIREBASE_CREDENTIALS'))
            cred = credentials.Certificate(cred_dict)
        # 如果环境变量不存在，则尝试从JSON文件加载
        else:
            cred = credentials.Certificate('firebase-credentials.json')
        
        # 初始化Firebase应用（如果尚未初始化）
        if not firebase_admin._apps:
            firebase_admin.initialize_app(cred)
        
        # 获取Firestore客户端
        db = firestore.client()
        print("Firebase初始化成功")
        return db
    except Exception as e:
        print(f"Firebase初始化失败: {e}")
        return None

def scrape_165_cases():
    """从165dashboard.tw抓取诈骗案例摘要"""
    url = "https://165dashboard.tw/city-case-summary"
    headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
    }
    
    try:
        response = requests.get(url, headers=headers)
        response.raise_for_status()  # 如果请求返回4xx或5xx状态码，抛出异常
        
        soup = BeautifulSoup(response.text, 'html.parser')
        
        # 找到包含案例摘要的表格
        cases = []
        table = soup.find('table', class_='table-outline')
        
        if table:
            rows = table.find_all('tr')[1:]  # 跳过表头
            
            for row in rows:
                cells = row.find_all('td')
                if len(cells) >= 4:
                    case = {
                        'date': cells[0].text.strip(),
                        'location': cells[1].text.strip(),
                        'method': cells[2].text.strip(),
                        'summary': cells[3].text.strip(),
                        'keywords': extract_keywords(cells[3].text.strip()),
                        'timestamp': datetime.now().isoformat()
                    }
                    cases.append(case)
        
        return cases
    except requests.exceptions.RequestException as e:
        print(f"抓取数据失败: {e}")
        return []

def extract_keywords(text):
    """从案例摘要中提取关键词"""
    # 常见诈骗关键词列表
    common_scam_keywords = [
        '投资', '博彩', '赌博', '中奖', '退款', '退税', '刷单', '兼职', 
        '网购', '网络购物', '交友', '贷款', '信用卡', '银行', '冒充', 
        '公检法', '客服', '验证码', '短信', '链接', '点击', '下载', 
        '注册', '登录', '密码', '社交媒体', '社交软件', '微信', '支付宝',
        '转账', '汇款', '红包', '个人资料', '身份证', '银行卡', 
        '解冻', '冻结', '安全账户', '虚拟货币', '比特币'
    ]
    
    # 从文本中提取关键词
    keywords = []
    for keyword in common_scam_keywords:
        if keyword in text:
            keywords.append(keyword)
    
    return keywords

def save_cases_to_firebase(db, cases):
    """将案例保存到Firebase数据库"""
    if not db or not cases:
        return False
    
    try:
        # 获取案例集合引用
        collection_ref = db.collection('fraud_cases')
        
        # 计数器，记录新增和更新的案例数
        new_count = 0
        updated_count = 0
        
        for case in cases:
            # 使用日期和位置创建唯一ID，避免重复
            doc_id = f"{case['date']}_{case['location']}_{hash(case['summary']) % 10000}"
            
            # 检查文档是否已存在
            doc_ref = collection_ref.document(doc_id)
            doc = doc_ref.get()
            
            if not doc.exists:
                # 如果文档不存在，创建新文档
                doc_ref.set(case)
                new_count += 1
            else:
                # 如果已存在，更新文档
                doc_ref.update(case)
                updated_count += 1
                
            # 添加随机延迟，避免请求过于频繁
            time.sleep(random.uniform(0.5, 1.5))
        
        print(f"成功添加 {new_count} 个新案例，更新 {updated_count} 个现有案例")
        return True
    except Exception as e:
        print(f"保存到Firebase失败: {e}")
        return False

def search_similar_cases(db, query_keywords, limit=5):
    """根据关键词搜索相似案例"""
    if not db or not query_keywords:
        return []
    
    try:
        results = []
        collection_ref = db.collection('fraud_cases')
        
        # 遍历每个关键词进行查询
        for keyword in query_keywords:
            # 查询关键词列表中包含特定关键词的文档
            query = collection_ref.where('keywords', 'array_contains', keyword).limit(limit)
            docs = query.stream()
            
            # 将结果添加到列表中
            for doc in docs:
                case_data = doc.to_dict()
                # 检查结果是否已经在列表中（避免重复）
                if not any(result['summary'] == case_data['summary'] for result in results):
                    results.append(case_data)
        
        # 如果结果数量超过限制，只返回前limit个
        if len(results) > limit:
            results = results[:limit]
            
        return results
    except Exception as e:
        print(f"搜索案例失败: {e}")
        return []

def main():
    """主函数"""
    print("开始抓取165诈骗案例...")
    
    # 初始化Firebase
    db = initialize_firebase()
    if not db:
        print("Firebase初始化失败，程序退出")
        return
    
    # 抓取案例
    cases = scrape_165_cases()
    if not cases:
        print("未能抓取到案例数据，程序退出")
        return
    
    print(f"成功抓取 {len(cases)} 个案例")
    
    # 保存到Firebase
    success = save_cases_to_firebase(db, cases)
    if success:
        print("数据已成功保存到Firebase")
    else:
        print("保存数据失败")
    
    # 示例：搜索相似案例
    print("\n搜索示例:")
    sample_keywords = ['投资', '微信']
    print(f"搜索关键词: {sample_keywords}")
    similar_cases = search_similar_cases(db, sample_keywords, limit=3)
    
    if similar_cases:
        print(f"找到 {len(similar_cases)} 个相关案例:")
        for i, case in enumerate(similar_cases, 1):
            print(f"\n案例 {i}:")
            print(f"日期: {case['date']}")
            print(f"地点: {case['location']}")
            print(f"诈骗手法: {case['method']}")
            print(f"案例摘要: {case['summary']}")
            print(f"关键词: {', '.join(case['keywords'])}")
    else:
        print("未找到相关案例")

if __name__ == "__main__":
    main() 