require('dotenv').config();
const express = require('express');
const line = require('@line/bot-sdk');
const OpenAI = require('openai');

// LINE配置
const lineConfig = {
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
  channelSecret: process.env.LINE_CHANNEL_SECRET
};

// 初始化LINE客户端
const lineClient = new line.Client(lineConfig);

// 初始化 OpenAI
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

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
  res.status(200).end();
  
  try {
    const events = req.body.events;
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
    // 修改 input 格式
    const response = await openai.responses.create({
      model: "gpt-4o-mini",
      input: [{
        text: userMessage,
        type: "text"
      }],  // input 需要是一个包含 text 和 type 的对象
      text: {
        format: {
          type: "text"
        }
      },
      reasoning: {},
      tools: [],
      temperature: 1,
      max_output_tokens: 2048,
      top_p: 1,
      store: true
    });

    console.log('API Response:', response); // 添加日志以查看响应格式

    // 获取回复内容
    const aiResponse = response.output || response.text || JSON.stringify(response);

    return lineClient.replyMessage(event.replyToken, {
      type: 'text',
      text: aiResponse
    });
  } catch (error) {
    console.error("API错误详情:", error);
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