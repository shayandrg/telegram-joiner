class RequestTracker {
  constructor(logger) {
    this.logger = logger;
    // Map: targetBotId -> { endUserId, endUserChatId, timestamp }
    this.activeRequests = new Map();
  }

  addRequest(targetBotId, endUserId, endUserChatId) {
    this.activeRequests.set(targetBotId.toString(), {
      endUserId,
      endUserChatId,
      timestamp: Date.now()
    });
    this.logger.log('INFO', `Tracking request: Bot ${targetBotId} -> User ${endUserId}`);
  }

  getRequest(targetBotId) {
    return this.activeRequests.get(targetBotId.toString());
  }

  removeRequest(targetBotId) {
    const removed = this.activeRequests.delete(targetBotId.toString());
    if (removed) {
      this.logger.log('INFO', `Removed tracking for bot ${targetBotId}`);
    }
    return removed;
  }

  cleanup(maxAge = 600000) {
    // Remove requests older than maxAge (default 10 minutes)
    const now = Date.now();
    for (const [botId, request] of this.activeRequests.entries()) {
      if (now - request.timestamp > maxAge) {
        this.activeRequests.delete(botId);
        this.logger.log('INFO', `Cleaned up old request for bot ${botId}`);
      }
    }
  }
}

module.exports = RequestTracker;
