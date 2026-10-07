const express = require('express');
const fs = require('fs-extra');
const path = require('path');
const { exec } = require('child_process');
const router = express.Router();
const pino = require('pino');
const { Octokit } = require('@octokit/rest');
const moment = require('moment-timezone');
const Jimp = require('jimp');
const crypto = require('crypto');
const axios = require('axios');
const yts = require("yt-search");

const { initUserEnvIfMissing } = require('./settingsdb');
const { initEnvsettings, getSetting } = require('./settings');

const autoReact = getSetting('AUTO_REACT') || 'on';

// ============================================
// FIX 1: Ondoa "default: makeWASocket"
// ============================================
const {
    makeWASocket,
    useMultiFileAuthState,
    delay,
    makeCacheableSignalKeyStore,
    Browsers,
    jidNormalizedUser,
    proto,
    prepareWAMessageMedia,
    generateWAMessageFromContent,
    downloadContentFromMessage
} = require('@whiskeysockets/baileys');

// ============================================
const config = {
    AUTO_VIEW_STATUS: 'true',
    AUTO_LIKE_STATUS: 'true',
    AUTO_RECORDING: 'true',
    AUTO_LIKE_EMOJI: ['🧩', '🍉', '💜', '🌟', '🪴', '💊', '💫', '🍂', '🌟', '🎋', '😶‍🌫️', '🫀', '🧿', '👀', '🇹🇿', '🚩', '🥰', '🗿', '💜', '💙', '🌝', '🖤', '💚'],
    PREFIX: '.',
    MAX_RETRIES: 3,
    GROUP_INVITE_LINK: 'https://chat.whatsapp.com/G3ChQEjwrdVBTBUQHWSNHF?mode=ems_copy_t',
    ADMIN_LIST_PATH: './admin.json',
    IMAGE_PATH: 'https://files.catbox.moe/2x9ktu.png',
    NEWSLETTER_JID: '120363398106360290@newsletter',
    NEWSLETTER_MESSAGE_ID: '0088',
    OTP_EXPIRY: 300000,
    NEWS_JSON_URL: '',
    BOT_NAME: '☭𝙻𝙾𝙵𝚃-𝚀𝚄𝙰𝙽𝚃𝚄𝙼☭',
    OWNER_NAME: '𝙻𝚘𝚏𝚝',
    OWNER_NUMBER: '255778018545',
    BOT_VERSION: '1.0.0',
    BOT_FOOTER: '> 𝚙𝚘𝚠𝚎𝚛𝚎𝚍 𝚋𝚢 𝚂𝚒𝚛 𝙻𝙾𝙵𝚃',
    CHANNEL_LINK: 'https://whatsapp.com/channel/0029Vb6B9xFCxoAseuG1g610',
    BUTTON_IMAGES: {
        ALIVE: 'https://files.catbox.moe/prrvct.png',
        MENU: 'https://files.catbox.moe/2x9ktu.png',
        OWNER: 'https://files.catbox.moe/prrvct.png',
        SONG: 'https://files.catbox.moe/2x9ktu.png',
        VIDEO: 'https://files.catbox.moe/prrvct.png'
    }
};

// ============================================
// FIX 2: replygckavi helper (ilikuwa haijulikani)
// ============================================
function makeReplier(socket, msg) {
    return async (text) => {
        try {
            await socket.sendMessage(msg.key.remoteJid, { text }, { quoted: msg });
        } catch (e) {
            console.error('Reply error:', e.message);
        }
    };
}

function generateListMessage(text, buttonTitle, sections) {
    return { text, footer: config.BOT_FOOTER, title: buttonTitle, buttonText: "ꜱᴇʟᴇᴄᴛ", sections };
}

function generateButtonMessage(content, buttons, image = null) {
    const message = { text: content, footer: config.BOT_FOOTER, buttons, headerType: 1 };
    if (image) {
        message.headerType = 4;
        message.image = typeof image === 'string' ? { url: image } : image;
    }
    return message;
}

const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });
const owner = process.env.GITHUB_REPO_OWNER;
const repo = process.env.GITHUB_REPO_NAME;

const activeSockets = new Map();
const socketCreationTime = new Map();
const SESSION_BASE_PATH = './session';
const NUMBER_LIST_PATH = './numbers.json';
const otpStore = new Map();

if (!fs.existsSync(SESSION_BASE_PATH)) {
    fs.mkdirSync(SESSION_BASE_PATH, { recursive: true });
}

