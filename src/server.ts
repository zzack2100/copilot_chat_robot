import process from 'node:process';
import dotenv from 'dotenv';
import cors from 'cors';
import express from 'express';
import type { Request, Response } from 'express';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
    CallToolRequestSchema,
    ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

const result = dotenv.config({ quiet: true });

if (result.error) {
    console.error('Dotenv Error:', result.error);
}

type ReviewMode = 'live' | 'stub';
type TransportMode = 'stdio' | 'sse';

const REVIEW_MODE: ReviewMode = process.env.MCP_REVIEW_MODE === 'stub' ? 'stub' : 'live';
const TRANSPORT_MODE: TransportMode = process.env.MCP_TRANSPORT === 'sse' ? 'sse' : 'stdio';
const WEB_HOST = process.env.MCP_WEB_HOST?.trim() || '127.0.0.1';
const WEB_PORT = Number(process.env.MCP_WEB_PORT ?? '3000');
const WEB_CORS_ORIGINS = (process.env.MCP_WEB_CORS_ORIGIN?.trim() || 'http://localhost:5173,http://127.0.0.1:5173')
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0);

const GEMINI_MODELS = (process.env.GEMINI_MODEL_CANDIDATES?.trim() || process.env.GEMINI_MODEL?.trim() || 'gemini-2.5-flash,gemini-2.0-flash-exp,gemini-1.5-flash')
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0);

const geminiApiKey = process.env.GEMINI_API_KEY;

if (REVIEW_MODE === 'live' && !geminiApiKey) {
    throw new Error('Missing GEMINI_API_KEY in environment variables (required for MCP_REVIEW_MODE=live).');
}

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

const REVIEW_TIMEOUT_MS = 90_000;
const REVIEW_MAX_ATTEMPTS = 2;
const RETRY_BASE_DELAY_MS = 1_200;
const RETRY_429_DELAY_MS = 5_000;

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

const sleep = async (delayMs: number): Promise<void> => {
    await new Promise<void>((resolve) => {
        setTimeout(resolve, delayMs);
    });
};

const isQuotaOrRateLimitError = (error: unknown): boolean => {
    const message = normalizeErrorMessage(error).toLowerCase();
    return message.includes('429') || message.includes('quota') || message.includes('rate limit');
};

const isModelNotFoundError = (error: unknown): boolean => {
    const message = normalizeErrorMessage(error).toLowerCase();
    return message.includes('404') || message.includes('not found') || message.includes('is not supported for generatecontent');
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

const extractJsonFromText = (text: string): string => {
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

const runGeminiReview = async (code: string): Promise<string> => {
    if (!genAI) {
        throw new Error('Gemini client is not initialized. Check MCP_REVIEW_MODE and GEMINI_API_KEY.');
    }

    if (GEMINI_MODELS.length === 0) {
        throw new Error('No Gemini model candidates configured.');
    }

    const prompt = `Review the following C/C++ embedded code. Return ONLY a raw JSON object with no markdown — see schema in system instruction.\n\nCode:\n${code}`;

    let lastError: unknown;

    for (const modelName of GEMINI_MODELS) {
        const activeModel = genAI.getGenerativeModel({
            model: modelName,
            systemInstruction: SYSTEM_INSTRUCTION,
        });

        for (let attempt = 1; attempt <= REVIEW_MAX_ATTEMPTS; attempt += 1) {
            try {
                const result = await withTimeout(activeModel.generateContent(prompt), REVIEW_TIMEOUT_MS);
                const response = await result.response;
                const text = extractJsonFromText(response.text().trim());

                if (!text) {
                    throw new Error('Gemini returned an empty response.');
                }

                return text;
            } catch (error) {
                lastError = error;

                if (isModelNotFoundError(error)) {
                    console.error(`[review_code] model ${modelName} not available, trying next candidate...`);
                    break;
                }

                if (isQuotaOrRateLimitError(error)) {
                    console.error(`[review_code] model ${modelName} quota/rate limit hit, switching to next candidate...`);
                    break;
                }

                if (attempt < REVIEW_MAX_ATTEMPTS) {
                    console.error(`[review_code] model ${modelName} attempt ${attempt} failed, retrying in ${RETRY_BASE_DELAY_MS}ms...`);
                    await sleep(RETRY_BASE_DELAY_MS);
                }
            }
        }
    }

    throw lastError instanceof Error ? lastError : new Error('Gemini review failed.');
};

const runStubReview = (_code: string): string => {
    return JSON.stringify(
        {
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
        },
        null,
        2
    );
};

const createProtocolServer = (): Server => {
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
                                tool: toolName,
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
            const review = REVIEW_MODE === 'stub'
                ? runStubReview(code)
                : await runGeminiReview(code);

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

    return server;
};

const runStdioServer = async (): Promise<void> => {
    const server = createProtocolServer();
    const transport = new StdioServerTransport();
    await server.connect(transport);

    const modeLabel = REVIEW_MODE === 'stub' ? 'stub' : `live (${GEMINI_MODELS.join(', ')})`;
    console.error(`MCP server is running over stdio. review_mode=${modeLabel}`);
};

const runSseServer = async (): Promise<void> => {
    const app = express();
    const sessions = new Map<string, { transport: SSEServerTransport; server: Server }>();

    app.use(cors({
        origin: WEB_CORS_ORIGINS,
        methods: ['GET', 'POST', 'OPTIONS'],
        allowedHeaders: ['Content-Type'],
    }));
    app.use(express.json({ limit: '2mb' }));

    app.post('/api/review', async (req: Request, res: Response) => {
        try {
            const { code } = toSafeReviewPayload(req.body as unknown);
            const review = REVIEW_MODE === 'stub'
                ? runStubReview(code)
                : await runGeminiReview(code);

            res.status(200).json({
                status: 'success',
                tool: 'review_code',
                message: review,
            });
        } catch (error) {
            const message = normalizeErrorMessage(error);
            console.error('[api/review] failed:', message);
            res.status(400).json({
                status: 'error',
                tool: 'review_code',
                message,
            });
        }
    });

    app.get('/mcp', async (_req: Request, res: Response) => {
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
        } catch (error) {
            console.error('Error establishing SSE stream:', error);
            if (!res.headersSent) {
                res.status(500).send('Error establishing SSE stream');
            }
        }
    });

    app.post('/message', async (req: Request, res: Response) => {
        const sessionId = typeof req.query.sessionId === 'string' ? req.query.sessionId : '';

        if (!sessionId) {
            try {
                const { code } = toSafeReviewPayload(req.body as unknown);
                const review = REVIEW_MODE === 'stub'
                    ? runStubReview(code)
                    : await runGeminiReview(code);

                res.status(200).json({
                    status: 'success',
                    tool: 'review_code',
                    message: review,
                });
            } catch (error) {
                const message = normalizeErrorMessage(error);
                console.error('[message] direct review failed:', message);
                res.status(400).json({
                    status: 'error',
                    tool: 'review_code',
                    message,
                });
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
        } catch (error) {
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

const main = async (): Promise<void> => {
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
