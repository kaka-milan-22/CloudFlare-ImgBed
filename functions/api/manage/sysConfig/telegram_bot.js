import { getDatabase } from '../../../utils/databaseAdapter.js';

export async function onRequest(context) {
    const {
      request,
      env,
      params,
      waitUntil,
      next,
      data,
    } = context;

    const db = getDatabase(env);

    if (request.method === 'GET') {
        const settings = await getTelegramBotConfig(db, env);

        return new Response(JSON.stringify(settings), {
            headers: {
                'content-type': 'application/json',
            },
        });
    }

    if (request.method === 'POST') {
        const settings = await getTelegramBotConfig(db, env);
        const body = await request.json();
        const newSettings = body;

        settings.telegramBot = newSettings.telegramBot || settings.telegramBot;

        await db.put('manage@sysConfig@telegram_bot', JSON.stringify(settings));

        return new Response(JSON.stringify(settings), {
            headers: {
                'content-type': 'application/json',
            },
        });
    }
}

export async function getTelegramBotConfig(db, env) {
    const settings = {};

    const settingsStr = await db.get('manage@sysConfig@telegram_bot');
    const settingsKV = settingsStr ? JSON.parse(settingsStr) : {};

    const telegramBot = {};

    if (env.TG_BOT_TOKEN) {
        telegramBot.botToken = env.TG_BOT_TOKEN;
        telegramBot.webhookSecret = env.TG_WEBHOOK_SECRET || generateWebhookSecret(env.TG_BOT_TOKEN);
        telegramBot.enabled = true;
        telegramBot.savePath = 'environment variable';
        telegramBot.fixed = true;
    } else {
        if (settingsKV.telegramBot?.botToken) {
            telegramBot.botToken = settingsKV.telegramBot.botToken;
            telegramBot.webhookSecret = settingsKV.telegramBot.webhookSecret || generateWebhookSecret(settingsKV.telegramBot.botToken);
            telegramBot.enabled = settingsKV.telegramBot.enabled !== false;
            telegramBot.fixed = false;
        } else {
            telegramBot.botToken = '';
            telegramBot.webhookSecret = '';
            telegramBot.enabled = false;
            telegramBot.fixed = false;
        }
    }

    telegramBot.defaultFormats = settingsKV.telegramBot?.defaultFormats || ['html', 'markdown'];
    telegramBot.defaultUploadChannel = settingsKV.telegramBot?.defaultUploadChannel || 'telegram';
    telegramBot.allowUserPreferences = settingsKV.telegramBot?.allowUserPreferences !== false;
    telegramBot.rateLimitPerMinute = settingsKV.telegramBot?.rateLimitPerMinute || 10;
    telegramBot.apiToken = settingsKV.telegramBot?.apiToken || '';
    telegramBot.allowedFileTypes = settingsKV.telegramBot?.allowedFileTypes || ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/svg+xml'];
    telegramBot.maxFileSizeMB = settingsKV.telegramBot?.maxFileSizeMB || 50;
    telegramBot.serverCompressEnabled = settingsKV.telegramBot?.serverCompressEnabled !== false;

    settings.telegramBot = telegramBot;

    return settings;
}

function generateWebhookSecret(botToken) {
    if (!botToken) return '';
    return botToken.slice(-16);
}
