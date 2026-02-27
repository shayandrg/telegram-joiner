const TelegramAuthenticator = require('./TelegramAuthenticator');
const SessionManager = require('./SessionManager');
const BotInteractionHandler = require('./BotInteractionHandler');
const TelegramBot = require('./TelegramBot');
const RequestQueue = require('./RequestQueue');
const BotRequestHandler = require('./BotRequestHandler');
const RequestTracker = require('./RequestTracker');
const LinkParser = require('../utils/LinkParser');
const Logger = require('../utils/Logger');
const ErrorHandler = require('../utils/ErrorHandler');

class Application {
  constructor(config) {
    this.config = config;
    this.logger = new Logger(config.logLevel);
    this.errorHandler = new ErrorHandler(this.logger);
    this.sessionManager = new SessionManager(config.sessionPath);
    this.linkParser = new LinkParser();
    this.botInteractionHandler = new BotInteractionHandler(this.logger);
    this.requestTracker = new RequestTracker(this.logger);
    
    // Bot interface components
    this.telegramBot = null;
    this.requestQueue = null;
    this.botRequestHandler = null;
    
    // Track media messages for auto-deletion
    this.mediaMessageTracker = new Map(); // chatId -> { messageIds: [], warningMessageId: null }
    
    this.client = null;
    this.isShuttingDown = false;
  }

  async start() {
    try {
      this.logger.logStartup('1.0.0');

      // Set up signal handlers for graceful shutdown
      this.setupSignalHandlers();

      // Authenticate with Telegram
      const authenticator = new TelegramAuthenticator(
        this.config.apiId,
        this.config.apiHash,
        this.sessionManager,
        this.config.phoneNumber
      );

      this.client = await authenticator.authenticate();

      // Initialize bot interface if token is provided
      if (this.config.botToken) {
        await this.initializeBotInterface();
        this.logger.log('INFO', 'Application is running. Send messages to your bot to process links.');
      } else {
        this.logger.log('ERROR', 'Bot token not provided. This application requires a bot token to function.');
        this.logger.log('ERROR', 'Please set TELEGRAM_BOT_TOKEN in your .env file');
        process.exit(1);
      }

      this.logger.log('INFO', 'Press Ctrl+C to stop');

    } catch (error) {
      this.errorHandler.logUnexpectedError(error, 'Application startup');
      throw error;
    }
  }

