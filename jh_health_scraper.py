#!/usr/bin/env python
# -*- coding: utf-8 -*-

import requests
from bs4 import BeautifulSoup
import json
import re
import time
import os
from urllib.parse import urljoin

class JHHealthScraper:
    def __init__(self):
        self.base_url = "https://jhhealth.com.tw"
        self.headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36"
        }
        self.products = []
        self.categories = {
            "健康生技館": [
                "機能強化", 
                "順暢消化", 
                "窈窕代謝", 
                "調節體質"
            ],
            "舒壓運動館": [
                "居家運動", 
                "機能運動", 
                "按摩舒壓", 
                "其他"
            ],
            "生活用品館": [
                "居家生活", 
                "生活用品"
            ]
        }
        
    def fetch_page(self, url):
        """獲取頁面內容"""
        try:
            response = requests.get(url, headers=self.headers)
            response.raise_for_status()
            return response.text
        except Exception as e:
            print(f"獲取頁面失敗: {url}, 錯誤: {e}")
            return None
    
    def extract_product_links_from_category(self, category, subcategory):
        """從分類頁面提取產品鏈接"""
        links = []
        category_slug = self._get_category_slug(category, subcategory)
        if not category_slug:
            return links
            
        url = f"{self.base_url}/product-category/{category_slug}/"
        html = self.fetch_page(url)
        if not html:
            return links
            
        soup = BeautifulSoup(html, 'html.parser')
        product_items = soup.select('ul.products li.product')
        
        for item in product_items:
            link_tag = item.select_one('a.woocommerce-LoopProduct-link')
            if link_tag and 'href' in link_tag.attrs:
                product_url = link_tag['href']
                links.append(product_url)
                
        return links
    
    def _get_category_slug(self, category, subcategory):
        """將類別名稱轉換為URL slug格式"""
        # 根據網站結構定義的映射關係
        # 這需要根據實際網站URL結構進行調整
        mapping = {
            "健康生技館-機能強化": "health-tech/functional-enhancement",
            "健康生技館-順暢消化": "health-tech/smooth-digestion",
            "健康生技館-窈窕代謝": "health-tech/slimming-metabolism",
            "健康生技館-調節體質": "health-tech/body-regulation",
            "舒壓運動館-居家運動": "exercise/home-exercise",
            "舒壓運動館-機能運動": "exercise/functional-exercise",
            "舒壓運動館-按摩舒壓": "exercise/massage-relaxation",
            "舒壓運動館-其他": "exercise/others",
            "生活用品館-居家生活": "daily-products/home-living",
            "生活用品館-生活用品": "daily-products/daily-necessities"
        }
        
        key = f"{category}-{subcategory}"
        return mapping.get(key, "")
    
    def extract_product_info(self, product_url):
        """從產品頁面提取產品信息"""
        html = self.fetch_page(product_url)
        if not html:
            return None
            
        soup = BeautifulSoup(html, 'html.parser')
        
        # 提取產品名稱
        name_tag = soup.select_one('h1.product_title')
        name = name_tag.text.strip() if name_tag else "未知產品"
        
        # 提取產品價格
        price_tag = soup.select_one('p.price span.woocommerce-Price-amount')
        price = price_tag.text.strip() if price_tag else "價格未知"
        
        # 提取產品描述
        short_desc_tag = soup.select_one('div.woocommerce-product-details__short-description')
        short_desc = short_desc_tag.text.strip() if short_desc_tag else ""
        
        long_desc_tag = soup.select_one('div#tab-description')
        long_desc = long_desc_tag.text.strip() if long_desc_tag else ""
        
        # 合併描述
        description = short_desc
        if long_desc and not short_desc:
            description = long_desc
        elif long_desc:
            description = f"{short_desc}\n\n{long_desc}"
        
        # 提取產品特點 (通常用星號或項目符號標記)
        features = []
        feature_markers = ["★", "✓", "•"]
        
        if description:
            lines = description.split('\n')
            for line in lines:
                line = line.strip()
                if any(line.startswith(marker) for marker in feature_markers):
                    features.append(line)
        
        # 提取產品標籤
        tags = []
        tag_elements = soup.select('span.tagged_as a')
        for tag in tag_elements:
            tags.append(tag.text.strip())
        
        # 提取產品圖片
        images = []
        img_elements = soup.select('div.woocommerce-product-gallery__image img')
        for img in img_elements:
            if 'src' in img.attrs:
                img_url = img['src']
                # 如果是相對URL，轉換為絕對URL
                if not img_url.startswith(('http://', 'https://')):
                    img_url = urljoin(self.base_url, img_url)
                images.append(img_url)
        
        # 獲取產品分類
        categories = []
        breadcrumb = soup.select('nav.woocommerce-breadcrumb a')
        for crumb in breadcrumb[1:]:  # 跳過首頁
            categories.append(crumb.text.strip())
        
        return {
            "name": name,
            "price": price,
            "description": description,
            "features": features,
            "tags": tags,
            "images": images,
            "categories": categories,
            "url": product_url
        }
    
    def scrape_all_products(self):
        """抓取所有產品信息"""
        all_product_links = set()  # 使用集合避免重複
        
        # 從每個分類頁面獲取產品鏈接
        for category, subcategories in self.categories.items():
            for subcategory in subcategories:
                print(f"正在獲取 {category} - {subcategory} 的產品鏈接...")
                links = self.extract_product_links_from_category(category, subcategory)
                all_product_links.update(links)
                time.sleep(1)  # 休息一下，避免請求過於頻繁
        
        print(f"總共找到 {len(all_product_links)} 個產品鏈接")
        
        # 提取每個產品的詳細信息
        for i, url in enumerate(all_product_links):
            print(f"正在抓取第 {i+1}/{len(all_product_links)} 個產品: {url}")
            product_info = self.extract_product_info(url)
            if product_info:
                self.products.append(product_info)
            time.sleep(2)  # 休息一下，避免請求過於頻繁
        
        return self.products
    
    def save_to_json(self, filename="jh_health_products.json"):
        """將產品信息保存為JSON文件"""
        if not self.products:
            print("沒有產品信息可保存")
            return False
            
        try:
            with open(filename, 'w', encoding='utf-8') as f:
                json.dump(self.products, f, ensure_ascii=False, indent=2)
            print(f"成功保存產品信息到 {filename}")
            return True
        except Exception as e:
            print(f"保存JSON文件失敗: {e}")
            return False
    
    def alternate_scrape_approach(self):
        """替代抓取方法：直接從首頁提取熱銷產品"""
        home_html = self.fetch_page(self.base_url)
        if not home_html:
            return []
            
        soup = BeautifulSoup(home_html, 'html.parser')
        
        # 找到首頁展示的產品
        product_items = soup.select('ul.products li.product')
        product_links = []
        
        for item in product_items:
            link_tag = item.select_one('a.woocommerce-LoopProduct-link')
            if link_tag and 'href' in link_tag.attrs:
                product_url = link_tag['href']
                product_links.append(product_url)
        
        # 提取每個產品的詳細信息
        for url in product_links:
            product_info = self.extract_product_info(url)
            if product_info:
                self.products.append(product_info)
            time.sleep(2)
        
        return self.products

def main():
    scraper = JHHealthScraper()
    
    try:
        # 嘗試主要抓取方法
        print("開始抓取晶璽健康產品資訊...")
        products = scraper.scrape_all_products()
        
        # 如果主要方法沒有找到產品，嘗試替代方法
        if not products:
            print("主要抓取方法未找到產品，嘗試替代方法...")
            products = scraper.alternate_scrape_approach()
        
        # 保存結果
        if products:
            scraper.save_to_json()
            print(f"成功抓取 {len(products)} 個產品的資訊")
        else:
            print("未能抓取任何產品資訊")
    
    except Exception as e:
        print(f"抓取過程中發生錯誤: {e}")

if __name__ == "__main__":
    main() 