import { useEffect, useRef, useState } from 'react';
import type { FormEvent, KeyboardEvent } from 'react';
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
    initialMode?: 'stub' | 'sse';
    initialBackendOrigin?: string;
};

const CHAT_STORAGE_KEY = 'copilot-chat-history-v1';
const QUICK_ACTIONS = [
    { label: '查天氣', prompt: '幫我查汐止現在天氣' },
    { label: '查新聞', prompt: 'latest Taiwan technology news' },
    { label: '網頁搜尋', prompt: 'search RTOS priority inversion mitigation' },
] as const;

export default function ReviewChat({ initialMode = 'stub', initialBackendOrigin = '' }: ReviewChatProps) {
    const [mode, setMode] = useState<'stub' | 'sse'>(() => {
        const savedMode = window.localStorage.getItem('copilot-review-mode');
        return savedMode === 'sse' || savedMode === 'stub' ? savedMode : initialMode;
    });
    const [backendOriginInput, setBackendOriginInput] = useState(() => {
        return window.localStorage.getItem('copilot-backend-origin') ?? initialBackendOrigin;
    });
    const [settingsOpen, setSettingsOpen] = useState(false);
    const [messages, setMessages] = useState<ChatMessage[]>(() => loadMessagesFromStorage());
    const [historyStatus, setHistoryStatus] = useState<string>(() => getInitialHistoryStatus(window.localStorage.getItem(CHAT_STORAGE_KEY)));
    const [inputCode, setInputCode] = useState('');
    const messagesEndRef = useRef<HTMLDivElement>(null);
    const processedResultRef = useRef<string | null>(null);
    const { result, reviewing, statusText, backendInfo, submitPrompt, connectSse } = useMCP({ mode, backendOrigin: backendOriginInput });

    useEffect(() => {
        window.localStorage.setItem('copilot-review-mode', mode);
    }, [mode]);

    useEffect(() => {
        window.localStorage.setItem('copilot-backend-origin', backendOriginInput);
    }, [backendOriginInput]);

    useEffect(() => {
        try {
            if (messages.length === 0) {
                window.localStorage.removeItem(CHAT_STORAGE_KEY);
                setHistoryStatus('尚未建立');
                return;
            }

            window.localStorage.setItem(CHAT_STORAGE_KEY, JSON.stringify(messages));
            setHistoryStatus(`已儲存 ${messages.length} 筆 (${formatClockTime(new Date())})`);
        } catch {
            setHistoryStatus('儲存失敗：瀏覽器儲存空間不可用');
        }
    }, [messages]);

    const scrollToBottom = () => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    };

    useEffect(() => {
        scrollToBottom();
    }, [messages]);

    const submitCurrentInput = async (): Promise<void> => {
        const trimmed = inputCode.trim();
        if (!trimmed || reviewing) {
            return;
        }

        const userMessageId = Date.now().toString();
        setMessages((prev) => [...prev, { id: userMessageId, role: 'user', content: trimmed }]);
        setInputCode('');

        await submitPrompt(trimmed);
    };

    const runQuickAction = async (prompt: string): Promise<void> => {
        if (reviewing) {
            return;
        }

        const userMessageId = Date.now().toString();
        setMessages((prev) => [...prev, { id: userMessageId, role: 'user', content: prompt }]);
        setInputCode('');
        await submitPrompt(prompt);
    };

    const handleReviewSubmit = async (event: FormEvent) => {
        event.preventDefault();
        await submitCurrentInput();
    };

    const handleInputKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
        if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();
            void submitCurrentInput();
        }
    };

    useEffect(() => {
        if (result && !reviewing) {
            const resultKey = `${result.tool}:${result.message}`;
            if (processedResultRef.current === resultKey) {
                return;
            }
            processedResultRef.current = resultKey;

            if (result.tool === 'chat_expert' || result.tool === 'get_current_weather' || result.tool === 'get_latest_news' || result.tool === 'search_web') {
                const replyId = Date.now().toString() + '_chat';
                const content = result.tool === 'chat_expert'
                    ? result.message
                    : `已呼叫工具 ${result.tool}。\n\n${result.message}`;
                setMessages((prev) => [...prev, { id: replyId, role: 'assistant', content }]);
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
                        <div className='flex overflow-hidden rounded border border-edge bg-black/30'>
                            <button
                                type='button'
                                onClick={() => setMode('stub')}
                                className={`px-2 py-1 transition ${mode === 'stub' ? 'bg-slate-200 text-slate-900' : 'text-slate-300 hover:bg-white/5'}`}
                            >
                                STUB
                            </button>
                            <button
                                type='button'
                                onClick={() => setMode('sse')}
                                className={`px-2 py-1 transition ${mode === 'sse' ? 'bg-sky-400/90 text-slate-950' : 'text-slate-300 hover:bg-white/5'}`}
                            >
                                LIVE
                            </button>
                        </div>
                        <span className='rounded border border-edge bg-black/30 px-2 py-1'>{statusText}</span>
                        <span className='rounded border border-emerald-500/40 bg-emerald-500/10 px-2 py-1 text-emerald-300'>Local-only</span>
                        <span className='rounded border border-edge bg-black/30 px-2 py-1'>紀錄: {historyStatus}</span>
                        <button
                            type='button'
                            onClick={() => setSettingsOpen((prev) => !prev)}
                            className='rounded border border-edge bg-black/30 px-2 py-1 text-slate-300 transition hover:bg-white/5'
                        >
                            Backend
                        </button>
                        <button
                            type='button'
                            onClick={() => {
                                setMessages([]);
                                window.localStorage.removeItem(CHAT_STORAGE_KEY);
                                setHistoryStatus('已清除本地紀錄');
                            }}
                            className='rounded border border-edge bg-black/30 px-2 py-1 text-slate-300 transition hover:bg-white/5'
                        >
                            清除紀錄
                        </button>
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
                {settingsOpen ? (
                    <div className='mx-auto mt-3 flex w-full max-w-4xl flex-col gap-3 rounded-xl border border-edge bg-black/30 p-3 md:flex-row md:items-center'>
                        <label className='flex-1 text-xs text-slate-400'>
                            Backend URL
                            <input
                                type='url'
                                value={backendOriginInput}
                                onChange={(event) => setBackendOriginInput(event.target.value)}
                                placeholder='https://your-backend.up.railway.app'
                                className='mt-1 w-full rounded-lg border border-edge bg-black/35 px-3 py-2 text-sm text-slate-100 outline-none transition focus:border-slate-400'
                            />
                        </label>
                        <button
                            type='button'
                            onClick={() => setBackendOriginInput(window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1' ? 'http://127.0.0.1:3000' : '')}
                            className='rounded-lg border border-edge bg-black/25 px-3 py-2 text-sm text-slate-300 transition hover:bg-black/40'
                        >
                            Reset
                        </button>
                    </div>
                ) : null}
                {mode === 'sse' ? (
                    <div className='mx-auto mt-3 flex w-full max-w-4xl flex-wrap gap-2 text-[11px] text-slate-300'>
                        <span className={`rounded border px-2 py-1 ${backendInfo?.reachable ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200' : 'border-amber-500/40 bg-amber-500/10 text-amber-200'}`}>
                            Backend: {backendInfo?.reachable ? 'reachable' : 'unknown'}
                        </span>
                        <span className='rounded border border-edge bg-black/30 px-2 py-1'>Version: {backendInfo?.version ?? '...'}</span>
                        <span className='rounded border border-edge bg-black/30 px-2 py-1'>Build: {backendInfo?.build ?? '...'}</span>
                        <span className='rounded border border-edge bg-black/30 px-2 py-1'>Mode: {backendInfo?.mode ?? '...'}</span>
                        <span className='rounded border border-edge bg-black/30 px-2 py-1'>Transport: {backendInfo?.transport ?? '...'}</span>
                        <span className='rounded border border-edge bg-black/30 px-2 py-1'>Tools: {backendInfo?.capabilities.join(', ') || '...'}</span>
                    </div>
                ) : null}
            </header>

            <div className='flex-1 overflow-y-auto px-4 py-6 md:px-6'>
                <div className='mx-auto max-w-2xl space-y-4'>
                    <div className='flex flex-wrap gap-2'>
                        {QUICK_ACTIONS.map((item) => (
                            <button
                                key={item.label}
                                type='button'
                                onClick={() => void runQuickAction(item.prompt)}
                                disabled={reviewing}
                                className='rounded-full border border-edge bg-black/30 px-3 py-1.5 text-xs font-semibold text-slate-300 transition hover:bg-white/5 disabled:cursor-not-allowed disabled:opacity-60'
                            >
                                {item.label}
                            </button>
                        ))}
                    </div>

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
                            placeholder='輸入問題，或貼上 C/C++ 程式碼...（Enter 送出 / Shift+Enter 換行）'
                            value={inputCode}
                            onChange={(e) => setInputCode(e.target.value)}
                            onKeyDown={handleInputKeyDown}
                            spellCheck={false}
                        />
                        <div className='flex items-center justify-between gap-3'>
                            <p className='text-xs text-slate-500'>一般對話會直接回覆；看起來像程式碼的內容會自動進入審閱模式。按 Enter 可送出，按 Shift+Enter 可換行。</p>
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

function loadMessagesFromStorage(): ChatMessage[] {
    try {
        const raw = window.localStorage.getItem(CHAT_STORAGE_KEY);
        if (!raw) {
            return [];
        }

        const parsed = JSON.parse(raw) as unknown;
        if (!Array.isArray(parsed)) {
            return [];
        }

        return parsed
            .filter((item) => item && typeof item === 'object')
            .map((item) => {
                const record = item as Record<string, unknown>;
                return {
                    id: String(record['id'] ?? Date.now().toString()),
                    role: record['role'] === 'assistant' ? 'assistant' : 'user',
                    content: typeof record['content'] === 'string' ? record['content'] : '',
                } as ChatMessage;
            })
            .filter((item) => item.content.length > 0);
    } catch {
        return [];
    }
}

function getInitialHistoryStatus(rawStorage: string | null): string {
    if (!rawStorage) {
        return '尚未建立';
    }

    try {
        const parsed = JSON.parse(rawStorage) as unknown;
        const count = Array.isArray(parsed) ? parsed.length : 0;
        return `已載入 ${count} 筆`;
    } catch {
        return '紀錄格式異常';
    }
}

function formatClockTime(date: Date): string {
    const hh = String(date.getHours()).padStart(2, '0');
    const mm = String(date.getMinutes()).padStart(2, '0');
    const ss = String(date.getSeconds()).padStart(2, '0');
    return `${hh}:${mm}:${ss}`;
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
