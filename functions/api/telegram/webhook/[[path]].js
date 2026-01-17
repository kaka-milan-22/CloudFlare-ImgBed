import { TelegramBot } from '../../utils/telegramBot.js';
import { getDatabase } from '../../utils/databaseAdapter.js';
import { fetchTelegramBotConfig } from '../../utils/sysConfig.js';

async function handleTelegramMessage(context, message, bot, botConfig) {
    const { text, photo, document, from, chat } = message;
    const chatId = chat.id;

    if (text && text.startsWith('/')) {
        return await handleCommand(context, text, bot, chatId, botConfig);
    }

    if (photo || document) {
        return await handleFileUpload(context, message, bot, botConfig);
    }

    return new Response('OK');
}

async function handleCommand(context, text, bot, chatId, botConfig) {
    const parts = text.split(' ');
    const command = parts[0].toLowerCase();
    const args = parts.slice(1);

    switch (command) {
        case '/start':
            return await bot.sendPlain(chatId,
                '👋 Welcome! Send me an image and I\'ll upload it for you.\n\n' +
                'Use /help to see available commands.'
            );

        case '/help':
            return await bot.formatHelpMessage();

        case '/settings':
            if (args.length > 0) {
                return await handleSettingsCommand(bot, chatId, args);
            }
            return await bot.formatSettingsMessage(chatId);

        default:
            return await bot.sendPlain(chatId, '❌ Unknown command. Use /help to see available commands.');
    }
}

async function handleSettingsCommand(bot, chatId, args) {
    const formatStr = args[0];
    const channel = args[1];

    const validFormats = ['html', 'markdown', 'plain'];
    const validChannels = ['telegram', 'cfr2', 's3', 'discord', 'huggingface'];

    if (formatStr) {
        const formats = formatStr.toLowerCase().split(',').map(f => f.trim());
        const invalidFormats = formats.filter(f => !validFormats.includes(f));

        if (invalidFormats.length > 0) {
            return await bot.sendPlain(chatId,
                `❌ Invalid format(s): ${invalidFormats.join(', ')}\n` +
                `Valid formats: ${validFormats.join(', ')}`
            );
        }

        if (formats.length === 0) {
            return await bot.sendPlain(chatId, '❌ No formats specified.');
        }

        await bot.setUserPreferences(chatId, { formats });
        const channelText = channel ? `, using channel: ${channel}` : '';
        return await bot.sendPlain(chatId,
            `✅ Settings updated! Formats: ${formats.join(', ')}${channelText}`
        );
    }

    if (channel && !validChannels.includes(channel)) {
        return await bot.sendPlain(chatId,
            `❌ Invalid channel: ${channel}\n` +
            `Valid channels: ${validChannels.join(', ')}`
        );
    }

    if (channel) {
        await bot.setUserPreferences(chatId, { uploadChannel: channel });
        return await bot.sendPlain(chatId, `✅ Upload channel set to: ${channel}`);
    }

    return await bot.formatSettingsMessage(chatId);
}

