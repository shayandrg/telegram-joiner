class LinkParser {
  constructor() {
    // Regex pattern to match Telegram bot start links
    // Supports both t.me and telegram.me domains
    this.botLinkPattern = /https:\/\/(t|telegram)\.me\/([a-zA-Z0-9_]+)\?start=([a-zA-Z0-9_-]+)/g;
  }

  extractBotLinks(messageText, entities = null) {
    const links = [];

    // Extract from entities first (text_link, url types)
    if (entities && Array.isArray(entities)) {
      for (const entity of entities) {
        if (entity.url) {
          const botLink = this.parseBotLinkFromUrl(entity.url);
          if (botLink) {
            links.push(botLink);
          }
        }
      }
    }

    // Also extract from message text
    if (messageText && typeof messageText === 'string') {
      let match;
      this.botLinkPattern.lastIndex = 0;

      while ((match = this.botLinkPattern.exec(messageText)) !== null) {
        const botLink = this.parseBotLink(match[0], match[2], match[3]);
        if (botLink) {
          links.push(botLink);
        }
      }
    }

    return links;
  }

  parseBotLinkFromUrl(url) {
    if (!url || typeof url !== 'string') {
      return null;
    }

    // Match bot start links
    const match = url.match(/https:\/\/(t|telegram)\.me\/([a-zA-Z0-9_]+)\?start=([a-zA-Z0-9_-]+)/);
    if (match) {
      return this.parseBotLink(match[0], match[2], match[3]);
    }

    return null;
  }

  parseBotLink(url, botUsername, startParameter) {
    if (!botUsername || !startParameter) {
      return null;
    }

    return {
      botUsername: botUsername,
      startParameter: startParameter,
      originalUrl: url
    };
  }
}

module.exports = LinkParser;
