const { formatWaitTime } = require('../utils/TimeFormatter');

class BotRequestHandler {
  constructor(client, botInteractionHandler, telegramBot, requestTracker, logger) {
    this.client = client;
    this.botInteractionHandler = botInteractionHandler;
    this.telegramBot = telegramBot;
    this.requestTracker = requestTracker;
    this.logger = logger;
    this.currentRequest = null;
    this.statusMessageId = null;
    this.pendingMediaForwards = [];
  }

  async handleRequest(request) {
    this.currentRequest = request;
    this.statusMessageId = null;
    this.pendingMediaForwards = [];
    
    try {
      // Send initial processing message and store message ID
      this.statusMessageId = await this.sendStatusUpdate(request.chatId, '🔄 Starting...');

      // Set up progress event listeners
      const channelProgressHandler = (data) => {
        if (data.chatId === request.chatId) {
          this.updateStatus(request.chatId, `🔗 Joining channel ${data.current}/${data.total}...`);
        }
      };

      const mediaProgressHandler = (data) => {
        if (data.chatId === request.chatId) {
          this.updateStatus(request.chatId, `📥 Receiving media ${data.current}...`);
        }
      };

      const mediaReceivedHandler = async (data) => {
        if (data.botChatId === request.chatId) {
          // Forward media from client to bot account
          const forwardPromise = this.forwardMediaToBotAccount(data.message);
          this.pendingMediaForwards.push(forwardPromise);
        }
      };

      const floodWaitHandler = (data) => {
        if (data.chatId === request.chatId) {
          this.updateStatus(
            request.chatId, 
            `⏳ Telegram rate limit reached!\n\n` +
            `Joined ${data.joinedCount}/${data.totalCount} channels.\n` +
            `Please wait ${formatWaitTime(data.waitSeconds)} before trying again.`
          );
        }
      };

      this.botInteractionHandler.on('channelProgress', channelProgressHandler);
      this.botInteractionHandler.on('mediaProgress', mediaProgressHandler);
      this.botInteractionHandler.on('mediaReceived', mediaReceivedHandler);
      this.botInteractionHandler.on('floodWait', floodWaitHandler);

      let rateLimitHit = false;

      // Process each bot link
      for (let i = 0; i < request.botLinks.length; i++) {
        const link = request.botLinks[i];
        
        this.logger.log('INFO', `Processing bot link ${i + 1}/${request.botLinks.length}: ${link.botUsername}`);
        
        if (request.botLinks.length > 1) {
          await this.updateStatus(
            request.chatId, 
            `📝 Processing link ${i + 1} of ${request.botLinks.length}...`
          );
        }

        // Process the bot link - botChatId is actually the bot account's user ID
        const response = await this.botInteractionHandler.interactWithBot(
          this.client,
          link,
          null,
          request.chatId
        );

        if (!response.success) {
          // Check if it's a flood wait error
          if (response.floodWait) {
            rateLimitHit = true;
            await this.updateStatus(
              request.chatId,
              `⏳ Telegram rate limit reached!\n\n` +
              `Please wait ${formatWaitTime(response.floodWait)} before trying again.`
            );
            // Don't process remaining links
            break;
          } else {
            await this.sendErrorMessage(request.chatId, link.botUsername, response.error);
          }
        }
      }

      // Only send completion message if no rate limit was hit
      if (!rateLimitHit) {
        // Wait for all media forwards to complete
        if (this.pendingMediaForwards.length > 0) {
          this.logger.log('INFO', `Waiting for ${this.pendingMediaForwards.length} media forwards to complete...`);
          await this.updateStatus(request.chatId, `📤 Forwarding ${this.pendingMediaForwards.length} file(s)...`);
          await Promise.all(this.pendingMediaForwards);
        }

        // Send completion message
        await this.updateStatus(request.chatId, `✅ Done! Forwarded ${this.pendingMediaForwards.length} file(s).`);
      }

      // Clean up event listeners
      this.botInteractionHandler.off('channelProgress', channelProgressHandler);
      this.botInteractionHandler.off('mediaProgress', mediaProgressHandler);
      this.botInteractionHandler.off('mediaReceived', mediaReceivedHandler);
      this.botInteractionHandler.off('floodWait', floodWaitHandler);

    } catch (error) {
      this.logger.log('ERROR', `Error handling request: ${error.message}`);
      await this.updateStatus(
        request.chatId,
        `❌ An error occurred: ${error.message}\n\nPlease try again later.`
      );
      throw error;
    } finally {
      this.currentRequest = null;
      this.statusMessageId = null;
      this.pendingMediaForwards = [];
    }
  }

  async sendStatusUpdate(chatId, status) {
    try {
      return await this.telegramBot.sendStatusUpdate(chatId, status);
    } catch (error) {
      this.logger.log('ERROR', `Failed to send status update: ${error.message}`);
      return null;
    }
  }

  async updateStatus(chatId, status) {
    try {
      if (this.statusMessageId) {
        await this.telegramBot.editMessage(chatId, this.statusMessageId, status);
      } else {
        this.statusMessageId = await this.sendStatusUpdate(chatId, status);
      }
    } catch (error) {
      this.logger.log('ERROR', `Failed to update status: ${error.message}`);
    }
  }

  async sendErrorMessage(chatId, botUsername, errorMessage) {
    const errorText = `❌ Error with bot @${botUsername}:\n${errorMessage}`;
    try {
      await this.telegramBot.sendMessage(chatId, errorText);
    } catch (error) {
      this.logger.log('ERROR', `Failed to send error message: ${error.message}`);
    }
  }

  async forwardMediaToBotAccount(message) {
    try {
      // Get bot account info
      const botAccount = await this.telegramBot.getBotInfo();
      
      if (!botAccount || !botAccount.username) {
        this.logger.log('ERROR', 'Failed to get bot account info or bot has no username');
        return;
      }

      // Resolve bot username to get proper entity
      const { Api } = require('telegram');
      const botEntity = await this.client.invoke(
        new Api.contacts.ResolveUsername({
          username: botAccount.username
        })
      );

      if (!botEntity.users || botEntity.users.length === 0) {
        this.logger.log('ERROR', 'Failed to resolve bot entity');
        return;
      }

      // Forward message but drop caption
      await this.client.forwardMessages(botEntity.users[0], {
        messages: [message.id],
        fromPeer: message.peerId,
        dropCaption: true
      });
      
      const mediaType = message.photo ? 'photo' : message.video ? 'video' : 'document';
      this.logger.log('INFO', `📤 Forwarded ${mediaType} to bot account @${botAccount.username} without caption`);
    } catch (error) {
      this.logger.log('ERROR', `Failed to forward media to bot account: ${error.message}`);
    }
  }


  onChannelsJoining(chatId) {
    this.sendStatusUpdate(chatId, '🔗 Joining required channels...');
  }

  onMediaRetrieving(chatId) {
    this.sendStatusUpdate(chatId, '📥 Retrieving content...');
  }

  onMediaSending(chatId) {
    this.sendStatusUpdate(chatId, '📤 Sending files...');
  }
}

module.exports = BotRequestHandler;
