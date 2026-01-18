const { chromium } = require('playwright-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const { devices } = require('playwright');
const { faker } = require('@faker-js/faker');
const fs = require('fs');

chromium.use(StealthPlugin());

let browser = null;
let context = null;
let isRunning = false;

// Proxy String Parser (Har qisam ki proxy ko handle karega)
function parseProxy(proxyStr) {
    if (!proxyStr) return null;
    try {
        // Remove protocols
        let clean = proxyStr.replace(/^(http|https|socks4|socks5):\/\//, '');
        let server, username, password;

        if (clean.includes('@')) {
            const parts = clean.split('@');
            const auth = parts[0].split(':');
            const host = parts[1];
            username = auth[0];
            password = auth[1];
            server = `http://${host}`;
        } else {
            const parts = clean.split(':');
            if (parts.length === 4) {
                server = `http://${parts[0]}:${parts[1]}`;
                username = parts[2];
                password = parts[3];
            } else if (parts.length === 2) {
                server = `http://${parts[0]}:${parts[1]}`;
            }
        }
        return { server, username, password };
    } catch (e) {
        return null;
    }
}

// Custom Counter Logic
function getNextUsername(mode, customBase) {
    let count = 1;
    if (fs.existsSync('./state.json')) {
        const state = JSON.parse(fs.readFileSync('./state.json'));
        count = state.counter;
    }

    let email = "";
    if (mode === 'custom') {
        const suffix = String(count).padStart(2, '0');
        email = `${customBase}${suffix}`;
        // Increment for next time
        fs.writeFileSync('./state.json', JSON.stringify({ counter: count + 1 }));
    } else {
        email = faker.internet.userName().replace(/[^a-zA-Z0-9]/g, '') + Math.floor(Math.random() * 100);
    }
    return email;
}

async function startBot(settings, socket) {
    if (isRunning) return;
    isRunning = true;

    const proxies = settings.proxies.split('\n').filter(p => p.trim() !== "");
    let proxyIndex = 0;

    const log = (msg) => socket.emit('log', `[${new Date().toLocaleTimeString()}] ${msg}`);

    try {
        log(`🚀 Starting Process. Loaded ${proxies.length} proxies.`);

        // Loop through proxies (One account per proxy for now)
        for (let i = 0; i < (proxies.length || 1); i++) {
            if (!isRunning) break;

            const proxyData = proxies.length > 0 ? parseProxy(proxies[i]) : null;
            log(`🔄 Switching to Proxy: ${proxies[i] || "Direct IP"}`);

            // --- PIXEL 7 EMULATION SETUP ---
            const pixelProfile = devices['Pixel 7'];
            
            browser = await chromium.launch({
                headless: true, // Railway pe True rakhna zaroori hai
                args: [
                    '--disable-blink-features=AutomationControlled',
                    '--no-sandbox',
                    '--disable-setuid-sandbox',
                    '--ignore-certificate-errors'
                ]
            });

            context = await browser.newContext({
                ...pixelProfile,
                proxy: proxyData ? {
                    server: proxyData.server,
                    username: proxyData.username,
                    password: proxyData.password
                } : undefined,
                locale: 'en-US',
                timezoneId: 'America/New_York',
                deviceScaleFactor: 3,
                isMobile: true,
                hasTouch: true,
                colorScheme: 'dark',
            });

            const page = await context.newPage();

            // Screen Stream (Har 3 second baad screenshot bhejo)
            const streamInterval = setInterval(async () => {
                if (!isRunning || !page) {
                    clearInterval(streamInterval);
                    return;
                }
                try {
                    const screenshot = await page.screenshot({ quality: 50, type: 'jpeg' });
                    socket.emit('screen_update', screenshot.toString('base64'));
                } catch(e) {}
            }, 3000);

            // --- GOOGLE SIGNUP LOGIC ---
            log('🌐 Navigating to Google Signup...');
            await page.goto('https://accounts.google.com/signup', { timeout: 60000 });

            const fName = faker.person.firstName();
            const lName = faker.person.lastName();
            const username = getNextUsername(settings.mode, settings.customBase);
            const password = settings.password;

            log(`👤 Filling Info: ${fName} ${lName} | User: ${username}`);

            // Yahan par selectors ayenge (yeh selectors waqt ke sath change ho sakte hain)
            // Lekin flow start ho chuka hai.
            
            // Example filling (Adjust selectors as needed)
            // await page.fill('input[name="firstName"]', fName);
            // await page.fill('input[name="lastName"]', lName);
            // ... aur agay ka process

            // Demo ke liye wait karte hain taake ap screenshot dekh sakein
            await page.waitForTimeout(10000); 

            log('✅ Task Completed for this cycle.');
            
            clearInterval(streamInterval);
            await context.close();
            await browser.close();
        }

    } catch (error) {
        log(`❌ Error: ${error.message}`);
    } finally {
        isRunning = false;
        socket.emit('status', 'stopped');
    }
}

async function stopBot() {
    isRunning = false;
    if (browser) await browser.close();
}

module.exports = { startBot, stopBot };
