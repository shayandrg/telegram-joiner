const TelegramBotAPI = require('node-telegram-bot-api');
const EventEmitter = require('events');

class TelegramBot extends EventEmitter {
  constructor(token, linkParser, logger) {
    super();
    this.token = token;
    this.linkParser = linkParser;
    this.logger = logger;
    this.bot = null;
    this.pendingRequests = new Map();
  }

  async start() {
    if (!this.token) {
      this.logger.log('WARN', 'Bot token not provided, bot interface disabled');
      return;
    }

    try {
      this.bot = new TelegramBotAPI(this.token, { polling: true });
      
      this.logger.log('INFO', 'Telegram Bot started');

      // Set up message handlers
      this.setupHandlers();

    } catch (error) {
      this.logger.log('ERROR', `Failed to start bot: ${error.message}`);
      throw error;
    }
  }

  setupHandlers() {
    // Handle /start command
    this.bot.onText(/\/start/, async (msg) => {
      await this.handleStartCommand(msg);
    });

    // Handle /help command
    this.bot.onText(/\/help/, async (msg) => {
      await this.handleHelpCommand(msg);
    });

    // Handle callback queries (button clicks)
    this.bot.on('callback_query', async (query) => {
      await this.handleCallbackQuery(query);
    });

    // Handle all other messages
    this.bot.on('message', async (msg) => {
      // Skip if it's a command
      if (msg.text && msg.text.startsWith('/')) {
        return;
      }

      // Check if this is a forwarded message to bot account
      if (msg.forward_from) {
        await this.handleForwardedMessage(msg);
        return;
      }

      await this.handleMessage(msg);
    });

    // Handle errors
    this.bot.on('polling_error', (error) => {
      this.logger.log('ERROR', `Bot polling error: ${error.message}`);
    });
  }

  async handleStartCommand(msg) {
    const chatId = msg.chat.id;
    const welcomeText = `
🤖 *Welcome to Bot Link Processor!*

Send me any message containing Telegram bot start links, and I'll:
1️⃣ Join any required channels
2️⃣ Click the start button
3️⃣ Retrieve the content
4️⃣ Send it back to you

*Example:*
\`https://t.me/SomeBot?start=parameter\`

Just paste the link and I'll handle the rest! 🚀

Use /help for more information.
    `.trim();

    try {
      await this.bot.sendMessage(chatId, welcomeText, { parse_mode: 'Markdown' });
    } catch (error) {
      this.logger.log('ERROR', `Failed to send welcome message: ${error.message}`);
    }
  }

  async handleHelpCommand(msg) {
    const chatId = msg.chat.id;
    const helpText = `
📖 *How to Use*

*Step 1:* Send me a message with a Telegram bot start link
*Step 2:* Wait while I process it
*Step 3:* Receive your content!

*Supported Links:*
• \`https://t.me/BotName?start=parameter\`
• Multiple links in one message

*What I Do:*
✅ Automatically join required channels
✅ Click confirmation buttons
✅ Retrieve and send media files
✅ Handle errors gracefully

*Status Updates:*
You'll receive updates like:
• 🔄 Processing...
• 🔗 Joining channels...
• 📥 Retrieving content...
• ✅ Done!

*Need Help?*
If something goes wrong, I'll let you know with a clear error message.

Happy downloading! 🎉
    `.trim();

    try {
      await this.bot.sendMessage(chatId, helpText, { parse_mode: 'Markdown' });
    } catch (error) {
      this.logger.log('ERROR', `Failed to send help message: ${error.message}`);
    }
  }

