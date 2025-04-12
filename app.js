require('dotenv').config();
const express = require('express');
const line = require('@line/bot-sdk');
const { Configuration, OpenAIApi } = require('openai');

// LINE配置
const lineConfig = {
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
  channelSecret: process.env.LINE_CHANNEL_SECRET
};

// 初始化LINE客户端
const lineClient = new line.Client(lineConfig);

// 初始化 OpenAI
const configuration = new Configuration({
  apiKey: process.env.OPENAI_API_KEY,
});
const openai = new OpenAIApi(configuration);

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
    // 使用 ChatGPT-4-mini
    const completion = await openai.createChatCompletion({
      model: "gpt-4-mini",
      messages: [
        { role: "system", content: "你是一个有帮助的助手。" },
        { role: "user", content: userMessage }
      ],
      temperature: 0.9,
      max_tokens: 2048,
    });

    const aiResponse = completion.data.choices[0].message.content;

    return lineClient.replyMessage(event.replyToken, {
      type: 'text',
      text: aiResponse
    });
  } catch (error) {
    console.error("API错误:", error);
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

// 启动服务器
app.listen(process.env.PORT || 3000, () => {
  console.log('服务器已启动');
});