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

            // 1. Launch Browser
            browser = await chromium.launch({
                headless: true, // Railway par TRUE rakhna
                args: ['--disable-blink-features=AutomationControlled', '--no-sandbox', '--disable-setuid-sandbox']
            });

            context = await browser.newContext({
                ...devices['Pixel 7'],
                proxy: proxyData ? { server: proxyData.server, username: proxyData.username, password: proxyData.password } : undefined,
                locale: 'en-US',
                timezoneId: 'America/New_York',
                deviceScaleFactor: 3,
                isMobile: true,
                hasTouch: true,
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
                
                const fName = faker.person.firstName();
                log(`👤 Name: ${fName} (Skipping Last Name)`);
                
                await page.fill('input[name="firstName"]', fName);
                await page.waitForTimeout(1000);
                await page.getByRole('button', { name: 'Next' }).click();

                // --- STEP 2: BIRTHDAY (FIXED LOGIC) ---
                log('🎂 Filling Birthday (Human Style)...');
                
                // Wait for the Month Dropdown to appear
                await page.waitForSelector('#month', { state: 'visible', timeout: 15000 });

                // 1. Month Select Karna (Click Logic)
                await page.locator('#month').click(); // Dropdown kholo
                await page.waitForTimeout(500);
                // "January" dhoond kar click karo
                await page.getByRole('option', { name: 'January' }).click();

                // 2. Day Fill Karna
                const randomDay = String(Math.floor(Math.random() * 28) + 1);
                await page.fill('input[name="day"]', randomDay);

                // 3. Year Fill Karna
                const randomYear = String(Math.floor(Math.random() * (2000 - 1985 + 1)) + 1985);
                await page.fill('input[name="year"]', randomYear);

                // 4. Gender Select Karna (Click Logic)
                await page.locator('#gender').click(); // Dropdown kholo
                await page.waitForTimeout(500);
                
                // Randomly Male ya Female select karo
                const genderChoice = Math.random() > 0.5 ? 'Male' : 'Female';
                await page.getByRole('option', { name: genderChoice, exact: false }).click();

                log(`📅 Date: Jan/${randomDay}/${randomYear} | Gender: ${genderChoice}`);
                
                await page.waitForTimeout(1000);
                await page.getByRole('button', { name: 'Next' }).click();

                // --- STEP 3: USERNAME ---
                log('📧 Creating Username...');
                
                // Kabhi kabhi Google "Create your own" ka option deta hai
                try {
                    const createOwnBtn = page.getByText('Create your own Gmail address');
                    if (await createOwnBtn.isVisible()) {
                        await createOwnBtn.click();
                        await page.waitForTimeout(500);
                    }
                } catch(e) {}

                // Username field ka intezar karo
                await page.waitForSelector('input[name="Username"]', { timeout: 10000 });
                
                const username = getNextUsername(settings.mode, settings.customBase);
                log(`⌨️ Typing: ${username}`);
                
                await page.fill('input[name="Username"]', username);
                await page.waitForTimeout(1000);
                await page.getByRole('button', { name: 'Next' }).click();

                // --- STEP 4: PASSWORD ---
                log('🔑 Setting Password...');
                await page.waitForSelector('input[name="Passwd"]', { timeout: 15000 });

                const pass = settings.password;
                await page.fill('input[name="Passwd"]', pass);
                await page.fill('input[name="PasswdAgain"]', pass);
                await page.getByRole('button', { name: 'Next' }).click();

                // --- STEP 5: PHONE SKIP CHECK ---
                log('📱 Checking Phone Verification...');
                await page.waitForTimeout(3000);

                const skipBtn = page.getByRole('button', { name: 'Skip' });
                if (await skipBtn.isVisible()) {
                    log('✅ SUCCESS: Phone Skip Available! Clicking...', 'success');
                    await skipBtn.click();
                    // Yahan mazeed steps (Review/Agree) add kiye ja sakte hain
                } else {
                    log('⚠️ Phone Number Required. Stopping here.', 'error');
                }

            } catch (stepError) {
                // Agar koi bhi step fail hua to yahan pakra jaye ga
                // Aur aglay steps nahi chalenge.
                log(`❌ Stuck: ${stepError.message.split('\n')[0]}`, 'error');
            }

            // Cleanup before next proxy
            clearInterval(streamInterval);
            await context.close();
            await browser.close();
            log('💤 Waiting 5s before next cycle...');
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
