import process from 'node:process';
import dotenv from 'dotenv';
dotenv.config();

import { GoogleGenerativeAI } from '@google/generative-ai';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
    CallToolRequestSchema,
    ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

// 初始化 Gemini (Initialize Gemini - SDD 7.4.3)
const geminiApiKey = process.env.GEMINI_API_KEY;

if (!geminiApiKey) {
    throw new Error('Missing GEMINI_API_KEY in environment variables.');
}

const genAI = new GoogleGenerativeAI(geminiApiKey);

const model = genAI.getGenerativeModel({ 
    model: "gemini-2.5-flash",
    systemInstruction: `
        你是一名資深的 C/C++ 嵌入式軟體工程師，專精於車用系統、MCU 程式設計與低階架構。
        你的任務是協助開發者審核代碼、優化記憶體使用、並確保符合 MISRA-C 等業界規範。
        
        You are a senior C/C++ Embedded Software Engineer, specialized in automotive systems, MCU programming, and low-level architecture. 
        Your task is to assist developers in code review, optimizing memory usage, and ensuring compliance with industry standards like MISRA-C.
        
        回應要求 (Response Requirements):
        1. 保持精簡且具備技術深度 (Stay concise and technically deep).
        2. 針對嵌入式限制（如 volatile、中斷處理、暫存器操作）給出具體建議 (Provide specific advice on embedded constraints).
        3. 輸出格式必須符合 SDD 9.1 定義的 JSON 結構 (Output must follow the JSON structure defined in SDD 9.1).
    `,
});

const server = new Server(
    {
        name: 'copilot-mcp-server',
        version: '1.0.0',
    },
    {
        capabilities: {
            tools: {},
        },
    }
);

const REVIEW_TIMEOUT_MS = 90_000;
const REVIEW_MAX_ATTEMPTS = 2;

const withTimeout = async <T>(promise: Promise<T>, timeoutMs: number): Promise<T> => {
    return await Promise.race([
        promise,
        new Promise<T>((_, reject) => {
            setTimeout(() => reject(new Error(`Operation timed out after ${timeoutMs}ms`)), timeoutMs);
        }),
    ]);
};

const normalizeErrorMessage = (error: unknown): string => {
    if (error instanceof Error && error.message) {
        return error.message;
    }
    return 'Unknown internal error';
};

const toSafeReviewPayload = (payload: unknown): { code: string } => {
    if (!payload || typeof payload !== 'object') {
        throw new Error('Invalid arguments: expected an object with a code string.');
    }

    const args = payload as { code?: unknown };

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

const runGeminiReview = async (code: string): Promise<string> => {
    const prompt = `Please review the following C/C++ embedded code and return your result in JSON format per SDD 9.1 requirements.\n\nCode:\n${code}`;

    let lastError: unknown;

    for (let attempt = 1; attempt <= REVIEW_MAX_ATTEMPTS; attempt += 1) {
        try {
            const result = await withTimeout(model.generateContent(prompt), REVIEW_TIMEOUT_MS);
            const response = await result.response;
            const text = response.text().trim();

            if (!text) {
                throw new Error('Gemini returned an empty response.');
            }

            return text;
        } catch (error) {
            lastError = error;
            if (attempt < REVIEW_MAX_ATTEMPTS) {
                console.error(`[review_code] attempt ${attempt} failed, retrying...`);
            }
        }
    }

    throw lastError instanceof Error ? lastError : new Error('Gemini review failed.');
};

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
        ],
    };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const toolName = request.params.name;

    if (toolName !== 'review_code') {
        return {
            isError: true,
            content: [
                {
                    type: 'text',
                    text: JSON.stringify(
                        {
                            status: 'error',
                            message: `Unsupported tool: ${toolName}`,
                        },
                        null,
                        2
                    ),
                },
            ],
        };
    }

    try {
        const { code } = toSafeReviewPayload(request.params.arguments);
        const review = await runGeminiReview(code);

        return {
            content: [
                {
                    type: 'text',
                    text: JSON.stringify(
                        {
                            status: 'success',
                            tool: 'review_code',
                            message: review,
                        },
                        null,
                        2
                    ),
                },
            ],
        };
    } catch (error) {
        const message = normalizeErrorMessage(error);
        console.error('[review_code] failed:', message);
        return {
            isError: true,
            content: [
                {
                    type: 'text',
                    text: JSON.stringify(
                        {
                            status: 'error',
                            tool: 'review_code',
                            message,
                        },
                        null,
                        2
                    ),
                },
            ],
        };
    }
});

const main = async (): Promise<void> => {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error('MCP server is running over stdio.');
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