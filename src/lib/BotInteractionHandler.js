const { Api } = require('telegram');
const EventEmitter = require('events');

class BotInteractionHandler extends EventEmitter {
  constructor(logger) {
    super();
    this.logger = logger;
    this.timeout = 30000; // 30 seconds
  }

  async interactWithBot(client, link, originalSenderId, botChatId = null) {
    try {
      // Resolve bot username to get bot entity
      const bot = await this.resolveBot(client, link.botUsername);
      
      if (!bot) {
        return {
          botUsername: link.botUsername,
          responseText: '',
          timestamp: new Date(),
          success: false,
          error: 'Bot not found'
        };
      }

      // Send start command with parameter
      const startCommand = `/start ${link.startParameter}`;
      await this.sendStartCommand(client, bot, startCommand);

      // Wait for bot response with buttons
      const responseMessage = await this.waitForResponseMessage(client, bot);

      if (!responseMessage) {
        return {
          botUsername: link.botUsername,
          responseText: 'No response received',
          timestamp: new Date(),
          success: false,
          error: 'No response received'
        };
      }

      // Check if message has inline keyboard buttons
      if (responseMessage.replyMarkup && responseMessage.replyMarkup.rows) {
        this.logger.log('INFO', 'Bot response has inline keyboard buttons');
        
        // Extract channel links and join them
        await this.joinChannelsFromButtons(client, responseMessage.replyMarkup, botChatId);
        
        // Click the last button (confirm button) and forward media
        await this.clickConfirmButtonAndForwardMedia(client, bot, responseMessage, originalSenderId, botChatId);
        
        return {
          botUsername: link.botUsername,
          responseText: 'Channels joined, confirmed, and media forwarded',
          timestamp: new Date(),
          success: true
        };
      }

      // No buttons - bot is sending media directly, just wait and forward
      this.logger.log('INFO', 'No inline keyboard buttons, waiting for media messages...');
      await this.waitAndForwardMediaMessages(client, bot, originalSenderId, botChatId);

      return {
        botUsername: link.botUsername,
        responseText: responseMessage.text || responseMessage.message || 'Media forwarded',
        timestamp: new Date(),
        success: true
      };
    } catch (error) {
      this.logger.log('ERROR', `Bot interaction failed for ${link.botUsername}: ${error.message}`);
      
      return {
        botUsername: link.botUsername,
        responseText: '',
        timestamp: new Date(),
        success: false,
        error: error.message
      };
    }
  }

  async resolveBot(client, botUsername) {
    try {
      const result = await client.invoke(
        new Api.contacts.ResolveUsername({
          username: botUsername
        })
      );

      if (result.users && result.users.length > 0) {
        return result.users[0];
      }

      this.logger.log('ERROR', `Bot not found: ${botUsername}`);
      return null;
    } catch (error) {
      this.logger.log('ERROR', `Failed to resolve bot ${botUsername}: ${error.message}`);
      return null;
    }
  }

  async sendStartCommand(client, bot, command) {
    try {
      await client.sendMessage(bot, { message: command });
      this.logger.log('INFO', `Sent command to bot: ${command}`);
    } catch (error) {
      this.logger.log('ERROR', `Failed to send command: ${error.message}`);
      throw error;
    }
  }

  async waitForResponse(client, bot) {
    return new Promise((resolve) => {
      let responseReceived = false;
      const timeoutId = setTimeout(() => {
        if (!responseReceived) {
          this.logger.log('ERROR', 'Bot response timeout (30 seconds)');
          resolve(null);
        }
      }, this.timeout);

      // Create a temporary event handler for the bot's response
      const handler = async (event) => {
        try {
          const message = event.message;
          
          // Check if message is from the bot
          if (message.senderId?.toString() === bot.id.toString()) {
            responseReceived = true;
            clearTimeout(timeoutId);
            
            // Remove the event handler
            client.removeEventHandler(handler);
            
            resolve(message.text || message.message || '');
          }
        } catch (error) {
          this.logger.log('ERROR', `Error in response handler: ${error.message}`);
        }
      };

      const { NewMessage } = require('telegram/events');
      client.addEventHandler(handler, new NewMessage({}));
    });
  }

