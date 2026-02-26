class OutputFormatter {
  constructor() {
    this.separator = '========================================';
  }

  printBotResponse(response) {
    const timestamp = response.timestamp.toISOString();
    
    console.log(`[${timestamp}] [OUTPUT] ${this.separator}`);
    console.log(`[${timestamp}] [OUTPUT] Bot: ${response.botUsername}`);
    console.log(`[${timestamp}] [OUTPUT] Response: ${response.responseText}`);
    console.log(`[${timestamp}] [OUTPUT] Time: ${timestamp}`);
    console.log(`[${timestamp}] [OUTPUT] ${this.separator}`);
  }

  printError(error, context) {
    const timestamp = new Date().toISOString();
    
    console.log(`[${timestamp}] [OUTPUT] ${this.separator}`);
    console.log(`[${timestamp}] [OUTPUT] Error in: ${context}`);
    console.log(`[${timestamp}] [OUTPUT] Error: ${error.message || error}`);
    
    if (error.stack) {
      console.log(`[${timestamp}] [OUTPUT] Stack trace: ${error.stack}`);
    }
    
    console.log(`[${timestamp}] [OUTPUT] ${this.separator}`);
  }
}

module.exports = OutputFormatter;
