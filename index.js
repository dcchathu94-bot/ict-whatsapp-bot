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
            console.log('✅ WhatsApp Bot සර්වර් එක සමඟ සාර්ථකව සම්බන්ධ වුණා!');
            
            // 📌 මෙන්න මේ තැනට තමයි කේතය දාන්න ඕන
            sock.ev.on('chats.set', ({ chats }) => {
                for (const chat of chats) {
                    if (chat.id.endsWith('@g.us')) {
                        console.log(`📌 Group Name: ${chat.subject} --> JID: ${chat.id}`);
                    }
                }
            });

            // සර්වර් එක සෙට්ල් වීමට තත්පර 10ක් දී පළමු MCQ එක යැවීම
            setTimeout(() => {
                sendDailyPollMCQ(sock);
            }, 10000);

            setInterval(() => {
                sendDailyPollMCQ(sock);
            }, 20 * 60 * 1000);
        }
    });

    sock.ev.on('messages.upsert', async ({ messages }) => {
        const m = messages[0];
        if (!m.message) return;
        
        const messageText = m.message.conversation || m.message.extendedTextMessage?.text;
        const chatJid = m.key.remoteJid;

        if (messageText === '!jid') {
            await sock.sendMessage(chatJid, { text: `📌 මෙම චැට් එකේ JID එක මෙන්න:\n\n\`${chatJid}\`` });
        }
    });
}

// Gemini AI මඟින් MCQ ප්‍රශ්නය, පිළිතුර සහ විස්තරය සකසා Poll එකක් ලෙස යැවීමේ Function එක
async function sendDailyPollMCQ(sock) {
    try {
        console.log('Gemini AI මඟින් 10/11 වසර පාඩම් වලින් අලුත්ම MCQ ප්‍රශ්නය සකසමින් පවතී...');
        
        const previousQuestionsText = askedQuestions.length > 0 ? 
            `Avoid these recent questions: ${JSON.stringify(askedQuestions.slice(-5))}` : '';

        const prompt = `Act as an expert O/L ICT Teacher in Sri Lanka. Generate ONE unique MCQ in clean Sinhala based on Grade 10 or 11 ICT syllabus from these topics: 1.Intro, 2.Evolution, 3.Data Rep, 4.Logic Gates, 5.OS, 6.MS Word, 7.Excel, 8.Access, 9.PowerPoint.
${previousQuestionsText}
Return STRICTLY valid JSON format:
{
  "question": "Sinhala question text",
  "options": ["ans1", "ans2", "ans3", "ans4"],
  "correctAnswer": "exact correct option text",
  "explanation": "short explanation in sinhala"
}`;

        const response = await ai.models.generateContent({
            model: 'gemini-3.6-flash',
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

       // 📌 ඔයාට ප්‍රශ්න යවන්න ඕන සියලුම WhatsApp Group වල JID මේ විදිහට එකතු කරන්න
        const targetGroups = [
            '120363429635141660@g.us', // 1 වන ගෲප් එක (දැන් දාලා තියෙන එක)
            // 2 වන ගෲප් එක (අවශ්‍ය නම් මෙතැනට දාන්න)
            // '1203634...another_id@g.us' // 3 වන ගෲප් එක...
        ];

        // සියලුම ගෲප් වෙත එකින් එක පණිවිඩ යැවීම
        for (const targetJid of targetGroups) {
            
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
        console.error('⚠️ දෝෂයක් ඇතිවිය. තත්පර 30කින් නැවත උත්සාහ කරයි...', error.message);
        
        setTimeout(() => {
            console.log('🔄 මඟහැරුණු ප්‍රශ්නය යැවීමට නැවත උත්සාහ කරමින්...');
            sendDailyPollMCQ(sock);
        }, 30000);
    }
}

connectToWhatsApp();