  async waitForResponseMessage(client, bot) {
    return new Promise((resolve) => {
      let responseReceived = false;
      const timeoutId = setTimeout(() => {
        if (!responseReceived) {
          this.logger.log('ERROR', 'Bot response timeout (30 seconds)');
          resolve(null);
        }
      }, this.timeout);

      const handler = async (event) => {
        try {
          const message = event.message;
          
          if (message.senderId?.toString() === bot.id.toString()) {
            responseReceived = true;
            clearTimeout(timeoutId);
            client.removeEventHandler(handler);
            resolve(message);
          }
        } catch (error) {
          this.logger.log('ERROR', `Error in response handler: ${error.message}`);
        }
      };

      const { NewMessage } = require('telegram/events');
      client.addEventHandler(handler, new NewMessage({}));
    });
  }

  async joinChannelsFromButtons(client, replyMarkup, botChatId = null) {
    const channelButtons = [];
    
    // Extract all buttons except the last row (which contains confirm button)
    for (let i = 0; i < replyMarkup.rows.length - 1; i++) {
      const row = replyMarkup.rows[i];
      for (const button of row.buttons) {
        if (button.url) {
          channelButtons.push(button);
        }
      }
    }

    const totalChannels = channelButtons.length;
    this.logger.log('INFO', `Found ${totalChannels} channel buttons to join`);

    // Join each channel
    for (let i = 0; i < channelButtons.length; i++) {
      const button = channelButtons[i];
      
      // Emit progress event
      if (botChatId) {
        this.emit('channelProgress', {
          chatId: botChatId,
          current: i + 1,
          total: totalChannels
        });
      }
      
      await this.joinChannelFromUrl(client, button.url, button.text);
      // Small delay between joins
      await this.sleep(1000);
    }
  }

  async joinChannelFromUrl(client, url, buttonText) {
    try {
      // Extract channel username from URL
      // URLs can be like: https://t.me/channelname or https://t.me/+inviteHash
      const match = url.match(/t\.me\/([^?]+)/);
      if (!match) {
        this.logger.log('WARN', `Could not parse channel URL: ${url}`);
        return;
      }

      const channelIdentifier = match[1];
      
      // Handle invite links (starting with +)
      if (channelIdentifier.startsWith('+')) {
        const inviteHash = channelIdentifier.substring(1);
        this.logger.log('INFO', `Joining channel via invite link: ${inviteHash}`);
        
        await client.invoke(
          new Api.messages.ImportChatInvite({
            hash: inviteHash
          })
        );
        
        this.logger.log('INFO', `✅ Joined channel via invite: ${buttonText}`);
      } else {
        // Regular channel username
        this.logger.log('INFO', `Joining channel: ${channelIdentifier}`);
        
        const channel = await client.invoke(
          new Api.contacts.ResolveUsername({
            username: channelIdentifier
          })
        );

        if (channel.chats && channel.chats.length > 0) {
          await client.invoke(
            new Api.channels.JoinChannel({
              channel: channel.chats[0]
            })
          );
          
          this.logger.log('INFO', `✅ Joined channel: ${buttonText} (@${channelIdentifier})`);
        }
      }
    } catch (error) {
      this.logger.log('ERROR', `Failed to join channel from ${url}: ${error.message}`);
    }
  }

  async clickConfirmButton(client, bot, originalMessage) {
    try {
      // Get the last row (confirm button row)
      const lastRow = originalMessage.replyMarkup.rows[originalMessage.replyMarkup.rows.length - 1];
      const confirmButton = lastRow.buttons[0];

      this.logger.log('INFO', `Clicking confirm button: ${confirmButton.text}`);

      // Click the button by sending callback query
      await client.invoke(
        new Api.messages.GetBotCallbackAnswer({
          peer: bot,
          msgId: originalMessage.id,
          data: confirmButton.data
        })
      );

      // Wait for the final response
      const finalResponse = await this.waitForResponse(client, bot);
      
      this.logger.log('INFO', `✅ Confirm button clicked, received final response`);
      
      return finalResponse;
    } catch (error) {
      this.logger.log('ERROR', `Failed to click confirm button: ${error.message}`);
      return null;
    }
  }

