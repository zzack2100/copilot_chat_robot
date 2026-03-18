import process from 'node:process';
import dotenv from 'dotenv';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

dotenv.config();

const buildStringEnv = (): Record<string, string> => {
    const env: Record<string, string> = {};

    for (const [key, value] of Object.entries(process.env)) {
        if (typeof value === 'string') {
            env[key] = value;
        }
    }

    return env;
};

const isTextContent = (value: unknown): value is { type: 'text'; text: string } => {
    if (!value || typeof value !== 'object') {
        return false;
    }

    const item = value as { type?: unknown; text?: unknown };
    return item.type === 'text' && typeof item.text === 'string';
};

const main = async (): Promise<void> => {
    const client = new Client(
        {
            name: 'copilot-mcp-smoke-test',
            version: '1.0.0',
        },
        {
            capabilities: {},
        }
    );

    const transport = new StdioClientTransport({
        command: 'npx',
        args: ['ts-node', 'src/server.ts'],
        cwd: process.cwd(),
        env: buildStringEnv(),
        stderr: 'inherit',
    });

    try {
        await client.connect(transport);

        const listed = await client.listTools();
        const toolNames = listed.tools.map((tool) => tool.name);

        if (!toolNames.includes('review_code')) {
            throw new Error(`Tool review_code not found. Available tools: ${toolNames.join(', ')}`);
        }

        const callResult = await client.callTool({
            name: 'review_code',
            arguments: {
                code: 'volatile int flag = 0; void ISR(void){ flag = 1; }',
            },
        });

        if (callResult.isError) {
            throw new Error(`review_code returned isError=true: ${JSON.stringify(callResult)}`);
        }

        const unknownContent = (callResult as { content?: unknown }).content;
        if (!Array.isArray(unknownContent)) {
            throw new Error('review_code returned unexpected content shape.');
        }

        const textContent = unknownContent.find(isTextContent);

        if (!textContent || textContent.text.trim().length === 0) {
            throw new Error('review_code returned empty text content.');
        }

        console.log('MCP smoke test passed.');
        console.log(`Tools: ${toolNames.join(', ')}`);
        console.log(`review_code output preview: ${textContent.text.slice(0, 300)}`);
    } finally {
        await client.close();
        await transport.close();
    }
};

main().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`MCP smoke test failed: ${message}`);
    process.exitCode = 1;
});
