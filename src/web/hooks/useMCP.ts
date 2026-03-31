import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReviewResult } from '../types/review.js';

type MCPMode = 'stub' | 'sse';

type MCPEvent = {
  type: 'open' | 'error' | 'message';
  data?: string;
};

type MCPStream = {
  close: () => void;
};

type MCPTransport = {
  connect: (url: string, onEvent: (event: MCPEvent) => void) => MCPStream;
};

const defaultSseTransport: MCPTransport = {
  connect: (url, onEvent) => {
    const source = new EventSource(url);
    source.onopen = () => onEvent({ type: 'open' });
    source.onerror = () => onEvent({ type: 'error' });
    source.onmessage = (event) => onEvent({ type: 'message', data: String(event.data ?? '') });
    return {
      close: () => source.close(),
    };
  },
};

type UseMCPOptions = {
  mode?: MCPMode;
  backendOrigin?: string;
  sseUrl?: string;
  reviewUrl?: string;
  transport?: MCPTransport;
};

type UseMCPResult = {
  mode: MCPMode;
  statusText: string;
  result: ReviewResult | null;
  reviewing: boolean;
  backendInfo: BackendInfo | null;
  alertToast: AlertToast | null;
  clearAlertMessage: () => void;
  submitPrompt: (message: string) => Promise<void>;
  connectSse: () => void;
};

type ApiErrorResponse = {
  error?: string;
  message?: string;
};

type BackendInfo = {
  status: string;
  service: string;
  version: string;
  build: string;
  mode: 'live' | 'stub';
  transport: 'stdio' | 'sse';
  capabilities: string[];
  models: string[];
  reachable: boolean;
};

type PromptTool = 'review_code' | 'chat_expert' | 'get_current_weather' | 'search_web' | 'get_latest_news';

export type AlertToast = {
  kind: 'quota' | 'rate_limit' | 'server_error' | 'network_error' | 'request_error';
  title: string;
  kicker: string;
  message: string;
  durationMs: number;
  tone: 'warning' | 'danger';
  cooldownKey: string;
};

const ALERT_COOLDOWN_MS = 30_000;
const QUOTA_ALERT_DURATION_MS = 12_000;
const RATE_LIMIT_ALERT_DURATION_MS = 10_000;
const SERVER_ERROR_ALERT_DURATION_MS = 10_000;
const NETWORK_ERROR_ALERT_DURATION_MS = 10_000;
const REQUEST_ERROR_ALERT_DURATION_MS = 9_000;

const buildHttpErrorAlert = (status: number, message: string): AlertToast => {
  if (status === 429) {
    return {
      kind: 'rate_limit',
      title: 'RATE LIMITED',
      kicker: 'http 429 / retry later',
      message,
      durationMs: RATE_LIMIT_ALERT_DURATION_MS,
      tone: 'warning',
      cooldownKey: 'http-429',
    };
  }

  if (status >= 500) {
    return {
      kind: 'server_error',
      title: 'SERVER ERROR',
      kicker: `http ${status} / backend failure`,
      message,
      durationMs: SERVER_ERROR_ALERT_DURATION_MS,
      tone: 'danger',
      cooldownKey: `server-error:${status}`,
    };
  }

  return {
    kind: 'request_error',
    title: 'REQUEST FAILED',
    kicker: `http ${status} / request rejected`,
    message,
    durationMs: REQUEST_ERROR_ALERT_DURATION_MS,
    tone: 'danger',
    cooldownKey: `request-error:${status}:${message}`,
  };
};

