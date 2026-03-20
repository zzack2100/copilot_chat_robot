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
  sseUrl?: string;
  reviewUrl?: string;
  transport?: MCPTransport;
};

type UseMCPResult = {
  mode: MCPMode;
  statusText: string;
  result: ReviewResult | null;
  reviewing: boolean;
  reviewCode: (code: string) => Promise<void>;
  connectSse: () => void;
};

const STUB_RESULT: ReviewResult = {
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

export function useMCP(options?: UseMCPOptions): UseMCPResult {
  const mode = options?.mode ?? 'stub';
  const sseUrl = options?.sseUrl ?? 'http://127.0.0.1:3000/mcp';
  const reviewUrl = options?.reviewUrl ?? 'http://127.0.0.1:3000/message';
  const transport = options?.transport ?? defaultSseTransport;
  const streamRef = useRef<MCPStream | null>(null);

  const [statusText, setStatusText] = useState(mode === 'stub' ? 'Stub mode ready' : 'SSE not connected');
  const [reviewing, setReviewing] = useState(false);
  const [result, setResult] = useState<ReviewResult | null>(null);

  useEffect(() => {
    setStatusText(mode === 'stub' ? 'Stub mode ready' : 'Live mode ready');
  }, [mode]);

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

  const reviewCode = useCallback(async (code: string) => {
    const trimmed = code.trim();
    if (!trimmed) {
      setResult({
        status: 'error',
        tool: 'review_code',
        message: 'Code input cannot be empty.',
      });
      return;
    }

    setReviewing(true);

    try {
      if (mode === 'stub') {
        await new Promise((resolve) => setTimeout(resolve, 500));
        setResult(STUB_RESULT);
        setStatusText('Stub review completed');
        return;
      }

      setStatusText('Live review in progress...');
      const response = await fetch(reviewUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ code: trimmed }),
      });

      const payload = (await response.json()) as Partial<ReviewResult>;
      if (typeof payload.status !== 'string' || typeof payload.tool !== 'string' || typeof payload.message !== 'string') {
        throw new Error('Invalid response format from review server.');
      }

      setResult({
        status: payload.status,
        tool: payload.tool,
        message: payload.message,
      });

      setStatusText(payload.status === 'success' ? 'Live review completed' : 'Live review failed');
    } catch (error) {
      setStatusText('Live review failed');
      const message = error instanceof Error ? error.message : 'Unknown error';
      setResult({
        status: 'error',
        tool: 'review_code',
        message,
      });
    } finally {
      setReviewing(false);
    }
  }, [mode, reviewUrl]);

  return useMemo(
    () => ({
      mode,
      statusText,
      result,
      reviewing,
      reviewCode,
      connectSse,
    }),
    [connectSse, mode, result, reviewCode, reviewing, statusText]
  );
}
