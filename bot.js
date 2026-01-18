const { chromium } = require('playwright-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const { devices } = require('playwright');
const { faker } = require('@faker-js/faker');
const fs = require('fs');

chromium.use(StealthPlugin());

let browser = null;
let context = null;
let isRunning = false;

// --- Helper Functions ---
function parseProxy(proxyStr) {
    if (!proxyStr || proxyStr.includes('Direct IP')) return null;
    try {
        let clean = proxyStr.replace(/^(http|https|socks4|socks5):\/\//, '');
        if (clean.includes('@')) {
            const [auth, host] = clean.split('@');
            return { server: `http://${host}`, username: auth.split(':')[0], password: auth.split(':')[1] };
        } 
        const parts = clean.split(':');
        if (parts.length === 4) return { server: `http://${parts[0]}:${parts[1]}`, username: parts[2], password: parts[3] };
        return { server: `http://${parts[0]}:${parts[1]}` };
    } catch (e) { return null; }
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
        fs.writeFileSync('./state.json', JSON.stringify({ counter: count + 1 }));
    } else {
        email = faker.internet.userName().replace(/[^a-zA-Z0-9]/g, '') + Math.floor(Math.random() * 9999);
    }
    return email;
}

// 🛑 Human Delay Helper (3 to 5 seconds random wait)
async function humanDelay(page) {
    const delay = Math.floor(Math.random() * 2000) + 3000; // 3000ms - 5000ms
    await page.waitForTimeout(delay);
}

// 📸 Snapshot Helper
async function takeSnapshot(page, socket, label) {
    if(!page || page.isClosed()) return;
    try {
        const screenshot = await page.screenshot({ quality: 40, type: 'jpeg' });
        socket.emit('screen_update', screenshot.toString('base64'));
        socket.emit('log', `📸 SNAPSHOT: ${label}`);
    } catch (e) {}
}

// --- MAIN LOGIC ---
async function startBot(settings, socket) {
    if (isRunning) return;
    isRunning = true;

    const proxies = settings.proxies.split('\n').filter(p => p.trim() !== "");
    const proxyList = proxies.length > 0 ? proxies : ["Direct IP"];

    const log = (msg, type = 'normal') => {
        let prefix = type === 'error' ? '❌ ' : type === 'success' ? '✅ ' : 'ℹ️ ';
        socket.emit('log', `${prefix}${msg}`);
    };

    try {
        for (let i = 0; i < proxyList.length; i++) {
            if (!isRunning) break;

            const currentProxy = proxyList[i];
            const proxyData = parseProxy(currentProxy);
            log(`🔄 Cycle ${i+1}: Connecting with ${currentProxy === "Direct IP" ? "No Proxy" : "Proxy"}`);

            browser = await chromium.launch({
                headless: true, // Railway par TRUE
                args: [
                    '--disable-blink-features=AutomationControlled',
                    '--no-sandbox', 
                    '--disable-setuid-sandbox',
                    '--ignore-certificate-errors',
                ]
            });

            context = await browser.newContext({
                ...devices['Pixel 7'],
                proxy: proxyData ? { server: proxyData.server, username: proxyData.username, password: proxyData.password } : undefined,
                locale: 'en-US',
                timezoneId: 'America/New_York',
                deviceScaleFactor: 3,
                isMobile: true,
                hasTouch: true,
                userAgent: 'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/116.0.0.0 Mobile Safari/537.36',
            });

            await context.addInitScript(() => {
                Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
                Object.defineProperty(navigator, 'platform', { get: () => 'Linux armv8l' });
            });

            const page = await context.newPage();

            // Background Stream
            const streamInterval = setInterval(async () => {
                if (!isRunning || page.isClosed()) { clearInterval(streamInterval); return; }
                try {
                    const screenshot = await page.screenshot({ quality: 20, type: 'jpeg' });
                    socket.emit('screen_update', screenshot.toString('base64'));
                } catch(e) {}
            }, 4000);

            try {
                // --- STEP 1: NAME ---
                log('🌐 Opening Signup Page...');
                await page.goto('https://accounts.google.com/signup/v2/createaccount?flowName=GlifWebSignIn&flowEntry=SignUp', { timeout: 60000 });
                await humanDelay(page); // 🛑 Wait 3-5s

                await takeSnapshot(page, socket, 'Page Loaded');

                if (await page.getByText('Sorry, we could not create your Google Account').isVisible()) throw new Error('IP_BURNED_START');

                const fName = faker.person.firstName();
                log(`👤 Name: ${fName}`);
                
                // Super Slow Typing (200ms - 400ms per key)
                await page.locator('input[name="firstName"]').pressSequentially(fName, { delay: Math.floor(Math.random() * 200) + 200 }); 
                
                await takeSnapshot(page, socket, 'Name Filled');
                await humanDelay(page); // 🛑 Wait 3-5s
                
                await page.getByRole('button', { name: 'Next' }).click();
                await takeSnapshot(page, socket, 'Clicked Next (Name)');

                // --- STEP 2: BIRTHDAY ---
                log('🎂 Filling Birthday...');
                await page.waitForSelector('#month', { state: 'visible', timeout: 15000 });
                await humanDelay(page); // 🛑 Wait 3-5s

                // Month
                await page.locator('#month').click();
                await page.waitForTimeout(1000); // Thora slow
                await page.getByRole('option', { name: 'January' }).click();
                await page.waitForTimeout(500);

                // Day & Year (Typing Slowly)
                await page.locator('input[name="day"]').pressSequentially(String(Math.floor(Math.random() * 28) + 1), { delay: 300 });
                await page.waitForTimeout(500);
                await page.locator('input[name="year"]').pressSequentially('1998', { delay: 300 });
                await page.waitForTimeout(1000);

                // Gender (Fixed Strict Mode Issue)
                await page.locator('#gender').click();
                await page.waitForTimeout(1000);
                
                const isMale = Math.random() > 0.5;
                const genderText = isMale ? 'Male' : 'Female';
                log(`Selected Gender: ${genderText}`);

                // 🛠 FIX: exact: true use kiya taake Male/Female mix na hon
                await page.getByRole('option', { name: genderText, exact: true }).click();

                await takeSnapshot(page, socket, 'Birthday Filled');
                await humanDelay(page); // 🛑 Wait 3-5s
                
                await page.getByRole('button', { name: 'Next' }).click();
                await takeSnapshot(page, socket, 'Clicked Next (Birthday)');

                // --- STEP 3: USERNAME ---
                log('📧 Handling Username...');
                await page.waitForTimeout(3000); // Initial wait
                
                // Check Radio Button
                const createOwnRadio = page.getByText('Create your own Gmail address');
                if (await createOwnRadio.isVisible()) {
                    log('🔘 Clicking Radio Button...');
                    await createOwnRadio.click();
                    await humanDelay(page); // 🛑 Wait 3-5s
                }

                const username = getNextUsername(settings.mode, settings.customBase);
                log(`⌨️ Typing: ${username}`);
                
                await page.locator('input[name="Username"]').pressSequentially(username, { delay: Math.floor(Math.random() * 150) + 150 });
                
                await takeSnapshot(page, socket, 'Username Typed');
                await humanDelay(page); // 🛑 Wait 3-5s
                
                await page.getByRole('button', { name: 'Next' }).click();
                await takeSnapshot(page, socket, 'Clicked Next (Username)');

                await page.waitForTimeout(2000);
                if (await page.getByText('Sorry, we could not create your Google Account').isVisible()) throw new Error('IP_BURNED_USER');

                // --- STEP 4: PASSWORD ---
                log('🔑 Setting Password...');
                await page.waitForSelector('input[name="Passwd"]', { timeout: 15000 });
                await humanDelay(page); // 🛑 Wait 3-5s

                const pass = settings.password;
                
                // Typing Password Slowly
                await page.locator('input[name="Passwd"]').pressSequentially(pass, { delay: 200 });
                await page.waitForTimeout(1000);
                await page.locator('input[name="PasswdAgain"]').pressSequentially(pass, { delay: 200 });

                await takeSnapshot(page, socket, 'Password Filled');
                await humanDelay(page); // 🛑 Wait 3-5s
                
                await page.getByRole('button', { name: 'Next' }).click();
                await takeSnapshot(page, socket, 'Clicked Next (Password)');

                // --- STEP 5: FINAL VERIFICATION ---
                log('📱 Final Check...');
                await page.waitForTimeout(5000);
                await takeSnapshot(page, socket, 'Final Result Page');

                if (await page.getByText('Sorry, we could not create your Google Account').isVisible()) {
                    throw new Error('IP_BURNED_FINAL: Google detected bot behavior.');
                }

                const skipBtn = page.getByRole('button', { name: 'Skip' });
                if (await skipBtn.isVisible()) {
                    log('✅ SUCCESS: Phone Skip Available!', 'success');
                    await takeSnapshot(page, socket, 'Success Page');
                    await skipBtn.click();
                } else {
                    log('⚠️ Phone Number Required.', 'error');
                }

            } catch (stepError) {
                log(`❌ Error: ${stepError.message}`, 'error');
                await takeSnapshot(page, socket, 'ERROR STATE');
            }

            clearInterval(streamInterval);
            await context.close();
            await browser.close();
            log('💤 Resting 10s before next cycle...');
            await new Promise(r => setTimeout(r, 10000));
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
