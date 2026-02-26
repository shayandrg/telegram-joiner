class ErrorHandler {
  constructor(logger) {
    this.logger = logger;
    this.criticalErrorCount = 0;
    this.criticalErrorThreshold = 5;
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 10;
  }

  async handleNetworkError(error, reconnectCallback) {
    this.logger.log('ERROR', `Network error: ${error.message}`);
    this.logger.log('ERROR', `Stack trace: ${error.stack}`);

    // Attempt to reconnect with exponential backoff
    if (this.reconnectAttempts < this.maxReconnectAttempts) {
      const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30000);
      this.reconnectAttempts++;
      
      this.logger.log('INFO', `Attempting to reconnect in ${delay}ms (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})`);
      
      await this.sleep(delay);
      
      try {
        await reconnectCallback();
        this.reconnectAttempts = 0; // Reset on successful reconnection
        this.logger.log('INFO', 'Reconnection successful');
      } catch (reconnectError) {
        this.logger.log('ERROR', `Reconnection failed: ${reconnectError.message}`);
        await this.handleNetworkError(reconnectError, reconnectCallback);
      }
    } else {
      this.logger.log('ERROR', 'Max reconnection attempts reached');
      this.handleCriticalError(error);
    }
  }

  handleBotInteractionError(error, botUsername) {
    this.logger.log('ERROR', `Bot interaction failed for ${botUsername}: ${error.message}`);
    this.logger.log('ERROR', `Stack trace: ${error.stack}`);
    
    // Log but continue monitoring - don't let one bot failure stop the system
    this.logger.log('INFO', 'Continuing to monitor for new messages');
  }

  async handleConnectionLoss(reconnectCallback) {
    this.logger.log('ERROR', 'Telegram API connection lost');
    
    // Attempt to re-establish connection
    try {
      await reconnectCallback();
      this.logger.log('INFO', 'Connection re-established');
    } catch (error) {
      this.logger.log('ERROR', `Failed to re-establish connection: ${error.message}`);
      await this.handleNetworkError(error, reconnectCallback);
    }
  }

  logUnexpectedError(error, context = 'Unknown') {
    this.logger.log('ERROR', `Unexpected error in ${context}: ${error.message}`);
    this.logger.log('ERROR', `Stack trace: ${error.stack}`);
    
    this.criticalErrorCount++;
    
    if (this.criticalErrorCount >= this.criticalErrorThreshold) {
      this.handleCriticalError(error);
    }
  }

  handleCriticalError(error) {
    this.logger.log('ERROR', `Critical error threshold reached (${this.criticalErrorCount}/${this.criticalErrorThreshold})`);
    this.logger.log('ERROR', `Last error: ${error.message}`);
    this.logger.log('ERROR', `Stack trace: ${error.stack}`);
    this.logger.log('ERROR', 'Terminating application');
    
    process.exit(1);
  }

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  resetCriticalErrorCount() {
    this.criticalErrorCount = 0;
  }
}

module.exports = ErrorHandler;
