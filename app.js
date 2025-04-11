require('dotenv').config();
const express = require('express');
const line = require('@line/bot-sdk');
const { GoogleGenerativeAI } = require('@google/generative-ai');

// LINE配置
const lineConfig = {
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
  channelSecret: process.env.LINE_CHANNEL_SECRET
};

// 初始化LINE客户端
const lineClient = new line.Client(lineConfig);

// 初始化Gemini
const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY);

// 创建Express应用
const app = express();

// 设置webhook路由
app.post('/linebot/webhook', line.middleware(lineConfig), async (req, res) => {
  try {
    const events = req.body.events;
    await Promise.all(events.map(handleEvent));
    res.status(200).end();
  } catch (err) {
    console.error('Webhook处理错误:', err);
    res.status(500).end();
  }
});

// 处理事件函数
async function handleEvent(event) {
  if (event.type !== 'message' || event.message.type !== 'text') {
    return null;
  }

  const userMessage = event.message.text;

  try {
    // 使用Gemini生成回复
    const model = genAI.getGenerativeModel({ model: "gemini-pro" });
    const result = await model.generateContent(userMessage);
    const response = await result.response;
    const aiResponse = response.text();

    // 发送回复给用户
    return lineClient.replyMessage(event.replyToken, {
      type: 'text',
      text: aiResponse
    });
  } catch (error) {
    console.error('Gemini API错误:', error);
    return lineClient.replyMessage(event.replyToken, {
      type: 'text',
      text: '抱歉，我现在无法回答。请稍后再试。'
    });
  }
}

// 启动服务器
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`服务器运行在端口 ${PORT}`);
});