function loadAdmins() {
    try {
        if (fs.existsSync(config.ADMIN_LIST_PATH)) {
            return JSON.parse(fs.readFileSync(config.ADMIN_LIST_PATH, 'utf8'));
        }
        return [];
    } catch (error) {
        console.error('Failed to load admin list:', error);
        return [];
    }
}

function formatMessage(title, content, footer) {
    return `${title}\n\n${content}\n\n${footer}`;
}

function generateOTP() {
    return Math.floor(100000 + Math.random() * 900000).toString();
}

function getSriLankaTimestamp() {
    return moment().tz('Asia/Colombo').format('YYYY-MM-DD HH:mm:ss');
}

async function cleanDuplicateFiles(number) {
    try {
        const sanitizedNumber = number.replace(/[^0-9]/g, '');
        const { data } = await octokit.repos.getContent({ owner, repo, path: 'session' });

        const sessionFiles = data.filter(file =>
            file.name.startsWith(`empire_${sanitizedNumber}_`) && file.name.endsWith('.json')
        ).sort((a, b) => {
            const timeA = parseInt(a.name.match(/empire_\d+_(\d+)\.json/)?.[1] || 0);
            const timeB = parseInt(b.name.match(/empire_\d+_(\d+)\.json/)?.[1] || 0);
            return timeB - timeA;
        });

        if (sessionFiles.length > 1) {
            for (let i = 1; i < sessionFiles.length; i++) {
                await octokit.repos.deleteFile({
                    owner, repo,
                    path: `session/${sessionFiles[i].name}`,
                    message: `Delete duplicate session file for ${sanitizedNumber}`,
                    sha: sessionFiles[i].sha
                });
                console.log(`Deleted duplicate session file: ${sessionFiles[i].name}`);
            }
        }
    } catch (error) {
        console.error(`Failed to clean duplicate files for ${number}:`, error.message);
    }
}

// ============================================
// FIX 3: oneViewmeg - Tumia downloadContentFromMessage
// ============================================
async function oneViewmeg(socket, isOwner, msg, sender) {
    if (!isOwner) return;
    try {
        const quot = msg.message;
        if (!quot) return;

        let mediaType = null;
        let mediaMsg = null;

        if (quot.imageMessage?.viewOnce) {
            mediaType = 'image';
            mediaMsg = quot.imageMessage;
        } else if (quot.videoMessage?.viewOnce) {
            mediaType = 'video';
            mediaMsg = quot.videoMessage;
        } else if (quot.audioMessage?.viewOnce) {
            mediaType = 'audio';
            mediaMsg = quot.audioMessage;
        } else if (quot.viewOnceMessageV2?.message?.imageMessage) {
            mediaType = 'image';
            mediaMsg = quot.viewOnceMessageV2.message.imageMessage;
        } else if (quot.viewOnceMessageV2?.message?.videoMessage) {
            mediaType = 'video';
            mediaMsg = quot.viewOnceMessageV2.message.videoMessage;
        } else if (quot.viewOnceMessageV2Extension?.message?.audioMessage) {
            mediaType = 'audio';
            mediaMsg = quot.viewOnceMessageV2Extension.message.audioMessage;
        }

        if (!mediaMsg) return;

        const cap = mediaMsg.caption || '';
        const stream = await downloadContentFromMessage(mediaMsg, mediaType);
        let buffer = Buffer.from([]);
        for await (const chunk of stream) buffer = Buffer.concat([buffer, chunk]);

        await socket.sendMessage(sender, { [mediaType]: buffer, caption: cap });
    } catch (error) {
        console.error('oneViewmeg error:', error.message);
    }
}

async function joinGroup(socket) {
    let retries = config.MAX_RETRIES;
    const inviteCodeMatch = config.GROUP_INVITE_LINK.match(/chat\.whatsapp\.com\/([a-zA-Z0-9]+)/);
    if (!inviteCodeMatch) {
        return { status: 'failed', error: 'Invalid group invite link' };
    }
    const inviteCode = inviteCodeMatch[1];

    while (retries > 0) {
        try {
            const response = await socket.groupAcceptInvite(inviteCode);
            if (response?.gid) {
                return { status: 'success', gid: response.gid };
            }
            throw new Error('No group ID in response');
        } catch (error) {
            retries--;
            let errorMessage = error.message || 'Unknown error';
            if (error.message.includes('not-authorized')) errorMessage = 'Bot is not authorized to join (possibly banned)';
            else if (error.message.includes('conflict')) errorMessage = 'Bot is already a member of the group';
            else if (error.message.includes('gone')) errorMessage = 'Group invite link is invalid or expired';
            if (retries === 0) return { status: 'failed', error: errorMessage };
            await delay(2000 * (config.MAX_RETRIES - retries));
        }
    }
    return { status: 'failed', error: 'Max retries reached' };
}

