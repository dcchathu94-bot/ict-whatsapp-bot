const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const qrcode = require('qrcode-terminal');
const http = require('http');
const { GoogleGenAI } = require('@google/genai');

// Render Port scan timeout එක නැවැත්වීමට HTTP Server එක
http.createServer((req, res) => res.end('Baileys WhatsApp Bot is Running!')).listen(process.env.PORT || 3000);

// Gemini AI Setup
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

// කලින් දුන් ප්‍රශ්නේ උත්තරය සහ විස්තරය මතක තබා ගැනීමට Variable එකක්
let lastQuestionExplanation = null;

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
            console.log('✅ Baileys WhatsApp Bot සාර්ථකව සම්බන්ධ වුණා!');
            
            // Connection එක Settle වීමට තත්පර 10ක් ලබා දී පළමු MCQ එක යැවීම
            setTimeout(() => {
                sendDailyPollMCQ(sock);
            }, 10000);

            // ළමයින්ගේ ගෲප් එකට යවද්දී මෙහි කාලය වෙනස් කරගත හැක (උදා: පැය 12කට හෝ 24කට වරක්)
            setInterval(() => {
                sendDailyPollMCQ(sock);
            }, 5 * 60 * 1000); // දැනට ටෙස්ට් කිරීමට විනාඩි 5කට වරක්
        }
    });
}

// Gemini AI මඟින් MCQ ප්‍රශ්නය, පිළිතුර සහ විස්තරය සකසා Poll එකක් ලෙස යැවීමේ Function එක
async function sendDailyPollMCQ(sock) {
    try {
        console.log('Gemini AI මඟින් MCQ ප්‍රශ්නය සහ විස්තරය සකසමින් පවතී...');
        
        const prompt = `You are a Sri Lankan GCE O/L ICT Teacher. Generate one single-choice MCQ question in Sinhala based on the Grade 10/11 ICT syllabus.
Provide the response STRICTLY as a JSON object with this structure:
{
  "question": "ප්‍රශ්නය මෙතනට",
  "options": ["පිළිතුර 1", "පිළිතුර 2", "පිළිතුර 3", "පිළිතුර 4"],
  "correctAnswer": "හරි පිළිතුර මෙහි සඳහන් කරන්න",
  "explanation": "මෙම පිළිතුර නිවැරදි වීමට හේතුව සහ කෙටි විස්තරය මෙතනට"
}`;

        const response = await ai.models.generateContent({
            model: 'gemini-3.6-flash',
            contents: prompt,
            config: { responseMimeType: 'application/json' }
        });

        const data = JSON.parse(response.text);
        
        // මෙහි ඔබේ අංකය හෝ ළමයින්ගේ Group එකේ JID එක දාන්න
        const targetJid = '947XXXXXXXX@s.whatsapp.net'; 

        // 1. කලින් ප්‍රශ්නයක් තිබුණා නම්, මුලින්ම ඒකේ නිවැරදි පිළිතුර සහ විස්තරය යැවීම
        if (lastQuestionExplanation) {
            const answerText = `💡 *පසුගිය ප්‍රශ්නේ නිවැරදි පිළිතුර සහ විස්තරය:* \n\n✅ *හරි පිළිතුර:* ${lastQuestionExplanation.correctAnswer}\n📖 *විස්තරය:* ${lastQuestionExplanation.explanation}`;
            await sock.sendMessage(targetJid, { text: answerText });
            console.log('✅ කලින් ප්‍රශ්නේ පිළිතුර යැව්වා.');
        }

        // 2. අලුත් MCQ Poll එක යැවීම
        await sock.sendMessage(targetJid, {
            poll: {
                name: data.question,
                values: data.options,
                selectableCount: 1
            }
        });
        
        console.log('✅ අලුත් MCQ Poll එක සාර්ථකව යැව්වා!');

        // ඊළඟ වතාවට පාවිච්චි කිරීමට වත්මන් ප්‍රශ්නේ උත්තරය සහ විස්තරය සේව් කර තැබීම
        lastQuestionExplanation = {
            correctAnswer: data.correctAnswer,
            explanation: data.explanation
        };

    } catch (error) {
        console.error('⚠️ AI සර්වර් තදබදයකි හෝ දෝෂයකි. තත්පර 30කින් නැවත උත්සාහ කරයි...', error.message);
        
        // 503 හෝ වෙනත් AI දෝෂයක් ආවොත් බොට් ක්‍රෑෂ් නොවී තත්පර 30කින් නැවත උත්සාහ කිරීම
        setTimeout(() => {
            console.log('🔄 මඟහැරුණු MCQ ප්‍රශ්නය යැවීමට නැවත උත්සාහ කරමින්...');
            sendDailyPollMCQ(sock);
        }, 30000);
    }
}

connectToWhatsApp();
