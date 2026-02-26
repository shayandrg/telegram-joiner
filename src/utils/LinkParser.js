class LinkParser {
  constructor() {
    // Regex pattern to match Telegram bot start links
    this.botLinkPattern = /https:\/\/t\.me\/([a-zA-Z0-9_]+)\?start=([a-zA-Z0-9_]+)/g;
  }

  extractBotLinks(messageText) {
    if (!messageText || typeof messageText !== 'string') {
      return [];
    }

    const links = [];
    let match;

    // Reset regex lastIndex to ensure fresh matching
    this.botLinkPattern.lastIndex = 0;

    while ((match = this.botLinkPattern.exec(messageText)) !== null) {
      const botLink = this.parseBotLink(match[0], match[1], match[2]);
      if (botLink) {
        links.push(botLink);
      }
    }

    return links;
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
