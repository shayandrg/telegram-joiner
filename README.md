# Telegram Bot Auto Starter

Automatically detect and interact with Telegram bot start links.

## Features

- 🤖 Auto-detect bot links in messages
- 🚀 Auto-interact with bots
- 🔗 Auto-join required channels
- 📥 Auto-retrieve and forward media
- 🤖 Telegram Bot API for end users
- � Dotcker support

## Quick Start


`.env` file:
```env
TELEGRAM_API_ID=your_api_id
TELEGRAM_API_HASH=your_api_hash
TELEGRAM_BOT_TOKEN=your_bot_token  # Optional
```

3. Run with Docker:
```bash
# First run (authentication)
docker-compose run --rm telegram-bot-starter

# Normal run
docker-compose up -d
```

Or run directly:
```bash
npm install
npm start
```

## Usage

**Client Mode**: Monitors your personal Telegram for bot links

**Bot Mode**: Provides a bot that users can send links to

Both modes can run simultaneously.

## License

MIT
