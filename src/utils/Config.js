class Config {
  constructor() {
    this.apiId = this.loadRequired('TELEGRAM_API_ID');
    this.apiHash = this.loadRequired('TELEGRAM_API_HASH');
    this.phoneNumber = this.loadOptional('TELEGRAM_PHONE', null);
    this.sessionPath = this.loadOptional('SESSION_PATH', './session/telegram-session.json');
    this.logLevel = this.loadOptional('LOG_LEVEL', 'info');
    this.botToken = this.loadOptional('TELEGRAM_BOT_TOKEN', null);
    this.maxQueueSize = parseInt(this.loadOptional('MAX_QUEUE_SIZE', '100'));
    this.requestTimeout = parseInt(this.loadOptional('REQUEST_TIMEOUT', '300000')); // 5 minutes
  }

  loadRequired(key) {
    const value = process.env[key];
    
    if (!value) {
      console.error(`[ERROR] Required environment variable ${key} is not set`);
      console.error(`[ERROR] Please set ${key} before running the application`);
      process.exit(1);
    }

    return value;
  }

  loadOptional(key, defaultValue) {
    return process.env[key] || defaultValue;
  }

  validate() {
    // Validate API ID is numeric
    if (isNaN(parseInt(this.apiId))) {
      console.error('[ERROR] TELEGRAM_API_ID must be a number');
      process.exit(1);
    }

    // Convert API ID to integer
    this.apiId = parseInt(this.apiId);

    // Validate log level
    const validLogLevels = ['error', 'warn', 'info'];
    if (!validLogLevels.includes(this.logLevel.toLowerCase())) {
      console.error(`[ERROR] Invalid LOG_LEVEL: ${this.logLevel}. Must be one of: ${validLogLevels.join(', ')}`);
      process.exit(1);
    }

    return true;
  }
}

module.exports = Config;