  async handleMessage(msg) {
    const chatId = msg.chat.id;
    const isPrivateChat = msg.chat.type === 'private';
    
    // Handle both text messages and media with captions
    const text = msg.text || msg.caption || '';
    const entities = msg.entities || msg.caption_entities || [];

    // Log the entire message for debugging
    this.logger.log('INFO', `Bot received message type: ${msg.photo ? 'photo' : msg.video ? 'video' : 'text'} in ${msg.chat.type} chat`);

    // Extract URLs from message entities (hidden links)
    const entityUrls = this.extractUrlsFromEntities(text, entities);
    
    // Extract bot links from plain text
    const textBotLinks = this.linkParser.extractBotLinks(text);
    
    // Extract bot links from entities
    const entityBotLinks = this.linkParser.extractBotLinks(entityUrls.join(' '));
    
    // Combine and deduplicate
    const allBotLinks = [...textBotLinks, ...entityBotLinks];
    const botLinks = this.deduplicateLinks(allBotLinks);

    this.logger.log('INFO', `Text bot links: ${textBotLinks.length}, Entity bot links: ${entityBotLinks.length}, Total unique: ${botLinks.length}`);

    if (botLinks.length === 0) {
      // Only send "no links found" message in private chats, ignore in groups
      if (isPrivateChat) {
        const noLinksText = `
❌ No bot links found in your message.

Please send a message containing Telegram bot start links like:
\`https://t.me/BotName?start=parameter\`

Use /help for more information.
        `.trim();

        try {
          await this.bot.sendMessage(chatId, noLinksText, { parse_mode: 'Markdown' });
        } catch (error) {
          this.logger.log('ERROR', `Failed to send no links message: ${error.message}`);
        }
      }
      return;
    }

    // In group chats, send a button instead of processing immediately
    if (!isPrivateChat) {
      try {
        const keyboard = {
          inline_keyboard: [[
            {
              text: '▶️ Start',
              callback_data: JSON.stringify({
                action: 'start_process',
                userId: msg.from.id,
                messageId: msg.message_id
              })
            }
          ]]
        };

        await this.bot.sendMessage(
          chatId,
          '🔗 Detected join link',
          {
            reply_to_message_id: msg.message_id,
            reply_markup: keyboard
          }
        );

        // Store the request data for later processing
        const requestKey = `${chatId}_${msg.message_id}`;
        if (!this.pendingRequests) {
          this.pendingRequests = new Map();
        }
        
        this.pendingRequests.set(requestKey, {
          chatId: chatId,
          userId: msg.from.id,
          username: msg.from.username || 'unknown',
          botLinks: botLinks,
          originalMessageId: msg.message_id
        });

        this.logger.log('INFO', `Stored pending request for group chat ${chatId}, message ${msg.message_id}`);
      } catch (error) {
        this.logger.log('ERROR', `Failed to send button message: ${error.message}`);
      }
      return;
    }

    // For private chats, process immediately as before
    const request = {
      chatId: chatId,
      userId: msg.from.id,
      username: msg.from.username || 'unknown',
      botLinks: botLinks,
      timestamp: new Date(),
      status: 'queued',
      timeout: 300000 // 5 minutes
    };

    this.logger.log('INFO', `Received ${botLinks.length} bot link(s) from user ${request.userId} in ${msg.chat.type} chat`);

    // Emit request received event
    this.emit('requestReceived', request);
  }

  async handleCallbackQuery(query) {
    const chatId = query.message.chat.id;
    const userId = query.from.id;
    
    try {
      const data = JSON.parse(query.data);
      
      if (data.action === 'start_process') {
        // Check if the user who clicked is the same as the one who sent the message
        if (data.userId !== userId) {
          await this.bot.answerCallbackQuery(query.id, {
            text: '❌ Only the person who sent the link can start the process',
            show_alert: true
          });
          return;
        }

        // Retrieve the stored request
        const requestKey = `${chatId}_${data.messageId}`;
        if (!this.pendingRequests || !this.pendingRequests.has(requestKey)) {
          await this.bot.answerCallbackQuery(query.id, {
            text: '❌ Request expired or not found',
            show_alert: true
          });
          return;
        }

        const storedRequest = this.pendingRequests.get(requestKey);
        this.pendingRequests.delete(requestKey);

        // Answer the callback query
        await this.bot.answerCallbackQuery(query.id, {
          text: '✅ Starting process...'
        });

        // Update the button message to show it's processing
        try {
          await this.bot.editMessageText('⏳ Processing...', {
            chat_id: chatId,
            message_id: query.message.message_id
          });
        } catch (error) {
          this.logger.log('WARN', `Failed to edit button message: ${error.message}`);
        }

        // Create and emit the request
        const request = {
          chatId: chatId,
          userId: storedRequest.userId,
          username: storedRequest.username,
          botLinks: storedRequest.botLinks,
          timestamp: new Date(),
          status: 'queued',
          timeout: 300000 // 5 minutes
        };

        this.logger.log('INFO', `Processing ${request.botLinks.length} bot link(s) from button click by user ${userId}`);
        this.emit('requestReceived', request);
      }
    } catch (error) {
      this.logger.log('ERROR', `Error handling callback query: ${error.message}`);
      await this.bot.answerCallbackQuery(query.id, {
        text: '❌ An error occurred',
        show_alert: true
      });
    }
  }

