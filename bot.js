const { chromium } = require('playwright-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const { devices } = require('playwright');
const { faker } = require('@faker-js/faker');
const fs = require('fs');

chromium.use(StealthPlugin());

let browser = null;
let context = null;
let isRunning = false;

// --- HELPER FUNCTIONS ---

function parseProxy(proxyStr) {
    if (!proxyStr || proxyStr.includes('Direct IP')) return null;
    try {
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
        // Update Counter
        fs.writeFileSync('./state.json', JSON.stringify({ counter: count + 1 }));
    } else {
        // Random High Trust format (e.g: ali.khan.9284)
        email = faker.internet.userName().replace(/[^a-zA-Z0-9]/g, '') + Math.floor(Math.random() * 1000);
    }
    return email;
}

function getRandomBirth() {
    const day = Math.floor(Math.random() * 27) + 1;
    const month = Math.floor(Math.random() * 12) + 1;
    const year = Math.floor(Math.random() * (2002 - 1985 + 1)) + 1985; // 1985 to 2002
    return { day: String(day), month: String(month), year: String(year) };
}

// --- MAIN BOT LOGIC ---

async function startBot(settings, socket) {
    if (isRunning) return;
    isRunning = true;

    const proxies = settings.proxies.split('\n').filter(p => p.trim() !== "");
    // Agar proxies empty hain to direct IP chalaye ga
    const proxyList = proxies.length > 0 ? proxies : ["Direct IP"];

    const log = (msg, type = 'normal') => {
        let prefix = type === 'error' ? '❌ ' : type === 'success' ? '✅ ' : 'ℹ️ ';
        socket.emit('log', `${prefix}${msg}`);
    };

    try {
        log(`🚀 Starting Process...`);

        for (let i = 0; i < proxyList.length; i++) {
            if (!isRunning) break;

            const currentProxy = proxyList[i];
            const proxyData = parseProxy(currentProxy);
            log(`🔄 Connecting: ${currentProxy === "Direct IP" ? "Direct IP (No Proxy)" : "Proxy Active"}`);

            // --- BROWSER SETUP ---
            browser = await chromium.launch({
                headless: true, // Railway par TRUE rakhna
                args: [
                    '--disable-blink-features=AutomationControlled',
                    '--no-sandbox',
                    '--disable-setuid-sandbox',
                    '--ignore-certificate-errors'
                ]
            });

            // Pixel 7 Emulation
            context = await browser.newContext({
                ...devices['Pixel 7'],
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
            });

            const page = await context.newPage();

            // Screen Stream (Every 3s)
            const streamInterval = setInterval(async () => {
                if (!isRunning || !page || page.isClosed()) {
                    clearInterval(streamInterval);
                    return;
                }
                try {
                    const screenshot = await page.screenshot({ quality: 30, type: 'jpeg' });
                    socket.emit('screen_update', screenshot.toString('base64'));
                } catch(e) {}
            }, 3000);

            // --- STEP 1: OPEN GOOGLE SIGNUP ---
            log('🌐 Opening Google Signup...');
            await page.goto('https://accounts.google.com/signup/v2/createaccount?flowName=GlifWebSignIn&flowEntry=SignUp', { timeout: 60000 });
            
            // --- STEP 2: FILL NAME ---
            const fName = faker.person.firstName();
            const lName = faker.person.lastName(); // Generates but we might skip
            
            log(`👤 Name: ${fName} (Skipping Last Name)`);
            
            await page.waitForSelector('input[name="firstName"]');
            await page.fill('input[name="firstName"]', fName);
            // User requested to SKIP last name, so we do nothing for lastName input
            
            await page.waitForTimeout(1000); // Human pause
            await page.getByRole('button', { name: 'Next' }).click();

            // --- STEP 3: BIRTHDAY & GENDER ---
            log('🎂 Waiting for Birthday Page...');
            try {
                // Wait for Month selector or Basic Info text
                await page.waitForSelector('#month', { timeout: 15000 });
                
                const dob = getRandomBirth();
                await page.fill('input[name="day"]', dob.day);
                await page.selectOption('#month', dob.month); 
                await page.fill('input[name="year"]', dob.year);
                
                // Gender (1=Female, 2=Male usually, or Random select)
                await page.selectOption('#gender', String(Math.floor(Math.random() * 2) + 1));
                
                log(`📅 DOB: ${dob.day}/${dob.month}/${dob.year}`);
                await page.waitForTimeout(1000);
                await page.getByRole('button', { name: 'Next' }).click();
            } catch (e) {
                log(`⚠️ Stuck at Birthday: ${e.message}`, 'error');
                // throw e; // Agar yahan phansa to aglay step par nahi ja payega
            }

            // --- STEP 4: USERNAME SELECTION ---
            log('📧 Handling Username...');
            try {
                // Google kabhi options deta hai, kabhi direct input
                // Hum check karenge "Create your own" option hai ya nahi
                const createOwn = await page.getByText('Create your own Gmail address');
                if (await createOwn.isVisible()) {
                    await createOwn.click();
                }

                const username = getNextUsername(settings.mode, settings.customBase);
                log(`⌨️ Typing User: ${username}`);
                
                // Input field dhoondain (Name="Username" usually)
                await page.waitForSelector('input[name="Username"]');
                await page.fill('input[name="Username"]', username);
                
                await page.waitForTimeout(1000);
                await page.getByRole('button', { name: 'Next' }).click();

                // Check agar username taken ho
                // (Advanced logic baad mein, abhi flow continue rakhte hain)

            } catch (e) {
                log(`⚠️ Stuck at Username: ${e.message}`, 'error');
            }

            // --- STEP 5: PASSWORD ---
            log('🔑 Setting Password...');
            try {
                await page.waitForSelector('input[name="Passwd"]', { timeout: 15000 });
                
                const pass = settings.password;
                await page.fill('input[name="Passwd"]', pass);
                await page.fill('input[name="PasswdAgain"]', pass);
                
                await page.getByRole('button', { name: 'Next' }).click();
            } catch (e) {
                log(`⚠️ Stuck at Password: ${e.message}`, 'error');
            }

            // --- STEP 6: PHONE NUMBER CHECK ---
            log('📱 Checking Phone Requirement...');
            try {
                await page.waitForTimeout(5000); // Wait for page load
                
                // Check agar Skip button hai
                const skipBtn = await page.getByRole('button', { name: 'Skip' });
                if (await skipBtn.isVisible()) {
                    log('✅ SUCCESS! Phone Skip Available. Clicking Skip...', 'success');
                    await skipBtn.click();
                    // Yahan se aagay review page hota hai
                } else {
                    log('⚠️ Phone Number Required (No Skip)', 'error');
                }
            } catch (e) {
                log('❓ Unknown State at Phone Step');
            }

            // Thora time dein taake screenshot update ho jaye
            await page.waitForTimeout(5000);

            log('🏁 Cycle Finished.');
            clearInterval(streamInterval);
            await context.close();
            await browser.close();
        }

    } catch (error) {
        log(`❌ Critical Error: ${error.message}`, 'error');
    } finally {
        isRunning = false;
        if (browser) await browser.close();
        socket.emit('log', '🛑 Process Stopped.');
    }
}

async function stopBot() {
    isRunning = false;
    if (browser) await browser.close();
}

module.exports = { startBot, stopBot };
