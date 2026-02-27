const { Api } = require('telegram');
const EventEmitter = require('events');
const { formatWaitTime } = require('../utils/TimeFormatter');

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

      // Start media collection BEFORE sending start command to catch all messages
      this.logger.log('INFO', 'Starting media listener before sending start command...');
      const mediaCollectionPromise = this.waitAndForwardMediaMessagesWithRetry(client, bot, originalSenderId, botChatId);
      
      // Small delay to ensure handler is registered
      await new Promise(resolve => setImmediate(resolve));

      // Send start command with parameter
      const startCommand = `/start ${link.startParameter}`;
      await this.sendStartCommand(client, bot, startCommand);

      // Wait for bot response with buttons (this will be caught by media handler too)
      const responseMessage = await this.waitForResponseMessage(client, bot);

      if (!responseMessage) {
        // No initial response, but media might still be coming
        // Wait for media collection to complete before deciding if it's an error
        this.logger.log('WARN', 'No initial response message, but waiting for media collection...');
        const mediaResult = await mediaCollectionPromise;
        
        if (mediaResult && mediaResult.mediaCount > 0) {
          // Media was received, so it's actually successful
          return {
            botUsername: link.botUsername,
            responseText: `Media forwarded (${mediaResult.mediaCount} file(s))`,
            timestamp: new Date(),
            success: true
          };
        }
        
        // No response and no media - return error
        return {
          botUsername: link.botUsername,
          
          responseText: '',
          timestamp: new Date(),
          success: false,
          error: 'Bot response timeout - no message received'
        };
      }

      // Check if message has inline keyboard buttons
      if (responseMessage.replyMarkup && responseMessage.replyMarkup.rows) {
        this.logger.log('INFO', 'Bot response has inline keyboard buttons');
        
        // Extract channel links and join them
        const joinResult = await this.joinChannelsFromButtons(client, responseMessage.replyMarkup, botChatId);
        
        // Check if we hit rate limit
        if (joinResult && !joinResult.success && joinResult.floodWait > 0) {
          return {
            botUsername: link.botUsername,
            responseText: `Rate limited: Please wait ${formatWaitTime(joinResult.floodWait)}. Joined ${joinResult.joinedCount} channels.`,
            timestamp: new Date(),
            success: false,
            error: `FLOOD_WAIT: ${formatWaitTime(joinResult.floodWait)}`,
            floodWait: joinResult.floodWait
          };
        }
        
        // Click the last button (confirm button) - media handler is already running
        const callbackResult = await this.clickConfirmButton(client, bot, responseMessage);
        
        // Check if callback returned a popup alert about joining channels
        if (callbackResult && callbackResult.alert) {
          this.logger.log('WARN', `⚠️ Bot sent popup alert: ${callbackResult.message}`);
          
          // If popup says we need to join channels, wait longer and retry
          if (callbackResult.message && 
              (callbackResult.message.includes('join') || 
               callbackResult.message.includes('عضو') || 
               callbackResult.message.includes('subscribe'))) {
            this.logger.log('INFO', 'Waiting additional time for channel joins to process...');
            await this.sleep(5000);
            
            // Retry clicking the confirm button
            this.logger.log('INFO', 'Retrying confirm button click...');
            await this.clickConfirmButton(client, bot, responseMessage);
          }
        }
        
        // Wait for media collection to complete
        await mediaCollectionPromise;
        
        return {
          botUsername: link.botUsername,
          responseText: 'Channels joined, confirmed, and media forwarded',
          timestamp: new Date(),
          success: true
        };
      }

      // No buttons - bot is sending media directly, media handler is already running
      this.logger.log('INFO', 'No inline keyboard buttons, media handler already active...');
      await mediaCollectionPromise;

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

    let successCount = 0;
    let floodWaitDetected = false;
    let maxFloodWait = 0;

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
      
      const result = await this.joinChannelFromUrl(client, button.url, button.text);
      
      if (result.success) {
        successCount++;
      }
      
      if (result.floodWait > 0) {
        floodWaitDetected = true;
        maxFloodWait = Math.max(maxFloodWait, result.floodWait);
        this.logger.log('WARN', `⚠️ Stopping channel joins due to rate limit (${formatWaitTime(result.floodWait)} wait required)`);
        break; // Stop trying to join more channels
      }
      
      // Increased delay between joins to avoid rate limits
      await this.sleep(3000);
    }
    
    this.logger.log('INFO', `Successfully joined ${successCount}/${totalChannels} channels`);
    
    if (floodWaitDetected) {
      this.logger.log('INFO', `📊 Raw Telegram flood wait value: ${maxFloodWait} seconds`);
      this.logger.log('WARN', `⚠️ Telegram rate limit reached. Please wait ${formatWaitTime(maxFloodWait)} before trying again.`);
      // Emit flood wait event
      if (botChatId) {
        this.emit('floodWait', {
          chatId: botChatId,
          waitSeconds: maxFloodWait,
          joinedCount: successCount,
          totalCount: totalChannels
        });
      }
      return { success: false, floodWait: maxFloodWait, joinedCount: successCount };
    }
    
    // Additional delay after all joins to ensure they're processed by Telegram servers
    this.logger.log('INFO', 'Waiting for channel joins to be fully processed by Telegram...');
    await this.sleep(5000);
    
    return { success: true, floodWait: 0, joinedCount: successCount };
  }

  async joinChannelFromUrl(client, url, buttonText) {
    try {
      // Extract channel username from URL
      // URLs can be like: https://t.me/channelname or https://t.me/+inviteHash
      const match = url.match(/t\.me\/([^?]+)/);
      if (!match) {
        this.logger.log('WARN', `Could not parse channel URL: ${url}`);
        return { success: false, floodWait: 0 };
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
        return { success: true, floodWait: 0 };
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
          return { success: true, floodWait: 0 };
        }
      }
      return { success: false, floodWait: 0 };
    } catch (error) {
      // Check if already a member
      if (error.message && error.message.includes('USER_ALREADY_PARTICIPANT')) {
        this.logger.log('INFO', `ℹ️ Already a member of channel: ${buttonText}`);
        return { success: true, floodWait: 0 };
      }
      
      // Check for flood wait error
      if (error.message && error.message.includes('A wait of')) {
        const waitMatch = error.message.match(/A wait of (\d+) seconds/);
        const waitSeconds = waitMatch ? parseInt(waitMatch[1]) : 0;
        this.logger.log('INFO', `📊 Raw Telegram flood wait value: ${waitSeconds} seconds`);
        this.logger.log('WARN', `⏳ Telegram rate limit: Must wait ${formatWaitTime(waitSeconds)} before joining more channels`);
        return { success: false, floodWait: waitSeconds };
      }
      
      this.logger.log('ERROR', `Failed to join channel from ${url}: ${error.message}`);
      return { success: false, floodWait: 0 };
    }
  }

  async clickConfirmButton(client, bot, originalMessage) {
    try {
      // Get the last row (confirm button row)
      const lastRow = originalMessage.replyMarkup.rows[originalMessage.replyMarkup.rows.length - 1];
      const confirmButton = lastRow.buttons[0];

      this.logger.log('INFO', `Clicking confirm button: ${confirmButton.text}`);

      // Click the button by sending callback query
      const callbackAnswer = await client.invoke(
        new Api.messages.GetBotCallbackAnswer({
          peer: bot,
          msgId: originalMessage.id,
          data: confirmButton.data
        })
      );

      // Check if bot sent a popup alert
      if (callbackAnswer.alert) {
        this.logger.log('WARN', `⚠️ Bot popup alert: ${callbackAnswer.message}`);
        return { alert: true, message: callbackAnswer.message };
      }

      if (callbackAnswer.message) {
        this.logger.log('INFO', `Bot callback response: ${callbackAnswer.message}`);
      }
      
      this.logger.log('INFO', `✅ Confirm button clicked successfully`);
      
      return { alert: false, message: callbackAnswer.message };
    } catch (error) {
      if (error.message && error.message.includes('BOT_RESPONSE_TIMEOUT')) {
        this.logger.log('INFO', `✅ Confirm button clicked (timeout expected, bot will send media)`);
        return { alert: false };
      }
      this.logger.log('ERROR', `Failed to click confirm button: ${error.message}`);
      return null;
    }
  }

  async clickConfirmButtonAndForwardMedia(client, bot, originalMessage, originalSenderId, botChatId = null) {
    // Get the last row (confirm button row)
    const lastRow = originalMessage.replyMarkup.rows[originalMessage.replyMarkup.rows.length - 1];
    const confirmButton = lastRow.buttons[0];

    this.logger.log('INFO', `Clicking confirm button: ${confirmButton.text}`);

    // Start listening for media BEFORE clicking the button
    const mediaPromise = this.waitAndForwardMediaMessagesWithRetry(client, bot, originalSenderId, botChatId);

    // Give a tiny delay to ensure event handler is registered
    await new Promise(resolve => setImmediate(resolve));

    try {
      // Click the button by sending callback query
      await client.invoke(
        new Api.messages.GetBotCallbackAnswer({
          peer: bot,
          msgId: originalMessage.id,
          data: confirmButton.data
        })
      );
      this.logger.log('INFO', `✅ Confirm button clicked`);
    } catch (error) {
      if (error.message && error.message.includes('BOT_RESPONSE_TIMEOUT')) {
        this.logger.log('INFO', `✅ Confirm button clicked (bot didn't respond to callback, will send media)`);
      } else {
        this.logger.log('WARN', `Button click warning: ${error.message}`);
      }
    }

    // Wait for media collection to complete
    await mediaPromise;
  }

  async waitAndForwardMediaMessagesWithRetry(client, bot, originalSenderId, botChatId = null) {
    this.logger.log('INFO', `Starting media collection for bot: ${bot.id?.toString() || 'unknown'}`);
    this.logger.log('DEBUG', `Bot object type: ${typeof bot}, has id: ${!!bot.id}`);
    
    return new Promise((resolve) => {
      const mediaMessages = [];
      let lastMessageTime = Date.now();
      const mediaTimeout = 10000; // 10 seconds after last media message
      let mediaCount = 0;
      let retryAttempted = false;
      let totalMessagesReceived = 0;
      
      const checkTimeout = setInterval(() => {
        if (Date.now() - lastMessageTime > mediaTimeout) {
          clearInterval(checkTimeout);
          client.removeEventHandler(handler);
          this.logger.log('INFO', `Media collection complete: ${mediaMessages.length} media messages collected from ${totalMessagesReceived} total messages`);
          resolve({ mediaCount: mediaMessages.length, totalMessages: totalMessagesReceived });
        }
      }, 1000);

      const handler = async (event) => {
        try {
          const message = event.message;
          totalMessagesReceived++;
          
          const messageSenderId = message.senderId?.toString();
          const botId = bot.id?.toString();
          
          this.logger.log('DEBUG', `[${totalMessagesReceived}] Message from ${messageSenderId}, expecting ${botId}`);
          
          // Check if message is from the bot (handle both string and BigInt IDs)
          const isFromBot = messageSenderId === botId || 
                           message.senderId?.value?.toString() === botId ||
                           message.peerId?.userId?.toString() === botId;
          
          if (isFromBot) {
            this.logger.log('DEBUG', `[${totalMessagesReceived}] ✓ From target bot - photo: ${!!message.photo}, video: ${!!message.video}, document: ${!!message.document}`);
            lastMessageTime = Date.now();
            
            // Check if bot is sending join links again (retry scenario)
            if (!retryAttempted && message.replyMarkup && message.replyMarkup.rows) {
              this.logger.log('WARN', '⚠️ Bot sent join links again - channels may not have been joined properly');
              retryAttempted = true;
              
              // Re-join channels from the new message
              await this.joinChannelsFromButtons(client, message.replyMarkup, botChatId);
              
              // Click the confirm button again
              const lastRow = message.replyMarkup.rows[message.replyMarkup.rows.length - 1];
              const confirmButton = lastRow.buttons[0];
              
              this.logger.log('INFO', `Re-clicking confirm button: ${confirmButton.text}`);
              
              try {
                await client.invoke(
                  new Api.messages.GetBotCallbackAnswer({
                    peer: bot,
                    msgId: message.id,
                    data: confirmButton.data
                  })
                );
                this.logger.log('INFO', `✅ Confirm button re-clicked successfully`);
              } catch (error) {
                if (error.message && error.message.includes('BOT_RESPONSE_TIMEOUT')) {
                  this.logger.log('INFO', `✅ Confirm button re-clicked (timeout expected)`);
                } else {
                  this.logger.log('WARN', `Button re-click warning: ${error.message}`);
                }
              }
              
              // Reset timeout to wait for media after retry
              lastMessageTime = Date.now();
              return;
            }
            
            // Check if message has media (photo, video, or document)
            if (message.photo || message.video || message.document) {
              // Check if this is part of a media group/album
              const groupedId = message.groupedId?.toString();
              if (groupedId) {
                this.logger.log('DEBUG', `Media is part of group: ${groupedId}`);
              }
              
              mediaMessages.push(message);
              mediaCount++;
              
              const mediaType = message.photo ? 'photo' : message.video ? 'video' : 'document';
              this.logger.log('INFO', `📥 Received ${mediaType} from bot (${mediaCount} total)${groupedId ? ` [group: ${groupedId}]` : ''}`);
              
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
            } else {
              this.logger.log('DEBUG', `Message from bot has no media - text: "${message.text?.substring(0, 50) || 'none'}"`);
            }
          }
        } catch (error) {
          this.logger.log('ERROR', `Error in media handler: ${error.message}`);
        }
      };

      const { NewMessage } = require('telegram/events');
      this.logger.log('INFO', `Registering media event handler for bot ${bot.id.toString()}`);
      client.addEventHandler(handler, new NewMessage({}));
      this.logger.log('INFO', `Media event handler registered, waiting for media messages...`);
    });
  }

  async waitAndForwardMediaMessages(client, bot, originalSenderId, botChatId = null) {
    // Redirect to the retry-enabled version
    return this.waitAndForwardMediaMessagesWithRetry(client, bot, originalSenderId, botChatId);
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