  async initializeBotInterface() {
    try {
      // Initialize bot components
      this.telegramBot = new TelegramBot(this.config.botToken, this.linkParser, this.logger);
      this.requestQueue = new RequestQueue(this.config.maxQueueSize, this.logger);
      this.botRequestHandler = new BotRequestHandler(
        this.client,
        this.botInteractionHandler,
        this.telegramBot,
        this.requestTracker,
        this.logger
      );

      // Wire up bot events
      this.telegramBot.on('requestReceived', async (request) => {
        // Store tracking info for each bot link
        for (const link of request.botLinks) {
          // Resolve bot to get its ID
          try {
            const { Api } = require('telegram');
            const result = await this.client.invoke(
              new Api.contacts.ResolveUsername({
                username: link.botUsername
              })
            );
            
            if (result.users && result.users.length > 0) {
              const targetBotId = result.users[0].id;
              this.requestTracker.addRequest(targetBotId, request.userId, request.chatId);
            }
          } catch (error) {
            this.logger.log('ERROR', `Failed to resolve bot ${link.botUsername}: ${error.message}`);
          }
        }

        const added = this.requestQueue.addRequest(request);
        if (!added) {
          this.telegramBot.sendMessage(
            request.chatId,
            '❌ Queue is full. Please try again later.'
          );
        }
      });

      // Track media messages for auto-deletion
      this.mediaMessageTracker = new Map(); // chatId -> { messageIds: [], warningMessageId: null }

      // Handle forwarded media from client to bot
      this.telegramBot.on('forwardedMediaReceived', async (data) => {
        const { message, targetBotId } = data;
        
        // Look up which user requested from this bot
        const request = this.requestTracker.getRequest(targetBotId);
        
        if (request) {
          this.logger.log('INFO', `Forwarding media from bot ${targetBotId} to user ${request.endUserId} without caption`);
          
          // Forward the message without caption
          try {
            let messageId = null;
            
            // Use bot API to send media without caption
            if (message.photo) {
              const photo = message.photo[message.photo.length - 1].file_id;
              messageId = await this.telegramBot.sendPhoto(request.endUserChatId, photo);
            } else if (message.video) {
              messageId = await this.telegramBot.sendVideo(request.endUserChatId, message.video.file_id);
            } else if (message.document) {
              messageId = await this.telegramBot.sendDocument(request.endUserChatId, message.document.file_id);
            } else {
              this.logger.log('WARN', `Unknown media type in message ${message.message_id}`);
            }

            // Track the sent media message ID for auto-deletion
            if (messageId) {
              const chatId = request.endUserChatId;
              if (!this.mediaMessageTracker.has(chatId)) {
                this.mediaMessageTracker.set(chatId, { messageIds: [], warningMessageId: null });
              }
              this.mediaMessageTracker.get(chatId).messageIds.push(messageId);
              this.logger.log('INFO', `Tracked media message ${messageId} for auto-deletion in chat ${chatId}`);
            }
          } catch (error) {
            this.logger.log('ERROR', `Failed to forward to end user: ${error.message}`);
          }
        } else {
          this.logger.log('WARN', `No request found for bot ${targetBotId}`);
        }
      });

      // Wire up queue events
      this.requestQueue.on('requestStarted', async (request) => {
        try {
          await this.botRequestHandler.handleRequest(request);
          this.requestQueue.markProcessingComplete();
        } catch (error) {
          this.requestQueue.markProcessingFailed(error);
        }
      });

      this.requestQueue.on('requestCompleted', async (request) => {
        this.logger.log('INFO', `Request completed for bot user ${request.userId}`);
        
        // Send warning and schedule auto-deletion of media messages
        const chatId = request.chatId;
        if (this.mediaMessageTracker.has(chatId)) {
          const tracker = this.mediaMessageTracker.get(chatId);
          
          if (tracker.messageIds.length > 0) {
            try {
              // Send warning message
              const warningText = '⚠️ Media will be automatically deleted in 20 seconds.';
              const warningMessageId = await this.telegramBot.sendMessage(chatId, warningText);
              tracker.warningMessageId = warningMessageId;
              
              this.logger.log('INFO', `Sent deletion warning to chat ${chatId}, scheduling deletion in 20 seconds`);
              
              // Schedule deletion after 20 seconds
              setTimeout(async () => {
                const messageIds = [...tracker.messageIds];
                const warningId = tracker.warningMessageId;
                
                // Delete all media messages
                for (const messageId of messageIds) {
                  await this.telegramBot.deleteMessage(chatId, messageId);
                }
                
                // Delete warning message
                if (warningId) {
                  await this.telegramBot.deleteMessage(chatId, warningId);
                }
                
                // Clean up tracker
                this.mediaMessageTracker.delete(chatId);
                this.logger.log('INFO', `Deleted ${messageIds.length} media message(s) and warning from chat ${chatId}`);
              }, 20000); // 20 seconds
            } catch (error) {
              this.logger.log('ERROR', `Failed to send warning or schedule deletion: ${error.message}`);
            }
          }
        }
        
        // Clean up tracking after a delay (to allow media to arrive)
        setTimeout(() => {
          for (const link of request.botLinks) {
            // Cleanup will happen via periodic cleanup
          }
        }, 60000); // 1 minute
      });

      this.requestQueue.on('requestFailed', async (request, error) => {
        this.logger.log('ERROR', `Request failed for bot user ${request.userId}: ${error.message}`);
        await this.telegramBot.sendMessage(
          request.chatId,
          `❌ Request failed: ${error.message}`
        );
      });

      this.requestQueue.on('queueFull', async (request) => {
        await this.telegramBot.sendMessage(
          request.chatId,
          '❌ Queue is full. Please try again later.'
        );
      });

      // Start periodic cleanup of old requests
      setInterval(() => {
        this.requestTracker.cleanup();
      }, 60000); // Every minute

      // Start the bot
      await this.telegramBot.start();
      this.logger.log('INFO', 'Bot interface initialized successfully');

    } catch (error) {
      this.logger.log('ERROR', `Failed to initialize bot interface: ${error.message}`);
      throw error;
    }
  }

  setupSignalHandlers() {
    process.on('SIGINT', () => this.shutdown('SIGINT received'));
    process.on('SIGTERM', () => this.shutdown('SIGTERM received'));
    
    process.on('uncaughtException', (error) => {
      this.logger.log('ERROR', `Uncaught exception: ${error.message}`);
      this.logger.log('ERROR', `Stack trace: ${error.stack}`);
      this.shutdown('Uncaught exception');
    });

    process.on('unhandledRejection', (reason, promise) => {
      this.logger.log('ERROR', `Unhandled rejection at: ${promise}, reason: ${reason}`);
      if (reason && reason.stack) {
        this.logger.log('ERROR', `Stack trace: ${reason.stack}`);
      }
    });
  }

  async shutdown(reason) {
    if (this.isShuttingDown) {
      return;
    }

    this.isShuttingDown = true;
    this.logger.logShutdown(reason);

    try {
      // Stop bot
      if (this.telegramBot) {
        this.telegramBot.stop();
        this.logger.log('INFO', 'Telegram bot stopped');
      }

      // Disconnect client
      if (this.client) {
        await this.client.disconnect();
        this.logger.log('INFO', 'Telegram client disconnected');
      }

      this.logger.log('INFO', 'Shutdown complete');
      process.exit(0);
    } catch (error) {
      this.logger.log('ERROR', `Error during shutdown: ${error.message}`);
      process.exit(1);
    }
  }
}

module.exports = Application;
