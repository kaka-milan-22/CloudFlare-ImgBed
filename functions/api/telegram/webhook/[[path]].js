import { TelegramBot } from '../../../utils/telegramBot.js';
import { getDatabase } from '../../../utils/databaseAdapter.js';
import { fetchTelegramBotConfig } from '../../../utils/sysConfig.js';

async function handleTelegramMessage(context, message, bot, botConfig) {
    const { text, photo, document, from, chat } = message;
    const chatId = chat.id;

    const respondOk = async (promise) => {
        await promise;
        return new Response('OK');
    };

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
            await bot.sendPlain(chatId,
                '👋 Welcome! Send me an image and I\'ll upload it for you.\n\n' +
                'Use /help to see available commands.'
            );
            await bot.formatHelpMessage(chatId);
            return new Response('OK');

        case '/settings':
            if (args.length > 0) {
                  return await handleSettingsCommand(bot, chatId, args);
            }
            await bot.formatSettingsMessage(chatId);
            return new Response('OK');

        default:
            await bot.sendPlain(chatId, '❌ Unknown command. Use /help to see available commands.');
            return new Response('OK');
    }
}

async function handleSettingsCommand(bot, chatId, args) {
    const channel = (args[0] || '').toLowerCase();
    const validChannels = ['telegram', 'cfr2', 's3', 'discord', 'huggingface'];

    if (channel && !validChannels.includes(channel)) {
        await bot.sendPlain(chatId,
            `❌ Invalid channel: ${channel}\n` +
            `Valid channels: ${validChannels.join(', ')}`
        );
        return new Response('OK');
    }

    if (channel) {
        await bot.setUserPreferences(chatId, { uploadChannel: channel });
        await bot.sendPlain(chatId, `✅ Upload channel set to: ${channel}`);
        return new Response('OK');
    }

    await bot.formatSettingsMessage(chatId);
    return new Response('OK');
}

