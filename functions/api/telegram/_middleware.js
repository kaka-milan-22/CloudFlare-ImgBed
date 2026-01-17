import { fetchTelegramBotConfig } from '../../utils/sysConfig.js';

export async function onRequest(context) {
    const { request, env, params } = context;

    // 只处理POST请求，其他请求方法直接返回405
    if (request.method !== 'POST') {
        return new Response('Method Not Allowed', { status: 405 });
    }

    const botConfig = await fetchTelegramBotConfig(env);

    if (!botConfig.telegramBot || !botConfig.telegramBot.enabled) {
        return new Response('Telegram Bot is not enabled', { status: 503 });
    }

    const expectedSecret = botConfig.telegramBot.webhookSecret;

    const url = new URL(request.url);
    const pathParts = url.pathname.split('/');
    const secretFromPath = pathParts[pathParts.length - 1];

    if (secretFromPath !== expectedSecret) {
        return new Response('Unauthorized', { status: 401 });
    }

    context.botConfig = botConfig;
    return context.next();
}