const buildRuntimeErrorAlert = (error: unknown): AlertToast => {
  const message = error instanceof Error ? error.message : 'Unknown error';
  const normalized = message.toLowerCase();

  if (normalized.includes('failed to fetch') || normalized.includes('networkerror') || normalized.includes('load failed')) {
    return {
      kind: 'network_error',
      title: 'BACKEND UNREACHABLE',
      kicker: 'network / cors / server offline',
      message: '無法連線到後端服務。請確認 Backend URL、CORS 設定與 server process 是否存活。',
      durationMs: NETWORK_ERROR_ALERT_DURATION_MS,
      tone: 'danger',
      cooldownKey: 'network-unreachable',
    };
  }

  return {
    kind: 'request_error',
    title: 'REQUEST FAILED',
    kicker: 'unexpected runtime error',
    message,
    durationMs: REQUEST_ERROR_ALERT_DURATION_MS,
    tone: 'danger',
    cooldownKey: `runtime-error:${message}`,
  };
};

const looksLikeCode = (input: string): boolean => {
  const normalized = input.trim();
  if (!normalized) {
    return false;
  }

  const signals = ['#include', 'int main(', 'void ', 'volatile ', 'uint8_t', 'uint16_t', 'uint32_t', 'if (', 'while (', 'for (', '{', '}', ';'];
  return signals.some((signal) => normalized.includes(signal)) || normalized.split(/\r?\n/).length >= 4;
};

const looksLikeWeatherPrompt = (input: string): boolean => {
  const normalized = input.toLowerCase();
  return normalized.includes('weather') || normalized.includes('天氣') || normalized.includes('氣溫') || normalized.includes('下雨');
};

const looksLikeNewsPrompt = (input: string): boolean => {
  const normalized = input.toLowerCase();
  return normalized.includes('news') || normalized.includes('新聞') || normalized.includes('google');
};

const inferPromptTool = (input: string): PromptTool => {
  if (looksLikeWeatherPrompt(input)) {
    return 'get_current_weather';
  }

  if (looksLikeNewsPrompt(input)) {
    return 'get_latest_news';
  }

  if (input.toLowerCase().includes('搜尋') || input.toLowerCase().includes('search') || input.toLowerCase().includes('查詢')) {
    return 'search_web';
  }

  if (looksLikeCode(input)) {
    return 'review_code';
  }

  return 'chat_expert';
};

const buildStubResult = (message: string): ReviewResult => {
  if (looksLikeCode(message)) {
    return {
      status: 'success',
      tool: 'review_code',
      message: JSON.stringify(
        {
          summary: 'Thread-safety risk detected in shared state updates.',
          risks: [
            { severity: 'Critical', detail: 'Shared flag is updated in ISR without atomic synchronization.' },
            { severity: 'High', detail: 'Missing memory ordering strategy between ISR and main loop.' },
          ],
          advice: [
            'Use atomic operations or interrupt-safe critical sections for shared variables.',
            'Document ownership and ordering guarantees around ISR-to-main communication.',
          ],
        },
        null,
        2
      ),
    };
  }

  const normalized = message.toLowerCase();
  if (normalized.includes('你好') || normalized.includes('hello') || normalized.includes('hi')) {
    return {
      status: 'success',
      tool: 'chat_expert',
      message: '您好，我是資深嵌入式審查助手。您可以問我一般問題，或直接貼上 C/C++ 程式碼讓我分析。',
    };
  }

  return {
    status: 'success',
    tool: 'chat_expert',
    message: '我可以回答一般嵌入式問題，也可以進行 thread-safety 程式碼審閱。直接提問或貼上程式碼即可。',
  };
};

