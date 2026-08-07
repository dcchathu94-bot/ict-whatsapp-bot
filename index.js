require('dotenv').config();
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const qrcode = require('qrcode-terminal');
const http = require('http');
const cron = require('node-cron');
const fs = require('fs');

// Render / Cloud Server Port scan එක අසාර්ථක වීම වැළැක්වීමට HTTP Server එක
http.createServer((req, res) => res.end('Baileys WhatsApp Bot is Running!')).listen(process.env.PORT || 3000);

// 📁 Persistent Data Storage
const STORE_FILE = './store.json';
const HISTORY_FILE = './mcq_history.txt';

function loadStore() {
    try {
        if (fs.existsSync(STORE_FILE)) {
            const raw = fs.readFileSync(STORE_FILE, 'utf8');
            return JSON.parse(raw);
        }
    } catch (e) {
        console.error('Store Load Error:', e.message);
    }
    return { lastQuestionExplanation: null, askedQuestions: [] };
}

function saveStore(data) {
    try {
        fs.writeFileSync(STORE_FILE, JSON.stringify(data, null, 2), 'utf8');
    } catch (e) {
        console.error('Store Save Error:', e.message);
    }
}

// 📖 සියලුම ප්‍රශ්න Permanent History File එකට සේව් කිරීමේ Function එක
function appendToHistory(data) {
    try {
        const timeString = new Date().toLocaleString('en-US', { timeZone: 'Asia/Colombo' });
        const entry = `==================================================\n` +
                      `📅 දිනය සහ වේලාව: ${timeString}\n` +
                      `❓ ප්‍රශ්නය: ${data.question}\n` +
                      `1. ${data.options[0]}\n` +
                      `2. ${data.options[1]}\n` +
                      `3. ${data.options[2]}\n` +
                      `4. ${data.options[3]}\n\n` +
                      `✅ නිවැරදි පිළිතුර: ${data.correctAnswer}\n` +
                      `📖 පැහැදිලි කිරීම: ${data.explanation}\n` +
                      `==================================================\n\n`;

        fs.appendFileSync(HISTORY_FILE, entry, 'utf8');
        console.log('💾 ප්‍රශ්නය history file එකට සේව් වුණා!');
    } catch (e) {
        console.error('History Save Error:', e.message);
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

    // 📌 Commands සඳහා Message Listener (!jid සහ !history)
    sock.ev.on('messages.upsert', async ({ messages }) => {
        const m = messages[0];
        if (!m.message) return;
        
        const messageText = m.message.conversation || m.message.extendedTextMessage?.text;
        const chatJid = m.key.remoteJid;

        // Group/Chat JID එක ලබා ගැනීමට
        if (messageText === '!jid') {
            await sock.sendMessage(chatJid, { text: `📌 මෙම චැට් එකේ JID එක මෙන්න:\n\n\`${chatJid}\`` });
        }

        // 📚 මෙතෙක් සේව් වුණු සියලුම MCQ ප්‍රශ්න එකතුව Document එකක් ලෙස ලබා ගැනීමට
        if (messageText === '!history') {
            if (fs.existsSync(HISTORY_FILE)) {
                await sock.sendMessage(chatJid, {
                    document: { url: HISTORY_FILE },
                    mimetype: 'text/plain',
                    fileName: 'ICT_O_L_MCQ_History.txt',
                    caption: '📚 මෙතෙක් යවන ලද සියලුම ICT MCQ ප්‍රශ්න සහ පිළිතුරු එකතුව මෙන්න!'
                });
            } else {
                await sock.sendMessage(chatJid, { text: '⚠️ තවමත් කිසිදු ප්‍රශ්නයක් History එකට සේව් වී නොමැත.' });
            }
        }
    });
}

// Native Fetch හරහා Gemini API එකෙන් MCQ ප්‍රශ්නය ලබා ගැනීම
async function generateMCQFromGemini() {
    const apiKey = process.env.GEMINI_API_KEY;
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent?key=${apiKey}`;

    const store = loadStore();
    const previousQuestionsText = store.askedQuestions.length > 0 ?  
        `Avoid these recent questions: ${JSON.stringify(store.askedQuestions.slice(-5))}` : '';

    const promptText = `You are a strict Sri Lankan GCE O/L ICT teacher. Your task is to generate ONE multiple-choice question (MCQ) in clean Sinhala.
CRITICAL RULE: The question MUST strictly belong ONLY to the official Sri Lankan GCE O/L ICT syllabus (Grade 10 Only). DO NOT include any Advanced Level (A/L) concepts, programming languages like Python/Java, or complex topics not found in the official textbooks.

Select the question strictly from one of these allowed areas:
1. Introduction to ICT & Data/Information
2. Evolution of computers (Generations, History)
3. Data representation (Binary, ASCII, Unicode)
4. Logic gates (AND, OR, NOT, Truth tables)
5. Operating systems (Functions, File management)
6. Word processing (MS Word basics)
7. Spreadsheets (MS Excel formulas, functions)
8. Databases (MS Access tables, fields, types)
9. Presentations (MS PowerPoint basics)

${previousQuestionsText}

Return STRICTLY in this JSON format (no markdown blocks around it, just raw JSON):
{
  "question": "Sinhala question text (Grade 10 O/L level only)",
  "options": ["ans1", "ans2", "ans3", "ans4"],
  "correctAnswer": "exact correct option text",
  "explanation": "short explanation in sinhala"
}`;

    const requestBody = {
        contents: [{
            parts: [{ text: promptText }]
        }],
        generationConfig: {
            responseMimeType: "application/json",
            temperature: 0.3
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
        const store = loadStore();

        // 📌 ප්‍රශ්න යැවීමට අවශ්‍ය WhatsApp Group වල JIDස්
        const targetGroups = [
            '120363429635141660@g.us', // My Group
            '120363405905961234@g.us', // 2027 Gonadeniya
            '120363422669823543@g.us', // 2027 Akshara
            '120363404399183574@g.us', // 2027 Nasa
            '120363046104457178@g.us', // 2027 Hayasko
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

        // 💾 1. Permanent History File (mcq_history.txt) එකට එකතු කිරීම
        appendToHistory(data);

        // 💾 2. Recent State storage (store.json) එකට සේව් කිරීම
        store.askedQuestions.push(data.question);
        if (store.askedQuestions.length > 20) {
            store.askedQuestions.shift();
        }

        store.lastQuestionExplanation = {
            correctAnswer: data.correctAnswer,
            explanation: data.explanation
        };

        saveStore(store);

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
