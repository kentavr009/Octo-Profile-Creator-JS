#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');
const axios = require('axios');
const { parse } = require('csv-parse/sync');
const yargs = require('yargs/yargs');
const { hideBin } = require('yargs/helpers');
const cliProgress = require('cli-progress');

// --- КОНФИГУРАЦИЯ И АРГУМЕНТЫ ---
dotenv.config();

const argv = yargs(hideBin(process.argv))
    .usage('Usage: $0 [options]')
    .option('proxyFile', { alias: 'p', describe: 'Путь к файлу с прокси', type: 'string', default: process.env.PROXY_FILE || 'proxies.csv' })
    .option('cookieFile', { alias: 'c', describe: 'Путь к файлу с cookies', type: 'string', default: process.env.COOKIE_FILE || 'cookies.json' })
    .option('count', { alias: 'n', describe: 'Количество профилей для создания (0 = по числу прокси)', type: 'number', default: Number(process.env.PROFILE_COUNT || '0') })
    .option('prefix', { describe: 'Префикс для имени профиля', type: 'string', default: 'BatchProfile' })
    .help().argv;

const API_BASE = 'https://app.octobrowser.net/api/v2/automation';
const REQ_TIMEOUT = 30000;
const PAUSE = 500;
const DEFAULT_FP = { os: 'win', screen: '1920x1080' };
const BASE_DIR = path.resolve(__dirname);
const TOKEN = process.env.OCTO_API_TOKEN;
if (!TOKEN) {
    console.error('🛑 Токен OCTO_API_TOKEN не найден. Укажите его в файле .env');
    process.exit(1);
}
const HEADERS = { 'X-Octo-Api-Token': TOKEN };
const PROXY_CSV = path.join(BASE_DIR, argv.proxyFile);
const COOKIE_JSON = path.join(BASE_DIR, argv.cookieFile);

// --- УТИЛИТЫ ---
function loadProxiesSync(file) {
    if (!fs.existsSync(file)) { console.error('🛑 Файл с прокси не найден:', file); process.exit(1); }
    const csvContent = fs.readFileSync(file, 'utf8');
    try {
        const records = parse(csvContent, { columns: true, skip_empty_lines: true, trim: true, delimiter: ',' });
        if (!records.length) { console.error('🛑 Прокси не загружены'); process.exit(1); }
        records.forEach(row => {
            if (!row.port || isNaN(Number(row.port))) { console.error('🛑 Неверная строка в прокси:', row); process.exit(1); }
            row.port = Number(row.port);
            if (row.login && !row.username) row.username = row.login;
            if (!row.type) row.type = 'http';
        });
        return records;
    } catch (err) { console.error('🛑 Ошибка парсинга proxies.csv:', err.message); process.exit(1); }
}

function loadCookies(file) {
    if (!fs.existsSync(file)) return {};
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (typeof data !== 'object' || Array.isArray(data)) { console.error('🛑 cookies.json должен быть JSON-объектом'); process.exit(1); }
    return data;
}

async function apiPost(endpoint, payload) {
    const url = `${API_BASE}/${endpoint.replace(/^\//, '')}`;
    const response = await axios.post(url, payload, { headers: HEADERS, timeout: REQ_TIMEOUT, validateStatus: status => status < 500 });
    if (![200, 201].includes(response.status) || !response.data) { throw new Error(`HTTP ${response.status} → ${(response.data && response.data.message) || response.statusText}`); }
    return response.data.data || response.data;
}

// --- ОСНОВНАЯ ЛОГИКА ---
async function main() {
    console.log('🚀 Запускаем создание профилей Octo Browser...');
    const proxies = loadProxiesSync(PROXY_CSV);
    const cookiesMap = loadCookies(COOKIE_JSON);
    const total = argv.count > 0 ? argv.count : proxies.length;
    if (total === 0) { console.warn('⚠️ Количество профилей для создания равно 0. Завершение.'); return; }

    let proxyIdx = 0, successCount = 0, failureCount = 0;
    const progressBar = new cliProgress.SingleBar({ format: 'Создание |{bar}| {percentage}% || {value}/{total} Профилей | Успешно: {success} | Ошибки: {failure}', barCompleteChar: '\u2588', barIncompleteChar: '\u2591', hideCursor: true });
    
    progressBar.start(total, 0, { success: 0, failure: 0 });

    for (let idx = 1; idx <= total; idx++) {
        const proxy = proxies[proxyIdx];
        proxyIdx = (proxyIdx + 1) % proxies.length;
        const title = `${argv.prefix}_${idx}`;
        const cookies = cookiesMap[String(idx - 1)];
        const payload = { title, proxy, fingerprint: DEFAULT_FP };
        if (cookies) payload.cookies = cookies;

        try {
            await apiPost('profiles', payload);
            successCount++;
        } catch (err) {
            failureCount++;
            progressBar.stop();
            console.error(`\n❌ Ошибка при создании профиля #${idx} (${title}): ${err.message}`);
            progressBar.start(total, idx, { success: successCount, failure: failureCount });
        }
        
        progressBar.update(idx, { success: successCount, failure: failureCount });
        await new Promise(resolve => setTimeout(resolve, PAUSE));
    }

    progressBar.stop();
    console.log(`\n✨ Готово! Успешно создано: ${successCount}, ошибки: ${failureCount}.`);
}

main().catch(e => {
    console.error('\n🛑 Критическая ошибка:', e.message);
    process.exit(1);
});
