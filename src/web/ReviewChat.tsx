import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import avatarImage from './assets/avatar.jpg';
import { useMCP } from './hooks/useMCP.js';

type ChatMessage = {
    id: string;
    role: 'user' | 'assistant';
    content: string;
};

type ParsedRisk = {
    severity?: string;
    detail?: string;
};

type ParsedMessage = {
    summary?: string;
    risks?: ParsedRisk[];
    advice?: string[];
};

type ReviewChatProps = {
    mode?: 'stub' | 'sse';
};

export default function ReviewChat({ mode = 'stub' }: ReviewChatProps) {
    const [messages, setMessages] = useState<ChatMessage[]>([]);
    const [inputCode, setInputCode] = useState('');
    const messagesEndRef = useRef<HTMLDivElement>(null);
    const processedResultRef = useRef<string | null>(null);
    const { result, reviewing, statusText, submitPrompt, connectSse } = useMCP({ mode });

    const scrollToBottom = () => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    };

    useEffect(() => {
        scrollToBottom();
    }, [messages]);

    const handleReviewSubmit = async (event: FormEvent) => {
        event.preventDefault();
        const trimmed = inputCode.trim();
        if (!trimmed) {
            return;
        }

        const userMessageId = Date.now().toString();
        setMessages((prev) => [...prev, { id: userMessageId, role: 'user', content: trimmed }]);
        setInputCode('');

        await submitPrompt(trimmed);
    };

    useEffect(() => {
        if (result && !reviewing) {
            const resultKey = `${result.tool}:${result.message}`;
            if (processedResultRef.current === resultKey) {
                return;
            }
            processedResultRef.current = resultKey;

            if (result.tool === 'chat_expert') {
                const replyId = Date.now().toString() + '_chat';
                setMessages((prev) => [...prev, { id: replyId, role: 'assistant', content: result.message }]);
                return;
            }

            const parsedMsg = parseMessage(result.message);
            const summary = parsedMsg?.summary || result.message;

            const assistantGreeting = `已為您完成代碼診斷。${summary}`;
            const greetingId = Date.now().toString() + '_greeting';

            if (parsedMsg?.risks && parsedMsg.risks.length > 0) {
                const risksText = parsedMsg.risks
                    .map((r) => `【${r.severity}】${r.detail}`)
                    .join('\n');
                const risksId = Date.now().toString() + '_risks';

                setMessages((prev) => [
                    ...prev,
                    { id: greetingId, role: 'assistant', content: assistantGreeting },
                    { id: risksId, role: 'assistant', content: `🔍 風險分析\n\n${risksText}` },
                ]);
            } else {
                setMessages((prev) => [...prev, { id: greetingId, role: 'assistant', content: assistantGreeting }]);
            }

            if (parsedMsg?.advice && parsedMsg.advice.length > 0) {
                const adviceText = parsedMsg.advice.map((a) => `• ${a}`).join('\n');
                const adviceId = Date.now().toString() + '_advice';
                setMessages((prev) => [...prev, { id: adviceId, role: 'assistant', content: `💡 專家建議\n\n${adviceText}` }]);
            }
        }
    }, [result, reviewing]);

    return (
        <main className='grid-overlay flex h-screen flex-col bg-slate-950'>
            <header className='border-b border-edge bg-slate-900/50 px-4 py-3 md:px-6'>
                <div className='mx-auto flex w-full max-w-4xl items-center justify-between'>
                    <div>
                        <p className='text-xs tracking-[0.26em] text-slate-400'>MCP 代碼審查助手</p>
                        <h1 className='mt-1 text-lg font-semibold text-slate-100'>Thread-Safety Review Bot</h1>
                    </div>
                    <div className='flex items-center gap-2 text-xs text-slate-400'>
                        <span className='rounded border border-edge bg-black/30 px-2 py-1'>
                            Mode: {mode === 'sse' ? 'LIVE' : 'STUB'}
                        </span>
                        <span className='rounded border border-edge bg-black/30 px-2 py-1'>{statusText}</span>
                        {mode === 'sse' && (
                            <button
                                type='button'
                                onClick={connectSse}
                                className='rounded border border-sky-500/50 bg-sky-500/10 px-2 py-1 text-sky-200 transition hover:bg-sky-500/20'
                            >
                                SSE
                            </button>
                        )}
                    </div>
                </div>
            </header>

            <div className='flex-1 overflow-y-auto px-4 py-6 md:px-6'>
                <div className='mx-auto max-w-2xl space-y-4'>
                    {messages.length === 0 ? (
                        <div className='rounded-lg border border-dashed border-edge bg-black/25 p-6 text-center text-sm text-slate-400'>
                            <p className='mb-2 text-slate-300'>歡迎來到 Thread-Safety 專家助手</p>
                            <p>您可以直接提問，也可以貼上 C/C++ 程式碼進行審閱。</p>
                        </div>
                    ) : (
                        messages.map((msg) => (
                            <div
                                key={msg.id}
                                className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
                            >
                                {msg.role === 'assistant' ? (
                                    <div className='flex items-start gap-3'>
                                        <img
                                            src={avatarImage}
                                            alt='Senior embedded expert avatar'
                                            className='h-10 w-10 rounded-full border-2 border-blue-900 object-cover shadow-[0_0_18px_rgba(30,64,175,0.35)] ring-1 ring-slate-700/80'
                                        />
                                        <div className='max-w-xs rounded-lg border border-edge bg-slate-800 px-4 py-3 text-sm leading-relaxed text-slate-100 md:max-w-md lg:max-w-lg'>
                                            <p className='mb-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400'>Senior Embedded Expert</p>
                                            <p className='whitespace-pre-wrap text-xs md:text-sm'>{msg.content}</p>
                                        </div>
                                    </div>
                                ) : (
                                    <div className='max-w-xs rounded-lg bg-blue-600 px-4 py-3 text-sm leading-relaxed text-white md:max-w-md lg:max-w-lg'>
                                        <p className='whitespace-pre-wrap text-xs md:text-sm'>{msg.content}</p>
                                    </div>
                                )}
                            </div>
                        ))
                    )}
                    {reviewing && (
                        <div className='flex justify-start'>
                            <div className='flex items-start gap-3'>
                                <img
                                    src={avatarImage}
                                    alt='Senior embedded expert avatar'
                                    className='h-10 w-10 rounded-full border-2 border-blue-900 object-cover shadow-[0_0_18px_rgba(30,64,175,0.35)] ring-1 ring-slate-700/80'
                                />
                                <div className='rounded-lg border border-edge bg-slate-800 px-4 py-3'>
                                    <p className='mb-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400'>Senior Embedded Expert</p>
                                    <div className='flex items-center gap-2'>
                                        <div className='h-2 w-2 animate-pulse rounded-full bg-slate-400'></div>
                                        <span className='text-xs text-slate-400'>助手正在分析中...</span>
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}
                    <div ref={messagesEndRef} />
                </div>
            </div>

            <div className='border-t border-edge bg-slate-900/50 px-4 py-4 md:px-6'>
                <div className='mx-auto max-w-2xl'>
                    <form onSubmit={handleReviewSubmit} className='grid gap-3'>
                        <textarea
                            className='min-h-[96px] w-full resize-none rounded-lg border border-edge bg-black/35 p-3 text-sm text-slate-100 outline-none transition focus:border-slate-400'
                            placeholder='輸入問題，或貼上 C/C++ 程式碼...'
                            value={inputCode}
                            onChange={(e) => setInputCode(e.target.value)}
                            spellCheck={false}
                        />
                        <div className='flex items-center justify-between gap-3'>
                            <p className='text-xs text-slate-500'>一般對話會直接回覆；看起來像程式碼的內容會自動進入審閱模式。</p>
                            <button
                                type='submit'
                                disabled={reviewing || !inputCode.trim()}
                                className='rounded-lg border border-slate-500 bg-slate-200 px-4 py-2 text-sm font-semibold text-slate-900 transition hover:bg-white disabled:cursor-not-allowed disabled:opacity-60'
                            >
                                {reviewing ? '處理中...' : '送出'}
                            </button>
                        </div>
                    </form>
                </div>
            </div>
        </main>
    );
}