async function sendAdminConnectMessage(socket, number, groupResult) {
    const admins = loadAdmins();
    const caption = formatMessage(
        '*Connected Successful ✅*',
        `📞 Number: ${number}\n❤️ Status: Online`,
        `${config.BOT_FOOTER}`
    );

    for (const admin of admins) {
        try {
            await socket.sendMessage(`${admin}@s.whatsapp.net`, {
                image: { url: config.IMAGE_PATH },
                caption
            });
        } catch (error) {
            console.error(`Failed to send connect message to admin ${admin}:`, error.message);
        }
    }
}

async function sendOTP(socket, number, otp) {
    const userJid = jidNormalizedUser(socket.user.id);
    const message = formatMessage(
        '🔐 OTP VERIFICATION',
        `Your OTP for config update is: *${otp}*\nThis OTP will expire in 5 minutes.`,
        `${config.BOT_FOOTER}`
    );

    try {
        await socket.sendMessage(userJid, { text: message });
        console.log(`OTP ${otp} sent to ${number}`);
    } catch (error) {
        console.error(`Failed to send OTP to ${number}:`, error.message);
        throw error;
    }
}

function setupNewsletterHandlers(socket) {
    socket.ev.on('messages.upsert', async ({ messages }) => {
        const message = messages[0];
        if (!message?.key || message.key.remoteJid !== config.NEWSLETTER_JID) return;

        try {
            const emojis = ['🧩', '🍉', '💜', '🌟', '🪴', '🎂', '💫', '🔫', '🌟', '🎋', '😶‍🌫️', '🫀', '🧿', '👀', '💔', '🚩', '🥰', '😭', '💜', '💙', '🌝', '🖤', '💚'];
            const randomEmoji = emojis[Math.floor(Math.random() * emojis.length)];
            const messageId = message.newsletterServerId;

            if (!messageId) return;

            let retries = config.MAX_RETRIES;
            while (retries > 0) {
                try {
                    await socket.newsletterReactMessage(config.NEWSLETTER_JID, messageId.toString(), randomEmoji);
                    break;
                } catch (error) {
                    retries--;
                    if (retries === 0) throw error;
                    await delay(2000 * (config.MAX_RETRIES - retries));
                }
            }
        } catch (error) {
            console.error('Newsletter reaction error:', error.message);
        }
    });
}

async function setupStatusHandlers(socket) {
    socket.ev.on('messages.upsert', async ({ messages }) => {
        const message = messages[0];
        if (!message?.key || message.key.remoteJid !== 'status@broadcast' || !message.key.participant) return;

        try {
            if (autoReact === 'on') {
                await socket.sendPresenceUpdate("recording", message.key.remoteJid);
            }

            if (config.AUTO_VIEW_STATUS === 'true') {
                await socket.readMessages([message.key]);
            }

            if (config.AUTO_LIKE_STATUS === 'true') {
                const randomEmoji = config.AUTO_LIKE_EMOJI[Math.floor(Math.random() * config.AUTO_LIKE_EMOJI.length)];
                await socket.sendMessage(message.key.remoteJid, {
                    react: { text: randomEmoji, key: message.key }
                }, { statusJidList: [message.key.participant] });
            }
        } catch (error) {
            console.error('Status handler error:', error.message);
        }
    });
}

async function handleMessageRevocation(socket, number) {
    socket.ev.on('messages.delete', async ({ keys }) => {
        if (!keys || keys.length === 0) return;
        const messageKey = keys[0];
        const userJid = jidNormalizedUser(socket.user.id);
        const deletionTime = getSriLankaTimestamp();

        const message = formatMessage(
            '╭──◯',
            `✖ \`D E L E T E\`\n✖ *⦁ From :* ${messageKey.remoteJid}\n✖ *⦁ Time:* ${deletionTime}\n✖ *⦁ Type: Normal*\n╰──◯`,
            `${config.BOT_FOOTER}`
        );

        try {
            await socket.sendMessage(userJid, {
                image: { url: config.IMAGE_PATH },
                caption: message
            });
        } catch (error) {
            console.error('Failed to send deletion notification:', error.message);
        }
    });
}