  async clickConfirmButtonAndForwardMedia(client, bot, originalMessage, originalSenderId, botChatId = null) {
    // Get the last row (confirm button row)
    const lastRow = originalMessage.replyMarkup.rows[originalMessage.replyMarkup.rows.length - 1];
    const confirmButton = lastRow.buttons[0];

    this.logger.log('INFO', `Clicking confirm button: ${confirmButton.text}`);

    try {
      // Click the button by sending callback query
      // Note: This often times out because the bot doesn't respond to the callback,
      // it just starts sending media messages instead
      await client.invoke(
        new Api.messages.GetBotCallbackAnswer({
          peer: bot,
          msgId: originalMessage.id,
          data: confirmButton.data
        })
      );
      this.logger.log('INFO', `✅ Confirm button clicked`);
    } catch (error) {
      // Ignore BOT_RESPONSE_TIMEOUT - it's expected behavior
      if (error.message && error.message.includes('BOT_RESPONSE_TIMEOUT')) {
        this.logger.log('INFO', `✅ Confirm button clicked (bot didn't respond to callback, will send media)`);
      } else {
        this.logger.log('WARN', `Button click warning: ${error.message}`);
      }
    }

    // Wait and collect media messages from bot
    await this.waitAndForwardMediaMessages(client, bot, originalSenderId, botChatId);
  }

  async waitAndForwardMediaMessages(client, bot, originalSenderId, botChatId = null) {
    return new Promise((resolve) => {
      const mediaMessages = [];
      let lastMessageTime = Date.now();
      const mediaTimeout = 10000; // 10 seconds after last media message
      let mediaCount = 0;
      
      const checkTimeout = setInterval(() => {
        if (Date.now() - lastMessageTime > mediaTimeout) {
          clearInterval(checkTimeout);
          client.removeEventHandler(handler);
          this.logger.log('INFO', `Collected ${mediaMessages.length} media messages`);
          resolve();
        }
      }, 1000);

      const handler = async (event) => {
        try {
          const message = event.message;
          
          // Check if message is from the bot
          if (message.senderId?.toString() === bot.id.toString()) {
            // Check if message has media (photo or video)
            if (message.photo || message.video || message.document) {
              lastMessageTime = Date.now();
              mediaMessages.push(message);
              mediaCount++;
              
              const mediaType = message.photo ? 'photo' : message.video ? 'video' : 'document';
              this.logger.log('INFO', `📥 Received ${mediaType} from bot (${mediaCount} total)`);
              
              // Emit progress event
              if (botChatId) {
                this.emit('mediaProgress', {
                  chatId: botChatId,
                  current: mediaCount,
                  total: mediaCount
                });
              }
              
              // Forward the media
              if (botChatId) {
                // Forward to bot account (botChatId is the bot's user ID)
                this.emit('mediaReceived', { message, botChatId, botId: bot.id });
              } else if (originalSenderId) {
                // Direct forward to user
                await this.forwardMessageToUser(client, message, originalSenderId);
              }
            }
          }
        } catch (error) {
          this.logger.log('ERROR', `Error in media handler: ${error.message}`);
        }
      };

      const { NewMessage } = require('telegram/events');
      client.addEventHandler(handler, new NewMessage({}));
    });
  }

  async forwardMessageToUser(client, message, userId) {
    try {
      // Forward the message to the original sender
      await client.forwardMessages(userId, {
        messages: [message.id],
        fromPeer: message.peerId
      });
      
      const mediaType = message.photo ? 'photo' : message.video ? 'video' : 'document';
      this.logger.log('INFO', `📤 Forwarded ${mediaType} to user ${userId}`);
    } catch (error) {
      this.logger.log('ERROR', `Failed to forward message to user ${userId}: ${error.message}`);
    }
  }

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

module.exports = BotInteractionHandler;