function stripJsonFences(raw: string): string {
    const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(raw);
    if (fenced?.[1]) {
        return fenced[1].trim();
    }

    const braceStart = raw.indexOf('{');
    const braceEnd = raw.lastIndexOf('}');
    if (braceStart !== -1 && braceEnd > braceStart) {
        return raw.slice(braceStart, braceEnd + 1).trim();
    }

    return raw;
}

function parseMessage(message: string | undefined): ParsedMessage | null {
    if (!message) {
        return null;
    }

    try {
        const cleaned = stripJsonFences(message);
        const parsed = JSON.parse(cleaned) as Record<string, unknown>;

        if (!parsed || typeof parsed !== 'object') {
            return null;
        }

        const risks: ParsedRisk[] = Array.isArray(parsed['risks'])
            ? (parsed['risks'] as ParsedRisk[])
            : Array.isArray(parsed['findings'])
                ? (parsed['findings'] as string[]).map((detail) => ({ severity: 'Normal', detail }))
                : [];

        const advice: string[] = Array.isArray(parsed['advice'])
            ? (parsed['advice'] as string[])
            : [];

        return {
              ...(typeof parsed['summary'] === 'string' ? { summary: parsed['summary'] as string } : null),
            risks,
            advice,
        };
    } catch {
        return null;
    }
}
