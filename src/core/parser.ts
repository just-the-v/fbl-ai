import { readFileSync, statSync } from 'node:fs';

export interface ParsedMessage {
  role: 'user' | 'assistant';
  content: string;
  toolNames?: string[];
  timestamp?: string;
}

export interface ParsedSession {
  sessionId: string;
  messages: ParsedMessage[];
  messageCount: number;
  toolUseCount: number;
  durationSeconds?: number;
  estimatedTokens: number;
  startedAt?: string;
}

interface ContentBlock {
  type: 'text' | 'tool_use' | 'tool_result' | 'thinking';
  text?: string;
  name?: string;
  id?: string;
  input?: unknown;
  content?: string;
}

interface JsonlLine {
  type?: string;
  sessionId?: string;
  uuid?: string;
  parentUuid?: string;
  timestamp?: string;
  message?: {
    role: 'user' | 'assistant';
    content: string | ContentBlock[];
  };
}

const MAX_CONTENT_LENGTH = 500;

function extractContent(content: string | ContentBlock[]): {
  text: string;
  toolNames: string[];
} {
  if (typeof content === 'string') {
    return { text: content, toolNames: [] };
  }

  const textParts: string[] = [];
  const toolNames: string[] = [];

  for (const block of content) {
    switch (block.type) {
      case 'text':
        if (block.text) {
          textParts.push(block.text);
        }
        break;
      case 'tool_use':
        if (block.name) {
          toolNames.push(block.name);
        }
        break;
      case 'tool_result':
        if (typeof block.content === 'string') {
          textParts.push(block.content);
        }
        break;
      case 'thinking':
        // Ignored
        break;
    }
  }

  return { text: textParts.join('\n'), toolNames };
}

function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength);
}

export function parseTranscript(filePath: string): ParsedSession {
  const fileBytes = statSync(filePath).size;
  const raw = readFileSync(filePath, 'utf-8');
  const lines = raw.split('\n').filter(Boolean);

  const messages: ParsedMessage[] = [];
  let sessionId = '';
  let toolUseCount = 0;
  const timestamps: string[] = [];

  for (const line of lines) {
    let parsed: JsonlLine;
    try {
      parsed = JSON.parse(line) as JsonlLine;
    } catch {
      console.warn(`Skipping malformed JSONL line: ${line.slice(0, 80)}...`);
      continue;
    }

    if (!parsed.message?.role) {
      continue;
    }

    if (parsed.sessionId && !sessionId) {
      sessionId = parsed.sessionId;
    }

    if (parsed.timestamp) {
      timestamps.push(parsed.timestamp);
    }

    const { text, toolNames } = extractContent(parsed.message.content);
    const toolCount = toolNames.length;
    toolUseCount += toolCount;

    const msg: ParsedMessage = {
      role: parsed.message.role,
      content: truncate(text, MAX_CONTENT_LENGTH),
    };

    if (toolNames.length > 0) {
      msg.toolNames = toolNames;
    }

    if (parsed.timestamp) {
      msg.timestamp = parsed.timestamp;
    }

    messages.push(msg);
  }

  let durationSeconds: number | undefined;
  if (timestamps.length >= 2) {
    const first = new Date(timestamps[0]).getTime();
    const last = new Date(timestamps[timestamps.length - 1]).getTime();
    if (!isNaN(first) && !isNaN(last)) {
      durationSeconds = Math.round((last - first) / 1000);
    }
  }

  return {
    sessionId,
    messages,
    messageCount: messages.length,
    toolUseCount,
    durationSeconds,
    estimatedTokens: Math.round(fileBytes / 4),
    startedAt: timestamps.length > 0 ? timestamps[0] : undefined,
  };
}
