import { useEffect, useRef, useState } from 'react';
import type { CSSProperties, FormEvent, KeyboardEvent } from 'react';
import avatarImage from './assets/avatar.jpg';
import ReviewHeader from './components/ReviewHeader.js';
import { useMCP } from './hooks/useMCP.js';
import type { AlertToast } from './hooks/useMCP.js';

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

type LabMode = 'quota' | 'server-error' | 'offline';

const CHAT_STORAGE_KEY = 'copilot-chat-history-v1';
const BACKEND_PANEL_COLLAPSED_KEY = 'copilot-backend-panel-collapsed-v1';
const LAB_MODE_STORAGE_KEY = 'copilot-lab-mode-v1';
const QUICK_ACTIONS = [
    { label: '查天氣', prompt: '幫我查汐止現在天氣' },
    { label: '查新聞', prompt: 'latest Taiwan technology news' },
    { label: '網頁搜尋', prompt: 'search RTOS priority inversion mitigation' },
] as const;

const REQUIRED_LIVE_TOOLS = ['get_current_weather', 'get_latest_news', 'search_web'] as const;
const LAB_ONLINE_ORIGIN = 'http://127.0.0.1:3015';
const LAB_OFFLINE_ORIGIN = 'http://127.0.0.1:3999';

const TOOL_MESSAGE_PREFIXES = ['已呼叫工具 get_current_weather', '已呼叫工具 get_latest_news', '已呼叫工具 search_web'];
const CAPABILITY_PROMPTS: Record<string, string> = {
    review_code: 'volatile int flag = 0;\nvoid ISR(void) { flag = 1; }\nint main(void) {\n  while (flag == 0) {}\n  return 0;\n}',
    chat_expert: '請說明 ISR 與 main loop 共用變數時，如何避免 race condition？',
    get_current_weather: '幫我查汐止現在天氣',
    search_web: 'search RTOS priority inversion mitigation',
    get_latest_news: 'latest Taiwan technology news',
};

