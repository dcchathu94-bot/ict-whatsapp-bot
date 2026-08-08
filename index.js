require('dotenv').config();

// 🇱🇰 සර්වර් එකේ Timezone එක හරියටම ලංකාවේ වෙලාවට (Asia/Colombo) බලෙන් සකස් කිරීම
process.env.TZ = 'Asia/Colombo';

const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const qrcode = require('qrcode-terminal');
const http = require('http');
const cron = require('node-cron');
const admin = require('firebase-admin');

// Render / Cloud Server Port scan එක අසාර්ථක වීම වැළැක්වීමට HTTP Server එක
http.createServer((req, res) => res.end('Baileys WhatsApp Bot is Running!')).listen(process.env.PORT || 3000);

// 🔥 Firebase Admin SDK Initialize කිරීම
admin.initializeApp({
    credential: admin.credential.cert({
        // Render/Railway වල dynamic credentials සඳහා (මෙය default fallback එකකි)
        projectId: process.env.FIREBASE_DB_URL ? process.env.FIREBASE_DB_URL.split('//')[1].split('.')[0] : 'placeholder'
    }),
    databaseURL: process.env.FIREBASE_DB_URL
});

const db = admin.database();
const storeRef = db.ref('bot_store');
const historyRef = db.ref('mcq_history');

// 🔄 Firebase හරහා Local Store එක Load කිරීමේ Function එක
async function loadStore() {
    try {
        const snapshot = await storeRef.once('value');
        const data = snapshot.val();
        if (data) {
            return {
                lastQuestionExplanation: data.lastQuestionExplanation || null,
                askedQuestions: data.askedQuestions || []
            };
        }
    } catch (e) {
        console.error('Firebase Load Error:', e.message);
    }
    return { lastQuestionExplanation: null, askedQuestions: [] };
}

// 🔄 Firebase හරහා Local Store එක Save කිරීමේ Function එක
async function saveStore(data) {
    try {
        await storeRef.set(data);
    } catch (e) {
        console.error('Firebase Save Error:', e.message);
    }
}

// 📖 සියලුම ප්‍රශ්න Permanent Firebase History එකට සේව් කිරීමේ Function එක
async function appendToHistory(data) {
    try {
        const timeString = new Date().toLocaleString('en-US', { timeZone: 'Asia/Colombo' });
        const entry = {
            timestamp: timeString,
            question: data.question,
            options: data.options,
            correctAnswer: data.correctAnswer,
            explanation: data.explanation
        };
        await historyRef.push(entry);
        console.log('💾 ප්‍රශ්නය Firebase History එකට සාර්ථකව සේව් වුණා!');
    } catch (e) {
        console.error('Firebase History Save Error:', e.message);
    }
}

