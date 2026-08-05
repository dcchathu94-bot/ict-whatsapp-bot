const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const qrcode = require('qrcode-terminal');
const http = require('http');
const { GoogleGenAI } = require('@google/genai');

// Render Port scan timeout එක නැවැත්වීමට HTTP Server එක
http.createServer((req, res) => res.end('Baileys WhatsApp Bot is Running!')).listen(process.env.PORT || 3000);

// Gemini AI Setup
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

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
            
            // Connection එක Settle වීමට තත්පර 10ක් ලබා දීම
            setTimeout(() => {
                sendDailyPollMCQ(sock);
            }, 10000);

            setInterval(() => {
                sendDailyPollMCQ(sock);
            }, 5 * 60 * 1000);
        }
    });
}

// Gemini AI මඟින් MCQ එක සාදා Poll එකක් ලෙස යැවීමේ Function එක
async function sendDailyPollMCQ(sock) {
    try {
        console.log('Gemini AI මඟින් MCQ ප්‍රශ්නය සකසමින් පවතී...');
        const prompt = `You are a Sri Lankan GCE O/L ICT Teacher. Generate one single-choice MCQ question in Sinhala based on the Grade 10/11 ICT syllabus.
Provide the response STRICTLY as a JSON object with this structure:
{
  "question": "ප්‍රශ්නය මෙතනට",
  "options": ["පිළිතුර 1", "පිළිතුර 2", "පිළිතුර 3", "පිළිතුර 4"]
}`;

        const response = await ai.models.generateContent({
            model: 'gemini-3.6-flash',
            contents: prompt,
            config: { responseMimeType: 'application/json' }
        });

        const data = JSON.parse(response.text);
        console.log('MCQ Poll එක සූදානම්:', data.question);

        // Bot ගේම අංකයට යැවීමට (පරීක්ෂා කිරීම සඳහා)
        const targetJid = '94715477061@s.whatsapp.net'; 

        // WhatsApp Poll එකක් ලෙස යැවීම
        await sock.sendMessage(targetJid, {
            poll: {
                name: data.question,
                values: data.options,
                selectableCount: 1 // එක පිළිතුරක් පමණක් තේරීමට
            }
        });
        
        console.log('✅ Poll එක සාර්ථකව WhatsApp වෙත යැව්වා!');

    } catch (error) {
        console.error('MCQ යැවීමේදී දෝෂයක් ඇතිවිය:', error);
    }
}

connectToWhatsApp();