export default function ReviewChat({ initialMode = 'stub', initialBackendOrigin = '' }: ReviewChatProps) {
    const [mode, setMode] = useState<'stub' | 'sse'>(() => {
        const savedMode = window.localStorage.getItem('copilot-review-mode');
        if (initialMode === 'sse') {
            return 'sse';
        }
        return savedMode === 'sse' || savedMode === 'stub' ? savedMode : initialMode;
    });
    const [backendOriginInput, setBackendOriginInput] = useState(() => {
        const savedOrigin = window.localStorage.getItem('copilot-backend-origin')?.trim() ?? '';
        const initialOrigin = initialBackendOrigin.trim();
        return initialOrigin || savedOrigin;
    });
    const [settingsOpen, setSettingsOpen] = useState(false);
    const [labMode, setLabMode] = useState<LabMode>(() => {
        const savedLabMode = window.localStorage.getItem(LAB_MODE_STORAGE_KEY);
        return savedLabMode === 'server-error' || savedLabMode === 'offline' ? savedLabMode : 'quota';
    });
    const [labModeStatus, setLabModeStatus] = useState<string | null>(null);
    const [applyingLabMode, setApplyingLabMode] = useState(false);
    // EN: Persist whether the runtime metadata panel is collapsed. ZH: 持久化後端狀態面板的開合偏好。
    const [backendPanelCollapsed, setBackendPanelCollapsed] = useState<boolean>(() => window.localStorage.getItem(BACKEND_PANEL_COLLAPSED_KEY) === '1');
    const [messages, setMessages] = useState<ChatMessage[]>(() => loadMessagesFromStorage());
    const [historyStatus, setHistoryStatus] = useState<string>(() => getInitialHistoryStatus(window.localStorage.getItem(CHAT_STORAGE_KEY)));
    const [inputCode, setInputCode] = useState('');
    const messagesEndRef = useRef<HTMLDivElement>(null);
    const processedResultRef = useRef<string | null>(null);
    const { result, reviewing, statusText, backendInfo, alertToast, clearAlertMessage, submitPrompt, connectSse } = useMCP({ mode, backendOrigin: backendOriginInput });
    const alertToastStyle = {
        '--alert-dismiss-ms': `${alertToast?.durationMs ?? 12000}ms`,
    } as CSSProperties;
    const missingLiveTools = REQUIRED_LIVE_TOOLS.filter((tool) => !backendInfo?.capabilities.includes(tool));
    const showBackendWarning = mode === 'sse' && (!backendInfo?.reachable || missingLiveTools.length > 0);

    useEffect(() => {
        window.localStorage.setItem('copilot-review-mode', mode);
    }, [mode]);

    useEffect(() => {
        window.localStorage.setItem('copilot-backend-origin', backendOriginInput);
    }, [backendOriginInput]);

    useEffect(() => {
        window.localStorage.setItem(LAB_MODE_STORAGE_KEY, labMode);
    }, [labMode]);

    useEffect(() => {
        window.localStorage.setItem(BACKEND_PANEL_COLLAPSED_KEY, backendPanelCollapsed ? '1' : '0');
    }, [backendPanelCollapsed]);

    useEffect(() => {
        const normalizedInitialOrigin = initialBackendOrigin.trim();
        if (!normalizedInitialOrigin) {
            return;
        }

        setBackendOriginInput((currentOrigin) => currentOrigin.trim() || normalizedInitialOrigin);
    }, [initialBackendOrigin]);

    useEffect(() => {
        const normalizedOrigin = backendOriginInput.trim().replace(/\/+$/, '');
        if (normalizedOrigin === LAB_OFFLINE_ORIGIN) {
            setLabMode('offline');
            return;
        }

        if (normalizedOrigin === LAB_ONLINE_ORIGIN && labMode === 'offline') {
            setLabMode('quota');
        }
    }, [backendOriginInput, labMode]);

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

    useEffect(() => {
        if (!alertToast) {
            return;
        }

        // EN: Auto-hide transient alerts based on their variant-specific duration. ZH: 依警示類型套用不同自動收起時間。
        const timeoutId = window.setTimeout(() => {
            clearAlertMessage();
        }, alertToast.durationMs);

        return () => {
            window.clearTimeout(timeoutId);
        };
    }, [alertToast, clearAlertMessage]);

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

    const runCapabilityAction = async (capability: string): Promise<void> => {
        const prompt = CAPABILITY_PROMPTS[capability];
        if (!prompt) {
            return;
        }

        await runQuickAction(prompt);
    };

    const applyLabMode = async (): Promise<void> => {
        setMode('sse');
        setApplyingLabMode(true);

        if (labMode === 'offline') {
            setBackendOriginInput(LAB_OFFLINE_ORIGIN);
            setLabModeStatus('Offline lab active. Frontend now points to 127.0.0.1:3999 to simulate an unreachable backend.');
            setApplyingLabMode(false);
            return;
        }

        setBackendOriginInput(LAB_ONLINE_ORIGIN);
        setLabModeStatus(`Applying ${labMode} lab mode on ${LAB_ONLINE_ORIGIN}...`);

        try {
            const response = await fetch(`${LAB_ONLINE_ORIGIN}/lab/config`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ mode: labMode }),
            });

            if (!response.ok) {
                throw new Error(`Lab config request failed with status ${response.status}`);
            }

            const payload = await response.json() as { mode?: string };
            const appliedMode = payload.mode === 'server-error' ? 'server-error' : 'quota';
            setLabModeStatus(appliedMode === 'quota'
                ? 'Quota lab active. The local mock backend now returns 429 / QUOTA_EXCEEDED.'
                : 'Server-error lab active. The local mock backend now returns HTTP 500 responses.');
        } catch {
            setLabModeStatus('Lab backend not reachable. Start npm run dev:quota or npm run dev:quota:429 first.');
        } finally {
            setApplyingLabMode(false);
        }
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
            <ReviewHeader
                mode={mode}
                statusText={statusText}
                historyStatus={historyStatus}
                settingsOpen={settingsOpen}
                backendPanelCollapsed={backendPanelCollapsed}
                backendOriginInput={backendOriginInput}
                labMode={labMode}
                labModeStatus={labModeStatus}
                applyingLabMode={applyingLabMode}
                backendInfo={backendInfo}
                missingLiveTools={missingLiveTools}
                showBackendWarning={showBackendWarning}
                capabilityActionDisabled={reviewing}
                onModeChange={setMode}
                onToggleBackendPanel={() => setBackendPanelCollapsed((currentValue) => !currentValue)}
                onToggleSettings={() => setSettingsOpen((prev) => !prev)}
                onClearHistory={() => {
                    setMessages([]);
                    window.localStorage.removeItem(CHAT_STORAGE_KEY);
                    setHistoryStatus('已清除本地紀錄');
                }}
                onConnectSse={connectSse}
                onBackendOriginChange={setBackendOriginInput}
                onResetBackendOrigin={() => setBackendOriginInput(window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1' ? 'http://127.0.0.1:3000' : '')}
                onLabModeChange={setLabMode}
                onApplyLabMode={() => {
                    void applyLabMode();
                }}
                onCapabilitySelect={(capability) => {
                    void runCapabilityAction(capability);
                }}
            />

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
                                            <div className={`assistant-card max-w-xs border border-edge bg-slate-800 text-sm leading-relaxed text-slate-100 md:max-w-md lg:max-w-lg ${isToolAssistantMessage(msg.content) ? 'assistant-card--tool' : ''}`}>
                                            <p className='mb-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400'>Senior Embedded Expert</p>
                                                {isToolAssistantMessage(msg.content) ? <p className='tool-kicker'>Tool Response</p> : null}
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
                                <div className='assistant-card assistant-card--tool border border-edge bg-slate-800'>
                                    <p className='mb-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400'>Senior Embedded Expert</p>
                                    <div className='flex items-center gap-2'>
                                        <div className='loading-dots' aria-hidden='true'>
                                            <span></span>
                                            <span></span>
                                            <span></span>
                                        </div>
                                        <span className='text-xs text-slate-400'>助手正在分析中...</span>
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}
                    <div ref={messagesEndRef} />
                </div>
            </div>

            {alertToast ? (
                <aside className='toast-stack pointer-events-none fixed bottom-4 right-4 z-50 w-[min(24rem,calc(100vw-2rem))] sm:bottom-6 sm:right-6'>
                    <div style={alertToastStyle} className={`alert-toast alert-toast--${alertToast.tone} pointer-events-auto rounded-2xl px-4 py-3 text-sm shadow-[0_18px_45px_rgba(0,0,0,0.42)] backdrop-blur-md`}>
                        <div className='alert-banner__header'>
                            <div>
                                <p className='alert-toast__title'>{alertToast.title}</p>
                                <div className='alert-toast__kicker-row'>
                                    <p className='alert-toast__kicker'>{alertToast.kicker}</p>
                                    <p className='alert-toast__meta'>auto close in {Math.ceil(alertToast.durationMs / 1000)}s</p>
                                </div>
                            </div>
                            <button
                                type='button'
                                onClick={clearAlertMessage}
                                className='alert-banner__close'
                                aria-label='Dismiss API warning'
                                title='關閉提醒'
                            >
                                ×
                            </button>
                        </div>
                        <p className='alert-toast__message'>{alertToast.message}</p>
                        <div className='alert-toast__progress-track' aria-hidden='true'>
                            <div className='alert-toast__progress-bar'></div>
                        </div>
                    </div>
                </aside>
            ) : null}

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

function isToolAssistantMessage(content: string): boolean {
    return TOOL_MESSAGE_PREFIXES.some((prefix) => content.startsWith(prefix));
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
