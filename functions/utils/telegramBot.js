import { TelegramAPI } from './telegramAPI.js';
import { getDatabase } from './databaseAdapter.js';

export class TelegramBot {
    constructor(botToken, env) {
        this.botToken = botToken;
        this.env = env;
        this.api = new TelegramAPI(botToken);
    }

    escapeMarkdownV2(text) {
        return String(text).replace(/([_\*\[\]\(\)~`>#+\-=|{}.!])/g, '\\$1');
    }

    async sendResponse(chatId, url, userPreferences, fileName = '') {
        const formats = userPreferences.formats || ['html', 'markdown'];

        if (formats.includes('html')) {
            await this.sendPlain(chatId, url);
        }

        if (formats.includes('markdown')) {
            const altText = this.escapeMarkdownV2(fileName || 'image');
            const safeUrl = this.escapeMarkdownV2(url);
            await this.sendMarkdown(chatId, `![${altText}](${safeUrl})`);
        }
    }

    async sendMarkdown(chatId, text) {
        return await this.api.sendMessage(chatId, text, 'MarkdownV2');
    }

    async sendHtml(chatId, text) {
        return await this.api.sendMessage(chatId, text, 'HTML');
    }

    async sendPlain(chatId, text) {
        return await this.api.sendMessage(chatId, text);
    }

    async getUserPreferences(chatId) {
        const db = getDatabase(this.env);
        const prefStr = await db.get(`telegram_bot@preferences:${chatId}`);
        if (prefStr) {
            try {
                return JSON.parse(prefStr);
            } catch (e) {
                return this.getDefaultPreferences();
            }
        }
        return this.getDefaultPreferences();
    }

    async setUserPreferences(chatId, preferences) {
        const db = getDatabase(this.env);
        const merged = { ...this.getDefaultPreferences(), ...preferences };
        await db.put(`telegram_bot@preferences:${chatId}`, JSON.stringify(merged));
        return merged;
    }

    getDefaultPreferences() {
        return {
            formats: ['html', 'markdown'],
            uploadChannel: 'telegram'
        };
    }

    async downloadFile(fileId) {
        const filePath = await this.api.getFilePath(fileId);
        if (!filePath) {
            throw new Error('Failed to get file path');
        }
        return await this.api.getFileContent(fileId);
    }

    async checkRateLimit(chatId, limitPerMinute = 10) {
        const db = getDatabase(this.env);
        const now = Date.now();
        const oneMinuteAgo = now - 60000;

        const key = `telegram_bot@ratelimit:${chatId}`;
        const rateData = await db.get(key);

        if (rateData) {
            try {
                const data = JSON.parse(rateData);
                const recentCount = data.counts.filter(t => t > oneMinuteAgo).length;

                if (recentCount >= limitPerMinute) {
                    return {
                        allowed: false,
                        resetTime: data.counts[0] + 60000,
                        remaining: 0
                    };
                }

                data.counts.push(now);
                data.counts = data.counts.filter(t => t > oneMinuteAgo);
                await db.put(key, JSON.stringify(data));

                return {
                    allowed: true,
                    remaining: limitPerMinute - data.counts.length
                };
            } catch (e) {
                console.error('Rate limit check error:', e);
            }
        }

        const initialData = {
            counts: [now]
        };
        await db.put(key, JSON.stringify(initialData));

        return {
            allowed: true,
            remaining: limitPerMinute - 1
        };
    }

    async formatHelpMessage(chatId) {
        const text = `
🤖 <b>CloudFlare ImgBed Bot Help</b>

<b>Commands:</b>
/start - Start using the bot
/help - Show this help message
/settings - Configure your preferences

<b>Usage:</b>
Just send me an image and I'll upload it for you!

<b>Available output formats:</b>
• HTML - url
• Markdown - ![image](url)

<b>Settings:</b>
Use /settings to choose your preferred formats.
        `.trim();

        return await this.sendHtml(chatId, text);
    }

    async formatSettingsMessage(chatId) {
        const prefs = await this.getUserPreferences(chatId);

        const formatLabels = {
            html: '✅ HTML',
            markdown: '✅ Markdown',
            plain: '✅ Plain text'
        };

        const formatStatus = prefs.formats.map(f => formatLabels[f] || f).join('\n');

        const text = `
⚙️ <b>Your Settings</b>

<b>Output formats:</b>
${formatStatus}

<b>Upload channel:</b>
${prefs.uploadChannel}

<b>To change settings:</b>
/settings [formats] [channel]

Example:
/settings html,markdown telegram
/settings plain s3
        `.trim();

        return await this.sendHtml(chatId, text);
    }

    async sendErrorMessage(chatId, error) {
        const errorMessages = {
            'unauthorized': '❌ Authentication failed. Please contact admin.',
            'rate_limit': '⏱️ You are sending too many messages. Please wait a moment.',
            'file_too_large': '❌ File too large. Maximum size exceeded.',
            'invalid_file_type': '❌ Invalid file type. Only images are allowed.',
            'upload_failed': '❌ Upload failed. Please try again.',
            'storage_full': '❌ Storage quota exceeded. Please contact admin.'
        };

        const message = errorMessages[error] || `❌ Error: ${error}`;
        return await this.sendPlain(chatId, message);
    }
}
