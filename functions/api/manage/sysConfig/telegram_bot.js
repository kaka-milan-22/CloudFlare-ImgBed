import { getDatabase } from '../../../utils/databaseAdapter.js';

export async function onRequest(context) {
    const { request, env } = context;

    const db = getDatabase(env);

    if (request.method === 'GET') {
        const settings = await getTelegramBotConfig(db, env)

        return new Response(JSON.stringify(settings), {
            headers: {
                'content-type': 'application/json',
            },
        })
    }

    if (request.method === 'POST') {
        const body = await request.json()
        const settings = body

        await db.put('manage@sysConfig@telegram_bot', JSON.stringify(settings))

        return new Response(JSON.stringify(settings), {
            headers: {
                'content-type': 'application/json',
            },
        })
    }
}

export async function getTelegramBotConfig(db, env) {
    const settings = {}
    const settingsStr = await db.get('manage@sysConfig@telegram_bot')
    const settingsKV = settingsStr ? JSON.parse(settingsStr) : {}

    const telegramBot = {}

    if (env.TG_BOT_TOKEN) {
        telegramBot.botToken = env.TG_BOT_TOKEN
        telegramBot.webhookSecret = env.TG_WEBHOOK_SECRET || generateWebhookSecret(env.TG_BOT_TOKEN)
        telegramBot.enabled = true
        telegramBot.savePath = 'environment variable'
    } else {
        if (settingsKV.botToken) {
            telegramBot.botToken = settingsKV.botToken
            telegramBot.webhookSecret = settingsKV.webhookSecret || generateWebhookSecret(settingsKV.botToken)
            telegramBot.enabled = settingsKV.enabled !== false
        } else {
            telegramBot.botToken = ''
            telegramBot.webhookSecret = ''
            telegramBot.enabled = false
        }
    }

    telegramBot.defaultFormats = settingsKV.defaultFormats || ['html', 'markdown']
    telegramBot.defaultUploadChannel = settingsKV.defaultUploadChannel || 'telegram'
    telegramBot.allowUserPreferences = settingsKV.allowUserPreferences !== false
    telegramBot.rateLimitPerMinute = settingsKV.rateLimitPerMinute || 10
    telegramBot.apiToken = settingsKV.apiToken || ''
    telegramBot.allowedFileTypes = settingsKV.allowedFileTypes || ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/svg+xml']
    telegramBot.maxFileSizeMB = settingsKV.maxFileSizeMB || 50

    settings.telegramBot = telegramBot

    return settings
}

function generateWebhookSecret(botToken) {
    if (!botToken) return ''
    return botToken.slice(-16)
}
