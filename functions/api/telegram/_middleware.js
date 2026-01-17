import { fetchTelegramBotConfig } from '../../utils/sysConfig.js';

export async function onRequestPost(context) {
    const { request, env, params } = context;

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
