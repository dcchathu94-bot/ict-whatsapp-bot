const http = require('http');
http.createServer((req, res) => res.end('WhatsApp Bot is Running!')).listen(process.env.PORT || 3000);

const { Client, LocalAuth, Poll } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const { GoogleGenAI } = require('@google/genai');
require('dotenv').config();

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

const client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: {
        headless: true,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--no-first-run',
            '--no-zygote',
            '--disable-gpu'
        ]
    }
});

let previousMCQData = null; 

const ictTopics = [
    "තොරතුරු හා සන්නිවේදන තාක්ෂණය පිළිබඳ හැඳින්වීම (Introduction to ICT)",
    "පරිගණකයේ විකාශනය සහ වර්ගීකරණය (Evolution of Computers)",
    "දත්ත නිරූපණය - සංඛ්‍යා පද්ධති (Data Representation & Number Systems)",
    "තර්ක ද්වාර සහ බූලීය ශ්‍රිත (Logic Gates & Boolean Functions)",
    "පරිගණක මෙහෙයුම් පද්ධති (Operating Systems)",
    "වදන් සැකසුම් මෘදුකාංග (MS Word / Word Processing)",
    "විද්‍යුත් පැතුරුම්පත් (MS Excel / Spreadsheets)",
    "දත්ත සමුදාය කළමනාකරණ පද්ධති (MS Access / Database Systems)",
    "විද්‍යුත් ඉදිරිපත් කිරීම් (MS PowerPoint / Presentations)",
    "පද්ධති සංවර්ධන ජීවන චක්‍රය (System Development Life Cycle - SDLC)",
    "අන්තර්ජාලය සහ විද්‍යුත් තැපෑල (Internet & Email)",
    "ක්‍රමලේඛනය - පැස්කල් සහ ඇල්ගොරිතම (Programming, Pascal & Algorithms)",
    "වෙබ් අඩවි නිර්මාණය - HTML (Web Design using HTML)"
];

client.on('qr', (qr) => {
    console.log('-----------------------------------------------------');
    console.log('පහත QR Code එක WhatsApp එකෙන් Scan කරන්න:');
    qrcode.generate(qr, { small: true });
});

client.on('ready', () => {
    console.log('WhatsApp Bot සාර්ථකව සම්බන්ධ වුණා! (Cloud Server Mode - Ready)');
    
    // Server එකේ Test කරන්න විනාඩි 5න් 5ට
    setInterval(() => {
        console.log('Running Scheduled MCQ...');
        sendDailyPollMCQ();
    }, 5 * 60 * 1000); 
});

async function sendDailyPollMCQ(retryCount = 0) {
    try {
        const randomTopic = ictTopics[Math.floor(Math.random() * ictTopics.length)];
        const blockPreviousPhrase = previousMCQData ? `කලින් අසන ලද ප්‍රශ්නය: "${previousMCQData.question}". මෙම ප්‍රශ්නය හෝ මෙයට සමාන කිසිදු ප්‍රශ්නයක් හෝ පිළිතුරු රටාවක් නැවත කිසිසේත්ම භාවිතා නොකරන්න!` : '';

        const prompt = `ඔබ ශ්‍රී ලංකාවේ ප්‍රමුඛ, අති දක්ෂ ICT ගුරුවරයෙකි. ශ්‍රී ලංකාවේ O/L (10 සහ 11 වසර) විභාග මට්ටමට ගැලපෙන පරිදි, පහත සඳහන් නිශ්චිත පාඩමෙන් අතිශය සුවිශේෂී සහ අලුත්ම බහුවරණ ප්‍රශ්නයක් (MCQ 1ක්) සකස් කරන්න.

        තෝරාගත් පාඩම: "${randomTopic}"
        ${blockPreviousPhrase}

        Strict Rules:
        1. ප්‍රශ්නය සහ පිළිතුරු 4 ම ඉතාමත් නිවැරදි, පැහැදිලි සිංහල ව්‍යාකරණ භාවිතයෙන් ලියන්න.
        2. පිළිතුරු හතර (Options) එකිනෙකට ව්‍යාකූල නොවන සේ පැහැදිලිව වෙනස් විය යුතුය.
        3. සාමාන්‍යයෙන් අහන සරල ප්‍රශ්න වෙනුවට O/L විභාගයේදී ළමයින් වැරදි සිදුකරන ගැඹුරු විෂය කරුණක් තෝරාගන්න.
        4. Output එක පහත JSON Format එකෙන් පමණක් ලබාදෙන්න (වෙනත් කිසිදු වැකියක් පිටතින් ලියන්න එපා).
        {
            "question": "ප්‍රශ්නය",
            "options": ["1", "2", "3", "4"],
            "correct": "නිවැරදි පිළිතුර",
            "explanation": "එම පිළිතුර නිවැරදි වීමට හේතුව විෂය නිර්දේශයට අනුව කෙටියෙන් පැහැදිලි කිරීම"
        }`;

        const response = await ai.models.generateContent({
            model: 'gemini-3.6-flash',
            contents: prompt,
            config: { responseMimeType: "application/json", temperature: 0.95, topP: 0.95 }
        });

        const newMcqData = JSON.parse(response.text);
        const inviteCode = 'BEIq3cVzm5z0grQSsJFYac'; // ඔයාගේ Group Invite Code එක
        const groupInfo = await client.getInviteInfo(inviteCode);

        if (groupInfo && groupInfo.id) {
            const groupId = groupInfo.id._serialized;
            if (previousMCQData) {
                await client.sendMessage(groupId, `💡 *පසුගිය MCQ එකේ නිවැරදි පිළිතුර:*\n👉 ${previousMCQData.correct}\n\n*පැහැදිලි කිරීම:*\n${previousMCQData.explanation}`);
            }
            await client.sendMessage(groupId, new Poll(`📌 Daily MCQ: ${newMcqData.question}`, newMcqData.options));
            previousMCQData = newMcqData;
        }
    } catch (error) {
        if (error.status === 429 && retryCount < 3) {
            setTimeout(() => sendDailyPollMCQ(retryCount + 1), 10000);
        } else {
            console.error('දෝෂයක්:', error);
        }
    }
}

client.initialize();
