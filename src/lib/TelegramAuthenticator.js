const { TelegramClient } = require('telegram');
const { StringSession } = require('telegram/sessions');
const input = require('input');

class TelegramAuthenticator {
  constructor(apiId, apiHash, sessionManager, phoneNumber = null) {
    this.apiId = apiId;
    this.apiHash = apiHash;
    this.sessionManager = sessionManager;
    this.phoneNumber = phoneNumber;
    this.maxRetries = 3;
  }

  async authenticate() {
    // Try to load existing session
    const savedSession = this.sessionManager.loadSession();
    const session = savedSession ? new StringSession(savedSession) : new StringSession('');

    const client = new TelegramClient(session, this.apiId, this.apiHash, {
      connectionRetries: 5,
    });

    try {
      await client.start({
        phoneNumber: async () => {
          if (this.phoneNumber) {
            return this.phoneNumber;
          }
          return await this.promptPhoneNumber();
        },
        password: async () => await this.promptPassword(),
        phoneCode: async () => await this.promptPhoneCode(),
        onError: (err) => {
          console.error(`[ERROR] Authentication error: ${err.message}`);
        },
      });

      // Save session after successful authentication
      const sessionString = client.session.save();
      this.sessionManager.saveSession(sessionString);

      console.log('[INFO] Authentication successful');
      return client;
    } catch (error) {
      console.error(`[ERROR] Authentication failed: ${error.message}`);
      console.error(`[ERROR] Stack trace: ${error.stack}`);
      process.exit(1);
    }
  }

  async promptPhoneNumber() {
    let attempts = 0;
    while (attempts < this.maxRetries) {
      try {
        const phone = await input.text('Please enter your phone number (with country code): ');
        if (this.validatePhoneNumber(phone)) {
          return phone;
        }
        console.error('[ERROR] Invalid phone number format. Please include country code (e.g., +1234567890)');
        attempts++;
      } catch (error) {
        console.error(`[ERROR] Failed to read phone number: ${error.message}`);
        attempts++;
      }
    }
    throw new Error('Max retries exceeded for phone number input');
  }

  async promptPhoneCode() {
    let attempts = 0;
    while (attempts < this.maxRetries) {
      try {
        const code = await input.text('Please enter the authentication code: ');
        if (code && code.trim().length > 0) {
          return code.trim();
        }
        console.error('[ERROR] Invalid authentication code');
        attempts++;
      } catch (error) {
        console.error(`[ERROR] Failed to read authentication code: ${error.message}`);
        attempts++;
      }
    }
    throw new Error('Max retries exceeded for authentication code input');
  }

  async promptPassword() {
    let attempts = 0;
    while (attempts < this.maxRetries) {
      try {
        const password = await input.text('Please enter your 2FA password (press Enter if none): ');
        return password || '';
      } catch (error) {
        console.error(`[ERROR] Failed to read 2FA password: ${error.message}`);
        attempts++;
      }
    }
    throw new Error('Max retries exceeded for 2FA password input');
  }

  validatePhoneNumber(phone) {
    // Basic validation: should start with + and contain only digits after that
    const phoneRegex = /^\+\d{10,15}$/;
    return phoneRegex.test(phone);
  }
}

module.exports = TelegramAuthenticator;