async function handleFileUpload(context, message, bot, botConfig) {
    const { photo, document, from, chat } = message;
    const chatId = chat.id;
    const userId = from.id;

    const rateLimit = await bot.checkRateLimit(chatId, botConfig.telegramBot.rateLimitPerMinute);

    if (!rateLimit.allowed) {
        const resetTime = new Date(rateLimit.resetTime).toLocaleTimeString();
        return await bot.sendPlain(chatId,
            `⏱️ Rate limit exceeded. Try again after ${resetTime}.`
        );
    }

    let fileId;
    let fileName;
    let fileSize;
    let mimeType;

    if (photo) {
        const largestPhoto = photo.reduce((prev, current) =>
            (prev.file_size > current.file_size) ? prev : current
        );
        fileId = largestPhoto.file_id;
        fileName = `photo_${largestPhoto.file_unique_id}.jpg`;
        fileSize = largestPhoto.file_size;
        mimeType = 'image/jpeg';
    } else if (document) {
        fileId = document.file_id;
        fileName = document.file_name || `file_${document.file_unique_id}`;
        fileSize = document.file_size;
        mimeType = document.mime_type;
    }

    if (!botConfig.telegramBot.allowedFileTypes.includes(mimeType)) {
        return await bot.sendErrorMessage(chatId, 'invalid_file_type');
    }

    const maxSizeBytes = botConfig.telegramBot.maxFileSizeMB * 1024 * 1024;
    if (fileSize > maxSizeBytes) {
        return await bot.sendErrorMessage(chatId, 'file_too_large');
    }

    try {
        const fileResponse = await bot.downloadFile(fileId);

        if (!fileResponse.ok) {
            throw new Error('Failed to download file from Telegram');
        }

        const fileBlob = await fileResponse.blob();

        const formData = new FormData();
        formData.append('file', new File([fileBlob], fileName, { type: mimeType }));

        const url = new URL(context.request.url);
        const uploadUrl = `${url.origin}/upload`;

        const uploadParams = new URLSearchParams();
        const userPrefs = await bot.getUserPreferences(chatId);
        uploadParams.set('uploadChannel', userPrefs.uploadChannel || botConfig.telegramBot.defaultUploadChannel);
        uploadParams.set('returnFormat', 'full');
        uploadParams.set('authCode', botConfig.telegramBot.apiToken);

        const uploadResponse = await fetch(`${uploadUrl}?${uploadParams.toString()}`, {
            method: 'POST',
            body: formData
        });

        if (!uploadResponse.ok) {
            const errorText = await uploadResponse.text();
            console.error('Upload API error:', errorText);

            if (errorText.includes('Unauthorized') || errorText.includes('401')) {
                return await bot.sendErrorMessage(chatId, 'unauthorized');
            } else if (errorText.includes('quota') || errorText.includes('space')) {
                return await bot.sendErrorMessage(chatId, 'storage_full');
            }

            return await bot.sendErrorMessage(chatId, 'upload_failed');
        }

        const uploadResult = await uploadResponse.json();
        const imageUrl = uploadResult[0]?.src;

        if (!imageUrl) {
            throw new Error('No image URL returned from upload API');
        }

        await bot.sendResponse(chatId, imageUrl, userPrefs, fileName);

        return new Response('OK');
    } catch (error) {
        console.error('File upload error:', error);
        await bot.sendPlain(chatId, `❌ Error: ${error.message}`);
        return new Response('OK');
    }
}

async function handleCallbackQuery(context, callbackQuery, bot) {
    const { id, data, message } = callbackQuery;
    const chatId = message.chat.id;

    await bot.sendPlain(chatId, `You clicked: ${data}`);

    const apiUrl = `https://api.telegram.org/bot${bot.botToken}/answerCallbackQuery`;
    await fetch(apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ callback_query_id: id })
    });

    return new Response('OK');
}

export async function onRequest(context) {
    const { request, env, params } = context;

    // 只处理POST请求
    if (request.method !== 'POST') {
        return new Response('Method Not Allowed', { status: 405 });
    }

    const botConfig = await fetchTelegramBotConfig(env);

    if (!botConfig.telegramBot || !botConfig.telegramBot.enabled) {
        return new Response('Telegram Bot is not enabled', { status: 503 });
    }

    // 获取webhook secret从路径参数
    const secretFromPath = params.path;

    if (secretFromPath !== botConfig.telegramBot.webhookSecret) {
        return new Response('Unauthorized', { status: 401 });
    }

    const bot = new TelegramBot(botConfig.telegramBot.botToken, env);

    try {
        const update = await request.json();

        if (update.message) {
            return await handleTelegramMessage(context, update.message, bot, botConfig);
        }

        if (update.callback_query) {
            return await handleCallbackQuery(context, update.callback_query, bot);
        }

        return new Response('OK');
    } catch (error) {
        console.error('Error processing Telegram webhook:', error);
        return new Response('OK'); // Always return OK to Telegram to avoid retries
    }
}
