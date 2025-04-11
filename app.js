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

const app = express();

// 健康检查路由
app.get('/', (req, res) => {
  res.status(200).json({ status: 'ok' });
});

app.get('/linebot/webhook', (req, res) => {
  res.status(200).json({ status: 'webhook endpoint ok' });
});

// Webhook路由
app.post('/linebot/webhook', line.middleware(lineConfig), async (req, res) => {
  // 立即响应
  res.status(200).end();
  
  try {
    const events = req.body.events;
    // 异步处理事件
    events.forEach(async (event) => {
      try {
        await handleEvent(event);
      } catch (err) {
        console.error('事件处理错误:', err);
      }
    });
  } catch (err) {
    console.error('Webhook处理错误:', err);
  }
});

// 事件处理函数
async function handleEvent(event) {
  if (event.type !== 'message' || event.message.type !== 'text') {
    return null;
  }

  const userMessage = event.message.text;
  
  try {
    const model = genAI.getGenerativeModel({ 
      model: "gemini-2.0-flash-lite",
      generationConfig: {
        temperature: 0.9,
        topK: 1,
        topP: 1,
        maxOutputTokens: 2048,
      },
    });

    const result = await model.generateContent({
      contents: [{ role: "user", parts: [{ text: userMessage }] }]
    });
    
    const response = await result.response;
    const aiResponse = response.text();

    return lineClient.replyMessage(event.replyToken, {
      type: 'text',
      text: aiResponse
    });
  } catch (error) {
    console.error("Gemini API错误:", error);
    return lineClient.replyMessage(event.replyToken, {
      type: 'text',
      text: `系统错误: ${error.message}\n请稍后再试。`
    });
  }
}

// 错误处理中间件
app.use((err, req, res, next) => {
  console.error('Error:', err);
  res.status(500).json({ error: 'Internal Server Error' });
});

// 更明确的端口设置
const PORT = process.env.PORT === '10000' ? 3000 : (process.env.PORT || 3000);
const server = app.listen(PORT, '0.0.0.0', () => {
  const actualPort = server.address().port;
  console.log(`尝试使用端口 ${PORT}`);
  console.log(`服务器实际运行在端口 ${actualPort}`);
});