const { chromium } = require('playwright-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const { FingerprintGenerator } = require('fingerprint-generator');
const { FingerprintInjector } = require('fingerprint-injector');
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

// 🛑 Human Delay Helper (Random 3-6s)
async function humanDelay(page) {
    const delay = Math.floor(Math.random() * 3000) + 3000; 
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

    // 1. Initialize Fingerprint Generators
    const fingerprintGenerator = new FingerprintGenerator();
    const fingerprintInjector = new FingerprintInjector();

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
            log(`🔄 Cycle ${i+1}: Connecting...`);

            // 2. Generate a REAL Android Fingerprint
            // Ye "Pixel 7" ki zid nahi karega, balki ek "VALID" Android device banayega
            // Taa ke Google ko koi shaq na ho (Samsung, Xiaomi, Pixel - kuch bhi ho sakta hai)
            const fingerprint = fingerprintGenerator.getFingerprint({
                devices: ['mobile'],
                operatingSystems: ['android'],
            });

            log(`📱 Spoofing Device: ${fingerprint.fingerprint.navigator.userAgent.substring(0, 50)}...`);

            browser = await chromium.launch({
                headless: true,
                args: [
                    '--disable-blink-features=AutomationControlled',
                    '--no-sandbox', 
                    '--disable-setuid-sandbox',
                    '--ignore-certificate-errors',
                ]
            });

            // 3. Create Context with basic settings
            context = await browser.newContext({
                proxy: proxyData ? { server: proxyData.server, username: proxyData.username, password: proxyData.password } : undefined,
                locale: 'en-US',
                // Baki cheezein ab Injector handle karega
            });

            // 🔥🔥🔥 HEAVY INJECTION 🔥🔥🔥
            // Ye function Graphics Card, Audio, Battery, Fonts sab badal dega
            await fingerprintInjector.attachFingerprintToPlaywright(context, fingerprint);

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
                await humanDelay(page);

                await takeSnapshot(page, socket, 'Page Loaded');

                // Initial IP Check
                if (await page.getByText('Sorry, we could not create your Google Account').isVisible()) throw new Error('IP_BURNED_START');

                const fName = faker.person.firstName();
                log(`👤 Name: ${fName}`);
                
                await page.locator('input[name="firstName"]').pressSequentially(fName, { delay: Math.floor(Math.random() * 200) + 150 }); 
                
                await takeSnapshot(page, socket, 'Name Filled');
                await humanDelay(page);
                
                await page.getByRole('button', { name: 'Next' }).click();
                await takeSnapshot(page, socket, 'Clicked Next (Name)');

                // --- STEP 2: BIRTHDAY ---
                log('🎂 Filling Birthday...');
                await page.waitForSelector('#month', { state: 'visible', timeout: 15000 });
                await humanDelay(page);

                // Month
                await page.locator('#month').click();
                await page.waitForTimeout(1000);
                await page.getByRole('option', { name: 'January' }).click(); // Better to keep January for consistency
                await page.waitForTimeout(500);

                // Day & Year
                await page.locator('input[name="day"]').pressSequentially(String(Math.floor(Math.random() * 28) + 1), { delay: 300 });
                await page.waitForTimeout(500);
                await page.locator('input[name="year"]').pressSequentially('1999', { delay: 300 });
                await page.waitForTimeout(1000);

                // Gender
                await page.locator('#gender').click();
                await page.waitForTimeout(1000);
                const isMale = Math.random() > 0.5;
                const genderText = isMale ? 'Male' : 'Female';
                await page.getByRole('option', { name: genderText, exact: true }).click();

                await takeSnapshot(page, socket, 'Birthday Filled');
                await humanDelay(page);
                
                await page.getByRole('button', { name: 'Next' }).click();
                await takeSnapshot(page, socket, 'Clicked Next (Birthday)');

                // --- STEP 3: USERNAME ---
                log('📧 Handling Username...');
                await page.waitForTimeout(3000);
                
                const createOwnRadio = page.getByText('Create your own Gmail address');
                if (await createOwnRadio.isVisible()) {
                    log('🔘 Clicking Radio Button...');
                    await createOwnRadio.click();
                    await humanDelay(page);
                }

                const username = getNextUsername(settings.mode, settings.customBase);
                log(`⌨️ Typing: ${username}`);
                
                const userField = page.locator('input[name="Username"]');
                if (await userField.isVisible()) {
                    await userField.pressSequentially(username, { delay: Math.floor(Math.random() * 150) + 150 });
                    await takeSnapshot(page, socket, 'Username Typed');
                    await humanDelay(page);
                    await page.getByRole('button', { name: 'Next' }).click();
                    await takeSnapshot(page, socket, 'Clicked Next (Username)');
                } else {
                    log('⚠️ Username field issue.');
                }

                await page.waitForTimeout(2000);
                if (await page.getByText('Sorry, we could not create your Google Account').isVisible()) throw new Error('IP_BURNED_USER');

                // --- STEP 4: PASSWORD ---
                log('🔑 Setting Password...');
                await page.waitForSelector('input[name="Passwd"]', { timeout: 15000 });
                await humanDelay(page);

                const pass = settings.password;
                
                await page.locator('input[name="Passwd"]').pressSequentially(pass, { delay: 200 });
                await page.waitForTimeout(1000);
                await page.locator('input[name="PasswdAgain"]').pressSequentially(pass, { delay: 200 });

                await takeSnapshot(page, socket, 'Password Filled');
                await humanDelay(page);
                
                await page.getByRole('button', { name: 'Next' }).click();
                await takeSnapshot(page, socket, 'Clicked Next (Password)');

                // --- STEP 5: FINAL VERIFICATION ---
                log('📱 Final Check (The Moment of Truth)...');
                await page.waitForTimeout(5000);
                await takeSnapshot(page, socket, 'Final Result Page');

                // Check Error
                if (await page.getByText('Sorry, we could not create your Google Account').isVisible()) {
                    throw new Error('IP_BURNED_FINAL: Google rejected the fingerprint.');
                }

                const skipBtn = page.getByRole('button', { name: 'Skip' });
                if (await skipBtn.isVisible()) {
                    log('🎉 SUCCESS: Account Created! Phone Skip Available.', 'success');
                    await takeSnapshot(page, socket, 'SUCCESS_SCREEN');
                    await skipBtn.click();
                } else {
                    log('⚠️ Phone Number Verification Required (Normal behavior).', 'error');
                }

            } catch (stepError) {
                log(`❌ Error: ${stepError.message}`, 'error');
                await takeSnapshot(page, socket, 'ERROR STATE');
            }

            clearInterval(streamInterval);
            await context.close();
            await browser.close();
            log('💤 Resting 10s...');
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
