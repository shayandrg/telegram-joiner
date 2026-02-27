const { NewMessage } = require('telegram/events');
const EventEmitter = require('events');

class MessageMonitor extends EventEmitter {
  constructor(linkParser, logger) {
    super();
    this.linkParser = linkParser;
    this.logger = logger;
    this.isRunning = false;
  }

  async start(client) {
    if (this.isRunning) {
      return;
    }

    this.client = client;
    this.isRunning = true;

    // Register event handler for new messages
    this.client.addEventHandler(
      async (event) => await this.handleNewMessage(event),
      new NewMessage({})
    );

    this.logger.log('INFO', 'Message monitoring started');
  }

  async handleNewMessage(event) {
    try {
      const message = event.message;
      
      // Skip if no text content
      if (!message.text) {
        return;
      }

      const senderId = message.senderId?.toString() || 'unknown';
      const messageText = message.text;
      const preview = messageText.substring(0, 50) + (messageText.length > 50 ? '...' : '');

      // Log received message
      this.logger.log('INFO', `Message received from user:${senderId} - "${preview}"`);

      // Extract URLs from message entities (hidden links)
      const entityUrls = this.extractUrlsFromEntities(message);
      console.log('entityUrls', entityUrls)
      // Extract bot links from plain text
      const textBotLinks = this.linkParser.extractBotLinks(messageText);
      
      // Extract bot links from entities
      const entityBotLinks = this.linkParser.extractBotLinks(entityUrls.join(' '));
      
      // Combine and deduplicate
      const allBotLinks = [...textBotLinks, ...entityBotLinks];
      const uniqueBotLinks = this.deduplicateLinks(allBotLinks);

      // Emit event for each detected bot link
      for (const link of uniqueBotLinks) {
        this.logger.log('INFO', `Bot link detected: ${link.botUsername} (start=${link.startParameter})`);
        this.emit('botLinkDetected', { link, senderId });
      }
    } catch (error) {
      this.logger.log('ERROR', `Error processing message: ${error.message}`);
      this.logger.log('ERROR', `Stack trace: ${error.stack}`);
    }
  }

  extractUrlsFromEntities(message) {
    const urls = [];
    
    if (!message.entities || message.entities.length === 0) {
      return urls;
    }

    for (const entity of message.entities) {
      // Check for text links (MessageEntityTextUrl)
      if (entity.className === 'MessageEntityTextUrl' && entity.url) {
        urls.push(entity.url);
      }
      
      // Check for regular URLs (MessageEntityUrl)
      if (entity.className === 'MessageEntityUrl') {
        const url = message.text.substring(entity.offset, entity.offset + entity.length);
        urls.push(url);
      }
    }

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

  stop() {
    this.isRunning = false;
    this.logger.log('INFO', 'Message monitoring stopped');
  }
}

module.exports = MessageMonitor;