  async handleForwardedMessage(msg) {
    // This is a forwarded message from client to bot account
    // We need to forward it to the end user who requested it
    const forwardedFromBotId = msg.forward_from.id;
    
    this.logger.log('INFO', `Received forwarded message from bot ${forwardedFromBotId}`);
    
    // Emit event for Application to handle
    this.emit('forwardedMediaReceived', {
      message: msg,
      targetBotId: forwardedFromBotId
    });
  }

  extractUrlsFromEntities(text, entities) {
    const urls = [];
    
    if (!entities || entities.length === 0) {
      return urls;
    }

    for (const entity of entities) {
      // Check for text links (url embedded in text)
      if (entity.type === 'text_link' && entity.url) {
        urls.push(entity.url);
      }
      
      // Check for regular URLs
      if (entity.type === 'url') {
        const url = text.substring(entity.offset, entity.offset + entity.length);
        urls.push(url);
      }
    }

    this.logger.log('INFO', `Extracted ${urls.length} URL(s) from message entities`);
    return urls;
  }

  deduplicateLinks(links) {
    const seen = new Set();
    return links.filter(link => {
      const key = `${link.botUsername}:${link.startParameter}`;
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    });
  }

  async sendMessage(chatId, text, options = {}) {
    try {
      await this.bot.sendMessage(chatId, text, options);
    } catch (error) {
      this.logger.log('ERROR', `Failed to send message to ${chatId}: ${error.message}`);
      throw error;
    }
  }

  async sendStatusUpdate(chatId, status) {
    try {
      const msg = await this.bot.sendMessage(chatId, status);
      return msg.message_id;
    } catch (error) {
      this.logger.log('ERROR', `Failed to send status update to ${chatId}: ${error.message}`);
      return null;
    }
  }

  async editMessage(chatId, messageId, newText) {
    try {
      await this.bot.editMessageText(newText, {
        chat_id: chatId,
        message_id: messageId
      });
    } catch (error) {
      this.logger.log('ERROR', `Failed to edit message ${messageId} in ${chatId}: ${error.message}`);
    }
  }

  async sendPhoto(chatId, photo, options = {}) {
    try {
      await this.bot.sendPhoto(chatId, photo, options);
    } catch (error) {
      this.logger.log('ERROR', `Failed to send photo to ${chatId}: ${error.message}`);
      throw error;
    }
  }

  async sendVideo(chatId, video, options = {}) {
    try {
      await this.bot.sendVideo(chatId, video, options);
    } catch (error) {
      this.logger.log('ERROR', `Failed to send video to ${chatId}: ${error.message}`);
      throw error;
    }
  }

  async sendDocument(chatId, document, options = {}) {
    try {
      await this.bot.sendDocument(chatId, document, options);
    } catch (error) {
      this.logger.log('ERROR', `Failed to send document to ${chatId}: ${error.message}`);
      throw error;
    }
  }

  async forwardMessage(chatId, fromChatId, messageId) {
    try {
      await this.bot.forwardMessage(chatId, fromChatId, messageId);
      this.logger.log('INFO', `Forwarded message ${messageId} to ${chatId}`);
    } catch (error) {
      this.logger.log('ERROR', `Failed to forward message: ${error.message}`);
      throw error;
    }
  }

  async getBotInfo() {
    try {
      return await this.bot.getMe();
    } catch (error) {
      this.logger.log('ERROR', `Failed to get bot info: ${error.message}`);
      return null;
    }
  }

  stop() {
    if (this.bot) {
      this.bot.stopPolling();
      this.logger.log('INFO', 'Telegram Bot stopped');
    }
  }
}

module.exports = TelegramBot;
