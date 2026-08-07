require('dotenv').config();
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const qrcode = require('qrcode-terminal');
const http = require('http');
const cron = require('node-cron');

// Render Port scan එක අසාර්ථක වීම වැළැක්වීමට HTTP Server එක
http.createServer((req, res) => res.end('Baileys WhatsApp Bot is Running!')).listen(process.env.PORT || 3000);

let lastQuestionExplanation = null;
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
            
            // ⏱️ 3PM, 6PM, 9PM, 12AM ට ප්‍රශ්න යැවීම (Cron Job)
            cron.schedule('0 15,18,21,0 * * *', () => {
                console.log('⏰ නියමිත වෙලාව පැමිණ ඇත. Gemini AI ප්‍රශ්නය සකසමින් පවතී...');
                sendDailyPollMCQ(sock);
            }, {
                scheduled: true,
                timezone: "Asia/Colombo"
            });
            
            console.log('⏰ ටයිමර් පද්ධතිය සාර්ථකව ක්‍රියාත්මකයි (3PM, 6PM, 9PM, 12AM).');
        }
    });

    // 📌 ගෲප් JID ලබා ගැනීමට '!jid' විධානය
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

// Native Fetch හරහා Gemini API එකෙන් MCQ ප්‍රශ්නය ආරක්ෂිතව ලබා ගැනීම
async function generateMCQFromGemini() {
    const apiKey = process.env.GEMINI_API_KEY;
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent?key=${apiKey}`;

    const previousQuestionsText = askedQuestions.length > 0 ?  
        `Avoid these recent questions: ${JSON.stringify(askedQuestions.slice(-5))}` : '';

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
  "question": "Sinhala question text (Grade 10/11 O/L level only)",
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

    // 🛡️ Safe check: API එකෙන් නිවැරදිව ප්‍රතිචාරයක් ලැබී ඇත්දැයි පරීක්ෂා කිරීම
    if (!result.candidates || !result.candidates[0]?.content?.parts?.[0]?.text) {
        console.error('Gemini API දත්ත දෝෂයක්:', JSON.stringify(result));
        throw new Error('Gemini API response structure is invalid or empty');
    }

    const rawJSON = result.candidates[0].content.parts[0].text;
    const cleanedJSON = rawJSON.replace(/```json/g, '').replace(/```/g, '').trim();
    
    return JSON.parse(cleanedJSON);
}

// ගෲප් ලැයිස්තුවට Poll එක යැවීමේ Function එක
async function sendDailyPollMCQ(sock) {
    try {
        console.log('Gemini AI මඟින් 10/11 වසර පාඩම් වලින් අලුත්ම MCQ ප්‍රශ්නය සකසමින් පවතී...');
        
        const data = await generateMCQFromGemini();

        askedQuestions.push(data.question);
        if (askedQuestions.length > 20) {
            askedQuestions.shift();
        }

        // 📌 ඔබ ප්‍රශ්න යැවීමට අවශ්‍ය WhatsApp Group වල JIDස් මෙහි දාන්න
        const targetGroups = [
            '120363429635141660@g.us', // My Group
            '120363405905961234@g.us', // 2027 Gonadeniya
            '120363422669823543@g.us', // 2027 Akshara
            '120363404399183574@g.us', // 2027 Nasa
            '120363046104457178@g.us', // 2027 Hayasko
        ];

        for (const targetJid of targetGroups) {
            if (lastQuestionExplanation) {
                const answerText = `💡 *පසුගිය ප්‍රශ්නේ නිවැරදි පිළිතුර සහ විස්තරය:* \n\n✅ *හරි පිළිතුර:* ${lastQuestionExplanation.correctAnswer}\n📖 *පැහැදිලි කිරීම:* ${lastQuestionExplanation.explanation}`;
                await sock.sendMessage(targetJid, { text: answerText });
            }

            await sock.sendMessage(targetJid, {
                poll: {
                    name: data.question,
                    values: data.options,
                    selectableCount: 1
                }
            });
        }
        
        console.log('✅ සියලුම ගෲප් වෙත අලුත් MCQ Poll එක සහ පිළිතුර සාර්ථකව යැව්වා!');

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
