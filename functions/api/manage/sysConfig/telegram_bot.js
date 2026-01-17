import { getDatabase } from '../../../utils/databaseAdapter.js';
import { validateApiToken } from '../../../utils/tokenValidator.js';
import { fetchSecurityConfig } from '../../../utils/sysConfig.js';

export async function onRequest(context) {
    const { request, env } = context;

    const db = getDatabase(env);

    if (request.method === 'OPTIONS') {
        return new Response(null, {
            status: 204,
            headers: {
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
                'Access-Control-Allow-Headers': 'Content-Type, Authorization',
                'Access-Control-Max-Age': '86400',
            }
        });
    }

    const authHeader = request.headers.get('Authorization');

    if (!authHeader) {
        const securityConfig = await fetchSecurityConfig(env);
        const basicUser = securityConfig.auth.admin.adminUsername;
        const basicPass = securityConfig.auth.admin.adminPassword;

        if (!basicUser || !basicPass) {
            return handleRequest(context, db);
        }

        return new Response('You need to login.', {
            status: 401,
            headers: {
                'WWW-Authenticate': 'Basic realm="My Realm", charset="UTF-8"',
                'Content-Type': 'text/plain;charset=UTF-8',
                'Cache-Control': 'no-store',
            },
        });
    }

    if (authHeader.startsWith('Bearer ')) {
        const token = authHeader.substring(7);
        const tokenValidation = await validateApiToken(request, db, null);

        if (!tokenValidation.valid) {
            return new Response('Invalid credentials.', {
                status: 401,
                headers: {
                    'Content-Type': 'text/plain;charset=UTF-8',
                    'Cache-Control': 'no-store',
                },
            });
        }

        return handleRequest(context, db);
    }

    if (authHeader.startsWith('Basic ')) {
        const securityConfig = await fetchSecurityConfig(env);
        const basicUser = securityConfig.auth.admin.adminUsername;
        const basicPass = securityConfig.auth.admin.adminPassword;

        if (!basicUser || !basicPass) {
            return handleRequest(context, db);
        }

        try {
            const buffer = Uint8Array.from(atob(authHeader.substring(6)), character => character.charCodeAt(0));
            const decoded = new TextDecoder().decode(buffer).normalize();
            const index = decoded.indexOf(':');

            if (index === -1) {
                return new Response('Invalid credentials.', { status: 401 });
            }

            const user = decoded.substring(0, index);
            const pass = decoded.substring(index + 1);

            if (basicUser !== user || basicPass !== pass) {
                return new Response('Invalid credentials.', { status: 401 });
            }
        } catch (e) {
            return new Response('Invalid credentials.', { status: 401 });
        }

        return handleRequest(context, db);
    }

    return new Response('Invalid credentials.', { status: 401 });
}

async function handleRequest(context, db) {
    const { request, env } = context;

    if (request.method === 'GET') {
        const settings = await getTelegramBotConfig(db, env);

        return new Response(JSON.stringify(settings), {
            headers: {
                'content-type': 'application/json',
            },
        });
    }

    if (request.method === 'POST') {
        const body = await request.json();
        const settings = body;

        await db.put('manage@sysConfig@telegram_bot', JSON.stringify(settings));

        return new Response(JSON.stringify(settings), {
            headers: {
                'content-type': 'application/json',
            },
        });
    }

    return new Response('Method Not Allowed', { status: 405 });
}

async function getTelegramBotConfig(db, env) {
    const settings = {};
    const settingsStr = await db.get('manage@sysConfig@telegram_bot');
    const settingsKV = settingsStr ? JSON.parse(settingsStr) : {};

    const telegramBot = {};

    if (env.TG_BOT_TOKEN) {
        telegramBot.botToken = env.TG_BOT_TOKEN;
        telegramBot.webhookSecret = env.TG_WEBHOOK_SECRET || generateWebhookSecret(env.TG_BOT_TOKEN);
        telegramBot.enabled = true;
        telegramBot.savePath = 'environment variable';
    } else {
        if (settingsKV.botToken) {
            telegramBot.botToken = settingsKV.botToken;
            telegramBot.webhookSecret = settingsKV.webhookSecret || generateWebhookSecret(settingsKV.botToken);
            telegramBot.enabled = settingsKV.enabled !== false;
        } else {
            telegramBot.botToken = '';
            telegramBot.webhookSecret = '';
            telegramBot.enabled = false;
        }
    }

    telegramBot.defaultFormats = settingsKV.defaultFormats || ['html', 'markdown'];
    telegramBot.defaultUploadChannel = settingsKV.defaultUploadChannel || 'telegram';
    telegramBot.allowUserPreferences = settingsKV.allowUserPreferences !== false;
    telegramBot.rateLimitPerMinute = settingsKV.rateLimitPerMinute || 10;
    telegramBot.apiToken = settingsKV.apiToken || '';
    telegramBot.allowedFileTypes = settingsKV.allowedFileTypes || ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/svg+xml'];
    telegramBot.maxFileSizeMB = settingsKV.maxFileSizeMB || 50;

    settings.telegramBot = telegramBot;

    return settings;
}

function generateWebhookSecret(botToken) {
    if (!botToken) return '';
    return botToken.slice(-16);
}
