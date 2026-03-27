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
  submitPrompt: (message: string) => Promise<void>;
  connectSse: () => void;
};

const looksLikeCode = (input: string): boolean => {
  const normalized = input.trim();
  if (!normalized) {
    return false;
  }

  const signals = ['#include', 'int main(', 'void ', 'volatile ', 'uint8_t', 'uint16_t', 'uint32_t', 'if (', 'while (', 'for (', '{', '}', ';'];
  return signals.some((signal) => normalized.includes(signal)) || normalized.split(/\r?\n/).length >= 4;
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
  const backendOrigin = (import.meta.env.VITE_BACKEND_ORIGIN ?? 'http://127.0.0.1:3000').replace(/\/+$/, '');
  const sseUrl = options?.sseUrl ?? `${backendOrigin}/mcp`;
  const reviewUrl = options?.reviewUrl ?? `${backendOrigin}/message`;
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

    try {
      if (mode === 'stub') {
        await new Promise((resolve) => setTimeout(resolve, 500));
        const stubResult = buildStubResult(trimmed);
        setResult(stubResult);
        setStatusText(stubResult.tool === 'review_code' ? 'Stub review completed' : 'Stub chat completed');
        return;
      }

      setStatusText('Live request in progress...');
      const response = await fetch(reviewUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ message: trimmed }),
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

      setStatusText(payload.status === 'success' ? 'Live response received' : 'Live request failed');
    } catch (error) {
      setStatusText('Live request failed');
      const message = error instanceof Error ? error.message : 'Unknown error';
      setResult({
        status: 'error',
        tool: 'chat_expert',
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
      submitPrompt,
      connectSse,
    }),
    [connectSse, mode, result, submitPrompt, reviewing, statusText]
  );
}