async function resize(image, width, height) {
    let oyy = await Jimp.read(image);
    let kiyomasa = await oyy.resize(width, height).getBufferAsync(Jimp.MIME_JPEG);
    return kiyomasa;
}

function capital(string) {
    return string.charAt(0).toUpperCase() + string.slice(1);
}

const createSerial = (size) => crypto.randomBytes(size).toString('hex').slice(0, size);

async function SendSlide(socket, jid, newsItems) {
    let anu = [];
    for (let item of newsItems) {
        let imgBuffer;
        try {
            imgBuffer = await resize(item.thumbnail, 300, 200);
        } catch (error) {
            imgBuffer = await Jimp.read('https://files.catbox.moe/bupsfv.jpg');
            imgBuffer = await imgBuffer.resize(300, 200).getBufferAsync(Jimp.MIME_JPEG);
        }
        let imgsc = await prepareWAMessageMedia({ image: imgBuffer }, { upload: socket.waUploadToServer });
        anu.push({
            body: proto.Message.InteractiveMessage.Body.fromObject({
                text: `*${capital(item.title)}*\n\n${item.body}`
            }),
            header: proto.Message.InteractiveMessage.Header.fromObject({
                hasMediaAttachment: true,
                ...imgsc
            }),
            nativeFlowMessage: proto.Message.InteractiveMessage.NativeFlowMessage.fromObject({
                buttons: [
                    { name: "cta_url", buttonParamsJson: `{"display_text":"𝐃𝙴𝙿𝙻𝙾𝚈","url":"https://","merchant_url":"https://www.google.com"}` },
                    { name: "cta_url", buttonParamsJson: `{"display_text":"𝐂𝙾𝙽𝚃𝙰𝙲𝚃","url":"https://","merchant_url":"https://www.google.com"}` }
                ]
            })
        });
    }
    const msgii = await generateWAMessageFromContent(jid, {
        viewOnceMessage: {
            message: {
                messageContextInfo: { deviceListMetadata: {}, deviceListMetadataVersion: 2 },
                interactiveMessage: proto.Message.InteractiveMessage.fromObject({
                    body: proto.Message.InteractiveMessage.Body.fromObject({ text: "*Latest News Updates*" }),
                    carouselMessage: proto.Message.InteractiveMessage.CarouselMessage.fromObject({ cards: anu })
                })
            }
        }
    }, { userJid: jid });
    return socket.relayMessage(jid, msgii.message, { messageId: msgii.key.id });
}

async function fetchNews() {
    try {
        const response = await axios.get(config.NEWS_JSON_URL);
        return response.data || [];
    } catch (error) {
        return [];
    }
}

