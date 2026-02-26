const Application = require('./lib/Application');
const Config = require('./utils/Config');

async function main() {
  try {
    // Load and validate configuration
    const config = new Config();
    config.validate();

    // Create and start application
    const app = new Application(config);
    await app.start();

  } catch (error) {
    console.error(`[ERROR] Fatal error: ${error.message}`);
    console.error(`[ERROR] Stack trace: ${error.stack}`);
    process.exit(1);
  }
}

// Handle uncaught exceptions at the top level
process.on('uncaughtException', (error) => {
  console.error(`[ERROR] Uncaught exception: ${error.message}`);
  console.error(`[ERROR] Stack trace: ${error.stack}`);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error(`[ERROR] Unhandled rejection at: ${promise}`);
  console.error(`[ERROR] Reason: ${reason}`);
  if (reason && reason.stack) {
    console.error(`[ERROR] Stack trace: ${reason.stack}`);
  }
  process.exit(1);
});

// Start the application
main();
