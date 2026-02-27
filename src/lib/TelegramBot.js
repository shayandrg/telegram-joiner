const TelegramBotAPI = require('node-telegram-bot-api');
const EventEmitter = require('events');

class TelegramBot extends EventEmitter {
  constructor(token, linkParser, logger) {
    super();
    this.token = token;
    this.linkParser = linkParser;
    this.logger = logger;
    this.bot = null;
    this.processedMessages = new Set(); // Track processed message IDs
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
    // Handle /start command (only at the beginning of the message)
    this.bot.onText(/^\/start(@\w+)?(\s+(.+))?$/, async (msg, match) => {
      await this.handleStartCommand(msg, match);
    });

    // Handle /help command (only at the beginning of the message)
    this.bot.onText(/^\/help(@\w+)?(\s|$)/, async (msg) => {
      await this.handleHelpCommand(msg);
    });

    // Handle all other messages
    this.bot.on('message', async (msg) => {
      // Check if this is a forwarded message to bot account FIRST
      // This prevents forwarded media from being processed as new requests
      if (msg.forward_from) {
        await this.handleForwardedMessage(msg);
        return;
      }

      // Skip if it's a command
      if (msg.text && msg.text.startsWith('/')) {
        return;
      }

      // Skip messages from the bot itself to prevent processing own status messages
      if (msg.from && msg.from.is_bot) {
        return;
      }

      // Handle media groups: Only process the first message with caption/entities
      // Skip subsequent messages in the same media group that don't have caption
      if (msg.media_group_id) {
        const hasCaption = !!(msg.caption || msg.text);
        const hasEntities = !!(msg.caption_entities || msg.entities);
        
        // Only process if it has caption or entities (first message in group)
        if (!hasCaption && !hasEntities) {
          this.logger.log('DEBUG', `Skipping media group message ${msg.message_id} without caption`);
          return;
        }
      }

      await this.handleMessage(msg);
    });

    // Handle errors
    this.bot.on('polling_error', (error) => {
      this.logger.log('ERROR', `Bot polling error: ${error.message}`);
    });
  }

