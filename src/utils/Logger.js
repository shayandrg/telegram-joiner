class Logger {
  constructor(logLevel = 'INFO') {
    this.logLevel = logLevel.toUpperCase();
    this.levels = {
      'ERROR': 0,
      'WARN': 1,
      'INFO': 2
    };
  }

  log(level, message) {
    const levelUpper = level.toUpperCase();
    
    if (this.levels[levelUpper] <= this.levels[this.logLevel]) {
      const timestamp = new Date().toISOString();
      console.log(`[${timestamp}] [${levelUpper}] ${message}`);
    }
  }

  logStartup(version = '1.0.0') {
    const timestamp = new Date().toISOString();
    this.log('INFO', `Application started`);
    this.log('INFO', `Version: ${version}`);
    this.log('INFO', `Timestamp: ${timestamp}`);
  }

  logShutdown(reason = 'User requested') {
    this.log('INFO', `Application shutting down: ${reason}`);
  }

  logBotLinkDetected(botUsername, startParameter) {
    this.log('INFO', `Bot link detected: ${botUsername} (start=${startParameter})`);
  }

  logInteractionStatus(botUsername, success) {
    const status = success ? 'SUCCESS' : 'FAILURE';
    this.log('INFO', `Bot interaction completed: ${status} - ${botUsername}`);
  }
}

module.exports = Logger;
