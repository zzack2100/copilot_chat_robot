import process from 'node:process';
import dotenv from 'dotenv';
import cors from 'cors';
import express from 'express';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema, } from '@modelcontextprotocol/sdk/types.js';
const result = dotenv.config({ quiet: true });
if (result.error) {
    console.error('Dotenv Error:', result.error);
}
const SERVER_VERSION = '1.0.0';
const SERVER_BUILD = '2026-03-27-tool-routing';
const SERVER_CAPABILITIES = ['review_code', 'chat_expert', 'get_current_weather', 'search_web', 'get_latest_news'];
const REVIEW_MODE = process.env.MCP_REVIEW_MODE === 'stub' ? 'stub' : 'live';
const TRANSPORT_MODE = process.env.MCP_TRANSPORT === 'sse' ? 'sse' : 'stdio';
const WEB_HOST = process.env.MCP_WEB_HOST?.trim() || '0.0.0.0';
const WEB_PORT = Number(process.env.PORT ?? process.env.MCP_WEB_PORT ?? '3000');
const WEB_CORS_ORIGINS = (process.env.MCP_WEB_CORS_ORIGIN?.trim() || 'http://localhost:5173,http://127.0.0.1:5173')
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
const GEMINI_MODELS = (process.env.GEMINI_MODEL_CANDIDATES?.trim() || process.env.GEMINI_MODEL?.trim() || 'gemini-2.5-flash,gemini-2.0-flash-exp,gemini-1.5-flash')
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
const geminiApiKey = process.env.GEMINI_API_KEY;
const genAI = geminiApiKey ? new GoogleGenerativeAI(geminiApiKey) : null;
const SYSTEM_INSTRUCTION = `
You are a senior C/C++ Embedded Software Engineer specialized in automotive systems, MCU programming, and MISRA-C compliance.

You MUST respond with ONLY a raw JSON object — no markdown fences, no prose, no code blocks, no extra text before or after.

Required output schema (strictly follow this):
{
  "summary": "<one concise sentence describing the overall finding>",
  "risks": [
    { "severity": "Critical", "detail": "<specific risk>" },
    { "severity": "High",     "detail": "<specific risk>" }
  ],
  "advice": [
    "<actionable recommendation 1>",
    "<actionable recommendation 2>"
  ]
}

severity must be one of: Critical, High, Normal.
Do not include any fields not listed above.
`;
const CHAT_SYSTEM_INSTRUCTION = `
You are a senior embedded architect with 10 years of experience in C/C++, RTOS, MCU software, and high-concurrency systems.

Time and context awareness:
- It is currently 2026.
- The user is developing a project from the Far Eastern U-Town office in Xizhi District, Taiwan.

Behavior rules:
- If the user greets you or asks who you are, introduce yourself briefly.
- If the user asks a general embedded/software question, answer directly in plain text.
- If the user asks about hardware problems, proactively analyze race condition, stack overflow, and memory leak risks when relevant.
- If the user appears to want a code review but did not paste code, ask them to paste the relevant C/C++ code.
- If the user asks about weather, news, or web search, you may use the connected tools when available.
- Do not pretend a code review was performed unless actual code was provided.
- For general chat responses, return plain text only.
`;
const REVIEW_TIMEOUT_MS = 90_000;
const REVIEW_MAX_ATTEMPTS = 2;
const RETRY_BASE_DELAY_MS = 1_200;
const RETRY_429_DELAYS_MS = [1_000, 2_000, 4_000];
const OPEN_METEO_GEOCODING_URL = 'https://geocoding-api.open-meteo.com/v1/search';
const OPEN_METEO_FORECAST_URL = 'https://api.open-meteo.com/v1/forecast';
const DUCKDUCKGO_INSTANT_ANSWER_URL = 'https://api.duckduckgo.com/';
const GOOGLE_NEWS_RSS_URL = 'https://news.google.com/rss/search';
const withTimeout = async (promise, timeoutMs) => {
    return await Promise.race([
        promise,
        new Promise((_, reject) => {
            setTimeout(() => reject(new Error(`Operation timed out after ${timeoutMs}ms`)), timeoutMs);
        }),
    ]);
};
const normalizeErrorMessage = (error) => {
    if (error instanceof Error && error.message) {
        return error.message;
    }
    return 'Unknown internal error';
};
const sleep = async (delayMs) => {
    await new Promise((resolve) => {
        setTimeout(resolve, delayMs);
    });
};
class ApiError extends Error {
    code;
    status;
    constructor(code, message, status) {
        super(message);
        this.code = code;
        this.status = status;
    }
}
const isQuotaOrRateLimitError = (error) => {
    const message = normalizeErrorMessage(error).toLowerCase();
    return message.includes('429') || message.includes('quota') || message.includes('rate limit');
};
const isModelNotFoundError = (error) => {
    const message = normalizeErrorMessage(error).toLowerCase();
    return message.includes('404') || message.includes('not found') || message.includes('is not supported for generatecontent');
};
const isApiError = (error) => {
    return error instanceof ApiError;
};
const toHttpErrorResponse = (error, fallbackTool) => {
    if (isApiError(error)) {
        return {
            status: error.status,
            body: {
                error: error.code,
                message: error.message,
            },
        };
    }
    return {
        status: 400,
        body: {
            status: 'error',
            tool: fallbackTool,
            message: normalizeErrorMessage(error),
        },
    };
};
const toSafeReviewPayload = (payload) => {
    if (!payload || typeof payload !== 'object') {
        throw new Error('Invalid arguments: expected an object with a code string.');
    }
    const args = payload;
    if (typeof args.code !== 'string') {
        throw new Error('Invalid arguments: code must be a string.');
    }
    const code = args.code.trim();
    if (code.length === 0) {
        throw new Error('Invalid arguments: code cannot be empty.');
    }
    if (code.length > 100_000) {
        throw new Error('Invalid arguments: code is too large (max 100000 chars).');
    }
    return { code };
};
const extractJsonFromText = (text) => {
    const fenceMatch = /```(?:json)?\s*([\s\S]*?)```/.exec(text);
    if (fenceMatch?.[1]) {
        return fenceMatch[1].trim();
    }
    const braceStart = text.indexOf('{');
    const braceEnd = text.lastIndexOf('}');
    if (braceStart !== -1 && braceEnd > braceStart) {
        return text.slice(braceStart, braceEnd + 1).trim();
    }
    return text;
};
const looksLikeCode = (input) => {
    const normalized = input.trim();
    if (normalized.length === 0) {
        return false;
    }
    const codeSignals = [
        '#include',
        'int main(',
        'void ',
        'volatile ',
        'static ',
        'uint8_t',
        'uint16_t',
        'uint32_t',
        'bool ',
        'for (',
        'while (',
        'if (',
        'switch (',
        'return ',
        'ISR(',
        '::',
        '->',
    ];
    const keywordHits = codeSignals.filter((signal) => normalized.includes(signal)).length;
    const hasBraces = normalized.includes('{') && normalized.includes('}');
    const hasSemicolons = (normalized.match(/;/g) ?? []).length >= 2;
    const lineCount = normalized.split(/\r?\n/).length;
    return keywordHits >= 1 || hasBraces || hasSemicolons || lineCount >= 4;
};
const isWeatherRequest = (input) => {
    const normalized = input.toLowerCase();
    return normalized.includes('weather') || normalized.includes('天氣') || normalized.includes('氣溫') || normalized.includes('下雨');
};
const isNewsRequest = (input) => {
    const normalized = input.toLowerCase();
    return normalized.includes('news') || normalized.includes('新聞') || normalized.includes('headline') || normalized.includes('頭條');
};
const isSearchRequest = (input) => {
    const normalized = input.toLowerCase();
    return normalized.includes('google') || normalized.includes('搜尋') || normalized.includes('search') || normalized.includes('查詢');
};
const inferLocationFromPrompt = (input) => {
    const normalized = input.toLowerCase();
    if (normalized.includes('汐止')) {
        return 'Xizhi';
    }
    if (normalized.includes('utown') || normalized.includes('u-town')) {
        return 'Xizhi';
    }
    return 'Xizhi';
};
const buildWeatherLocationCandidates = (location) => {
    const normalized = location.toLowerCase();
    if (normalized.includes('xizhi') || normalized.includes('汐止') || normalized.includes('u-town') || normalized.includes('utown')) {
        return ['Xizhi', 'Xizhi, Taiwan', 'New Taipei City, Taiwan'];
    }
    return [location, `${location}, Taiwan`];
};
const inferNewsTopicFromPrompt = (input) => {
    const cleaned = input
        .replace(/最新|今天|幫我|查一下|查詢|新聞|news|headline|頭條/gi, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    return cleaned || 'Taiwan technology';
};
const inferSearchQueryFromPrompt = (input) => {
    const cleaned = input
        .replace(/google|search|搜尋|查詢|幫我|請幫我/gi, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    return cleaned || input.trim();
};
const toSafeDirectPromptPayload = (payload) => {
    if (!payload || typeof payload !== 'object') {
        throw new Error('Invalid arguments: expected an object payload.');
    }
    const args = payload;
    const rawContent = typeof args.code === 'string'
        ? args.code
        : typeof args.message === 'string'
            ? args.message
            : null;
    if (rawContent === null) {
        throw new Error('Invalid arguments: expected a code or message string.');
    }
    const content = rawContent.trim();
    if (content.length === 0) {
        throw new Error('Invalid arguments: content cannot be empty.');
    }
    if (content.length > 100_000) {
        throw new Error('Invalid arguments: content is too large (max 100000 chars).');
    }
    const mode = args.mode === 'review_code' || args.mode === 'chat_expert' || args.mode === 'get_current_weather' || args.mode === 'search_web' || args.mode === 'get_latest_news'
        ? args.mode
        : undefined;
    return {
        content,
        ...(mode ? { mode } : {}),
    };
};
const resolvePromptMode = (content, explicitMode) => {
    if (explicitMode) {
        return explicitMode;
    }
    if (isWeatherRequest(content)) {
        return 'get_current_weather';
    }
    if (isNewsRequest(content)) {
        return 'get_latest_news';
    }
    if (isSearchRequest(content)) {
        return 'search_web';
    }
    return looksLikeCode(content) ? 'review_code' : 'chat_expert';
};
const toSafeWeatherPayload = (payload) => {
    if (!payload || typeof payload !== 'object') {
        throw new Error('Invalid arguments: expected an object with a location string.');
    }
    const args = payload;
    if (typeof args.location !== 'string' || args.location.trim().length === 0) {
        throw new Error('Invalid arguments: location must be a non-empty string.');
    }
    return { location: args.location.trim() };
};
const toSafeSearchPayload = (payload) => {
    if (!payload || typeof payload !== 'object') {
        throw new Error('Invalid arguments: expected an object with a query string.');
    }
    const args = payload;
    if (typeof args.query !== 'string' || args.query.trim().length === 0) {
        throw new Error('Invalid arguments: query must be a non-empty string.');
    }
    return { query: args.query.trim() };
};
const weatherCodeToText = (weatherCode) => {
    const mapping = {
        0: '晴朗',
        1: '大致晴朗',
        2: '局部多雲',
        3: '陰天',
        45: '霧',
        48: '結霜霧',
        51: '毛毛雨',
        53: '小雨',
        55: '中雨',
        61: '小陣雨',
        63: '降雨',
        65: '大雨',
        71: '小雪',
        73: '降雪',
        75: '大雪',
        80: '陣雨',
        81: '強陣雨',
        82: '豪雨',
        95: '雷雨',
        96: '雷雨夾冰雹',
        99: '強雷雨夾冰雹',
    };
    return mapping[weatherCode] ?? `未知天氣碼 ${weatherCode}`;
};
const getCurrentWeatherLive = async (location) => {
    const locationCandidates = buildWeatherLocationCandidates(location);
    let place;
    for (const candidate of locationCandidates) {
        const geoUrl = `${OPEN_METEO_GEOCODING_URL}?name=${encodeURIComponent(candidate)}&count=1&language=zh&format=json`;
        const geoResponse = await withTimeout(fetch(geoUrl), 15_000);
        if (!geoResponse.ok) {
            throw new Error(`Weather geocoding failed with status ${geoResponse.status}.`);
        }
        const geoData = (await geoResponse.json());
        const matchedPlace = geoData.results?.[0];
        if (matchedPlace && typeof matchedPlace.latitude === 'number' && typeof matchedPlace.longitude === 'number') {
            place = matchedPlace;
            break;
        }
    }
    if (!place) {
        if (locationCandidates.some((candidate) => candidate.toLowerCase().includes('xizhi'))) {
            place = {
                name: 'Xizhi',
                admin1: 'New Taipei City',
                country: 'Taiwan',
                latitude: 25.068,
                longitude: 121.662,
                timezone: 'Asia/Taipei',
            };
        }
        else {
            throw new Error(`Unable to resolve location for weather lookup: ${location}`);
        }
    }
    const forecastUrl = `${OPEN_METEO_FORECAST_URL}?latitude=${place.latitude}&longitude=${place.longitude}&current=temperature_2m,apparent_temperature,relative_humidity_2m,wind_speed_10m,weather_code,is_day&timezone=auto`;
    const forecastResponse = await withTimeout(fetch(forecastUrl), 15_000);
    if (!forecastResponse.ok) {
        throw new Error(`Weather forecast failed with status ${forecastResponse.status}.`);
    }
    const forecastData = (await forecastResponse.json());
    const current = forecastData.current;
    if (!current) {
        throw new Error('Weather forecast did not include current conditions.');
    }
    const resolvedLocation = [place.name, place.admin1, place.country].filter(Boolean).join(', ');
    const weatherText = weatherCodeToText(current.weather_code ?? -1);
    const dayNight = current.is_day === 1 ? '白天' : '夜間';
    return [
        '工具：get_current_weather',
        `位置：${resolvedLocation}`,
        `狀態：${weatherText} (${dayNight})`,
        `氣溫：${current.temperature_2m ?? 'N/A'}°C`,
        `體感：${current.apparent_temperature ?? 'N/A'}°C`,
        `濕度：${current.relative_humidity_2m ?? 'N/A'}%`,
        `風速：${current.wind_speed_10m ?? 'N/A'} km/h`,
        '資料來源：Open-Meteo（即時公開 API）',
    ].join('\n');
};
const flattenDuckDuckGoTopics = (topics) => {
    if (!topics) {
        return [];
    }
    const flattened = [];
    for (const topic of topics) {
        if (Array.isArray(topic.Topics)) {
            flattened.push(...flattenDuckDuckGoTopics(topic.Topics));
            continue;
        }
        flattened.push(topic);
    }
    return flattened;
};
const searchWebLive = async (query) => {
    const url = `${DUCKDUCKGO_INSTANT_ANSWER_URL}?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`;
    const response = await withTimeout(fetch(url), 15_000);
    if (!response.ok) {
        throw new Error(`Web search failed with status ${response.status}.`);
    }
    const data = (await response.json());
    const related = flattenDuckDuckGoTopics(data.RelatedTopics).filter((item) => item.Text && item.FirstURL).slice(0, 5);
    const lines = ['工具：search_web', `查詢：${query}`];
    if (data.AbstractText) {
        lines.push(`摘要：${data.AbstractText}`);
    }
    if (data.AbstractURL) {
        lines.push(`來源：${data.AbstractURL}`);
    }
    if (related.length > 0) {
        lines.push('相關結果：');
        for (const item of related) {
            lines.push(`- ${item.Text}`);
            lines.push(`  ${item.FirstURL}`);
        }
    }
    if (!data.AbstractText && related.length === 0) {
        lines.push('沒有取得明確摘要，建議改用更具體的搜尋關鍵字。');
    }
    lines.push('資料來源：DuckDuckGo Instant Answer');
    return lines.join('\n');
};
const decodeXmlText = (value) => {
    return value
        .replace(/<!\[CDATA\[|\]\]>/g, '')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .trim();
};
const getLatestNewsLive = async (topic) => {
    const url = `${GOOGLE_NEWS_RSS_URL}?q=${encodeURIComponent(topic)}&hl=zh-TW&gl=TW&ceid=TW:zh-Hant`;
    const response = await withTimeout(fetch(url), 15_000);
    if (!response.ok) {
        throw new Error(`News lookup failed with status ${response.status}.`);
    }
    const xml = await response.text();
    const itemMatches = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].slice(0, 5);
    const lines = ['工具：get_latest_news', `主題：${topic}`];
    for (const [index, match] of itemMatches.entries()) {
        const itemXml = match[1] ?? '';
        const title = decodeXmlText((/<title>([\s\S]*?)<\/title>/.exec(itemXml)?.[1] ?? 'Untitled'));
        const link = decodeXmlText((/<link>([\s\S]*?)<\/link>/.exec(itemXml)?.[1] ?? ''));
        lines.push(`${index + 1}. ${title}`);
        if (link) {
            lines.push(`   ${link}`);
        }
    }
    if (itemMatches.length === 0) {
        lines.push('目前沒有取得新聞結果，請改試更明確的關鍵字。');
    }
    lines.push('資料來源：Google News RSS');
    return lines.join('\n');
};
const runGeminiText = async (prompt, systemInstruction, logPrefix) => {
    if (!genAI) {
        throw new Error('Gemini client is not initialized. Check MCP_REVIEW_MODE and GEMINI_API_KEY.');
    }
    if (GEMINI_MODELS.length === 0) {
        throw new Error('No Gemini model candidates configured.');
    }
    let lastError;
    let quotaExceeded = false;
    for (const modelName of GEMINI_MODELS) {
        const activeModel = genAI.getGenerativeModel({
            model: modelName,
            systemInstruction,
        });
        const maxGeminiAttempts = Math.max(REVIEW_MAX_ATTEMPTS, RETRY_429_DELAYS_MS.length + 1);
        for (let attempt = 1; attempt <= maxGeminiAttempts; attempt += 1) {
            try {
                const result = await withTimeout(activeModel.generateContent(prompt), REVIEW_TIMEOUT_MS);
                const response = await result.response;
                const text = response.text().trim();
                if (!text) {
                    throw new Error('Gemini returned an empty response.');
                }
                return text;
            }
            catch (error) {
                lastError = error;
                if (isModelNotFoundError(error)) {
                    console.error(`[${logPrefix}] model ${modelName} not available, trying next candidate...`);
                    break;
                }
                if (isQuotaOrRateLimitError(error)) {
                    quotaExceeded = true;
                    const retryDelayMs = RETRY_429_DELAYS_MS[attempt - 1];
                    if (retryDelayMs !== undefined) {
                        console.error(`[${logPrefix}] model ${modelName} hit 429/quota on attempt ${attempt}, retrying in ${retryDelayMs}ms...`);
                        await sleep(retryDelayMs);
                        continue;
                    }
                    console.error(`[${logPrefix}] model ${modelName} exhausted 429/quota retries, trying next candidate...`);
                    break;
                }
                if (attempt < REVIEW_MAX_ATTEMPTS) {
                    console.error(`[${logPrefix}] model ${modelName} attempt ${attempt} failed, retrying in ${RETRY_BASE_DELAY_MS}ms...`);
                    await sleep(RETRY_BASE_DELAY_MS);
                }
            }
        }
    }
    if (quotaExceeded) {
        throw new ApiError('QUOTA_EXCEEDED', 'Gemini API 配額已達上限', 429);
    }
    throw lastError instanceof Error ? lastError : new Error(`${logPrefix} failed.`);
};
const runGeminiReview = async (code) => {
    const prompt = `Review the following C/C++ embedded code. Return ONLY a raw JSON object with no markdown — see schema in system instruction.\n\nCode:\n${code}`;
    const text = await runGeminiText(prompt, SYSTEM_INSTRUCTION, 'review_code');
    return extractJsonFromText(text);
};
const runGeminiChat = async (message) => {
    const prompt = `User message:\n${message}`;
    return await runGeminiText(prompt, CHAT_SYSTEM_INSTRUCTION, 'chat_expert');
};
const runStubReview = (_code) => {
    return JSON.stringify({
        summary: 'Stub mode: deterministic embedded offline review.',
        risks: [
            { severity: 'Critical', detail: 'Shared flag updated inside ISR without atomic synchronization.' },
            { severity: 'High', detail: 'No memory barrier between ISR writer and main-loop reader.' },
            { severity: 'Normal', detail: 'Non-fixed-width integer type used — consider uint8_t/uint32_t for portability.' },
        ],
        advice: [
            'Protect shared state with atomic operations or disable-interrupt critical sections.',
            'Keep ISR side-effects minimal; defer processing to a task/main-loop notification model.',
            'Use fixed-width types (<stdint.h>) and document overflow/rollover behavior explicitly.',
        ],
    }, null, 2);
};
const runStubChat = (message) => {
    const normalized = message.toLowerCase();
    if (isNewsRequest(message)) {
        return 'Stub 模式下尚未啟用即時新聞工具。切到 Live 模式後，系統會使用外部新聞來源提供最新結果。';
    }
    if (isSearchRequest(message)) {
        return 'Stub 模式下尚未啟用即時搜尋工具。切到 Live 模式後，系統會使用外部搜尋來源提供結果摘要。';
    }
    if (normalized.includes('你好') || normalized.includes('hello') || normalized.includes('hi')) {
        return '您好，我是資深嵌入式軟體專家。您可以直接貼上 C/C++ 程式碼，我會幫您做 thread-safety 與嵌入式風險分析。';
    }
    if (normalized.includes('你是誰') || normalized.includes('who are you')) {
        return '我是專注於 MCU、ISR、thread-safety 與 MISRA-C 的資深嵌入式審查助手，可以回答一般技術問題，也可以直接審閱您的程式碼。';
    }
    if (normalized.includes('review') || normalized.includes('code') || normalized.includes('thread') || normalized.includes('safety')) {
        return '如果您要我做正式審閱，請直接貼上完整或關鍵的 C/C++ 程式碼片段。我也可以先回答一般嵌入式設計問題。';
    }
    return '我可以處理兩種任務：一般嵌入式技術對話，以及 C/C++ 程式碼審閱。您可以直接提問，或貼上程式碼開始分析。';
};
const runPrompt = async (content, explicitMode) => {
    const tool = resolvePromptMode(content, explicitMode);
    if (tool === 'review_code') {
        if (REVIEW_MODE === 'stub') {
            return { tool, message: runStubReview(content) };
        }
        if (!genAI) {
            return {
                tool: 'chat_expert',
                message: '目前後端已進入 Live 模式，但尚未設定 GEMINI_API_KEY，因此只能使用天氣、新聞與網頁搜尋工具；一般對話與程式碼審閱暫時不可用。',
            };
        }
        const message = await runGeminiReview(content);
        return { tool, message };
    }
    if (tool === 'get_current_weather') {
        const location = inferLocationFromPrompt(content);
        const message = REVIEW_MODE === 'stub'
            ? [
                '工具：get_current_weather (mock)',
                `位置：${location}`,
                '狀態：多雲，局部短暫雨',
                '氣溫：26°C',
                '體感：29°C',
                '說明：目前為 stub 模式，因此使用模擬天氣資料。',
            ].join('\n')
            : await getCurrentWeatherLive(location);
        return { tool, message };
    }
    if (tool === 'get_latest_news') {
        const topic = inferNewsTopicFromPrompt(content);
        const message = REVIEW_MODE === 'stub'
            ? runStubChat(content)
            : await getLatestNewsLive(topic);
        return { tool: REVIEW_MODE === 'stub' ? 'chat_expert' : 'get_latest_news', message };
    }
    if (tool === 'search_web') {
        const query = inferSearchQueryFromPrompt(content);
        const message = REVIEW_MODE === 'stub'
            ? runStubChat(content)
            : await searchWebLive(query);
        return { tool: REVIEW_MODE === 'stub' ? 'chat_expert' : 'search_web', message };
    }
    if (REVIEW_MODE !== 'stub' && !genAI) {
        return {
            tool: 'chat_expert',
            message: '目前後端已進入 Live 模式，但尚未設定 GEMINI_API_KEY，因此一般對話不可用；您仍可使用查天氣、查新聞、網頁搜尋。',
        };
    }
    const message = REVIEW_MODE === 'stub'
        ? runStubChat(content)
        : await runGeminiChat(content);
    return { tool, message };
};
const createProtocolServer = () => {
    const server = new Server({
        name: 'copilot-mcp-server',
        version: SERVER_VERSION,
    }, {
        capabilities: {
            tools: {},
        },
    });
    server.setRequestHandler(ListToolsRequestSchema, async () => {
        return {
            tools: [
                {
                    name: 'review_code',
                    description: 'Review embedded C/C++ source code and return Gemini analysis.',
                    inputSchema: {
                        type: 'object',
                        properties: {
                            code: {
                                type: 'string',
                                description: 'The C/C++ code to review.',
                            },
                        },
                        required: ['code'],
                        additionalProperties: false,
                    },
                },
                {
                    name: 'chat_expert',
                    description: 'Answer general embedded software questions in plain text.',
                    inputSchema: {
                        type: 'object',
                        properties: {
                            message: {
                                type: 'string',
                                description: 'The user message or general question.',
                            },
                        },
                        required: ['message'],
                        additionalProperties: false,
                    },
                },
                {
                    name: 'get_current_weather',
                    description: 'Mock weather lookup tool for demonstrating function calling with location input.',
                    inputSchema: {
                        type: 'object',
                        properties: {
                            location: {
                                type: 'string',
                                description: 'A geographic location such as Xizhi District, Taiwan.',
                            },
                        },
                        required: ['location'],
                        additionalProperties: false,
                    },
                },
                {
                    name: 'search_web',
                    description: 'Search the web for a user query and return summary results.',
                    inputSchema: {
                        type: 'object',
                        properties: {
                            query: {
                                type: 'string',
                                description: 'The web search query.',
                            },
                        },
                        required: ['query'],
                        additionalProperties: false,
                    },
                },
                {
                    name: 'get_latest_news',
                    description: 'Fetch recent news headlines for a given topic.',
                    inputSchema: {
                        type: 'object',
                        properties: {
                            query: {
                                type: 'string',
                                description: 'The topic to search for in latest news.',
                            },
                        },
                        required: ['query'],
                        additionalProperties: false,
                    },
                },
            ],
        };
    });
    server.setRequestHandler(CallToolRequestSchema, async (request) => {
        const toolName = request.params.name;
        if (toolName !== 'review_code' && toolName !== 'chat_expert' && toolName !== 'get_current_weather' && toolName !== 'search_web' && toolName !== 'get_latest_news') {
            return {
                isError: true,
                content: [
                    {
                        type: 'text',
                        text: JSON.stringify({
                            status: 'error',
                            tool: toolName,
                            message: `Unsupported tool: ${toolName}`,
                        }, null, 2),
                    },
                ],
            };
        }
        try {
            const tool = toolName;
            const payload = tool === 'review_code'
                ? { content: toSafeReviewPayload(request.params.arguments).code, mode: tool }
                : tool === 'get_current_weather'
                    ? { content: toSafeWeatherPayload(request.params.arguments).location, mode: tool }
                    : tool === 'search_web' || tool === 'get_latest_news'
                        ? { content: toSafeSearchPayload(request.params.arguments).query, mode: tool }
                        : { content: toSafeDirectPromptPayload(request.params.arguments).content, mode: tool };
            const responsePayload = await runPrompt(payload.content, payload.mode);
            return {
                content: [
                    {
                        type: 'text',
                        text: JSON.stringify({
                            status: 'success',
                            tool: responsePayload.tool,
                            message: responsePayload.message,
                        }, null, 2),
                    },
                ],
            };
        }
        catch (error) {
            const message = normalizeErrorMessage(error);
            console.error(`[${toolName}] failed:`, message);
            return {
                isError: true,
                content: [
                    {
                        type: 'text',
                        text: JSON.stringify({
                            status: 'error',
                            tool: toolName,
                            message,
                        }, null, 2),
                    },
                ],
            };
        }
    });
    return server;
};
const runStdioServer = async () => {
    const server = createProtocolServer();
    const transport = new StdioServerTransport();
    await server.connect(transport);
    const modeLabel = REVIEW_MODE === 'stub' ? 'stub' : `live (${GEMINI_MODELS.join(', ')})`;
    console.error(`MCP server is running over stdio. review_mode=${modeLabel}`);
};
const runSseServer = async () => {
    const app = express();
    const sessions = new Map();
    app.use(cors({
        origin: WEB_CORS_ORIGINS,
        methods: ['GET', 'POST', 'OPTIONS'],
        allowedHeaders: ['Content-Type'],
    }));
    app.use(express.json({ limit: '2mb' }));
    app.get('/health', (_req, res) => {
        res.status(200).json({
            status: 'ok',
            service: 'copilot-mcp-server',
            version: SERVER_VERSION,
            build: SERVER_BUILD,
            mode: REVIEW_MODE,
            transport: TRANSPORT_MODE,
            capabilities: SERVER_CAPABILITIES,
            models: REVIEW_MODE === 'live' ? GEMINI_MODELS : [],
        });
    });
    app.post('/api/review', async (req, res) => {
        try {
            const { code } = toSafeReviewPayload(req.body);
            const review = await runPrompt(code, 'review_code');
            res.status(200).json({
                status: 'success',
                tool: review.tool,
                message: review.message,
            });
        }
        catch (error) {
            console.error('[api/review] failed:', normalizeErrorMessage(error));
            const mapped = toHttpErrorResponse(error, 'review_code');
            res.status(mapped.status).json(mapped.body);
        }
    });
    app.get('/mcp', async (_req, res) => {
        try {
            if (!res.headersSent) {
                res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
                res.setHeader('Cache-Control', 'no-cache, no-transform');
            }
            const transport = new SSEServerTransport('/message', res);
            const server = createProtocolServer();
            const sessionId = transport.sessionId;
            sessions.set(sessionId, { transport, server });
            transport.onclose = () => {
                sessions.delete(sessionId);
                console.error(`SSE session closed: ${sessionId}`);
            };
            transport.onerror = (error) => {
                console.error(`SSE transport error for ${sessionId}:`, error);
            };
            await server.connect(transport);
            console.error(`SSE stream established. sessionId=${sessionId}`);
        }
        catch (error) {
            console.error('Error establishing SSE stream:', error);
            if (!res.headersSent) {
                res.status(500).send('Error establishing SSE stream');
            }
        }
    });
    app.post('/message', async (req, res) => {
        const sessionId = typeof req.query.sessionId === 'string' ? req.query.sessionId : '';
        if (!sessionId) {
            try {
                const payload = toSafeDirectPromptPayload(req.body);
                const responsePayload = await runPrompt(payload.content, payload.mode);
                res.status(200).json({
                    status: 'success',
                    tool: responsePayload.tool,
                    message: responsePayload.message,
                });
            }
            catch (error) {
                console.error('[message] direct prompt failed:', normalizeErrorMessage(error));
                const mapped = toHttpErrorResponse(error, 'chat_expert');
                res.status(mapped.status).json(mapped.body);
            }
            return;
        }
        const entry = sessions.get(sessionId);
        if (!entry) {
            res.status(404).send('Session not found');
            return;
        }
        try {
            await entry.transport.handlePostMessage(req, res, req.body);
        }
        catch (error) {
            console.error(`Error handling /message for ${sessionId}:`, error);
            if (!res.headersSent) {
                res.status(500).send('Error handling request');
            }
        }
    });
    const modeLabel = REVIEW_MODE === 'stub' ? 'stub' : `live (${GEMINI_MODELS.join(', ')})`;
    app.listen(WEB_PORT, WEB_HOST, () => {
        console.error(`MCP web server is running. host=${WEB_HOST} port=${WEB_PORT} transport=sse review_mode=${modeLabel}`);
    });
};
const main = async () => {
    if (TRANSPORT_MODE === 'sse') {
        await runSseServer();
        return;
    }
    await runStdioServer();
};
process.on('unhandledRejection', (reason) => {
    console.error('Unhandled rejection:', reason);
});
process.on('uncaughtException', (error) => {
    console.error('Uncaught exception:', error);
    process.exitCode = 1;
});
main().catch((error) => {
    console.error('Failed to start MCP server:', error);
    process.exitCode = 1;
});