let cronStarted = false; // Cron job එක duplicate වීම වැළැක්වීමට

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
            console.log('\n--- අලුත් QR එක Scan කරන්න ---');
            qrcode.generate(qr, { small: true });
        }

        if (connection === 'close') {
            const shouldReconnect = (lastDisconnect.error?.output?.statusCode !== DisconnectReason.loggedOut);
            console.log('Connection closed, reconnecting...', shouldReconnect);
            if (shouldReconnect) {
                connectToWhatsApp();
            }
        } else if (connection === 'open') {
            console.log('✅ WhatsApp Bot සර්වර් එක සමඟ සාර්ථකව සම්බන්ධ වුණා!');
            
            if (!cronStarted) {
                cronStarted = true;
                // ⏱️ ලංකාවේ වෙලාවෙන් 3PM, 6PM, 9PM, 12AM ට ප්‍රශ්න යැවීම
                cron.schedule('0 15,18,21,0 * * *', () => {
                    console.log('⏰ නියමිත වෙලාව පැමිණ ඇත. Gemini AI ප්‍රශ්නය සකසමින් පවතී...');
                    sendDailyPollMCQ(sock);
                }, {
                    scheduled: true,
                    timezone: "Asia/Colombo"
                });
                
                console.log('⏰ ටයිමර් පද්ධතිය සාර්ථකව ක්‍රියාත්මකයි (3PM, 6PM, 9PM, 12AM).');
            }
        }
    });

    // 📌 Commands සඳහා Message Listener (!jid, !history සහ !test)
    sock.ev.on('messages.upsert', async ({ messages }) => {
        const m = messages[0];
        if (!m.message) return;
        
        const messageText = m.message.conversation || m.message.extendedTextMessage?.text;
        const chatJid = m.key.remoteJid;

        // Group/Chat JID එක ලබා ගැනීමට
        if (messageText === '!jid') {
            await sock.sendMessage(chatJid, { text: `📌 මෙම චැට් එකේ JID එක මෙන්න:\n\n\`${chatJid}\`` });
        }

        // 🚀 Manual Test Command - මැසේජ් යැවීම ක්ෂණිකව පරීක්ෂා කිරීමට
        if (messageText === '!test') {
            await sock.sendMessage(chatJid, { text: '🔄 ටෙස්ට් කිරීම ආරම්භ විය. Gemini AI මඟින් ප්‍රශ්නය සකසමින් පවතී...' });
            sendDailyPollMCQ(sock); 
        }

        // 📚 මෙතෙක් සේව් වුණු සියලුම MCQ ප්‍රශ්න එකතුව පෙළක් (Text) ලෙස ලබා ගැනීමට
        if (messageText === '!history') {
            try {
                const snapshot = await historyRef.once('value');
                const historyData = snapshot.val();
                
                if (historyData) {
                    let textContent = "📚 මෙතෙක් යවන ලද සියලුම ICT MCQ ප්‍රශ්න සහ පිළිතුරු එකතුව\n\n";
                    
                    Object.values(historyData).forEach(data => {
                        textContent += `==================================================\n` +
                                       `📅 දිනය: ${data.timestamp}\n` +
                                       `❓ ප්‍රශ්නය: ${data.question}\n` +
                                       `1. ${data.options[0]}\n` +
                                       `2. ${data.options[1]}\n` +
                                       `3. ${data.options[2]}\n` +
                                       `4. ${data.options[3]}\n\n` +
                                       `✅ නිවැරදි පිළිතුර: ${data.correctAnswer}\n` +
                                       `📖 පැහැදිලි කිරීම: ${data.explanation}\n` +
                                       `==================================================\n\n`;
                    });

                    // Buffer එකක් හරහා ෆයිල් එකක් සාදා WhatsApp එකට යැවීම (සර්වර් එකේ ෆයිල් සේව් නොවේ)
                    await sock.sendMessage(chatJid, {
                        document: Buffer.from(textContent, 'utf-8'),
                        mimetype: 'text/plain',
                        fileName: 'ICT_O_L_MCQ_History.txt',
                        caption: '📚 මෙතෙක් යවන ලද සියලුම ICT MCQ ප්‍රශ්න සහ පිළිතුරු එකතුව මෙන්න!'
                    });
                } else {
                    await sock.sendMessage(chatJid, { text: '⚠️ තවමත් කිසිදු ප්‍රශ්නයක් Firebase History එකට සේව් වී නොමැත.' });
                }
            } catch (err) {
                console.error('History command error:', err.message);
                await sock.sendMessage(chatJid, { text: '⚠️ History දත්ත ලබා ගැනීමේදී දෝෂයක් ඇතිවිය.' });
            }
        }
    });
}