async function handleFileUpload(context, message, bot, botConfig) {
    const { photo, document, from, chat } = message;
    const chatId = chat.id;
    const userId = from.id;

    const rateLimit = await bot.checkRateLimit(chatId, botConfig.telegramBot.rateLimitPerMinute);

    if (!rateLimit.allowed) {
        const resetTime = new Date(rateLimit.resetTime).toLocaleTimeString();
        await bot.sendPlain(chatId,
            `⏱️ Rate limit exceeded. Try again after ${resetTime}.`
        );
        return new Response('OK');
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

    if (!mimeType && fileName) {
        const lowerName = fileName.toLowerCase();
        if (lowerName.endsWith('.heic')) {
            mimeType = 'image/heic';
        } else if (lowerName.endsWith('.heif')) {
            mimeType = 'image/heif';
        }
    }

    if (mimeType === 'application/octet-stream' && fileName) {
        const lowerName = fileName.toLowerCase();
        if (lowerName.endsWith('.heic')) {
            mimeType = 'image/heic';
        } else if (lowerName.endsWith('.heif')) {
            mimeType = 'image/heif';
        }
    }

    if (!botConfig.telegramBot.allowedFileTypes.includes(mimeType)) {
        await bot.sendErrorMessage(chatId, 'invalid_file_type');
        return new Response('OK');
    }

    const maxSizeBytes = botConfig.telegramBot.maxFileSizeMB * 1024 * 1024;
    if (fileSize > maxSizeBytes) {
        await bot.sendErrorMessage(chatId, 'file_too_large');
        return new Response('OK');
    }

    try {
        let fileBlob = null;
        let finalFileName = fileName;
        let finalMimeType = mimeType;

        if (isHeicType(mimeType, fileName)) {
            const converted = await tryConvertHeicToJpeg(bot, fileId);
            if (converted) {
                fileBlob = converted;
                finalFileName = replaceFileExtension(fileName, 'jpg');
                finalMimeType = 'image/jpeg';
            }
        }

        if (!fileBlob) {
            const fileResponse = await bot.downloadFile(fileId);

            if (!fileResponse.ok) {
                throw new Error('Failed to download file from Telegram');
            }

            fileBlob = await fileResponse.blob();
        }

        const formData = new FormData();
        formData.append('file', new File([fileBlob], finalFileName, { type: finalMimeType }));

        const url = new URL(context.request.url);
        const uploadUrl = `${url.origin}/upload`;

        const uploadParams = new URLSearchParams();
        const userPrefs = await bot.getUserPreferences(chatId);
        uploadParams.set('uploadChannel', userPrefs.uploadChannel || botConfig.telegramBot.defaultUploadChannel);
        uploadParams.set('returnFormat', 'full');
        const authToken = botConfig.telegramBot.apiToken;

        const uploadHeaders = {};
        if (authToken) {
            uploadHeaders.Authorization = `Bearer ${authToken}`;
        }

        const uploadResponse = await fetch(`${uploadUrl}?${uploadParams.toString()}`, {
            method: 'POST',
            headers: uploadHeaders,
            body: formData
        });

        if (!uploadResponse.ok) {
            const errorText = await uploadResponse.text();
            console.error('Upload API error:', errorText);

            if (errorText.includes('Unauthorized') || errorText.includes('401')) {
                await bot.sendErrorMessage(chatId, 'unauthorized');
                return new Response('OK');
            } else if (errorText.includes('quota') || errorText.includes('space')) {
                await bot.sendErrorMessage(chatId, 'storage_full');
                return new Response('OK');
            }

            await bot.sendErrorMessage(chatId, 'upload_failed');
            return new Response('OK');
        }

        const uploadResult = await uploadResponse.json();
        const imageUrl = uploadResult[0]?.src;

        if (!imageUrl) {
            throw new Error('No image URL returned from upload API');
        }

        await bot.sendResponse(chatId, imageUrl, userPrefs, finalFileName);

        return new Response('OK');
    } catch (error) {
        console.error('File upload error:', error);
        await bot.sendPlain(chatId, `❌ Error: ${error.message}`);
        return new Response('OK');
    }
}

function isHeicType(mimeType, fileName) {
    if (mimeType === 'image/heic' || mimeType === 'image/heif') {
        return true;
    }
    if (!fileName) return false;
    const lowerName = fileName.toLowerCase();
    return lowerName.endsWith('.heic') || lowerName.endsWith('.heif');
}

function replaceFileExtension(fileName, newExt) {
    if (!fileName) return `file.${newExt}`;
    const lastDot = fileName.lastIndexOf('.');
    if (lastDot === -1) {
        return `${fileName}.${newExt}`;
    }
    return `${fileName.slice(0, lastDot)}.${newExt}`;
}

async function tryConvertHeicToJpeg(bot, fileId) {
    try {
        const filePath = await bot.api.getFilePath(fileId);
        if (!filePath) return null;

        const fileUrl = `${bot.api.fileDomain}/file/bot${bot.botToken}/${filePath}`;
        const response = await fetch(fileUrl, {
            headers: bot.api.defaultHeaders,
            cf: {
                image: {
                    format: 'jpeg'
                }
            }
        });

        if (!response.ok) {
            return null;
        }

        const contentType = response.headers.get('content-type') || '';
        if (!contentType.toLowerCase().includes('image/jpeg')) {
            return null;
        }

        return await response.blob();
    } catch (error) {
        console.error('HEIC conversion failed:', error);
        return null;
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

    try {
        const botConfig = await fetchTelegramBotConfig(env);

        if (!botConfig.telegramBot || !botConfig.telegramBot.enabled) {
            return new Response('Telegram Bot is not enabled', { status: 503 });
        }

        // 获取webhook secret从路径参数
        const secretFromPath = Array.isArray(params?.path)
            ? params.path.join('/')
            : (params?.path || '');

        if (secretFromPath !== botConfig.telegramBot.webhookSecret) {
            return new Response('Unauthorized', { status: 401 });
        }

        const bot = new TelegramBot(botConfig.telegramBot.botToken, env);

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
