const { chromium } = require('playwright-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const { FingerprintGenerator } = require('fingerprint-generator');
const { FingerprintInjector } = require('fingerprint-injector');
const { faker } = require('@faker-js/faker');
const fs = require('fs');

chromium.use(StealthPlugin());

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

async function humanDelay(page) {
    const delay = Math.floor(Math.random() * 3000) + 2000; 
    await page.waitForTimeout(delay);
}

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

    // Generators Setup
    const fingerprintGenerator = new FingerprintGenerator();
    const fingerprintInjector = new FingerprintInjector();

    const proxies = settings.proxies.split('\n').filter(p => p.trim() !== "");
    const proxyList = proxies.length > 0 ? proxies : ["Direct IP"];

    const log = (msg, type = 'normal') => {
        let prefix = type === 'error' ? '❌ ' : type === 'success' ? '✅ ' : 'ℹ️ ';
        socket.emit('log', `${prefix}${msg}`);
    };

    try {
        // --- Loop starts here ---
        for (let i = 0; i < proxyList.length; i++) {
            if (!isRunning) break;

            let browser = null;
            let context = null;

            try {
                const currentProxy = proxyList[i];
                const proxyData = parseProxy(currentProxy);
                log(`🔄 Cycle ${i+1}: Initializing Fresh Process...`);

                // 1. 🔥 RANDOM FINGERPRINT GENERATION 🔥
                // Hum Pixel fix nahi kar rahe, ye ab Samsung, Xiaomi, Oppo kuch bhi ban sakta hai
                const fingerprint = fingerprintGenerator.getFingerprint({
                    devices: ['mobile'],       // Sirf Mobile
                    operatingSystems: ['android'], // Sirf Android
                    browsers: [{ name: 'chrome', minVersion: 110 }], // Latest Chrome wala mobile
                });

                // User Agent se brand ka pata lagayen taake log me dikha saken
                const ua = fingerprint.fingerprint.navigator.userAgent;
                log(`📱 Device Identity: ${ua.substring(ua.indexOf('Android'), ua.indexOf('Android')+40)}...`);

                // 2. 🔥 FRESH BROWSER LAUNCH (INSIDE LOOP) 🔥
                // Har cycle me naya browser khulega
                browser = await chromium.launch({
                    headless: true,
                    args: [
                        '--disable-blink-features=AutomationControlled',
                        '--no-sandbox', 
                        '--disable-setuid-sandbox',
                        '--ignore-certificate-errors',
                        '--disable-infobars',
                        '--hide-scrollbars',
                    ]
                });

                // 3. Context Create
                context = await browser.newContext({
                    proxy: proxyData ? { server: proxyData.server, username: proxyData.username, password: proxyData.password } : undefined,
                    locale: 'en-US',
                    // Baki cheezein fingerprint injector sambhal lega
                });

                // 4. Inject Fingerprint (Heavy Spoofing)
                await fingerprintInjector.attachFingerprintToPlaywright(context, fingerprint);

                const page = await context.newPage();

                // Stream Interval
                const streamInterval = setInterval(async () => {
                    if (!isRunning || !page || page.isClosed()) { clearInterval(streamInterval); return; }
                    try {
                        const screenshot = await page.screenshot({ quality: 20, type: 'jpeg' });
                        socket.emit('screen_update', screenshot.toString('base64'));
                    } catch(e) {}
                }, 4000);

                // --- FLOW STARTS ---
                log('🌐 Opening Signup Page...');
                await page.goto('https://accounts.google.com/signup/v2/createaccount?flowName=GlifWebSignIn&flowEntry=SignUp', { timeout: 60000 });
                await humanDelay(page);
                await takeSnapshot(page, socket, 'Page Loaded');

                // IP Check
                if (await page.getByText('Sorry, we could not create your Google Account').isVisible()) throw new Error('IP_BURNED_START');

                // Step 1: Name
                const fName = faker.person.firstName();
                log(`👤 Name: ${fName}`);
                await page.locator('input[name="firstName"]').pressSequentially(fName, { delay: Math.floor(Math.random() * 200) + 100 }); 
                await takeSnapshot(page, socket, 'Name Filled');
                await humanDelay(page);
                await page.getByRole('button', { name: 'Next' }).click();
                await takeSnapshot(page, socket, 'Clicked Next (Name)');

                // Step 2: Birthday
                log('🎂 Filling Birthday...');
                await page.waitForSelector('#month', { state: 'visible', timeout: 15000 });
                await humanDelay(page);

                await page.locator('#month').click();
                await page.waitForTimeout(500);
                await page.getByRole('option', { name: 'January' }).click();
                await page.waitForTimeout(500);

                await page.locator('input[name="day"]').pressSequentially(String(Math.floor(Math.random() * 28) + 1), { delay: 300 });
                await page.waitForTimeout(500);
                await page.locator('input[name="year"]').pressSequentially('1999', { delay: 300 });

                await page.locator('#gender').click();
                await page.waitForTimeout(1000);
                const isMale = Math.random() > 0.5;
                const genderText = isMale ? 'Male' : 'Female';
                await page.getByRole('option', { name: genderText, exact: true }).click();

                await humanDelay(page);
                await page.getByRole('button', { name: 'Next' }).click();
                await takeSnapshot(page, socket, 'Clicked Next (Birthday)');

                // Step 3: Username
                log('📧 Handling Username...');
                await page.waitForTimeout(3000);

                // Trap Checks
                const useExisting = page.getByText('Use an email address or phone number');
                const switchToGmail = page.getByText('Get a Gmail address instead');
                if (await useExisting.isVisible() || await switchToGmail.isVisible()) {
                    log('⚠️ Trap Detected. Switching to Gmail Creation...');
                    await switchToGmail.click();
                    await humanDelay(page);
                }

                const createOwnRadio = page.getByText('Create your own Gmail address');
                if (await createOwnRadio.isVisible()) {
                    log('🔘 Clicking Radio Button...');
                    await createOwnRadio.click();
                    await humanDelay(page);
                }

                const username = getNextUsername(settings.mode, settings.customBase);
                log(`⌨️ Typing: ${username}`);
                
                const userField = page.locator('input[name="Username"]').or(page.locator('input[type="email"]'));
                if (await userField.isVisible()) {
                    await userField.pressSequentially(username, { delay: Math.floor(Math.random() * 150) + 150 });
                    await humanDelay(page);
                    await page.getByRole('button', { name: 'Next' }).click();
                    await takeSnapshot(page, socket, 'Clicked Next (Username)');
                } else {
                    throw new Error('Username Input Missing');
                }

                await page.waitForTimeout(2000);
                if (await page.getByText('Sorry, we could not create your Google Account').isVisible()) throw new Error('IP_BURNED_USER');

                // Step 4: Password
                log('🔑 Setting Password...');
                await page.waitForSelector('input[name="Passwd"]', { timeout: 15000 });
                await humanDelay(page);

                const pass = settings.password;
                await page.locator('input[name="Passwd"]').pressSequentially(pass, { delay: 200 });
                await page.locator('input[name="PasswdAgain"]').pressSequentially(pass, { delay: 200 });
                await humanDelay(page);
                await page.getByRole('button', { name: 'Next' }).click();
                await takeSnapshot(page, socket, 'Clicked Next (Password)');

                // Step 5: Final Check
                log('📱 Final Check...');
                await page.waitForTimeout(5000);
                await takeSnapshot(page, socket, 'Final Result Page');

                if (await page.getByText('Sorry, we could not create your Google Account').isVisible()) throw new Error('IP_BURNED_FINAL');
                
                // QR Code / Phone Verification Check
                if (await page.getByText('Verify some info before creating an account').isVisible() || await page.getByText('Scan the QR code').isVisible()) {
                     throw new Error('CROSS_DEVICE_VERIFY: Google wants physical phone scan.');
                }

                const skipBtn = page.getByRole('button', { name: 'Skip' });
                if (await skipBtn.isVisible()) {
                    log('🎉 SUCCESS: Account Created! Clicking Skip.', 'success');
                    await takeSnapshot(page, socket, 'SUCCESS_SCREEN');
                    await skipBtn.click();
                } else {
                    log('⚠️ Phone Number Required.', 'error');
                }

                clearInterval(streamInterval);

            } catch (stepError) {
                log(`❌ Error: ${stepError.message}`, 'error');
                await takeSnapshot(page, socket, 'ERROR STATE');
            } finally {
                // 🔥 CLEANUP AND KILL 🔥
                // Yahan hum browser ko mukammal band kar rahe hain taake
                // agli cycle me bilkul fresh start ho.
                if (context) await context.close();
                if (browser) await browser.close();
                log('🗑️ Browser Destroyed. Cleared for next cycle.');
            }

            log('💤 Resting 8s before fresh start...');
            await new Promise(r => setTimeout(r, 8000));
        }

    } catch (error) {
        log(`❌ Critical System Error: ${error.message}`, 'error');
    } finally {
        isRunning = false;
        socket.emit('log', '🛑 All Tasks Stopped.');
    }
}

async function stopBot() {
    isRunning = false;
    // Force Kill just in case
}

module.exports = { startBot, stopBot };
