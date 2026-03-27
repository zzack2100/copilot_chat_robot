type ReviewHeaderProps = {
    mode: 'stub' | 'sse';
    statusText: string;
    historyStatus: string;
    settingsOpen: boolean;
    backendOriginInput: string;
    backendInfo: {
        reachable: boolean;
        version: string;
        build: string;
        mode: 'live' | 'stub';
        transport: 'stdio' | 'sse';
        capabilities: string[];
    } | null;
    missingLiveTools: readonly string[];
    showBackendWarning: boolean;
    capabilityActionDisabled: boolean;
    onModeChange: (mode: 'stub' | 'sse') => void;
    onToggleSettings: () => void;
    onClearHistory: () => void;
    onConnectSse: () => void;
    onBackendOriginChange: (value: string) => void;
    onResetBackendOrigin: () => void;
    onCapabilitySelect: (capability: string) => void;
};

const getCapabilityIcon = (capability: string): string => {
    switch (capability) {
        case 'review_code':
            return '</>';
        case 'chat_expert':
            return 'AI';
        case 'get_current_weather':
            return 'WX';
        case 'search_web':
            return 'WEB';
        case 'get_latest_news':
            return 'NEWS';
        default:
            return 'TOOL';
    }
};

export default function ReviewHeader({
    mode,
    statusText,
    historyStatus,
    settingsOpen,
    backendOriginInput,
    backendInfo,
    missingLiveTools,
    showBackendWarning,
    capabilityActionDisabled,
    onModeChange,
    onToggleSettings,
    onClearHistory,
    onConnectSse,
    onBackendOriginChange,
    onResetBackendOrigin,
    onCapabilitySelect,
}: ReviewHeaderProps) {
    return (
        <header className='border-b border-edge bg-slate-900/50 px-4 py-3 md:px-6'>
            <div className='header-shell mx-auto w-full max-w-4xl'>
                <div>
                    <p className='text-xs tracking-[0.26em] text-slate-400'>MCP 代碼審查助手</p>
                    <h1 className='mt-1 text-lg font-semibold text-slate-100'>Thread-Safety Review Bot</h1>
                </div>
                <div className='header-actions text-xs text-slate-400'>
                    <div className='status-rail'>
                        <div className='status-cluster'>
                            <div className='flex overflow-hidden rounded-xl border border-edge bg-black/30'>
                                <button
                                    type='button'
                                    onClick={() => onModeChange('stub')}
                                    className={`px-3 py-1.5 transition ${mode === 'stub' ? 'bg-slate-200 text-slate-900' : 'text-slate-300 hover:bg-white/5'}`}
                                >
                                    STUB
                                </button>
                                <button
                                    type='button'
                                    onClick={() => onModeChange('sse')}
                                    className={`px-3 py-1.5 transition ${mode === 'sse' ? 'bg-sky-400/90 text-slate-950' : 'text-slate-300 hover:bg-white/5'}`}
                                >
                                    LIVE
                                </button>
                            </div>
                            <span className='status-badge status-badge--info status-badge--grow'>{statusText}</span>
                        </div>
                        <div className='status-cluster'>
                            <span className='status-badge status-badge--success'>Local-only</span>
                            <span className='status-badge status-badge--neutral status-badge--grow'>紀錄: {historyStatus}</span>
                        </div>
                    </div>
                    <div className='action-rail'>
                        <div className='status-cluster status-cluster--actions'>
                            <button
                                type='button'
                                onClick={onToggleSettings}
                                className='action-button'
                            >
                                Backend
                            </button>
                            <button
                                type='button'
                                onClick={onClearHistory}
                                className='action-button'
                            >
                                清除紀錄
                            </button>
                            {mode === 'sse' ? (
                                <button
                                    type='button'
                                    onClick={onConnectSse}
                                    className='action-button action-button--accent'
                                >
                                    SSE
                                </button>
                            ) : null}
                        </div>
                    </div>
                </div>
            </div>
            {settingsOpen ? (
                <div className='mx-auto mt-3 flex w-full max-w-4xl flex-col gap-3 rounded-xl border border-edge bg-black/30 p-3 md:flex-row md:items-center'>
                    <label className='flex-1 text-xs text-slate-400'>
                        Backend URL
                        <input
                            type='url'
                            value={backendOriginInput}
                            onChange={(event) => onBackendOriginChange(event.target.value)}
                            placeholder='https://your-backend.up.railway.app'
                            className='mt-1 w-full rounded-lg border border-edge bg-black/35 px-3 py-2 text-sm text-slate-100 outline-none transition focus:border-slate-400'
                        />
                    </label>
                    <button
                        type='button'
                        onClick={onResetBackendOrigin}
                        className='rounded-lg border border-edge bg-black/25 px-3 py-2 text-sm text-slate-300 transition hover:bg-black/40'
                    >
                        Reset
                    </button>
                </div>
            ) : null}
            {mode === 'sse' ? (
                <section className='backend-panel mx-auto mt-3 w-full max-w-4xl'>
                    <div className='backend-panel__summary'>
                        <div>
                            <p className='backend-panel__eyebrow'>Backend Status</p>
                            <h2 className='backend-panel__title'>Live Runtime Metadata</h2>
                        </div>
                        <span className={`status-badge status-badge--status ${backendInfo?.reachable ? 'status-badge--success' : 'status-badge--warning'}`}>
                            <span
                                aria-hidden='true'
                                className={`status-light ${backendInfo?.reachable ? 'status-light--success' : 'status-light--warning'}`}
                            ></span>
                            <span className='status-badge__stack'>
                                <span className='status-badge__eyebrow'>Backend</span>
                                <span className='status-badge__value'>{backendInfo?.reachable ? 'reachable' : 'unknown'}</span>
                            </span>
                        </span>
                    </div>
                    <div className='backend-meta-grid text-[11px] text-slate-300'>
                        <article className='backend-meta-card backend-meta-card--primary'>
                            <p className='backend-meta-card__label'>Build</p>
                            <p className='backend-meta-card__value backend-meta-card__value--hero backend-meta-card__value--code'>{backendInfo?.build ?? '...'}</p>
                            <p className='backend-meta-card__hint'>用來辨識你目前是不是連到最新版 backend。</p>
                        </article>
                        <article className='backend-meta-card'>
                            <p className='backend-meta-card__label'>Version</p>
                            <p className='backend-meta-card__value backend-meta-card__value--strong'>{backendInfo?.version ?? '...'}</p>
                            <p className='backend-meta-card__subvalue'>Runtime release identifier</p>
                        </article>
                        <article className='backend-meta-card'>
                            <p className='backend-meta-card__label'>Mode</p>
                            <p className='backend-meta-card__value backend-meta-card__value--strong'>{backendInfo?.mode ?? '...'}</p>
                            <p className='backend-meta-card__subvalue'>Current execution profile</p>
                        </article>
                        <article className='backend-meta-card'>
                            <p className='backend-meta-card__label'>Transport</p>
                            <p className='backend-meta-card__value backend-meta-card__value--strong'>{backendInfo?.transport ?? '...'}</p>
                            <p className='backend-meta-card__subvalue'>Client communication channel</p>
                        </article>
                        <article className='backend-meta-card backend-meta-card--wide'>
                            <p className='backend-meta-card__label'>Capabilities</p>
                            <div className='capability-chip-list'>
                                {(backendInfo?.capabilities.length ? backendInfo.capabilities : ['...']).map((capability) => (
                                    <button
                                        key={capability}
                                        type='button'
                                        className='capability-chip'
                                        onClick={() => onCapabilitySelect(capability)}
                                        disabled={capability === '...' || capabilityActionDisabled}
                                        title={capability === '...' ? 'Capability unavailable' : `點擊直接送出 ${capability} 範例`}
                                    >
                                        <span className='capability-chip__icon' aria-hidden='true'>{getCapabilityIcon(capability)}</span>
                                        <span>{capability}</span>
                                    </button>
                                ))}
                            </div>
                            <p className='backend-meta-card__subvalue'>Enabled tools exposed by this backend instance. 點一下可直接送出對應範例請求。</p>
                        </article>
                    </div>
                </section>
            ) : null}
            {showBackendWarning ? (
                <div className='mx-auto mt-3 w-full max-w-4xl rounded-xl border border-rose-500/60 bg-rose-500/12 px-4 py-3 text-sm text-rose-100 shadow-[0_0_0_1px_rgba(244,63,94,0.15)]'>
                    <p className='font-semibold tracking-[0.08em] text-rose-200'>LIVE BACKEND WARNING</p>
                    <p className='mt-1'>
                        {!backendInfo?.reachable
                            ? '前端目前無法連到後端。請確認 Backend URL、localhost port 與 server process 是否真的啟動。'
                            : `目前連到的後端缺少工具: ${missingLiveTools.join(', ')}。這通常代表你打到舊版 backend，前端的查天氣、查新聞、網頁搜尋不會正常。`}
                    </p>
                    <p className='mt-1 text-xs text-rose-200/90'>期望 build: 2026-03-27-tool-routing</p>
                </div>
            ) : null}
        </header>
    );
}