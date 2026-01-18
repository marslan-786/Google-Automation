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
                headless: true,
                args: [
                    '--disable-blink-features=AutomationControlled',
                    '--no-sandbox', 
                    '--disable-setuid-sandbox',
                    '--ignore-certificate-errors',
                    '--disable-webgl-image-chromium', 
                    '--disable-accelerated-2d-canvas',
                ]
            });

            context = await browser.newContext({
                ...devices['Pixel 7'],
                proxy: proxyData ? { server: proxyData.server, username: proxyData.username, password: proxyData.password } : undefined,
                locale: 'en-US',
                // ⚠️ Timezone ab proxy ke hisab se set hona chahiye, hardcode hata diya hai
                // timezoneId: 'America/New_York', 
                deviceScaleFactor: 3,
                isMobile: true,
                hasTouch: true,
                userAgent: 'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/116.0.0.0 Mobile Safari/537.36',
            });

            // 🔥🔥🔥 THE HARDCORE SPOOFING INJECTION 🔥🔥🔥
            await context.addInitScript(() => {
                // 1. Webdriver Hiding
                Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
                
                // 2. Hardware Info (Real Pixel 7 Specs)
                Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => 8 });
                Object.defineProperty(navigator, 'deviceMemory', { get: () => 8 });
                Object.defineProperty(navigator, 'platform', { get: () => 'Linux armv8l' });

                // 3. Fake Battery API (Mobile always has battery)
                if (navigator.getBattery) {
                    navigator.getBattery = async () => ({
                        charging: true,
                        chargingTime: 0,
                        dischargingTime: Infinity,
                        level: 0.85, // 85% Battery
                        addEventListener: () => {}
                    });
                }

                // 4. Fake Network Information (4G Connection)
                Object.defineProperty(navigator, 'connection', {
                    get: () => ({
                        effectiveType: '4g',
                        rtt: 50,
                        downlink: 10,
                        saveData: false
                    })
                });

                // 5. 🛑 GPU SPOOFING (Sabse Important) 🛑
                const getParameter = WebGLRenderingContext.prototype.getParameter;
                WebGLRenderingContext.prototype.getParameter = function(parameter) {
                    // UNMASKED_VENDOR_WEBGL
                    if (parameter === 37445) return 'ARM';
                    // UNMASKED_RENDERER_WEBGL (Mali-G710 is Pixel 7 GPU)
                    if (parameter === 37446) return 'Mali-G710';
                    return getParameter(parameter);
                };
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
                await humanDelay(page);

                await takeSnapshot(page, socket, 'Page Loaded');

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
                await page.getByRole('option', { name: 'January' }).click();
                await page.waitForTimeout(500);

                // Day & Year
                await page.locator('input[name="day"]').pressSequentially(String(Math.floor(Math.random() * 28) + 1), { delay: 300 });
                await page.waitForTimeout(500);
                await page.locator('input[name="year"]').pressSequentially('1998', { delay: 300 });
                await page.waitForTimeout(1000);

                // Gender (Strict Mode Fixed)
                await page.locator('#gender').click();
                await page.waitForTimeout(1000);
                
                const isMale = Math.random() > 0.5;
                const genderText = isMale ? 'Male' : 'Female';
                log(`Selected Gender: ${genderText}`);

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
                
                // Agar input field na ho to wait karo
                const userField = page.locator('input[name="Username"]');
                if (await userField.isVisible()) {
                    await userField.pressSequentially(username, { delay: Math.floor(Math.random() * 150) + 150 });
                    await takeSnapshot(page, socket, 'Username Typed');
                    await humanDelay(page);
                    await page.getByRole('button', { name: 'Next' }).click();
                    await takeSnapshot(page, socket, 'Clicked Next (Username)');
                } else {
                    log('⚠️ Username field not found immediately.');
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
                log('📱 Final Check...');
                await page.waitForTimeout(5000);
                await takeSnapshot(page, socket, 'Final Result Page');

                // Check Error
                if (await page.getByText('Sorry, we could not create your Google Account').isVisible()) {
                    throw new Error('IP_BURNED_FINAL: Google detected GPU/Server signature.');
                }

                const skipBtn = page.getByRole('button', { name: 'Skip' });
                if (await skipBtn.isVisible()) {
                    log('✅ SUCCESS: Account Created! Phone Skip Clicked.', 'success');
                    await takeSnapshot(page, socket, 'Success Page');
                    await skipBtn.click();
                    // Yahan DB save logic aa sakti hai
                } else {
                    log('⚠️ Phone Number Required (Normal Verification).', 'error');
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
