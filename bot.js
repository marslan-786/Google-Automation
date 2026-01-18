const { chromium } = require('playwright-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const { FingerprintGenerator } = require('fingerprint-generator');
const { FingerprintInjector } = require('fingerprint-injector');
const { faker } = require('@faker-js/faker');
const fs = require('fs');

chromium.use(StealthPlugin());

// --- CONFIG ---
const MOBILE_DEVICES = [
    { name: "Pixel 7", width: 412, height: 915, ratio: 3.5 },
    { name: "Galaxy S22", width: 360, height: 800, ratio: 3.0 }
];

let isRunning = false;
let manualResolver = null; // Promise resolver for pause logic

function getRandomDevice() {
    return MOBILE_DEVICES[Math.floor(Math.random() * MOBILE_DEVICES.length)];
}

// --- HELPER FUNCTIONS ---
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

async function humanDelay(page) {
    await page.waitForTimeout(Math.floor(Math.random() * 2000) + 2000);
}

async function takeSnapshot(page, socket, label) {
    if(!page || page.isClosed()) return;
    try {
        const screenshot = await page.screenshot({ quality: 40, type: 'jpeg' });
        socket.emit('screen_update', screenshot.toString('base64'));
        socket.emit('log', `📸 SNAPSHOT: ${label}`);
    } catch (e) {}
}

// 🔥 PAUSE FUNCTION 🔥
// Ye function bot ko rok dega jab tak aap dashboard se reply na karein
async function waitForManualInput(socket, type) {
    socket.emit('log', `⚠️ WAITING FOR USER INPUT: ${type.toUpperCase()}`);
    socket.emit('request_manual_input', type); // Frontend ko signal bhejo

    return new Promise((resolve) => {
        // Ye resolver hum global variable me store kar lenge
        // server.js isko trigger karega
        manualResolver = resolve;
    });
}

// --- MAIN LOGIC ---
async function startBot(settings, socket) {
    if (isRunning) return;
    isRunning = true;

    // LISTENER FOR MANUAL RESPONSE
    // Jab frontend se jawab aaye ga, ye promise ko resolve karega
    socket.on('manual_response', (data) => {
        if (manualResolver) {
            socket.emit('log', `✅ Received Manual Data: ${data.value}`);
            manualResolver(data.value); // Resume bot
            manualResolver = null;
        }
    });

    const fingerprintGenerator = new FingerprintGenerator();
    const fingerprintInjector = new FingerprintInjector();
    const proxies = settings.proxies.split('\n').filter(p => p.trim() !== "");
    const proxyList = proxies.length > 0 ? proxies : ["Direct IP"];

    const log = (msg) => socket.emit('log', `ℹ️ ${msg}`);

    try {
        for (let i = 0; i < proxyList.length; i++) {
            if (!isRunning) break;

            let browser = null;
            let context = null;
            let page = null;

            try {
                const proxyData = parseProxy(proxyList[i]);
                const deviceSpec = getRandomDevice();
                log(`🔄 Cycle ${i+1}: ${deviceSpec.name}`);

                const fingerprint = fingerprintGenerator.getFingerprint({
                    devices: ['mobile'], operatingSystems: ['android'], browsers: [{ name: 'chrome', minVersion: 110 }]
                });

                browser = await chromium.launch({
                    headless: true,
                    args: [
                        '--disable-blink-features=AutomationControlled',
                        '--no-sandbox', '--disable-setuid-sandbox',
                        `--window-size=${deviceSpec.width},${deviceSpec.height}`,
                        '--user-agent=' + fingerprint.fingerprint.navigator.userAgent
                    ]
                });

                context = await browser.newContext({
                    proxy: proxyData ? { server: proxyData.server, username: proxyData.username, password: proxyData.password } : undefined,
                    locale: 'en-US',
                    viewport: { width: deviceSpec.width, height: deviceSpec.height },
                    deviceScaleFactor: deviceSpec.ratio,
                    isMobile: true, hasTouch: true,
                    userAgent: fingerprint.fingerprint.navigator.userAgent,
                });

                await fingerprintInjector.attachFingerprintToPlaywright(context, fingerprint);
                page = await context.newPage();

                // CDP Force Mobile
                const client = await context.newCDPSession(page);
                await client.send('Emulation.setDeviceMetricsOverride', {
                    width: deviceSpec.width, height: deviceSpec.height, deviceScaleFactor: deviceSpec.ratio,
                    mobile: true, screenOrientation: { type: 'portraitPrimary', angle: 0 }
                });

                // Stream
                const streamInterval = setInterval(async () => {
                    if (!isRunning || !page || page.isClosed()) { clearInterval(streamInterval); return; }
                    try {
                        const screenshot = await page.screenshot({ quality: 20, type: 'jpeg' });
                        socket.emit('screen_update', screenshot.toString('base64'));
                    } catch(e) {}
                }, 4000);

                // --- STEPS START ---
                await page.goto('https://accounts.google.com/signup/v2/createaccount?flowName=GlifWebSignIn&flowEntry=SignUp');
                await humanDelay(page);

                // 1. Name
                await page.locator('input[name="firstName"]').pressSequentially(faker.person.firstName(), { delay: 150 });
                await page.getByRole('button', { name: 'Next' }).click();
                await humanDelay(page);

                // 2. Birthday
                await page.waitForSelector('#month');
                await page.locator('#month').click();
                await page.getByRole('option', { name: 'January' }).click();
                await page.locator('input[name="day"]').pressSequentially('15');
                await page.locator('input[name="year"]').pressSequentially('1998');
                await page.locator('#gender').click();
                await page.getByRole('option', { name: 'Male', exact: true }).click();
                await page.getByRole('button', { name: 'Next' }).click();
                await humanDelay(page);

                // 3. Username (Smart Switch)
                const switchToGmail = page.getByText('Get a Gmail address instead');
                if (await switchToGmail.isVisible()) await switchToGmail.click();
                
                const createOwn = page.getByText('Create your own Gmail address');
                if (await createOwn.isVisible()) await createOwn.click();

                let username = faker.internet.userName().replace(/[^a-zA-Z0-9]/g, '') + Math.floor(Math.random() * 9999);
                if(settings.mode === 'custom') {
                     // Custom logic here (simplified for brevity)
                     username = settings.customBase + Math.floor(Math.random() * 99); 
                }

                await page.locator('input').first().pressSequentially(username, { delay: 100 });
                await page.getByRole('button', { name: 'Next' }).click();
                await humanDelay(page);

                // 4. Password
                await page.locator('input[name="Passwd"]').pressSequentially(settings.password, { delay: 100 });
                await page.locator('input[name="PasswdAgain"]').pressSequentially(settings.password, { delay: 100 });
                await page.getByRole('button', { name: 'Next' }).click();
                await humanDelay(page);

                // 5. PHONE VERIFICATION (The New Part)
                await page.waitForTimeout(3000);
                
                // Check agar Skip hai
                if (await page.getByRole('button', { name: 'Skip' }).isVisible()) {
                    log('🎉 Phone Skip Available!');
                    await page.getByRole('button', { name: 'Skip' }).click();
                } else {
                    log('📱 Phone Verification Required.');
                    await takeSnapshot(page, socket, 'Phone Page Reached');
                    
                    // a) Click "Send SMS" if visible (Android native view)
                    if (await page.getByText('Send SMS').isVisible()) {
                        log('Clicking "Send SMS"...');
                        await page.getByText('Send SMS').click();
                        await humanDelay(page);
                    }

                    // b) Check for Input Field
                    const phoneInput = page.locator('input[type="tel"]').or(page.locator('#phoneNumberId'));
                    if (await phoneInput.isVisible()) {
                        // 🔥 PAUSE AND WAIT FOR USER 🔥
                        const userNumber = await waitForManualInput(socket, 'phone');
                        
                        log(`Filling Phone: ${userNumber}`);
                        await phoneInput.fill(userNumber);
                        await page.getByRole('button', { name: 'Next' }).or(page.getByRole('button', { name: 'Get code' })).click();
                        await humanDelay(page);
                    }

                    // c) OTP Input
                    const otpInput = page.locator('input[type="tel"]').or(page.locator('input[name="code"]'));
                    if (await otpInput.isVisible()) {
                        await takeSnapshot(page, socket, 'OTP Page');
                        
                        // 🔥 PAUSE FOR OTP 🔥
                        const otpCode = await waitForManualInput(socket, 'otp');
                        
                        log(`Filling OTP: ${otpCode}`);
                        await otpInput.fill(otpCode);
                        await page.getByRole('button', { name: 'Verify' }).or(page.getByRole('button', { name: 'Next' })).click();
                        await humanDelay(page);
                        
                        log('🎉 Verified! Proceeding...');
                        await takeSnapshot(page, socket, 'Verification Done');
                    }
                }

                clearInterval(streamInterval);

            } catch (err) {
                log(`❌ Error: ${err.message}`);
                if(page) await takeSnapshot(page, socket, 'Error');
            } finally {
                if(browser) await browser.close();
                log('Cycle Ended.');
            }
            await new Promise(r => setTimeout(r, 5000));
        }
    } catch (e) { log(e.message); }
    isRunning = false;
}

module.exports = { startBot, stopBot: () => { isRunning = false; } };