// Native Fetch හරහා Gemini API එකෙන් MCQ ප්‍රශ්නය ලබා ගැනීම
async function generateMCQFromGemini() {
    const apiKey = process.env.GEMINI_API_KEY;
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent?key=${apiKey}`;

    const store = await loadStore();
    const previousQuestionsText = store.askedQuestions.length > 0 ?  
        `Avoid these recent questions strictly: ${JSON.stringify(store.askedQuestions.slice(-10))}` : '';

    const promptText = `You are a strict Sri Lankan GCE O/L ICT teacher. Your task is to generate ONE multiple-choice question (MCQ) in clean Sinhala.
CRITICAL RULE: The question MUST strictly belong ONLY to the official Sri Lankan GCE O/L ICT syllabus (Grade 10 Only). DO NOT include any Advanced Level (A/L) concepts.

${previousQuestionsText}

CRITICAL CREATIVITY RULE: 
DO NOT ask common or basic questions repeatedly. 
RANDOMLY pick a very specific, deeper sub-topic from the allowed areas below to ensure the questions are highly unique and challenging every single time.

Select the question strictly from ONE of these allowed areas:
1. Introduction to ICT & Data/Information (Focus on specific applications)
2. Evolution of computers (Focus on specific components of generations)
3. Data representation (Focus on calculation or specific codes)
4. Logic gates (Focus on complex truth tables or expressions)
5. Operating systems (Focus on specific management functions)
6. Word processing (Focus on specific formatting tools)
7. Spreadsheets (Focus on specific formulas like IF, COUNT, etc.)
8. Databases (Focus on Primary keys, data types)
9. Presentations (Focus on transitions, animations, views)

CRITICAL JSON FORMATTING RULES:
1. The response MUST be 100% valid JSON.
2. DO NOT use double quotes (") inside the Sinhala text values. Use single quotes (') if needed.

Return STRICTLY in this JSON format (no markdown blocks around it):
{
  "question": "Sinhala question text (Grade 10 O/L level only)",
  "options": ["ans1", "ans2", "ans3", "ans4"],
  "correctAnswer": "exact correct option text",
  "explanation": "short explanation in sinhala (do not use double quotes inside)"
}`;

    const requestBody = {
        contents: [{
            parts: [{ text: promptText }]
        }],
        generationConfig: {
            responseMimeType: "application/json",
            temperature: 0.8
        }
    };

    const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody)
    });

    const result = await response.json();

    if (!result.candidates || !result.candidates[0]?.content?.parts?.[0]?.text) {
        console.error('Gemini API දත්ත දෝෂයක්:', JSON.stringify(result));
        throw new Error('Gemini API response structure is invalid or empty');
    }

    const rawJSON = result.candidates[0].content.parts[0].text;
    const cleanedJSON = rawJSON.replace(/```json/g, '').replace(/```/g, '').trim();
    
    return JSON.parse(cleanedJSON);
}

// ගෲප් ලැයිස්තුවට Poll එක යැවීමේ Function එක
async function sendDailyPollMCQ(sock, retryCount = 0) {
    const MAX_RETRIES = 3;
    
    try {
        console.log('Gemini AI මඟින් 10 වසර පාඩම් වලින් අලුත්ම MCQ ප්‍රශ්නය සකසමින් පවතී...');
        
        const data = await generateMCQFromGemini();
        const store = await loadStore();

        // 📌 ප්‍රශ්න යැවීමට අවශ්‍ය WhatsApp Group වල JIDස්
        const targetGroups = [
            '120363429635141660@g.us', // My Group
            //'120363405905961234@g.us', // 2027 Gonadeniya
            //'120363422669823543@g.us', // 2027 Akshara
            //'120363404399183574@g.us', // 2027 Nasa
            //'120363046104457178@g.us', // 2027 Hayasko
        ];

        for (const targetJid of targetGroups) {
            // පසුගිය ප්‍රශ්නයේ පිළිතුරක් ඇත්නම් යැවීම
            if (store.lastQuestionExplanation) {
                const answerText = `💡 *පසුගිය ප්‍රශ්නයේ නිවැරදි පිළිතුර සහ විස්තරය:* \n\n✅ *හරි පිළිතුර:* ${store.lastQuestionExplanation.correctAnswer}\n📖 *පැහැදිලි කිරීම:* ${store.lastQuestionExplanation.explanation}`;
                await sock.sendMessage(targetJid, { text: answerText });
            }

            // අලුත් MCQ Poll එක යැවීම
            await sock.sendMessage(targetJid, {
                poll: {
                    name: data.question,
                    values: data.options,
                    selectableCount: 1
                }
            });
        }
        
        console.log('✅ සියලුම ගෲප් වෙත අලුත් MCQ Poll එක සහ පිළිතුර සාර්ථකව යැව්වා!');

        // 💾 1. Permanent Firebase History එකට සේව් කිරීම
        await appendToHistory(data);

        // 💾 2. Recent State එක Firebase එකට සේව් කිරීම
        if (!store.askedQuestions) store.askedQuestions = [];
        store.askedQuestions.push(data.question);
        if (store.askedQuestions.length > 30) {
            store.askedQuestions.shift(); // අසන ලද ප්‍රශ්න සීමාව 30 දක්වා වැඩි කළා
        }

        store.lastQuestionExplanation = {
            correctAnswer: data.correctAnswer,
            explanation: data.explanation
        };

        await saveStore(store);

    } catch (error) {
        console.error(`⚠️ දෝෂයක් ඇතිවිය (${retryCount + 1}/${MAX_RETRIES}):`, error.message);
        
        if (retryCount < MAX_RETRIES) {
            setTimeout(() => {
                console.log('🔄 මඟහැරුණු ප්‍රශ්නය යැවීමට නැවත උත්සාහ කරමින්...');
                sendDailyPollMCQ(sock, retryCount + 1);
            }, 30000);
        } else {
            console.error('❌ උපරිම උත්සාහයන් සංඛ්‍යාව පසුවිය. මෙම වටය සඳහා ප්‍රශ්නය යැවීම අත්හිටුවන ලදී.');
        }
    }
}

connectToWhatsApp();