function setupCommandHandlers(socket, number) {
    socket.ev.on('messages.upsert', async ({ messages }) => {
        const msg = messages[0];
        if (!msg.message || msg.key.remoteJid === 'status@broadcast' || msg.key.remoteJid === config.NEWSLETTER_JID) return;

        // FIX: Tangaza reply function
        const replygckavi = makeReplier(socket, msg);

        let command = null;
        let args = [];
        let sender = msg.key.remoteJid;

        if (msg.message.conversation || msg.message.extendedTextMessage?.text) {
            const text = (msg.message.conversation || msg.message.extendedTextMessage.text || '').trim();
            if (text.startsWith(config.PREFIX)) {
                const parts = text.slice(config.PREFIX.length).trim().split(/\s+/);
                command = parts[0].toLowerCase();
                args = parts.slice(1);
            }
        } else if (msg.message.buttonsResponseMessage) {
            const buttonId = msg.message.buttonsResponseMessage.selectedButtonId;
            if (buttonId && buttonId.startsWith(config.PREFIX)) {
                const parts = buttonId.slice(config.PREFIX.length).trim().split(/\s+/);
                command = parts[0].toLowerCase();
                args = parts.slice(1);
            }
        }

        if (!command) return;

        try {
            switch (command) {
                case 'alive': {
                    const startTime = socketCreationTime.get(number) || Date.now();
                    const uptime = Math.floor((Date.now() - startTime) / 1000);
                    const hours = Math.floor(uptime / 3600);
                    const minutes = Math.floor((uptime % 3600) / 60);
                    const seconds = Math.floor(uptime % 60);

                    const title = '*ʟᴏꜰᴛ Qᴜᴀɴᴛᴜᴍ™*';
                    const content = `*ʟᴏꜰᴛ Qᴜᴀɴᴛᴜᴍ™*\n` +
                        `ʙᴏᴛ ᴏᴡɴᴇʀ :- *☭𝙻𝙾𝙵𝚃☭*\n` +
                        `*ʙᴏᴛ ɴᴀᴍᴇ :- ʟᴏꜰᴛ Qᴜᴀɴᴛᴜᴍ™ 𝚇𝟽\n` +
                        `*ʙᴏᴛ ᴡᴇʙ ꜱɪᴛᴇ*\n` +
                        `> *https*`;

                    await socket.sendMessage(sender, {
                        image: { url: config.BUTTON_IMAGES.ALIVE },
                        caption: formatMessage(title, content, config.BOT_FOOTER),
                        buttons: [
                            { buttonId: `${config.PREFIX}menu`, buttonText: { displayText: 'MENU' }, type: 1 },
                            { buttonId: `${config.PREFIX}ping`, buttonText: { displayText: 'PING' }, type: 1 }
                        ],
                        quoted: msg
                    });
                    break;
                }

                case 'menu': {
                    const startTime = socketCreationTime.get(number) || Date.now();
                    const uptime = Math.floor((Date.now() - startTime) / 1000);
                    const hours = Math.floor(uptime / 3600);
                    const minutes = Math.floor((uptime % 3600) / 60);
                    const seconds = Math.floor(uptime % 60);

                    await socket.sendMessage(sender, { react: { text: "🩷", key: msg.key } });

                    const title = `🌟 ʟᴏꜰᴛ Qᴜᴀɴᴛᴜᴍ™ 𝚇𝟽 🌟`;
                    const menuText = `
╭▰▰〔 *${title}* 〕▰▰╮
✖ 💠 *ʙᴏᴛ ɴᴀᴍᴇ:* ʟᴏꜰᴛ Qᴜᴀɴᴛᴜᴍ™ 𝚇𝟽
✖ 👑 *ᴏᴡɴᴇʀ:* ʟᴏꜰᴛ Qᴜᴀɴᴛᴜᴍ™
✖ ⚙️ *ᴠᴇʀꜱɪᴏɴ:* ᴠ𝟷 ʙᴇᴛᴀ
✖ 💻 *ᴘʟᴀᴛꜰᴏʀᴍ:* 𝚀𝚞𝚊𝚗𝚝𝚞𝚖 (𝚄𝚋𝚞𝚗𝚝𝚞 𝟸𝟸.𝟶𝟺)
✖ 🕐 *ᴜᴘᴛɪᴍᴇ:* ${hours}h ${minutes}m ${seconds}s
▰▰▰▰▰▰▰▰▰▰
 ꜰᴏʀ ᴍᴏʀᴇ ᴄᴏᴍᴍᴀɴᴅꜱ
 ᴅᴇᴘʟᴏʏ ᴘʀᴇᴍɪᴜᴍ
▰▰▰▰▰▰▰▰▰▰
✖  .𝚊𝚕𝚒𝚟𝚎 
✖  .𝚜𝚢𝚜𝚝𝚎𝚖
✖  .𝚙𝚒𝚗𝚐 
✖  .𝚓𝚒𝚍 
✖  .𝚠𝚎𝚊𝚝𝚑𝚎𝚛
✖  .𝚝𝚒𝚔𝚝𝚘𝚔
✖  .𝚘𝚠𝚗𝚎𝚛 
✖  .𝚙𝚊𝚒𝚛 𝟸𝟻𝟻𝚡𝚡𝚡
✖  .𝚒𝚐
✖  .freebot
▰▰▰▰▰▰▰▰▰▰`;

                    await socket.sendMessage(sender, {
                        image: { url: config.BUTTON_IMAGES.MENU },
                        caption: menuText,
                        footer: config.BOT_FOOTER
                    });
                    break;
                }

                case 'freebot': {
                    try {
                        await socket.sendMessage(msg.key.remoteJid, { react: { text: "🤖", key: msg.key } }, { quoted: msg });
                        const freebotMsg = `🌟 *CONNECT FREE BOT*\n\n` +
                            `To connect ʟᴏꜰᴛ Qᴜᴀɴᴛᴜᴍ™ 𝚇𝟽 to your WhatsApp:\n\n` +
                            `1. Visit our website\n` +
                            `2. Use the pairing system\n` +
                            `3. Get your personal bot instance\n\n` +
                            `_Contact owner for more info_`;
                        await replygckavi(freebotMsg);
                    } catch (e) {
                        await replygckavi("🚫 Error displaying freebot info.");
                    }
                    break;
                }

                case 'ping': {
                 