export function useMCP(options?: UseMCPOptions): UseMCPResult {
  const mode = options?.mode ?? 'stub';
  const runtimeOrigin = options?.backendOrigin?.trim() ?? '';
  const defaultOrigin = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
    ? 'http://127.0.0.1:3000'
    : '';
  const backendOrigin = (runtimeOrigin || import.meta.env.VITE_BACKEND_ORIGIN || defaultOrigin).replace(/\/+$/, '');
  const sseUrl = options?.sseUrl ?? `${backendOrigin}/mcp`;
  const reviewUrl = options?.reviewUrl ?? `${backendOrigin}/message`;
  const healthUrl = backendOrigin ? `${backendOrigin}/health` : '';
  const transport = options?.transport ?? defaultSseTransport;
  const streamRef = useRef<MCPStream | null>(null);
  const lastAlertRef = useRef<{ key: string; timestamp: number } | null>(null);

  const [statusText, setStatusText] = useState(mode === 'stub' ? 'Stub mode ready' : 'SSE not connected');
  const [reviewing, setReviewing] = useState(false);
  const [result, setResult] = useState<ReviewResult | null>(null);
  const [backendInfo, setBackendInfo] = useState<BackendInfo | null>(null);
  const [alertToast, setAlertToast] = useState<AlertToast | null>(null);

  useEffect(() => {
    if (mode === 'stub') {
      setStatusText('Stub mode ready');
      setBackendInfo(null);
      setAlertToast(null);
      return;
    }

    setStatusText(backendOrigin ? `Live mode ready: ${backendOrigin}` : 'Live mode requires backend URL');
  }, [backendOrigin, mode]);

  useEffect(() => {
    let cancelled = false;

    if (mode !== 'sse' || !healthUrl) {
      setBackendInfo(null);
      return;
    }

    const fetchHealth = async () => {
      try {
        const response = await fetch(healthUrl, {
          headers: {
            Accept: 'application/json',
          },
        });

        if (!response.ok) {
          throw new Error(`Health check failed with status ${response.status}`);
        }

        const payload = await response.json() as Partial<BackendInfo>;
        if (cancelled) {
          return;
        }

        if (
          typeof payload.status !== 'string' ||
          typeof payload.service !== 'string' ||
          typeof payload.version !== 'string' ||
          typeof payload.build !== 'string' ||
          (payload.mode !== 'live' && payload.mode !== 'stub') ||
          (payload.transport !== 'stdio' && payload.transport !== 'sse') ||
          !Array.isArray(payload.capabilities) ||
          !Array.isArray(payload.models)
        ) {
          throw new Error('Invalid health payload from backend');
        }

        setBackendInfo({
          status: payload.status,
          service: payload.service,
          version: payload.version,
          build: payload.build,
          mode: payload.mode,
          transport: payload.transport,
          capabilities: payload.capabilities.map((item) => String(item)),
          models: payload.models.map((item) => String(item)),
          reachable: true,
        });
      } catch {
        if (!cancelled) {
          setBackendInfo({
            status: 'error',
            service: 'unreachable',
            version: 'unknown',
            build: 'unknown',
            mode: 'stub',
            transport: 'sse',
            capabilities: [],
            models: [],
            reachable: false,
          });
        }
      }
    };

    void fetchHealth();

    return () => {
      cancelled = true;
    };
  }, [healthUrl, mode]);

  const connectSse = useCallback(() => {
    if (mode !== 'sse') {
      return;
    }

    streamRef.current?.close();
    setStatusText('Connecting to SSE bridge...');

    streamRef.current = transport.connect(sseUrl, (event) => {
      if (event.type === 'open') {
        setStatusText('SSE connected');
        return;
      }

      if (event.type === 'error') {
        setStatusText('SSE disconnected');
        return;
      }

      if (event.type === 'message' && event.data) {
        try {
          const parsed = JSON.parse(event.data) as ReviewResult;
          if (parsed.status && parsed.tool && typeof parsed.message === 'string') {
            setResult(parsed);
          }
        } catch {
          setStatusText('SSE message parse failed');
        }
      }
    });
  }, [mode, sseUrl, transport]);

  const clearAlertMessage = useCallback(() => {
    if (alertToast) {
      lastAlertRef.current = {
        key: alertToast.cooldownKey,
        timestamp: Date.now(),
      };
    }
    setAlertToast(null);
  }, [alertToast]);

  const showAlertMessage = useCallback((alert: AlertToast) => {
    const now = Date.now();
    const lastAlert = lastAlertRef.current;

    if (alertToast?.cooldownKey === alert.cooldownKey) {
      return;
    }

    if (lastAlert?.key === alert.cooldownKey && now - lastAlert.timestamp < ALERT_COOLDOWN_MS) {
      return;
    }

    lastAlertRef.current = {
      key: alert.cooldownKey,
      timestamp: now,
    };
    setAlertToast(alert);
  }, [alertToast]);

  const submitPrompt = useCallback(async (message: string) => {
    const trimmed = message.trim();
    if (!trimmed) {
      setResult({
        status: 'error',
        tool: 'chat_expert',
        message: 'Input cannot be empty.',
      });
      return;
    }

    setReviewing(true);
    const promptTool = inferPromptTool(trimmed);
  let alertHandled = false;

    try {
      if (mode === 'stub') {
        await new Promise((resolve) => setTimeout(resolve, 500));
        const stubResult = buildStubResult(trimmed);
        setResult(stubResult);
        setStatusText(stubResult.tool === 'review_code' ? 'Stub review completed' : 'Stub chat completed');
        setAlertToast(null);
        return;
      }

      if (!backendOrigin) {
        throw new Error('Live mode requires a backend URL. Please set Backend URL in the header settings.');
      }

      if (promptTool === 'get_current_weather') {
        setStatusText('呼叫工具中: get_current_weather...');
      } else if (promptTool === 'get_latest_news') {
        setStatusText('呼叫工具中: get_latest_news...');
      } else if (promptTool === 'search_web') {
        setStatusText('呼叫工具中: search_web...');
      } else if (promptTool === 'review_code') {
        setStatusText('Live review in progress...');
      } else {
        setStatusText('Live request in progress...');
      }

      const response = await fetch(reviewUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ message: trimmed, mode: promptTool }),
      });

      if (!response.ok) {
        const responseStatus = response.status;
        let errorPayload: ApiErrorResponse | null = null;

        try {
          errorPayload = await response.json() as ApiErrorResponse;
        } catch {
          errorPayload = null;
        }

        if (errorPayload?.error === 'QUOTA_EXCEEDED') {
          alertHandled = true;
          showAlertMessage({
            kind: 'quota',
            title: 'API WARNING',
            kicker: 'Gemini quota / rate limit',
            message: '⚠️ API 暫時限流，正自動重試或請一分鐘後再試。',
            durationMs: QUOTA_ALERT_DURATION_MS,
            tone: 'warning',
            cooldownKey: 'quota:gemini-rate-limit',
          });
          setStatusText('Gemini rate limited');
          return;
        }

        const fallbackMessage = errorPayload?.message || `Backend request failed with status ${response.status}.`;
        alertHandled = true;
        showAlertMessage(buildHttpErrorAlert(responseStatus, fallbackMessage));
        throw new Error(fallbackMessage);
      }

      const payload = (await response.json()) as Partial<ReviewResult>;
      if (typeof payload.status !== 'string' || typeof payload.tool !== 'string' || typeof payload.message !== 'string') {
        throw new Error('Invalid response format from review server.');
      }

      setResult({
        status: payload.status,
        tool: payload.tool,
        message: payload.message,
      });

      if (payload.status === 'success' && (payload.tool === 'get_current_weather' || payload.tool === 'get_latest_news' || payload.tool === 'search_web')) {
        setStatusText(`工具完成: ${payload.tool}`);
      } else {
        setStatusText(payload.status === 'success' ? 'Live response received' : 'Live request failed');
      }
      setAlertToast(null);
    } catch (error) {
      setStatusText('Live request failed');
      const message = error instanceof Error ? error.message : 'Unknown error';
      if (!alertHandled) {
        showAlertMessage(buildRuntimeErrorAlert(error));
      }
      setResult({
        status: 'error',
        tool: 'chat_expert',
        message,
      });
    } finally {
      setReviewing(false);
    }
  }, [backendOrigin, mode, reviewUrl, showAlertMessage]);

  return useMemo(
    () => ({
      mode,
      statusText,
      result,
      reviewing,
      backendInfo,
      alertToast,
      clearAlertMessage,
      submitPrompt,
      connectSse,
    }),
    [alertToast, backendInfo, clearAlertMessage, connectSse, mode, result, submitPrompt, reviewing, statusText]
  );
}
