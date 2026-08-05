const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const qrcode = require('qrcode-terminal');
const http = require('http');
const { GoogleGenAI } = require('@google/genai');

// Render Port scan එක අසාර්ථක වීම වැළැක්වීමට HTTP Server එක
http.createServer((req, res) => res.end('Baileys WhatsApp Bot is Running!')).listen(process.env.PORT || 3000);

// Gemini AI Setup
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

// කලින් දුන් ප්‍රශ්නේ උත්තරය සහ විස්තරය මතක තබා ගැනීමට Variable එකක්
let lastQuestionExplanation = null;

// එකම ප්‍රශ්නය නැවත ඒම වැළැක්වීමට ලැයිස්තුවක්
let askedQuestions = [];

async function connectToWhatsApp() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');
    
    const sock = makeWASocket({
        auth: state,
        printQRInTerminal: true
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;
        
        if (qr) {
            console.log('\n--- අලුත් QR CODE එක පහතින් ---');
            qrcode.generate(qr, { small: true });
        }

        if (connection === 'close') {
            const shouldReconnect = (lastDisconnect.error?.output?.statusCode !== DisconnectReason.loggedOut);
            console.log('Connection closed due to ', lastDisconnect.error, ', reconnecting ', shouldReconnect);
            if (shouldReconnect) {
                connectToWhatsApp();
            }
        } else if (connection === 'open') {
            console.log('✅ Baileys WhatsApp Bot සර්වර් එක සමඟ සාර්ථකව සම්බන්ධ වුණා!');
            
            // සර්වර් එක සෙට්ල් වීමට තත්පර 10ක් දී පළමු MCQ එක යැවීම
            setTimeout(() => {
                sendDailyPollMCQ(sock);
            }, 10000);

            // ළමයින්ගේ ගෲප් වලට යැවීමට නියමිත කාල පරතරය (දැන් විනාඩි 5කට වරක් ඇත. අවශ්‍ය නම් පැය 12කට හෝ 24කට වෙනස් කළ හැක)
            setInterval(() => {
                sendDailyPollMCQ(sock);
            }, 5 * 60 * 1000);
        }
    });
}

// Gemini AI මඟින් MCQ ප්‍රශ්නය, පිළිතුර සහ විස්තරය සකසා Poll එකක් ලෙස යැවීමේ Function එක
async function sendDailyPollMCQ(sock) {
    try {
        console.log('Gemini AI මඟින් 10/11 වසර පාඩම් වලින් අලුත්ම MCQ ප්‍රශ්නය සකසමින් පවතී...');
        
        const previousQuestionsText = askedQuestions.length > 0 ? 
            `Do NOT repeat any of these previously asked questions: ${JSON.stringify(askedQuestions)}` : '';

        const prompt = `ඔබ ශ්‍රී ලංකාවේ ප්‍රමුඛ ICT ගුරුවරයෙකි. ශ්‍රී ලංකාවේ 10/11 වසර ICT විෂය නිර්දේශයට අයත් O/L විභාග මට්ටමේ අද්විතීය බහුවරණ ප්‍රශ්නයක් (MCQ 1ක්) සකස් කරන්න.

        පහත සඳහන් පාඩම් 9 න් එකක් තෝරාගන්න:
        1. තොරතුරු හා සන්නිවේදන තාක්ෂණය පිළිබඳ හැඳින්වීම
        2. පරිගණකයේ විකාශනය
        3. දත්ත නිරූපණය
        4. තර්ක ද්වාර (Logic Gates)
        5. පරිගණක මෙහෙයුම් පද්ධති (Operating Systems)
        6. වදන් සැකසුම් (MS Word)
        7. විද්‍යුත් පැතුරුම්පත් (MS Excel)
        8. දත්ත සමුදාය (MS Access)
        9. විද්‍යුත් ඉදිරිපත් කිරීම් (MS PowerPoint)

        ${previousQuestionsText}

        අනිවාර්ය නීති:
        1. පෙළපොත් වල භාවිත වන නිවැරදි, පිරිසිදු සිංහල ව්‍යාකරණ භාවිත කරන්න.
        2. Output එක පහත JSON Format එකෙන් පමණක් ලබාදෙන්න:
        {
            "question": "ප්‍රශ්නය මෙතැනට",
            "options": ["පිළිතුර 1", "පිළිතුර 2", "පිළිතුර 3", "පිළිතුර 4"],
            "correctAnswer": "නිවැරදි පිළිතුර (options වල ඇති එකක්ම විය යුතුය)",
            "explanation": "නිවැරදි පිළිතුරට හේතුව කෙටියෙන්"
        }`;

        const response = await ai.models.generateContent({
            model: 'gemini-3.5-flash',
            contents: prompt,
            config: { 
                responseMimeType: "application/json",
                temperature: 0.3 
            }
        });

        const data = JSON.parse(response.text);

        // එකම ප්‍රශ්නය නැවත ඒම වැළැක්වීමට ලැයිස්තුවට එකතු කිරීම
        askedQuestions.push(data.question);
        if (askedQuestions.length > 20) {
            askedQuestions.shift();
        }

        // 📌 ඔබේ WhatsApp Group එකේ Invite Link එකේ අග කොටස මෙහි දාන්න
        const inviteCode = 'BEIq3cVzm5z0grQSsJFYac'; 

        // Invite Code එක හරහා ගෲප් එකේ JID එක ලබා ගැනීම
        const groupData = await sock.groupGetInfoFromInvite(inviteCode);
        const targetJid = groupData.id;

        if (targetJid) {
            // 1. කලින් ප්‍රශ්නයක් තිබුණා නම්, අලුත් ප්‍රශ්නයට පෙර එහි නිවැරදි පිළිතුර සහ විස්තරය යැවීම
            if (lastQuestionExplanation) {
                const answerText = `💡 *පසුගිය ප්‍රශ්නේ නිවැරදි පිළිතුර සහ විස්තරය:* \n\n✅ *හරි පිළිතුර:* ${lastQuestionExplanation.correctAnswer}\n📖 *පැහැදිලි කිරීම:* ${lastQuestionExplanation.explanation}`;
                await sock.sendMessage(targetJid, { text: answerText });
            }

            // 2. අලුත් MCQ Poll එක ගෲප් වෙත යැවීම
            await sock.sendMessage(targetJid, {
                poll: {
                    name: data.question,
                    values: data.options,
                    selectableCount: 1
                }
            });
            
            console.log('✅ ගෲප් වෙත අලුත් MCQ Poll එක සහ පිළිතුර සාර්ථකව යැව්වා!');
        }

        lastQuestionExplanation = {
            correctAnswer: data.correctAnswer,
            explanation: data.explanation
        };

    } catch (error) {
        console.error('⚠️ Time Out / AI තදබද දෝෂයක් ඇතිවිය. තත්පර 30කින් නැවත උත්සාහ කරයි...', error.message);
        
        // 🚨 මෙන්න Time-out එකකදී සර්වර් එක ක්‍රෑෂ් නොවී තත්පර 30කින් ස්වයංක්‍රීයව රිකවර් වන ආරක්ෂිත වැට (Auto-Retry)
        setTimeout(() => {
            console.log('🔄 මඟහැරුණු MCQ ප්‍රශ්නය යැවීමට නැවත උත්සාහ කරමින්...');
            sendDailyPollMCQ(sock);
        }, 30000);
    }
}

connectToWhatsApp();
