import { useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import { useMCP } from './hooks/useMCP.js';
import type { RiskLevel } from './types/review.js';

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

const DEFAULT_CODE = `volatile int flag = 0;

void ISR(void) {
    flag = 1;
}

int main(void) {
    while (1) {
        if (flag) {
            flag = 0;
        }
    }
}`;

export default function ReviewChat({ mode = 'stub' }: ReviewChatProps) {
    const [inputCode, setInputCode] = useState(DEFAULT_CODE);
    const { result, reviewing, statusText, reviewCode, connectSse } = useMCP({ mode });
    const parsedMessage = useMemo(() => parseMessage(result?.message), [result?.message]);
    const riskItems = parsedMessage?.risks ?? [];
    const adviceItems = parsedMessage?.advice ?? [];

    const riskLevel = useMemo(() => detectRiskLevel(result?.message, parsedMessage), [result?.message, parsedMessage]);

    const onSubmit = async (event: FormEvent) => {
        event.preventDefault();
        await reviewCode(inputCode);
    };

    return (
        <main className='grid-overlay min-h-screen p-5 md:p-8'>
            <div className='mx-auto flex w-full max-w-7xl flex-col gap-4'>
                <header className='panel-frame rounded-xl p-4 md:p-6'>
                    <p className='text-xs tracking-[0.26em] text-slate-400'>MCP THREAD-SAFETY MONITOR</p>
                    <h1 className='mt-2 text-2xl font-semibold text-slate-100 md:text-3xl'>Industrial Review Dashboard</h1>
                    <div className='mt-4 flex flex-wrap items-center gap-2 text-sm text-slate-300'>
                        <span className='rounded border border-edge bg-black/30 px-3 py-1'>Mode: {mode === 'sse' ? 'LIVE' : 'STUB'}</span>
                        <span className='rounded border border-edge bg-black/30 px-3 py-1'>Status: {statusText}</span>
                        {mode === 'sse' ? (
                            <button
                                type='button'
                                onClick={connectSse}
                                className='rounded border border-sky-500/50 bg-sky-500/10 px-3 py-1 text-sky-200 transition hover:bg-sky-500/20'
                            >
                                Connect SSE
                            </button>
                        ) : null}
                    </div>
                </header>

                <section className='grid gap-4 lg:grid-cols-[1.05fr_1fr]'>
                    <article className='panel-frame rounded-xl p-4 md:p-5'>
                        <h2 className='text-lg font-semibold text-slate-100'>Code Input</h2>
                        <p className='mt-1 text-sm text-slate-400'>Paste C/C++ source and run MCP tool `review_code`.</p>

                        <form onSubmit={onSubmit} className='mt-4 grid gap-3'>
                            <textarea
                                className='min-h-[420px] w-full rounded-lg border border-edge bg-black/35 p-3 font-mono text-sm text-slate-100 outline-none transition focus:border-slate-400'
                                value={inputCode}
                                onChange={(event) => setInputCode(event.target.value)}
                                spellCheck={false}
                            />

                            <button
                                type='submit'
                                disabled={reviewing}
                                className='rounded-lg border border-slate-500 bg-slate-200 px-4 py-2 text-sm font-semibold text-slate-900 transition hover:bg-white disabled:cursor-not-allowed disabled:opacity-60'
                            >
                                {reviewing ? 'Reviewing...' : 'Run Thread-Safety Review'}
                            </button>
                        </form>
                    </article>

                    <article className='panel-frame rounded-xl p-4 md:p-5'>
                        <div className='flex flex-wrap items-center justify-between gap-2'>
                            <h2 className='text-lg font-semibold text-slate-100'>Review Report</h2>
                            <span className={riskBadgeClass(riskLevel)}>{riskLabel(riskLevel)}</span>
                        </div>

                        {!result ? (
                            <div className='mt-4 rounded-lg border border-dashed border-edge p-4 text-sm text-slate-400'>
                                Run a review to display MCP thread-safety findings here.
                            </div>
                        ) : (
                            <div className='mt-4 grid gap-3'>
                                <div className='rounded border border-edge bg-black/25 p-3 text-sm text-slate-300'>
                                    <p><strong className='text-slate-100'>status:</strong> {result.status}</p>
                                    <p><strong className='text-slate-100'>tool:</strong> {result.tool}</p>
                                </div>

                                <div className='rounded-lg border border-edge bg-black/35 p-4'>
                                    <h3 className='text-sm font-semibold tracking-[0.14em] text-slate-200'>RISK ANALYSIS</h3>
                                    <p className='mt-2 text-xs text-slate-400'>風險分析 (Risk Analysis)</p>

                                    {riskItems.length === 0 ? (
                                        <p className='mt-3 text-sm text-slate-400'>No structured risk items found in response.</p>
                                    ) : (
                                        <ul className='mt-3 grid gap-2'>
                                            {riskItems.map((risk, index) => {
                                                const severity = (risk.severity ?? 'Normal').trim();
                                                const detail = (risk.detail ?? '').trim();
                                                const severityLevel = severity.toLowerCase();
                                                const chipClass = severityLevel.includes('critical')
                                                    ? 'risk-critical'
                                                    : severityLevel.includes('high')
                                                        ? 'risk-high'
                                                        : 'border border-ok/40 bg-ok/10 text-green-300';

                                                return (
                                                    <li key={`risk-${index}`} className='rounded-lg border border-edge bg-black/25 p-3'>
                                                        <div className='flex flex-wrap items-center gap-2'>
                                                            <span className={`rounded border px-2 py-0.5 text-[11px] font-semibold uppercase tracking-[0.1em] ${chipClass}`}>
                                                                {severity}
                                                            </span>
                                                            <span className='text-[11px] uppercase tracking-[0.14em] text-slate-500'>Thread Safety</span>
                                                        </div>
                                                        <p className='mt-2 text-sm leading-relaxed text-slate-200'>
                                                            {detail || 'No detail provided by the MCP response.'}
                                                        </p>
                                                    </li>
                                                );
                                            })}
                                        </ul>
                                    )}
                                </div>

                                <div className='rounded-lg border border-edge bg-black/35 p-4'>
                                    <h3 className='text-sm font-semibold tracking-[0.14em] text-slate-200'>EXPERT ADVICE</h3>
                                    <p className='mt-2 text-xs text-slate-400'>專家建議 (Expert Advice)</p>

                                    {adviceItems.length === 0 ? (
                                        <p className='mt-3 text-sm text-slate-400'>No structured advice found in response.</p>
                                    ) : (
                                        <ul className='mt-3 list-disc space-y-2 pl-5 text-sm leading-relaxed text-slate-200 marker:text-slate-500'>
                                            {adviceItems.map((advice, index) => (
                                                <li key={`advice-${index}`}>
                                                    {advice}
                                                </li>
                                            ))}
                                        </ul>
                                    )}
                                </div>

                                {!parsedMessage ? (
                                    <pre className='max-h-[220px] overflow-auto rounded-lg border border-edge bg-black/35 p-3 text-xs text-slate-300'>
                                        {result.message}
                                    </pre>
                                ) : null}
                            </div>
                        )}
                    </article>
                </section>
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

function detectRiskLevel(message: string | undefined, parsedMessage: ParsedMessage | null): RiskLevel {
    const parsedSeverities = parsedMessage?.risks?.map((risk) => (risk.severity ?? '').toLowerCase()) ?? [];

    if (parsedSeverities.some((item) => item.includes('critical'))) {
        return 'critical';
    }

    if (parsedSeverities.some((item) => item.includes('high'))) {
        return 'high';
    }

    if (!message) {
        return 'normal';
    }

    const normalized = message.toLowerCase();

    if (normalized.includes('critical')) {
        return 'critical';
    }

    if (normalized.includes('high')) {
        return 'high';
    }

    return 'normal';
}

function riskLabel(level: RiskLevel): string {
    if (level === 'critical') {
        return 'Critical Risk';
    }

    if (level === 'high') {
        return 'High Risk';
    }

    return 'No Explicit Risk Label';
}

function riskBadgeClass(level: RiskLevel): string {
    if (level === 'critical') {
        return 'risk-critical rounded border px-3 py-1 text-xs font-semibold';
    }

    if (level === 'high') {
        return 'risk-high rounded border px-3 py-1 text-xs font-semibold';
    }

    return 'rounded border border-ok/50 bg-ok/10 px-3 py-1 text-xs font-semibold text-green-300';
}