  async handleStartCommand(msg, match) {
    const chatId = msg.chat.id;
    const isPrivateChat = msg.chat.type === 'private';
    
    // Check if there's a parameter (deep link data)
    const startParam = match && match[3] ? match[3].trim() : null;
    
    if (startParam && isPrivateChat) {
      // User came from group via deep link - decode and process links
      try {
        const decodedData = this.decodeStartParameter(startParam);
        
        if (decodedData && decodedData.links && decodedData.links.length > 0) {
          this.logger.log('INFO', `Processing ${decodedData.links.length} link(s) from deep link parameter`);
          
          // Create request object
          const request = {
            chatId: chatId,
            userId: msg.from.id,
            username: msg.from.username || 'unknown',
            botLinks: decodedData.links,
            timestamp: new Date(),
            status: 'queued',
            timeout: 300000 // 5 minutes
          };
          
          // Emit request received event
          this.emit('requestReceived', request);
          return;
        } else {
          this.logger.log('WARN', `Failed to decode start parameter: ${startParam}`);
          // Send error message to user
          await this.bot.sendMessage(
            chatId,
            '❌ Invalid or expired link. Please try getting a new link from the group.',
            { parse_mode: 'Markdown' }
          );
          return;
        }
      } catch (error) {
        this.logger.log('ERROR', `Error decoding start parameter: ${error.message}`);
        await this.bot.sendMessage(
          chatId,
          '❌ An error occurred while processing the link. Please try again.',
          { parse_mode: 'Markdown' }
        );
        return;
      }
    }
    
    // Default welcome message
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
    // console.log('handleMessage, msg:', msg)
    // Prevent duplicate processing of the same message
    const messageKey = `${msg.chat.id}_${msg.message_id}`;
    if (this.processedMessages.has(messageKey)) {
      this.logger.log('DEBUG', `Skipping duplicate message ${msg.message_id}`);
      return;
    }
    this.processedMessages.add(messageKey);
    
    // Clean up old message IDs (keep only last 100)
    if (this.processedMessages.size > 100) {
      const entries = Array.from(this.processedMessages);
      this.processedMessages = new Set(entries.slice(-100));
    }

    // Safety check: Skip forwarded messages (should be handled by handleForwardedMessage)
    if (msg.forward_from) {
      this.logger.log('WARN', 'Forwarded message reached handleMessage - this should not happen');
      return;
    }

    const chatId = msg.chat.id;
    const isPrivateChat = msg.chat.type === 'private';
    
    // Handle both text messages and media with captions
    const text = msg.text || msg.caption || '';
    const entities = msg.entities || msg.caption_entities || [];

    // Log the entire message for debugging
    this.logger.log('INFO', `Bot received message type: ${msg.photo ? 'photo' : msg.video ? 'video' : 'text'} in ${msg.chat.type} chat`);

    // Extract bot links from both text and entities
    const botLinks = this.linkParser.extractBotLinks(text, entities);

    this.logger.log('INFO', `Found ${botLinks.length} bot link(s) in message`);

    if (botLinks?.length === 0) {
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

    // In group chats, send a button with deep link to bot instead of processing immediately
    if (!isPrivateChat) {
      try {
        // Get bot info to create deep link
        const botInfo = await this.getBotInfo();
        if (!botInfo || !botInfo.username) {
          this.logger.log('ERROR', 'Failed to get bot username for deep link');
          return;
        }
        
        // Encode the links into a start parameter
        const startParam = this.encodeLinksToParameter(botLinks);
        if (!startParam) {
          this.logger.log('ERROR', 'Failed to encode links to parameter');
          await this.bot.sendMessage(
            chatId,
            '❌ Failed to process links. Please try sending them directly to the bot in private chat.',
            { reply_to_message_id: msg.message_id }
          );
          return;
        }
        
        const deepLink = `https://t.me/${botInfo.username}?start=${startParam}`;
        
        const keyboard = {
          inline_keyboard: [[
            {
              text: '▶️ Start',
              url: deepLink
            }
          ]]
        };

        await this.bot.sendMessage(
          chatId,
          '🔗 Detected join link\n\nClick Start to process in private chat with the bot.',
          {
            reply_to_message_id: msg.message_id,
            reply_markup: keyboard
          }
        );

        this.logger.log('INFO', `Sent deep link button for group chat ${chatId}, message ${msg.message_id}`);
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

  encodeLinksToParameter(botLinks) {
    // Encode bot links into a compact base64 string
    // Format: JSON array of {b: botUsername, s: startParameter}
    try {
      const compactLinks = botLinks.map(link => ({
        b: link.botUsername,
        s: link.startParameter
      }));
      
      const jsonStr = JSON.stringify(compactLinks);
      const base64 = Buffer.from(jsonStr).toString('base64')
        .replace(/\+/g, '-')  // Make URL safe
        .replace(/\//g, '_')
        .replace(/=/g, '');   // Remove padding
      
      // Telegram's start parameter limit is 64 characters
      // If we exceed this, we need to handle it
      if (base64.length > 64) {
        this.logger.log('WARN', `Encoded parameter length (${base64.length}) exceeds Telegram limit (64). Truncating to first link only.`);
        
        // Try with just the first link
        const singleLink = [{
          b: botLinks[0].botUsername,
          s: botLinks[0].startParameter
        }];
        
        const singleJsonStr = JSON.stringify(singleLink);
        const singleBase64 = Buffer.from(singleJsonStr).toString('base64')
          .replace(/\+/g, '-')
          .replace(/\//g, '_')
          .replace(/=/g, '');
        
        if (singleBase64.length > 64) {
          this.logger.log('ERROR', `Even single link exceeds parameter limit (${singleBase64.length})`);
          return null;
        }
        
        this.logger.log('INFO', `Using only first link due to parameter size limit`);
        return singleBase64;
      }
      
      this.logger.log('DEBUG', `Encoded ${botLinks.length} link(s) to parameter: ${base64.substring(0, 50)}...`);
      return base64;
    } catch (error) {
      this.logger.log('ERROR', `Failed to encode links: ${error.message}`);
      return null;
    }
  }

  decodeStartParameter(param) {
    // Decode base64 parameter back to bot links
    try {
      // Restore base64 padding and URL-safe characters
      let base64 = param
        .replace(/-/g, '+')
        .replace(/_/g, '/');
      
      // Add padding if needed
      while (base64.length % 4) {
        base64 += '=';
      }
      
      const jsonStr = Buffer.from(base64, 'base64').toString('utf8');
      const compactLinks = JSON.parse(jsonStr);
      
      // Convert back to full format
      const botLinks = compactLinks.map(link => ({
        botUsername: link.b,
        startParameter: link.s,
        originalUrl: `https://t.me/${link.b}?start=${link.s}`
      }));
      
      this.logger.log('DEBUG', `Decoded parameter to ${botLinks.length} link(s)`);
      return { links: botLinks };
    } catch (error) {
      this.logger.log('ERROR', `Failed to decode parameter: ${error.message}`);
      return null;
    }
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
      const msg = await this.bot.sendMessage(chatId, text, options);
      return msg.message_id;
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
      const msg = await this.bot.sendPhoto(chatId, photo, options);
      return msg.message_id;
    } catch (error) {
      this.logger.log('ERROR', `Failed to send photo to ${chatId}: ${error.message}`);
      throw error;
    }
  }

  async sendVideo(chatId, video, options = {}) {
    try {
      const msg = await this.bot.sendVideo(chatId, video, options);
      return msg.message_id;
    } catch (error) {
      this.logger.log('ERROR', `Failed to send video to ${chatId}: ${error.message}`);
      throw error;
    }
  }

  async sendDocument(chatId, document, options = {}) {
    try {
      const msg = await this.bot.sendDocument(chatId, document, options);
      return msg.message_id;
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

  async deleteMessage(chatId, messageId) {
    try {
      await this.bot.deleteMessage(chatId, messageId);
      this.logger.log('INFO', `Deleted message ${messageId} from chat ${chatId}`);
      return true;
    } catch (error) {
      this.logger.log('ERROR', `Failed to delete message: ${error.message}`);
      return false;
    }
  }
  async deleteMessage(chatId, messageId) {
    try {
      await this.bot.deleteMessage(chatId, messageId);
      this.logger.log('INFO', `Deleted message ${messageId} from chat ${chatId}`);
      return true;
    } catch (error) {
      this.logger.log('ERROR', `Failed to delete message: ${error.message}`);
      return false;
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
