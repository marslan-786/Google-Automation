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
                    '--disable-infobars',
                    '--window-position=0,0',
                    '--ignore-certifcate-errors',
                    '--ignore-certifcate-errors-spki-list',
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
                // Force Google to think we are Android
                userAgent: 'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/116.0.0.0 Mobile Safari/537.36',
            });

            // --- 🛑 ANTI-DETECT INJECTION (The Secret Sauce) ---
            // Railway Linux Server ko chupa kar Real Android batana
            await context.addInitScript(() => {
                Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
                // Platform ko Linux x86_64 se hata kar Android ARM banana
                Object.defineProperty(navigator, 'platform', { get: () => 'Linux armv8l' });
                // Hardware concurrency ko real phone jaisa banana
                Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => 4 });
            });

            const page = await context.newPage();

            // Screenshot Stream
            const streamInterval = setInterval(async () => {
                if (!isRunning || page.isClosed()) { clearInterval(streamInterval); return; }
                try {
                    const screenshot = await page.screenshot({ quality: 30, type: 'jpeg' });
                    socket.emit('screen_update', screenshot.toString('base64'));
                } catch(e) {}
            }, 3000);

            try {
                // --- STEP 1: NAME ---
                log('🌐 Opening Signup Page...');
                await page.goto('https://accounts.google.com/signup/v2/createaccount?flowName=GlifWebSignIn&flowEntry=SignUp', { timeout: 60000 });
                
                // CHECK FOR EARLY ERROR
                if (await page.getByText('Sorry, we could not create your Google Account').isVisible()) {
                    throw new Error('IP_BURNED: Google blocked this proxy immediately.');
                }

                const fName = faker.person.firstName();
                log(`👤 Name: ${fName} (Skipping Last Name)`);
                await page.fill('input[name="firstName"]', fName);
                await page.waitForTimeout(1000);
                await page.getByRole('button', { name: 'Next' }).click();

                // --- STEP 2: BIRTHDAY ---
                log('🎂 Filling Birthday...');
                await page.waitForSelector('#month', { state: 'visible', timeout: 15000 });
                
                // Month Click
                await page.locator('#month').click();
                await page.waitForTimeout(500);
                await page.getByRole('option', { name: 'January' }).click();

                // Day & Year
                await page.fill('input[name="day"]', String(Math.floor(Math.random() * 28) + 1));
                await page.fill('input[name="year"]', String(Math.floor(Math.random() * (2000 - 1985 + 1)) + 1985));

                // Gender
                await page.locator('#gender').click();
                await page.waitForTimeout(500);
                const genderChoice = Math.random() > 0.5 ? 'Male' : 'Female';
                await page.getByRole('option', { name: genderChoice, exact: false }).click();
                
                await page.waitForTimeout(1000);
                await page.getByRole('button', { name: 'Next' }).click();

                // --- STEP 3: USERNAME (FIXED FOR RADIO BUTTONS) ---
                log('📧 Handling Username Selection...');
                
                // Pehle wait karein ke page load ho jaye
                await page.waitForTimeout(2000);

                // Check 1: Kya Radio Buttons aye hain?
                const createOwnRadio = page.getByText('Create your own Gmail address');
                const customInput = page.locator('input[name="Username"]');

                if (await createOwnRadio.isVisible()) {
                    log('🔘 "Create your own" option detected. Clicking...');
                    await createOwnRadio.click(); // Radio button select karo
                    await page.waitForTimeout(1000); // Input field khulne ka wait
                }

                // Ab Input field dhoondo
                if (await customInput.isVisible()) {
                    const username = getNextUsername(settings.mode, settings.customBase);
                    log(`⌨️ Typing Username: ${username}`);
                    await customInput.fill(username);
                    await page.waitForTimeout(1000);
                    await page.getByRole('button', { name: 'Next' }).click();
                } else {
                    // Agar input field abhi bhi nahi mili to shayad direct aglay page par ho
                    log('⚠️ Username input not found immediately, checking next step...');
                }

                // CHECK FOR ERROR AFTER USERNAME
                await page.waitForTimeout(2000);
                if (await page.getByText('Sorry, we could not create your Google Account').isVisible()) {
                    throw new Error('IP_BURNED: Google blocked after Username.');
                }

                // --- STEP 4: PASSWORD ---
                log('🔑 Setting Password...');
                await page.waitForSelector('input[name="Passwd"]', { timeout: 15000 });

                const pass = settings.password;
                await page.fill('input[name="Passwd"]', pass);
                await page.fill('input[name="PasswdAgain"]', pass);
                await page.getByRole('button', { name: 'Next' }).click();

                // --- STEP 5: PHONE SKIP ---
                log('📱 Checking Phone Verification...');
                await page.waitForTimeout(3000);

                // ERROR CHECK FINAL
                if (await page.getByText('Sorry, we could not create your Google Account').isVisible()) {
                    throw new Error('IP_BURNED: Google blocked at Phone Step.');
                }

                const skipBtn = page.getByRole('button', { name: 'Skip' });
                if (await skipBtn.isVisible()) {
                    log('✅ SUCCESS: Phone Skip Available! Clicking...', 'success');
                    await skipBtn.click();
                } else {
                    log('⚠️ Phone Number Required. Stopping.', 'error');
                }

            } catch (stepError) {
                log(`❌ Error: ${stepError.message}`, 'error');
                // Agar IP Burn hui hai to agli proxy par jao, ruko mat
            }

            clearInterval(streamInterval);
            await context.close();
            await browser.close();
            log('💤 Cooling down 5s...');
            await new Promise(r => setTimeout(r, 5000));
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
