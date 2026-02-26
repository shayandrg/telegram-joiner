const fs = require('fs');
const path = require('path');

class SessionManager {
  constructor(sessionPath) {
    this.sessionPath = sessionPath;
    this.ensureSessionDirectory();
  }

  ensureSessionDirectory() {
    const dir = path.dirname(this.sessionPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  loadSession() {
    try {
      if (!fs.existsSync(this.sessionPath)) {
        return null;
      }

      const data = fs.readFileSync(this.sessionPath, 'utf8');
      const sessionData = JSON.parse(data);
      
      return sessionData.stringSession;
    } catch (error) {
      console.error(`[ERROR] Failed to load session: ${error.message}`);
      return null;
    }
  }

  saveSession(stringSession) {
    try {
      const sessionData = {
        stringSession: stringSession,
        lastUpdated: new Date().toISOString()
      };

      fs.writeFileSync(
        this.sessionPath,
        JSON.stringify(sessionData, null, 2),
        { mode: 0o600 }
      );

      // Ensure file permissions are set correctly
      fs.chmodSync(this.sessionPath, 0o600);
      
      return true;
    } catch (error) {
      console.error(`[ERROR] Failed to save session: ${error.message}`);
      return false;
    }
  }

  clearSession() {
    try {
      if (fs.existsSync(this.sessionPath)) {
        fs.unlinkSync(this.sessionPath);
      }
      return true;
    } catch (error) {
      console.error(`[ERROR] Failed to clear session: ${error.message}`);
      return false;
    }
  }
}

module.exports = SessionManager;
